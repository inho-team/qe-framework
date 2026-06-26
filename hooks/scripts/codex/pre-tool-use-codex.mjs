#!/usr/bin/env node
'use strict';

import { readFileSync } from 'fs';
import { emitBlock } from '../lib/block-emitter.mjs';
import { executableView, matchesExecutable } from '../lib/shell-scanner.mjs';

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

const view = executableView(cmd);

// Same normal-mode Bash hard-block predicates as hooks/scripts/pre-tool-use.mjs.
if (matchesExecutable(cmd, /(?:^|[;&|(\n`])\s*git\s+commit(?![-\w])/)) {
  emitBlock({
    skill: 'Qcommit',
    reason: 'Raw git commit is blocked. Use /Qcommit instead.',
    action: 'Use /Qcommit instead',
    bypass: 'skill-bypass.json with skill:"Qcommit"',
  });
}

if (matchesExecutable(cmd, /\bgh\s+pr\s+create\b/)) {
  emitBlock({
    skill: 'Qbranch',
    reason: 'Raw gh pr create is blocked. Use /Qbranch instead.',
    action: 'Use /Qbranch instead',
    bypass: 'skill-bypass.json with skill:"Qbranch"',
  });
}

const writesPluginJson =
  /(?:>>?|\btee\b(?:\s+-a)?\s+|\bdd\b[^|;&]*\bof=)\s*[^\s;|&]*plugin\.json/.test(view);
if (writesPluginJson && /version/.test(cmd)) {
  emitBlock({
    skill: 'Mbump',
    reason: 'Direct version editing is blocked. Use /Mbump instead.',
    action: 'Use /Mbump instead',
    bypass: 'skill-bypass.json with skill:"Mbump"',
  });
}

if (matchesExecutable(cmd, /\b(?:sed|perl|ruby)\s+(?:-[a-zA-Z]*i|--in-place)\b/)) {
  emitBlock({
    skill: '_edit_tool',
    reason: 'In-place edit (sed/perl/ruby -i) is blocked. Use the Edit tool instead.',
    action: 'Use the Edit tool instead',
    bypass: 'skill-bypass.json with skill:"_edit_tool"',
  });
}

console.log(JSON.stringify({ continue: true }));
