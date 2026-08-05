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
 *   node ledger.mjs set-acceptance --slug S --goal-id G001 --file contract.json
 *   node ledger.mjs run-evidence --slug S --goal-id G001 --role implementation|verification [--verifier NAME]
 *   node ledger.mjs record-evidence --slug S --goal-id G001 --file evidence.json
 *   node ledger.mjs render-state --slug S
 *   node ledger.mjs status --slug S
 */

import { appendFileSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from './qe-fs.mjs';
import { join } from 'path';
import { realpathSync as nativeRealpathSync } from 'node:fs';
import { createHash, randomUUID } from 'crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './state.mjs';
import { resolveActivePlanSlug } from './plan-resolver.mjs';
import { readCurrentSessionId } from './session-resolver.mjs';
import { writeVerifiedGoalKnowledge } from './plan-knowledge.mjs';
import { isAllowlistCommand, isBehavioralEvidenceCommand } from './verification-evidence-gate.mjs';
import { buildProcessTrace, validateTraceabilityDefinition } from './process-trace.mjs';
import { closeSqlite, openSqlite } from './store-sqlite.mjs';
import { canonicalJson, createProcessControllerStore, sha256 } from './process-controller-store.mjs';
import { types as utilTypes } from 'node:util';

const PLANS_DIR = '.qe/planning/plans';
const STATUS_ENUM = ['pending', 'active', 'complete', 'failed', 'blocked'];
// 'measurement' added for phase-report measured-evidence sourcing; all other values unchanged.
const EVENT_ENUM = ['created', 'started', 'checkpoint', 'blocker', 'failed', 'measurement', 'verified'];
const PROGRESS_HEADING = '## Phase Progress';
const STATUS_TAIL_BYTES = 8192;

const LIFECYCLE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LIFECYCLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIFECYCLE_PROCESS_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LIFECYCLE_LAYERS = new Set(['plan', 'goal', 'pse', 'sivs']);
const LIFECYCLE_TERMINAL_CHILD = new Set(['committed', 'denied', 'cancelled']);
const LIFECYCLE_TERMINAL_PARENT = new Set(['committed', 'denied']);
const LIFECYCLE_MAX_JSON = 64 * 1024;
const LIFECYCLE_MAX_AGGREGATE = 1024 * 1024;
const LIFECYCLE_MAX_CHILDREN = 128;
const LIFECYCLE_SEAL_NAME = 'lifecycle-journal-immutability';
const LIFECYCLE_MIN_LEASE_MS = 1000;
const LIFECYCLE_MAX_LEASE_MS = 300000;

// ── paths ────────────────────────────────────────────────────────────────
function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null;
}

function canonicalPlanRoot(cwd) {
  const root = process.env.QE_ROOT || process.cwd();
  try {
    return nativeRealpathSync(cwd) === nativeRealpathSync(root) ? nativeRealpathSync(root) : null;
  } catch {
    return null;
  }
}

function qeFilesRowExists(cwd, relPath) {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) return null;
  try {
    return !!db.prepare('SELECT 1 FROM qe_files WHERE path=?').get(relPath);
  } catch {
    return null;
  } finally { closeSqlite(db); }
}

function canonicalPlanBackendConflict(cwd, slug, relPath) {
  if (!canonicalPlanRoot(cwd)) return false;
  const diskPath = join(cwd, relPath);
  if (!existsSync(diskPath)) return false;
  const rowExists = qeFilesRowExists(cwd, relPath);
  return rowExists === false;
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
/** Path to the plan's `REQUIREMENTS.md`. */
function requirementsPath(cwd, slug) { return join(planDir(cwd, slug), 'REQUIREMENTS.md'); }
/** Path to the plan's `DECISION_LOG.md`. */
function decisionLogPath(cwd, slug) { return join(planDir(cwd, slug), 'DECISION_LOG.md'); }
/** Directory holding per-goal acceptance contracts and completion evidence. */
function evidenceDir(cwd, slug) { return join(planDir(cwd, slug), 'evidence'); }
function acceptancePath(cwd, slug, goalId) { return join(evidenceDir(cwd, slug), `${goalId}.acceptance.json`); }
function completionEvidencePath(cwd, slug, goalId) { return join(evidenceDir(cwd, slug), `${goalId}.completion.json`); }
function runEvidencePath(cwd, slug, goalId, role) { return join(evidenceDir(cwd, slug), `${goalId}.${role}-run.json`); }
function runEvidenceHistoryPath(cwd, slug, goalId, role, runId) {
  return join(evidenceDir(cwd, slug), 'runs', `${goalId}.${role}.${runId}.json`);
}
/** Path for a phase report file (reports/ subdir under plan). */
function reportPath(cwd, slug, phaseNum) { return join(planDir(cwd, slug), 'reports', `PHASE_${phaseNum}_REPORT.md`); }
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

const PLAN_DOC_MAX_BYTES = 4 * 1024 * 1024;
const PLAN_LEDGER_MAX_BYTES = 16 * 1024 * 1024;
const PLAN_LEDGER_MAX_LINES = 131072;

function canonicalPlanError(code, message = code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function canonicalPlanOpenDb(cwd, { readOnly = false } = {}) {
  const db = openSqlite(cwd, { readOnly, timeoutMs: 5000 });
  if (!db) return null;
  if (readOnly) return db;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plan_write_identities(
        identity TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        slug TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        artifact_sha256 TEXT NOT NULL,
        event_sha256 TEXT NOT NULL,
        event_offset INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS plan_write_identity_goal ON plan_write_identities(slug, goal_id, operation);
    `);
    return db;
  } catch {
    closeSqlite(db);
    return null;
  }
}

function canonicalPlanTextBytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

function canonicalPlanSerializeJson(value) {
  const text = JSON.stringify(value, null, 2);
  if (canonicalPlanTextBytes(text) > PLAN_DOC_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  return text;
}

function canonicalPlanReadRow(db, relPath) {
  return db.prepare('SELECT content, encoding, sha256 FROM qe_files WHERE path=?').get(relPath) || null;
}

function canonicalPlanDecodeRow(row) {
  if (!row) return null;
  return row.encoding === 'base64' ? Buffer.from(row.content || '', 'base64').toString('utf8') : String(row.content || '');
}

function canonicalPlanReadText(cwd, relPath) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd, { readOnly: true });
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      const row = canonicalPlanReadRow(db, relPath);
      return row ? canonicalPlanDecodeRow(row) : null;
    } finally { closeSqlite(db); }
  }
  const abs = join(cwd, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

function canonicalPlanReadJson(cwd, relPath) {
  const text = canonicalPlanReadText(cwd, relPath);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
}

function canonicalPlanWriteRow(db, relPath, text, expectedSha = null, mode = 0o644) {
  const bytes = canonicalPlanTextBytes(text);
  if (bytes > PLAN_DOC_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const sha = sha256(text);
  const now = Date.now();
  const current = canonicalPlanReadRow(db, relPath);
  if (expectedSha !== null) {
    if (!current || current.sha256 !== expectedSha) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=? AND sha256=?`)
      .run(text, bytes, mode, now, sha, now, relPath, expectedSha);
  } else if (current) {
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=?`)
      .run(text, bytes, mode, now, sha, now, relPath);
  } else {
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(relPath, text, 'utf8', bytes, mode, now, sha, now);
  }
  return { sha, bytes };
}

function canonicalPlanLedgerLines(text) {
  if (!text) return [];
  if (!text.endsWith('\n')) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const lines = text.split('\n').filter(Boolean);
  if (lines.some(line => line.includes('\r'))) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  return lines;
}

function canonicalPlanAppendLedger(db, relPath, eventLine) {
  const currentRow = canonicalPlanReadRow(db, relPath);
  const currentText = canonicalPlanDecodeRow(currentRow) || '';
  const lines = canonicalPlanLedgerLines(currentText);
  if (lines.length + 1 > PLAN_LEDGER_MAX_LINES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const nextLine = JSON.stringify(eventLine);
  const nextText = currentText + nextLine + '\n';
  if (canonicalPlanTextBytes(nextText) > PLAN_LEDGER_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const nextSha = sha256(nextText);
  const now = Date.now();
  if (currentRow) {
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=? AND sha256=?`)
      .run(nextText, canonicalPlanTextBytes(nextText), 0o644, now, nextSha, now, relPath, currentRow.sha256);
  } else {
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(relPath, nextText, 'utf8', canonicalPlanTextBytes(nextText), 0o644, now, nextSha, now);
  }
  return { sha: nextSha, lineCount: lines.length + 1 };
}

function canonicalPlanIdentity(db, identity, operation, slug, goalId, artifactPath, artifactSha256, eventSha256, eventOffset) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM plan_write_identities WHERE identity=?').get(identity);
  if (existing) {
    if (existing.operation !== operation || existing.slug !== slug || existing.goal_id !== goalId ||
        existing.artifact_path !== artifactPath || existing.artifact_sha256 !== artifactSha256 ||
        existing.event_sha256 !== eventSha256 || existing.event_offset !== eventOffset) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
    return { replayed: true, row: existing };
  }
  db.prepare(`INSERT INTO plan_write_identities(identity,operation,slug,goal_id,artifact_path,artifact_sha256,event_sha256,event_offset,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(identity, operation, slug, goalId, artifactPath, artifactSha256, eventSha256, eventOffset, now);
  return { replayed: false, row: null };
}

function canonicalPlanWriteError(error) {
  if (error?.code === 'CANONICAL_CAS_CONFLICT' || error?.code === 'CANONICAL_STORE_INVALID' || error?.code === 'CANONICAL_BACKEND_CONFLICT') {
    return error;
  }
  return canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
}

function canonicalStoreError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function canonicalStoreClone(value, depth = 0, seen = new Set()) {
  if (depth > 12) throw canonicalStoreError('CANONICAL_STORE_INVALID');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw canonicalStoreError('CANONICAL_STORE_INVALID');
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    throw canonicalStoreError('CANONICAL_STORE_INVALID');
  }
  if (seen.has(value)) throw canonicalStoreError('CANONICAL_STORE_INVALID');
  if (utilTypes.isProxy?.(value)) throw canonicalStoreError('CANONICAL_STORE_INVALID');
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map(item => canonicalStoreClone(item, depth + 1, seen));
  }
  if (value === null || typeof value !== 'object') throw canonicalStoreError('CANONICAL_STORE_INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw canonicalStoreError('CANONICAL_STORE_INVALID');
  seen.add(value);
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw canonicalStoreError('CANONICAL_STORE_INVALID');
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !Object.prototype.hasOwnProperty.call(desc, 'value')) throw canonicalStoreError('CANONICAL_STORE_INVALID');
    out[key] = canonicalStoreClone(desc.value, depth + 1, seen);
  }
  return out;
}

/** Append one event line. O(1) — never reads or rewrites existing lines. */
export function recordEvent(cwd, slug, event) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const rel = join(PLANS_DIR, slug, 'ledger.jsonl');
      const cloned = canonicalStoreClone(event);
      const { lineCount } = canonicalPlanAppendLedger(db, rel, cloned);
      db.exec('COMMIT');
      return;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const dir = planDir(cwd, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cloned = canonicalStoreClone(event);
  const line = canonicalJson(cloned);
  if (Buffer.byteLength(line, 'utf8') > 64 * 1024) throw canonicalStoreError('CANONICAL_STORE_INVALID');
  appendFileSync(ledgerPath(cwd, slug), line + '\n', 'utf8');
}

// ── Durable composite lifecycle journal ─────────────────────────────────

function lifecyclePlainObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
      && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch { return false; }
}

function lifecycleClone(value, depth = 0) {
  if (depth > 12) throw new TypeError('depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('number');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => lifecycleClone(item, depth + 1));
  if (!lifecyclePlainObject(value)) throw new TypeError('object');
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = lifecycleClone(value[key], depth + 1);
  return out;
}

function lifecycleExact(value, keys) {
  return lifecyclePlainObject(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function lifecycleBoundedString(value, maxBytes, pattern = null) {
  return typeof value === 'string' && value.trim() !== ''
    && Buffer.byteLength(value, 'utf8') <= maxBytes && (!pattern || pattern.test(value));
}

function lifecycleError(code) { return { ok: false, code }; }

// Private crash-test seam. It is intentionally not exported or reachable from
// lifecycle request envelopes; subprocess tests install the symbol locally.
function lifecycleFault(point) {
  const injector = globalThis[Symbol.for('qe.lifecycle-journal.fault-injector')];
  if (typeof injector === 'function') injector(point);
}

function lifecycleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lifecycle_operations(
      slug TEXT NOT NULL,
      operation_id TEXT PRIMARY KEY,
      semantic_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      intent_digest TEXT NOT NULL,
      roster_json TEXT NOT NULL DEFAULT '[]',
      roster_digest TEXT NOT NULL DEFAULT '',
      finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
      status TEXT NOT NULL,
      current_ordinal INTEGER NOT NULL,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(slug, semantic_key)
    );
    CREATE TABLE IF NOT EXISTS lifecycle_operation_children(
      operation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      layer TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      process_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      claim_owner TEXT,
      claim_token TEXT,
      lease_until INTEGER,
      result_ref_json TEXT,
      PRIMARY KEY(operation_id, ordinal),
      UNIQUE(operation_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS lifecycle_children_status
      ON lifecycle_operation_children(operation_id, status, ordinal);

    CREATE TABLE IF NOT EXISTS qe_schema_seals(
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      digest TEXT NOT NULL,
      installed_at INTEGER NOT NULL
    );
  `);
}

function lifecycleRosterDigest(operationId, roster) {
  return sha256(canonicalJson(['qe-lifecycle-roster-v1', operationId, roster]));
}

function lifecycleRosterEntry(rosterJson, ordinal) {
  const roster = typeof rosterJson === 'string' ? JSON.parse(rosterJson) : rosterJson;
  if (!Array.isArray(roster) || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= roster.length) {
    throw new Error('LIFECYCLE_IMMUTABLE');
  }
  return roster[ordinal];
}

function lifecycleRosterRequestJson(rosterJson, ordinal) {
  const entry = lifecycleRosterEntry(rosterJson, ordinal);
  return canonicalJson(entry.request);
}

function lifecycleBackfill(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(lifecycle_operations)').all().map(row => row.name));
  if (!columns.has('roster_json')) db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN roster_json TEXT NOT NULL DEFAULT '[]'`);
  if (!columns.has('roster_digest')) db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN roster_digest TEXT NOT NULL DEFAULT ''`);
  if (!columns.has('finalized')) db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0`);

  const parents = db.prepare('SELECT operation_id FROM lifecycle_operations ORDER BY operation_id').all();
  for (const { operation_id: operationId } of parents) {
    const children = db.prepare('SELECT * FROM lifecycle_operation_children WHERE operation_id=? ORDER BY ordinal').all(operationId);
    if (children.length === 0) continue;
    const roster = children.map((child, ordinal) => ({
      ordinal,
      layer: child.layer,
      operation: child.operation_kind,
      processId: child.process_id,
      requestId: child.request_id,
      request: lifecycleParseJson(child.request_json),
    }));
    if (roster.some(entry => !entry.request)) throw new Error('LIFECYCLE_IMMUTABLE');
    const rosterJson = canonicalJson(roster);
    const rosterDigest = lifecycleRosterDigest(operationId, roster);
    db.prepare('UPDATE lifecycle_operations SET roster_json=?,roster_digest=?,finalized=1 WHERE operation_id=?')
      .run(rosterJson, rosterDigest, operationId);
  }
}

function lifecycleInstallGuards(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_insert_guard
      BEFORE INSERT ON lifecycle_operations
      WHEN NEW.finalized <> 0 OR NEW.status <> 'pending' OR NEW.current_ordinal <> 0
        OR NEW.result_json IS NOT NULL
        OR NEW.roster_digest <> qe_lifecycle_roster_digest_v1(NEW.operation_id, NEW.roster_json)
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_update_guard
      BEFORE UPDATE ON lifecycle_operations
      WHEN NEW.slug <> OLD.slug OR NEW.operation_id <> OLD.operation_id OR NEW.semantic_key <> OLD.semantic_key
        OR NEW.kind <> OLD.kind OR NEW.payload_json <> OLD.payload_json OR NEW.roster_json <> OLD.roster_json
        OR NEW.roster_digest <> OLD.roster_digest OR NEW.created_at <> OLD.created_at
        OR (OLD.finalized = 0 AND NEW.finalized <> 1)
        OR (OLD.finalized = 1 AND NEW.finalized <> OLD.finalized AND NEW.finalized <> 1)
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_delete_guard
      BEFORE DELETE ON lifecycle_operations BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operation_children_insert_guard
      BEFORE INSERT ON lifecycle_operation_children
      WHEN NOT EXISTS(SELECT 1 FROM lifecycle_operations p WHERE p.operation_id = NEW.operation_id AND p.finalized = 0)
        OR NEW.status <> 'pending' OR NEW.attempt <> 0 OR NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
        OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operation_children_update_guard
      BEFORE UPDATE ON lifecycle_operation_children
      WHEN EXISTS(SELECT 1 FROM lifecycle_operations p WHERE p.operation_id = NEW.operation_id AND p.finalized = 0)
        OR NEW.operation_id <> OLD.operation_id OR NEW.ordinal <> OLD.ordinal OR NEW.layer <> OLD.layer
        OR NEW.operation_kind <> OLD.operation_kind OR NEW.process_id <> OLD.process_id OR NEW.request_id <> OLD.request_id
        OR NEW.request_json <> OLD.request_json
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operation_children_delete_guard
      BEFORE DELETE ON lifecycle_operation_children BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS qe_schema_seals_insert_guard
      BEFORE INSERT ON qe_schema_seals
      WHEN NEW.name = '${LIFECYCLE_SEAL_NAME}' AND EXISTS(SELECT 1 FROM qe_schema_seals WHERE name = NEW.name)
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS qe_schema_seals_no_update
      BEFORE UPDATE ON qe_schema_seals
      WHEN OLD.name = '${LIFECYCLE_SEAL_NAME}' OR NEW.name = '${LIFECYCLE_SEAL_NAME}'
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS qe_schema_seals_no_delete
      BEFORE DELETE ON qe_schema_seals
      WHEN OLD.name = '${LIFECYCLE_SEAL_NAME}'
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;
  `);
}

function openLifecycleDb(cwd) {
  const db = openSqlite(cwd, { timeoutMs: 5000 });
  if (!db) return null;
  try {
    lifecycleSchema(db);
    db.function('qe_lifecycle_roster_digest_v1', { deterministic: true }, (operationId, rosterJson) => lifecycleRosterDigest(String(operationId), JSON.parse(String(rosterJson))));
    db.function('qe_lifecycle_roster_entry_v1', { deterministic: true }, (rosterJson, ordinal) => canonicalJson(lifecycleRosterEntry(String(rosterJson), Number(ordinal))));
    db.function('qe_lifecycle_roster_request_v1', { deterministic: true }, (rosterJson, ordinal) => lifecycleRosterRequestJson(String(rosterJson), Number(ordinal)));
    lifecycleBackfill(db);
    lifecycleInstallGuards(db);
    return db;
  }
  catch { closeSqlite(db); return null; }
}

function lifecycleParseJson(value) {
  try { return value == null ? null : JSON.parse(value); } catch { return null; }
}

function lifecycleChildView(row) {
  return {
    ordinal: row.ordinal,
    layer: row.layer,
    operation: row.operation_kind,
    processId: row.process_id,
    requestId: row.request_id,
    request: lifecycleParseJson(row.request_json),
    status: row.status,
    attempt: row.attempt,
    claim: row.claim_token == null ? null : {
      owner: row.claim_owner, token: row.claim_token, leaseUntil: row.lease_until,
    },
    resultRef: lifecycleParseJson(row.result_ref_json),
  };
}

function lifecycleOperationFromDb(db, operationId) {
  const row = db.prepare('SELECT * FROM lifecycle_operations WHERE operation_id=?').get(operationId);
  if (!row) return null;
  const children = db.prepare('SELECT * FROM lifecycle_operation_children WHERE operation_id=? ORDER BY ordinal')
    .all(operationId).map(lifecycleChildView);
  return {
    slug: row.slug,
    operationId: row.operation_id,
    semanticKey: row.semantic_key,
    kind: row.kind,
    payload: lifecycleParseJson(row.payload_json),
    intentDigest: row.intent_digest,
    status: row.status,
    currentOrdinal: row.current_ordinal,
    result: lifecycleParseJson(row.result_json),
    children,
  };
}

function lifecycleRequestId(slug, operationId, ordinal, child) {
  return sha256(canonicalJson([
    'qe-lifecycle-child-v1', slug, operationId, ordinal,
    child.layer, child.operation, child.processId,
  ]));
}

function normalizeLifecycleChild(raw, ordinal, slug, operationId) {
  if (!lifecyclePlainObject(raw)) throw new TypeError('child');
  const common = lifecycleBoundedString(raw.layer, 16) && LIFECYCLE_LAYERS.has(raw.layer)
    && raw.operation && lifecycleBoundedString(raw.processId, 128, LIFECYCLE_PROCESS_RE);
  if (!common) throw new TypeError('child');
  let semantic;
  if (raw.operation === 'initialize' && lifecycleExact(raw, ['layer', 'operation', 'processId'])) {
    semantic = { ordinal, layer: raw.layer, operation: raw.operation, processId: raw.processId };
  } else if (raw.operation === 'transition'
    && lifecycleExact(raw, ['layer', 'operation', 'processId', 'to', 'expectedRevision', 'attestations', 'humanAcceptance'])
    && lifecycleBoundedString(raw.to, 64)
    && Number.isSafeInteger(raw.expectedRevision) && raw.expectedRevision >= 0) {
    semantic = lifecycleClone({
      ordinal, layer: raw.layer, operation: raw.operation, processId: raw.processId,
      to: raw.to, expectedRevision: raw.expectedRevision,
      attestations: raw.attestations, humanAcceptance: raw.humanAcceptance,
    });
  } else throw new TypeError('child');
  const requestId = lifecycleRequestId(slug, operationId, ordinal, semantic);
  const request = semantic.operation === 'initialize'
    ? { processId: semantic.processId, requestId }
    : {
        processId: semantic.processId, requestId, to: semantic.to,
        expectedRevision: semantic.expectedRevision, attestations: semantic.attestations,
        humanAcceptance: semantic.humanAcceptance,
      };
  if (Buffer.byteLength(canonicalJson(request), 'utf8') > LIFECYCLE_MAX_JSON) throw new TypeError('child-size');
  return { semantic, requestId, request };
}

function normalizeLifecycleCreate(slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId', 'semanticKey', 'kind', 'payload', 'children'])
    || !LIFECYCLE_UUID_RE.test(input.operationId)
    || !lifecycleBoundedString(input.semanticKey, 256)
    || !lifecycleBoundedString(input.kind, 64)
    || !Array.isArray(input.children) || input.children.length < 1 || input.children.length > LIFECYCLE_MAX_CHILDREN) return null;
  try {
    const payload = lifecycleClone(input.payload);
    if (Buffer.byteLength(canonicalJson(payload), 'utf8') > LIFECYCLE_MAX_JSON) return null;
    const normalized = input.children.map((child, ordinal) => normalizeLifecycleChild(child, ordinal, slug, input.operationId));
    const orderedChildren = normalized.map(item => item.semantic);
    const intent = ['qe-lifecycle-intent-v1', 1, slug, input.semanticKey, input.kind, payload, orderedChildren];
    const roster = normalized.map((item, ordinal) => ({
      ordinal,
      layer: item.semantic.layer,
      operation: item.semantic.operation,
      processId: item.semantic.processId,
      requestId: item.requestId,
      request: item.request,
    }));
    const aggregate = canonicalJson({
      operationId: input.operationId, semanticKey: input.semanticKey, kind: input.kind,
      payload, children: normalized.map(item => ({ ...item.semantic, requestId: item.requestId, request: item.request })),
    });
    if (Buffer.byteLength(aggregate, 'utf8') > LIFECYCLE_MAX_AGGREGATE) return null;
    return { operationId: input.operationId, semanticKey: input.semanticKey, kind: input.kind,
      payload, normalized, roster, intentDigest: sha256(canonicalJson(intent)) };
  } catch { return null; }
}

/** Persist one closed composite intent and its complete ordered roster before any claim. */
export function createLifecycleOperation(cwd, slug, input) {
  const captured = normalizeLifecycleCreate(slug, input);
  if (!captured) return lifecycleError('INVALID_INPUT');
  const db = openLifecycleDb(cwd);
  if (!db) return lifecycleError('STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const semantic = db.prepare('SELECT operation_id,intent_digest FROM lifecycle_operations WHERE slug=? AND semantic_key=?')
      .get(slug, captured.semanticKey);
    if (semantic) {
      if (semantic.intent_digest !== captured.intentDigest) {
        db.exec('ROLLBACK'); return lifecycleError('PAYLOAD_CONFLICT');
      }
      const operation = lifecycleOperationFromDb(db, semantic.operation_id);
      db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', operation };
    }
    const reusedId = db.prepare('SELECT 1 FROM lifecycle_operations WHERE operation_id=?').get(captured.operationId);
    if (reusedId) { db.exec('ROLLBACK'); return lifecycleError('PAYLOAD_CONFLICT'); }
    const now = Date.now();
    db.prepare(`INSERT INTO lifecycle_operations
      (slug,operation_id,semantic_key,kind,payload_json,intent_digest,roster_json,roster_digest,finalized,status,current_ordinal,result_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, captured.operationId, captured.semanticKey, captured.kind,
        canonicalJson(captured.payload), captured.intentDigest,
        canonicalJson(captured.roster), lifecycleRosterDigest(captured.operationId, captured.roster),
        0, 'pending', 0, null, now, now);
    lifecycleFault('create-after-parent');
    const insertChild = db.prepare(`INSERT INTO lifecycle_operation_children
      (operation_id,ordinal,layer,operation_kind,process_id,request_id,request_json,status,attempt,claim_owner,claim_token,lease_until,result_ref_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let ordinal = 0; ordinal < captured.normalized.length; ordinal += 1) {
      const item = captured.normalized[ordinal];
      insertChild.run(captured.operationId, ordinal, item.semantic.layer, item.semantic.operation,
        item.semantic.processId, item.requestId, canonicalJson(item.request), 'pending', 0, null, null, null, null);
    }
    db.prepare(`UPDATE lifecycle_operations SET finalized=1 WHERE operation_id=?`).run(captured.operationId);
    db.prepare(`INSERT OR IGNORE INTO qe_schema_seals(name,version,digest,installed_at) VALUES(?,?,?,?)`)
      .run(LIFECYCLE_SEAL_NAME, 1, lifecycleRosterDigest(captured.operationId, captured.roster), now);
    lifecycleFault('create-before-commit');
    db.exec('COMMIT');
    lifecycleFault('create-after-commit');
    return { ok: true, code: 'CREATED', operation: lifecycleOperationFromDb(db, captured.operationId) };
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError('STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

/** Read a closed lifecycle journal projection. */
export function getLifecycleOperation(cwd, slug, operationId) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !LIFECYCLE_UUID_RE.test(operationId)) return lifecycleError('INVALID_INPUT');
  const db = openLifecycleDb(cwd);
  if (!db) return lifecycleError('STORE_UNAVAILABLE');
  try {
    const operation = lifecycleOperationFromDb(db, operationId);
    if (!operation || operation.slug !== slug) return lifecycleError('NOT_FOUND');
    return { ok: true, code: 'FOUND', operation };
  } catch { return lifecycleError('STORE_UNAVAILABLE'); }
  finally { closeSqlite(db); }
}

function lifecycleAuditDecision(cwd, child) {
  const controller = createProcessControllerStore(cwd);
  if (!controller) return { code: 'STORE_UNAVAILABLE', decision: null };
  try {
    const rawRows = controller.audit(child.process_id);
    const head = controller.read(child.process_id);
    if (head.code === 'PROCESS_NOT_FOUND') {
      return rawRows.length === 0 ? { code: 'NONE', decision: null } : { code: 'CONTROLLER_AUDIT_INVALID', decision: null };
    }
    if (!head.ok) return { code: 'CONTROLLER_AUDIT_INVALID', decision: null };
    const candidates = rawRows.filter(row => row.request_key === child.request_id);
    if (candidates.length === 0) return { code: 'NONE', decision: null };
    if (candidates.length !== 1) return { code: 'CONTROLLER_AUDIT_INVALID', decision: null };
    const row = candidates[0];
    if (row.audit_seq > head.auditSeq) return { code: 'CONTROLLER_AUDIT_INVALID', decision: null };
    const event = lifecycleParseJson(row.event_json);
    const request = lifecycleParseJson(child.request_json);
    if (!event || event.processId !== child.process_id || event.layer !== child.layer
      || event.operation !== child.operation_kind || event.requestId !== child.request_id
      || canonicalJson(event.request) !== canonicalJson(request)
      || typeof event.allowed !== 'boolean' || !event.result
      || row.event_hash !== (row.audit_seq === head.auditSeq ? head.auditHash : row.event_hash)) {
      return { code: 'CONTROLLER_AUDIT_INVALID', decision: null };
    }
    return {
      code: 'FOUND',
      decision: {
        status: event.allowed ? 'committed' : 'denied',
        resultRef: {
          processId: event.processId, requestId: event.requestId, auditSeq: row.audit_seq,
          auditHash: row.event_hash, allowed: event.allowed, code: event.code,
          stateRevisionBefore: event.stateRevisionBefore, stateRevisionAfter: event.stateRevisionAfter,
          resultDigest: sha256(canonicalJson(event.result)),
        },
      },
    };
  } catch { return { code: 'CONTROLLER_AUDIT_INVALID', decision: null }; }
  finally { controller.close(); }
}

function lifecycleInternalRows(db, operationId) {
  const parent = db.prepare('SELECT * FROM lifecycle_operations WHERE operation_id=?').get(operationId);
  if (!parent) return null;
  const children = db.prepare('SELECT * FROM lifecycle_operation_children WHERE operation_id=? ORDER BY ordinal').all(operationId);
  return { parent, children };
}

function applyLifecycleDecision(db, rows, ordinal, decision, now) {
  const child = rows.children[ordinal];
  db.prepare(`UPDATE lifecycle_operation_children SET status=?,claim_owner=NULL,claim_token=NULL,
    lease_until=NULL,result_ref_json=? WHERE operation_id=? AND ordinal=?`)
    .run(decision.status, canonicalJson(decision.resultRef), rows.parent.operation_id, ordinal);
  lifecycleFault('settle-after-child');
  if (decision.status === 'denied') {
    const suffix = rows.children.slice(ordinal + 1);
    if (suffix.some(item => item.status !== 'pending')) throw new Error('ordered child invariant');
    db.prepare(`UPDATE lifecycle_operation_children SET status='cancelled'
      WHERE operation_id=? AND ordinal>? AND status='pending'`).run(rows.parent.operation_id, ordinal);
    const result = canonicalJson({ outcome: 'denied', ordinal, resultRef: decision.resultRef });
    db.prepare(`UPDATE lifecycle_operations SET status='denied',result_json=?,updated_at=? WHERE operation_id=?`)
      .run(result, now, rows.parent.operation_id);
    lifecycleFault('settle-after-parent');
    return;
  }
  const nextOrdinal = ordinal + 1;
  if (nextOrdinal === rows.children.length) {
    const result = canonicalJson({ outcome: 'committed', childCount: rows.children.length });
    db.prepare(`UPDATE lifecycle_operations SET status='committed',current_ordinal=?,result_json=?,updated_at=? WHERE operation_id=?`)
      .run(nextOrdinal, result, now, rows.parent.operation_id);
  } else {
    db.prepare(`UPDATE lifecycle_operations SET status='running',current_ordinal=?,updated_at=? WHERE operation_id=?`)
      .run(nextOrdinal, now, rows.parent.operation_id);
  }
  lifecycleFault('settle-after-parent');
}

function lifecycleChildSnapshot(cwd, slug, operationId, ordinal) {
  const db = openLifecycleDb(cwd);
  if (!db) return { error: 'STORE_UNAVAILABLE' };
  try {
    const rows = lifecycleInternalRows(db, operationId);
    if (!rows || rows.parent.slug !== slug || !rows.children[ordinal]) return { error: 'NOT_FOUND' };
    return { row: rows.children[ordinal] };
  } catch { return { error: 'STORE_UNAVAILABLE' }; }
  finally { closeSqlite(db); }
}

/** Claim only the current ordered child, reconciling a lost controller response first. */
export function claimLifecycleChild(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId', 'ordinal', 'owner', 'leaseMs'])
    || !LIFECYCLE_UUID_RE.test(input.operationId) || !Number.isSafeInteger(input.ordinal) || input.ordinal < 0
    || !lifecycleBoundedString(input.owner, 128) || !Number.isSafeInteger(input.leaseMs)
    || input.leaseMs < LIFECYCLE_MIN_LEASE_MS || input.leaseMs > LIFECYCLE_MAX_LEASE_MS) return lifecycleError('INVALID_INPUT');
  const snapshot = lifecycleChildSnapshot(cwd, slug, input.operationId, input.ordinal);
  if (snapshot.error) return lifecycleError(snapshot.error);
  const audit = lifecycleAuditDecision(cwd, snapshot.row);
  if (audit.code === 'CONTROLLER_AUDIT_INVALID' || audit.code === 'STORE_UNAVAILABLE') return lifecycleError(audit.code);
  const db = openLifecycleDb(cwd);
  if (!db) return lifecycleError('STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const rows = lifecycleInternalRows(db, input.operationId);
    if (!rows || rows.parent.slug !== slug || !rows.children[input.ordinal]) { db.exec('ROLLBACK'); return lifecycleError('NOT_FOUND'); }
    const child = rows.children[input.ordinal];
    if (LIFECYCLE_TERMINAL_PARENT.has(rows.parent.status) || LIFECYCLE_TERMINAL_CHILD.has(child.status)) {
      const operation = lifecycleOperationFromDb(db, input.operationId); db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', child: operation.children[input.ordinal] };
    }
    if (rows.parent.current_ordinal !== input.ordinal) { db.exec('ROLLBACK'); return lifecycleError('ORDER_VIOLATION'); }
    const now = Date.now();
    if (audit.decision) {
      applyLifecycleDecision(db, rows, input.ordinal, audit.decision, now);
      db.exec('COMMIT');
      const operation = lifecycleOperationFromDb(db, input.operationId);
      return { ok: true, code: 'RECONCILED', child: operation.children[input.ordinal] };
    }
    if (child.status === 'claimed' && child.lease_until > now) {
      if (child.claim_owner !== input.owner) { db.exec('ROLLBACK'); return lifecycleError('CHILD_CAS_CONFLICT'); }
      const view = lifecycleChildView(child); db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', child: view };
    }
    if (!['pending', 'unavailable', 'claimed'].includes(child.status)) { db.exec('ROLLBACK'); return lifecycleError('CHILD_CAS_CONFLICT'); }
    const token = randomUUID();
    const changed = db.prepare(`UPDATE lifecycle_operation_children SET status='claimed',attempt=attempt+1,
      claim_owner=?,claim_token=?,lease_until=? WHERE operation_id=? AND ordinal=? AND status=? AND attempt=?`)
      .run(input.owner, token, now + input.leaseMs, input.operationId, input.ordinal, child.status, child.attempt);
    if (changed.changes !== 1) { db.exec('ROLLBACK'); return lifecycleError('CHILD_CAS_CONFLICT'); }
    lifecycleFault('claim-after-child');
    db.prepare(`UPDATE lifecycle_operations SET status='running',updated_at=? WHERE operation_id=?`).run(now, input.operationId);
    lifecycleFault('claim-before-commit');
    db.exec('COMMIT');
    lifecycleFault('claim-after-commit');
    const operation = lifecycleOperationFromDb(db, input.operationId);
    return { ok: true, code: 'CLAIMED', child: operation.children[input.ordinal] };
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError('STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

/** Settle a claimed child exclusively from an authoritative per-process audit row. */
export function settleLifecycleChild(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId', 'ordinal', 'claimToken'])
    || !LIFECYCLE_UUID_RE.test(input.operationId) || !Number.isSafeInteger(input.ordinal) || input.ordinal < 0
    || !LIFECYCLE_UUID_RE.test(input.claimToken)) return lifecycleError('INVALID_INPUT');
  const snapshot = lifecycleChildSnapshot(cwd, slug, input.operationId, input.ordinal);
  if (snapshot.error) return lifecycleError(snapshot.error);
  const audit = lifecycleAuditDecision(cwd, snapshot.row);
  if (audit.code === 'CONTROLLER_AUDIT_INVALID' || audit.code === 'STORE_UNAVAILABLE') return lifecycleError(audit.code);
  const db = openLifecycleDb(cwd);
  if (!db) return lifecycleError('STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const rows = lifecycleInternalRows(db, input.operationId);
    if (!rows || rows.parent.slug !== slug || !rows.children[input.ordinal]) { db.exec('ROLLBACK'); return lifecycleError('NOT_FOUND'); }
    const child = rows.children[input.ordinal];
    if (LIFECYCLE_TERMINAL_CHILD.has(child.status)) {
      const operation = lifecycleOperationFromDb(db, input.operationId); db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', child: operation.children[input.ordinal], operation };
    }
    if (child.status !== 'claimed' || child.claim_token !== input.claimToken
      || rows.parent.current_ordinal !== input.ordinal) { db.exec('ROLLBACK'); return lifecycleError('CHILD_CAS_CONFLICT'); }
    const now = Date.now();
    if (!audit.decision) {
      db.prepare(`UPDATE lifecycle_operation_children SET status='unavailable',claim_owner=NULL,
        claim_token=NULL,lease_until=NULL WHERE operation_id=? AND ordinal=?`).run(input.operationId, input.ordinal);
      db.prepare(`UPDATE lifecycle_operations SET status='running',updated_at=? WHERE operation_id=?`).run(now, input.operationId);
    } else applyLifecycleDecision(db, rows, input.ordinal, audit.decision, now);
    lifecycleFault('settle-before-commit');
    db.exec('COMMIT');
    lifecycleFault('settle-after-commit');
    const operation = lifecycleOperationFromDb(db, input.operationId);
    return { ok: true, code: 'RECORDED', child: operation.children[input.ordinal], operation };
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError('STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

/** Reconcile the current child after restart without issuing a controller call. */
export function reconcileLifecycleOperation(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId'])
    || !LIFECYCLE_UUID_RE.test(input.operationId)) return lifecycleError('INVALID_INPUT');
  const current = getLifecycleOperation(cwd, slug, input.operationId);
  if (!current.ok) return current;
  if (LIFECYCLE_TERMINAL_PARENT.has(current.operation.status)) {
    return { ok: true, code: 'UNCHANGED', operation: current.operation };
  }
  const ordinal = current.operation.currentOrdinal;
  const snapshot = lifecycleChildSnapshot(cwd, slug, input.operationId, ordinal);
  if (snapshot.error) return lifecycleError(snapshot.error);
  const audit = lifecycleAuditDecision(cwd, snapshot.row);
  if (audit.code === 'CONTROLLER_AUDIT_INVALID' || audit.code === 'STORE_UNAVAILABLE') return lifecycleError(audit.code);
  const db = openLifecycleDb(cwd);
  if (!db) return lifecycleError('STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const rows = lifecycleInternalRows(db, input.operationId);
    if (!rows || rows.parent.slug !== slug) { db.exec('ROLLBACK'); return lifecycleError('NOT_FOUND'); }
    if (LIFECYCLE_TERMINAL_PARENT.has(rows.parent.status)) {
      const operation = lifecycleOperationFromDb(db, input.operationId); db.exec('COMMIT');
      return { ok: true, code: 'UNCHANGED', operation };
    }
    if (rows.parent.current_ordinal !== ordinal) { db.exec('ROLLBACK'); return lifecycleError('CHILD_CAS_CONFLICT'); }
    const child = rows.children[ordinal];
    const now = Date.now();
    let changed = false;
    if (audit.decision) {
      applyLifecycleDecision(db, rows, ordinal, audit.decision, now); changed = true;
    } else if (child.status === 'claimed' && child.lease_until <= now) {
      db.prepare(`UPDATE lifecycle_operation_children SET status='unavailable',claim_owner=NULL,
        claim_token=NULL,lease_until=NULL WHERE operation_id=? AND ordinal=?`).run(input.operationId, ordinal);
      db.prepare(`UPDATE lifecycle_operations SET status='running',updated_at=? WHERE operation_id=?`).run(now, input.operationId);
      changed = true;
    }
    db.exec('COMMIT');
    return { ok: true, code: changed ? 'RECONCILED' : 'UNCHANGED', operation: lifecycleOperationFromDb(db, input.operationId) };
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError('STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
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
  const relGoals = join(PLANS_DIR, slug, 'goals.json');
  if (canonicalPlanBackendConflict(cwd, slug, relGoals)) {
    return { ok: false, code: 'CANONICAL_BACKEND_CONFLICT', reason: 'stale disk goals.json without DB row' };
  }
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) return { ok: false, code: 'CANONICAL_STORE_UNAVAILABLE' };
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = canonicalPlanReadRow(db, relGoals);
      if (current) { db.exec('COMMIT'); return { skipped: true, reason: 'goals.json exists' }; }
      let goals = explicitGoals.map((g, i) => {
        const [title, objective] = String(g).split('::');
        return { id: `G${String(i + 1).padStart(3, '0')}`, title: (title || g).trim(),
          objective: (objective || title || g).trim(), status: 'pending', attempts: 0,
          phase: 'Phase 1', wave: '-' };
      });
      if (goals.length === 0) goals = parseRoadmapGoals(cwd, slug);
      const doc = { planSlug: slug, schema: 1, createdAt: nowIso(), goals };
      const goalsText = canonicalPlanSerializeJson(doc);
      canonicalPlanWriteRow(db, relGoals, goalsText, null);
      const ledgerRel = join(PLANS_DIR, slug, 'ledger.jsonl');
      for (const g of goals) {
        canonicalPlanAppendLedger(db, ledgerRel, { ts: nowIso(), event: 'created', goalId: g.id, status: 'pending', evidence: '', attempt: 0 });
      }
      db.exec('COMMIT');
      return { created: goals.length };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
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
 * Fail-closed enforcement (only-active-mutable) is Phase 2 (Qgenerate-spec); Phase 1
 * keeps the primitive permissive but records every transition.
 */
export function append(cwd, slug, { goalId, event, status, evidence = '', allowComplete = false }) {
  if (!EVENT_ENUM.includes(event)) throw new Error(`invalid event: ${event}`);
  if (status && !STATUS_ENUM.includes(status)) throw new Error(`invalid status: ${status}`);
  if (status === 'complete' && !allowComplete) throw new Error('Goal completion must use advance --action complete');
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = JSON.parse(canonicalPlanDecodeRow(current));
      const goal = doc.goals.find(g => g.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      if (event === 'started') goal.attempts += 1;
      if (status) goal.status = status;
      const nextDoc = canonicalPlanSerializeJson(doc);
      canonicalPlanWriteRow(db, relGoals, nextDoc, current.sha256);
      const record = { ts: nowIso(), event, goalId, status: status || goal.status, evidence, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, record);
      db.exec('COMMIT');
      return { goalId, status: goal.status, attempts: goal.attempts };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
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

function readJsonFile(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label} must be readable JSON`); }
}

function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function contractHash(contract) { return createHash('sha256').update(JSON.stringify(contract)).digest('hex'); }

const RISK_CATEGORIES = new Set([
  'none', 'authentication', 'authorization', 'payment', 'deployment',
  'data-migration', 'destructive-data-change', 'external-integration', 'security',
]);

const RISK_SIGNALS = [
  ['authentication', /\bauth(?:entication)?\b|로그인|인증/iu],
  ['authorization', /\bauthori[sz]ation\b|\bpermission(?:s)?\b|권한/iu],
  ['payment', /\bpayment(?:s)?\b|\bbilling\b|결제/iu],
  ['deployment', /\bdeploy(?:ment)?\b|\brelease\b|배포|릴리스/iu],
  ['data-migration', /\bmigrat(?:e|ion)\b|\bschema\b|\bdatabase\b|\bdb\b|마이그레이션|스키마|데이터베이스/iu],
  ['destructive-data-change', /\bdelete\b|\bpurge\b|\bdrop\b|삭제|파기/iu],
  ['external-integration', /\bexternal\s+api\b|\bthird[- ]party\b|외부\s*(?:api|연동)|서드파티/iu],
  ['security', /\bsecurity\b|\bencrypt(?:ion)?\b|보안|암호화/iu],
];

const MAX_GOAL_REQUIREMENTS = 3;
const MAX_GOAL_SCENARIOS = 2;
const MAX_GOAL_PATHS = 5;
const CODE_PATH_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte)$/iu;
const MACHINE_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GOAL_COMMAND_TIMEOUT_MS = 120_000;
const intrinsicStringify = JSON.stringify;

function normalizedText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

function contractTouchesCode(contract) {
  return contract.goalShape.allowedPaths.some(path => CODE_PATH_RE.test(path));
}

function contractHasBehavioralEvidence(contract) {
  return [...contract.requirements, ...contract.scenarios, contract.regression]
    .some(item => isBehavioralEvidenceCommand(item.command));
}

function requiredRiskCategories(goalObjective) {
  return RISK_SIGNALS
    .filter(([, pattern]) => pattern.test(String(goalObjective ?? '')))
    .map(([category]) => category);
}

function idsAreUnique(items) {
  const ids = items.map(item => item?.id);
  return ids.every(nonEmpty) && new Set(ids).size === ids.length;
}

function isBoundedPath(value) {
  return typeof value === 'string' && value.length <= 180 && value.trim() !== '' &&
    !value.startsWith('/') && !value.includes('..') && !/[\\*]/.test(value);
}

/**
 * A Goal is deliberately smaller than a Phase: one observable outcome, a
 * bounded write surface, and explicit non-goals prevent a broad request from
 * being certified by a shallow set of tests.
 */
function validateGoalShape(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) throw new Error('acceptance contract requires goalShape');
  if (!nonEmpty(shape.primaryOutcome) || !nonEmpty(shape.completionMetric)) {
    throw new Error('goalShape requires one primaryOutcome and one completionMetric');
  }
  if (!Array.isArray(shape.allowedPaths) || shape.allowedPaths.length === 0 || shape.allowedPaths.length > MAX_GOAL_PATHS ||
      !shape.allowedPaths.every(isBoundedPath) || new Set(shape.allowedPaths).size !== shape.allowedPaths.length) {
    throw new Error(`goalShape allowedPaths must contain 1-${MAX_GOAL_PATHS} unique relative paths without globs`);
  }
  if (!Array.isArray(shape.nonGoals) || shape.nonGoals.length === 0 || !shape.nonGoals.every(nonEmpty)) {
    throw new Error('goalShape requires at least one explicit nonGoal');
  }
  if (!Array.isArray(shape.dependencies) || !shape.dependencies.every(nonEmpty)) {
    throw new Error('goalShape dependencies must be an array of non-empty Goal IDs or []');
  }
  return shape;
}

/**
 * Validate the contract written before a Goal starts.  It deliberately names
 * scenarios and requirements separately: a passing test alone must not become
 * a retroactive definition of user value.
 */
function validateAcceptanceContract(contract, goalId, goalObjective = '') {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('acceptance contract must be an object');
  if (contract.schema !== 1 || contract.goalId !== goalId) throw new Error(`acceptance contract must declare schema: 1 and goalId: ${goalId}`);
  validateGoalShape(contract.goalShape);
  if (!Array.isArray(contract.requirements) || contract.requirements.length === 0 || !idsAreUnique(contract.requirements) ||
      !contract.requirements.every(item => nonEmpty(item.criterion) && isGoalRunnerCommand(item.command))) throw new Error('acceptance contract requires uniquely identified requirements with criteria and runnable commands');
  if (contract.requirements.length > MAX_GOAL_REQUIREMENTS) throw new Error(`acceptance contract allows at most ${MAX_GOAL_REQUIREMENTS} requirements; split broad work into Goals`);
  if (!Array.isArray(contract.scenarios) || contract.scenarios.length === 0 || !idsAreUnique(contract.scenarios) ||
      !contract.scenarios.every(item => item.kind === 'user-journey' && nonEmpty(item.scenario) && nonEmpty(item.expected) && isGoalRunnerCommand(item.command))) throw new Error('acceptance contract requires uniquely identified user-journey scenarios with expected results and runnable commands');
  if (contract.scenarios.length > MAX_GOAL_SCENARIOS) throw new Error(`acceptance contract allows at most ${MAX_GOAL_SCENARIOS} user journeys; split broad work into Goals`);
  if (!contract.regression || !nonEmpty(contract.regression.scope) || !isGoalRunnerCommand(contract.regression.command)) throw new Error('acceptance contract requires regression scope and runnable command');
  if (contractTouchesCode(contract) && !contractHasBehavioralEvidence(contract)) {
    throw new Error('code-changing Goal acceptance requires at least one behavioral node --test command');
  }
  if (!contract.humanAcceptance || typeof contract.humanAcceptance.required !== 'boolean') throw new Error('acceptance contract requires humanAcceptance.required');
  if (!contract.goalAlignment || normalizedText(contract.goalAlignment.objective) !== normalizedText(goalObjective) || !nonEmpty(contract.goalAlignment.rationale)) {
    throw new Error('acceptance contract must preserve the Goal objective verbatim and explain requirement/scenario coverage');
  }
  const risk = contract.riskAssessment;
  if (!risk || !Array.isArray(risk.categories) || risk.categories.length === 0 || !new Set(risk.categories).size ||
      !risk.categories.every(category => RISK_CATEGORIES.has(category)) ||
      (risk.categories.includes('none') && risk.categories.length !== 1) || !nonEmpty(risk.rationale)) {
    throw new Error('acceptance contract requires a valid risk assessment with categories and rationale');
  }
  const requiredRisks = requiredRiskCategories(goalObjective);
  if (requiredRisks.some(category => !risk.categories.includes(category))) {
    throw new Error(`acceptance contract risk assessment omits detected Goal risk: ${requiredRisks.filter(category => !risk.categories.includes(category)).join(', ')}`);
  }
  if (risk.categories.some(category => category !== 'none') && !contract.humanAcceptance.required) {
    throw new Error('risk-bearing Goals require humanAcceptance.required: true');
  }
  if (Object.prototype.hasOwnProperty.call(contract, 'traceability')) {
    const traceability = validateTraceabilityDefinition(contract);
    if (!traceability.ok) throw new Error(`acceptance contract traceability is invalid: ${traceability.code}`);
  }
  return contract;
}

function isGoalRunnerCommand(command) {
  return typeof command === 'string' && !/^\s*cd\s/i.test(command) && isAllowlistCommand(command);
}

function commandResult(cwd, command) {
  const parts = command.trim().split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), { cwd, encoding: 'utf8', timeout: GOAL_COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return { command, exitCode: Number.isInteger(result.status) ? result.status : null, signal: result.signal || null,
    passed: !result.error && result.status === 0, outputHash: createHash('sha256').update(output).digest('hex'), executedAt: nowIso() };
}

function legacyRunEvidenceId(slug, goalId, role, rawBytes) {
  return sha256(canonicalJson(['qe-plan-run-legacy-v1', slug, goalId, role, sha256(rawBytes)]));
}

function archiveRunEvidenceVersion(cwd, slug, goalId, role, rawBytes) {
  const parsed = readJsonFileLike(rawBytes);
  const runId = parsed?.runId && typeof parsed.runId === 'string'
    ? parsed.runId
    : legacyRunEvidenceId(slug, goalId, role, rawBytes);
  const historyPath = runEvidenceHistoryPath(cwd, slug, goalId, role, runId);
  if (existsSync(historyPath)) {
    const existing = readFileSync(historyPath, 'utf8');
    if (existing !== rawBytes) throw new Error('evidence run identity conflicts with existing history');
    return runId;
  }
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  if (!existsSync(join(evidenceDir(cwd, slug), 'runs'))) mkdirSync(join(evidenceDir(cwd, slug), 'runs'), { recursive: true });
  writeFileSync(historyPath, rawBytes, 'utf8');
  return runId;
}

function readJsonFileLike(rawBytes) {
  try { return JSON.parse(rawBytes); } catch { return null; }
}

/** Execute every locked Goal command and persist machine-collected evidence. */
export function runGoalEvidence(cwd, slug, { goalId, role, verifier = '', sessionId: explicitSessionId = '' }) {
  if (!['implementation', 'verification'].includes(role)) throw new Error('run role must be implementation or verification');
  if (role === 'verification' && !nonEmpty(verifier)) throw new Error('verification run requires a verifier identity');
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relAcceptance = join(PLANS_DIR, slug, 'evidence', `${goalId}.acceptance.json`);
      const relCurrent = join(PLANS_DIR, slug, 'evidence', `${goalId}.${role}-run.json`);
      const relHistoryDir = join(PLANS_DIR, slug, 'evidence', 'runs');
      const currentRow = canonicalPlanReadRow(db, relGoals);
      if (!currentRow) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = JSON.parse(canonicalPlanDecodeRow(currentRow));
      const goal = doc.goals.find(item => item.id === goalId);
      if (!goal || goal.status !== 'active') { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', 'evidence runs require the active Goal'); }
      const sessionId = explicitSessionId || readCurrentSessionId(cwd);
      if (!sessionId) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', 'machine evidence run requires a current QE session id'); }
      if (!MACHINE_SESSION_RE.test(sessionId)) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', 'machine evidence run requires a valid full QE session id'); }
      const contract = validateAcceptanceContract(canonicalPlanReadJson(cwd, relAcceptance), goalId, goal.objective);
      const acceptanceRow = canonicalPlanReadRow(db, relAcceptance);
      const acceptanceText = canonicalPlanDecodeRow(acceptanceRow);
      if (!acceptanceRow || !goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) {
        db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', 'acceptance contract changed after it was recorded');
      }
      const commands = [...contract.requirements, ...contract.scenarios, contract.regression]
        .map(item => item.command).filter((value, index, values) => values.indexOf(value) === index);
      const runs = commands.map(command => commandResult(cwd, command));
      const executedAt = nowIso();
      const invocationId = randomUUID();
      const record = {
        schema: 1,
        goalId,
        role,
        attempt: Number.isSafeInteger(goal.attempts) && goal.attempts >= 0 ? goal.attempts : 0,
        invocationId,
        sessionId,
        verifier: role === 'verification' ? verifier : null,
        contractHash: goal.acceptance.hash,
        runs,
        passed: runs.every(run => run.passed),
        executedAt,
      };
      record.runId = sha256(canonicalJson([
        'qe-plan-run-v1', slug, goalId, role, record.attempt, invocationId, record.contractHash,
        sessionId, record.verifier, runs, executedAt,
      ]));
      const recordText = canonicalPlanSerializeJson(record);
      const current = canonicalPlanReadRow(db, relCurrent);
      if (current) {
        const previousRaw = canonicalPlanDecodeRow(current);
        const historyRel = join(relHistoryDir, `${goalId}.${role}.${(JSON.parse(previousRaw).runId) || legacyRunEvidenceId(slug, goalId, role, previousRaw)}.json`);
        canonicalPlanWriteRow(db, historyRel, previousRaw, null);
      }
      canonicalPlanWriteRow(db, relCurrent, recordText, current?.sha256 || null);
      const event = { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `${role}-run=${join('evidence', `${goalId}.${role}-run.json`)}; passed=${record.passed}`, attempt: goal.attempts };
      const ledgerRel = join(PLANS_DIR, slug, 'ledger.jsonl');
      const appended = canonicalPlanAppendLedger(db, ledgerRel, event);
      const identity = sha256(canonicalJson(['qe-plan-run-write-v1', slug, goalId, role, record.runId, record.contractHash, relCurrent]));
      canonicalPlanIdentity(db, identity, 'runGoalEvidence', slug, goalId, relCurrent, record.runId, sha256(canonicalPlanSerializeJson(event)), appended.lineCount);
      db.exec('COMMIT');
      return { goalId, role, passed: record.passed, runs, runId: record.runId, invocationId, executedAt };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal || goal.status !== 'active') throw new Error('evidence runs require the active Goal');
  const sessionId = explicitSessionId || readCurrentSessionId(cwd);
  if (!sessionId) throw new Error('machine evidence run requires a current QE session id');
  if (!MACHINE_SESSION_RE.test(sessionId)) throw new Error('machine evidence run requires a valid full QE session id');
  const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, goalId), 'acceptance contract'), goalId, goal.objective);
  if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
  const commands = [...contract.requirements, ...contract.scenarios, contract.regression]
    .map(item => item.command).filter((value, index, values) => values.indexOf(value) === index);
  const runs = commands.map(command => commandResult(cwd, command));
  const executedAt = nowIso();
  const invocationId = randomUUID();
  const record = {
    schema: 1,
    goalId,
    role,
    attempt: Number.isSafeInteger(goal.attempts) && goal.attempts >= 0 ? goal.attempts : 0,
    invocationId,
    sessionId,
    verifier: role === 'verification' ? verifier : null,
    contractHash: goal.acceptance.hash,
    runs,
    passed: runs.every(run => run.passed),
    executedAt,
  };
  record.runId = sha256(canonicalJson([
    'qe-plan-run-v1', slug, goalId, role, record.attempt, invocationId, record.contractHash,
    sessionId, record.verifier, runs, executedAt,
  ]));
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  const currentPath = runEvidencePath(cwd, slug, goalId, role);
  if (existsSync(currentPath)) {
    const previousRaw = readFileSync(currentPath, 'utf8');
    archiveRunEvidenceVersion(cwd, slug, goalId, role, previousRaw);
  }
  atomicWriteJson(currentPath, record);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `${role}-run=${join('evidence', `${goalId}.${role}-run.json`)}; passed=${record.passed}`, attempt: goal.attempts });
  return { goalId, role, passed: record.passed, runs, runId: record.runId, invocationId, executedAt };
}

function requirePassingRuns(cwd, slug, goal, goalId) {
  let implementationSession = null;
  for (const role of ['implementation', 'verification']) {
    const file = runEvidencePath(cwd, slug, goalId, role);
    if (!existsSync(file)) throw new Error(`verified completion requires a ${role} machine evidence run`);
    const run = readJsonFile(file, `${role} evidence run`);
    if (run.schema !== 1 || run.goalId !== goalId || run.role !== role || !nonEmpty(run.sessionId) || run.contractHash !== goal.acceptance?.hash || run.passed !== true || !Array.isArray(run.runs) || run.runs.length === 0 || !run.runs.every(item => item.passed === true && nonEmpty(item.outputHash))) {
      throw new Error(`${role} machine evidence run is missing, stale, or failed`);
    }
    if (role === 'implementation') implementationSession = run.sessionId;
    if (role === 'verification' && (!nonEmpty(run.verifier) || run.sessionId === implementationSession)) throw new Error('verification evidence must come from a distinct QE session with a verifier identity');
  }
}

function evidenceCovers(contractItems, evidenceItems, label) {
  if (!Array.isArray(evidenceItems) || !idsAreUnique(evidenceItems)) throw new Error(`completion evidence requires uniquely identified ${label}`);
  const byId = new Map(evidenceItems.map(item => [item.id, item]));
  for (const item of contractItems) {
    const result = byId.get(item.id);
    if (!result || result.outcome !== 'pass' || !nonEmpty(result.evidence)) throw new Error(`completion evidence does not pass ${label} ${item.id}`);
  }
}

/** Validate a completion record against the pre-existing acceptance contract. */
function validateCompletionEvidence(evidence, contract, goalId, goalObjective = '') {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('completion evidence must be an object');
  if (evidence.schema !== 1 || evidence.goalId !== goalId) throw new Error(`completion evidence must declare schema: 1 and goalId: ${goalId}`);
  evidenceCovers(contract.requirements, evidence.requirements, 'requirements');
  evidenceCovers(contract.scenarios, evidence.scenarios, 'scenarios');
  if (!evidence.regression || evidence.regression.outcome !== 'pass' || !nonEmpty(evidence.regression.evidence)) throw new Error('completion evidence requires a passing regression result');
  const independent = evidence.independentVerification;
  if (!independent || !nonEmpty(independent.verifier) || independent.mode !== 'machine-reexecution' ||
      independent.outcome !== 'pass' || !nonEmpty(independent.evidence)) throw new Error('completion evidence requires passing independent verification');
  const alignment = evidence.goalAlignment;
  if (!alignment || alignment.outcome !== 'pass' || normalizedText(alignment.objective) !== normalizedText(goalObjective) ||
      alignment.verifier !== independent.verifier || !nonEmpty(alignment.evidence)) {
    throw new Error('completion evidence requires the independent verifier to pass Goal-to-evidence alignment');
  }
  const human = evidence.humanAcceptance;
  if (!human || (contract.humanAcceptance.required ? human.status !== 'passed' || !nonEmpty(human.evidence) : human.status !== 'not-required' && human.status !== 'passed')) {
    throw new Error('completion evidence does not satisfy human acceptance requirement');
  }
  if (!Array.isArray(evidence.limitations)) throw new Error('completion evidence requires limitations array (use [] when none)');
  return evidence;
}

/** Persist a pre-execution, user-outcome-oriented acceptance contract for a pending Goal. */
export function setGoalAcceptance(cwd, slug, { goalId, file }) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relAcceptance = join(PLANS_DIR, slug, 'evidence', `${goalId}.acceptance.json`);
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = JSON.parse(canonicalPlanDecodeRow(current));
      const goal = doc.goals?.find(item => item.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      if (goal.status !== 'pending') { db.exec('ROLLBACK'); throw new Error('acceptance contract can only be set before a Goal starts'); }
      const contract = validateAcceptanceContract(readJsonFile(file, 'acceptance contract'), goalId, goal.objective);
      const contractText = canonicalPlanSerializeJson(contract);
      const existingAcceptance = canonicalPlanReadRow(db, relAcceptance);
      if (existingAcceptance && canonicalPlanDecodeRow(existingAcceptance) !== contractText) {
        db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_CAS_CONFLICT', 'acceptance contract is immutable');
      }
      canonicalPlanWriteRow(db, relAcceptance, contractText, existingAcceptance?.sha256 || null);
      goal.acceptance = { status: 'defined', file: join('evidence', `${goalId}.acceptance.json`), hash: contractHash(contract) };
      const nextDoc = canonicalPlanSerializeJson(doc);
      canonicalPlanWriteRow(db, relGoals, nextDoc, current.sha256);
      const event = { ts: nowIso(), event: 'checkpoint', goalId, status: goal.status, evidence: `acceptance=${goal.acceptance.file}`, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, event);
      const identity = sha256(canonicalJson(['qe-plan-acceptance-write-v1', slug, goalId, goal.acceptance.file, goal.acceptance.hash]));
      canonicalPlanIdentity(db, identity, 'setGoalAcceptance', slug, goalId, relAcceptance, sha256(contractText), sha256(canonicalPlanSerializeJson(event)), appended.lineCount);
      db.exec('COMMIT');
      return { goalId, acceptance: goal.acceptance };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);
  if (goal.status !== 'pending') throw new Error('acceptance contract can only be set before a Goal starts');
  const contract = validateAcceptanceContract(readJsonFile(file, 'acceptance contract'), goalId, goal.objective);
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  atomicWriteJson(acceptancePath(cwd, slug, goalId), contract);
  goal.acceptance = { status: 'defined', file: join('evidence', `${goalId}.acceptance.json`), hash: contractHash(contract) };
  writeGoals(cwd, slug, doc);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'checkpoint', goalId, status: goal.status, evidence: `acceptance=${goal.acceptance.file}`, attempt: goal.attempts });
  return { goalId, acceptance: goal.acceptance };
}

/** Persist evidence only when it satisfies the Goal's immutable acceptance contract. */
export function recordGoalEvidence(cwd, slug, { goalId, file }) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relCompletion = join(PLANS_DIR, slug, 'evidence', `${goalId}.completion.json`);
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = JSON.parse(canonicalPlanDecodeRow(current));
      const goal = doc.goals?.find(item => item.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      if (goal.status !== 'active') { db.exec('ROLLBACK'); throw new Error('completion evidence can only be recorded for the active Goal'); }
      const contractFile = acceptancePath(cwd, slug, goalId);
      const contractRow = canonicalPlanReadRow(db, contractFile);
      if (!contractRow) { db.exec('ROLLBACK'); throw new Error('Goal has no acceptance contract'); }
      const contract = validateAcceptanceContract(canonicalPlanReadJson(cwd, contractFile), goalId, goal.objective);
      if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) { db.exec('ROLLBACK'); throw new Error('acceptance contract changed after it was recorded'); }
      const evidence = validateCompletionEvidence(readJsonFile(file, 'completion evidence'), contract, goalId, goal.objective);
      const proofText = canonicalPlanSerializeJson(evidence);
      const existing = canonicalPlanReadRow(db, relCompletion);
      if (existing && canonicalPlanDecodeRow(existing) !== proofText) {
        db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_CAS_CONFLICT', 'completion evidence is immutable');
      }
      requirePassingRuns(cwd, slug, goal, goalId);
      canonicalPlanWriteRow(db, relCompletion, proofText, existing?.sha256 || null);
      goal.completionEvidence = { status: 'recorded', file: join('evidence', `${goalId}.completion.json`) };
      canonicalPlanWriteRow(db, relGoals, canonicalPlanSerializeJson(doc), current.sha256);
      const event = { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `completion=${goal.completionEvidence.file}; verifier=${evidence.independentVerification.verifier}`, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, event);
      const identity = sha256(canonicalJson(['qe-plan-completion-write-v1', slug, goalId, relCompletion, sha256(proofText)]));
      canonicalPlanIdentity(db, identity, 'recordGoalEvidence', slug, goalId, relCompletion, sha256(proofText), sha256(canonicalPlanSerializeJson(event)), appended.lineCount);
      db.exec('COMMIT');
      return { goalId, completionEvidence: goal.completionEvidence };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);
  if (goal.status !== 'active') throw new Error('completion evidence can only be recorded for the active Goal');
  const contractFile = acceptancePath(cwd, slug, goalId);
  if (!existsSync(contractFile)) throw new Error('Goal has no acceptance contract');
  const contract = validateAcceptanceContract(readJsonFile(contractFile, 'acceptance contract'), goalId, goal.objective);
  if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
  const evidence = validateCompletionEvidence(readJsonFile(file, 'completion evidence'), contract, goalId, goal.objective);
  requirePassingRuns(cwd, slug, goal, goalId);
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  atomicWriteJson(completionEvidencePath(cwd, slug, goalId), evidence);
  goal.completionEvidence = { status: 'recorded', file: join('evidence', `${goalId}.completion.json`) };
  writeGoals(cwd, slug, doc);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `completion=${goal.completionEvidence.file}; verifier=${evidence.independentVerification.verifier}`, attempt: goal.attempts });
  return { goalId, completionEvidence: goal.completionEvidence };
}

/**
 * Advance the Plan-owned Goal queue by one safe lifecycle action.
 *
 * `next` starts the first pending Goal only when no Goal is active or blocked.
 * `complete` requires evidence for the sole active Goal and writes a reviewed,
 * provenance-linked knowledge page. This is the only normal write-back path.
 */
export function advanceGoal(cwd, slug, { action = 'next', evidence = '' } = {}) {
  const doc = readGoals(cwd, slug);
  if (!doc || !Array.isArray(doc.goals)) throw new Error(`no goals.json for slug ${slug}`);
  const active = doc.goals.find((goal) => goal.status === 'active');
  const blocked = doc.goals.find((goal) => goal.status === 'blocked');

  if (action === 'next') {
    if (active) return { action: 'continue', goal: { id: active.id, title: active.title } };
    if (blocked) return { action: 'blocked', goal: { id: blocked.id, title: blocked.title } };
    const next = doc.goals.find((goal) => goal.status === 'pending');
    if (!next) return { action: 'complete', total: doc.goals.length };
    if (!existsSync(acceptancePath(cwd, slug, next.id))) {
      return { action: 'needs-acceptance', goal: { id: next.id, title: next.title }, reason: 'Define user scenarios, requirement criteria, regression command, and human-acceptance need before starting.' };
    }
    const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, next.id), 'acceptance contract'), next.id, next.objective);
    if (!next.acceptance?.hash || next.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
    const result = append(cwd, slug, { goalId: next.id, event: 'started', status: 'active' });
    renderState(cwd, slug);
    return { action: 'started', goal: { id: next.id, title: next.title }, attempts: result.attempts };
  }

  if (action === 'complete') {
    if (!active) throw new Error('no active goal to complete');
    const evidenceFile = completionEvidencePath(cwd, slug, active.id);
    if (!existsSync(evidenceFile)) throw new Error('verified completion requires recorded acceptance, regression, and independent-verification evidence');
    const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, active.id), 'acceptance contract'), active.id, active.objective);
    if (!active.acceptance?.hash || active.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
    const proof = validateCompletionEvidence(readJsonFile(evidenceFile, 'completion evidence'), contract, active.id, active.objective);
    requirePassingRuns(cwd, slug, active, active.id);
    append(cwd, slug, { goalId: active.id, event: 'verified', status: 'complete', evidence: `completion=${join('evidence', `${active.id}.completion.json`)}`, allowComplete: true });
    const knowledge = writeVerifiedGoalKnowledge(cwd, { slug, goal: active, evidence: JSON.stringify(proof) });
    renderState(cwd, slug);
    return { action: 'completed', goal: { id: active.id, title: active.title }, knowledge };
  }

  if (action === 'block') {
    if (!active) throw new Error('no active goal to block');
    const reason = String(evidence || '').trim();
    if (!reason) throw new Error('blocking a goal requires evidence');
    append(cwd, slug, { goalId: active.id, event: 'blocker', status: 'blocked', evidence: reason });
    renderState(cwd, slug);
    return { action: 'blocked', goal: { id: active.id, title: active.title } };
  }

  throw new Error(`invalid advance action: ${action}`);
}

/** Render STATE.md's "## Phase Progress" block from goals.json (derived view). */
export function renderState(cwd, slug) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relState = join(PLANS_DIR, slug, 'STATE.md');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = JSON.parse(canonicalPlanDecodeRow(current));
      const allComplete = doc.goals.length > 0 && doc.goals.every(goal => goal.status === 'complete');
      const hasBlocker = doc.goals.some(goal => goal.status === 'blocked' || goal.status === 'failed');
      const planStatus = allComplete ? 'complete' : hasBlocker ? 'blocked' : 'active';
      const currentGoal = doc.goals.find(goal => goal.status === 'active')
        || doc.goals.find(goal => goal.status === 'blocked')
        || doc.goals.find(goal => goal.status === 'pending')
        || doc.goals.find(goal => goal.status === 'failed')
        || doc.goals.at(-1);
      const currentPhase = currentGoal?.phase || 'none';
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
      const prior = canonicalPlanReadText(cwd, relState) || `# STATE — ${slug}\n`;
      let next;
      if (/^Status:.*$/m.test(prior)) next = prior.replace(/^Status:.*$/m, `Status: ${planStatus}`);
      else next = prior.replace(/^(# .*\n)/, `$1\nStatus: ${planStatus}\n`);
      if (/^Current phase:.*$/m.test(next)) next = next.replace(/^Current phase:.*$/m, `Current phase: ${currentPhase}`);
      else next = next.replace(/^(Status:.*\n)/m, `$1Current phase: ${currentPhase}\n`);
      const idx = next.indexOf(PROGRESS_HEADING);
      if (idx === -1) next = next.replace(/\n*$/, '\n') + '\n' + block;
      else {
        const after = next.slice(idx + PROGRESS_HEADING.length);
        const nextHeading = after.search(/\n##\s/);
        const tail = nextHeading === -1 ? '' : after.slice(nextHeading);
        next = next.slice(0, idx) + block.replace(/\n*$/, '\n') + tail;
      }
      canonicalPlanWriteRow(db, relState, next, current?.sha256 || null);
      db.exec('COMMIT');
      return { state: join(cwd, relState), phases: byPhase.size };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const doc = readGoals(cwd, slug);
  if (!doc) throw new Error(`no goals.json for slug ${slug}`);
  const allComplete = doc.goals.length > 0 && doc.goals.every(goal => goal.status === 'complete');
  const hasBlocker = doc.goals.some(goal => goal.status === 'blocked' || goal.status === 'failed');
  const planStatus = allComplete ? 'complete' : hasBlocker ? 'blocked' : 'active';
  const currentGoal = doc.goals.find(goal => goal.status === 'active')
    || doc.goals.find(goal => goal.status === 'blocked')
    || doc.goals.find(goal => goal.status === 'pending')
    || doc.goals.find(goal => goal.status === 'failed')
    || doc.goals.at(-1);
  const currentPhase = currentGoal?.phase || 'none';
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
  let prior = existsSync(sp) ? readFileSync(sp, 'utf8') : `# STATE — ${slug}\n`;
  if (/^Status:.*$/m.test(prior)) prior = prior.replace(/^Status:.*$/m, `Status: ${planStatus}`);
  else prior = prior.replace(/^(# .*\n)/, `$1\nStatus: ${planStatus}\n`);
  if (/^Current phase:.*$/m.test(prior)) prior = prior.replace(/^Current phase:.*$/m, `Current phase: ${currentPhase}`);
  else prior = prior.replace(/^(Status:.*\n)/m, `$1Current phase: ${currentPhase}\n`);
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

// ── phase-report internals ───────────────────────────────────────────────

/**
 * Unit normalization table for measured evidence and DoD target comparison.
 * '회' (times/회) → treated as unitless integer.
 * 'k' multiplier → ×1000. 'M' multiplier → ×1000000.
 * Returns { value: number, unit: string } or null if ambiguous/unknown.
 * @param {string} numStr  raw number string (may include unit suffix)
 */
function normalizeUnit(numStr) {
  // Case-SENSITIVE units: a lowercase 'm' must never be read as the M (mega)
  // multiplier — "200m"/"200ms" style prose would silently become ×1,000,000
  // and enable a false `met` against an M-suffixed measurement.
  const m = String(numStr).trim().match(/^(\d+(?:\.\d+)?)(회|k|M)?$/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const suffix = m[2] || '';
  if (suffix === 'k') return { value: base * 1000, unit: 'k' };
  if (suffix === 'M') return { value: base * 1_000_000, unit: 'M' };
  // '회' and no suffix are both unitless — treat identically
  return { value: base, unit: '' };
}

/**
 * Extract a single numeric target from a DoD string.
 * Conservative contract: returns { comparator, value, unit } ONLY when exactly
 * one isolated <comparator><number>[unit] token exists (comparator ∈ ≤<≥>=).
 * Ranges (7~8), arrow multi-values (→ or ->), multiple numbers, baseline noise
 * (e.g. "981k/4.97M") → returns null (unmeasurable).
 * First-number grab is forbidden: returns null unless the single-token rule holds.
 * @param {string} text DoD text
 * @returns {{ comparator: string, value: number, unit: string }|null}
 */
function extractNumericTarget(text) {
  // Reject ranges (N~M) and arrow multi-values (N→M or N->M)
  if (/\d+\s*[~～]\s*\d+/.test(text)) return null;
  if (/\d+\s*(?:→|->)\s*\d+/.test(text)) return null;
  // Reject slash-separated multi-numbers (baseline noise like 981k/4.97M)
  if (/\d+(?:k|M)?\s*\/\s*\d+(?:k|M)?/i.test(text)) return null;

  // Find all comparator+number[unit] tokens (optional space between comparator
  // and number). ASCII digraphs <= / >= must match BEFORE < > = or they would
  // mis-parse as bare '=' (false strict-equality verdicts). The trailing
  // lookahead mirrors the measured-side boundary: "<= 200ms" must NOT parse
  // its 'm' as the mega multiplier (nor 200 as unitless) — ASCII alnum after
  // the token makes it ambiguous prose → unmeasurable. Case-sensitive units.
  const tokens = [...text.matchAll(/(≤|≥|<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)(회|k|M)?(?![A-Za-z0-9])/g)];
  if (tokens.length !== 1) return null; // zero → no target, multiple → ambiguous

  // Isolation guard (spec: "복수 숫자 → unmeasurable"): the comparator token's
  // number must be the ONLY standalone number in the DoD. An extra bare number
  // ("≤ 4 per cycle over 10 runs") makes the target ambiguous — sample sizes /
  // baseline noise must not ride along. Digits embedded in identifiers (R001)
  // or decimals are not counted as separate numbers.
  const standaloneNumbers = [...text.matchAll(/(?<![A-Za-z0-9.])\d+(?:\.\d+)?/g)];
  if (standaloneNumbers.length !== 1) return null;

  const [, comp, num, unitRaw] = tokens[0];
  const n = normalizeUnit(num + (unitRaw || ''));
  if (!n) return null;
  return { comparator: comp, value: n.value, unit: n.unit };
}

/**
 * Evaluate whether a measured value satisfies a numeric target comparator.
 * @param {string} comparator  one of ≤ < ≥ > =
 * @param {number} target
 * @param {number} measured
 * @returns {boolean}
 */
function comparatorSatisfied(comparator, target, measured) {
  if (comparator === '≤' || comparator === '<=' ) return measured <= target;
  if (comparator === '<')  return measured < target;
  if (comparator === '≥' || comparator === '>=' ) return measured >= target;
  if (comparator === '>')  return measured > target;
  if (comparator === '=')  return measured === target;
  return false;
}

/**
 * Parse ROADMAP.md and return the block for the requested phase number.
 * Phase-N boundary: heading "## Phase N" followed by non-digit or end.
 * Returns { goal: string, reqIds: string[] } or null if not found.
 * @param {string} text  full ROADMAP.md content
 * @param {string} phaseNum  validated digit-only string
 */
function parseRoadmapPhase(text, phaseNum) {
  const lines = text.split('\n');
  // Match "## Phase N" where N == phaseNum. Boundary must reject BOTH a further
  // digit ("Phase 10") AND a decimal sub-phase ("Phase 1.1") — '.' is \D, so a
  // plain non-digit boundary would bleed decimal phases into the whole phase.
  const phaseRe = new RegExp(`^##\\s+Phase\\s+${phaseNum}(?!\\d|\\.\\d)`, 'i');
  let inPhase = false;
  let goal = '';
  let reqLine = '';
  let goalBuf = [];
  let collectingGoal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inPhase) {
      if (phaseRe.test(line)) { inPhase = true; collectingGoal = false; }
      continue;
    }
    // Stop at next ## heading (new phase or section)
    if (/^##\s/.test(line)) break;
    // Goal: paragraph — starts with "Goal:" and may wrap until blank line
    if (/^Goal:/i.test(line)) {
      collectingGoal = true;
      goalBuf = [line.replace(/^Goal:\s*/i, '').trim()];
      continue;
    }
    if (collectingGoal) {
      if (line.trim() === '') { collectingGoal = false; goal = goalBuf.join(' ').trim(); }
      else goalBuf.push(line.trim());
      continue;
    }
    // Requirements: R003, R004, ...
    if (/^Requirements:/i.test(line)) {
      reqLine = line.replace(/^Requirements:\s*/i, '').trim();
    }
  }
  if (collectingGoal && goalBuf.length) goal = goalBuf.join(' ').trim();
  if (!inPhase) return null;
  const reqIds = reqLine.split(',').map(s => s.trim()).filter(s => /^R\d+$/.test(s));
  return { goal, reqIds };
}

/**
 * Parse REQUIREMENTS.md and return a map of reqId → { title, dod }.
 * Each requirement bullet: "- **Rxxx** <title>: ..."
 * DoD text is collected until the next "- **R" bullet or heading.
 * @param {string} text  full REQUIREMENTS.md content
 * @returns {Map<string, { title: string, dod: string }>}
 */
function parseRequirements(text) {
  const lines = text.split('\n');
  const map = new Map();
  let currentId = null;
  let buf = [];

  const flush = () => {
    if (!currentId) return;
    const full = buf.join(' ').trim();
    // Extract DoD: text — everything after "DoD:" (may span continuation lines via buf join)
    const dodIdx = full.indexOf('DoD:');
    const dod = dodIdx >= 0 ? full.slice(dodIdx + 4).trim() : '';
    // Extract title: text between "**Rxxx**" and the first colon
    const titleM = full.match(/\*\*R\d+\*\*\s+([^:]+):/);
    const title = titleM ? titleM[1].trim() : currentId;
    map.set(currentId, { title, dod });
    currentId = null;
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^-\s+\*\*(R\d+)\*\*/);
    if (m) {
      flush();
      currentId = m[1];
      buf = [line.replace(/^\s*-\s+/, '')];
    } else if (currentId) {
      // Continuation line (indented or blank terminates): stop at next heading
      if (/^#/.test(line)) { flush(); }
      else { buf.push(line.trim()); }
    }
  }
  flush();
  return map;
}

/**
 * Parse DECISION_LOG.md and return decisions relevant to the given phase number.
 * Relevance is determined ONLY by the structured "- **Phase**: N" line inside
 * each decision block. Bare-integer substring matching is forbidden to avoid
 * collision with R-ids and percentages.
 * Returns array of { id, title, deferredReqs: string[] } objects.
 * @param {string} text  full DECISION_LOG.md content
 * @param {string} phaseNum  validated digit-only string
 */
function parseDecisionLogForPhase(text, phaseNum) {
  const lines = text.split('\n');
  // Decision blocks start: ## D-<uuid8>-<n> — <title>
  const blockRe = /^##\s+(D-[a-f0-9]+-\d+)\s+[—–-]\s+(.+)/i;
  // Structured phase line: - **Phase**: N (uuid) · ...
  // Boundary-safe: rejects further digits AND decimal sub-phases (see phaseRe).
  const phaseLineRe = new RegExp(`\\*\\*Phase\\*\\*:\\s*${phaseNum}(?!\\d|\\.\\d)`);
  // Deferral: line contains "defer" (case-insensitive) and names an R-id
  const deferRe = /defer/i;

  const results = [];
  let inBlock = false;
  let blockId = '';
  let blockTitle = '';
  let blockLines = [];

  const processBlock = () => {
    if (!blockId) return;
    const full = blockLines.join('\n');
    // Only include if structured Phase line matches phaseNum
    const phaseMatch = blockLines.some(l => phaseLineRe.test(l));
    if (phaseMatch) {
      // Determine if this block defers any requirements.
      // Strategy: if ANY line in the block contains "defer" (case-insensitive),
      // collect ALL R-ids mentioned in the entire block (not just the defer line),
      // since the Phase structured line lists the req IDs and the defer statement
      // may be on a separate line.
      const blockHasDefer = blockLines.some(l => deferRe.test(l));
      const deferredReqs = [];
      if (blockHasDefer) {
        // Collect all R-ids from the entire block
        const allRIds = [...full.matchAll(/R\d+/g)].map(m => m[0]);
        deferredReqs.push(...allRIds);
      }
      results.push({ id: blockId, title: blockTitle, deferredReqs: [...new Set(deferredReqs)], full });
    }
    blockId = '';
    blockTitle = '';
    blockLines = [];
  };

  for (const line of lines) {
    const bm = line.match(blockRe);
    if (bm) {
      processBlock();
      inBlock = true;
      blockId = bm[1];
      blockTitle = bm[2].trim();
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    }
  }
  processBlock();
  return results;
}

/**
 * Read ALL lines from ledger.jsonl (full read — low-frequency command, not bounded).
 * Returns array of parsed event objects.
 * @param {string} cwd
 * @param {string} slug
 */
function readFullLedger(cwd, slug) {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf8').split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Parse measurement events from the full ledger for specific goal IDs.
 * Evidence schema (canonical): `measured=<number>[unit]` token.
 * Returns map goalId → ARRAY of { rawEvidence, value, unit } in event order.
 * A goal may carry measurements for different requirements over time, so
 * keeping only the last one per goal would silently drop earlier req-tagged
 * measurements (each req's lookup wants ITS latest, not the goal's latest).
 * @param {Array} events  all ledger events
 * @param {Set<string>} goalIds  goal IDs to filter for
 */
function extractMeasurements(events, goalIds) {
  const map = new Map();
  for (const ev of events) {
    if (ev.event !== 'measurement') continue;
    if (!goalIds.has(ev.goalId)) continue;
    const evidence = String(ev.evidence || '');
    // Parse canonical token: measured=<number>[unit]. Both sides bounded —
    // a malformed token like "measured=42abc" or "measured=1e3" must NOT
    // partially parse into an authoritative number (NF4 anti-fabrication).
    // Case-sensitive units, mirroring extractNumericTarget/normalizeUnit.
    const m = evidence.match(/(?:^|\s)measured=(\d+(?:\.\d+)?)(회|k|M)?(?=\s|$)/);
    if (m) {
      const n = normalizeUnit(m[1] + (m[2] || ''));
      if (n) {
        if (!map.has(ev.goalId)) map.set(ev.goalId, []);
        map.get(ev.goalId).push({ rawEvidence: evidence, value: n.value, unit: n.unit });
      }
    }
  }
  return map;
}

/**
 * Find the measurement for a requirement: a measurement event on a phase goal
 * whose evidence names the reqId. Single source for BOTH the Axis-2 table and
 * the Summary Findings — the two views must never disagree on a verdict.
 * Within each goal the NEWEST event naming this reqId wins (per-goal lists are
 * in event order; goals are scanned in map insertion order).
 * @param {Map<string, Array<{ rawEvidence: string, value: number, unit: string }>>} measurements
 * @param {string} rId  requirement id (e.g. "R001")
 * @returns {{ rawEvidence: string, value: number, unit: string, goalId: string }|null}
 */
function measurementForReq(measurements, rId) {
  // Boundary-safe req-id match: "R1" must not match evidence naming "R12".
  const rIdRe = new RegExp(`(?<![A-Za-z0-9])${rId}(?!\\d)`);
  for (const [gId, list] of measurements) {
    // Latest matching event wins for THIS requirement (scan newest-first).
    for (let i = list.length - 1; i >= 0; i--) {
      if (rIdRe.test(String(list[i].rawEvidence))) return { ...list[i], goalId: gId };
    }
  }
  return null;
}

/**
 * Escape a value for interpolation into a markdown table cell. Ledger evidence
 * is writable via the public `append` CLI, so raw `|` / newlines would let a
 * crafted event break out of the cell and forge report rows (e.g. a fake
 * "**met**" verdict) — presentation-level fabrication the NF4 rule forbids.
 * @param {*} v
 * @returns {string}
 */
function mdCell(v) {
  // \r\n? covers lone CR (old-Mac line ending) — CommonMark treats a bare CR
  // as a line ending, so `\r?\n` alone would let it split the table row.
  return String(v ?? '').replace(/\r\n?|\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Determine verdict for a single requirement given its DoD and available data.
 * Precedence: deferred > measured met/not-met > unmeasurable > unknown.
 * NF4: measured fabrication forbidden — absent measurement → unmeasurable.
 * @param {{ dod: string }} req  requirement entry
 * @param {object|null} measured  { value, unit } or null
 * @param {string[]} deferDecisionIds  decision IDs that defer this requirement
 * @returns {{ verdict: string, detail: string }}
 */
function computeVerdict(req, measured, deferDecisionIds) {
  // Deferred check has highest precedence (beats measured comparison)
  if (deferDecisionIds.length > 0) {
    return { verdict: 'deferred', detail: `Deferred by: ${deferDecisionIds.join(', ')}` };
  }
  const target = extractNumericTarget(req.dod);
  if (target === null) {
    // Qualitative or multi-number DoD → always unmeasurable (no fabrication)
    return { verdict: 'unmeasurable', detail: 'qualitative or multi-value DoD; no numeric-comparable target' };
  }
  // Numeric target — check for measured evidence
  if (!measured) {
    return { verdict: 'unmeasurable', detail: 'numeric target exists but no measurement event recorded' };
  }
  // Unit must normalize to the same unit class (both unitless, or same multiplier)
  if (measured.unit !== target.unit) {
    return { verdict: 'unmeasurable', detail: `unit mismatch: target unit="${target.unit}" measured unit="${measured.unit}"` };
  }
  const satisfied = comparatorSatisfied(target.comparator, target.value, measured.value);
  if (satisfied) {
    return { verdict: 'met', detail: `measured ${measured.value}${measured.unit} ${target.comparator} target ${target.value}${target.unit}` };
  }
  return { verdict: 'unknown', detail: `measured ${measured.value}${measured.unit} does NOT satisfy ${target.comparator}${target.value}${target.unit}` };
}

/**
 * Generate a Goal Satisfaction Report for the specified phase of a plan.
 * Four axes: ROADMAP goal/requirements, REQUIREMENTS DoD targets,
 * goals.json statuses, DECISION_LOG relevant decisions, + measured.
 * Fully backfill-safe: all parse errors degrade only that row ("no data");
 * the report is always generated when slug+phaseNum are valid. Never exits 1.
 *
 * @param {string} cwd  working directory (plan lives at join(cwd, PLANS_DIR, slug))
 * @param {string} slug  normalized plan slug
 * @param {string|number} phaseNum  phase number (validated to ^\d+$ — rejects traversal)
 * @returns {{ reportFile: string, findings: object }} or error object on invalid input
 */
export function phaseReport(cwd, slug, phaseNum) {
  // ── Input validation (security: reject traversal + non-numeric) ──────────
  // Slug is re-validated here (not only at the CLI) so direct API callers
  // cannot pass a traversal-shaped slug into path construction.
  const slugNorm = normalizeSlug(slug);
  if (!slugNorm) {
    return { error: `invalid slug: "${slug}" — must match ^[a-z0-9][a-z0-9-]{0,63}$` };
  }
  slug = slugNorm;
  const phaseStr = String(phaseNum ?? '').trim();
  if (!/^\d+$/.test(phaseStr)) {
    return { error: `invalid phase: "${phaseNum}" — must be a positive integer (digits only)` };
  }
  // Phase 0 is format-valid but semantically "no data" — degrade gracefully
  const phaseInt = parseInt(phaseStr, 10);

  // ── Read sources with per-source error isolation ─────────────────────────
  let roadmapText = '', requirementsText = '', decisionLogText = '';
  let roadmapErr = null, requirementsErr = null, decisionLogErr = null;

  try {
    const rp = roadmapPath(cwd, slug);
    roadmapText = existsSync(rp) ? readFileSync(rp, 'utf8') : '';
    if (!roadmapText) roadmapErr = 'ROADMAP.md not found or empty';
  } catch (e) { roadmapErr = `ROADMAP.md read error: ${e.message}`; }

  try {
    const rqp = requirementsPath(cwd, slug);
    requirementsText = existsSync(rqp) ? readFileSync(rqp, 'utf8') : '';
    if (!requirementsText) requirementsErr = 'REQUIREMENTS.md not found or empty';
  } catch (e) { requirementsErr = `REQUIREMENTS.md read error: ${e.message}`; }

  try {
    const dlp = decisionLogPath(cwd, slug);
    decisionLogText = existsSync(dlp) ? readFileSync(dlp, 'utf8') : '';
    // Empty DECISION_LOG is valid (no decisions yet)
  } catch (e) { decisionLogErr = `DECISION_LOG.md read error: ${e.message}`; }

  // ── Parse sources ────────────────────────────────────────────────────────
  let phaseBlock = null;
  if (roadmapText && !roadmapErr) {
    try { phaseBlock = parseRoadmapPhase(roadmapText, phaseStr); } catch { phaseBlock = null; }
  }

  let reqMap = new Map();
  if (requirementsText && !requirementsErr) {
    try { reqMap = parseRequirements(requirementsText); } catch { reqMap = new Map(); }
  }

  let decisions = [];
  if (decisionLogText && !decisionLogErr) {
    try { decisions = parseDecisionLogForPhase(decisionLogText, phaseStr); } catch { decisions = []; }
  }

  // ── goals.json: find goals for this phase (boundary-safe match) ──────────
  let phaseGoals = [];
  let goalsErr = null;
  const goalsDoc = readGoals(cwd, slug);
  // Schema-drift guard: goals.json can be valid JSON but not our shape (e.g.
  // `{}` or `{"goals":"str"}`) — that must degrade this row like any other
  // malformed source, never abort report generation (backfill-safe contract).
  if (goalsDoc && Array.isArray(goalsDoc.goals)) {
    // Match goals whose .phase starts with "Phase <phaseNum>"; boundary rejects
    // further digits and decimal sub-phases (Phase 1 ≠ Phase 10 ≠ Phase 1.1).
    const phaseGoalRe = new RegExp(`^Phase\\s+${phaseStr}(?!\\d|\\.\\d)`, 'i');
    phaseGoals = goalsDoc.goals.filter(g => g && typeof g === 'object' && phaseGoalRe.test(String(g.phase || '')));
  } else {
    goalsErr = 'goals.json not found or unparseable';
  }

  // ── ledger: full read for measurement events ─────────────────────────────
  const allEvents = readFullLedger(cwd, slug);
  const phaseGoalIds = new Set(phaseGoals.map(g => g.id));
  const measurements = extractMeasurements(allEvents, phaseGoalIds);

  // Lifecycle events (checkpoint complete / failed) for this phase's goals
  const lifecycleEvents = allEvents.filter(ev =>
    phaseGoalIds.has(ev.goalId) &&
    (ev.event === 'checkpoint' && ev.status === 'complete' || ev.event === 'failed')
  );

  // ── Build deferral index: reqId → [decisionId, ...] ─────────────────────
  const deferralIndex = new Map();
  for (const dec of decisions) {
    for (const rId of dec.deferredReqs) {
      if (!deferralIndex.has(rId)) deferralIndex.set(rId, []);
      deferralIndex.get(rId).push(dec.id);
    }
  }

  // ── Determine achievement / desync status (machine-source only) ──────────
  const allGoalsPending = phaseGoals.length > 0 && phaseGoals.every(g =>
    g.status === 'pending' || g.status === 'active'
  );
  const lifecycleCount = lifecycleEvents.length;
  const achievement = (!goalsErr && allGoalsPending && lifecycleCount === 0)
    ? 'UNVERIFIED'
    : (phaseGoals.length === 0 ? 'NO_GOALS_FOUND' : 'PARTIAL_OR_COMPLETE');

  // ── Render markdown report ───────────────────────────────────────────────
  const lines = [];
  lines.push(`# Phase ${phaseStr} Goal Satisfaction Report`);
  lines.push(`> Plan: \`${slug}\` | Phase: ${phaseStr} | Generated: ${nowIso()}`);
  lines.push('');

  // Axis 1: ROADMAP Goal + Requirements
  lines.push('## 1. Phase Goal (ROADMAP)');
  if (roadmapErr) {
    lines.push(`> source error: ${roadmapErr}`);
  } else if (!phaseBlock) {
    lines.push(`> Phase ${phaseStr} not found in ROADMAP.md`);
  } else {
    lines.push(`**Goal:** ${phaseBlock.goal || '(no goal text found)'}`);
    lines.push('');
    lines.push(`**Requirements:** ${phaseBlock.reqIds.length > 0 ? phaseBlock.reqIds.join(', ') : '(none listed)'}`);
  }
  lines.push('');

  // Axis 2: REQUIREMENTS DoD Targets + Verdicts
  lines.push('## 2. Requirement Targets & Verdicts');
  const reqIds = phaseBlock?.reqIds ?? [];
  if (requirementsErr) {
    lines.push(`> source error: ${requirementsErr}`);
  } else if (reqIds.length === 0) {
    lines.push('> No requirements linked to this phase.');
  } else {
    lines.push('| Req | Title | DoD (target) | Target type | Measured | Verdict |');
    lines.push('|-----|-------|--------------|-------------|----------|---------|');
    for (const rId of reqIds) {
      const req = reqMap.get(rId);
      if (!req) {
        lines.push(`| ${rId} | no data | no data | — | — | unknown |`);
        continue;
      }
      const target = extractNumericTarget(req.dod);
      const targetType = target ? `numeric (${target.comparator}${target.value}${target.unit})` : 'qualitative';
      // Goals carry no req backlinks, so req-level measured is authoritative only
      // when the measurement event's evidence itself names the reqId.
      const measuredForVerdict = measurementForReq(measurements, rId);
      const measuredDisplay = measuredForVerdict
        ? `${measuredForVerdict.value}${measuredForVerdict.unit} (goal ${measuredForVerdict.goalId})`
        : 'absent';
      const deferIds = deferralIndex.get(rId) || [];
      const { verdict, detail } = computeVerdict({ dod: req.dod }, measuredForVerdict, deferIds);
      lines.push(`| ${rId} | ${mdCell(req.title)} | ${mdCell(req.dod.slice(0, 80))} | ${targetType} | ${mdCell(measuredDisplay)} | **${verdict}** |`);
      if (detail && verdict !== 'met') lines.push(`|  |  | *${mdCell(detail)}* |  |  |  |`);
    }
  }
  lines.push('');

  // Axis 3: goals.json Statuses
  lines.push('## 3. Goal Status (goals.json)');
  if (goalsErr) {
    lines.push(`> source error: ${goalsErr}`);
  } else if (phaseGoals.length === 0) {
    lines.push(`> No goals found for Phase ${phaseStr} in goals.json.`);
  } else {
    lines.push('| Goal ID | Title (truncated) | Status | Measured evidence |');
    lines.push('|---------|-------------------|--------|-------------------|');
    for (const g of phaseGoals) {
      const list = measurements.get(g.id);
      const measDisplay = list && list.length
        ? list.map(m => m.rawEvidence).join('; ')
        : 'none';
      // String() coercion: schema drift may put non-strings in title/id.
      lines.push(`| ${mdCell(g.id)} | ${mdCell(String(g.title ?? '').slice(0, 60))} | ${mdCell(g.status)} | ${mdCell(measDisplay)} |`);
    }
    lines.push('');
    // Desync finding (machine-source only — no TASK_LOG/commit reading)
    if (achievement === 'UNVERIFIED') {
      lines.push('> **Finding: achievement=UNVERIFIED**');
      lines.push(`> status source=goals.json; ledger lifecycle events for phase=${lifecycleCount}`);
      lines.push('> All phase goals are pending/active and no checkpoint-complete or failed events');
      lines.push('> exist in ledger.jsonl for these goals. This command does NOT read TASK_LOG or');
      lines.push('> git history — "shipped" status cannot be asserted from available sources.');
    }
  }
  lines.push('');

  // Axis 4: DECISION_LOG relevant decisions
  lines.push('## 4. Relevant Decisions (DECISION_LOG)');
  if (decisionLogErr) {
    lines.push(`> source error: ${decisionLogErr}`);
  } else if (decisions.length === 0) {
    lines.push('> No relevant decisions for this phase.');
  } else {
    for (const dec of decisions) {
      lines.push(`### ${dec.id} — ${dec.title}`);
      if (dec.deferredReqs.length > 0) {
        lines.push(`- Defers requirements: ${dec.deferredReqs.join(', ')}`);
      }
      // Include first few lines of the decision block for context
      const excerpt = dec.full.split('\n').slice(0, 6).join('\n').trim();
      if (excerpt) lines.push('');
      if (excerpt) lines.push(excerpt);
      lines.push('');
    }
  }

  // Summary findings
  lines.push('## 5. Summary Findings');
  const verdicts = [];
  for (const rId of reqIds) {
    const req = reqMap.get(rId);
    if (!req) { verdicts.push(`${rId}: unknown (no req data)`); continue; }
    const deferIds = deferralIndex.get(rId) || [];
    // Same lookup as the Axis-2 table — summary and table must agree.
    const measuredForReq = measurementForReq(measurements, rId);
    const { verdict } = computeVerdict({ dod: req.dod }, measuredForReq, deferIds);
    verdicts.push(`${rId}: ${verdict}`);
  }
  if (verdicts.length > 0) lines.push(verdicts.map(v => `- ${v}`).join('\n'));
  lines.push('');
  lines.push(`**Overall achievement: ${achievement}**`);
  if (achievement === 'UNVERIFIED') {
    lines.push(`- status source=goals.json; ledger lifecycle events for phase=${lifecycleCount}`);
    lines.push('- Provenance caveat: desync between goals.json (all pending) and ledger (no completions).');
    lines.push('  This is a known staleness pattern when execution proceeded outside ledger.append().');
    lines.push('  Do NOT interpret as "not shipped" — it means "unverifiable from machine sources".');
  }
  lines.push('');
  lines.push('---');
  lines.push(`> Generated by: \`ledger.mjs phase-report --slug ${slug} --phase ${phaseStr}\``);

  // ── Write report ─────────────────────────────────────────────────────────
  const rFile = reportPath(cwd, slug, phaseStr);
  try {
    mkdirSync(join(rFile, '..'), { recursive: true });
    atomicWriteText(rFile, lines.join('\n') + '\n');
  } catch (e) {
    // Last-resort no-throw guarantee: direct API callers must get an error
    // object, never an exception, even on fs failures (backfill-safe).
    return { error: `phase-report write error: ${e.message}`, slug, phase: phaseStr };
  }

  return {
    reportFile: rFile,
    phase: phaseStr,
    slug,
    achievement,
    reqCount: reqIds.length,
    goalsCount: phaseGoals.length,
    decisionsCount: decisions.length,
    lifecycleEvents: lifecycleCount,
  };
}

// ── structural trace query (read-only, non-authoritative) ───────────────────
const TRACE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TRACE_GOAL_RE = /^G[0-9]{3,63}$/;
const TRACE_USAGE = 'ledger trace: usage\n';

function invalidTraceReport(code) {
  const action = code === 'EVIDENCE_CHANGED_DURING_READ' ? 'retry-query'
    : ['SESSION_NOT_INDEPENDENT', 'VERIFIER_MISMATCH'].includes(code) ? 'run-verification'
      : code === 'GOAL_ALIGNMENT_MISMATCH' ? 'align-goal' : 'repair-evidence';
  return {
    schema: 1, authority: 'structural-only', authoritative: false,
    goalId: null, contractHash: null, status: 'invalid', traceComplete: false,
    summary: { totalItems: 0, linkedItems: 0, gapCount: 1 }, items: [],
    regression: {
      implementation: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
      verification: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
      verdict: { status: 'not-evaluated', evidencePresent: false }, gaps: [],
    },
    independentVerification: { status: 'not-evaluated', verifier: null, evidencePresent: false },
    goalAlignment: { status: 'not-evaluated', verifier: null, evidencePresent: false, objectiveMatches: false },
    gaps: [{ code, kind: 'trace', id: '$global', detail: code }], nextActions: [action],
  };
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownData(value, key) {
  const desc = Object.getOwnPropertyDescriptor(value, key);
  return desc && Object.prototype.hasOwnProperty.call(desc, 'value') ? desc.value : undefined;
}

function readTraceSource(file) {
  return existsSync(file) ? { exists: true, raw: readFileSync(file, 'utf8') } : { exists: false, raw: null };
}

function readTraceSnapshot(cwd, slug, goalId) {
  return {
    goals: readTraceSource(goalsPath(cwd, slug)),
    acceptance: readTraceSource(acceptancePath(cwd, slug, goalId)),
    implementation: readTraceSource(runEvidencePath(cwd, slug, goalId, 'implementation')),
    verification: readTraceSource(runEvidencePath(cwd, slug, goalId, 'verification')),
    completion: readTraceSource(completionEvidencePath(cwd, slug, goalId)),
  };
}

function captureTraceSnapshot(value) {
  if (!isPlainRecord(value)) throw new TypeError('invalid trace snapshot');
  const result = Object.create(null);
  for (const key of ['goals', 'acceptance', 'implementation', 'verification', 'completion']) {
    const source = ownData(value, key);
    if (!isPlainRecord(source)) throw new TypeError('invalid trace source');
    const exists = ownData(source, 'exists');
    const raw = ownData(source, 'raw');
    if (typeof exists !== 'boolean' || (exists ? typeof raw !== 'string' : raw !== null)) throw new TypeError('invalid trace source');
    result[key] = Object.assign(Object.create(null), { exists, raw });
  }
  return result;
}

function parseTraceSource(source, required = false) {
  if (!source.exists) return required ? null : undefined;
  try { return JSON.parse(source.raw); } catch { return null; }
}

function selectTraceGoal(goalsDoc, goalId) {
  if (!isPlainRecord(goalsDoc)) return null;
  const goals = ownData(goalsDoc, 'goals');
  if (!Array.isArray(goals) || utilTypes.isProxy(goals)) return null;
  const ids = new Set();
  let selected = null;
  for (let index = 0; index < goals.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(goals, index)) return null;
    const goal = goals[index];
    const id = isPlainRecord(goal) ? ownData(goal, 'id') : null;
    if (typeof id !== 'string' || !TRACE_GOAL_RE.test(id) || ids.has(id)) return null;
    ids.add(id);
    if (id === goalId) selected = goal;
  }
  if (!selected) return null;
  const objective = ownData(selected, 'objective');
  const metadata = ownData(selected, 'acceptance');
  const acceptanceHash = isPlainRecord(metadata) ? ownData(metadata, 'hash') : null;
  return typeof objective === 'string' && typeof acceptanceHash === 'string'
    ? { id: goalId, objective, acceptanceHash } : null;
}

/** Read two observed snapshots and construct a bounded structural trace. */
export function traceGoal(cwd, slug, options, deps = {}) {
  if (typeof cwd !== 'string' || cwd.trim() === '' || Buffer.byteLength(cwd, 'utf8') > 4096 || cwd.includes('\0')) throw new TypeError('invalid cwd');
  if (typeof slug !== 'string' || !TRACE_SLUG_RE.test(slug)) throw new TypeError('invalid slug');
  if (!isPlainRecord(options)) throw new TypeError('invalid options');
  const goalId = ownData(options, 'goalId');
  if (typeof goalId !== 'string' || !TRACE_GOAL_RE.test(goalId)) throw new TypeError('invalid goalId');
  if (!isPlainRecord(deps)) throw new TypeError('invalid dependencies');
  const suppliedReader = ownData(deps, 'readSnapshot');
  const readSnapshot = suppliedReader === undefined ? readTraceSnapshot : suppliedReader;
  if (typeof readSnapshot !== 'function') throw new TypeError('invalid readSnapshot');

  const first = captureTraceSnapshot(readSnapshot(cwd, slug, goalId));
  const second = captureTraceSnapshot(readSnapshot(cwd, slug, goalId));
  const changed = ['goals', 'acceptance', 'implementation', 'verification', 'completion']
    .some(key => first[key].exists !== second[key].exists || first[key].raw !== second[key].raw);
  if (changed) return invalidTraceReport('EVIDENCE_CHANGED_DURING_READ');

  const goalsDoc = parseTraceSource(second.goals, true);
  const acceptance = parseTraceSource(second.acceptance, true);
  const implementationRun = parseTraceSource(second.implementation);
  const verificationRun = parseTraceSource(second.verification);
  const completion = parseTraceSource(second.completion);
  if (!goalsDoc || !acceptance || (second.implementation.exists && !implementationRun) ||
      (second.verification.exists && !verificationRun) || (second.completion.exists && !completion)) return invalidTraceReport('INVALID_INPUT');
  const goal = selectTraceGoal(goalsDoc, goalId);
  if (!goal) return invalidTraceReport('INVALID_INPUT');
  const acceptanceHash = createHash('sha256').update(intrinsicStringify(acceptance)).digest('hex');
  return buildProcessTrace({ goal, acceptanceHash, acceptance, implementationRun, verificationRun, completion });
}

function resolveOwnFunction(deps, key, fallback) {
  const desc = Object.getOwnPropertyDescriptor(deps, key);
  if (!desc) return fallback;
  if (!Object.prototype.hasOwnProperty.call(desc, 'value') || typeof desc.value !== 'function') throw new TypeError(`invalid ${key}`);
  return desc.value;
}

function captureTraceArgv(argv) {
  if (!Array.isArray(argv) || utilTypes.isProxy(argv) || ![Array.prototype, null].includes(Object.getPrototypeOf(argv))) return null;
  const length = Object.getOwnPropertyDescriptor(argv, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 6) return null;
  const expected = new Set(['length', ...Array.from({ length }, (_, i) => String(i))]);
  const keys = Reflect.ownKeys(argv);
  if (keys.length !== expected.size || keys.some(key => typeof key !== 'string' || !expected.has(key))) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const value = ownData(argv, String(index));
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096 || value.includes('\0')) return null;
    result.push(value);
  }
  return result;
}

function parseTraceFlags(argv) {
  const result = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--slug', '--goal-id', '--cwd'].includes(flag) || value === undefined || value.startsWith('--') || Object.prototype.hasOwnProperty.call(result, flag)) return null;
    result[flag] = value;
  }
  if (!TRACE_GOAL_RE.test(result['--goal-id'] || '')) return null;
  if (result['--slug'] !== undefined && !TRACE_SLUG_RE.test(result['--slug'])) return null;
  if (result['--cwd'] !== undefined && (result['--cwd'].trim() === '' || Buffer.byteLength(result['--cwd'], 'utf8') > 4096 || result['--cwd'].includes('\0'))) return null;
  return result;
}

function inertCopy(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) throw new TypeError('invalid report');
  const proto = Object.getPrototypeOf(value);
  seen.add(value);
  if (Array.isArray(value)) {
    if (![Array.prototype, null].includes(proto) || value.length > 64) throw new TypeError('invalid report');
    const out = [];
    Object.setPrototypeOf(out, null);
    for (let index = 0; index < value.length; index += 1) {
      const desc = Object.getOwnPropertyDescriptor(value, String(index));
      if (!desc || !Object.prototype.hasOwnProperty.call(desc, 'value')) throw new TypeError('invalid report');
      out[index] = inertCopy(desc.value, seen);
    }
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('invalid report');
    return out;
  }
  if (![Object.prototype, null].includes(proto)) throw new TypeError('invalid report');
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('invalid report');
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !Object.prototype.hasOwnProperty.call(desc, 'value')) throw new TypeError('invalid report');
    out[key] = inertCopy(desc.value, seen);
  }
  return out;
}

function validTraceRunStatus(value, role) {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).join('|') !== 'status|outputHash|sessionId|verifier' || !['missing', 'failed', 'pass'].includes(value.status)) return false;
  if (value.status !== 'pass') return value.outputHash === null && value.sessionId === null && value.verifier === null;
  const verifierValid = role === 'implementation'
    ? value.verifier === null
    : typeof value.verifier === 'string' && value.verifier.trim() !== '' && Buffer.byteLength(value.verifier, 'utf8') <= 128;
  return verifierValid && typeof value.outputHash === 'string' && /^[0-9a-f]{64}$/iu.test(value.outputHash)
    && typeof value.sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.sessionId);
}

function validTraceVerdictStatus(value) {
  return isPlainRecord(value)
    && Reflect.ownKeys(value).join('|') === 'status|evidencePresent'
    && ['missing', 'failed', 'pass'].includes(value.status)
    && value.evidencePresent === (value.status === 'pass');
}

function validTraceGlobalStatus(value, alignment) {
  const keys = alignment ? 'status|verifier|evidencePresent|objectiveMatches' : 'status|verifier|evidencePresent';
  if (!isPlainRecord(value) || Reflect.ownKeys(value).join('|') !== keys || !['missing', 'failed', 'pass'].includes(value.status)) return false;
  if (value.status === 'pass') {
    if (typeof value.verifier !== 'string' || value.verifier.trim() === '' || Buffer.byteLength(value.verifier, 'utf8') > 128 || value.evidencePresent !== true) return false;
    return !alignment || value.objectiveMatches === true;
  }
  return value.verifier === null && value.evidencePresent === false && (!alignment || value.objectiveMatches === false);
}

function captureCanonicalReport(report) {
  const projection = inertCopy(report);
  const expected = ['schema', 'authority', 'authoritative', 'goalId', 'contractHash', 'status', 'traceComplete', 'summary', 'items', 'regression', 'independentVerification', 'goalAlignment', 'gaps', 'nextActions'];
  if (Reflect.ownKeys(projection).join('|') !== expected.join('|') || projection.schema !== 1 || projection.authority !== 'structural-only' || projection.authoritative !== false || !['complete', 'incomplete', 'invalid'].includes(projection.status)) throw new TypeError('invalid report');
  if (!Array.isArray(projection.items) || !Array.isArray(projection.gaps) || !Array.isArray(projection.nextActions)) throw new TypeError('invalid report');
  if (projection.status === 'invalid') {
    const gap = projection.gaps[0];
    const code = isPlainRecord(gap) ? ownData(gap, 'code') : null;
    const invalidCodes = new Set(['EVIDENCE_CHANGED_DURING_READ', 'INVALID_INPUT', 'GOAL_ID_MISMATCH', 'CONTRACT_HASH_MISMATCH', 'INVALID_TRACEABILITY', 'ROLE_MISMATCH', 'DUPLICATE_COMMAND_RUN', 'DUPLICATE_VERDICT_ID', 'UNKNOWN_VERDICT_ID', 'SESSION_NOT_INDEPENDENT', 'VERIFIER_MISMATCH', 'GOAL_ALIGNMENT_MISMATCH']);
    if (!invalidCodes.has(code)) throw new TypeError('invalid report');
    const expectedInvalid = invalidTraceReport(code);
    if (code === 'ROLE_MISMATCH' || code === 'DUPLICATE_COMMAND_RUN') {
      expectedInvalid.gaps[0].id = ownData(gap, 'id');
      if (!['$implementation', '$verification'].includes(expectedInvalid.gaps[0].id)) throw new TypeError('invalid report');
    } else if (code === 'DUPLICATE_VERDICT_ID' || code === 'UNKNOWN_VERDICT_ID') {
      expectedInvalid.gaps[0].id = '$completion';
    }
    if (intrinsicStringify(projection) !== intrinsicStringify(expectedInvalid)) throw new TypeError('invalid report');
    return { projection, status: projection.status };
  }
  if (typeof projection.goalId !== 'string' || !TRACE_GOAL_RE.test(projection.goalId) || typeof projection.contractHash !== 'string' || !/^[0-9a-f]{64}$/iu.test(projection.contractHash)) throw new TypeError('invalid report');
  if (!isPlainRecord(projection.summary) || Reflect.ownKeys(projection.summary).join('|') !== 'totalItems|linkedItems|gapCount') throw new TypeError('invalid report');
  if (!Number.isSafeInteger(projection.summary.totalItems) || projection.summary.totalItems < 2 || projection.summary.totalItems > 5 || projection.summary.totalItems !== projection.items.length || !Number.isSafeInteger(projection.summary.linkedItems) || projection.summary.linkedItems < 0 || projection.summary.linkedItems > projection.items.length || projection.summary.gapCount !== projection.gaps.length) throw new TypeError('invalid report');
  for (let index = 0; index < projection.gaps.length; index += 1) {
    const gap = projection.gaps[index];
    if (!isPlainRecord(gap) || Reflect.ownKeys(gap).join('|') !== 'code|kind|id|detail' || typeof gap.code !== 'string' || typeof gap.kind !== 'string' || typeof gap.id !== 'string' || gap.detail !== gap.code) throw new TypeError('invalid report');
  }
  for (let index = 0; index < projection.nextActions.length; index += 1) {
    if (typeof projection.nextActions[index] !== 'string') throw new TypeError('invalid report');
  }
  let sawScenario = false;
  const requirementIds = new Set();
  const scenarioIds = new Set();
  for (let index = 0; index < projection.items.length; index += 1) {
    const item = projection.items[index];
    const itemKeys = ['kind', 'id', 'label', 'command', 'relation', 'scenarioIds', 'requirementIds', 'implementation', 'verification', 'verdict', 'gaps'];
    if (!isPlainRecord(item) || Reflect.ownKeys(item).join('|') !== itemKeys.join('|') || !['requirement', 'scenario'].includes(item.kind) || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.command !== 'string' || !Array.isArray(item.scenarioIds) || !Array.isArray(item.requirementIds) || !Array.isArray(item.gaps)) throw new TypeError('invalid report');
    if (item.kind === 'scenario') sawScenario = true;
    else if (sawScenario) throw new TypeError('invalid report');
    const ownIds = item.kind === 'requirement' ? requirementIds : scenarioIds;
    if (ownIds.has(item.id)) throw new TypeError('invalid report');
    ownIds.add(item.id);
    if (!isPlainRecord(item.relation) || Reflect.ownKeys(item.relation).join('|') !== 'status' || !['pass', 'missing'].includes(item.relation.status)) throw new TypeError('invalid report');
    const linkedIds = item.kind === 'requirement' ? item.scenarioIds : item.requirementIds;
    const emptyIds = item.kind === 'requirement' ? item.requirementIds : item.scenarioIds;
    if (emptyIds.length !== 0 || (item.relation.status === 'pass') !== (linkedIds.length > 0)) throw new TypeError('invalid report');
    for (let linkedIndex = 0; linkedIndex < linkedIds.length; linkedIndex += 1) {
      if (typeof linkedIds[linkedIndex] !== 'string') throw new TypeError('invalid report');
    }
    for (let gapIndex = 0; gapIndex < item.gaps.length; gapIndex += 1) {
      if (typeof item.gaps[gapIndex] !== 'string') throw new TypeError('invalid report');
    }
    if (!validTraceRunStatus(item.implementation, 'implementation') || !validTraceRunStatus(item.verification, 'verification') || !validTraceVerdictStatus(item.verdict)) throw new TypeError('invalid report');
  }
  if (!sawScenario || projection.items[0]?.kind !== 'requirement') throw new TypeError('invalid report');
  if (!isPlainRecord(projection.regression) || Reflect.ownKeys(projection.regression).join('|') !== 'implementation|verification|verdict|gaps' || !Array.isArray(projection.regression.gaps) || !validTraceRunStatus(projection.regression.implementation, 'implementation') || !validTraceRunStatus(projection.regression.verification, 'verification') || !validTraceVerdictStatus(projection.regression.verdict)) throw new TypeError('invalid report');
  if (!validTraceGlobalStatus(projection.independentVerification, false) || !validTraceGlobalStatus(projection.goalAlignment, true)) throw new TypeError('invalid report');
  if (projection.status === 'complete' && (projection.traceComplete !== true || projection.gaps.length !== 0)) throw new TypeError('invalid report');
  if (projection.status === 'incomplete' && (projection.traceComplete !== false || projection.gaps.length === 0)) throw new TypeError('invalid report');
  return { projection, status: projection.status };
}

/** Execute the trace-only CLI adapter without mutating process exit state. */
export function runTraceCli(argv, deps = {}) {
  if (!isPlainRecord(deps)) throw new TypeError('invalid dependencies');
  const query = resolveOwnFunction(deps, 'traceGoal', traceGoal);
  const stdout = resolveOwnFunction(deps, 'stdout', value => process.stdout.write(value));
  const stderr = resolveOwnFunction(deps, 'stderr', value => process.stderr.write(value));
  const activePlanResolver = resolveOwnFunction(deps, 'activePlanResolver', cwd => resolveActivePlanSlug(cwd));
  const stringify = resolveOwnFunction(deps, 'stringify', intrinsicStringify);
  const args = captureTraceArgv(argv);
  const flags = args && parseTraceFlags(args);
  if (!flags) { stderr(TRACE_USAGE); return 2; }
  let cwd;
  if (flags['--cwd'] !== undefined) cwd = flags['--cwd'];
  else {
    try { cwd = process.cwd(); } catch { stderr('ledger trace: cwd resolution failed\n'); return 1; }
    if (typeof cwd !== 'string' || cwd.trim() === '' || Buffer.byteLength(cwd, 'utf8') > 4096 || cwd.includes('\0')) { stderr('ledger trace: cwd resolution failed\n'); return 1; }
  }
  let slug = flags['--slug'];
  if (slug === undefined) {
    try { slug = activePlanResolver(cwd); } catch { stderr('ledger trace: active plan resolution failed\n'); return 1; }
    if (typeof slug !== 'string' || !TRACE_SLUG_RE.test(slug)) { stderr(TRACE_USAGE); return 2; }
  }
  let report;
  try { report = query(cwd, slug, { goalId: flags['--goal-id'] }); }
  catch { stderr('ledger trace: trace query failed\n'); return 1; }
  let captured;
  try { captured = captureCanonicalReport(report); }
  catch { stderr('ledger trace: invalid trace report\n'); return 1; }
  if (captured.status !== 'invalid' && captured.projection.goalId !== flags['--goal-id']) { stderr('ledger trace: invalid trace report\n'); return 1; }
  let nativeJson, injectedJson;
  try {
    nativeJson = intrinsicStringify(captured.projection);
    injectedJson = stringify(captured.projection);
    if (typeof nativeJson !== 'string' || typeof injectedJson !== 'string' || nativeJson !== injectedJson) throw new TypeError('serialization mismatch');
  } catch { stderr('ledger trace: trace serialization failed\n'); return 1; }
  stdout(`${nativeJson}\n`);
  return captured.status === 'complete' ? 0 : captured.status === 'incomplete' ? 3 : 4;
}

// ── CLI ─────────────────────────────────────────────────────────────────
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
  if (cmd === 'trace') {
    process.exit(runTraceCli(argv.slice(1)));
  }
  const args = parseArgs(argv.slice(1));
  const cwd = args.cwd || process.cwd();
  let slug = normalizeSlug(args.slug) || resolveActivePlanSlug(cwd, args.session || null);

  // phase-report is backfill-safe: dispatched before the shared slug exit-2
  // and outside the main try/catch, so NO failure path — including a missing
  // slug/active plan — ever exits non-zero for this subcommand.
  if (cmd === 'phase-report') {
    try {
      if (!slug) {
        console.log(JSON.stringify({ error: 'no valid --slug and no active plan', phase: args.phase ?? null }));
      } else {
        console.log(JSON.stringify(phaseReport(cwd, slug, args.phase)));
      }
    } catch (e) {
      // Unexpected error inside phaseReport — report but never exit 1
      console.log(JSON.stringify({ error: `phase-report internal error: ${e.message}`, phase: args.phase, slug }));
    }
    process.exit(0);
  }

  if (!slug) { console.error('ledger: no valid --slug and no active plan'); process.exit(2); }

  try {
    let res;
    if (cmd === 'create-goals') res = createGoals(cwd, slug, args.goal);
    else if (cmd === 'append') res = append(cwd, slug, { goalId: args['goal-id'], event: args.event, status: args.status, evidence: args.evidence });
    else if (cmd === 'set-acceptance') res = setGoalAcceptance(cwd, slug, { goalId: args['goal-id'], file: args.file });
    else if (cmd === 'record-evidence') res = recordGoalEvidence(cwd, slug, { goalId: args['goal-id'], file: args.file });
    else if (cmd === 'run-evidence') res = runGoalEvidence(cwd, slug, { goalId: args['goal-id'], role: args.role, verifier: args.verifier, sessionId: args.session });
    else if (cmd === 'advance') res = advanceGoal(cwd, slug, { action: args.action, evidence: args.evidence });
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
