#!/usr/bin/env node
'use strict';

/**
 * git-staging-guard.mjs — R006 safe git staging interface.
 *
 * Implements pure-judgment functions for:
 *   1. Broad vs. explicit staging verdict (classifyStagingCommand)
 *   2. Stale index.lock detection (gatherLockFacts / judgeStaleLock)
 *
 * CLI entrypoint:
 *   node hooks/scripts/lib/git-staging-guard.mjs --check "<command>"
 *   Exits 0 for pass/warn, exits 1 for block.
 *
 * Attribution: patterns inspired by steipete/agent-scripts committer module
 * and superpowers/using-superpowers, rewritten for QE conventions (MIT).
 *
 * Design contracts (결정론 계약):
 * - Broad token = entire token composed only of '.' and '/' chars
 *   (e.g., '.', './', '..', '../..', '../../' etc.)
 *   Explicit exceptions: './src/file.js', '.gitignore', '../sibling/file.js'
 *   because they contain chars beyond '.' and '/'.
 * - -A / --all / -u flags (incl. combined short-flag decomposition) → broad
 * - pathspec magic :/ and :(glob) → broad
 * - Glob chars *, ?, [] in any token (including quoted tokens) → broad
 * - git add -p / -i → block (interactive, hook-context hang risk)
 * - `-n`/`--dry-run` 허용: when -n/--dry-run is present, command stages nothing → verdict pass
 *   even if broad tokens are present (e.g., `git add -n .` → pass). No filesystem staging occurs.
 * - git add -A -- path → broad (conservative: -A present)
 * - $VAR / $(...) → fail-open explicit (cannot resolve statically)
 * - env/assignment prefixes and shell wrappers (`bash -lc 'git add .'`) are
 *   unwrapped only when their script argument is statically visible.
 * - Path-then-option order violation → warn
 * - Option-form token after -- → warn
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stale index.lock threshold in milliseconds. Fixed; no env override. */
export const LOCK_STALE_THRESHOLD_MS = 120_000;

/** Static shell-wrapper recursion cap. Prevents pathological recursion while
 * still covering realistic nested `bash -lc` / `sh -c` wrappers. */
const MAX_WRAPPER_DEPTH = 16;

// ---------------------------------------------------------------------------
// Minimal shell tokenizer
// ---------------------------------------------------------------------------

/**
 * @typedef {{ value: string, quoted: boolean }} Token
 */

/**
 * Minimal tokenizer: splits on whitespace, preserving quoted tokens and
 * $(...) subshell substitutions as single tokens.
 * Quoted tokens have their outer quotes stripped and are marked quoted:true.
 * Glob chars inside quoted tokens are still preserved (git uses wildmatch).
 * $VAR and $(…) tokens are returned whole (isDynamic handles them).
 *
 * @param {string} str
 * @returns {Token[]}
 */
function tokenize(str) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    // skip whitespace
    while (i < n && /\s/.test(str[i])) i++;
    if (i >= n) break;

    const c = str[i];

    // Quoted token: strip outer quotes, mark as quoted
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let tok = '';
      while (i < n && str[i] !== quote) {
        if (str[i] === '\\' && quote === '"' && i + 1 < n) { i++; tok += str[i]; i++; }
        else { tok += str[i]; i++; }
      }
      if (i < n) i++; // consume closing quote
      tokens.push({ value: tok, quoted: true });
      continue;
    }

    // $(...) subshell: consume until matching closing paren as one token
    if (c === '$' && i + 1 < n && str[i + 1] === '(') {
      let tok = '$(';
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') { depth--; if (depth === 0) break; }
        tok += str[i]; i++;
      }
      tok += ')';
      if (i < n) i++; // consume ')'
      tokens.push({ value: tok, quoted: false });
      continue;
    }

    // Bare token: consume until whitespace
    let tok = '';
    while (i < n && !/\s/.test(str[i])) { tok += str[i]; i++; }
    tokens.push({ value: tok, quoted: false });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Token classification helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the token value is entirely composed of '.' and '/' chars.
 * Matches: '.', './', '..', '../', '../..', '../../../../', etc.
 * Does NOT match: '.gitignore', './src/file.js', '../sibling/file.js'
 */
function isAllDotsSlashes(value) {
  return value.length > 0 && /^[./]+$/.test(value);
}

/**
 * Check if a token value contains glob characters (* ? []).
 * Covers both unquoted and quoted tokens because git uses wildmatch.
 */
function hasGlobChars(value) {
  return /[*?[\]]/.test(value);
}

/**
 * Check if a token value looks like a shell variable or subshell expansion.
 * These cannot be resolved statically → fail-open as explicit.
 */
function isDynamic(value) {
  return /^\$/.test(value);
}

/**
 * Check if a token value is a pathspec magic string.
 * :/ (top of repo) and :(glob) are broad pathspecs.
 */
function isPathspecMagic(value) {
  return value === ':/' || /^:\((?:glob|top)\)/.test(value);
}

/**
 * Decompose a combined short flag string into individual flag chars.
 * E.g. '-uv' → ['-u', '-v'], '-An' → ['-A', '-n']
 * Returns null if not a combined short flag.
 */
function decomposeCombinedShortFlags(value) {
  if (/^-[a-zA-Z]{2,}$/.test(value)) {
    return value.slice(1).split('').map(c => `-${c}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Staging command classifier
// ---------------------------------------------------------------------------

/**
 * @typedef {'pass' | 'warn' | 'block'} Verdict
 *
 * @typedef {Object} StagingVerdict
 * @property {Verdict} verdict
 * @property {string} reason
 */

/**
 * Split a compound shell command (&&, ;, ||, |, newlines) into segments.
 * Each segment is a simple command candidate.
 *
 * Skips over quoted strings and $(...) subshells so that operators inside
 * them are not treated as compound separators. This prevents `$(git diff
 * --name-only)` from being split mid-substitution.
 */
function extractHeredocDelimiters(segment) {
  const delimiters = [];
  const re = /<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g;
  let match;
  while ((match = re.exec(segment)) !== null) {
    delimiters.push(match[1] || match[2] || match[3]);
  }
  return delimiters;
}

function consumeHeredocBodies(cmd, startIndex, delimiters) {
  let text = '';
  let i = startIndex;
  for (const delimiter of delimiters) {
    while (i < cmd.length) {
      let line = '';
      while (i < cmd.length && cmd[i] !== '\n') {
        line += cmd[i];
        i++;
      }
      if (i < cmd.length && cmd[i] === '\n') {
        line += '\n';
        i++;
      }
      text += line;
      if (line.replace(/\n$/, '').replace(/^\t+/, '') === delimiter) break;
    }
  }
  return { text, nextIndex: i };
}

function splitCompoundCommand(cmd) {
  const segments = [];
  let current = '';
  let i = 0;
  const n = cmd.length;

  while (i < n) {
    const c = cmd[i];

    // Single-quoted: consume until closing '
    if (c === "'") {
      current += c; i++;
      while (i < n && cmd[i] !== "'") { current += cmd[i]; i++; }
      if (i < n) { current += cmd[i]; i++; }
      continue;
    }

    // Double-quoted: consume until closing ", respecting backslash escapes
    if (c === '"') {
      current += c; i++;
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < n) { current += cmd[i] + cmd[i + 1]; i += 2; }
        else { current += cmd[i]; i++; }
      }
      if (i < n) { current += cmd[i]; i++; }
      continue;
    }

    // $(...): consume nested parens
    if (c === '$' && i + 1 < n && cmd[i + 1] === '(') {
      current += '$('; i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (cmd[i] === '(') depth++;
        else if (cmd[i] === ')') { depth--; if (depth === 0) break; }
        current += cmd[i]; i++;
      }
      if (i < n) { current += ')'; i++; }
      continue;
    }

    // Compound operators: &&, ||, ;, |, newline
    if (c === '&' && i + 1 < n && cmd[i + 1] === '&') {
      segments.push(current); current = ''; i += 2; continue;
    }
    if (c === '|' && i + 1 < n && cmd[i + 1] === '|') {
      segments.push(current); current = ''; i += 2; continue;
    }
    if (c === '\n') {
      const heredocDelimiters = extractHeredocDelimiters(current);
      if (heredocDelimiters.length > 0) {
        current += c;
        i++;
        const body = consumeHeredocBodies(cmd, i, heredocDelimiters);
        current += body.text;
        i = body.nextIndex;
        segments.push(current);
        current = '';
        continue;
      }
      segments.push(current); current = ''; i++; continue;
    }
    if (c === ';') {
      segments.push(current); current = ''; i++; continue;
    }
    // bare pipe (single |)
    if (c === '|') {
      segments.push(current); current = ''; i++; continue;
    }

    current += c; i++;
  }
  if (current.trim()) segments.push(current);

  return segments.map(s => s.trim()).filter(Boolean);
}

/**
 * Git global options that consume the next token as their value argument.
 * These are the value-taking global options (short or long form without '=').
 * E.g. `-C <path>`, `-c <k=v>`, `--git-dir <path>`, `--work-tree <path>`,
 * `--exec-path <path>`, `--super-prefix <prefix>`.
 */
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--exec-path', '--super-prefix',
  '--namespace', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
]);

/**
 * Parse the Token[] of a segment and locate the `add` (or `stage`) subcommand.
 * Handles: `git [global-opts] add [...]` including `-C <dir>`, `-c <k=v>`,
 * `--no-pager`, `--git-dir[=]...`, `--work-tree[=]...`, `--exec-path[=]...`,
 * `-p/--paginate`, `--`, and any sequence of git global option tokens.
 * Also accepts `git stage` as an alias of `git add`.
 * Returns the Token[] slice starting AFTER 'add'/'stage', or null if not a git-add/stage.
 *
 * @param {Token[]} tokens
 * @returns {Token[] | null}
 */
function extractAddArgs(tokens) {
  if (!tokens.length) return null;
  let i = 0;

  // Must start with 'git'
  if (tokens[i].value !== 'git') return null;
  i++;

  // Skip git global options (any sequence before the subcommand).
  // Two forms consume the next token as a value argument:
  //   -C <path>   -c <k=v>   --git-dir <path>   --work-tree <path>   etc.
  // Bare-value long options (--git-dir=<p>, --work-tree=<p>) stay as single tokens.
  // Stop when we find the subcommand token (no leading '-').
  while (i < tokens.length) {
    const v = tokens[i].value;
    // Bare '--' is a separator that ends global option parsing; stop here so
    // the subcommand search continues with the next token.
    if (v === '--') { i++; break; }
    // Non-option token: subcommand candidate — stop scanning global opts.
    if (!v.startsWith('-')) break;
    // Value-taking global option in split form: consume flag + next token.
    if (GIT_GLOBAL_VALUE_FLAGS.has(v)) {
      i++; // skip the flag
      if (i < tokens.length) i++; // skip its value token
      continue;
    }
    // All other option tokens (--no-pager, -p, --paginate, --git-dir=<p>, etc.):
    // single-token; consume and continue.
    i++;
  }

  // Must be followed by 'add' or 'stage' (mainline alias)
  if (i >= tokens.length) return null;
  const subcmd = tokens[i].value;
  if (subcmd !== 'add' && subcmd !== 'stage') return null;
  i++; // consume 'add'/'stage'

  return tokens.slice(i);
}

/**
 * Shell assignment prefixes (`FOO=1 git add .`) do not change the executable.
 *
 * @param {Token[]} tokens
 * @returns {Token[]}
 */
function unwrapAssignmentPrefix(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[i].value)) {
    i++;
  }
  return tokens.slice(i);
}

const ENV_VALUE_FLAGS = new Set(['-C', '--chdir', '-P', '--path']);
const ENV_NO_VALUE_FLAGS = new Set([
  '-i', '-', '-0', '--ignore-environment', '--null',
  '-v', '--debug', '--list-signal-handling',
]);

function laterGitAddTokens(tokens, startIndex) {
  for (let j = startIndex; j < tokens.length; j++) {
    if (tokens[j].value !== 'git') continue;
    const candidate = tokens.slice(j);
    if (extractAddArgs(candidate) !== null) return candidate;
  }
  return null;
}

/**
 * Return a token slice that starts at an executable git command when a command
 * uses simple environment prefixes such as `env FOO=1 git add .`.
 *
 * @param {Token[]} tokens
 * @returns {Token[] | null}
 */
function unwrapEnvPrefix(tokens) {
  if (!tokens.length || tokens[0].value !== 'env') return null;

  let i = 1;
  while (i < tokens.length) {
    const v = tokens[i].value;
    if (v === 'git') return tokens.slice(i);
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(v)) { i++; continue; }
    if (ENV_NO_VALUE_FLAGS.has(v)) { i++; continue; }
    if (v === '-u' || v === '--unset') { i += 2; continue; }
    if (ENV_VALUE_FLAGS.has(v)) { i += 2; continue; }
    if (v.startsWith('-u') && v.length > 2) { i++; continue; }
    if (v.startsWith('--unset=')) { i++; continue; }
    if (v.startsWith('--chdir=') || v.startsWith('--path=')) { i++; continue; }
    if (v === '-S' || v === '--split-string') {
      return tokens[i + 1] ? unwrapAssignmentPrefix(tokenize(tokens[i + 1].value)) : null;
    }
    if (v.startsWith('--split-string=')) {
      return unwrapAssignmentPrefix(tokenize(v.slice('--split-string='.length)));
    }
    if (v.startsWith('-')) {
      return laterGitAddTokens(tokens, i + 1);
    }
    return null;
  }
  return null;
}

/**
 * Normalize static executable prefixes before command classification.
 *
 * @param {Token[]} tokens
 * @returns {Token[]}
 */
function normalizeExecutableTokens(tokens) {
  const withoutAssignments = unwrapAssignmentPrefix(tokens);
  return unwrapEnvPrefix(withoutAssignments) || withoutAssignments;
}

/**
 * Extract the script passed to common shell wrappers when statically visible:
 * `bash -c 'git add .'`, `bash -lc "git add ."`, `sh -c ...`, `zsh -lc ...`.
 *
 * @param {Token[]} tokens
 * @returns {string | null}
 */
function extractShellWrapperScript(tokens) {
  const normalized = normalizeExecutableTokens(tokens);
  if (!normalized.length) return null;
  const executable = normalized[0].value.split('/').pop();
  if (!['bash', 'sh', 'zsh'].includes(executable)) return null;

  for (let i = 1; i < normalized.length; i++) {
    const v = normalized[i].value;
    if (v === '-c' || v === '-lc' || v === '-cl') {
      return normalized[i + 1]?.value || null;
    }
    if (/^-.*c.*$/.test(v) && !v.startsWith('--')) {
      return normalized[i + 1]?.value || null;
    }
    if (!v.startsWith('-')) return null;
  }
  return null;
}

/**
 * Core classification logic for the Token[] following `git [opts] add`.
 *
 * @param {Token[]} rawArgs
 * @returns {StagingVerdict}
 */
function classifyAddArgs(rawArgs) {
  let hasBroadFlag = false;       // -A, --all, -u found
  let hasInteractiveFlag = false; // -p, -i found
  let hasDryRunOnly = false;      // only -n and no broad/interactive
  let hasBroadToken = false;      // all-dots/slashes token found
  let hasGlob = false;            // glob chars found in any token
  let hasPathspecMagic = false;   // :/ or :(glob) found
  let hasAFlag = false;           // -A or --all specifically (conservative with paths)
  let seenPathArg = false;        // a non-flag path argument seen
  let seenDoubleDash = false;     // -- encountered
  let orderViolation = false;     // path token followed by option token
  let hasDryRunFlag = false;      // -n or --dry-run seen

  for (const tok of rawArgs) {
    const v = tok.value;

    if (!seenDoubleDash && v === '--') {
      seenDoubleDash = true;
      continue;
    }

    if (!seenDoubleDash && v.startsWith('-')) {
      // Option token
      if (seenPathArg) {
        // A path appeared before this option → order violation
        orderViolation = true;
      }

      // Long flags
      if (v === '--all') { hasBroadFlag = true; hasAFlag = true; continue; }
      if (v === '--patch') { hasInteractiveFlag = true; continue; }
      if (v === '--interactive') { hasInteractiveFlag = true; continue; }
      if (v === '--dry-run') { hasDryRunFlag = true; continue; }
      if (v === '--intent-to-add' || v === '--no-dry-run' || v.startsWith('--')) { continue; }

      // Short / combined short flags
      const decomposed = decomposeCombinedShortFlags(v);
      const flags = decomposed || [v];
      for (const f of flags) {
        if (f === '-A') { hasBroadFlag = true; hasAFlag = true; }
        else if (f === '-u') { hasBroadFlag = true; }
        else if (f === '-p') { hasInteractiveFlag = true; }
        else if (f === '-i') { hasInteractiveFlag = true; }
        else if (f === '-n') { hasDryRunFlag = true; }
        // -e, -f, -v, -N, etc. are safe/ignored
      }
      continue;
    }

    // After -- : option-form tokens are order violations (spec: option after --)
    if (seenDoubleDash && v.startsWith('-')) {
      orderViolation = true;
      continue;
    }

    // Staging target / pathspec
    const target = v;

    // Dynamic token → fail-open (treat as explicit, not broad)
    if (isDynamic(target)) {
      seenPathArg = true;
      continue;
    }

    // Pathspec magic
    if (isPathspecMagic(target)) {
      hasPathspecMagic = true;
      seenPathArg = true;
      continue;
    }

    // All-dots/slashes broad token
    if (isAllDotsSlashes(target)) {
      hasBroadToken = true;
      seenPathArg = true;
      continue;
    }

    // Glob chars (even in quoted tokens: git uses wildmatch)
    if (hasGlobChars(target)) {
      hasGlob = true;
      seenPathArg = true;
      continue;
    }

    // Explicit path token
    seenPathArg = true;
  }

  // --- Verdict resolution (order matters) ---

  // Interactive flags always block (hang risk in hook context)
  if (hasInteractiveFlag) {
    return {
      verdict: 'block',
      reason: 'git add -p/-i (--patch/--interactive) is blocked in hook context (interactive hang risk). ' +
              'Use explicit path staging: git add path1 path2 or /Qcommit.',
    };
  }

  // -n/--dry-run: no filesystem staging occurs → always safe regardless of broad tokens.
  // Interactive flags are already blocked above; -n takes precedence over broad-token checks.
  if (hasDryRunFlag) {
    return { verdict: 'pass', reason: 'git add -n/--dry-run is safe (no filesystem staging)' };
  }

  // -A / --all is broad even with a path limiter (conservative per spec)
  if (hasAFlag) {
    return {
      verdict: 'block',
      reason: 'git add -A/--all stages all tracked+untracked files (broad staging). ' +
              'Use explicit paths: git add path1 path2 or /Qcommit.',
    };
  }

  // -u is broad (updates all modified tracked files)
  if (hasBroadFlag) {
    return {
      verdict: 'block',
      reason: 'git add -u stages all modified tracked files (broad staging). ' +
              'Use explicit paths: git add path1 path2 or /Qcommit.',
    };
  }

  // Pathspec magic
  if (hasPathspecMagic) {
    return {
      verdict: 'block',
      reason: 'git add with pathspec magic (:/ or :(glob)) is broad staging. ' +
              'Use explicit paths: git add path1 path2 or /Qcommit.',
    };
  }

  // Glob chars → broad
  if (hasGlob) {
    return {
      verdict: 'block',
      reason: 'git add with glob pattern (*/?/[]) is broad staging. ' +
              'Use explicit paths: git add path1 path2 or /Qcommit.',
    };
  }

  // All-dots/slashes token (., ./, .., ../../ etc.)
  if (hasBroadToken) {
    return {
      verdict: 'block',
      reason: 'git add . / .. / ./ / ../../ stages everything in/above the directory (broad staging). ' +
              'Use explicit paths: git add path1 path2 or /Qcommit.',
    };
  }

  // Order violation → warn (determinism contract V10: always warn, never block)
  if (orderViolation) {
    return {
      verdict: 'warn',
      reason: 'git add argument order violation: option token appears after a path token, ' +
              'or option-form token after -- (R006 order-violation sub-clause). This may be a mistake.',
    };
  }

  return { verdict: 'pass', reason: 'explicit path staging' };
}

/**
 * Classify a `git add` command string and return a staging verdict.
 * Handles compound commands (&&, ;) and `git -C dir add` forms.
 *
 * @param {string} command - The full shell command string to classify.
 * @returns {StagingVerdict}
 */
export function classifyStagingCommand(command, depth = 0) {
  if (typeof command !== 'string') {
    return { verdict: 'pass', reason: 'not a string command' };
  }
  if (depth > MAX_WRAPPER_DEPTH) {
    return { verdict: 'pass', reason: 'wrapper nesting too deep; fail-open' };
  }

  // Split compound command into segments, classify each; return first non-pass
  // that contains a git-add invocation, or pass if none detected.
  const segments = splitCompoundCommand(command);

  /** @type {StagingVerdict} */
  let result = { verdict: 'pass', reason: 'no git-add detected in command' };

  for (const segment of segments) {
    const tokens = tokenize(segment);
    const addArgs = extractAddArgs(normalizeExecutableTokens(tokens));
    if (addArgs === null) continue;

    const v = classifyAddArgs(addArgs);
    // block > warn > pass — take the most severe across all segments
    if (v.verdict === 'block') return v;
    if (v.verdict === 'warn' && result.verdict === 'pass') result = v;
    if (v.verdict === 'pass' && result.verdict === 'pass') result = v;
  }

  for (const segment of segments) {
    const script = extractShellWrapperScript(tokenize(segment));
    if (!script) continue;
    const v = classifyStagingCommand(script, depth + 1);
    if (v.verdict === 'block') return v;
    if (v.verdict === 'warn' && result.verdict === 'pass') result = v;
  }

  return result;
}

// ---------------------------------------------------------------------------
// index.lock judgment (C3)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LockFacts
 * @property {boolean} exists                        - Whether .git/index.lock exists
 * @property {number|null} ageMs                     - Age in ms (null if cannot stat)
 * @property {'none'|'git'|'unknown'} ownerProcess   - Heuristic owning process
 */

/**
 * @typedef {Object} LockJudgment
 * @property {boolean} stale   - Whether the lock appears safe to remove
 * @property {string} reason   - Human-readable rationale
 */

/**
 * I/O-only: gather facts about the .git/index.lock file.
 * Never makes a judgment — that is judgeStaleLock's responsibility.
 *
 * @param {string} cwd - Repository working directory
 * @returns {LockFacts}
 */
export function gatherLockFacts(cwd) {
  const lockPath = join(cwd, '.git', 'index.lock');

  if (!existsSync(lockPath)) {
    return { exists: false, ageMs: null, ownerProcess: 'none' };
  }

  let ageMs = null;
  try {
    const mtime = statSync(lockPath).mtimeMs;
    const now = Date.now();
    // Future mtime (clock skew) → treat as age 0 (non-recovery per spec)
    ageMs = mtime > now ? 0 : now - mtime;
  } catch {
    // Cannot stat → conservative: null age → non-recovery
    ageMs = null;
  }

  // Check if a git process owns the lock via ps heuristic (darwin + linux).
  // Known residuals: libgit2 IDE processes and renamed processes → false-negative.
  let ownerProcess = 'unknown';
  try {
    const result = spawnSync('ps', ['-e', '-o', 'comm=,args='], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status === 0 && typeof result.stdout === 'string') {
      const hasGit = result.stdout.split('\n').some(line => {
        if (!line.trim()) return false;
        // comm is first whitespace-delimited field; args is the rest
        const spaceIdx = line.search(/\s/);
        const comm = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? '' : line.slice(spaceIdx);
        return comm.includes('git') || args.includes('git');
      });
      ownerProcess = hasGit ? 'git' : 'none';
    }
    // ps non-zero exit → stay 'unknown'
  } catch {
    ownerProcess = 'unknown';
  }

  return { exists: true, ageMs, ownerProcess };
}

/**
 * Pure judgment: given lock facts, decide if the lock is stale and safe to remove.
 *
 * Recovery requires ALL of:
 *   1. lock.exists === true
 *   2. ageMs >= LOCK_STALE_THRESHOLD_MS (120 000 ms)
 *   3. ownerProcess === 'none'
 *
 * Non-recovery: ownerProcess 'unknown', ageMs null or 0 (future mtime).
 *
 * @param {LockFacts} facts
 * @returns {LockJudgment}
 */
export function judgeStaleLock(facts) {
  if (!facts.exists) {
    return { stale: false, reason: 'index.lock does not exist' };
  }

  if (facts.ageMs === null) {
    return {
      stale: false,
      reason: 'cannot determine lock age (stat failed) — conservative non-recovery',
    };
  }

  if (facts.ageMs === 0) {
    return {
      stale: false,
      reason: 'lock mtime is in the future (clock skew) — treating age as 0, non-recovery',
    };
  }

  if (facts.ownerProcess === 'unknown') {
    return {
      stale: false,
      reason: 'cannot determine owning process (ps unavailable or failed) — conservative non-recovery',
    };
  }

  if (facts.ownerProcess === 'git') {
    return {
      stale: false,
      reason: 'a git process appears to own the lock — do not remove',
    };
  }

  if (facts.ageMs < LOCK_STALE_THRESHOLD_MS) {
    return {
      stale: false,
      reason: `lock age ${facts.ageMs}ms is below ${LOCK_STALE_THRESHOLD_MS}ms threshold — may still be in use`,
    };
  }

  // All conditions met: old enough, no owning process
  return {
    stale: true,
    reason: `lock is ${facts.ageMs}ms old (>= ${LOCK_STALE_THRESHOLD_MS}ms threshold) ` +
            `and no git process found — likely stale`,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

// Detect whether this file is the main script
const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const checkIdx = args.indexOf('--check');
  const lockCheckIdx = args.indexOf('--lock-check');

  if (lockCheckIdx !== -1) {
    // --lock-check [cwd]: run gatherLockFacts + judgeStaleLock, print facts + verdict, exit 0.
    const cwdArg = args[lockCheckIdx + 1] && !args[lockCheckIdx + 1].startsWith('-')
      ? args[lockCheckIdx + 1]
      : process.cwd();
    const facts = gatherLockFacts(cwdArg);
    const judgment = judgeStaleLock(facts);
    const verdict = !facts.exists ? 'no-lock' : (judgment.stale ? 'recoverable' : 'wait');
    process.stdout.write(
      `cwd: ${cwdArg}\n` +
      `exists: ${facts.exists}\n` +
      `ageMs: ${facts.ageMs}\n` +
      `ownerProcess: ${facts.ownerProcess}\n` +
      `stale: ${judgment.stale}\n` +
      `reason: ${judgment.reason}\n` +
      `verdict: ${verdict}\n`
    );
    process.exit(0);
  }

  if (checkIdx === -1 || checkIdx + 1 >= args.length) {
    process.stderr.write(
      'Usage: node hooks/scripts/lib/git-staging-guard.mjs --check "<command>"\n' +
      '       node hooks/scripts/lib/git-staging-guard.mjs --lock-check [cwd]\n' +
      '  --check: Prints verdict (pass|warn|block) and reason.\n' +
      '           Exits 0 for pass/warn, 1 for block, 2 for usage error.\n' +
      '  --lock-check: Prints lock facts + verdict (recoverable|wait|no-lock). Exits 0.\n'
    );
    process.exit(2);
  }

  const command = args[checkIdx + 1];
  const result = classifyStagingCommand(command);
  process.stdout.write(`verdict: ${result.verdict}\nreason: ${result.reason}\n`);
  process.exit(result.verdict === 'block' ? 1 : 0);
}
