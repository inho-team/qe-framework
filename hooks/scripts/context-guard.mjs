#!/usr/bin/env node
// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { estimateUsage, readCachedRatio, readCachedLimit, writeCachedLimit, recordBlock, resetBlocks, getBlockCount } from './lib/context-meter.mjs';

const MAX_BLOCKS = 2;
const WARN_RATIO = 0.75;
const CRITICAL_RATIO = 0.95;
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

let ratio = 0;
try {
  // Prefer the authoritative reading Claude Code passes to the statusline
  // (HUD caches it under .qe/state/context-cache.json). The Stop hook payload
  // doesn't include context_window, and transcript-based estimation can't
  // distinguish a 200k run from a 1M run when token count is below 200k —
  // so we feed it the true window limit the statusline back-solved and cached.
  const cached = readCachedRatio(cwd);
  if (cached !== null) {
    ratio = cached;
  } else {
    const cachedLimit = readCachedLimit(cwd);
    const u = estimateUsage(transcriptPath, { modelId: data?.model?.id, modelLimit: cachedLimit ?? undefined });
    if (u) {
      ratio = u.ratio;
      // Sticky 1M: persist a deterministically detected 1M tier so later
      // sub-200k readings this session use the right denominator.
      if (!cachedLimit && u.limit === 1000000) writeCachedLimit(cwd, 1000000);
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

if (ratio >= CRITICAL_RATIO && currentBlocks < MAX_BLOCKS) {
  // Block and increment counter
  let newCount = currentBlocks;
  try { newCount = recordBlock(sessionId, stateDir); } catch {}
  console.log(JSON.stringify({
    decision: 'block',
    reason: `context-guard: critical ${Math.round(ratio * 100)}% — consider /Qcompact then resume`,
  }));
} else if (ratio >= WARN_RATIO && currentBlocks < MAX_BLOCKS) {
  // Warn only — do not block. Stop hook schema only allows systemMessage,
  // not hookSpecificOutput (that field is for PreToolUse/UserPromptSubmit/PostToolUse).
  console.log(JSON.stringify({
    continue: true,
    systemMessage: `⚠️ Context at ${Math.round(ratio * 100)}% — plan for /Qcompact soon`,
  }));
}

// Else exit 0 silently (MAX_BLOCKS reached or ratio below warn threshold)
