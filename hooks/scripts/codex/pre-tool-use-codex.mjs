#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { emitBlock } from '../lib/block-emitter.mjs';
import { executableView, matchesExecutable } from '../lib/shell-scanner.mjs';

const RELEASE_VERSION_CAPABILITY = 'qe-release-version';
const RELEASE_VERSION_ACTION = 'Use $Qrelease instead.';

function failOpen() {
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  process.exit(0);
}

process.on('uncaughtException', failOpen);
process.on('unhandledRejection', failOpen);

function isShellTool(toolName) {
  return ['Bash', 'Shell', 'shell', 'exec_command'].includes(toolName);
}

let input = '';
try {
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

const toolName = data.tool_name || data.toolName || '';
if (!isShellTool(toolName)) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const toolInput = data.tool_input || data.toolInput || {};
const cmd = toolInput.command || '';
if (typeof cmd !== 'string' || cmd.length === 0) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || toolInput.workdir || toolInput.cwd || process.cwd();
let bypassSkill = null;
try {
  const bypassFile = join(cwd, '.qe', 'state', 'skill-bypass.json');
  if (existsSync(bypassFile)) {
    const bypass = JSON.parse(readFileSync(bypassFile, 'utf8'));
    const ts = bypass.ts || statSync(bypassFile).mtimeMs;
    if (bypass && bypass.active && (Date.now() - ts) < 120000) {
      bypassSkill = bypass.skill || null;
    }
  }
} catch {
  bypassSkill = null;
}

function isBypassed(skill) {
  return bypassSkill === skill || (skill === 'Qcommit' && bypassSkill === RELEASE_VERSION_CAPABILITY);
}

const view = executableView(cmd);

// Same normal-mode Bash hard-block predicates as hooks/scripts/pre-tool-use.mjs.
if (matchesExecutable(cmd, /(?:^|[;&|(\n`])\s*git\s+commit(?![-\w])/)) {
  if (isBypassed('Qcommit')) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  emitBlock({
    skill: 'Qcommit',
    reason: 'Raw git commit is blocked. Use $Qcommit instead.',
    action: 'Use $Qcommit instead',
    bypass: 'skill-bypass.json with skill:"Qcommit"',
  });
}

const writesPluginJson =
  /(?:>>?|\btee\b(?:\s+-a)?\s+|\bdd\b[^|;&]*\bof=)\s*[^\s;|&]*plugin\.json/.test(view);
if (writesPluginJson && /version/.test(cmd)) {
  if (isBypassed(RELEASE_VERSION_CAPABILITY)) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  emitBlock({
    skill: RELEASE_VERSION_CAPABILITY,
    reason: `Direct version editing is blocked. ${RELEASE_VERSION_ACTION}`,
    action: RELEASE_VERSION_ACTION,
    bypass: `skill-bypass.json with skill:"${RELEASE_VERSION_CAPABILITY}"`,
  });
}

if (matchesExecutable(cmd, /\b(?:sed|perl|ruby)\s+(?:-[a-zA-Z]*i|--in-place)\b/)) {
  if (isBypassed('_edit_tool')) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  emitBlock({
    skill: '_edit_tool',
    reason: 'In-place edit (sed/perl/ruby -i) is blocked. Use the Edit tool instead.',
    action: 'Use the Edit tool instead',
    bypass: 'skill-bypass.json with skill:"_edit_tool"',
  });
}

console.log(JSON.stringify({ continue: true }));
