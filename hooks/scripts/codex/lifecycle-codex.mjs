#!/usr/bin/env node
'use strict';

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hooksRoot = resolve(here, '..', '..');

function failOpen() {
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  process.exit(0);
}

function codexify(text) {
  if (!text) return text;
  return String(text)
    .replace(/(^|[\s([{`'"])(\/[QM][A-Za-z0-9_-]+)/g, (_m, lead, cmd) => `${lead}$${cmd.slice(1)}`)
    .replace(/`\/([QM][A-Za-z0-9_-]+)([^`]*)`/g, '`$$$1$2`');
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

if (result.stdout) process.stdout.write(codexify(result.stdout));
if (result.stderr) process.stderr.write(codexify(result.stderr));
process.exit(result.status ?? 0);
