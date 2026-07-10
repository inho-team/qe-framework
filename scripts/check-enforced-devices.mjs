#!/usr/bin/env node
/**
 * check-enforced-devices.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * WARNING-ONLY guard. Detects "Enforced but silent" savings devices — a device
 * declared active whose activity counters are still zero after enough tool calls
 * that they should have moved. This is a soft signal to re-check hook wiring
 * (matcher / payload schema), NOT a build gate: it never exits non-zero.
 *
 * Safety contract:
 *   - Reads ONLY {process.cwd()}/.qe/state/unified-state.json.
 *     In this wrapper workspace cwd may be the workspace root (state lives there),
 *     while `node scripts/check-all.mjs` runs from qe-framework/ (no state there) —
 *     so a missing file is the normal case and is a silent grace-skip.
 *   - missing / unreadable / unparseable state, non-numeric tool_calls, or a
 *     fresh session (tool_calls < THRESHOLD) → notice or grace-skip, exit 0.
 *   - Only warns; always exits 0.
 *
 * The device→counter mapping is a code constant here (single source of truth);
 * it does NOT parse QE_CONVENTIONS.md prose or count declarations.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// tool_calls at/above which zero counters become suspicious. Exactly 50 is on
// the warning boundary (inclusive), per the device→counter contract.
const TOOL_CALLS_THRESHOLD = 50;

/**
 * Device → counter contract. Each device names the counters that prove it fired
 * and a predicate (given the parsed state) that returns true when the device is
 * "enforced but silent". Warning-only.
 */
const DEVICES = [
  {
    name: 'ContextMemo (Minimal I/O)',
    counters: 'memo.files, memo.blocked_reads, session_stats.blocked_reads',
    isSilent(state) {
      const memo = state.memo || {};
      const files = memo.files && typeof memo.files === 'object' ? Object.keys(memo.files).length : 0;
      const memoBlocked = Number(memo.blocked_reads) || 0;
      const sessBlocked = Number(state.session_stats?.blocked_reads) || 0;
      return files === 0 && memoBlocked === 0 && sessBlocked === 0;
    },
    hint: 'ContextMemo recorded nothing and blocked no reads. Re-check the PostToolUse matcher includes Read and that updateContextMemo runs.',
  },
  {
    name: 'Delegation Enforcer',
    counters: 'delegationStats.autoInjections + warnings + overrides',
    isSilent(state) {
      const d = state.delegationStats;
      // Absent object = the delegation branch never ran at all (wiring bug).
      // Present but all-zero = ran but never acted; both are worth a soft flag.
      if (!d || typeof d !== 'object') return true;
      const sum = (Number(d.autoInjections) || 0) + (Number(d.warnings) || 0) + (Number(d.overrides) || 0);
      return sum === 0;
    },
    hint: 'Delegation stats never moved. Re-check the pre-tool-use gate fires on the Task tool and checkDelegation reads subagent_type.',
  },
];

const statePath = join(process.cwd(), '.qe', 'state', 'unified-state.json');

if (!existsSync(statePath)) {
  console.log('check-enforced-devices: SKIP (no .qe/state/unified-state.json under cwd — nothing to inspect)');
  process.exit(0);
}

let state;
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  console.log('check-enforced-devices: SKIP (unified-state.json missing/corrupt/unparseable — grace skip)');
  process.exit(0);
}
if (!state || typeof state !== 'object') {
  console.log('check-enforced-devices: SKIP (state not an object — grace skip)');
  process.exit(0);
}

const toolCalls = state.session_stats?.tool_calls;
if (typeof toolCalls !== 'number' || !Number.isFinite(toolCalls)) {
  console.log('check-enforced-devices: SKIP (session_stats.tool_calls absent/non-numeric — grace skip)');
  process.exit(0);
}
if (toolCalls < TOOL_CALLS_THRESHOLD) {
  console.log(`check-enforced-devices: NOTICE (fresh session, tool_calls=${toolCalls} < ${TOOL_CALLS_THRESHOLD} — too early to judge, skipping)`);
  process.exit(0);
}

const warnings = [];
for (const device of DEVICES) {
  let silent = false;
  try { silent = device.isSilent(state); } catch { silent = false; }
  if (silent) {
    warnings.push(`  ⚠ ${device.name} [${device.counters}]: ${device.hint}`);
  }
}

if (warnings.length === 0) {
  console.log(`check-enforced-devices: PASS (tool_calls=${toolCalls}; all enforced devices show activity)`);
  process.exit(0);
}

// Warning-only: report and exit 0 so this never fails a build.
console.log(`check-enforced-devices: WARN (tool_calls=${toolCalls}; ${warnings.length} enforced-but-silent device(s)):`);
for (const w of warnings) console.log(w);
console.log('  (warning-only — not a build gate; exit 0)');
process.exit(0);
