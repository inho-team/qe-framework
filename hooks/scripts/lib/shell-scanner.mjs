'use strict';

/**
 * shell-scanner.mjs — zero-dependency Bash command region classifier.
 *
 * The PreToolUse override guards (git commit / gh pr create / plugin.json version
 * writes) used to run their block regexes against the RAW command string. That
 * mis-fired whenever a blocked phrase appeared inside DATA — a quoted string, a
 * heredoc body, or a comment (e.g. `codex exec "$(cat prompt-with-git-commit.txt)"`,
 * `cat <<EOF ... git commit ... EOF`, `echo "use gh pr create"`). It also let real
 * commits hide inside `bash -lc "git commit"`.
 *
 * This module separates EXECUTABLE regions from DATA regions so the guards only
 * match real command invocations. It deliberately does NOT pull in a full shell
 * parser (zero-dependency constraint); it is a hand-rolled state machine that errs
 * CONSERVATIVE — when a region is ambiguous it is kept executable, so the guard
 * never under-blocks a genuine destructive command.
 *
 * Two exports:
 *   - executableView(cmd): the command with DATA regions blanked to spaces and
 *     EXECUTABLE regions (top-level, `$(...)`, backticks, shell-owned heredocs)
 *     preserved. Run block regexes against this.
 *   - shellDashCArgs(cmd): the string arguments handed to a shell interpreter via
 *     `-c`/`-lc` (and `eval`), which are executable code even though they are quoted.
 *     Run block regexes against each, too.
 *
 * Reference: ADR-025 Phase 1 (qe-diet), R2. Pinned policy + oracle matrix live in
 * .qe/tasks/.../TASK_REQUEST_38196d9f.md and scripts/check-hook-falsepositive.mjs.
 */

// Command words whose heredoc body / -c argument is executable shell code.
const SHELL_OWNERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ssh']);

// Recursion / size caps. A scanner that THROWS on adversarial input (e.g. ~8000
// nested `$(` overflowing the stack) would, via the hook's global fail-open
// handler, SILENTLY ALLOW a destructive command — a real guard bypass. So the
// scanner must never throw and must fail CLOSED: past these caps it stops
// blanking and keeps the remaining text executable (conservative → the block
// regex still sees any real `git commit` and the guard fires). See the
// fail-closed wrappers in executableView() / matchesExecutable().
const MAX_DEPTH = 50;          // max `$(`/backtick nesting before we stop recursing
const MAX_INPUT = 100000;      // commands longer than this skip parsing (treated raw)

/**
 * Blank a string to spaces of the same length (preserves offsets so anchored
 * regexes still see the right separators around kept regions).
 */
function blanks(str) {
  return ' '.repeat(str.length);
}

/**
 * Pass 1 — heredocs. A heredoc body owned by a non-shell command (`cat`, `tee`,
 * a redirect target) is DATA and gets blanked; a body owned by a shell interpreter
 * (`bash`/`sh`/`ssh` …) is executable and kept verbatim. Handles `<<`, `<<-`
 * (tab-stripped delimiter line), and quoted delimiters (`<<'EOF'`).
 */
function stripHeredocs(s) {
  const lines = s.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    i++;
    const hd = [...line.matchAll(/<<-?\s*(["'`]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)];
    if (hd.length === 0) continue;
    // Owner = first bare word of the line (basename, so /bin/bash → bash).
    const ownerMatch = line.match(/^\s*([^\s|;&()<>]+)/);
    const owner = ownerMatch ? ownerMatch[1].split('/').pop() : '';
    const isShell = SHELL_OWNERS.has(owner);
    for (const m of hd) {
      const delim = m[2];
      const dashStrip = m[0].startsWith('<<-');
      while (i < lines.length) {
        const bodyLine = lines[i];
        const trimmed = dashStrip ? bodyLine.replace(/^\t+/, '') : bodyLine;
        if (trimmed === delim) { out.push(bodyLine); i++; break; }
        out.push(isShell ? bodyLine : blanks(bodyLine));
        i++;
      }
    }
  }
  return out.join('\n');
}

/**
 * Pass 2 — quotes / comments / substitutions. Recursive: `$(...)` and backticks
 * are executable (their contents are re-scanned and kept); single quotes, ANSI-C
 * `$'...'`, double-quote text, and `#` comments are DATA (blanked). `$(...)` and
 * backticks INSIDE double quotes stay executable (real command substitution).
 */
function blankData(s, depth = 0) {
  // Depth cap: stop recursing into nested substitutions and keep the rest
  // verbatim (executable) so a real command buried in pathological nesting is
  // still seen by the block regex. Prevents stack overflow → fail-open bypass.
  if (depth >= MAX_DEPTH) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];

    // Comment: '#' at a command-word boundary (start, or after whitespace/separator).
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) {
      while (i < n && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }

    // ANSI-C quote $'...' — data (with backslash escapes).
    if (c === '$' && s[i + 1] === "'") {
      out += '  '; i += 2;
      while (i < n && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < n) { out += '  '; i += 2; continue; }
        out += ' '; i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }

    // Command substitution $(...) — executable, may nest.
    if (c === '$' && s[i + 1] === '(') {
      out += '$('; i += 2;
      let depth = 1, inner = '';
      while (i < n && depth > 0) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0) break; }
        inner += s[i]; i++;
      }
      out += blankData(inner, depth + 1);
      if (i < n) { out += ')'; i++; }
      continue;
    }

    // Backtick substitution — executable.
    if (c === '`') {
      out += '`'; i++;
      let inner = '';
      while (i < n && s[i] !== '`') { inner += s[i]; i++; }
      out += blankData(inner, depth + 1);
      if (i < n) { out += '`'; i++; }
      continue;
    }

    // Single quote — data, no expansion.
    if (c === "'") {
      out += ' '; i++;
      while (i < n && s[i] !== "'") { out += ' '; i++; }
      if (i < n) { out += ' '; i++; }
      continue;
    }

    // Double quote — data, but $(...) and backticks inside remain executable.
    if (c === '"') {
      out += ' '; i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n) { out += '  '; i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '(') {
          out += '$('; i += 2;
          let depth = 1, inner = '';
          while (i < n && depth > 0) {
            if (s[i] === '(') depth++;
            else if (s[i] === ')') { depth--; if (depth === 0) break; }
            inner += s[i]; i++;
          }
          out += blankData(inner, depth + 1);
          if (i < n) { out += ')'; i++; }
          continue;
        }
        if (s[i] === '`') {
          out += '`'; i++;
          let inner = '';
          while (i < n && s[i] !== '`') { inner += s[i]; i++; }
          out += blankData(inner, depth + 1);
          if (i < n) { out += '`'; i++; }
          continue;
        }
        out += ' '; i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }

    out += c; i++;
  }
  return out;
}

/**
 * Return the command with DATA regions blanked and EXECUTABLE regions preserved.
 * Folds backslash-newline line continuations and normalizes CRLF first so a
 * token split across a continuation (`git \<newline>commit`) is seen as one
 * command and a trailing `\r` never breaks delimiter matching.
 */
export function executableView(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) return '';
  // Fail-closed: oversized or unparseable input falls back to the RAW command.
  // Raw means a quoted/heredoc mention could re-trigger a false positive (the old
  // over-blocking behavior) — annoying but SAFE; it can never UNDER-block a real
  // destructive command, which is the only outcome that matters for a guard.
  if (cmd.length > MAX_INPUT) return cmd;
  try {
    // Normalize CRLF, then fold `\<newline>` continuations into a single space.
    const folded = cmd.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\\n/g, ' ');
    return blankData(stripHeredocs(folded));
  } catch {
    return cmd;
  }
}

/**
 * Extract the code strings passed to a shell interpreter via `-c`/`-lc`/`-ec` (or
 * `eval`). These are executable even though they are quoted, so the guard must
 * test them too — this is what closes the `bash -lc "git commit"` bypass.
 * Returns raw arg strings (caller should pass each through executableView again).
 */
export function shellDashCArgs(cmd) {
  if (typeof cmd !== 'string' || !cmd) return [];
  const args = [];
  // bash/sh/zsh… -c "..." | -lc '...' , and eval "..."  (single- or double-quoted)
  const reQuoted = /(?:\b(?:bash|sh|zsh|dash|ksh)\b[^\n|;&]*?\s-[a-zA-Z]*c[a-zA-Z]*\s+|\beval\s+)(['"])([\s\S]*?)\1/g;
  let m;
  while ((m = reQuoted.exec(cmd)) !== null) args.push(m[2]);
  // ANSI-C form: bash -c $'...'
  const reAnsiC = /\b(?:bash|sh|zsh|dash|ksh)\b[^\n|;&]*?\s-[a-zA-Z]*c[a-zA-Z]*\s+\$'([\s\S]*?)'/g;
  while ((m = reAnsiC.exec(cmd)) !== null) args.push(m[1]);
  return args;
}

/**
 * Collapse shell token-splitting obfuscation in an already-viewed (data-blanked)
 * EXECUTABLE region so a guard regex sees the word the shell will actually run.
 * Applied only to the executable view — DATA regions are already blanked, so a
 * `${IFS}` or backslash inside a quoted string is never touched.
 *   - `${IFS}` and any slice/variant `${IFS:0:1}`, `${IFS: -1}`, `${IFS#x}` …
 *     → a single space (every `${IFS…}` expansion yields whitespace), so
 *     `git${IFS}commit` and `git${IFS:0:1}commit` normalize to `git commit`.
 *   - bare `$IFS` (not followed by a word char) → a single space.
 *   - a backslash before a word character → removed, so `g\it commit`
 *     (which the shell reads as `git commit`) normalizes the same way.
 * Conservative by construction: it only ever joins/normalizes tokens the shell
 * itself would, so it cannot invent a match that would not really execute.
 *
 * Known residual (out of scope, tracked as spec 5b7591e7 unverified-assumption):
 * empty-quote token splicing that fuses a word the shell rejoins — `g""it commit`,
 * `git "commit"` — is a limitation of executableView's data-blank model (quotes
 * blank to spaces), not of this normalizer, and is not closed here.
 */
function deobfuscateShellTokens(view) {
  return view
    .replace(/\$\{IFS[^}]*\}/g, ' ')
    .replace(/\$IFS(?![A-Za-z0-9_])/g, ' ')
    .replace(/\\(?=[A-Za-z])/g, '');
}

/**
 * Convenience: does `re` match a real EXECUTABLE region of `cmd`? Tests the
 * executable view AND every shell `-c`/`eval` argument (re-viewed), each also in
 * its de-obfuscated form so token-split evasion (`git${IFS}commit`, `g\it`) is
 * caught. This is the single predicate the override guards should call.
 */
export function matchesExecutable(cmd, re) {
  try {
    const view = executableView(cmd);
    // Reset lastIndex defensively in case a /g regex is passed.
    re.lastIndex = 0;
    if (re.test(view)) return true;
    const normView = deobfuscateShellTokens(view);
    if (normView !== view) {
      re.lastIndex = 0;
      if (re.test(normView)) return true;
    }
    for (const arg of shellDashCArgs(cmd)) {
      const argView = executableView(arg);
      re.lastIndex = 0;
      if (re.test(argView)) return true;
      const normArg = deobfuscateShellTokens(argView);
      if (normArg !== argView) {
        re.lastIndex = 0;
        if (re.test(normArg)) return true;
      }
    }
    return false;
  } catch {
    // Fail CLOSED: any unexpected scanner error must NOT silently allow a guarded
    // command. Returning true makes the guard fire (the user still has the
    // documented skill-bypass escape hatch). A guard that crashes-open is worse
    // than one that over-blocks.
    return true;
  }
}
