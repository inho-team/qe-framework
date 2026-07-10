#!/usr/bin/env node
'use strict';

/**
 * findings-ledger.mjs — the Verify→Supervise findings pipeline store (Phase 2 / R002).
 *
 * Model: an append-only JSONL event stream per task, one event per line, at
 * `.qe/agent-results/verify-findings-{UUID}.jsonl`. This is SEPARATE from the
 * summary gate logs (verify-gate.log / supervise-gate.log), which carry only
 * per-run verdict metadata (no finding ids). Append-only + O_APPEND means
 * parallel gate agents never lose each other's writes (no whole-file rewrite).
 *
 * Because a finding is touched across gates (open at G2, resolved at G3, ...),
 * one id yields MULTIPLE physical events. The single canonical view is derived
 * by foldFindings() (a projection), never stored. This decouples the append
 * stream from the "one canonical record per id" invariant the guard checks.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Terminal statuses in precedence order (highest first). A finding's canonical
 * status is the highest-precedence terminal event it has; with none it is open. */
export const TERMINAL_PRECEDENCE = ['escalated', 'waived', 'resolved'];
const VALID_STATUS = new Set(['open', 'resolved', 'waived', 'escalated']);

/** Absolute path of a task's findings stream. */
export function findingsPath(cwd, uuid) {
  return join(cwd, '.qe', 'agent-results', `verify-findings-${uuid}.jsonl`);
}

/**
 * Append one finding event to the task's stream (O_APPEND, no interleave).
 * @param {string} cwd
 * @param {string} uuid
 * @param {object} event - { id, gate, severity, status, file, ts?, rationale?, waived_by? }
 */
export function appendFinding(cwd, uuid, event) {
  const path = findingsPath(cwd, uuid);
  mkdirSync(dirname(path), { recursive: true });
  const rec = { ts: event.ts || 0, ...event };
  appendFileSync(path, JSON.stringify(rec) + '\n', { encoding: 'utf8', flag: 'a' });
}

/**
 * Write the affirmative "clean" marker line (0 findings). Absence of this marker
 * is NOT clean — it means the gate never wrote (crash-before-write), which the
 * reader reports distinctly from a clean run.
 */
export function markClean(cwd, uuid, gate) {
  const path = findingsPath(cwd, uuid);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ clean: true, gate: gate || '-', ts: 0 }) + '\n', { encoding: 'utf8', flag: 'a' });
}

/**
 * Read + parse a findings stream.
 * @returns {{ state: 'absent'|'clean'|'corrupt'|'findings', events: object[], clean: boolean, badLines: number }}
 *   - absent   : file does not exist (gate never ran / crashed before write) — NOT clean.
 *   - clean    : file exists and carries a clean marker with zero finding events.
 *   - corrupt  : file exists but has unparseable lines and no usable findings.
 *   - findings : one or more finding events parsed.
 */
export function readFindings(cwd, uuid) {
  const path = findingsPath(cwd, uuid);
  if (!existsSync(path)) return { state: 'absent', events: [], clean: false, badLines: 0 };

  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return { state: 'corrupt', events: [], clean: false, badLines: 0 }; }

  const events = [];
  let clean = false;
  let badLines = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { badLines++; continue; }
    if (obj && obj.clean === true) { clean = true; continue; }
    if (obj && typeof obj.id === 'string' && VALID_STATUS.has(obj.status)) {
      events.push(obj);
    } else {
      badLines++;
    }
  }

  if (events.length > 0) return { state: 'findings', events, clean, badLines };
  if (clean && badLines === 0) return { state: 'clean', events: [], clean: true, badLines: 0 };
  return { state: 'corrupt', events: [], clean, badLines };
}

/**
 * Fold an event stream into one canonical record per finding id.
 * canonical status = highest-precedence TERMINAL event for the id
 * (escalated > waived > resolved); no terminal → 'open'. owner_gate = the gate
 * that wrote the winning terminal (ts as tiebreak among equal-precedence
 * terminals — latest wins). A lower gate's escalated is never masked by a later
 * waive because precedence outranks recency.
 * @param {object[]} events
 * @returns {Map<string, {id, status, owner_gate, severity, file, rationale?, waived_by?}>}
 */
export function foldFindings(events) {
  const byId = new Map();
  for (const e of events) {
    if (!byId.has(e.id)) byId.set(e.id, { events: [] });
    byId.get(e.id).events.push(e);
  }

  const canonical = new Map();
  for (const [id, { events: evs }] of byId) {
    const terminals = evs.filter(e => e.status !== 'open');
    let winner = null;
    if (terminals.length > 0) {
      // Highest precedence first; among equal precedence, latest ts wins.
      winner = terminals.slice().sort((a, b) => {
        const pa = TERMINAL_PRECEDENCE.indexOf(a.status);
        const pb = TERMINAL_PRECEDENCE.indexOf(b.status);
        if (pa !== pb) return pa - pb;            // lower index = higher precedence
        return (b.ts || 0) - (a.ts || 0);          // later ts first
      })[0];
    }
    const last = evs[evs.length - 1];
    const base = winner || last;
    canonical.set(id, {
      id,
      status: winner ? winner.status : 'open',
      owner_gate: winner ? winner.gate : null,
      severity: base.severity,
      file: base.file,
      rationale: winner && winner.rationale,
      waived_by: winner && winner.waived_by,
    });
  }
  return canonical;
}

/**
 * Check the pipeline invariant against a folded canonical view.
 * At pipeline end every finding must have exactly one terminal status; an id
 * still 'open' is unresolved (vanished-or-forgotten) and violates the invariant.
 * A 'waived' terminal without rationale/waived_by is a silent drop, not a
 * legitimate waiver.
 * @param {Map} canonical
 * @returns {{ ok: boolean, violations: Array<{id, reason}> }}
 */
export function checkInvariant(canonical) {
  const violations = [];
  for (const [id, rec] of canonical) {
    if (rec.status === 'open') {
      violations.push({ id, reason: 'unresolved at pipeline end (no terminal resolved/waived/escalated)' });
      continue;
    }
    if (!rec.owner_gate) {
      violations.push({ id, reason: 'terminal has no owner_gate' });
    }
    if (rec.status === 'waived' && !(rec.rationale && rec.waived_by)) {
      violations.push({ id, reason: 'waived without rationale/waived_by (silent drop)' });
    }
  }
  return { ok: violations.length === 0, violations };
}
