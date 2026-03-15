#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './lib/config.mjs';

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

// --- Intent Gate Routing (Items 1-5) ---
const intentRouteFile = join(cwd, '.qe', 'state', 'intent-route.json');
const statsFileForIntent = join(cwd, '.qe', 'state', 'session-stats.json');

try {
  // Item 1: Detect session first call (tool_calls <= 1)
  let toolCalls = -1;
  if (existsSync(statsFileForIntent)) {
    const statsData = JSON.parse(readFileSync(statsFileForIntent, 'utf8'));
    toolCalls = statsData.tool_calls || 0;
  }

  const isFirstCall = toolCalls <= 1;

  if (isFirstCall) {
    // Item 2: Inject INTENT_GATE from centralized config
    try {
      const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
      const routeEntries = Object.entries(routesConfig.routes).map(([k, v]) => `${k}→${v}`).join(', ');
      hints.push(`[INTENT GATE] Classify user intent. Routes: ${routeEntries}`);
    } catch {
      hints.push('[INTENT GATE] Classify user intent. (Warning: intent-routes.json not found)');
    }
  }

  // Item 4 & 5: Check intent-route.json
  if (existsSync(intentRouteFile)) {
    // Item 5: Route exists — show routing info
    const route = JSON.parse(readFileSync(intentRouteFile, 'utf8'));
    if (route.routed_to && route.intent) {
      hints.push(`Routed to: ${route.routed_to} (intent: ${route.intent})`);
    }
  } else if (!isFirstCall && toolCalls > 1) {
    // Item 4: No route and not first call — critical warning
    hints.push('[CRITICAL] Intent route not classified. Check INTENT_GATE and classify user intent before acting.');
  }
} catch {
  // Fault-tolerant: ignore intent routing errors
}

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

// --- Secret Scanner (Write/Edit only) ---
if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const contentToScan = toolInput.new_string || toolInput.content || '';

  if (contentToScan) {
    const secretPatterns = [
      { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
      { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_?key)\s*[:=]\s*['"]?[0-9a-zA-Z/+=]{40}['"]?/i },
      { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
      { name: 'JWT', regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+/ },
      { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/ },
      { name: 'Generic API Key', regex: /(api[_\-]?key|apikey|secret[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/ },
      { name: 'DB Connection String', regex: /(mongodb|postgres|mysql|redis):\/\/[^\s]+@[^\s]+/ },
      { name: 'Generic Password', regex: /(?:^|[^a-zA-Z])(password|passwd|pwd)\s*[:=]\s*['"][^'"]{16,}['"]/ },
    ];

    for (const { name, regex } of secretPatterns) {
      if (regex.test(contentToScan)) {
        hints.push(`[SECRET WARNING] Potential secret detected (${name}). Verify this is not a real credential before proceeding.`);
        break;
      }
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
    if (callCount > cfg.context_pressure_high) {
      hints.push(`Context pressure warning: ${cfg.context_pressure_high}+ tool calls. Consider running /Qcompact.`);
    } else if (callCount > cfg.context_pressure_warn) {
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
