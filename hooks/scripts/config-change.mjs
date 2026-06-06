#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);

try {
  const state = readUnifiedState(cwd);

  state.lastConfigChange = {
    timestamp: new Date().toISOString(),
    key: data.config_key || data.configKey || 'unknown',
    oldValue: data.old_value || data.oldValue || null,
    newValue: data.new_value || data.newValue || null
  };

  writeUnifiedState(cwd, state);

  // Alert on utopia-related config changes
  const key = state.lastConfigChange.key;
  if (key && (key.includes('utopia') || key.includes('permissions') || key.includes('auto'))) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        additionalContext: `[QE] Config changed: ${key}`
      }
    }));
    process.exit(0);
  }
} catch {
  // Fault tolerance — never crash the config-change hook
}

console.log(JSON.stringify({ continue: true }));
