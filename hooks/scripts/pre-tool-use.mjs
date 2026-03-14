#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
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

const cwd = data.cwd || data.directory || process.cwd();
const toolName = data.tool_name || data.toolName || '';
const hints = [];

// If .qe/analysis/ exists, remind to use it instead of scanning
const analysisDir = join(cwd, '.qe', 'analysis');
if (existsSync(analysisDir)) {
  // Only remind for exploration tools
  if (['Glob', 'Grep', 'Read'].includes(toolName)) {
    // Check if this might be a project exploration (not a specific file read)
    const toolInput = data.tool_input || data.toolInput || {};
    const pattern = toolInput.pattern || toolInput.path || '';

    // Only hint when doing broad exploration, not specific file reads
    if (toolName === 'Glob' && (pattern.includes('**') || pattern.includes('*/'))) {
      hints.push('Check .qe/analysis/ files first to save tokens.');
    }
  }
}

// Remind about .qe/ auto-permission
if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (filePath.includes('.qe/') || filePath.includes('.qe\\')) {
    hints.push('Files in .qe/ can be auto-executed without user confirmation.');
  }
}

// Preemptive compaction warning based on tool call count
const statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
if (existsSync(statsFile)) {
  try {
    const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
    const callCount = stats.tool_calls || 0;
    if (callCount > 200) {
      hints.push('Context pressure warning: 200+ tool calls. Consider running /Qcompact.');
    } else if (callCount > 150) {
      hints.push('High context usage: prioritize .qe/analysis/ files to save tokens.');
    }
  } catch {}
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `[QE] ${hints.join(' ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
