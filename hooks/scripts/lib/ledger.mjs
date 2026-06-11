#!/usr/bin/env node
'use strict';

/**
 * lib/ledger.mjs — ultragoal-style append-only goal ledger for Named Plans.
 *
 * Phase 1 (Qplan-owned). Brings the durable half of oh-my-claudecode's
 * `ultragoal` into QE: an ordered microgoal list (`goals.json`) plus an
 * append-only audit trail (`ledger.jsonl`) under `.qe/planning/plans/{slug}/`.
 * `STATE.md`'s progress block is *derived* from these, not hand-maintained.
 *
 * Design (efficiency is a P0 requirement here):
 *   - goals.json write  → state.mjs `atomicWriteJson` (temp+rename, no corruption)
 *   - ledger append     → trace-logger idiom `appendFileSync(line + '\n')` — O(1),
 *                         never rewrites existing lines.
 *   - status read       → bounded tail read (last ~8KB), never loads whole file.
 *   - slug layout       → mirrors plan-resolver; zero new external deps.
 *
 * CLI:
 *   node ledger.mjs create-goals --slug S [--goal "Title::Objective" ...]
 *   node ledger.mjs append --slug S --goal-id G001 --event checkpoint --status complete [--evidence "..."]
 *   node ledger.mjs render-state --slug S
 *   node ledger.mjs status --slug S
 */

import { appendFileSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './state.mjs';
import { resolveActivePlanSlug } from './plan-resolver.mjs';

const PLANS_DIR = '.qe/planning/plans';
const STATUS_ENUM = ['pending', 'active', 'complete', 'failed', 'blocked'];
const EVENT_ENUM = ['created', 'started', 'checkpoint', 'blocker', 'failed'];
const PROGRESS_HEADING = '## Phase Progress';
const STATUS_TAIL_BYTES = 8192;

// ── paths ────────────────────────────────────────────────────────────────
function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null;
}
/** Absolute path to a plan's directory under `.qe/planning/plans/`. */
function planDir(cwd, slug) { return join(cwd, PLANS_DIR, slug); }
/** Path to the plan's `goals.json`. */
function goalsPath(cwd, slug) { return join(planDir(cwd, slug), 'goals.json'); }
/** Path to the plan's append-only `ledger.jsonl`. */
function ledgerPath(cwd, slug) { return join(planDir(cwd, slug), 'ledger.jsonl'); }
/** Path to the plan's `ROADMAP.md` (source of microgoals). */
function roadmapPath(cwd, slug) { return join(planDir(cwd, slug), 'ROADMAP.md'); }
/** Path to the plan's `STATE.md` (derived progress view). */
function statePath(cwd, slug) { return join(planDir(cwd, slug), 'STATE.md'); }
/** Current time as an ISO-8601 string (ledger event timestamp). */
function nowIso() { return new Date().toISOString(); }

// ── io primitives ────────────────────────────────────────────────────────
export function readGoals(cwd, slug) {
  const p = goalsPath(cwd, slug);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Atomically persist the goals doc (temp+rename via state.mjs). */
function writeGoals(cwd, slug, doc) {
  const dir = planDir(cwd, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteJson(goalsPath(cwd, slug), doc); // temp+rename
}

/** Append one event line. O(1) — never reads or rewrites existing lines. */
export function recordEvent(cwd, slug, event) {
  const dir = planDir(cwd, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(ledgerPath(cwd, slug), JSON.stringify(event) + '\n', 'utf8');
}

/** Bounded tail read of ledger.jsonl — reads at most STATUS_TAIL_BYTES. */
export function tailLedger(cwd, slug, maxLines = 5) {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return [];
  let fd;
  try {
    fd = openSync(p, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, STATUS_TAIL_BYTES);
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, size - len);
    let parts = buf.toString('utf8').split('\n');
    // A truncated read may begin mid-line — and mid-UTF-8-codepoint, which
    // matters for non-ASCII (e.g. Korean) evidence. That leading fragment is
    // never a whole event, so drop it before parsing.
    if (len < size) parts = parts.slice(1);
    return parts.filter(Boolean)
      .slice(-maxLines)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ── ROADMAP → microgoals ───────────────────────────────────────────────────
/**
 * Parse bullets that live under a `### Wave …` heading inside the active
 * Phase as microgoals. Restricting to Wave bullets keeps tables/prose out.
 */
function parseRoadmapGoals(cwd, slug) {
  const rp = roadmapPath(cwd, slug);
  if (!existsSync(rp)) return [];
  const lines = readFileSync(rp, 'utf8').split('\n');
  const goals = [];
  let phase = null, wave = null, n = 0;
  for (const line of lines) {
    const ph = line.match(/^##\s+(Phase\s+[\d.]+[^\n]*)/i);
    if (ph) { phase = ph[1].trim(); wave = null; continue; }
    if (/^##\s+/.test(line) && !/^##\s+Phase/i.test(line)) { phase = null; wave = null; continue; }
    const wv = line.match(/^###\s+(Wave[^\n]*)/i);
    if (wv) { wave = wv[1].trim(); continue; }
    const bul = line.match(/^\s*[-*]\s+(.+)$/);
    if (bul && phase && wave) {
      n += 1;
      const title = bul[1].replace(/`/g, '').replace(/\s+/g, ' ').slice(0, 120).trim();
      goals.push({ id: `G${String(n).padStart(3, '0')}`, title, objective: title,
        status: 'pending', attempts: 0, phase, wave });
    }
  }
  return goals;
}

// ── commands ───────────────────────────────────────────────────────────────
/**
 * Initialize goals.json + ledger.jsonl for a plan. Idempotent: if goals.json
 * already exists it is preserved (re-running Qplan must not wipe history).
 */
export function createGoals(cwd, slug, explicitGoals = []) {
  if (readGoals(cwd, slug)) return { skipped: true, reason: 'goals.json exists' };

  let goals = explicitGoals.map((g, i) => {
    const [title, objective] = String(g).split('::');
    return { id: `G${String(i + 1).padStart(3, '0')}`, title: (title || g).trim(),
      objective: (objective || title || g).trim(), status: 'pending', attempts: 0,
      phase: 'Phase 1', wave: '-' };
  });
  if (goals.length === 0) goals = parseRoadmapGoals(cwd, slug);

  const doc = { planSlug: slug, schema: 1, createdAt: nowIso(), goals };
  writeGoals(cwd, slug, doc);
  for (const g of goals) {
    recordEvent(cwd, slug, { ts: nowIso(), event: 'created', goalId: g.id, status: 'pending', evidence: '', attempt: 0 });
  }
  return { created: goals.length };
}

/**
 * Append a lifecycle event and update only the affected goal's status/attempts.
 * Fail-closed enforcement (only-active-mutable) is Phase 2 (Qgs); Phase 1
 * keeps the primitive permissive but records every transition.
 */
export function append(cwd, slug, { goalId, event, status, evidence = '' }) {
  if (!EVENT_ENUM.includes(event)) throw new Error(`invalid event: ${event}`);
  if (status && !STATUS_ENUM.includes(status)) throw new Error(`invalid status: ${status}`);
  const doc = readGoals(cwd, slug);
  if (!doc) throw new Error(`no goals.json for slug ${slug}`);
  const goal = doc.goals.find(g => g.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);

  if (event === 'started') goal.attempts += 1;
  if (status) goal.status = status;
  writeGoals(cwd, slug, doc); // atomic; only the mutated object changed in-memory
  recordEvent(cwd, slug, { ts: nowIso(), event, goalId, status: status || goal.status, evidence, attempt: goal.attempts });
  return { goalId, status: goal.status, attempts: goal.attempts };
}

/** Render STATE.md's "## Phase Progress" block from goals.json (derived view). */
export function renderState(cwd, slug) {
  const doc = readGoals(cwd, slug);
  if (!doc) throw new Error(`no goals.json for slug ${slug}`);
  const mark = { pending: ' ', active: '>', complete: 'x', failed: '!', blocked: '~' };
  const byPhase = new Map();
  for (const g of doc.goals) {
    if (!byPhase.has(g.phase)) byPhase.set(g.phase, []);
    byPhase.get(g.phase).push(g);
  }
  let block = `${PROGRESS_HEADING}\n\n> 자동 생성 (ledger.mjs render-state) — 직접 수정 금지\n`;
  for (const [phase, goals] of byPhase) {
    block += `\n### ${phase}\n`;
    for (const g of goals) {
      const w = g.wave && g.wave !== '-' ? `[${g.wave}] ` : '';
      block += `- [${mark[g.status] || ' '}] ${g.id} ${w}${g.title}\n`;
    }
  }

  const sp = statePath(cwd, slug);
  const prior = existsSync(sp) ? readFileSync(sp, 'utf8') : `# STATE — ${slug}\n`;
  let next;
  const idx = prior.indexOf(PROGRESS_HEADING);
  if (idx === -1) {
    next = prior.replace(/\n*$/, '\n') + '\n' + block;
  } else {
    const after = prior.slice(idx + PROGRESS_HEADING.length);
    const nextHeading = after.search(/\n##\s/);
    const tail = nextHeading === -1 ? '' : after.slice(nextHeading);
    next = prior.slice(0, idx) + block.replace(/\n*$/, '\n') + tail;
  }
  atomicWriteText(sp, next); // STATE.md is markdown, not JSON — own temp+rename
  return { state: sp, phases: byPhase.size };
}

/** Atomic temp+rename write for a text file (markdown STATE.md). */
function atomicWriteText(dest, content) {
  const tmp = dest + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, dest);
}

/** Compact current-status summary using only a bounded tail read. */
export function status(cwd, slug) {
  const doc = readGoals(cwd, slug);
  if (!doc) return { slug, exists: false };
  const counts = doc.goals.reduce((a, g) => (a[g.status] = (a[g.status] || 0) + 1, a), {});
  const active = doc.goals.find(g => g.status === 'active') || doc.goals.find(g => g.status === 'pending');
  return { slug, total: doc.goals.length, counts, active: active ? { id: active.id, title: active.title } : null,
    recent: tailLedger(cwd, slug, 3) };
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [], goal: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goal') { out.goal.push(argv[++i]); continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]; continue; }
    out._.push(a);
  }
  return out;
}

/** CLI entrypoint: dispatch a subcommand to the matching ledger function. */
function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const cwd = args.cwd || process.cwd();
  let slug = normalizeSlug(args.slug) || resolveActivePlanSlug(cwd, args.session || null);
  if (!slug) { console.error('ledger: no valid --slug and no active plan'); process.exit(2); }

  try {
    let res;
    if (cmd === 'create-goals') res = createGoals(cwd, slug, args.goal);
    else if (cmd === 'append') res = append(cwd, slug, { goalId: args['goal-id'], event: args.event, status: args.status, evidence: args.evidence });
    else if (cmd === 'render-state') res = renderState(cwd, slug);
    else if (cmd === 'status') res = status(cwd, slug);
    else { console.error(`ledger: unknown command '${cmd}'`); process.exit(2); }
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error(`ledger: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
