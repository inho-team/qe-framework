/**
 * @fileoverview Audit-log appender for SIVS gate runs (spec/verify/supervise).
 * Each call writes ONE short, newline-terminated, single-line record with the
 * 'a' (O_APPEND) flag. With O_APPEND the kernel positions every write at end-of-
 * file, so concurrent multi-UUID gate runs sharing one log file per stage append
 * whole lines rather than overwriting each other. (Strict cross-process write
 * atomicity for regular files is not POSIX-guaranteed for arbitrary sizes; the
 * records here are short single lines, which is the practical safe case.)
 * Pure helper — no side effects on import.
 * @module hooks/scripts/lib/gate-audit
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const VALID_STAGES = new Set(['spec', 'verify', 'supervise']);

/** Strip characters that would break a single-line, pipe-delimited record.
 * Tolerates values that throw on String() coercion (e.g. null-prototype objects).
 * @param {*} value - Any value
 * @returns {string} Single-line-safe string
 */
function sanitize(value) {
  let s;
  try {
    s = String(value == null ? '' : value);
  } catch {
    s = '[unstringifiable]';
  }
  return s.replace(/[\n\r|]/g, ' ').trim();
}

/**
 * Append one atomic audit line for a gate run.
 * @param {string} cwd - Project root used to resolve `.qe/agent-results/`
 * @param {string} stage - SIVS gate stage: 'spec' | 'verify' | 'supervise'
 * @param {object} entry - { verdict, agents, crossmodel, route, uuid, timestamp? }
 * @returns {{ written: boolean, line: string, file: string }} Result (written=false on I/O error)
 */
export function appendGateAudit(cwd, stage, entry = {}) {
  const safeStage = VALID_STAGES.has(stage) ? stage : 'unknown';
  const dir = join(cwd, '.qe', 'agent-results');
  const file = join(dir, `${safeStage}-gate.log`);
  // Build inside try: sanitize tolerates bad input, but timestamp coercion etc.
  // should still degrade to written:false rather than throw to the caller.
  let line = '';
  try {
    const ts = entry.timestamp || new Date().toISOString();
    line =
      `${sanitize(ts)} | ${safeStage}` +
      ` | verdict=${sanitize(entry.verdict) || '-'}` +
      ` | agents=${sanitize(entry.agents) || '-'}` +
      ` | crossmodel=${sanitize(entry.crossmodel) || '-'}` +
      ` | route=${sanitize(entry.route) || '-'}` +
      ` | uuid=${sanitize(entry.uuid) || '-'}\n`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // flag 'a' = O_APPEND: each write is positioned at EOF (whole-line append).
    appendFileSync(file, line, { flag: 'a' });
    return { written: true, line, file };
  } catch {
    return { written: false, line, file };
  }
}
