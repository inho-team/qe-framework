#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Default configuration values
const DEFAULTS = {
  // state.mjs
  stale_ms: 2 * 60 * 60 * 1000,        // 2 hours — state file staleness

  // session-start.mjs
  analysis_freshness_ms: 24 * 60 * 60 * 1000,  // 24 hours — .qe/analysis/ freshness

  // post-tool-use.mjs
  error_window_ms: 90 * 1000,           // 90 seconds — error tracking window
  error_escalate_count: 3,              // escalate after N errors in window
  error_delegate_count: 5,              // delegate after N errors in window
  profile_collect_interval: 20,         // collect profile every N tool calls
  docs_collect_interval: 50,             // collect domain docs every N tool calls

  // stop-handler.mjs
  max_reinforcements: 20,              // max stop blocks in work modes
  session_log_max: 20,                 // keep last N session logs

  // pre-tool-use.mjs
  context_pressure_high: 200,          // tool calls before compaction warning
  context_pressure_warn: 150,          // tool calls before token-saving hint

  // prompt-check.mjs
  intent_confidence_threshold: 3,      // min score for auto-classification
  ambiguous_max_words: 5,              // max words for ambiguity check
  ambiguous_max_chars: 100,            // max chars for ambiguity check
};

/**
 * Load config with project overrides from .qe/config.json
 * Falls back to defaults for any missing keys.
 */
export function loadConfig(cwd) {
  const config = { ...DEFAULTS };

  if (!cwd) return config;

  const configFile = join(cwd, '.qe', 'config.json');
  if (existsSync(configFile)) {
    try {
      const overrides = JSON.parse(readFileSync(configFile, 'utf8'));
      if (overrides.hooks) {
        Object.assign(config, overrides.hooks);
      }
    } catch {
      // Invalid config — use defaults silently
    }
  }

  return config;
}

export { DEFAULTS };
