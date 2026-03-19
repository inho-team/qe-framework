#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Default configuration values
const DEFAULTS = {
  // state.mjs
  // [why this value]: 2 hours covers a typical focused work session without blocking
  // a new session started hours later. Shorter (e.g. 30 min) causes false zombie-state
  // expiry mid-task; longer risks stale lock-in when a session crashes without cleanup.
  stale_ms: 2 * 60 * 60 * 1000,        // 2 hours — state file staleness

  // session-start.mjs
  // [why this value]: 24 hours aligns with a natural daily work rhythm — analysis
  // generated this morning is still valid this afternoon, but yesterday's analysis
  // may reflect a different codebase state after overnight changes.
  analysis_freshness_ms: 24 * 60 * 60 * 1000,  // 24 hours — .qe/analysis/ freshness

  // post-tool-use.mjs
  // [why this value]: 90 seconds is the typical latency window for a burst of tool
  // calls caused by a single agent action (e.g. multi-file edits). Errors that cluster
  // within this window are likely related; errors spread further apart are likely
  // independent and should not trigger escalation together.
  error_window_ms: 90 * 1000,           // 90 seconds — error tracking window

  // [why this value]: 3 errors signals a pattern — not a one-off fluke — but is low
  // enough to escalate before the user notices repeated failures in the conversation.
  error_escalate_count: 3,              // escalate after N errors in window

  // [why this value]: 5 errors means escalation has already fired (at 3) and the
  // agent is still failing. Delegation hands off to a specialized agent before the
  // error cascade compounds further.
  error_delegate_count: 5,              // delegate after N errors in window

  // [why this value]: Every 20 tool calls gives a meaningful slice of session activity
  // without running the collector so frequently that it dominates tool call overhead.
  // At typical session pace (~2 calls/min) this fires roughly every 10 minutes.
  profile_collect_interval: 20,         // collect profile every N tool calls

  // [why this value]: Domain docs change less frequently than command patterns, so
  // a longer interval (50 calls ≈ 25 min) avoids regenerating docs mid-task while
  // still refreshing them within a multi-hour session.
  docs_collect_interval: 50,             // collect domain docs every N tool calls

  // stop-handler.mjs
  // [why this value]: 20 stop-block cycles covers the typical depth of a sequential
  // task loop (QA + retry + confirm). Modes requiring more budget (ultrawork=50,
  // ultraqa=80) override this via their own max_reinforcements setting.
  max_reinforcements: 20,              // max stop blocks in work modes

  // [why this value]: 20 session logs gives enough history for trend analysis
  // (failure patterns, satisfaction trends) without accumulating unbounded storage.
  // Each log is small (<5 KB), so 20 logs ≈ 100 KB maximum on disk.
  session_log_max: 20,                 // keep last N session logs

  satisfaction_enabled: false,         // opt-in: prompt user for 1-5 rating at session end

  // pre-tool-use.mjs
  // [why this value]: 200 tool calls is the "red zone" where context pressure is
  // severe enough to risk truncation. Warning at this point prompts the user to
  // run /Qcompact before the window fills completely.
  context_pressure_high: 200,          // tool calls before compaction warning

  // [why this value]: 150 tool calls is the "orange zone" — context is accumulating
  // but not yet critical. Hinting at this threshold buys time for the user to act
  // before reaching the hard limit at 200.
  context_pressure_warn: 150,          // tool calls before token-saving hint

  // prompt-check.mjs
  // [why this value]: Score of 3 requires at least one strong keyword match (weight≥3)
  // or multiple weaker matches. Lower values produce false-positive routing on common
  // words; higher values miss legitimate but tersely worded requests.
  intent_confidence_threshold: 3,      // min score for auto-classification

  // [why this value]: Messages of 5 words or fewer are structurally too short to
  // convey unambiguous intent for complex skills. Below this threshold the system
  // asks for clarification rather than auto-classifying.
  ambiguous_max_words: 5,              // max words for ambiguity check

  // [why this value]: 100 characters is roughly two short sentences — enough to
  // express a clear request. Messages shorter than this are flagged as potentially
  // ambiguous when they also fall under the word count threshold.
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
