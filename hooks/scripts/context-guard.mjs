#!/usr/bin/env node
// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { readFileSync, existsSync } from './lib/qe-fs.mjs';
import { join } from 'path';
import { estimateUsage, readCachedRatio, readCachedLimit, readConfiguredLimit, readDetectedLimit, readNativeCodexWindow, writeCachedLimit, writeDetectedLimit, recordBlock, resetBlocks, getBlockCount, modelIdToLimit } from './lib/context-meter.mjs';
import {
  CONTEXT_POLICY_DEFAULTS,
  CONTEXT_SEVERITY,
  estimateContextSeverityFromRatio,
  loadContextPolicy,
} from './lib/context-policy.mjs';

const MAX_BLOCKS = 2;
const RESET_RATIO = 0.5;

// Reasons that must never be blocked (deadlock prevention)
const SAFE_PASSTHROUGH_REASONS = new Set(['context_limit', 'user_abort']);

// Read stdin payload
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
  process.exit(0);
}

// Deadlock prevention: never block on these conditions
if (data.stop_hook_active === true) process.exit(0);
const stopReason = data.reason || '';
if (SAFE_PASSTHROUGH_REASONS.has(stopReason)) process.exit(0);

const sessionId = data.session_id || 'default';
const cwd = data.cwd || process.cwd();
const stateDir = process.env.QE_STATE_DIR || join(cwd, '.qe', 'state');
const transcriptPath = data.transcript_path || '';
const modelId = data?.model?.id || data?.model || '';
const cacheScope = {
  client: data.client || process.env.QE_CLIENT || 'claude',
  sessionId,
  modelId,
};

let ratio = 0;
let limit = modelIdToLimit(modelId);
// Trustworthy only when the denominator is PROVEN (a cached,
// known/configured/detected window, or a transcript reading that
// passed the 200k base). A guessed 200k default on a 1M run over-states fill,
// so we must never hard-BLOCK the Stop hook on it.
let limitVerified = false;
try {
  // Prefer a cached/configured/detected context-window limit. The Stop hook
  // payload doesn't include context_window, and transcript-based estimation
  // can't distinguish a 200k run from a 1M run when token count is below 200k.
  const nativeLimit = cacheScope.client === 'codex' ? readNativeCodexWindow() : null;
  const knownLimit = nativeLimit
    ?? readCachedLimit(cwd, cacheScope)
    ?? readConfiguredLimit(cwd, { includeProjectConfig: false })
    ?? readDetectedLimit(cwd, modelId);
  if (knownLimit !== null) {
    limit = knownLimit;
    limitVerified = true;
  }
  const cached = readCachedRatio(cwd, cacheScope);
  if (cached !== null) {
    ratio = cached;
  } else {
    // Limit source: cached value, explicit config/env override, or durable
    // model-keyed detection from a prior
    // session (survives a state-folder wipe). Without any of these, a 1M run
    // with no configured/detected limit falls back to the 200k default and
    // over-warns from ~140k.
    const u = estimateUsage(transcriptPath, { modelId, modelLimit: knownLimit ?? undefined });
    if (u) {
      ratio = u.ratio;
      limit = u.limit;
      // Sticky 1M: persist a deterministically detected 1M tier so later
      // sub-200k readings this session use the right denominator — both in the
      // volatile cache and durably (model-keyed) for future sessions.
      if (u.limit === CONTEXT_POLICY_DEFAULTS.extended_window_tokens) {
        limitVerified = true;
        if (!knownLimit) {
          writeCachedLimit(cwd, CONTEXT_POLICY_DEFAULTS.extended_window_tokens, cacheScope);
          writeDetectedLimit(cwd, modelId, CONTEXT_POLICY_DEFAULTS.extended_window_tokens);
        }
      }
    }
  }
} catch {
  process.exit(0);
}

// Auto-recovery: reset blocks when context drops below 50%
if (ratio < RESET_RATIO) {
  try { resetBlocks(sessionId, stateDir); } catch {}
  process.exit(0);
}

const currentBlocks = getBlockCount(sessionId, stateDir);
let severity = estimateContextSeverityFromRatio(ratio, limit, loadContextPolicy());
if (!limitVerified && severity === CONTEXT_SEVERITY.CRITICAL) {
  severity = CONTEXT_SEVERITY.WARNING;
}

if (severity === CONTEXT_SEVERITY.CRITICAL && currentBlocks < MAX_BLOCKS && limitVerified) {
  // Block and increment counter — only on a PROVEN denominator. On a guessed
  // 200k default we fall through to the soft-warn branch instead of blocking,
  // so a 1M run is never halted on a false "critical" reading.
  let newCount = currentBlocks;
  try { newCount = recordBlock(sessionId, stateDir); } catch {}
  console.log(JSON.stringify({
    decision: 'block',
    reason: `context-guard: critical ${Math.round(ratio * 100)}% — consider /Qcompact then resume`,
  }));
} else if (severity === CONTEXT_SEVERITY.WARNING && currentBlocks < MAX_BLOCKS && limitVerified) {
  // Warn only — do not block. Stop hook schema only allows systemMessage,
  // not hookSpecificOutput (that field is for PreToolUse/UserPromptSubmit/PostToolUse).
  console.log(JSON.stringify({
    continue: true,
    systemMessage: `⚠️ Context at ${Math.round(ratio * 100)}% — plan for /Qcompact soon`,
  }));
}

// Else exit 0 silently (MAX_BLOCKS reached or ratio below warn threshold)
