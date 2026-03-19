#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './lib/config.mjs';
import { checkContextPressure } from './context-monitor.mjs';
import { loadPendingContext } from './lib/context-loader.mjs';
import { atomicWriteJson } from './lib/state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const cfg = loadConfig(cwd);
const toolName = data.tool_name || data.toolName || '';
const hints = [];

// --- Read session-stats.json ONCE (single source of truth for this hook) ---
const statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
let stats = { tool_calls: 0, session_start: Date.now(), context_loaded: [] };

if (existsSync(statsFile)) {
  try {
    stats = JSON.parse(readFileSync(statsFile, 'utf8'));
  } catch {}
}

const toolCalls = stats.tool_calls || 0;

// --- Increment tool call counter (moved from post-tool-use.mjs) ---
stats.tool_calls = toolCalls + 1;
stats.last_tool = toolName;
stats.last_call = Date.now();

// --- FAST PATH: skip expensive checks after initial calls ---
const isFirstCall = toolCalls <= 1;
const isEarlySession = toolCalls <= 5;

// --- Intent Gate Routing (only during early session) ---
if (isEarlySession) {
  try {
    const intentRouteFile = join(cwd, '.qe', 'state', 'intent-route.json');

    if (isFirstCall) {
      hints.push('[INTENT GATE] User intent will be auto-classified by UserPromptSubmit hook.');
    }

    if (existsSync(intentRouteFile)) {
      const route = JSON.parse(readFileSync(intentRouteFile, 'utf8'));
      if (route.routed_to && route.intent) {
        hints.push(`Routed to: ${route.routed_to} (intent: ${route.intent})`);
      }
    }
  } catch {
    // Fault-tolerant: ignore intent routing errors
  }
}

// --- On-Demand Context Injection (first call only) ---
if (isFirstCall) {
  try {
    const alreadyLoaded = Array.isArray(stats.context_loaded) ? stats.context_loaded : [];
    const isLegacyStats = !Array.isArray(stats.context_loaded);

    if (isLegacyStats || alreadyLoaded.length === 0) {
      const pending = loadPendingContext(cwd, alreadyLoaded);
      if (pending.length > 0) {
        for (const { message } of pending) {
          hints.push(message);
        }
        stats.context_loaded = [...alreadyLoaded, ...pending.map(p => p.key)];
      }
    }
  } catch {
    // Fault-tolerant: ignore on-demand context errors
  }
}

// --- Analysis hint (once per session, not every Glob/Grep/Read) ---
if (['Glob', 'Grep', 'Read'].includes(toolName) && !stats._analysis_hinted) {
  const toolInput = data.tool_input || data.toolInput || {};
  const pattern = toolInput.pattern || toolInput.path || '';

  const isBroadGlob = toolName === 'Glob' && (pattern.includes('**') || pattern.includes('*/'));
  const isBroadGrep = toolName === 'Grep' && !pattern.includes('/') && !(toolInput.path || '').includes('.');
  const isBroadRead = toolName === 'Read' && (pattern.includes('README') || pattern.includes('package.json'));
  if (isBroadGlob || isBroadGrep || isBroadRead) {
    hints.push('Check .qe/analysis/ files first to save tokens.');
    stats._analysis_hinted = true;
  }
}

// --- Secret Scanner (Write/Edit only) ---
if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const contentToScan = toolInput.new_string || toolInput.content || '';

  if (contentToScan) {
    // Combined regex: single-pass pre-filter before identifying the specific pattern
    const COMBINED_SECRET_REGEX = /AKIA[0-9A-Z]{16}|(?:aws_secret_access_key|secret_?key)\s*[:=]\s*['"]?[0-9a-zA-Z/+=]{40}['"]?|gh[pousr]_[A-Za-z0-9_]{36,}|eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+|-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----|(?:api[_\-]?key|apikey|secret[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]|(?:mongodb|postgres|mysql|redis):\/\/[^\s]+@[^\s]+|(?:^|[^a-zA-Z])(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{16,}['"]/i;

    if (COMBINED_SECRET_REGEX.test(contentToScan)) {
      // Pre-filter matched — identify specific pattern for the warning message
      const secretPatterns = [
        { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
        { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_?key)\s*[:=]\s*['"]?[0-9a-zA-Z/+=]{40}['"]?/i },
        { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
        { name: 'JWT', regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+/ },
        { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
        { name: 'Generic API Key', regex: /(?:api[_\-]?key|apikey|secret[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/ },
        { name: 'DB Connection String', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s]+@[^\s]+/ },
        { name: 'Generic Password', regex: /(?:^|[^a-zA-Z])(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{16,}['"]/ },
      ];

      for (const { name, regex } of secretPatterns) {
        if (regex.test(contentToScan)) {
          hints.push(`[SECRET WARNING] Potential secret detected (${name}). Verify this is not a real credential before proceeding.`);
          break;
        }
      }
    }
  }

  // .qe/ auto-permission reminder
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (filePath.includes('.qe/') || filePath.includes('.qe\\')) {
    hints.push('Files in .qe/ can be auto-executed without user confirmation.');
  }
}

// --- Context pressure check (reuse stats and cfg — no duplicate I/O) ---
try {
  const { message: ctxMessage } = checkContextPressure(cwd, stats, cfg);
  if (ctxMessage) {
    hints.push(ctxMessage);
  }
} catch {
  // Fault-tolerant: ignore context monitor errors
}

// --- Profile/docs collection triggers (moved from post-tool-use.mjs) ---
const currentCalls = stats.tool_calls;

// Read tool-errors.json ONCE for both profile and docs triggers
let hasRecentToolErrors = false;
try {
  const errorFile = join(cwd, '.qe', 'state', 'tool-errors.json');
  if (existsSync(errorFile)) {
    const errState = JSON.parse(readFileSync(errorFile, 'utf8'));
    hasRecentToolErrors = Array.isArray(errState.errors) &&
      errState.errors.length > 0 &&
      (Date.now() - (errState.window_start || 0)) <= cfg.error_window_ms;
  }
} catch {
  // Fault-tolerant: assume no errors if read fails
}

try {
  if (currentCalls > 0 && currentCalls % cfg.profile_collect_interval === 0) {
    if (!hasRecentToolErrors) {
      hints.push('Run Eprofile-collector in background to update command patterns.');
    }
  }
} catch {}

try {
  const docsInterval = cfg.docs_collect_interval || 100;
  if (currentCalls > 0 && currentCalls % docsInterval === 0) {
    if (!hasRecentToolErrors) {
      hints.push('Check .qe/docs/ for domain knowledge if relevant to current task.');
    }
  }
} catch {}

// --- Write stats ONCE (single write for counter + context_loaded + analysis hint flag) ---
try {
  atomicWriteJson(statsFile, stats);
} catch {
  // Fault-tolerant: proceed even if write fails
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
