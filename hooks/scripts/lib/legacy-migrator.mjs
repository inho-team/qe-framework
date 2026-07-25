/**
 * lib/legacy-migrator.mjs
 *
 * Registry-driven engine that detects and relocates artifacts from previous
 * QE structures. Two callers:
 *   - session-start hook    → `runAutoMigrations`, silent + idempotent
 *   - /Qmigrate-legacy skill → `dryRunAll`, `applyById`, user-facing
 *
 * Adding a new legacy pattern is a single registry entry — see MIGRATIONS at
 * the bottom of the file. Each entry owns its own scan/apply pair so the
 * engine stays uniform and the skill can present a per-id report.
 *
 * Auto-mode runs only entries marked `autoEligible: true`. New entries should
 * be `false` until validated against real-world projects to keep startup safe.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, lstatSync } from './qe-fs.mjs';
import { join } from 'path';

const SESSIONS_SUBDIR = 'sessions';
const LEGACY_BUCKET = '_legacy';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run every auto-eligible migration end-to-end. Designed for the SessionStart
 * hook: cheap, silent, idempotent — already-migrated artifacts produce empty
 * candidate lists and the engine returns immediately.
 *
 * @param {string} projectRoot
 * @returns {Array<{ id: string, moved: Array<{src: string, dst: string}>, skipped: Array<{src: string, reason: string}> }>}
 */
export function runAutoMigrations(projectRoot) {
  if (!projectRoot) return [];
  const report = [];
  for (const m of MIGRATIONS) {
    if (!m.autoEligible) continue;
    const result = runOne(projectRoot, m);
    if (result.moved.length || result.skipped.length) {
      report.push({ id: m.id, ...result });
    }
  }
  return report;
}

/**
 * Format an auto-migration report as a single human-readable line for hook
 * additionalContext. Returns null when nothing moved, so the hook can decide
 * whether to surface a message at all.
 *
 * @param {Array<ReturnType<typeof runAutoMigrations>[number]>} report
 * @returns {string|null}
 */
export function summarizeReport(report) {
  if (!report || report.length === 0) return null;
  const parts = report
    .filter(r => r.moved.length > 0)
    .map(r => `${r.id}:${r.moved.length}`);
  if (parts.length === 0) return null;
  return `[Migrate] Legacy artifacts archived (${parts.join(', ')}).`;
}

/**
 * Scan every registered migration without applying. Used by /Qmigrate-legacy
 * for the default dry-run report so the user can review before opting in.
 *
 * @param {string} projectRoot
 * @returns {Array<{ id: string, description: string, autoEligible: boolean, candidates: Array<{src: string, dst: string}> }>}
 */
export function dryRunAll(projectRoot) {
  if (!projectRoot) return [];
  return MIGRATIONS.map(m => ({
    id: m.id,
    description: m.description,
    autoEligible: m.autoEligible,
    candidates: m.scan(projectRoot),
  }));
}

/**
 * Apply a specific migration by id. Used by /Qmigrate-legacy for
 * `--apply <id>` after the user reviews the dry-run output.
 *
 * @param {string} projectRoot
 * @param {string} id migration id from MIGRATIONS
 * @returns {{ id: string, moved: Array<{src: string, dst: string}>, skipped: Array<{src: string, reason: string}> } | null}
 *   null when no entry matches the id
 */
export function applyById(projectRoot, id) {
  const m = MIGRATIONS.find(x => x.id === id);
  if (!m) return null;
  return { id: m.id, ...runOne(projectRoot, m) };
}

/**
 * Return the registered migration metadata (no scanning). Used by the skill
 * to render the available-id list when the user passes no arguments.
 *
 * @returns {Array<{ id: string, description: string, autoEligible: boolean }>}
 */
export function listMigrations() {
  return MIGRATIONS.map(m => ({
    id: m.id,
    description: m.description,
    autoEligible: m.autoEligible,
  }));
}

/**
 * Execute a single migration: scan, then move each candidate atomically.
 * Race-safe — losers of `renameSync` collisions are recorded in `skipped`
 * so callers can surface them without crashing the hook.
 *
 * @param {string} projectRoot
 * @param {{ id: string, scan: (root: string) => Array<{src: string, dst: string}> }} m
 * @returns {{ moved: Array<{src: string, dst: string}>, skipped: Array<{src: string, reason: string}> }}
 */
function runOne(projectRoot, m) {
  const moved = [];
  const skipped = [];
  let candidates = [];
  try {
    candidates = m.scan(projectRoot);
  } catch (err) {
    return { moved, skipped: [{ src: '<scan>', reason: err?.message || String(err) }] };
  }
  for (const { src, dst } of candidates) {
    try {
      if (!existsSync(src)) continue; // already migrated by a sibling session
      if (existsSync(dst)) {
        skipped.push({ src, reason: 'destination exists' });
        continue;
      }
      mkdirSync(join(dst, '..'), { recursive: true });
      renameSync(src, dst);
      moved.push({ src, dst });
    } catch (err) {
      skipped.push({ src, reason: err?.message || String(err) });
    }
  }
  return { moved, skipped };
}

// ---------------------------------------------------------------------------
// Migration: legacy flat .qe/context/ files
// ---------------------------------------------------------------------------

const LEGACY_CONTEXT_FILES = [
  'snapshot.md',
  'SNAPSHOT_SUMMARY.md',
  'decisions.md',
  'compact-trigger.json',
];

/**
 * Locate pre-partition flat context artifacts that need to move into
 * `.qe/context/sessions/_legacy/`. Returns an empty list when nothing
 * matches so the engine can short-circuit on already-migrated projects.
 *
 * @param {string} projectRoot
 * @returns {Array<{src: string, dst: string}>}
 */
function scanLegacyContext(projectRoot) {
  const dstDir = join(projectRoot, '.qe', 'context', SESSIONS_SUBDIR, LEGACY_BUCKET);
  return LEGACY_CONTEXT_FILES
    .map(name => ({
      src: join(projectRoot, '.qe', 'context', name),
      dst: join(dstDir, name),
    }))
    .filter(({ src }) => existsSync(src));
}

// ---------------------------------------------------------------------------
// Migration: legacy flat .qe/handoffs/HANDOFF_*.md files
// ---------------------------------------------------------------------------

/**
 * Locate pre-partition handoff documents that sit at the flat
 * `.qe/handoffs/` level. Skips symlinks to prevent a crafted symlink from
 * directing renameSync at a path outside the destination tree.
 *
 * @param {string} projectRoot
 * @returns {Array<{src: string, dst: string}>}
 */
function scanLegacyHandoffs(projectRoot) {
  const handoffRoot = join(projectRoot, '.qe', 'handoffs');
  if (!existsSync(handoffRoot)) return [];
  const dstDir = join(handoffRoot, SESSIONS_SUBDIR, LEGACY_BUCKET);
  let entries = [];
  try {
    entries = readdirSync(handoffRoot);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!/^HANDOFF_.*\.md$/.test(name)) continue;
    const src = join(handoffRoot, name);
    try {
      const st = lstatSync(src);
      if (!st.isFile()) continue; // skip dirs and symlinks
    } catch {
      continue;
    }
    out.push({ src, dst: join(dstDir, name) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Ordered registry of legacy migrations. Add a new entry whenever an old QE
 * structure needs cleanup; mark `autoEligible: false` until you've verified
 * detection is precise enough to run unattended at every session start.
 *
 * @type {Array<{
 *   id: string,
 *   description: string,
 *   autoEligible: boolean,
 *   scan: (root: string) => Array<{src: string, dst: string}>,
 * }>}
 */
const MIGRATIONS = [
  {
    id: 'context-flat',
    description: 'Pre-partition flat .qe/context/ artifacts → sessions/_legacy/',
    autoEligible: true,
    scan: scanLegacyContext,
  },
  {
    id: 'handoffs-flat',
    description: 'Pre-partition flat .qe/handoffs/HANDOFF_*.md → sessions/_legacy/',
    autoEligible: true,
    scan: scanLegacyHandoffs,
  },
  // Add future legacy patterns here. Set autoEligible to false until proven
  // safe across real projects; surface them via /Qmigrate-legacy first.
];

// Test helper — exposed only for unit tests, not part of the public API.
export const __testHelpers = { MIGRATIONS };
