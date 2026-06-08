/**
 * @fileoverview Single source of truth for SIVS gate verdict aggregation.
 * The Spec / Verify / Supervise gate protocols all describe the same rule for
 * folding N adversarial-agent verdicts into one gate verdict. Codifying it here
 * (instead of only in prose) keeps the three protocols consistent and testable.
 * Pure helper — no side effects on import.
 * @module hooks/scripts/lib/gate-verdict
 */

/** Normalize a single agent verdict to PASS|WARN|FAIL (unknown → WARN, conservative).
 * @param {*} v - Raw verdict value
 * @returns {'PASS'|'WARN'|'FAIL'}
 */
function normalize(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'FAIL' || s === 'PASS' || s === 'WARN') return s;
  return 'WARN'; // unrecognized → treat as a warning, never a silent PASS
}

/**
 * Aggregate per-agent gate verdicts into a single gate verdict.
 *
 * Rules (identical across spec/verify/supervise gates):
 * - any agent FAIL              → FAIL
 * - 2+ agents WARN              → WARN
 * - exactly 1 WARN, rest PASS   → PASS (with notes)
 * - all PASS                    → PASS
 * - no verdicts at all          → WARN (nothing ran = cannot certify PASS)
 *
 * @param {Array<string|{verdict:string}>} verdicts - Agent verdicts (strings or {verdict})
 * @returns {{ verdict: 'PASS'|'WARN'|'FAIL', counts: {PASS:number,WARN:number,FAIL:number} }}
 */
export function aggregateGateVerdict(verdicts = []) {
  const list = (Array.isArray(verdicts) ? verdicts : [])
    .map((x) => (x && typeof x === 'object' ? x.verdict : x))
    .map(normalize);

  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const v of list) counts[v] += 1;

  let verdict;
  if (list.length === 0) verdict = 'WARN';        // nothing ran → cannot certify
  else if (counts.FAIL > 0) verdict = 'FAIL';     // any FAIL → FAIL
  else if (counts.WARN >= 2) verdict = 'WARN';    // 2+ WARN → WARN
  else verdict = 'PASS';                           // ≤1 WARN, rest PASS → PASS

  return { verdict, counts };
}
