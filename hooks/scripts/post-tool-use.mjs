#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJson, getCwd } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';

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

const cwd = getCwd(data);
const cfg = loadConfig(cwd);
const toolName = data.tool_name || data.toolName || '';
const isError = data.tool_response?.includes?.('error') ||
                data.tool_response?.includes?.('Error') ||
                data.tool_response?.includes?.('FAILED') ||
                (data.exit_code !== undefined && data.exit_code !== 0);

const hints = [];

// --- Error tracking (only reads/writes on actual errors or to clear on success) ---
const errorFile = join(cwd, '.qe', 'state', 'tool-errors.json');

if (isError) {
  let errorState = { errors: [], window_start: Date.now() };

  if (existsSync(errorFile)) {
    try {
      errorState = JSON.parse(readFileSync(errorFile, 'utf8'));
    } catch {}
  }

  // Reset window if older than configured threshold
  if (Date.now() - errorState.window_start > cfg.error_window_ms) {
    errorState = { errors: [], window_start: Date.now() };
  }

  errorState.errors.push({
    tool: toolName,
    timestamp: Date.now(),
    preview: String(data.tool_response || '').slice(0, 200)
  });

  try {
    atomicWriteJson(errorFile, errorState);
  } catch {}

  const recentCount = errorState.errors.filter(e => e.tool === toolName).length;

  if (recentCount >= cfg.error_delegate_count) {
    hints.push(`${toolName} tool failed ${recentCount}+ times in error window. Delegate to Ecode-debugger agent for root cause analysis, or try a completely different approach.`);
  } else if (recentCount >= cfg.error_escalate_count) {
    hints.push(`${toolName} tool failed ${recentCount} times in error window. Consider using /Qsystematic-debugging to find the root cause before retrying.`);
  }
} else if (existsSync(errorFile)) {
  // Success - clear error tracking for this tool (only if error file exists)
  try {
    const errorState = JSON.parse(readFileSync(errorFile, 'utf8'));
    const filtered = errorState.errors.filter(e => e.tool !== toolName);
    if (filtered.length !== errorState.errors.length) {
      errorState.errors = filtered;
      atomicWriteJson(errorFile, errorState);
    }
  } catch {}
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
      const statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
      let alreadyHinted = false;
      if (existsSync(statsFile)) {
        try {
          const s = JSON.parse(readFileSync(statsFile, 'utf8'));
          alreadyHinted = s._agentation_hinted || false;
        } catch {}
      }
      if (!alreadyHinted) {
        hints.push('Frontend file modified. Use /Qagentation or /Qvisual-qa for visual verification.');
        try {
          const s = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, 'utf8')) : {};
          s._agentation_hinted = true;
          atomicWriteJson(statsFile, s);
        } catch {}
      }
    }
  }

  // Security keyword hint
  const secContent = toolInput.new_string || toolInput.content || '';
  if (secContent && /\b(auth|jwt|password|secret|token|credential|bcrypt|encrypt|decrypt)\b/i.test(secContent)) {
    hints.push('Security-sensitive code detected. Run Esecurity-officer before completing.');
  }
}

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
