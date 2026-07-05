#!/usr/bin/env node
'use strict';

import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hooksRoot = resolve(here, '..', '..');

/**
 * Emit a minimal continue:true response and exit cleanly.
 * Called on any unrecoverable error so the Codex session is never wedged.
 */
function failOpen() {
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  process.exit(0);
}

/**
 * Rewrite Claude-style slash-command references (e.g. `/Qfoo`) to the Codex
 * dollar-prefix form (`$Qfoo`) so they render correctly in Codex output.
 *
 * @param {string} text - Raw text that may contain `/Q…` or `/M…` tokens.
 * @returns {string} Text with slash-commands replaced by dollar-commands.
 */
function codexify(text) {
  if (!text) return text;
  return String(text)
    .replace(/(^|[\s([{`'"])(\/[QM][A-Za-z0-9_-]+)/g, (_m, lead, cmd) => `${lead}$${cmd.slice(1)}`)
    .replace(/`\/([QM][A-Za-z0-9_-]+)([^`]*)`/g, '`$$$1$2`');
}

/**
 * Recursively apply {@link codexify} to every string leaf in a JSON-compatible
 * value so that slash-command tokens are rewritten throughout a nested object
 * or array before it is serialised back to stdout.
 *
 * @param {unknown} value - Any JSON-compatible value (string, array, object, or primitive).
 * @returns {unknown} The same structure with all string leaves codexified.
 */
function codexifyJsonStrings(value) {
  if (typeof value === 'string') return codexify(value);
  if (Array.isArray(value)) return value.map(codexifyJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, codexifyJsonStrings(nested)]),
    );
  }
  return value;
}

/**
 * Normalise a hook script's raw stdout for Codex consumption.
 * Parses Claude-style JSON hook output, strips unsupported fields for
 * PreCompact events, and rewrites slash-command tokens via {@link codexifyJsonStrings}.
 * Falls back to plain codexify on non-JSON output.
 *
 * @param {string} stdout - Raw stdout captured from the delegated hook script.
 * @returns {string} Newline-terminated string ready to write to process.stdout.
 */
function renderCodexStdout(stdout) {
  if (!stdout) return '';

  try {
    const parsed = JSON.parse(stdout);

    // Codex PreCompact currently treats Claude-style hookSpecificOutput as an
    // invalid hook result. Keep the hook side effects and return a minimal pass.
    if (eventName === 'PreCompact') {
      return `${JSON.stringify({ continue: parsed.continue !== false })}\n`;
    }

    return `${JSON.stringify(codexifyJsonStrings(parsed))}\n`;
  } catch {
    return codexify(stdout);
  }
}

const [, , eventName = '', scriptRel = ''] = process.argv;
if (!eventName || !scriptRel || scriptRel.includes('..')) {
  failOpen();
}

const target = resolve(join(hooksRoot, scriptRel));
if (!target.startsWith(hooksRoot) || !existsSync(target)) {
  failOpen();
}

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  input = '';
}

let payload = input;
let hookCwd = process.cwd();
try {
  const parsed = input ? JSON.parse(input) : {};
  parsed.hook_event_name = parsed.hook_event_name || parsed.hookEventName || eventName;
  parsed.hookEventName = parsed.hookEventName || parsed.hook_event_name || eventName;
  parsed.client = parsed.client || 'codex';
  const toolInput = parsed.tool_input || parsed.toolInput || {};
  hookCwd = parsed.cwd || parsed.directory || toolInput.workdir || toolInput.cwd || hookCwd;
  parsed.cwd = parsed.cwd || hookCwd;
  const toolName = parsed.tool_name || parsed.toolName;
  if (eventName === 'PreToolUse' && ['Shell', 'shell', 'exec_command'].includes(toolName)) {
    parsed.tool_name = 'Bash';
    parsed.toolName = 'Bash';
  }
  payload = JSON.stringify(parsed);
} catch {
  // Keep the original payload. The target hook will fail-open if it cannot parse.
}

const result = spawnSync(process.execPath, [target], {
  input: payload,
  encoding: 'utf8',
  cwd: hookCwd,
  env: {
    ...process.env,
    QE_CLIENT: 'codex',
    QE_COMMAND_PREFIX: '$',
  },
});

if (result.stdout) process.stdout.write(renderCodexStdout(result.stdout));
if (result.stderr) process.stderr.write(codexify(result.stderr));

// --- Shadow snapshot trigger for Codex Write/Edit events (fail-safe, detached) ---
// Fires after the real hook result is forwarded so it never delays output.
// The child is fire-and-forget (detached: true + child.unref()), so the hook's
// own latency is unaffected by the snapshot's git runtime — the ≤500 ms hook
// budget is satisfied regardless of how long the child takes to complete.
// No separate timeout is needed; errors are silently discarded and must never
// wedge the Codex session.
// Stable path: hooks/scripts/codex/lifecycle-codex.mjs → ../../../scripts/qe-shadow.mjs
// The lib resolves the .qe store root from cwd at runtime.
try {
  const toolName = (() => {
    try { return (input ? JSON.parse(input) : {}).tool_name || ''; } catch { return ''; }
  })();
  if (['Write', 'Edit'].includes(toolName) && eventName === 'PostToolUse') {
    const shadowCli = resolve(here, '..', '..', '..', 'scripts', 'qe-shadow.mjs');
    if (existsSync(shadowCli)) {
      const sid = process.env.QE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
      const child = spawn(
        process.execPath,
        [shadowCli, 'snapshot', '--source', 'codex', ...(sid ? ['--sid', sid] : [])],
        { detached: true, stdio: 'ignore', cwd: hookCwd },
      );
      child.unref();
    }
  }
} catch {
  // fail-open: shadow trigger must never throw or slow the hook
}

process.exit(result.status ?? 0);
