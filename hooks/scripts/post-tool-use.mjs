#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { readUnifiedState, writeUnifiedState, updateContextMemo, markMemoModified, getCwd } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { checkComments, isCheckableFile } from './lib/comment-checker.mjs';
import { runLint, isLintableFile } from './lib/lint-runner.mjs';
import { deriveBuildLockMetadata, isHeavyBuildCommand, releaseBuildLock } from './lib/build-admission.mjs';

// --- Fail-open safety net ---
// A PostToolUse error must never wedge the session. PostToolUse only emits soft hints
// (continue:true), so failing open means simply allowing the flow to proceed.
function failOpen() {
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  process.exit(0);
}
process.on('uncaughtException', failOpen);
process.on('unhandledRejection', failOpen);

/**
 * True for files where a security-keyword hint is meaningful: source code
 * (isCheckableFile) plus shell/IaC/secret-bearing configs that handle credentials
 * without a literal value. Deliberately excludes docs (.md/.txt) and data (.json)
 * so a plan or checklist mentioning "secret"/"token" never forces a security review.
 */
function isSecuritySensitiveFile(filePath) {
  if (!filePath) return false;
  if (isCheckableFile(filePath)) return true;
  return /(?:\.sh|\.bash|\.zsh|\.ya?ml|\.tf|\.env|\.sql)$/i.test(filePath) ||
         /(?:^|\/)Dockerfile(?:\.[\w-]+)?$/.test(filePath);
}

let input = '';
try {
  // Read fd 0 directly (portable across macOS and Linux CI); `/dev/stdin` can read
  // empty when stdin is a pipe on some Linux runners.
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Honor the payload's project dir (like pre-tool-use / stop-handler / session-start);
// getCwd() ignores its argument and returns process.cwd(), so relying on it alone
// made post-tool-use read/write state in a different dir than pre-tool-use when the
// payload carried an explicit cwd/workdir.
const cwd = data.cwd || data.directory || getCwd(data);
const cfg = loadConfig(cwd);
const toolName = data.tool_name || data.toolName || '';
const isError = data.tool_response?.includes?.('error') ||
                data.tool_response?.includes?.('Error') ||
                data.tool_response?.includes?.('FAILED') ||
                (data.exit_code !== undefined && data.exit_code !== 0);

const hints = [];

// --- Load Unified State ---
const state = readUnifiedState(cwd);

// --- Build Admission Release (Bash only) ---
// PreToolUse acquires the machine-global build lock only for executable heavy
// build commands. PostToolUse releases it for the same command/session metadata,
// regardless of success or failure; light Bash commands cannot release locks.
if (toolName === 'Bash') {
  try {
    // Derive lock metadata via the shared helper so the ownerId computed here
    // matches the one from pre-tool-use acquire; otherwise release fails as
    // not-owner and the machine-global lock strands until max-age.
    const meta = deriveBuildLockMetadata(data);
    if (isHeavyBuildCommand(meta.command)) {
      releaseBuildLock(meta);
    }
  } catch {
    // fail-open: release failures fall back to stale reaping/max-age.
  }
}

// --- ContextMemo Maintenance ---
if (!isError && toolName === 'Read') {
  const toolInput = data.tool_input || data.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';
  // Only cache FULL reads. A partial read (offset/limit) returns a slice of the
  // file; caching it under the plain path key would let a later full read be
  // MEMO-blocked and served incomplete content. Partial reads are left uncached
  // (and, symmetrically, un-blocked in pre-tool-use).
  const isPartialRead =
    toolInput.offset !== undefined || toolInput.limit !== undefined;
  if (filePath && data.tool_response != null && !isPartialRead) {
    const resp = data.tool_response;
    const contentStr = typeof resp === 'string' ? resp : String(resp);
    updateContextMemo(state, filePath, contentStr);
  }
} else if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (filePath) {
    // Mark as modified so pre-tool-use allows re-read of the updated file
    markMemoModified(state, filePath);

    // --- Shadow snapshot trigger (fail-safe, detached) ---
    // Spawns qe-shadow.mjs as a detached child (detached: true + child.unref()).
    // Because the child is fire-and-forget, the hook itself returns immediately
    // regardless of how long the snapshot's git operations take — the ≤500 ms
    // hook latency budget is unaffected by the child's runtime. No separate
    // timeout is needed here; slow or failing git runs are silently discarded.
    // Stable path: hooks/scripts/post-tool-use.mjs → ../../scripts/qe-shadow.mjs
    // The lib resolves the .qe store root from cwd at runtime, so no wrapper
    // path wiring is needed here.
    try {
      const hooksDir = dirname(fileURLToPath(import.meta.url));
      const shadowCli = resolve(hooksDir, '..', '..', 'scripts', 'qe-shadow.mjs');
      if (existsSync(shadowCli)) {
        const source = toolName.toLowerCase(); // 'write' or 'edit'
        const sid = process.env.QE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
        const child = spawn(
          process.execPath,
          [shadowCli, 'snapshot', '--source', source, ...(sid ? ['--sid', sid] : [])],
          { detached: true, stdio: 'ignore', cwd: cwd || process.cwd() },
        );
        child.unref();
      }
    } catch {
      // fail-open: shadow trigger must never throw or slow the hook
    }
  }
}

// --- Real-time Token Tracking ---
if (!state.session_stats) {
  state.session_stats = { tool_calls: 0, session_start: Date.now(), context_loaded: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 } };
}
const stats = state.session_stats;
if (!stats.usage) {
  stats.usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
}

// Extract usage from Claude Code payload
const usage = data.usage || data.metadata?.usage || {};
if (Object.keys(usage).length > 0) {
  stats.usage.input_tokens += usage.input_tokens || 0;
  stats.usage.output_tokens += usage.output_tokens || 0;
  stats.usage.cache_read_tokens += usage.cache_read_input_tokens || 0;
  stats.usage.cache_creation_tokens += usage.cache_creation_input_tokens || 0;
} else {
  // Fallback: estimate tokens by payload size (chars / 4) when no real usage
  // is attached (the common case — usage rides the assistant message, not the
  // tool result). Direction matters and was previously inverted:
  //   - tool_input  = the tool call the MODEL PRODUCED  → counts as output.
  //   - tool_response = content RETURNED TO THE MODEL as next-turn context
  //                     → counts as input, NOT output.
  // The old mapping charged large tool_response bodies (file reads, Bash output)
  // to output_tokens, which is what produced the output≈5×input inversion. It
  // also becomes critical once Read is wired into this hook's matcher, since a
  // Read's whole file body arrives as tool_response.
  // Coerce structured tool_response via JSON so an object is not flattened to the
  // 15-char "[object Object]" (undercount).
  const toolInputStr = JSON.stringify(data.tool_input || {});
  const resp = data.tool_response;
  const toolResponseStr = typeof resp === 'string' ? resp : (resp == null ? '' : JSON.stringify(resp));
  const producedTokens = Math.ceil(toolInputStr.length / 4);   // model-produced call → output
  const returnedTokens = Math.ceil(toolResponseStr.length / 4); // returned to model → input
  stats.usage.output_tokens += producedTokens;
  stats.usage.input_tokens += returnedTokens;
}

// --- Error tracking ---
if (isError) {
  if (!state.tool_errors) {
    state.tool_errors = { errors: [], window_start: Date.now() };
  }
  const errorState = state.tool_errors;

  // Reset window if older than configured threshold
  if (Date.now() - errorState.window_start > cfg.error_window_ms) {
    errorState.errors = [];
    errorState.window_start = Date.now();
  }

  errorState.errors.push({
    tool: toolName,
    timestamp: Date.now(),
    preview: String(data.tool_response || '').slice(0, 200)
  });

  const recentCount = errorState.errors.filter(e => e.tool === toolName).length;

  if (recentCount >= cfg.error_delegate_count) {
    hints.push(`${toolName} tool failed ${recentCount}+ times in error window. Delegate to Ecode-debugger agent for root cause analysis, or try a completely different approach.`);
  } else if (recentCount >= cfg.error_escalate_count) {
    hints.push(`${toolName} tool failed ${recentCount} times in error window. Consider using /Qsystematic-debugging to find the root cause before retrying.`);
  }
} else if (state.tool_errors) {
  // Success - clear error tracking for this tool
  const errorState = state.tool_errors;
  const filtered = errorState.errors.filter(e => e.tool !== toolName);
  if (filtered.length !== errorState.errors.length) {
    errorState.errors = filtered;
  }
}

// --- Quality Check Hints (Write/Edit only — matcher ensures this) ---
if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';

  if (filePath) {
    if (/\.tsx?$/.test(filePath)) {
      hints.push('Consider running type check after TypeScript changes.');
    }
    if (/\.(test|spec)\./.test(filePath)) {
      hints.push('Test file modified. Run tests to verify.');
    }
    if (/\.(css|scss|sass|less)$/.test(filePath)) {
      hints.push('Style file changed. Check for visual regression.');
    }

    // Agentation hint for .tsx files (once per session)
    if (/\.tsx$/.test(filePath) && !isError) {
      if (!state.session_stats) {
        state.session_stats = { tool_calls: 0, session_start: Date.now(), context_loaded: [] };
      }
      const s = state.session_stats;

      if (!s._agentation_hinted) {
        hints.push('Frontend file modified. Use /Qagentation or /Qvisual-qa for visual verification.');
        s._agentation_hinted = true;
      }
    }
  }

  // Security keyword hint — security-sensitive files only. Docs/markdown/json/txt that
  // merely contain a word like "secret"/"token" (a plan, checklist, or README) must not
  // trigger a mandatory review. The set is source code (isCheckableFile) PLUS shell/IaC
  // files that handle secrets without a literal credential (.sh, .yaml, .tf, .env,
  // Dockerfile) — those are decoupled from the comment-coverage set on purpose.
  const secContent = toolInput.new_string || toolInput.content || '';
  if (secContent && isSecuritySensitiveFile(filePath) && /\b(auth|jwt|password|secret|token|credential|bcrypt|encrypt|decrypt|api_key|private_key|ssh|certificate)\b/i.test(secContent)) {
    hints.push('MANDATORY SECURITY REVIEW: Security-sensitive code detected (auth/crypto/secrets). You MUST invoke Esecurity-officer agent before completing this task. Do NOT skip this step.');
  }

  // --- Comment Coverage Check ---
  if (filePath && isCheckableFile(filePath)) {
    try {
      // Read the file content that was just written/edited
      const fileContent = readFileSync(filePath, 'utf-8');
      const result = checkComments(filePath, fileContent);

      if (result.missing.length > 0) {
        const missingList = result.missing.slice(0, 3).map(m =>
          `${m.type} "${m.name}" (line ${m.line})`
        ).join(', ');
        const moreCount = result.missing.length > 3 ? ` (+${result.missing.length - 3} more)` : '';
        hints.push(
          `[Comment] ${result.missing.length} undocumented public ${result.missing.length === 1 ? 'item' : 'items'}: ${missingList}${moreCount}. ` +
          `Coverage: ${result.coverage}%. Add ${result.language} standard documentation comments. ` +
          `See: skills/coding-experts/references/comment-formats.md`
        );
      }
    } catch {
      // Fault tolerance — never let comment checker crash the hook
    }
  }

  // --- Lint Quality Gate ---
  if (filePath && isLintableFile(filePath)) {
    try {
      const lintResult = runLint(filePath, cwd, { autoFix: true, maxRetries: 2, timeout: 3000 });

      if (lintResult.skipped) {
        // No lint config found — silent skip
      } else if (lintResult.passed) {
        if (lintResult.fixed) {
          hints.push(`[Lint] Auto-fixed lint issues in ${filePath.split('/').pop()} using ${lintResult.tool}.`);
        }
        // Clean pass — no hint needed
      } else {
        // Lint failed after retries
        const errorPreview = (lintResult.errors || []).slice(0, 3).join('; ');
        const moreCount = (lintResult.errors || []).length > 3 ? ` (+${lintResult.errors.length - 3} more)` : '';
        hints.push(
          `[Lint] FAILED after ${lintResult.attempts || 1} attempt(s) with ${lintResult.tool}: ${errorPreview}${moreCount}. Fix the lint errors before proceeding.`
        );
      }
    } catch {
      // Fault tolerance — never let lint runner crash the hook
    }
  }
}

// --- Final Unified State Write ---
try {
  writeUnifiedState(cwd, state);
} catch {}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `[QE] ${hints.join(' ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
