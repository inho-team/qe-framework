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
import { detectHighImpactRisks } from './assurance-policy.mjs';
import { buildProcessTrace, validateTraceabilityDefinition } from './process-trace.mjs';
import { closeSqlite, openSqlite } from './store-sqlite.mjs';
import { canonicalJson, createProcessControllerStore, PROCESS_CONTROLLER_DOMAINS, sha256 } from './process-controller-store.mjs';
import { createProcessController } from './process-controller.mjs';
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
const LIFECYCLE_TRIGGER_NAMES = [
  'lifecycle_operation_children_delete_guard',
  'lifecycle_operation_children_insert_guard',
  'lifecycle_operation_children_update_guard',
  'lifecycle_operations_parent_delete_guard',
  'lifecycle_operations_parent_insert_guard',
  'lifecycle_operations_parent_update_guard',
  'qe_schema_seals_insert_guard',
  'qe_schema_seals_no_delete',
  'qe_schema_seals_no_update',
];
const LIFECYCLE_MIN_LEASE_MS = 1000;
const LIFECYCLE_MAX_LEASE_MS = 300000;
const LIFECYCLE_PROJECTION_SEAL_NAME = 'lifecycle-projection-immutability';
const LIFECYCLE_PROJECTION_MAX_CHILDREN = 128;
const LIFECYCLE_PROJECTION_MAX_JSON = 64 * 1024;
const LIFECYCLE_PROJECTION_EVENT_MAP = Object.freeze({
  active: 'started',
  blocked: 'blocker',
  failed: 'failed',
  pending: 'checkpoint',
});
const LIFECYCLE_PROJECTION_TRIGGER_NAMES = [
  'lifecycle_projection_event_reservations_no_delete',
  'lifecycle_projection_event_reservations_no_update',
  'lifecycle_projection_heads_no_delete',
  'lifecycle_projection_heads_no_update',
  'lifecycle_projection_receipts_no_delete',
  'lifecycle_projection_receipts_no_update',
  'lifecycle_projection_recipes_no_delete',
  'lifecycle_projection_recipes_no_update',
];
const PROJECTION_SEAL_NAME = 'lifecycle-compact-projection';
const PROJECTION_SCHEMA_VERSION = 1;
const PROJECTION_TABLE_NAMES = [
  'lifecycle_projection_event_reservations',
  'lifecycle_projection_heads',
  'lifecycle_projection_receipts',
  'lifecycle_projection_recipes',
];
const PROJECTION_INDEX_NAMES = [
  'lifecycle_projection_reservation_owner',
  'lifecycle_projection_recipe_slug',
];
const PROJECTION_TRIGGER_NAMES = [
  'lifecycle_projection_heads_delete_guard',
  'lifecycle_projection_heads_insert_guard',
  'lifecycle_projection_heads_no_update',
  'lifecycle_projection_receipts_insert_guard',
  'lifecycle_projection_receipts_no_delete',
  'lifecycle_projection_receipts_no_update',
  'lifecycle_projection_recipes_insert_guard',
  'lifecycle_projection_recipes_no_delete',
  'lifecycle_projection_recipes_update_guard',
  'lifecycle_projection_reservations_insert_guard',
  'lifecycle_projection_reservations_no_delete',
  'lifecycle_projection_reservations_update_guard',
];
const projectionWriteConnections = new WeakSet();
const DEBT_SEAL_NAME = 'lifecycle-projection-debt';
const DEBT_SCHEMA_VERSION = 1;
const DEBT_TABLE_NAMES = [
  'lifecycle_projection_debt_audit',
  'lifecycle_projection_debt_compensations',
  'lifecycle_projection_debt_heads',
  'lifecycle_projection_debt_obligations',
  'lifecycle_projection_debt_resolutions',
  'lifecycle_projection_debts',
];
const DEBT_INDEX_NAMES = [
  'lifecycle_projection_debt_operation',
  'lifecycle_projection_debt_slug',
];
const DEBT_TRIGGER_NAMES = [
  'lifecycle_projection_debt_audit_insert_guard',
  'lifecycle_projection_debt_audit_no_delete',
  'lifecycle_projection_debt_audit_no_update',
  'lifecycle_projection_debt_compensations_insert_guard',
  'lifecycle_projection_debt_compensations_no_delete',
  'lifecycle_projection_debt_compensations_no_update',
  'lifecycle_projection_debt_heads_delete_guard',
  'lifecycle_projection_debt_heads_insert_guard',
  'lifecycle_projection_debt_heads_update_guard',
  'lifecycle_projection_debt_obligations_insert_guard',
  'lifecycle_projection_debt_obligations_no_delete',
  'lifecycle_projection_debt_obligations_no_update',
  'lifecycle_projection_debt_resolutions_insert_guard',
  'lifecycle_projection_debt_resolutions_no_delete',
  'lifecycle_projection_debt_resolutions_no_update',
  'lifecycle_projection_debts_insert_guard',
  'lifecycle_projection_debts_no_delete',
  'lifecycle_projection_debts_no_update',
  'qe_schema_seals_debt_insert_guard',
  'qe_schema_seals_debt_no_delete',
  'qe_schema_seals_debt_no_update',
];
const DEBT_REASONS = new Set(['SUPERSEDED', 'TARGET_CONFLICT', 'LEDGER_IDENTITY_CONFLICT',
  'STATE_CONFLICT', 'JOURNAL_INTEGRITY_ERROR']);
const debtWriteConnections = new WeakSet();
const PLAN_GOAL_ADAPTER_SEAL_NAME = 'lifecycle-plan-goal-adapter';
const PLAN_GOAL_ADAPTER_SCHEMA_VERSION = 1;
const PLAN_GOAL_NO_GOAL_PROOF = sha256(canonicalJson(['qe-plan-goal-no-proof-v1', 'goal']));
const PLAN_GOAL_NO_PLAN_PROOF = sha256(canonicalJson(['qe-plan-goal-no-proof-v1', 'plan']));
const PLAN_GOAL_NO_ROW = sha256(canonicalJson(['qe-plan-goal-no-row-v1']));
const PLAN_GOAL_NO_RECEIPT = 'qe-plan-goal-receipt:none';
const PLAN_GOAL_NO_RESULT = 'qe-controller-result:none';
const PLAN_GOAL_MAX_GENERATION = 128;
const planGoalAdapterWriteConnections = new WeakSet();
const PLAN_GOAL_ADAPTER_TABLES = [
  'lifecycle_plan_goal_audit',
  'lifecycle_plan_goal_bootstraps',
  'lifecycle_plan_goal_heads',
  'lifecycle_plan_goal_intents',
  'lifecycle_plan_goal_proofs',
  'lifecycle_plan_goal_receipts',
];
const PLAN_GOAL_ADAPTER_INDEXES = [
  'lifecycle_plan_goal_intent_slug',
  'lifecycle_plan_goal_receipt_request',
];
const PLAN_GOAL_ADAPTER_TRIGGERS = PLAN_GOAL_ADAPTER_TABLES.flatMap(name => [
  `${name}_insert_guard`, `${name}_no_update`, `${name}_delete_guard`,
]);

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
const canonicalPlanTransactionTimes = new WeakMap();

function canonicalPlanTransactionTime(db) {
  if (!canonicalPlanTransactionTimes.has(db)) canonicalPlanTransactionTimes.set(db, Date.now());
  return canonicalPlanTransactionTimes.get(db);
}

function canonicalPlanFault(point) {
  const injector = globalThis[Symbol.for('qe.canonical-plan-write.fault-injector')];
  if (typeof injector === 'function') injector(point);
}

function canonicalPlanCommit(db) {
  canonicalPlanFault('before-commit');
  db.exec('COMMIT');
  canonicalPlanFault('after-commit');
}

function canonicalPlanError(code, message = code) {
  const messages = {
    CANONICAL_STORE_UNAVAILABLE: 'canonical store unavailable',
    CANONICAL_CAS_CONFLICT: 'canonical write CAS conflict',
    CANONICAL_STORE_INVALID: 'canonical store is invalid',
    CANONICAL_BACKEND_CONFLICT: 'canonical backend conflict',
    ACCEPTANCE_CONFLICT: 'acceptance contract is immutable',
    COMPLETION_EVIDENCE_CONFLICT: 'completion evidence is immutable',
    EVIDENCE_RUN_STALE: 'evidence run became stale before commit',
    EVIDENCE_RUN_CONFLICT: 'evidence run identity conflicts with existing history',
  };
  if (message === code && messages[code]) message = messages[code];
  const err = new Error(message);
  err.code = code;
  return err;
}

function canonicalPlanValidateRow(row) {
  if (!row) return null;
  if (typeof row.content !== 'string') throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (row.encoding !== 'utf8') throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!Number.isSafeInteger(row.size) || row.size < 0) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!Number.isSafeInteger(row.mode) || row.mode < 0 || row.mode > 0xffffffff) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!Number.isSafeInteger(row.mtime_ms) || row.mtime_ms < 0) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!Number.isSafeInteger(row.migrated_at) || row.migrated_at < 0) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!/^[0-9a-f]{64}$/.test(String(row.sha256 || ''))) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const text = row.content;
  if (text.includes('\0') || Buffer.from(text, 'utf8').toString('utf8') !== text) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  if (Buffer.byteLength(text, 'utf8') !== row.size || sha256(text) !== row.sha256) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  return row;
}

function canonicalPlanOpenDb(cwd, { readOnly = false } = {}) {
  const db = openSqlite(cwd, { readOnly, timeoutMs: 5000 });
  if (!db) return null;
  if (readOnly) return db;
  try {
    db.function('qe_lifecycle_projection_debt_write_v1', { deterministic: false }, () => (
      debtWriteConnections.has(db) ? 1 : 0
    ));
    db.function('qe_plan_goal_adapter_write_v1', { deterministic: false }, () => (
      planGoalAdapterWriteConnections.has(db) ? 1 : 0
    ));
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
      CREATE TABLE IF NOT EXISTS qe_schema_seals(
        name TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        digest TEXT NOT NULL,
        installed_at INTEGER NOT NULL
      );
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
  return canonicalPlanValidateRow(db.prepare('SELECT content, encoding, size, mode, mtime_ms, sha256, migrated_at FROM qe_files WHERE path=?').get(relPath) || null);
}

function canonicalPlanDecodeRow(row) {
  if (!row) return null;
  return String(row.content || '');
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
  if (canonicalPlanTextBytes(text) > PLAN_DOC_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  try { return JSON.parse(text); } catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
}

function canonicalPlanParseGoalsRow(row, slug) {
  if (!row || row.size > PLAN_DOC_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  let doc;
  try { doc = canonicalStoreClone(JSON.parse(canonicalPlanDecodeRow(row))); }
  catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
  if (!lifecyclePlainObject(doc) || doc.schema !== 1 || doc.planSlug !== slug || !Array.isArray(doc.goals)) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  let previous = 0;
  let mutable = 0;
  const seen = new Set();
  for (const goal of doc.goals) {
    if (!lifecyclePlainObject(goal) || !/^G\d{3,}$/.test(goal.id) || seen.has(goal.id)
      || !STATUS_ENUM.includes(goal.status) || !Number.isSafeInteger(goal.attempts) || goal.attempts < 0) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
    const ordinal = Number(goal.id.slice(1));
    if (!Number.isSafeInteger(ordinal) || ordinal <= previous) throw canonicalPlanError('CANONICAL_STORE_INVALID');
    previous = ordinal;
    seen.add(goal.id);
    if (goal.status === 'active' || goal.status === 'blocked') mutable += 1;
    if (goal.acceptance !== undefined && (!lifecyclePlainObject(goal.acceptance)
      || goal.acceptance.status !== 'defined' || typeof goal.acceptance.file !== 'string'
      || !/^[0-9a-f]{64}$/.test(goal.acceptance.hash))) throw canonicalPlanError('CANONICAL_STORE_INVALID');
    if (goal.completionEvidence !== undefined && (!lifecyclePlainObject(goal.completionEvidence)
      || goal.completionEvidence.status !== 'recorded' || typeof goal.completionEvidence.file !== 'string')) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
    if (goal.executionOwnerSession !== undefined
      && !MACHINE_SESSION_RE.test(goal.executionOwnerSession)) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
  }
  if (mutable > 1) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  return doc;
}

function canonicalPlanWriteRow(db, relPath, text, expectedSha = null, mode = 0o644) {
  const bytes = canonicalPlanTextBytes(text);
  if (bytes > PLAN_DOC_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const sha = sha256(text);
  const now = canonicalPlanTransactionTime(db);
  const current = canonicalPlanReadRow(db, relPath);
  const effectiveMode = current?.mode ?? mode;
  if (expectedSha !== null) {
    if (!current || current.sha256 !== expectedSha) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=? AND sha256=?`)
      .run(text, bytes, effectiveMode, now, sha, now, relPath, expectedSha);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
  } else if (current) {
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=?`)
      .run(text, bytes, effectiveMode, now, sha, now, relPath);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
  } else {
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(relPath, text, 'utf8', bytes, effectiveMode, now, sha, now);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
  }
  canonicalPlanFault(`row:${relPath}`);
  return { sha, bytes };
}

function canonicalPlanLedgerLines(text) {
  if (!text) return [];
  if (canonicalPlanTextBytes(text) > PLAN_LEDGER_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  if (!text.endsWith('\n')) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const lines = text.split('\n');
  lines.pop();
  if (lines.length > PLAN_LEDGER_MAX_LINES || lines.some(line => !line || line.includes('\r'))) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  for (const line of lines) {
    if (canonicalPlanTextBytes(`${line}\n`) > 64 * 1024) throw canonicalPlanError('CANONICAL_STORE_INVALID');
    try {
      const parsed = JSON.parse(line);
      if (!lifecyclePlainObject(parsed)) throw new TypeError('ledger line');
      canonicalStoreClone(parsed);
    } catch {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
  }
  return lines;
}

function canonicalPlanAppendLedger(db, relPath, eventLine) {
  const currentRow = canonicalPlanReadRow(db, relPath);
  const currentText = canonicalPlanDecodeRow(currentRow) || '';
  const lines = canonicalPlanLedgerLines(currentText);
  if (lines.length + 1 > PLAN_LEDGER_MAX_LINES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const nextLine = JSON.stringify(canonicalStoreClone(eventLine));
  if (canonicalPlanTextBytes(`${nextLine}\n`) > 64 * 1024) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const nextText = currentText + nextLine + '\n';
  if (canonicalPlanTextBytes(nextText) > PLAN_LEDGER_MAX_BYTES) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const nextSha = sha256(nextText);
  const now = canonicalPlanTransactionTime(db);
  const effectiveMode = currentRow?.mode ?? 0o644;
  if (currentRow) {
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=? AND sha256=?`)
      .run(nextText, canonicalPlanTextBytes(nextText), effectiveMode, now, nextSha, now, relPath, currentRow.sha256);
  } else {
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(relPath, nextText, 'utf8', canonicalPlanTextBytes(nextText), effectiveMode, now, nextSha, now);
  }
  const changed = currentRow ? db.prepare('SELECT changes() AS changes').get().changes : 1;
  if (changed !== 1) throw canonicalPlanError('CANONICAL_CAS_CONFLICT');
  canonicalPlanFault(`ledger:${relPath}`);
  return { sha: nextSha, lineCount: lines.length + 1 };
}

function canonicalPlanIdentity(db, identity, operation, slug, goalId, artifactPath, artifactSha256, eventSha256, eventOffset) {
  const now = canonicalPlanTransactionTime(db);
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
  canonicalPlanFault(`identity:${identity}`);
  return { replayed: false, row: null };
}

function canonicalPlanReplayIdentity(db, identity, expected) {
  const existing = db.prepare('SELECT * FROM plan_write_identities WHERE identity=?').get(identity);
  if (!existing) return false;
  if (existing.operation !== expected.operation || existing.slug !== expected.slug
    || existing.goal_id !== expected.goalId || existing.artifact_path !== expected.artifactPath
    || existing.artifact_sha256 !== expected.artifactSha256) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  const artifact = canonicalPlanReadRow(db, expected.artifactPath);
  const ledger = canonicalPlanReadRow(db, join(PLANS_DIR, expected.slug, 'ledger.jsonl'));
  if (!artifact || artifact.sha256 !== expected.artifactSha256 || !ledger
    || !Number.isSafeInteger(existing.event_offset) || existing.event_offset < 1) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  const lines = canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledger));
  const line = lines[existing.event_offset - 1];
  if (!line || sha256(line) !== existing.event_sha256) throw canonicalPlanError('CANONICAL_STORE_INVALID');
  return true;
}

function canonicalPlanWriteError(error) {
  if (['CANONICAL_CAS_CONFLICT', 'CANONICAL_STORE_INVALID', 'CANONICAL_BACKEND_CONFLICT',
    'ACCEPTANCE_CONFLICT', 'COMPLETION_EVIDENCE_CONFLICT', 'EVIDENCE_RUN_STALE',
    'EVIDENCE_RUN_CONFLICT', 'PROJECTION_DEBT_OUTSTANDING', 'PROJECTION_DEBT_CORRUPT',
    'PROJECTION_DEBT_UNAVAILABLE', 'DIRECT_TRANSITION_DENIED', 'MICRO_SCOPE_UNAVAILABLE',
    'MICRO_SCOPE_VIOLATION'].includes(error?.code)) {
    return error;
  }
  if (/SQLITE_(?:BUSY|LOCKED)|database is (?:busy|locked)/i.test(String(error?.code || '') + String(error?.message || ''))) {
    return canonicalPlanError('CANONICAL_CAS_CONFLICT');
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
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) {
      throw canonicalStoreError('CANONICAL_STORE_INVALID');
    }
    return value;
  }
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
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw canonicalStoreError('CANONICAL_STORE_INVALID');
    }
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
      const adapterInstalled = db.prepare('SELECT 1 FROM qe_schema_seals WHERE name=?')
        .get(PLAN_GOAL_ADAPTER_SEAL_NAME);
      if (adapterInstalled) {
        const allowedKeys = ['attempt', 'event', 'evidence', 'goalId', 'status', 'ts'];
        if (!lifecyclePlainObject(cloned)
          || Object.keys(cloned).sort().join('|') !== allowedKeys.sort().join('|')
          || !['checkpoint', 'measurement'].includes(cloned.event)) {
          throw canonicalPlanError('DIRECT_TRANSITION_DENIED');
        }
        const goalsRow = canonicalPlanReadRow(db, join(PLANS_DIR, slug, 'goals.json'));
        const goal = canonicalPlanParseGoalsRow(goalsRow, slug).goals.find(item => item.id === cloned.goalId);
        if (!goal || cloned.status !== goal.status || cloned.attempt !== goal.attempts) {
          throw canonicalPlanError('DIRECT_TRANSITION_DENIED');
        }
      }
      const { lineCount } = canonicalPlanAppendLedger(db, rel, cloned);
      canonicalPlanCommit(db);
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
    if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy?.(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && !['__proto__', 'prototype', 'constructor'].includes(key)
      && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
      && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch { return false; }
}

function lifecycleClone(value, depth = 0) {
  if (depth > 12) throw new TypeError('depth');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) throw new TypeError('string');
    return value;
  }
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
    && !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value
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

function lifecycleSealDigest(triggerRows) {
  return sha256(canonicalJson(['qe-lifecycle-seal-v1', 1,
    triggerRows.map(row => ({ name: row.name, sql: row.sql }))]));
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

function lifecycleParseRoster(rosterJson) {
  const roster = typeof rosterJson === 'string' ? JSON.parse(rosterJson) : rosterJson;
  if (!Array.isArray(roster) || roster.length > LIFECYCLE_MAX_CHILDREN) throw new Error('LIFECYCLE_IMMUTABLE');
  return roster;
}

function lifecycleRosterForDigest(operationId, rosterJson) {
  const encoded = String(rosterJson);
  if (!LIFECYCLE_UUID_RE.test(String(operationId)) || Buffer.byteLength(encoded, 'utf8') > LIFECYCLE_MAX_AGGREGATE) {
    throw new Error('LIFECYCLE_IMMUTABLE');
  }
  const roster = lifecycleParseRoster(encoded);
  if (roster.length < 1 || canonicalJson(roster) !== encoded) throw new Error('LIFECYCLE_IMMUTABLE');
  for (let ordinal = 0; ordinal < roster.length; ordinal += 1) {
    const entry = roster[ordinal];
    if (!lifecycleExact(entry, ['ordinal', 'layer', 'operation', 'processId', 'requestId', 'request'])
      || entry.ordinal !== ordinal || !LIFECYCLE_LAYERS.has(entry.layer)
      || !['initialize', 'transition'].includes(entry.operation)
      || !lifecycleBoundedString(entry.processId, 128, LIFECYCLE_PROCESS_RE)
      || !/^[0-9a-f]{64}$/.test(entry.requestId)) throw new Error('LIFECYCLE_IMMUTABLE');
    const requestKeys = entry.operation === 'initialize'
      ? ['processId', 'requestId']
      : ['processId', 'requestId', 'to', 'expectedRevision', 'attestations', 'humanAcceptance'];
    if (!lifecycleExact(entry.request, requestKeys) || entry.request.processId !== entry.processId
      || entry.request.requestId !== entry.requestId
      || (entry.operation === 'transition' && (!lifecycleBoundedString(entry.request.to, 64)
        || !Number.isSafeInteger(entry.request.expectedRevision) || entry.request.expectedRevision < 0))) {
      throw new Error('LIFECYCLE_IMMUTABLE');
    }
  }
  return roster;
}

function lifecycleChildManifestValue(row) {
  return {
    ordinal: row.ordinal,
    layer: row.layer,
    operation: row.operation_kind ?? row.operation,
    processId: row.process_id ?? row.processId,
    requestId: row.request_id ?? row.requestId,
    request: lifecycleParseJson(row.request_json ?? canonicalJson(row.request)),
    status: row.status,
    attempt: row.attempt,
    claimOwner: row.claim_owner ?? row.claimOwner ?? null,
    claimToken: row.claim_token ?? row.claimToken ?? null,
    leaseUntil: row.lease_until ?? row.leaseUntil ?? null,
    resultRef: lifecycleParseJson(row.result_ref_json ?? (row.resultRef == null ? null : canonicalJson(row.resultRef))),
  };
}

function lifecycleChildMatchesRosterEntry(entry, row) {
  return lifecyclePlainObject(entry)
    && entry.ordinal === row.ordinal
    && entry.layer === row.layer
    && entry.operation === row.operation
    && entry.processId === row.processId
    && entry.requestId === row.requestId
    && canonicalJson(entry.request) === canonicalJson(row.request)
    && row.status === 'pending'
    && row.attempt === 0
    && row.claimOwner == null
    && row.claimToken == null
    && row.leaseUntil == null
    && row.resultRef == null;
}

function lifecycleParentInsertValid(operationId, rosterJson, rosterDigest, finalized, status, currentOrdinal, resultJson) {
  try {
    const roster = lifecycleParseRoster(rosterJson);
    return rosterDigest === lifecycleRosterDigest(String(operationId), roster)
      && Number(finalized) === 0
      && status === 'pending'
      && Number(currentOrdinal) === 0
      && resultJson == null;
  } catch {
    return false;
  }
}

function lifecycleParentFinalizeValid(operationId, rosterJson, rosterDigest, childManifestJson, finalized, status, currentOrdinal, resultJson) {
  try {
    if (!lifecycleParentInsertValid(operationId, rosterJson, rosterDigest, 0, status, currentOrdinal, resultJson)) return false;
    if (Number(finalized) !== 1) return false;
    const roster = lifecycleParseRoster(rosterJson);
    const children = lifecycleParseJson(childManifestJson);
    if (!Array.isArray(children) || children.length !== roster.length) return false;
    const byOrdinal = new Map(children.map(child => [child.ordinal, lifecycleChildManifestValue(child)]));
    for (let ordinal = 0; ordinal < roster.length; ordinal += 1) {
      const row = byOrdinal.get(ordinal);
      if (!row || !lifecycleChildMatchesRosterEntry(roster[ordinal], row)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function lifecycleChildManifestValid(operationId, rosterJson, ordinal, layer, operationKind, processId, requestId, requestJson, status, attempt, claimOwner, claimToken, leaseUntil, resultRefJson) {
  try {
    void operationId;
    const roster = lifecycleParseRoster(rosterJson);
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= roster.length) return false;
    const entry = roster[ordinal];
    return lifecycleChildMatchesRosterEntry(entry, {
      ordinal,
      layer,
      operation: operationKind,
      processId,
      requestId,
      request: lifecycleParseJson(requestJson),
      status,
      attempt,
      claimOwner,
      claimToken,
      leaseUntil,
      resultRef: lifecycleParseJson(resultRefJson),
    });
  } catch {
    return false;
  }
}

function lifecycleBackfill(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(lifecycle_operations)').all().map(row => row.name));
  const manifestColumns = ['roster_json', 'roster_digest', 'finalized'];
  const manifestCount = manifestColumns.filter(name => columns.has(name)).length;
  if (manifestCount !== 0 && manifestCount !== manifestColumns.length) throw new Error('LIFECYCLE_IMMUTABLE');
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(LIFECYCLE_SEAL_NAME);
  const triggerPlaceholders = LIFECYCLE_TRIGGER_NAMES.map(() => '?').join(',');
  const triggerCount = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name IN (${triggerPlaceholders})`)
    .get(...LIFECYCLE_TRIGGER_NAMES).count;
  const parentCount = db.prepare('SELECT COUNT(*) AS count FROM lifecycle_operations').get().count;
  if (manifestCount === manifestColumns.length) {
    if (seal) return;
    if (triggerCount !== 0 || parentCount !== 0) throw new Error('LIFECYCLE_IMMUTABLE');
    return;
  }
  if (seal || triggerCount !== 0) throw new Error('LIFECYCLE_IMMUTABLE');
  db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN roster_json TEXT NOT NULL DEFAULT '[]'`);
  db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN roster_digest TEXT NOT NULL DEFAULT ''`);
  db.exec(`ALTER TABLE lifecycle_operations ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0`);

  const orphan = db.prepare(`SELECT 1 FROM lifecycle_operation_children child
    LEFT JOIN lifecycle_operations parent ON parent.operation_id=child.operation_id
    WHERE parent.operation_id IS NULL LIMIT 1`).get();
  if (orphan) throw new Error('LIFECYCLE_IMMUTABLE');
  const parents = db.prepare('SELECT * FROM lifecycle_operations ORDER BY operation_id').all();
  for (const parent of parents) {
    const operationId = parent.operation_id;
    if (!LIFECYCLE_SLUG_RE.test(parent.slug) || !LIFECYCLE_UUID_RE.test(operationId)
      || !lifecycleBoundedString(parent.semantic_key, 256) || !lifecycleBoundedString(parent.kind, 64)
      || !Number.isSafeInteger(parent.created_at) || parent.created_at < 0
      || !Number.isSafeInteger(parent.updated_at) || parent.updated_at < parent.created_at) {
      throw new Error('LIFECYCLE_IMMUTABLE');
    }
    let payload;
    try { payload = JSON.parse(parent.payload_json); } catch { throw new Error('LIFECYCLE_IMMUTABLE'); }
    if (canonicalJson(payload) !== parent.payload_json
      || Buffer.byteLength(parent.payload_json, 'utf8') > LIFECYCLE_MAX_JSON) throw new Error('LIFECYCLE_IMMUTABLE');
    const children = db.prepare('SELECT * FROM lifecycle_operation_children WHERE operation_id=? ORDER BY ordinal').all(operationId);
    if (children.length < 1 || children.length > LIFECYCLE_MAX_CHILDREN) throw new Error('LIFECYCLE_IMMUTABLE');
    const normalized = children.map((child, ordinal) => {
      if (child.ordinal !== ordinal || child.operation_id !== operationId) throw new Error('LIFECYCLE_IMMUTABLE');
      const request = lifecycleParseJson(child.request_json);
      if (!lifecyclePlainObject(request) || canonicalJson(request) !== child.request_json
        || Buffer.byteLength(child.request_json, 'utf8') > LIFECYCLE_MAX_JSON) throw new Error('LIFECYCLE_IMMUTABLE');
      const raw = child.operation_kind === 'initialize'
        ? { layer: child.layer, operation: child.operation_kind, processId: child.process_id }
        : child.operation_kind === 'transition'
          ? { layer: child.layer, operation: child.operation_kind, processId: child.process_id,
              to: request.to, expectedRevision: request.expectedRevision,
              attestations: request.attestations, humanAcceptance: request.humanAcceptance }
          : null;
      if (!raw) throw new Error('LIFECYCLE_IMMUTABLE');
      const item = normalizeLifecycleChild(raw, ordinal, parent.slug, operationId);
      if (item.requestId !== child.request_id || canonicalJson(item.request) !== child.request_json) {
        throw new Error('LIFECYCLE_IMMUTABLE');
      }
      return item;
    });
    const intent = ['qe-lifecycle-intent-v1', 1, parent.slug, parent.semantic_key, parent.kind,
      payload, normalized.map(item => item.semantic)];
    if (sha256(canonicalJson(intent)) !== parent.intent_digest) throw new Error('LIFECYCLE_IMMUTABLE');
    if (parent.status === 'pending' && (parent.current_ordinal !== 0 || parent.result_json !== null
      || children.some(child => child.status !== 'pending' || child.attempt !== 0 || child.claim_owner !== null
        || child.claim_token !== null || child.lease_until !== null || child.result_ref_json !== null))) {
      throw new Error('LIFECYCLE_IMMUTABLE');
    }
    const roster = normalized.map((item, ordinal) => ({ ordinal, layer: item.semantic.layer,
      operation: item.semantic.operation, processId: item.semantic.processId,
      requestId: item.requestId, request: item.request }));
    const rosterJson = canonicalJson(roster);
    if (Buffer.byteLength(rosterJson, 'utf8') > LIFECYCLE_MAX_AGGREGATE) throw new Error('LIFECYCLE_IMMUTABLE');
    const rosterDigest = lifecycleRosterDigest(operationId, roster);
    db.prepare('UPDATE lifecycle_operations SET roster_json=?,roster_digest=?,finalized=1 WHERE operation_id=?')
      .run(rosterJson, rosterDigest, operationId);
  }
}

function lifecycleInstallGuards(db) {
  const sealBefore = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(LIFECYCLE_SEAL_NAME);
  const triggerPlaceholders = LIFECYCLE_TRIGGER_NAMES.map(() => '?').join(',');
  const triggersBefore = db.prepare(`SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN (${triggerPlaceholders}) ORDER BY name`)
    .all(...LIFECYCLE_TRIGGER_NAMES);
  if (!sealBefore && triggersBefore.length !== 0) throw new Error('LIFECYCLE_IMMUTABLE');
  if (sealBefore && triggersBefore.length !== LIFECYCLE_TRIGGER_NAMES.length) throw new Error('LIFECYCLE_IMMUTABLE');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_insert_guard
      BEFORE INSERT ON lifecycle_operations
      WHEN NEW.finalized <> 0
        OR NEW.status <> 'pending'
        OR NEW.current_ordinal <> 0
        OR NEW.result_json IS NOT NULL
        OR typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0 OR NEW.created_at > 9007199254740991
        OR typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at <> NEW.created_at
        OR json_type(NEW.roster_json) <> 'array'
        OR json_array_length(NEW.roster_json) < 1
        OR json_array_length(NEW.roster_json) > ${LIFECYCLE_MAX_CHILDREN}
        OR NEW.roster_digest <> qe_lifecycle_roster_digest_v1(NEW.operation_id, NEW.roster_json)
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_update_guard
      BEFORE UPDATE ON lifecycle_operations
      WHEN NEW.slug <> OLD.slug OR NEW.operation_id <> OLD.operation_id OR NEW.semantic_key <> OLD.semantic_key
        OR NEW.kind <> OLD.kind OR NEW.payload_json <> OLD.payload_json OR NEW.roster_json <> OLD.roster_json
        OR NEW.roster_digest <> OLD.roster_digest OR NEW.created_at <> OLD.created_at
        OR typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < NEW.created_at OR NEW.updated_at > 9007199254740991
        OR (OLD.finalized = 0 AND NEW.finalized <> 1)
        OR (OLD.finalized = 0 AND NEW.finalized = 1 AND (
          NEW.status <> 'pending'
          OR NEW.current_ordinal <> 0
          OR NEW.result_json IS NOT NULL
          OR json_type(NEW.roster_json) <> 'array'
          OR json_array_length(NEW.roster_json) <> (SELECT COUNT(*) FROM lifecycle_operation_children WHERE operation_id = NEW.operation_id)
          OR NEW.roster_digest <> qe_lifecycle_roster_digest_v1(NEW.operation_id, NEW.roster_json)
          OR EXISTS(
            SELECT 1
            FROM json_each(NEW.roster_json) AS roster
            WHERE NOT EXISTS(
              SELECT 1
              FROM lifecycle_operation_children child
              WHERE child.operation_id = NEW.operation_id
                AND child.ordinal = CAST(roster.key AS INTEGER)
                AND child.layer = json_extract(roster.value, '$.layer')
                AND child.operation_kind = json_extract(roster.value, '$.operation')
                AND child.process_id = json_extract(roster.value, '$.processId')
                AND child.request_id = json_extract(roster.value, '$.requestId')
                AND json(child.request_json) = json(json_extract(roster.value, '$.request'))
                AND child.status = 'pending'
                AND child.attempt = 0
                AND child.claim_owner IS NULL
                AND child.claim_token IS NULL
                AND child.lease_until IS NULL
                AND child.result_ref_json IS NULL
            )
          )
        ))
        OR (OLD.finalized = 1 AND NEW.finalized <> OLD.finalized AND NEW.finalized <> 1)
        OR (OLD.finalized = 1 AND (
          NEW.status NOT IN ('pending','running','committed','denied')
          OR typeof(NEW.current_ordinal) <> 'integer' OR NEW.current_ordinal < 0
          OR NEW.current_ordinal > (SELECT COUNT(*) FROM lifecycle_operation_children WHERE operation_id=NEW.operation_id)
          OR (NEW.status IN ('pending','running') AND NEW.result_json IS NOT NULL)
          OR (NEW.status IN ('committed','denied') AND NEW.result_json IS NULL)
          OR (OLD.status='committed' AND NEW.status<>'committed')
          OR (OLD.status='denied' AND NEW.status<>'denied')
          OR (OLD.status='running' AND NEW.status='pending')
        ))
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operations_parent_delete_guard
      BEFORE DELETE ON lifecycle_operations BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operation_children_insert_guard
      BEFORE INSERT ON lifecycle_operation_children
      WHEN NOT EXISTS(SELECT 1 FROM lifecycle_operations p WHERE p.operation_id = NEW.operation_id AND p.finalized = 0)
        OR json_type((SELECT roster_json FROM lifecycle_operations WHERE operation_id = NEW.operation_id)) <> 'array'
        OR NEW.status <> 'pending' OR NEW.attempt <> 0 OR NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
        OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NOT NULL
        OR NOT EXISTS(
          SELECT 1
          FROM json_each((SELECT roster_json FROM lifecycle_operations WHERE operation_id = NEW.operation_id)) AS roster
          WHERE CAST(roster.key AS INTEGER) = NEW.ordinal
            AND json_extract(roster.value, '$.layer') = NEW.layer
            AND json_extract(roster.value, '$.operation') = NEW.operation_kind
            AND json_extract(roster.value, '$.processId') = NEW.process_id
            AND json_extract(roster.value, '$.requestId') = NEW.request_id
            AND json(NEW.request_json) = json(json_extract(roster.value, '$.request'))
        )
      BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_IMMUTABLE'); END;

    CREATE TRIGGER IF NOT EXISTS lifecycle_operation_children_update_guard
      BEFORE UPDATE ON lifecycle_operation_children
      WHEN EXISTS(SELECT 1 FROM lifecycle_operations p WHERE p.operation_id = NEW.operation_id AND p.finalized = 0)
        OR NEW.operation_id <> OLD.operation_id OR NEW.ordinal <> OLD.ordinal OR NEW.layer <> OLD.layer
        OR NEW.operation_kind <> OLD.operation_kind OR NEW.process_id <> OLD.process_id OR NEW.request_id <> OLD.request_id
        OR NEW.request_json <> OLD.request_json
        OR NEW.status NOT IN ('pending','claimed','unavailable','committed','denied','cancelled')
        OR typeof(NEW.attempt) <> 'integer' OR NEW.attempt < 0 OR NEW.attempt > 9007199254740991
        OR (NEW.status='pending' AND (NEW.attempt<>0 OR NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
          OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NOT NULL))
        OR (NEW.status='claimed' AND (NEW.attempt<1 OR NEW.claim_owner IS NULL OR NEW.claim_token IS NULL
          OR typeof(NEW.lease_until)<>'integer' OR NEW.lease_until<0 OR NEW.result_ref_json IS NOT NULL))
        OR (NEW.status='unavailable' AND (NEW.attempt<1 OR NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
          OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NOT NULL))
        OR (NEW.status IN ('committed','denied') AND (NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
          OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NULL))
        OR (NEW.status='cancelled' AND (NEW.claim_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
          OR NEW.lease_until IS NOT NULL OR NEW.result_ref_json IS NOT NULL))
        OR (OLD.status='pending' AND NEW.status NOT IN ('pending','claimed','committed','denied','cancelled'))
        OR (OLD.status='unavailable' AND NEW.status NOT IN ('unavailable','claimed'))
        OR (OLD.status='claimed' AND NEW.status NOT IN ('claimed','unavailable','committed','denied'))
        OR (OLD.status IN ('committed','denied','cancelled') AND NEW.status<>OLD.status)
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
  const triggerRows = db.prepare(`SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN (${triggerPlaceholders}) ORDER BY name`)
    .all(...LIFECYCLE_TRIGGER_NAMES);
  if (triggerRows.length !== LIFECYCLE_TRIGGER_NAMES.length
    || triggerRows.some((row, index) => row.name !== LIFECYCLE_TRIGGER_NAMES[index] || typeof row.sql !== 'string')) {
    throw new Error('LIFECYCLE_IMMUTABLE');
  }
  const expectedDigest = lifecycleSealDigest(triggerRows);
  if (!sealBefore) {
    db.prepare('INSERT INTO qe_schema_seals(name,version,digest,installed_at) VALUES(?,?,?,?)')
      .run(LIFECYCLE_SEAL_NAME, 1, expectedDigest, Date.now());
  } else if (sealBefore.version !== 1 || sealBefore.digest !== expectedDigest) {
    throw new Error('LIFECYCLE_IMMUTABLE');
  }
}

function projectionSchemaDigest(db) {
  const names = [...PROJECTION_TABLE_NAMES, ...PROJECTION_INDEX_NAMES, ...PROJECTION_TRIGGER_NAMES];
  const placeholders = names.map(() => '?').join(',');
  const rows = db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY type,name`)
    .all(...names);
  if (rows.length !== names.length || rows.some(row => typeof row.sql !== 'string')) throw new Error('PROJECTION_STORE_CORRUPT');
  return sha256(canonicalJson(['qe-lifecycle-projection-schema-v1', PROJECTION_SCHEMA_VERSION, rows]));
}

function projectionEnsureSchema(db) {
  const tablePlaceholders = PROJECTION_TABLE_NAMES.map(() => '?').join(',');
  const existingTables = db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${tablePlaceholders}) ORDER BY name`)
    .all(...PROJECTION_TABLE_NAMES).map(row => row.name);
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(PROJECTION_SEAL_NAME);
  const objectNames = [...PROJECTION_INDEX_NAMES, ...PROJECTION_TRIGGER_NAMES];
  const objectPlaceholders = objectNames.map(() => '?').join(',');
  const existingObjects = db.prepare(`SELECT name FROM sqlite_schema WHERE name IN (${objectPlaceholders}) ORDER BY name`)
    .all(...objectNames).map(row => row.name);
  const fresh = existingTables.length === 0 && existingObjects.length === 0 && !seal;
  if (!fresh && (existingTables.join('|') !== [...PROJECTION_TABLE_NAMES].sort().join('|')
    || existingObjects.join('|') !== [...objectNames].sort().join('|') || !seal)) {
    throw new Error('PROJECTION_STORE_CORRUPT');
  }
  if (fresh) {
    db.exec(`
      CREATE TABLE lifecycle_projection_recipes(
        operation_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        recipe_json TEXT NOT NULL,
        recipe_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('staged','projected')),
        base_goals_sha256 TEXT NOT NULL,
        base_ledger_sha256 TEXT NOT NULL,
        base_state_sha256 TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX lifecycle_projection_recipe_slug ON lifecycle_projection_recipes(slug, operation_id);
      CREATE TABLE lifecycle_projection_heads(
        slug TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        recipe_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_projection_event_reservations(
        reservation_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
        UNIQUE(operation_id, ordinal)
      );
      CREATE INDEX lifecycle_projection_reservation_owner
        ON lifecycle_projection_event_reservations(slug, operation_id, ordinal);
      CREATE TABLE lifecycle_projection_receipts(
        operation_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL,
        post_goals_sha256 TEXT NOT NULL,
        post_ledger_sha256 TEXT NOT NULL,
        post_state_sha256 TEXT NOT NULL,
        projected_at INTEGER NOT NULL
      );
      CREATE TRIGGER lifecycle_projection_recipes_insert_guard
        BEFORE INSERT ON lifecycle_projection_recipes WHEN qe_lifecycle_projection_write_v1()<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_recipes_no_delete
        BEFORE DELETE ON lifecycle_projection_recipes BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_recipes_update_guard
        BEFORE UPDATE ON lifecycle_projection_recipes
        WHEN qe_lifecycle_projection_write_v1()<>1
          OR NEW.operation_id<>OLD.operation_id OR NEW.slug<>OLD.slug OR NEW.recipe_json<>OLD.recipe_json
          OR NEW.recipe_digest<>OLD.recipe_digest OR NEW.base_goals_sha256<>OLD.base_goals_sha256
          OR NEW.base_ledger_sha256<>OLD.base_ledger_sha256 OR NEW.base_state_sha256<>OLD.base_state_sha256
          OR NEW.created_at<>OLD.created_at OR OLD.status<>'staged' OR NEW.status<>'projected'
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_heads_insert_guard
        BEFORE INSERT ON lifecycle_projection_heads WHEN qe_lifecycle_projection_write_v1()<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_heads_no_update
        BEFORE UPDATE ON lifecycle_projection_heads BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_heads_delete_guard
        BEFORE DELETE ON lifecycle_projection_heads WHEN qe_lifecycle_projection_write_v1()<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_reservations_insert_guard
        BEFORE INSERT ON lifecycle_projection_event_reservations WHEN qe_lifecycle_projection_write_v1()<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_reservations_no_delete
        BEFORE DELETE ON lifecycle_projection_event_reservations BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_reservations_update_guard
        BEFORE UPDATE ON lifecycle_projection_event_reservations
        WHEN qe_lifecycle_projection_write_v1()<>1
          OR NEW.reservation_id<>OLD.reservation_id OR NEW.slug<>OLD.slug OR NEW.operation_id<>OLD.operation_id
          OR NEW.ordinal<>OLD.ordinal OR NEW.request_id<>OLD.request_id OR NEW.event_digest<>OLD.event_digest
          OR OLD.consumed<>0 OR NEW.consumed<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_receipts_insert_guard
        BEFORE INSERT ON lifecycle_projection_receipts WHEN qe_lifecycle_projection_write_v1()<>1
        BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_receipts_no_update
        BEFORE UPDATE ON lifecycle_projection_receipts BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_receipts_no_delete
        BEFORE DELETE ON lifecycle_projection_receipts BEGIN SELECT RAISE(ABORT, 'PROJECTION_IMMUTABLE'); END;
    `);
    const digest = projectionSchemaDigest(db);
    db.prepare('INSERT INTO qe_schema_seals(name,version,digest,installed_at) VALUES(?,?,?,?)')
      .run(PROJECTION_SEAL_NAME, PROJECTION_SCHEMA_VERSION, digest, Date.now());
    return;
  }
  const digest = projectionSchemaDigest(db);
  if (seal.version !== PROJECTION_SCHEMA_VERSION || seal.digest !== digest) throw new Error('PROJECTION_STORE_CORRUPT');
}

function debtSchemaDigest(db) {
  const names = [...DEBT_TABLE_NAMES, ...DEBT_INDEX_NAMES, ...DEBT_TRIGGER_NAMES];
  const placeholders = names.map(() => '?').join(',');
  const rows = db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY type,name`)
    .all(...names);
  if (rows.length !== names.length || rows.some(row => typeof row.sql !== 'string')) {
    throw new Error('DEBT_STORE_CORRUPT');
  }
  return sha256(canonicalJson(['qe-lifecycle-projection-debt-schema-v1', DEBT_SCHEMA_VERSION, rows]));
}

function debtEnsureSchema(db) {
  const names = [...DEBT_TABLE_NAMES, ...DEBT_INDEX_NAMES, ...DEBT_TRIGGER_NAMES];
  const placeholders = names.map(() => '?').join(',');
  const existing = db.prepare(`SELECT name FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY name`)
    .all(...names).map(row => row.name);
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(DEBT_SEAL_NAME);
  const fresh = existing.length === 0 && !seal;
  if (!fresh && (existing.join('|') !== [...names].sort().join('|') || !seal)) throw new Error('DEBT_STORE_CORRUPT');
  if (fresh) {
    db.exec(`
      CREATE TABLE lifecycle_projection_debts(
        debt_id TEXT PRIMARY KEY, slug TEXT NOT NULL, operation_id TEXT NOT NULL,
        recipe_digest TEXT NOT NULL, reason TEXT NOT NULL, replacement_operation_id TEXT,
        outcome TEXT NOT NULL, outcome_digest TEXT NOT NULL, coverage_policy TEXT NOT NULL,
        obligation_count INTEGER NOT NULL, obligation_digest TEXT NOT NULL,
        conflict_hashes_json TEXT NOT NULL, core_json TEXT NOT NULL, core_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX lifecycle_projection_debt_operation ON lifecycle_projection_debts(slug,operation_id);
      CREATE INDEX lifecycle_projection_debt_slug ON lifecycle_projection_debts(slug,debt_id);
      CREATE TABLE lifecycle_projection_debt_obligations(
        debt_id TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL,
        entry_json TEXT NOT NULL, entry_digest TEXT NOT NULL,
        PRIMARY KEY(debt_id,ordinal,kind)
      );
      CREATE TABLE lifecycle_projection_debt_resolutions(
        debt_id TEXT PRIMARY KEY, resolution_id TEXT NOT NULL UNIQUE, slug TEXT NOT NULL,
        mode TEXT NOT NULL, proof_json TEXT NOT NULL, proof_digest TEXT NOT NULL,
        proof_ref TEXT NOT NULL, resolved_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_projection_debt_compensations(
        debt_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
        binding_json TEXT NOT NULL, binding_digest TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_projection_debt_audit(
        slug TEXT NOT NULL, seq INTEGER NOT NULL, debt_id TEXT NOT NULL, kind TEXT NOT NULL,
        event_json TEXT NOT NULL, prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(slug,seq)
      );
      CREATE TABLE lifecycle_projection_debt_heads(
        slug TEXT PRIMARY KEY, seq INTEGER NOT NULL, event_hash TEXT NOT NULL
      );

      CREATE TRIGGER lifecycle_projection_debts_insert_guard BEFORE INSERT ON lifecycle_projection_debts
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debts_no_update BEFORE UPDATE ON lifecycle_projection_debts
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debts_no_delete BEFORE DELETE ON lifecycle_projection_debts
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_obligations_insert_guard BEFORE INSERT ON lifecycle_projection_debt_obligations
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_obligations_no_update BEFORE UPDATE ON lifecycle_projection_debt_obligations
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_obligations_no_delete BEFORE DELETE ON lifecycle_projection_debt_obligations
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_resolutions_insert_guard BEFORE INSERT ON lifecycle_projection_debt_resolutions
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_resolutions_no_update BEFORE UPDATE ON lifecycle_projection_debt_resolutions
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_resolutions_no_delete BEFORE DELETE ON lifecycle_projection_debt_resolutions
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_compensations_insert_guard BEFORE INSERT ON lifecycle_projection_debt_compensations
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_compensations_no_update BEFORE UPDATE ON lifecycle_projection_debt_compensations
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_compensations_no_delete BEFORE DELETE ON lifecycle_projection_debt_compensations
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_audit_insert_guard BEFORE INSERT ON lifecycle_projection_debt_audit
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_audit_no_update BEFORE UPDATE ON lifecycle_projection_debt_audit
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_audit_no_delete BEFORE DELETE ON lifecycle_projection_debt_audit
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_heads_insert_guard BEFORE INSERT ON lifecycle_projection_debt_heads
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_heads_update_guard BEFORE UPDATE ON lifecycle_projection_debt_heads
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER lifecycle_projection_debt_heads_delete_guard BEFORE DELETE ON lifecycle_projection_debt_heads
        WHEN qe_lifecycle_projection_debt_write_v1()<>1 BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER qe_schema_seals_debt_insert_guard BEFORE INSERT ON qe_schema_seals
        WHEN NEW.name='${DEBT_SEAL_NAME}' AND qe_lifecycle_projection_debt_write_v1()<>1
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER qe_schema_seals_debt_no_update BEFORE UPDATE ON qe_schema_seals
        WHEN OLD.name='${DEBT_SEAL_NAME}' OR NEW.name='${DEBT_SEAL_NAME}'
        BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
      CREATE TRIGGER qe_schema_seals_debt_no_delete BEFORE DELETE ON qe_schema_seals
        WHEN OLD.name='${DEBT_SEAL_NAME}' BEGIN SELECT RAISE(ABORT,'DEBT_IMMUTABLE'); END;
    `);
    const digest = debtSchemaDigest(db);
    debtWriteConnections.add(db);
    db.prepare('INSERT INTO qe_schema_seals(name,version,digest,installed_at) VALUES(?,?,?,?)')
      .run(DEBT_SEAL_NAME, DEBT_SCHEMA_VERSION, digest, Date.now());
    return;
  }
  const digest = debtSchemaDigest(db);
  if (seal.version !== DEBT_SCHEMA_VERSION || seal.digest !== digest) throw new Error('DEBT_STORE_CORRUPT');
}

function openLifecycleDb(cwd, diagnostics = null) {
  const db = openSqlite(cwd, { timeoutMs: 5000 });
  if (!db) return null;
  try {
    db.function('qe_lifecycle_roster_digest_v1', { deterministic: true }, (operationId, rosterJson) => {
      const roster = lifecycleRosterForDigest(String(operationId), String(rosterJson));
      return lifecycleRosterDigest(String(operationId), roster);
    });
    db.function('qe_lifecycle_projection_write_v1', { deterministic: false }, () => (
      projectionWriteConnections.has(db) ? 1 : 0
    ));
    db.function('qe_lifecycle_projection_debt_write_v1', { deterministic: false }, () => (
      debtWriteConnections.has(db) ? 1 : 0
    ));
    db.exec('BEGIN IMMEDIATE');
    lifecycleSchema(db);
    lifecycleBackfill(db);
    lifecycleInstallGuards(db);
    projectionEnsureSchema(db);
    debtEnsureSchema(db);
    db.exec('COMMIT');
    return db;
  }
  catch (error) {
    if (diagnostics) diagnostics.code = error?.message === 'PROJECTION_STORE_CORRUPT'
      ? 'PROJECTION_STORE_CORRUPT' : error?.message === 'DEBT_STORE_CORRUPT'
        ? 'DEBT_STORE_CORRUPT' : 'STORE_UNAVAILABLE';
    try { db.exec('ROLLBACK'); } catch {}
    closeSqlite(db);
    return null;
  }
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
    const semantic = db.prepare('SELECT operation_id,intent_digest,finalized,roster_json,roster_digest FROM lifecycle_operations WHERE slug=? AND semantic_key=?')
      .get(slug, captured.semanticKey);
    if (semantic) {
      const operationId = semantic.operation_id;
      if (semantic.finalized === 1) {
        if (semantic.intent_digest !== captured.intentDigest) {
          db.exec('ROLLBACK'); return lifecycleError('PAYLOAD_CONFLICT');
        }
        const operation = lifecycleOperationFromDb(db, operationId);
        db.exec('COMMIT');
        return { ok: true, code: 'REPLAYED', operation };
      }
      const replay = normalizeLifecycleCreate(slug, { ...input, operationId });
      if (!replay || replay.intentDigest !== semantic.intent_digest) { db.exec('ROLLBACK'); return lifecycleError('PAYLOAD_CONFLICT'); }
      const existingChildren = db.prepare('SELECT * FROM lifecycle_operation_children WHERE operation_id=? ORDER BY ordinal').all(operationId);
      if (existingChildren.length > replay.normalized.length) { db.exec('ROLLBACK'); return lifecycleError('STORE_UNAVAILABLE'); }
      const existingByOrdinal = new Map(existingChildren.map(child => [child.ordinal, child]));
      const insertChild = db.prepare(`INSERT INTO lifecycle_operation_children
        (operation_id,ordinal,layer,operation_kind,process_id,request_id,request_json,status,attempt,claim_owner,claim_token,lease_until,result_ref_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (let ordinal = 0; ordinal < replay.normalized.length; ordinal += 1) {
        const item = replay.normalized[ordinal];
        const manifest = replay.roster[ordinal];
        const existingChild = existingByOrdinal.get(ordinal);
        if (existingChild) {
          if (!lifecycleChildMatchesRosterEntry(manifest, lifecycleChildManifestValue(existingChild))) {
            db.exec('ROLLBACK'); return lifecycleError('STORE_UNAVAILABLE');
          }
          continue;
        }
        insertChild.run(operationId, ordinal, item.semantic.layer, item.semantic.operation,
          item.semantic.processId, item.requestId, canonicalJson(item.request), 'pending', 0, null, null, null, null);
      }
      db.prepare(`UPDATE lifecycle_operations SET roster_json=?,roster_digest=?,finalized=1 WHERE operation_id=?`)
        .run(canonicalJson(replay.roster), lifecycleRosterDigest(operationId, replay.roster), operationId);
      const operation = lifecycleOperationFromDb(db, operationId);
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
    const parent = db.prepare('SELECT finalized FROM lifecycle_operations WHERE operation_id=?').get(operationId);
    if (!operation || operation.slug !== slug) return lifecycleError('NOT_FOUND');
    if (parent?.finalized !== 1) return lifecycleError('STORE_UNAVAILABLE');
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
    if (!rows || rows.parent.slug !== slug || rows.parent.finalized !== 1 || !rows.children[ordinal]) return { error: 'NOT_FOUND' };
    return { row: rows.children[ordinal] };
  } catch { return { error: 'STORE_UNAVAILABLE' }; }
  finally { closeSqlite(db); }
}

function projectionFault(point) {
  const injector = globalThis[Symbol.for('qe.lifecycle-projection.fault-injector')];
  if (typeof injector === 'function') injector(point);
}

function projectionPaths(slug) {
  return {
    goals: join(PLANS_DIR, slug, 'goals.json'),
    ledger: join(PLANS_DIR, slug, 'ledger.jsonl'),
    state: join(PLANS_DIR, slug, 'STATE.md'),
  };
}

function projectionReservationId(slug, operationId, ordinal, requestId) {
  return sha256(canonicalJson(['qe-lifecycle-projection-event-v1', slug, operationId, ordinal, requestId]));
}

function projectionGoalHash(goal) { return sha256(canonicalJson(goal)); }

function projectionString(value, maxBytes) {
  return typeof value === 'string' && !value.includes('\0')
    && Buffer.from(value, 'utf8').toString('utf8') === value
    && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function projectionNormalizeRecipe(recipe, rows, goalsDoc) {
  if (!lifecycleExact(recipe, ['schema', 'baseGoalsSha256', 'baseLedgerSha256', 'baseStateSha256', 'children'])
    || recipe.schema !== 1 || !Array.isArray(recipe.children)
    || recipe.children.length < 1 || recipe.children.length > LIFECYCLE_MAX_CHILDREN
    || ![recipe.baseGoalsSha256, recipe.baseLedgerSha256, recipe.baseStateSha256]
      .every(value => /^[0-9a-f]{64}$/.test(String(value)))) throw new TypeError('recipe');
  if (recipe.children.length !== rows.children.length) throw new TypeError('recipe');
  const goals = new Map(goalsDoc.goals.map(goal => [goal.id, goal]));
  const normalized = [];
  for (let ordinal = 0; ordinal < recipe.children.length; ordinal += 1) {
    const child = lifecycleClone(recipe.children[ordinal]);
    const journal = rows.children[ordinal];
    if (!lifecycleExact(child, ['ordinal', 'goalId', 'expectedTargetSha256', 'set', 'event'])
      || child.ordinal !== ordinal || !/^G\d{3,}$/.test(child.goalId)
      || !/^[0-9a-f]{64}$/.test(String(child.expectedTargetSha256))
      || journal.ordinal !== ordinal || journal.layer !== 'goal' || journal.operation_kind !== 'transition'
      || journal.process_id !== `qe-plan:${rows.parent.slug}:goal:${child.goalId}`) throw new TypeError('recipe');
    const request = lifecycleParseJson(journal.request_json);
    const goal = goals.get(child.goalId);
    if (!request || !goal || child.expectedTargetSha256 !== projectionGoalHash(goal)
      || !lifecyclePlainObject(child.set) || !lifecycleExact(child.event, ['event', 'status', 'evidence'])) throw new TypeError('recipe');
    const setKeys = Object.keys(child.set).sort();
    if (!setKeys.includes('status') || setKeys.some(key => !['attempts', 'status'].includes(key))
      || !['pending', 'active', 'blocked', 'failed'].includes(child.set.status)
      || child.set.status !== request.to) throw new TypeError('recipe');
    if (child.set.status === 'active') {
      if (!lifecycleExact(child.set, ['status', 'attempts']) || !Number.isSafeInteger(child.set.attempts)
        || child.set.attempts !== goal.attempts + 1) throw new TypeError('recipe');
    } else if (!lifecycleExact(child.set, ['status'])) throw new TypeError('recipe');
    const expectedEvent = { active: 'started', blocked: 'blocker', failed: 'failed', pending: 'checkpoint' }[child.set.status];
    if (child.event.event !== expectedEvent || child.event.status !== child.set.status
      || !projectionString(child.event.evidence, 48 * 1024)) throw new TypeError('recipe');
    normalized.push(child);
  }
  const encoded = canonicalJson({ schema: 1, baseGoalsSha256: recipe.baseGoalsSha256,
    baseLedgerSha256: recipe.baseLedgerSha256, baseStateSha256: recipe.baseStateSha256, children: normalized });
  if (Buffer.byteLength(encoded, 'utf8') > LIFECYCLE_MAX_AGGREGATE) throw new TypeError('recipe');
  return { value: JSON.parse(encoded), encoded, digest: sha256(encoded) };
}

function projectionStateParts(text) {
  if (typeof text !== 'string' || text.includes('\0') || Buffer.from(text, 'utf8').toString('utf8') !== text) return null;
  const hasLf = /(^|[^\r])\n/.test(text);
  const hasCrlf = /\r\n/.test(text);
  if (hasLf && hasCrlf || /\r(?!\n)/.test(text)) return null;
  const newline = hasCrlf ? '\r\n' : '\n';
  const lf = text.replace(/\r\n/g, '\n');
  let fenced = false;
  let headings = 0;
  for (const line of lf.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line === PROGRESS_HEADING) headings += 1;
  }
  return !fenced && headings === 1 ? { newline, lf } : null;
}

function projectionRenderState(prior, doc) {
  const parsed = projectionStateParts(prior);
  if (!parsed) return null;
  const allComplete = doc.goals.length > 0 && doc.goals.every(goal => goal.status === 'complete');
  const hasBlocker = doc.goals.some(goal => goal.status === 'blocked' || goal.status === 'failed');
  const planStatus = allComplete ? 'complete' : hasBlocker ? 'blocked' : 'active';
  const currentGoal = doc.goals.find(goal => goal.status === 'active')
    || doc.goals.find(goal => goal.status === 'blocked') || doc.goals.find(goal => goal.status === 'pending')
    || doc.goals.find(goal => goal.status === 'failed') || doc.goals.at(-1);
  const mark = { pending: ' ', active: '>', complete: 'x', failed: '!', blocked: '~' };
  const byPhase = new Map();
  for (const goal of doc.goals) {
    if (!byPhase.has(goal.phase)) byPhase.set(goal.phase, []);
    byPhase.get(goal.phase).push(goal);
  }
  let block = `${PROGRESS_HEADING}\n\n> 자동 생성 (ledger.mjs render-state) — 직접 수정 금지\n`;
  for (const [phase, goals] of byPhase) {
    block += `\n### ${phase}\n`;
    for (const goal of goals) {
      const wave = goal.wave && goal.wave !== '-' ? `[${goal.wave}] ` : '';
      block += `- [${mark[goal.status] || ' '}] ${goal.id} ${wave}${goal.title}\n`;
    }
  }
  let next = parsed.lf;
  if (/^Status:.*$/m.test(next)) next = next.replace(/^Status:.*$/m, `Status: ${planStatus}`);
  else next = next.replace(/^(# .*\n)/, `$1\nStatus: ${planStatus}\n`);
  const phase = currentGoal?.phase || 'none';
  if (/^Current phase:.*$/m.test(next)) next = next.replace(/^Current phase:.*$/m, `Current phase: ${phase}`);
  else next = next.replace(/^(Status:.*\n)/m, `$1Current phase: ${phase}\n`);
  const idx = next.indexOf(PROGRESS_HEADING);
  const after = next.slice(idx + PROGRESS_HEADING.length);
  const nextHeading = after.search(/\n##\s/);
  const tail = nextHeading === -1 ? '' : after.slice(nextHeading);
  next = next.slice(0, idx) + block.replace(/\n*$/, '\n') + tail;
  return parsed.newline === '\r\n' ? next.replace(/\n/g, '\r\n') : next;
}

function projectionReceiptReplay(db, row, paths) {
  try {
    const receipt = JSON.parse(row.receipt_json);
    if (canonicalJson(receipt) !== row.receipt_json || sha256(row.receipt_json) !== row.receipt_hash) return null;
    const goals = canonicalPlanReadRow(db, paths.goals);
    const ledger = canonicalPlanReadRow(db, paths.ledger);
    const state = canonicalPlanReadRow(db, paths.state);
    if (!goals || !ledger || !state || goals.sha256 !== row.post_goals_sha256
      || ledger.sha256 !== row.post_ledger_sha256 || state.sha256 !== row.post_state_sha256) return null;
    return receipt;
  } catch { return null; }
}

function debtFault(point) {
  const injector = globalThis[Symbol.for('qe.lifecycle-projection-debt.fault-injector')];
  if (typeof injector === 'function') injector(point);
}

function debtObligationDigest(entries) {
  return sha256(canonicalJson(['qe-lifecycle-projection-obligations-v1', entries]));
}

function debtAppendAudit(db, slug, debtId, kind, detail, timestamp = Date.now()) {
  const head = db.prepare('SELECT seq,event_hash FROM lifecycle_projection_debt_heads WHERE slug=?').get(slug);
  const seq = head ? head.seq + 1 : 0;
  const prevHash = head ? head.event_hash : '0'.repeat(64);
  const event = { schema: 1, slug, debtId, kind, seq, prevHash, timestamp, detail };
  const eventJson = canonicalJson(event);
  const eventHash = sha256(canonicalJson(['qe-lifecycle-projection-debt-audit-v1', slug, seq, prevHash, event]));
  db.prepare(`INSERT INTO lifecycle_projection_debt_audit
    (slug,seq,debt_id,kind,event_json,prev_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(slug, seq, debtId, kind, eventJson, prevHash, eventHash, timestamp);
  if (head) db.prepare('UPDATE lifecycle_projection_debt_heads SET seq=?,event_hash=? WHERE slug=? AND seq=? AND event_hash=?')
    .run(seq, eventHash, slug, head.seq, head.event_hash);
  else db.prepare('INSERT INTO lifecycle_projection_debt_heads(slug,seq,event_hash) VALUES(?,?,?)')
    .run(slug, seq, eventHash);
  if (head && db.prepare('SELECT changes() AS changes').get().changes !== 1) throw new Error('DEBT_STORE_CORRUPT');
  debtFault(`audit:${kind}`);
  return { seq, eventHash, event };
}

function debtValidateStore(db, onlySlug = null) {
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(DEBT_SEAL_NAME);
  if (!seal || seal.version !== DEBT_SCHEMA_VERSION || seal.digest !== debtSchemaDigest(db)) {
    throw new Error('DEBT_STORE_CORRUPT');
  }
  const debts = db.prepare(`SELECT * FROM lifecycle_projection_debts${onlySlug ? ' WHERE slug=?' : ''} ORDER BY slug,debt_id`)
    .all(...(onlySlug ? [onlySlug] : []));
  const debtMap = new Map();
  for (const row of debts) {
    const core = lifecycleParseJson(row.core_json);
    if (!core || canonicalJson(core) !== row.core_json || sha256(row.core_json) !== row.core_hash
      || core.schema !== 1 || core.debtId !== row.debt_id || core.slug !== row.slug
      || core.operationId !== row.operation_id || core.recipeDigest !== row.recipe_digest
      || core.reason !== row.reason || core.replacementOperationId !== row.replacement_operation_id
      || core.outcome !== row.outcome || core.outcomeDigest !== row.outcome_digest
      || core.coveragePolicy !== row.coverage_policy || core.obligationCount !== row.obligation_count
      || core.obligationDigest !== row.obligation_digest || canonicalJson(core.conflictHashes) !== row.conflict_hashes_json
      || core.createdAt !== row.created_at || !/^[0-9a-f]{64}$/.test(row.debt_id)
      || !DEBT_REASONS.has(row.reason) || !['effect', 'lineage'].includes(row.coverage_policy)) {
      throw new Error('DEBT_STORE_CORRUPT');
    }
    const obligationRows = db.prepare('SELECT * FROM lifecycle_projection_debt_obligations WHERE debt_id=? ORDER BY ordinal,kind')
      .all(row.debt_id);
    const entries = [];
    let bytes = 0;
    for (const obligation of obligationRows) {
      const entry = lifecycleParseJson(obligation.entry_json);
      bytes += Buffer.byteLength(obligation.entry_json, 'utf8');
      if (!entry || canonicalJson(entry) !== obligation.entry_json
        || sha256(obligation.entry_json) !== obligation.entry_digest
        || entry.ordinal !== obligation.ordinal || entry.kind !== obligation.kind
        || !['event', 'result', 'target'].includes(obligation.kind)
        || Buffer.byteLength(obligation.entry_json, 'utf8') > LIFECYCLE_MAX_JSON) throw new Error('DEBT_STORE_CORRUPT');
      entries.push(entry);
    }
    if (bytes > LIFECYCLE_MAX_AGGREGATE || entries.length !== row.obligation_count
      || debtObligationDigest(entries) !== row.obligation_digest) throw new Error('DEBT_STORE_CORRUPT');
    const recipe = db.prepare('SELECT slug,recipe_json,recipe_digest FROM lifecycle_projection_recipes WHERE operation_id=?')
      .get(row.operation_id);
    if (!recipe || recipe.slug !== row.slug || recipe.recipe_digest !== row.recipe_digest
      || sha256(recipe.recipe_json) !== recipe.recipe_digest
      || canonicalJson(lifecycleParseJson(recipe.recipe_json)) !== recipe.recipe_json) {
      throw new Error('DEBT_STORE_CORRUPT');
    }
    debtMap.set(row.debt_id, { row, core, obligations: entries });
  }
  const auditRows = db.prepare(`SELECT * FROM lifecycle_projection_debt_audit${onlySlug ? ' WHERE slug=?' : ''} ORDER BY slug,seq`)
    .all(...(onlySlug ? [onlySlug] : []));
  const auditBySlug = new Map();
  for (const row of auditRows) {
    if (!auditBySlug.has(row.slug)) auditBySlug.set(row.slug, []);
    auditBySlug.get(row.slug).push(row);
  }
  for (const [slug, rows] of auditBySlug) {
    let previous = '0'.repeat(64);
    rows.forEach((row, seq) => {
      const event = lifecycleParseJson(row.event_json);
      const expected = event && sha256(canonicalJson(['qe-lifecycle-projection-debt-audit-v1', slug, seq, previous, event]));
      const debt = event && debtMap.get(event.debtId);
      const exactDetail = event?.kind === 'quarantined'
        ? lifecycleExact(event.detail, ['operationId', 'obligationDigest', 'recipeDigest'])
          && event.detail.operationId === debt?.row.operation_id
          && event.detail.obligationDigest === debt?.row.obligation_digest
          && event.detail.recipeDigest === debt?.row.recipe_digest
        : event?.kind === 'compensation-bound'
          ? lifecycleExact(event.detail, ['operationId', 'bindingDigest'])
            && !!db.prepare(`SELECT 1 FROM lifecycle_projection_debt_compensations
              WHERE debt_id=? AND operation_id=? AND binding_digest=?`).get(
                event.debtId, event.detail.operationId, event.detail.bindingDigest)
          : event?.kind === 'resolved'
            ? lifecycleExact(event.detail, ['mode', 'proofDigest', 'resolutionId'])
              && !!db.prepare(`SELECT 1 FROM lifecycle_projection_debt_resolutions
                WHERE debt_id=? AND mode=? AND proof_digest=? AND resolution_id=?`).get(
                  event.debtId, event.detail.mode, event.detail.proofDigest, event.detail.resolutionId)
            : false;
      if (!event || canonicalJson(event) !== row.event_json || row.seq !== seq || row.prev_hash !== previous
        || row.event_hash !== expected || event.slug !== slug || event.seq !== seq || event.prevHash !== previous
        || event.debtId !== row.debt_id || event.kind !== row.kind
        || !['quarantined', 'compensation-bound', 'resolved'].includes(row.kind)
        || !debtMap.has(row.debt_id) || !lifecycleExact(event,
          ['schema', 'slug', 'debtId', 'kind', 'seq', 'prevHash', 'timestamp', 'detail'])
        || event.schema !== 1 || event.timestamp !== row.created_at
        || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || !exactDetail) {
        throw new Error('DEBT_STORE_CORRUPT');
      }
      previous = row.event_hash;
    });
    const head = db.prepare('SELECT seq,event_hash FROM lifecycle_projection_debt_heads WHERE slug=?').get(slug);
    if (!head || head.seq !== rows.length - 1 || head.event_hash !== previous) throw new Error('DEBT_STORE_CORRUPT');
  }
  const heads = db.prepare(`SELECT slug FROM lifecycle_projection_debt_heads${onlySlug ? ' WHERE slug=?' : ''}`)
    .all(...(onlySlug ? [onlySlug] : []));
  if (heads.some(row => !auditBySlug.has(row.slug))) throw new Error('DEBT_STORE_CORRUPT');
  for (const [debtId, debt] of debtMap) {
    const audit = auditBySlug.get(debt.row.slug) || [];
    if (audit.filter(row => row.debt_id === debtId && row.kind === 'quarantined').length !== 1) {
      throw new Error('DEBT_STORE_CORRUPT');
    }
    const binding = db.prepare('SELECT * FROM lifecycle_projection_debt_compensations WHERE debt_id=?').get(debtId);
    const resolution = db.prepare('SELECT * FROM lifecycle_projection_debt_resolutions WHERE debt_id=?').get(debtId);
    if (binding) {
      const value = lifecycleParseJson(binding.binding_json);
      const operation = lifecycleInternalRows(db, binding.operation_id);
      const payload = operation && lifecycleParseJson(operation.parent.payload_json);
      if (!value || canonicalJson(value) !== binding.binding_json
        || sha256(binding.binding_json) !== binding.binding_digest || value.schema !== 1
        || value.debtId !== debtId || value.slug !== debt.row.slug
        || value.operationId !== binding.operation_id || value.obligationDigest !== debt.row.obligation_digest
        || value.createdAt !== binding.created_at || !LIFECYCLE_UUID_RE.test(binding.operation_id)
        || !operation || operation.parent.slug !== debt.row.slug || operation.parent.kind !== 'controller-projected'
        || !lifecycleExact(payload, ['compensatesDebtId', 'obligationDigest'])
        || payload.compensatesDebtId !== debtId || payload.obligationDigest !== debt.row.obligation_digest) {
        throw new Error('DEBT_STORE_CORRUPT');
      }
    }
    if (resolution) {
      const proof = lifecycleParseJson(resolution.proof_json);
      const expectedId = sha256(canonicalJson(['qe-lifecycle-projection-debt-resolution-v1',
        debtId, resolution.mode, resolution.proof_digest]));
      if (!proof || canonicalJson(proof) !== resolution.proof_json
        || sha256(resolution.proof_json) !== resolution.proof_digest
        || resolution.resolution_id !== expectedId || resolution.slug !== debt.row.slug
        || !['equivalence', 'compensation'].includes(resolution.mode)
        || !Number.isSafeInteger(resolution.resolved_at) || resolution.resolved_at < 0) {
        throw new Error('DEBT_STORE_CORRUPT');
      }
      if (resolution.mode === 'compensation') {
        const receipt = db.prepare('SELECT * FROM lifecycle_projection_receipts WHERE operation_id=? AND slug=?')
          .get(resolution.proof_ref, debt.row.slug);
        const projected = db.prepare("SELECT recipe_digest FROM lifecycle_projection_recipes WHERE operation_id=? AND slug=? AND status='projected'")
          .get(resolution.proof_ref, debt.row.slug);
        const receiptValue = receipt && lifecycleParseJson(receipt.receipt_json);
        if (!binding || binding.operation_id !== resolution.proof_ref || !receipt || !projected
          || !receiptValue || canonicalJson(receiptValue) !== receipt.receipt_json
          || sha256(receipt.receipt_json) !== receipt.receipt_hash
          || receiptValue.recipeDigest !== projected.recipe_digest) throw new Error('DEBT_STORE_CORRUPT');
      }
    }
    if (binding && audit.filter(row => row.debt_id === debtId && row.kind === 'compensation-bound').length !== 1) {
      throw new Error('DEBT_STORE_CORRUPT');
    }
    if (resolution && audit.filter(row => row.debt_id === debtId && row.kind === 'resolved').length !== 1) {
      throw new Error('DEBT_STORE_CORRUPT');
    }
    debt.binding = binding || null;
    debt.resolution = resolution || null;
  }
  const bindingCount = db.prepare(`SELECT COUNT(*) AS count FROM lifecycle_projection_debt_compensations
    ${onlySlug ? 'WHERE debt_id IN (SELECT debt_id FROM lifecycle_projection_debts WHERE slug=?)' : ''}`)
    .get(...(onlySlug ? [onlySlug] : [])).count;
  const resolutionCount = db.prepare(`SELECT COUNT(*) AS count FROM lifecycle_projection_debt_resolutions
    ${onlySlug ? 'WHERE slug=?' : ''}`).get(...(onlySlug ? [onlySlug] : [])).count;
  const expectedBindings = [...debtMap.values()].filter(debt => debt.binding).length;
  const expectedResolutions = [...debtMap.values()].filter(debt => debt.resolution).length;
  const orphanBindings = db.prepare(`SELECT COUNT(*) AS count FROM lifecycle_projection_debt_compensations b
    WHERE NOT EXISTS(SELECT 1 FROM lifecycle_projection_debts d WHERE d.debt_id=b.debt_id)`).get().count;
  const orphanResolutions = db.prepare(`SELECT COUNT(*) AS count FROM lifecycle_projection_debt_resolutions r
    WHERE NOT EXISTS(SELECT 1 FROM lifecycle_projection_debts d WHERE d.debt_id=r.debt_id)`).get().count;
  if (bindingCount !== expectedBindings || resolutionCount !== expectedResolutions
    || orphanBindings || orphanResolutions) throw new Error('DEBT_STORE_CORRUPT');
  return debtMap;
}

function debtOutstanding(db, slug) {
  const debts = debtValidateStore(db, slug);
  const liabilities = [];
  for (const [debtId, debt] of debts) if (!debt.resolution) liabilities.push(`debt:${debtId}`);
  const projectionObjects = db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='lifecycle_projection_recipes'").get();
  if (projectionObjects.count === 1) {
    const rows = db.prepare(`SELECT DISTINCT r.operation_id FROM lifecycle_projection_recipes r
      LEFT JOIN lifecycle_projection_receipts receipt ON receipt.operation_id=r.operation_id
      LEFT JOIN lifecycle_projection_debts debt ON debt.operation_id=r.operation_id AND debt.slug=r.slug
      WHERE r.slug=? AND receipt.operation_id IS NULL AND debt.debt_id IS NULL
      UNION SELECT DISTINCT h.operation_id FROM lifecycle_projection_heads h
      LEFT JOIN lifecycle_projection_receipts receipt ON receipt.operation_id=h.operation_id
      LEFT JOIN lifecycle_projection_debts debt ON debt.operation_id=h.operation_id AND debt.slug=h.slug
      WHERE h.slug=? AND receipt.operation_id IS NULL AND debt.debt_id IS NULL
      UNION SELECT DISTINCT e.operation_id FROM lifecycle_projection_event_reservations e
      LEFT JOIN lifecycle_projection_receipts receipt ON receipt.operation_id=e.operation_id
      LEFT JOIN lifecycle_projection_debts debt ON debt.operation_id=e.operation_id AND debt.slug=e.slug
      WHERE e.slug=? AND receipt.operation_id IS NULL AND debt.debt_id IS NULL`).all(slug, slug, slug);
    for (const row of rows) liabilities.push(`projection:${row.operation_id}`);
  }
  const ordered = [...new Set(liabilities)].sort();
  return { items: ordered, count: ordered.length, digest: sha256(canonicalJson(ordered)) };
}

function debtAssertionInTransaction(db, slug) {
  try {
    debtEnsureSchema(db);
    const outstanding = debtOutstanding(db, slug);
    if (outstanding.count) {
      const error = new Error('PROJECTION_DEBT_OUTSTANDING'); error.code = 'PROJECTION_DEBT_OUTSTANDING';
      error.outstanding = outstanding; throw error;
    }
    debtFault('completion-assertion');
    return outstanding;
  } catch (error) {
    if (error?.code === 'PROJECTION_DEBT_OUTSTANDING') throw error;
    const wrapped = new Error(error?.message === 'DEBT_STORE_CORRUPT'
      ? 'PROJECTION_DEBT_CORRUPT' : 'PROJECTION_DEBT_UNAVAILABLE');
    wrapped.code = wrapped.message;
    throw wrapped;
  }
}

export function assertNoLifecycleProjectionDebt(cwd, slug) {
  if (!LIFECYCLE_SLUG_RE.test(slug)) return lifecycleError('INVALID_INPUT');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code === 'DEBT_STORE_CORRUPT' ? 'DEBT_STORE_CORRUPT' : 'STORE_UNAVAILABLE');
  try {
    const outstanding = debtOutstanding(db, slug);
    return outstanding.count
      ? { ok: false, code: 'OUTSTANDING_DEBT', outstandingCount: outstanding.count, outstandingDigest: outstanding.digest }
      : { ok: true, code: 'CLEAR', outstandingCount: 0, outstandingDigest: outstanding.digest };
  } catch (error) { return lifecycleError(error?.message === 'DEBT_STORE_CORRUPT' ? 'DEBT_STORE_CORRUPT' : 'STORE_UNAVAILABLE'); }
  finally { closeSqlite(db); }
}

function debtEntriesForProjection(recipe, rows, selectedCount) {
  const entries = [];
  for (let ordinal = 0; ordinal < selectedCount; ordinal += 1) {
    const child = recipe.children[ordinal];
    const journal = rows.children[ordinal];
    const target = { ordinal, kind: 'target', scope: 'goal', goalId: child.goalId,
      set: child.set, setDigest: sha256(canonicalJson(child.set)), processId: journal.process_id };
    const event = { ordinal, kind: 'event', goalId: child.goalId, event: child.event,
      status: child.event.status, evidence: child.event.evidence, processId: journal.process_id,
      requestId: journal.request_id, eventDigest: sha256(canonicalJson(child.event)) };
    entries.push(target, event);
    const resultRef = lifecycleParseJson(journal.result_ref_json);
    if (resultRef) entries.push({ ordinal, kind: 'result', processId: journal.process_id,
      requestId: journal.request_id, resultRef, resultDigest: sha256(canonicalJson(resultRef)) });
  }
  entries.sort((a, b) => a.ordinal - b.ordinal || a.kind.localeCompare(b.kind));
  const bytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(canonicalJson(entry), 'utf8'), 0);
  if (entries.some(entry => Buffer.byteLength(canonicalJson(entry), 'utf8') > LIFECYCLE_MAX_JSON)
    || bytes > LIFECYCLE_MAX_AGGREGATE) throw new Error('INVALID_INPUT');
  return entries;
}

function debtTerminalOutcome(db, rows) {
  const result = lifecycleParseJson(rows.parent.result_json);
  if (rows.parent.status === 'committed' && result?.outcome === 'committed'
    && result.childCount === rows.children.length && rows.parent.current_ordinal === rows.children.length
    && rows.children.every(child => child.status === 'committed' && projectionAuditMatches(db, child))) {
    return { valid: true, outcome: 'committed', selectedCount: rows.children.length, deniedOrdinal: null };
  }
  const deniedOrdinal = result?.ordinal;
  if (rows.parent.status === 'denied' && result?.outcome === 'denied' && Number.isSafeInteger(deniedOrdinal)
    && deniedOrdinal >= 0 && deniedOrdinal < rows.children.length
    && rows.children.slice(0, deniedOrdinal).every(child => child.status === 'committed' && projectionAuditMatches(db, child))
    && rows.children[deniedOrdinal]?.status === 'denied' && projectionAuditMatches(db, rows.children[deniedOrdinal])
    && rows.children.slice(deniedOrdinal + 1).every(child => child.status === 'cancelled')) {
    return { valid: true, outcome: 'denied', selectedCount: deniedOrdinal + 1, deniedOrdinal };
  }
  const firstDenied = rows.children.findIndex(child => child.status === 'denied');
  const reconstructed = firstDenied >= 0
    ? rows.children.slice(0, firstDenied).every(child => child.status === 'committed' && projectionAuditMatches(db, child))
      && projectionAuditMatches(db, rows.children[firstDenied])
      && rows.children.slice(firstDenied + 1).every(child => child.status === 'cancelled')
      ? { outcome: 'denied', selectedCount: firstDenied + 1, deniedOrdinal: firstDenied } : null
    : rows.children.every(child => child.status === 'committed' && projectionAuditMatches(db, child))
      ? { outcome: 'committed', selectedCount: rows.children.length, deniedOrdinal: null } : null;
  return reconstructed ? { valid: false, reconstructed: true, ...reconstructed }
    : { valid: false, reconstructed: false };
}

function debtInsertBinding(db, debt, operationId, timestamp) {
  const binding = { schema: 1, debtId: debt.core.debtId, slug: debt.core.slug, operationId,
    obligationDigest: debt.core.obligationDigest, createdAt: timestamp };
  const bindingJson = canonicalJson(binding);
  const bindingDigest = sha256(bindingJson);
  db.prepare(`INSERT INTO lifecycle_projection_debt_compensations
    (debt_id,operation_id,binding_json,binding_digest,created_at) VALUES(?,?,?,?,?)`)
    .run(debt.core.debtId, operationId, bindingJson, bindingDigest, timestamp);
  debtAppendAudit(db, debt.core.slug, debt.core.debtId, 'compensation-bound',
    { operationId, bindingDigest }, timestamp);
  return { binding, bindingDigest };
}

export function quarantineLifecycleProjection(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId', 'reason', 'replacementOperationId'])
    || !LIFECYCLE_UUID_RE.test(input.operationId) || !DEBT_REASONS.has(input.reason)
    || (input.reason === 'SUPERSEDED' ? !LIFECYCLE_UUID_RE.test(String(input.replacementOperationId || ''))
      : input.replacementOperationId !== null)) return lifecycleError('INVALID_INPUT');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    debtValidateStore(db, slug);
    const existing = db.prepare('SELECT * FROM lifecycle_projection_debts WHERE slug=? AND operation_id=?').get(slug, input.operationId);
    if (existing) {
      debtValidateStore(db, slug);
      const same = existing.reason === input.reason
        && existing.replacement_operation_id === input.replacementOperationId
        && !db.prepare('SELECT 1 FROM lifecycle_projection_heads WHERE slug=? AND operation_id=?').get(slug, input.operationId);
      db.exec(same ? 'COMMIT' : 'ROLLBACK');
      return same ? { ok: true, code: 'REPLAYED', debtId: existing.debt_id } : lifecycleError('DEBT_CONFLICT');
    }
    const stored = db.prepare('SELECT * FROM lifecycle_projection_recipes WHERE operation_id=? AND slug=?').get(input.operationId, slug);
    const head = db.prepare('SELECT * FROM lifecycle_projection_heads WHERE slug=?').get(slug);
    const receipt = db.prepare('SELECT 1 FROM lifecycle_projection_receipts WHERE operation_id=?').get(input.operationId);
    const rows = lifecycleInternalRows(db, input.operationId);
    if (receipt || !stored || stored.status !== 'staged' || !head || head.operation_id !== input.operationId
      || head.recipe_digest !== stored.recipe_digest || !rows || rows.parent.slug !== slug
      || rows.parent.kind !== 'controller-projected') { db.exec('ROLLBACK'); return lifecycleError('PROJECTION_NOT_READY'); }
    let recipe;
    try { recipe = JSON.parse(stored.recipe_json); }
    catch { db.exec('ROLLBACK'); return lifecycleError('PROJECTION_STORE_CORRUPT'); }
    if (canonicalJson(recipe) !== stored.recipe_json || sha256(stored.recipe_json) !== stored.recipe_digest) {
      db.exec('ROLLBACK'); return lifecycleError('PROJECTION_STORE_CORRUPT');
    }
    const reservations = db.prepare('SELECT * FROM lifecycle_projection_event_reservations WHERE operation_id=? ORDER BY ordinal')
      .all(input.operationId);
    const reservationConflict = reservations.length !== rows.children.length || reservations.some((reservation, ordinal) =>
      reservation.slug !== slug || reservation.ordinal !== ordinal || reservation.request_id !== rows.children[ordinal].request_id
      || reservation.event_digest !== sha256(canonicalJson(recipe.children[ordinal].event)));
    const paths = projectionPaths(slug);
    const goals = canonicalPlanReadRow(db, paths.goals);
    const ledger = canonicalPlanReadRow(db, paths.ledger);
    const state = canonicalPlanReadRow(db, paths.state);
    const terminal = debtTerminalOutcome(db, rows);
    let selectedCount;
    let outcome;
    let coveragePolicy = 'effect';
    let replacement = null;
    const prospectiveDebtId = sha256(canonicalJson(['qe-lifecycle-projection-debt-v1', slug,
      input.operationId, stored.recipe_digest, input.reason]));
    if (input.reason === 'SUPERSEDED') {
      const replacementRows = lifecycleInternalRows(db, input.replacementOperationId);
      const payload = replacementRows && lifecycleParseJson(replacementRows.parent.payload_json);
      const pristine = replacementRows && replacementRows.parent.slug === slug
        && replacementRows.parent.operation_id !== input.operationId && replacementRows.parent.kind === 'controller-projected'
        && replacementRows.parent.finalized === 1 && replacementRows.parent.status === 'pending'
        && replacementRows.parent.current_ordinal === 0 && replacementRows.parent.result_json === null
        && replacementRows.children.length >= 1 && replacementRows.children.every(child => child.status === 'pending'
          && child.attempt === 0 && child.claim_owner === null && child.claim_token === null
          && child.lease_until === null && child.result_ref_json === null)
        && lifecycleExact(payload, ['compensatesDebtId', 'obligationDigest'])
        && payload.compensatesDebtId === prospectiveDebtId
        && !db.prepare(`SELECT 1 FROM lifecycle_projection_recipes WHERE operation_id=? UNION
          SELECT 1 FROM lifecycle_projection_receipts WHERE operation_id=? UNION
          SELECT 1 FROM lifecycle_projection_event_reservations WHERE operation_id=?`).get(
            input.replacementOperationId, input.replacementOperationId, input.replacementOperationId);
      if (!pristine) { db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED'); }
      if (rows.parent.status !== 'pending' || rows.parent.current_ordinal !== 0 || rows.parent.result_json !== null
        || rows.children.some(child => child.status !== 'pending' || child.attempt !== 0 || child.result_ref_json !== null)) {
        db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED');
      }
      selectedCount = recipe.children.length; outcome = 'superseded'; coveragePolicy = 'lineage';
      replacement = input.replacementOperationId;
    } else {
      if (!terminal.valid && !(input.reason === 'JOURNAL_INTEGRITY_ERROR' && terminal.reconstructed)) {
        db.exec('ROLLBACK'); return lifecycleError(terminal.reconstructed ? 'CONFLICT_NOT_REPRODUCED' : 'PROJECTION_STORE_CORRUPT');
      }
      if (input.reason === 'JOURNAL_INTEGRITY_ERROR' && terminal.valid) {
        db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED');
      }
      if (input.reason !== 'JOURNAL_INTEGRITY_ERROR' && !terminal.valid) {
        db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED');
      }
      const goalsConflict = !goals || goals.sha256 !== stored.base_goals_sha256;
      const ledgerConflict = !ledger || ledger.sha256 !== stored.base_ledger_sha256 || reservationConflict;
      const stateConflict = !state || state.sha256 !== stored.base_state_sha256
        || (goals && (() => { try { return projectionRenderState(state.content, canonicalPlanParseGoalsRow(goals, slug)) !== state.content; } catch { return true; } })());
      const actualReason = goalsConflict ? 'TARGET_CONFLICT' : ledgerConflict ? 'LEDGER_IDENTITY_CONFLICT'
        : stateConflict ? 'STATE_CONFLICT' : null;
      if (input.reason !== 'JOURNAL_INTEGRITY_ERROR' && input.reason !== actualReason) {
        db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED');
      }
      selectedCount = terminal.selectedCount; outcome = terminal.outcome;
    }
    const entries = debtEntriesForProjection(recipe, rows, selectedCount);
    const obligationDigest = debtObligationDigest(entries);
    if (replacement) {
      const replacementPayload = lifecycleParseJson(lifecycleInternalRows(db, replacement).parent.payload_json);
      if (replacementPayload.obligationDigest !== obligationDigest) {
        db.exec('ROLLBACK'); return lifecycleError('CONFLICT_NOT_REPRODUCED');
      }
    }
    const outcomeDigest = sha256(canonicalJson(['qe-lifecycle-projection-debt-outcome-v1', outcome,
      entries.filter(entry => entry.kind === 'result').map(entry => entry.resultRef)]));
    const createdAt = Date.now();
    const conflictHashes = { goals: goals?.sha256 || null, ledger: ledger?.sha256 || null, state: state?.sha256 || null };
    const core = { schema: 1, debtId: prospectiveDebtId, slug, operationId: input.operationId,
      recipeDigest: stored.recipe_digest, reason: input.reason, replacementOperationId: replacement,
      outcome, outcomeDigest, coveragePolicy, obligationCount: entries.length, obligationDigest,
      conflictHashes, createdAt };
    const coreJson = canonicalJson(core);
    debtWriteConnections.add(db);
    db.prepare(`INSERT INTO lifecycle_projection_debts
      (debt_id,slug,operation_id,recipe_digest,reason,replacement_operation_id,outcome,outcome_digest,
       coverage_policy,obligation_count,obligation_digest,conflict_hashes_json,core_json,core_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(prospectiveDebtId, slug, input.operationId,
      stored.recipe_digest, input.reason, replacement, outcome, outcomeDigest, coveragePolicy,
      entries.length, obligationDigest, canonicalJson(conflictHashes), coreJson, sha256(coreJson), createdAt);
    const insertObligation = db.prepare(`INSERT INTO lifecycle_projection_debt_obligations
      (debt_id,ordinal,kind,entry_json,entry_digest) VALUES(?,?,?,?,?)`);
    for (const entry of entries) {
      const encoded = canonicalJson(entry);
      insertObligation.run(prospectiveDebtId, entry.ordinal, entry.kind, encoded, sha256(encoded));
    }
    debtFault('debt-insert');
    const debt = { core, obligations: entries };
    debtAppendAudit(db, slug, prospectiveDebtId, 'quarantined',
      { operationId: input.operationId, obligationDigest, recipeDigest: stored.recipe_digest }, createdAt);
    if (replacement) debtInsertBinding(db, debt, replacement, createdAt);
    projectionWriteConnections.add(db);
    db.prepare('DELETE FROM lifecycle_projection_heads WHERE slug=? AND operation_id=?').run(slug, input.operationId);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw new Error('DEBT_CONFLICT');
    debtFault('projection-head-release');
    debtFault('before-commit');
    db.exec('COMMIT');
    debtFault('after-commit');
    return { ok: true, code: 'QUARANTINED', debtId: prospectiveDebtId, obligationDigest };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    const code = ['DEBT_CONFLICT', 'PROJECTION_STORE_CORRUPT', 'DEBT_STORE_CORRUPT'].includes(error?.message)
      ? error.message : 'STORE_UNAVAILABLE';
    return lifecycleError(code);
  } finally { closeSqlite(db); }
}

export function getLifecycleProjectionDebt(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['debtId'])
    || !/^[0-9a-f]{64}$/.test(String(input.debtId))) return lifecycleError('INVALID_INPUT');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    const debts = debtValidateStore(db, slug);
    const debt = debts.get(input.debtId);
    if (!debt) return lifecycleError('NOT_FOUND');
    return { ok: true, code: 'FOUND', debt: { ...debt.core, obligations: debt.obligations,
      compensation: debt.binding ? JSON.parse(debt.binding.binding_json) : null,
      resolution: debt.resolution ? { schema: 1, resolutionId: debt.resolution.resolution_id,
        debtId: debt.resolution.debt_id, slug: debt.resolution.slug, mode: debt.resolution.mode,
        proofDigest: debt.resolution.proof_digest, proofRef: debt.resolution.proof_ref,
        resolvedAt: debt.resolution.resolved_at, proof: JSON.parse(debt.resolution.proof_json) } : null } };
  } catch (error) { return lifecycleError(error?.message === 'DEBT_STORE_CORRUPT' ? 'DEBT_STORE_CORRUPT' : 'STORE_UNAVAILABLE'); }
  finally { closeSqlite(db); }
}

export function bindLifecycleProjectionDebtCompensation(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['debtId', 'operationId'])
    || !/^[0-9a-f]{64}$/.test(String(input.debtId)) || !LIFECYCLE_UUID_RE.test(String(input.operationId))) {
    return lifecycleError('INVALID_INPUT');
  }
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const debts = debtValidateStore(db, slug);
    const debt = debts.get(input.debtId);
    if (!debt || debt.resolution) { db.exec('ROLLBACK'); return lifecycleError('DEBT_NOT_FOUND'); }
    if (debt.binding) {
      const same = debt.binding.operation_id === input.operationId;
      db.exec(same ? 'COMMIT' : 'ROLLBACK');
      return same ? { ok: true, code: 'REPLAYED', debtId: input.debtId, operationId: input.operationId }
        : lifecycleError('BINDING_CONFLICT');
    }
    const rows = lifecycleInternalRows(db, input.operationId);
    const payload = rows && lifecycleParseJson(rows.parent.payload_json);
    const occupied = db.prepare(`SELECT 1 FROM lifecycle_projection_recipes WHERE operation_id=? UNION
      SELECT 1 FROM lifecycle_projection_receipts WHERE operation_id=? UNION
      SELECT 1 FROM lifecycle_projection_event_reservations WHERE operation_id=?`).get(
        input.operationId, input.operationId, input.operationId);
    if (!rows || rows.parent.slug !== slug || rows.parent.operation_id === debt.core.operationId
      || rows.parent.kind !== 'controller-projected' || rows.parent.finalized !== 1
      || rows.parent.status !== 'pending' || rows.parent.current_ordinal !== 0 || rows.parent.result_json !== null
      || rows.children.some(child => child.status !== 'pending' || child.attempt !== 0 || child.claim_owner !== null
        || child.claim_token !== null || child.lease_until !== null || child.result_ref_json !== null)
      || !lifecycleExact(payload, ['compensatesDebtId', 'obligationDigest'])
      || payload.compensatesDebtId !== input.debtId || payload.obligationDigest !== debt.core.obligationDigest || occupied) {
      db.exec('ROLLBACK'); return lifecycleError('OPERATION_NOT_PRISTINE');
    }
    debtWriteConnections.add(db);
    const result = debtInsertBinding(db, debt, input.operationId, Date.now());
    debtFault('before-commit'); db.exec('COMMIT'); debtFault('after-commit');
    return { ok: true, code: 'BOUND', debtId: input.debtId, operationId: input.operationId,
      bindingDigest: result.bindingDigest };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError(error?.message === 'DEBT_STORE_CORRUPT' ? 'DEBT_STORE_CORRUPT' : 'STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

export function resolveLifecycleProjectionDebt(cwd, slug, input) {
  const validBase = LIFECYCLE_SLUG_RE.test(slug) && lifecyclePlainObject(input)
    && /^[0-9a-f]{64}$/.test(String(input.debtId || '')) && ['equivalence', 'compensation'].includes(input.mode)
    && lifecyclePlainObject(input.proof);
  const validProof = input?.mode === 'equivalence'
    ? lifecycleExact(input, ['debtId', 'mode', 'proof']) && lifecycleExact(input.proof, ['expectedGoalsSha256'])
      && /^[0-9a-f]{64}$/.test(String(input.proof.expectedGoalsSha256))
    : input?.mode === 'compensation' && lifecycleExact(input, ['debtId', 'mode', 'proof'])
      && lifecycleExact(input.proof, ['receiptOperationId']) && LIFECYCLE_UUID_RE.test(String(input.proof.receiptOperationId));
  if (!validBase || !validProof) return lifecycleError('INVALID_INPUT');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const debts = debtValidateStore(db, slug);
    const debt = debts.get(input.debtId);
    if (!debt) { db.exec('ROLLBACK'); return lifecycleError('DEBT_NOT_FOUND'); }
    if (debt.resolution) {
      const requestedRef = input.mode === 'equivalence'
        ? input.proof.expectedGoalsSha256 : input.proof.receiptOperationId;
      const same = debt.resolution.mode === input.mode && debt.resolution.proof_ref === requestedRef;
      db.exec(same ? 'COMMIT' : 'ROLLBACK');
      return same ? { ok: true, code: 'REPLAYED', debtId: input.debtId,
        resolutionId: debt.resolution.resolution_id } : lifecycleError('DEBT_ALREADY_RESOLVED');
    }
    let proofValue;
    let proofRef;
    if (input.mode === 'equivalence') {
      if (!['TARGET_CONFLICT', 'STATE_CONFLICT'].includes(debt.core.reason)
        || debt.core.coveragePolicy !== 'effect' || debt.core.outcome !== 'committed') {
        db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID');
      }
      const targets = debt.obligations.filter(entry => entry.kind === 'target');
      if (!targets.length) { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
      const paths = projectionPaths(slug);
      const goalsRow = canonicalPlanReadRow(db, paths.goals);
      const stateRow = canonicalPlanReadRow(db, paths.state);
      if (!goalsRow || goalsRow.sha256 !== input.proof.expectedGoalsSha256) {
        db.exec('ROLLBACK'); return lifecycleError('PROOF_STALE');
      }
      let doc;
      try { doc = canonicalPlanParseGoalsRow(goalsRow, slug); }
      catch { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
      const byId = new Map(doc.goals.map(goal => [goal.id, goal]));
      const equivalent = targets.every(target => {
        const goal = byId.get(target.goalId);
        return goal && Object.entries(target.set).every(([key, value]) => canonicalJson(goal[key]) === canonicalJson(value));
      });
      if (!equivalent || !stateRow || projectionRenderState(stateRow.content, doc) !== stateRow.content) {
        db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID');
      }
      const ledgerRow = canonicalPlanReadRow(db, paths.ledger);
      if (!ledgerRow) { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
      let ledgerEvents;
      try { ledgerEvents = canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledgerRow)).map(line => JSON.parse(line)); }
      catch { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
      const conflictingReservation = debt.obligations.filter(entry => entry.kind === 'event').some(entry => {
        const reservationId = projectionReservationId(slug, debt.core.operationId, entry.ordinal, entry.requestId);
        return ledgerEvents.some(event => event.reservationId === reservationId
          && (event.operationId !== debt.core.operationId || event.requestId !== entry.requestId
            || event.processId !== entry.processId));
      });
      if (conflictingReservation) { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
      const coverage = debt.obligations.filter(entry => entry.kind !== 'result').map(entry => ({
        oldOrdinal: entry.ordinal, newOrdinal: null,
        kind: entry.kind === 'target' ? 'exact-effect' : 'resolution-audit',
      }));
      proofValue = { schema: 1, expectedGoalsSha256: input.proof.expectedGoalsSha256, coverage };
      proofRef = input.proof.expectedGoalsSha256;
    } else {
      if (!debt.binding || debt.binding.operation_id !== input.proof.receiptOperationId) {
        db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID');
      }
      const receiptRow = db.prepare('SELECT * FROM lifecycle_projection_receipts WHERE operation_id=? AND slug=?')
        .get(input.proof.receiptOperationId, slug);
      const recipeRow = db.prepare("SELECT * FROM lifecycle_projection_recipes WHERE operation_id=? AND slug=? AND status='projected'")
        .get(input.proof.receiptOperationId, slug);
      const rows = lifecycleInternalRows(db, input.proof.receiptOperationId);
      if (!receiptRow || !recipeRow || !rows || !LIFECYCLE_TERMINAL_PARENT.has(rows.parent.status)) {
        db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID');
      }
      const receipt = lifecycleParseJson(receiptRow.receipt_json);
      const recipe = lifecycleParseJson(recipeRow.recipe_json);
      if (!receipt || canonicalJson(receipt) !== receiptRow.receipt_json || sha256(receiptRow.receipt_json) !== receiptRow.receipt_hash
        || !recipe || canonicalJson(recipe) !== recipeRow.recipe_json || sha256(recipeRow.recipe_json) !== recipeRow.recipe_digest
        || receipt.operationId !== input.proof.receiptOperationId || receipt.recipeDigest !== recipeRow.recipe_digest) {
        db.exec('ROLLBACK'); return lifecycleError('PROJECTION_STORE_CORRUPT');
      }
      const coverage = [];
      for (const old of debt.obligations.filter(entry => entry.kind === 'target' || entry.kind === 'event')) {
        let match = null;
        for (let newOrdinal = 0; newOrdinal < recipe.children.length; newOrdinal += 1) {
          const candidate = recipe.children[newOrdinal];
          const journal = rows.children[newOrdinal];
          if (candidate.goalId !== old.goalId || journal.process_id !== old.processId) continue;
          if (old.kind === 'event' && sha256(canonicalJson(candidate.event)) === old.eventDigest) {
            match = { oldOrdinal: old.ordinal, newOrdinal, kind: 'exact-effect' }; break;
          }
          if (old.kind === 'target' && sha256(canonicalJson(candidate.set)) === old.setDigest) {
            match = { oldOrdinal: old.ordinal, newOrdinal, kind: 'exact-effect' }; break;
          }
          if (old.kind === 'target') {
            const oldResult = debt.obligations.find(entry => entry.kind === 'result' && entry.ordinal === old.ordinal)?.resultRef;
            const newResult = lifecycleParseJson(journal.result_ref_json);
            if (oldResult && newResult && newResult.allowed === true
              && newResult.auditSeq > oldResult.auditSeq && newResult.stateRevisionAfter > oldResult.stateRevisionAfter
              && projectionAuditMatches(db, journal)) {
              match = { oldOrdinal: old.ordinal, newOrdinal, kind: 'monotonic-lineage' }; break;
            }
          }
        }
        if (!match) { db.exec('ROLLBACK'); return lifecycleError('PROOF_INVALID'); }
        coverage.push(match);
      }
      proofValue = { schema: 1, receiptOperationId: input.proof.receiptOperationId,
        receiptHash: receiptRow.receipt_hash, coverage };
      proofRef = input.proof.receiptOperationId;
    }
    const proofJson = canonicalJson(proofValue);
    const proofDigest = sha256(proofJson);
    const resolutionId = sha256(canonicalJson(['qe-lifecycle-projection-debt-resolution-v1',
      input.debtId, input.mode, proofDigest]));
    const resolvedAt = Date.now();
    debtWriteConnections.add(db);
    db.prepare(`INSERT INTO lifecycle_projection_debt_resolutions
      (debt_id,resolution_id,slug,mode,proof_json,proof_digest,proof_ref,resolved_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(input.debtId, resolutionId, slug, input.mode, proofJson, proofDigest, proofRef, resolvedAt);
    debtFault('resolution-insert');
    debtAppendAudit(db, slug, input.debtId, 'resolved', { mode: input.mode, proofDigest, resolutionId }, resolvedAt);
    debtFault('before-commit'); db.exec('COMMIT'); debtFault('after-commit');
    return { ok: true, code: 'RESOLVED', debtId: input.debtId, resolutionId };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    const code = ['DEBT_STORE_CORRUPT', 'PROJECTION_STORE_CORRUPT'].includes(error?.message)
      ? error.message : 'STORE_UNAVAILABLE';
    return lifecycleError(code);
  } finally { closeSqlite(db); }
}

export function stageLifecycleProjection(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId', 'recipe'])
    || !LIFECYCLE_UUID_RE.test(input.operationId)) {
    return lifecycleError('INVALID_INPUT');
  }
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const rows = lifecycleInternalRows(db, input.operationId);
    if (!rows || rows.parent.slug !== slug || rows.parent.kind !== 'controller-projected'
      || rows.parent.finalized !== 1) { db.exec('ROLLBACK'); return lifecycleError('JOURNAL_NOT_PRISTINE'); }
    const parentPayload = lifecycleParseJson(rows.parent.payload_json);
    const debtRegistry = debtValidateStore(db, slug);
    const unresolvedDebt = [...debtRegistry.values()].filter(debt => !debt.resolution);
    if (lifecyclePlainObject(parentPayload)
      && ('compensatesDebtId' in parentPayload || 'obligationDigest' in parentPayload)) {
      let binding = null;
      if (lifecycleExact(parentPayload, ['compensatesDebtId', 'obligationDigest'])) {
        const debt = debtRegistry.get(parentPayload.compensatesDebtId);
        if (debt && !debt.resolution && debt.core.obligationDigest === parentPayload.obligationDigest
          && debt.binding?.operation_id === input.operationId) binding = debt.binding;
      }
      if (!binding) { db.exec('ROLLBACK'); return lifecycleError('JOURNAL_NOT_PRISTINE'); }
    } else if (unresolvedDebt.length) { db.exec('ROLLBACK'); return lifecycleError('JOURNAL_NOT_PRISTINE'); }
    const paths = projectionPaths(slug);
    const goalsRow = canonicalPlanReadRow(db, paths.goals);
    const ledgerRow = canonicalPlanReadRow(db, paths.ledger);
    const stateRow = canonicalPlanReadRow(db, paths.state);
    if (!goalsRow || !ledgerRow || !stateRow) { db.exec('ROLLBACK'); return lifecycleError('CANONICAL_STATE_INVALID'); }
    canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledgerRow));
    const goalsDoc = canonicalPlanParseGoalsRow(goalsRow, slug);
    let recipe;
    try { recipe = projectionNormalizeRecipe(input.recipe, rows, goalsDoc); }
    catch { db.exec('ROLLBACK'); return lifecycleError('INVALID_RECIPE'); }
    const existing = db.prepare('SELECT * FROM lifecycle_projection_recipes WHERE operation_id=?').get(input.operationId);
    if (existing) {
      const same = existing.slug === slug && existing.recipe_digest === recipe.digest && existing.recipe_json === recipe.encoded;
      db.exec(same ? 'COMMIT' : 'ROLLBACK');
      return same ? { ok: true, code: 'REPLAYED', operationId: input.operationId, recipeDigest: recipe.digest }
        : lifecycleError('RECIPE_CONFLICT');
    }
    const head = db.prepare('SELECT * FROM lifecycle_projection_heads WHERE slug=?').get(slug);
    if (head) { db.exec('ROLLBACK'); return lifecycleError('OPERATION_IN_PROGRESS'); }
    if (rows.parent.status !== 'pending' || rows.parent.current_ordinal !== 0 || rows.parent.result_json !== null
      || rows.children.some(child => child.status !== 'pending' || child.attempt !== 0 || child.claim_owner !== null
        || child.claim_token !== null || child.lease_until !== null || child.result_ref_json !== null)) {
      db.exec('ROLLBACK'); return lifecycleError('JOURNAL_NOT_PRISTINE');
    }
    if (goalsRow.sha256 !== recipe.value.baseGoalsSha256 || ledgerRow.sha256 !== recipe.value.baseLedgerSha256
      || stateRow.sha256 !== recipe.value.baseStateSha256 || projectionRenderState(stateRow.content, goalsDoc) !== stateRow.content) {
      db.exec('ROLLBACK'); return lifecycleError('CANONICAL_STATE_INVALID');
    }
    const now = Date.now();
    projectionWriteConnections.add(db);
    db.prepare(`INSERT INTO lifecycle_projection_recipes
      (operation_id,slug,recipe_json,recipe_digest,status,base_goals_sha256,base_ledger_sha256,base_state_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(input.operationId, slug, recipe.encoded, recipe.digest, 'staged',
      recipe.value.baseGoalsSha256, recipe.value.baseLedgerSha256, recipe.value.baseStateSha256, now);
    projectionFault('recipe');
    db.prepare('INSERT INTO lifecycle_projection_heads(slug,operation_id,recipe_digest,created_at) VALUES(?,?,?,?)')
      .run(slug, input.operationId, recipe.digest, now);
    projectionFault('head');
    const insert = db.prepare(`INSERT INTO lifecycle_projection_event_reservations
      (reservation_id,slug,operation_id,ordinal,request_id,event_digest,consumed) VALUES(?,?,?,?,?,?,0)`);
    for (const child of rows.children) {
      const reservationId = projectionReservationId(slug, input.operationId, child.ordinal, child.request_id);
      const eventDigest = sha256(canonicalJson(recipe.value.children[child.ordinal].event));
      const collision = db.prepare('SELECT * FROM lifecycle_projection_event_reservations WHERE reservation_id=?').get(reservationId);
      if (collision) { db.exec('ROLLBACK'); return lifecycleError('RECIPE_CONFLICT'); }
      insert.run(reservationId, slug, input.operationId, child.ordinal, child.request_id, eventDigest);
      projectionFault(`reservation:${child.ordinal}`);
    }
    projectionFault('before-commit');
    db.exec('COMMIT');
    projectionFault('after-commit');
    return { ok: true, code: 'STAGED', operationId: input.operationId, recipeDigest: recipe.digest };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError(error?.message === 'PROJECTION_STORE_CORRUPT' ? 'PROJECTION_STORE_CORRUPT' : 'STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

export function getLifecycleProjection(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId'])
    || !LIFECYCLE_UUID_RE.test(input.operationId)) return lifecycleError('INVALID_INPUT');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    const recipe = db.prepare('SELECT * FROM lifecycle_projection_recipes WHERE operation_id=?').get(input.operationId);
    if (!recipe || recipe.slug !== slug) return lifecycleError('NOT_FOUND');
    const receiptRow = db.prepare('SELECT * FROM lifecycle_projection_receipts WHERE operation_id=?').get(input.operationId);
    let receipt = null;
    if (receiptRow) {
      receipt = projectionReceiptReplay(db, receiptRow, projectionPaths(slug));
      if (!receipt) return lifecycleError('PROJECTION_STORE_CORRUPT');
    }
    return { ok: true, code: 'FOUND', projection: { operationId: input.operationId, slug,
      status: recipe.status, recipeDigest: recipe.recipe_digest, recipe: JSON.parse(recipe.recipe_json), receipt } };
  } catch { return lifecycleError('PROJECTION_STORE_CORRUPT'); }
  finally { closeSqlite(db); }
}

function projectionAuditMatches(db, child) {
  const ref = lifecycleParseJson(child.result_ref_json);
  if (!lifecycleExact(ref, ['processId', 'requestId', 'auditSeq', 'auditHash', 'allowed', 'code',
    'stateRevisionBefore', 'stateRevisionAfter', 'resultDigest'])
    || ref.processId !== child.process_id || ref.requestId !== child.request_id
    || !Number.isSafeInteger(ref.auditSeq) || !/^[0-9a-f]{64}$/.test(String(ref.auditHash))) return false;
  const auditRows = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq')
    .all(child.process_id);
  const row = auditRows[ref.auditSeq];
  const state = db.prepare('SELECT * FROM process_controller_state WHERE process_id=?').get(child.process_id);
  const event = row && lifecycleParseJson(row.event_json);
  let previous = '0'.repeat(64);
  for (let index = 0; index < auditRows.length; index += 1) {
    const auditRow = auditRows[index];
    const auditEvent = lifecycleParseJson(auditRow.event_json);
    const expectedHash = sha256(canonicalJson(['qe-process-controller-v1', child.process_id, index, previous, auditEvent]));
    if (!auditEvent || auditRow.audit_seq !== index || auditEvent.auditSeq !== index
      || auditEvent.domain !== 'qe-process-controller-v1' || auditEvent.processId !== child.process_id
      || auditRow.prev_hash !== previous || auditRow.event_hash !== expectedHash) return false;
    previous = auditRow.event_hash;
  }
  const snapshot = state && lifecycleParseJson(state.snapshot_json);
  const latest = auditRows.at(-1);
  return !!row && !!state && !!latest && !!snapshot && row.event_hash === ref.auditHash && row.request_key === child.request_id
    && state.last_audit_seq === latest.audit_seq && state.last_audit_hash === latest.event_hash
    && canonicalJson(snapshot) === canonicalJson(lifecycleParseJson(latest.event_json)?.snapshotAfter)
    && event?.processId === child.process_id
    && event.requestId === child.request_id && event.allowed === (child.status === 'committed')
    && ref.allowed === event.allowed && ref.code === event.code
    && ref.stateRevisionBefore === event.stateRevisionBefore && ref.stateRevisionAfter === event.stateRevisionAfter
    && sha256(canonicalJson(event.result)) === ref.resultDigest;
}

export function applyLifecycleOutcomeProjection(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecycleExact(input, ['operationId'])
    || !LIFECYCLE_UUID_RE.test(input.operationId)) return lifecycleError('PROJECTION_NOT_READY');
  if (!canonicalPlanRoot(cwd)) return lifecycleError('STORE_UNAVAILABLE');
  const diagnostics = {};
  const db = openLifecycleDb(cwd, diagnostics);
  if (!db) return lifecycleError(diagnostics.code || 'STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    const paths = projectionPaths(slug);
    const receiptRow = db.prepare('SELECT * FROM lifecycle_projection_receipts WHERE operation_id=?').get(input.operationId);
    if (receiptRow) {
      const receipt = projectionReceiptReplay(db, receiptRow, paths);
      db.exec(receipt ? 'COMMIT' : 'ROLLBACK');
      return receipt ? { ok: true, code: 'REPLAYED', receipt } : lifecycleError('PROJECTION_STORE_CORRUPT');
    }
    const stored = db.prepare('SELECT * FROM lifecycle_projection_recipes WHERE operation_id=?').get(input.operationId);
    const head = db.prepare('SELECT * FROM lifecycle_projection_heads WHERE slug=?').get(slug);
    const rows = lifecycleInternalRows(db, input.operationId);
    if (!stored || stored.slug !== slug || stored.status !== 'staged' || !head || head.operation_id !== input.operationId
      || !rows || rows.parent.slug !== slug || rows.parent.kind !== 'controller-projected'
      || !LIFECYCLE_TERMINAL_PARENT.has(rows.parent.status)) {
      db.exec('ROLLBACK'); return lifecycleError('PROJECTION_NOT_READY');
    }
    let recipe;
    try { recipe = JSON.parse(stored.recipe_json); }
    catch { db.exec('ROLLBACK'); return lifecycleError('PROJECTION_STORE_CORRUPT'); }
    if (canonicalJson(recipe) !== stored.recipe_json || sha256(stored.recipe_json) !== stored.recipe_digest) {
      db.exec('ROLLBACK'); return lifecycleError('PROJECTION_STORE_CORRUPT');
    }
    const result = lifecycleParseJson(rows.parent.result_json);
    const deniedOrdinal = rows.parent.status === 'denied' ? result?.ordinal : null;
    const selectedCount = rows.parent.status === 'committed' ? rows.children.length : deniedOrdinal + 1;
    const validJournal = rows.parent.status === 'committed'
      ? result?.outcome === 'committed' && result.childCount === rows.children.length
        && rows.parent.current_ordinal === rows.children.length
        && rows.children.every(child => child.status === 'committed' && projectionAuditMatches(db, child))
      : result?.outcome === 'denied' && Number.isSafeInteger(deniedOrdinal) && deniedOrdinal >= 0
        && deniedOrdinal < rows.children.length && rows.children.slice(0, deniedOrdinal).every(child => child.status === 'committed' && projectionAuditMatches(db, child))
        && rows.children[deniedOrdinal]?.status === 'denied' && projectionAuditMatches(db, rows.children[deniedOrdinal])
        && rows.children.slice(deniedOrdinal + 1).every(child => child.status === 'cancelled');
    if (!validJournal) { db.exec('ROLLBACK'); return lifecycleError('JOURNAL_INTEGRITY_ERROR'); }
    const goalsRow = canonicalPlanReadRow(db, paths.goals);
    const ledgerRow = canonicalPlanReadRow(db, paths.ledger);
    const stateRow = canonicalPlanReadRow(db, paths.state);
    if (!goalsRow || !ledgerRow || !stateRow) { db.exec('ROLLBACK'); return lifecycleError('TARGET_CONFLICT'); }
    if (goalsRow.sha256 !== stored.base_goals_sha256) { db.exec('ROLLBACK'); return lifecycleError('TARGET_CONFLICT'); }
    if (ledgerRow.sha256 !== stored.base_ledger_sha256) { db.exec('ROLLBACK'); return lifecycleError('LEDGER_IDENTITY_CONFLICT'); }
    if (stateRow.sha256 !== stored.base_state_sha256) { db.exec('ROLLBACK'); return lifecycleError('STATE_CONFLICT'); }
    const goalsDoc = canonicalPlanParseGoalsRow(goalsRow, slug);
    const byId = new Map(goalsDoc.goals.map(goal => [goal.id, goal]));
    for (const child of recipe.children) {
      const goal = byId.get(child.goalId);
      if (!goal || projectionGoalHash(goal) !== child.expectedTargetSha256) { db.exec('ROLLBACK'); return lifecycleError('TARGET_CONFLICT'); }
      if (child.set.status === 'complete' || child.set.status === 'verified' || 'completionEvidence' in child.set) {
        db.exec('ROLLBACK'); return lifecycleError('COMPLETION_BYPASS');
      }
    }
    if (projectionRenderState(stateRow.content, goalsDoc) !== stateRow.content) { db.exec('ROLLBACK'); return lifecycleError('STATE_CONFLICT'); }
    const resultRefs = rows.children.slice(0, selectedCount).map(child => lifecycleParseJson(child.result_ref_json));
    const outcomeDigest = sha256(canonicalJson(['qe-lifecycle-outcome-v1', 1, input.operationId,
      rows.parent.status, deniedOrdinal, resultRefs]));
    const reservationIds = [];
    const projectedAt = Date.now();
    projectionWriteConnections.add(db);
    for (let ordinal = 0; ordinal < selectedCount; ordinal += 1) {
      const journal = rows.children[ordinal];
      const recipeChild = recipe.children[ordinal];
      const reservationId = projectionReservationId(slug, input.operationId, ordinal, journal.request_id);
      const reservation = db.prepare('SELECT * FROM lifecycle_projection_event_reservations WHERE reservation_id=?').get(reservationId);
      if (!reservation || reservation.operation_id !== input.operationId || reservation.ordinal !== ordinal
        || reservation.request_id !== journal.request_id || reservation.event_digest !== sha256(canonicalJson(recipeChild.event))
        || reservation.consumed !== 0) { db.exec('ROLLBACK'); return lifecycleError('LEDGER_IDENTITY_CONFLICT'); }
      reservationIds.push(reservationId);
      const allowed = journal.status === 'committed';
      if (allowed) {
        const goal = byId.get(recipeChild.goalId);
        goal.status = recipeChild.set.status;
        if (recipeChild.set.status === 'active') goal.attempts = recipeChild.set.attempts;
      }
      const ref = resultRefs[ordinal];
      const event = allowed ? recipeChild.event : { event: 'checkpoint', status: byId.get(recipeChild.goalId).status,
        evidence: `denied:${recipeChild.event.evidence}` };
      canonicalPlanAppendLedger(db, paths.ledger, {
        timestamp: new Date(projectedAt).toISOString(), goalId: recipeChild.goalId, ...event,
        operationId: input.operationId, sourceOrdinal: ordinal, processId: journal.process_id,
        requestId: journal.request_id, auditSeq: ref.auditSeq, auditHash: ref.auditHash,
        outcomeDigest, reservationId,
      });
      db.prepare('UPDATE lifecycle_projection_event_reservations SET consumed=1 WHERE reservation_id=? AND consumed=0').run(reservationId);
      if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw new Error('reservation conflict');
      projectionFault(`canonical-ledger:${ordinal}`);
    }
    if (goalsDoc.goals.filter(goal => goal.status === 'active' || goal.status === 'blocked').length > 1) {
      db.exec('ROLLBACK'); return lifecycleError('TARGET_CONFLICT');
    }
    const goalsText = canonicalPlanSerializeJson(goalsDoc);
    const goalsWrite = canonicalPlanWriteRow(db, paths.goals, goalsText, goalsRow.sha256);
    projectionFault('canonical-goals');
    const currentLedger = canonicalPlanReadRow(db, paths.ledger);
    const stateText = projectionRenderState(stateRow.content, goalsDoc);
    if (stateText == null) { db.exec('ROLLBACK'); return lifecycleError('STATE_CONFLICT'); }
    const stateWrite = canonicalPlanWriteRow(db, paths.state, stateText, stateRow.sha256);
    projectionFault('canonical-state');
    const receipt = { schema: 1, slug, operationId: input.operationId, status: 'projected',
      recipeDigest: stored.recipe_digest, outcome: rows.parent.status, outcomeDigest,
      baseHashes: { goals: stored.base_goals_sha256, ledger: stored.base_ledger_sha256, state: stored.base_state_sha256 },
      postHashes: { goals: goalsWrite.sha, ledger: currentLedger.sha256, state: stateWrite.sha },
      eventCount: selectedCount, reservationIds, projectedAt };
    const receiptJson = canonicalJson(receipt);
    db.prepare(`INSERT INTO lifecycle_projection_receipts
      (operation_id,slug,receipt_json,receipt_hash,post_goals_sha256,post_ledger_sha256,post_state_sha256,projected_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(input.operationId, slug, receiptJson, sha256(receiptJson),
      goalsWrite.sha, currentLedger.sha256, stateWrite.sha, projectedAt);
    projectionFault('receipt');
    db.prepare("UPDATE lifecycle_projection_recipes SET status='projected' WHERE operation_id=? AND status='staged'").run(input.operationId);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw new Error('recipe conflict');
    db.prepare('DELETE FROM lifecycle_projection_heads WHERE slug=? AND operation_id=?').run(slug, input.operationId);
    if (db.prepare('SELECT changes() AS changes').get().changes !== 1) throw new Error('head conflict');
    projectionFault('head-release');
    projectionFault('before-commit');
    db.exec('COMMIT');
    projectionFault('after-commit');
    return { ok: true, code: 'PROJECTED', receipt };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    return lifecycleError(error?.message === 'PROJECTION_STORE_CORRUPT' ? 'PROJECTION_STORE_CORRUPT' : 'STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
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
    if (rows.parent.kind === 'controller-projected') {
      const projection = db.prepare('SELECT status FROM lifecycle_projection_recipes WHERE operation_id=? AND slug=?')
        .get(input.operationId, slug);
      const projectionHead = db.prepare('SELECT operation_id FROM lifecycle_projection_heads WHERE slug=?').get(slug);
      if (!projection || projection.status !== 'staged' || projectionHead?.operation_id !== input.operationId) {
        db.exec('ROLLBACK'); return lifecycleError('PROJECTION_NOT_STAGED');
      }
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
      const ledgerRel = join(PLANS_DIR, slug, 'ledger.jsonl');
      const currentLedger = canonicalPlanReadRow(db, ledgerRel);
      if (!!current !== !!currentLedger) throw canonicalPlanError('CANONICAL_STORE_INVALID');
      if (current) {
        canonicalPlanParseGoalsRow(current, slug);
        canonicalPlanLedgerLines(canonicalPlanDecodeRow(currentLedger));
        db.exec('COMMIT');
        return { skipped: true, reason: 'goals.json exists' };
      }
      let goals = explicitGoals.map((g, i) => {
        const raw = String(g); const separator = raw.indexOf('::');
        const title = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
        const objective = (separator >= 0 ? raw.slice(separator + 2) : raw).trim();
        if (!title || !objective) throw new Error('Goal title and objective must be non-empty');
        return { id: `G${String(i + 1).padStart(3, '0')}`, title,
          objective, status: 'pending', attempts: 0,
          phase: 'Phase 1', wave: '-' };
      });
      if (goals.length === 0) goals = parseRoadmapGoals(cwd, slug);
      if (goals.length === 0 || goals.some(goal => !nonEmpty(goal.title) || !nonEmpty(goal.objective))) {
        throw new Error('A Plan requires at least one non-empty Goal');
      }
      const doc = { planSlug: slug, schema: 1, createdAt: nowIso(), goals };
      const goalsText = canonicalPlanSerializeJson(doc);
      canonicalPlanWriteRow(db, relGoals, goalsText, null);
      canonicalPlanWriteRow(db, ledgerRel, '', null);
      for (const g of goals) {
        canonicalPlanAppendLedger(db, ledgerRel, { ts: nowIso(), event: 'created', goalId: g.id, status: 'pending', evidence: '', attempt: 0 });
      }
      canonicalPlanCommit(db);
      return { created: goals.length };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  if (readGoals(cwd, slug)) return { skipped: true, reason: 'goals.json exists' };

  let goals = explicitGoals.map((g, i) => {
    const raw = String(g); const separator = raw.indexOf('::');
    const title = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
    const objective = (separator >= 0 ? raw.slice(separator + 2) : raw).trim();
    if (!title || !objective) throw new Error('Goal title and objective must be non-empty');
    return { id: `G${String(i + 1).padStart(3, '0')}`, title,
      objective, status: 'pending', attempts: 0,
      phase: 'Phase 1', wave: '-' };
  });
  if (goals.length === 0) goals = parseRoadmapGoals(cwd, slug);
  if (goals.length === 0 || goals.some(goal => !nonEmpty(goal.title) || !nonEmpty(goal.objective))) {
    throw new Error('A Plan requires at least one non-empty Goal');
  }

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
  if (status === 'complete') throw new Error('Goal completion must use advance through the canonical completion primitive');
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const ledgerRow = canonicalPlanReadRow(db, relLedger);
      if (!ledgerRow) throw canonicalPlanError('CANONICAL_STORE_INVALID');
      canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledgerRow));
      const doc = canonicalPlanParseGoalsRow(current, slug);
      const goal = doc.goals.find(g => g.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      const adapterInstalled = db.prepare('SELECT 1 FROM qe_schema_seals WHERE name=?')
        .get(PLAN_GOAL_ADAPTER_SEAL_NAME);
      if (adapterInstalled) {
        if (!['checkpoint', 'measurement'].includes(event) || (status && status !== goal.status)) {
          throw canonicalPlanError('DIRECT_TRANSITION_DENIED');
        }
      } else {
        if (event === 'started') goal.attempts += 1;
        if (status) goal.status = status;
        canonicalPlanWriteRow(db, relGoals, canonicalPlanSerializeJson(doc), current.sha256);
      }
      const record = { ts: nowIso(), event, goalId, status: goal.status, evidence, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, record);
      canonicalPlanCommit(db);
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

const MAX_GOAL_REQUIREMENTS = 3;
const MAX_GOAL_SCENARIOS = 2;
const MAX_GOAL_PATHS = 5;
const MAX_MICRO_GOAL_PATHS = 3;
const MAX_MICRO_GOAL_WORK_ITEMS = 2;
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

function idsAreUnique(items) {
  const ids = items.map(item => item?.id);
  return ids.every(nonEmpty) && new Set(ids).size === ids.length;
}

function isBoundedPath(value) {
  return typeof value === 'string' && value.length <= 180 && value.trim() !== '' &&
    !value.startsWith('/') && !value.includes('..') && !/[\\*]/.test(value);
}

function microScopeIgnored(path) {
  return path === '.qe' || path.startsWith('.qe/')
    || /(?:^|\/)[^/]+\.(?:acceptance|completion)\.json$/.test(path);
}

function microScopeError(code, message) {
  const error = new Error(message); error.code = code; return error;
}

function gitScopeSnapshot(cwd) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
  });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw microScopeError('MICRO_SCOPE_UNAVAILABLE',
      'bounded-micro assurance requires a Git worktree for scope verification');
  }
  const commands = [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ];
  const paths = new Set();
  for (const args of commands) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw microScopeError('MICRO_SCOPE_UNAVAILABLE', 'bounded-micro Git scope snapshot failed');
    for (const path of result.stdout.split('\0').filter(Boolean)) {
      if (!microScopeIgnored(path)) paths.add(path);
    }
  }
  if (paths.size > 512) throw microScopeError('MICRO_SCOPE_UNAVAILABLE', 'bounded-micro scope baseline exceeds 512 changed paths');
  const entries = [];
  for (const path of [...paths].sort()) {
    if (!isBoundedPath(path)) throw microScopeError('MICRO_SCOPE_UNAVAILABLE', `bounded-micro scope contains an unsafe path: ${path}`);
    const hashed = spawnSync('git', ['hash-object', '--no-filters', '--', path], {
      cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    });
    const digest = hashed.status === 0 && /^[0-9a-f]{40,64}$/.test(hashed.stdout.trim())
      ? hashed.stdout.trim() : 'deleted';
    entries.push({ path, digest });
  }
  return { schema: 1, entries };
}

function validateMicroScope(cwd, contract) {
  if (contract.assurance?.lane !== 'bounded-micro') return { changedPaths: [] };
  const baseline = contract.assurance.scopeBaseline;
  const current = gitScopeSnapshot(cwd);
  const before = new Map(baseline.entries.map(item => [item.path, item.digest]));
  const after = new Map(current.entries.map(item => [item.path, item.digest]));
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path)).sort();
  const allowed = path => contract.goalShape.allowedPaths.some(base => path === base || path.startsWith(`${base}/`));
  const outside = changedPaths.filter(path => !allowed(path));
  if (outside.length) throw microScopeError('MICRO_SCOPE_VIOLATION',
    `bounded-micro changed paths exceed allowedPaths: ${outside.join(', ')}`);
  return { changedPaths };
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

function validateGoalDependencies(doc, goal, contract, { requireComplete = false } = {}) {
  const currentIndex = doc.goals.findIndex(item => item.id === goal.id);
  if (currentIndex < 0) throw new Error(`unknown goalId: ${goal.id}`);
  const byId = new Map(doc.goals.map((item, index) => [item.id, { item, index }]));
  for (const dependencyId of contract.goalShape.dependencies) {
    const dependency = byId.get(dependencyId);
    if (!dependency) throw new Error(`Goal dependency does not exist: ${dependencyId}`);
    if (dependency.index >= currentIndex) {
      throw new Error(`Goal dependency must reference an earlier Goal: ${dependencyId}`);
    }
    if (requireComplete && dependency.item.status !== 'complete') {
      throw new Error(`Goal dependency is not complete: ${dependencyId}`);
    }
  }
  return true;
}

function validateGoalAssurance(contract) {
  if (!Object.prototype.hasOwnProperty.call(contract, 'assurance')) return;
  const assurance = contract.assurance;
  const keys = assurance && typeof assurance === 'object' && !Array.isArray(assurance)
    ? Object.keys(assurance).sort() : [];
  const expected = ['admissionId', 'admissionVersion', 'authority', 'issuedBy', 'lane',
    'materialDecisionsResolved', 'scopeBaseline', 'sessionId', 'workItems'];
  if (keys.join('|') !== expected.sort().join('|') || assurance.lane !== 'bounded-micro'
    || assurance.admissionVersion !== 1 || assurance.issuedBy !== 'qe-ledger'
    || assurance.authority !== 'plan-controller' || !MACHINE_SESSION_RE.test(assurance.sessionId)
    || !/^[0-9a-f]{64}$/.test(assurance.admissionId)) {
    throw new Error('bounded-micro assurance requires exact ledger-issued plan-controller admission');
  }
  if (assurance.materialDecisionsResolved !== true) {
    throw new Error('bounded-micro assurance requires resolved material decisions');
  }
  if (!Number.isSafeInteger(assurance.workItems) || assurance.workItems < 1
    || assurance.workItems > MAX_MICRO_GOAL_WORK_ITEMS) {
    throw new Error(`bounded-micro assurance requires 1-${MAX_MICRO_GOAL_WORK_ITEMS} work items`);
  }
  if (contract.goalShape.allowedPaths.length > MAX_MICRO_GOAL_PATHS) {
    throw new Error(`bounded-micro assurance allows at most ${MAX_MICRO_GOAL_PATHS} allowed paths`);
  }
  const baseline = assurance.scopeBaseline;
  if (!baseline || baseline.schema !== 1 || !Array.isArray(baseline.entries)
    || baseline.entries.length > 512
    || baseline.entries.some((entry) => !entry || !isBoundedPath(entry.path)
      || !(entry.digest === 'deleted' || /^[0-9a-f]{40,64}$/.test(entry.digest)))
    || new Set(baseline.entries.map(entry => entry.path)).size !== baseline.entries.length) {
    throw new Error('bounded-micro assurance requires a ledger-issued Git scope baseline');
  }
  if (contract.riskAssessment.categories.length !== 1
    || contract.riskAssessment.categories[0] !== 'none'
    || contract.humanAcceptance.required !== false) {
    throw new Error('bounded-micro assurance requires risk category none and no human acceptance');
  }
}

function prepareAcceptanceContract(raw, goalId, goalObjective, sessionId, cwd) {
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'assurance')) {
    return validateAcceptanceContract(raw, goalId, goalObjective);
  }
  const request = raw.assurance;
  const keys = request && typeof request === 'object' && !Array.isArray(request)
    ? Object.keys(request).sort() : [];
  const expected = ['admissionVersion', 'lane', 'materialDecisionsResolved', 'workItems'];
  if (keys.join('|') !== expected.sort().join('|') || request.lane !== 'bounded-micro'
    || request.admissionVersion !== 1) {
    throw new Error('bounded-micro assurance request must use the exact version 1 request shape');
  }
  if (!MACHINE_SESSION_RE.test(sessionId || '')) {
    throw new Error('bounded-micro assurance admission requires a valid QE session');
  }
  const contract = JSON.parse(JSON.stringify(raw));
  const core = { lane: request.lane, admissionVersion: request.admissionVersion,
    materialDecisionsResolved: request.materialDecisionsResolved, workItems: request.workItems,
    issuedBy: 'qe-ledger', authority: 'plan-controller', sessionId,
    scopeBaseline: gitScopeSnapshot(cwd) };
  contract.assurance = { ...core, admissionId: sha256(canonicalJson([
    'qe-bounded-micro-admission-v1', goalId, normalizedText(goalObjective), core,
  ])) };
  return validateAcceptanceContract(contract, goalId, goalObjective);
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
    throw new Error('code-changing Goal acceptance requires at least one behavioral test-runner command');
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
  const riskSignalText = [goalObjective, contract.goalShape.primaryOutcome,
    contract.goalShape.completionMetric, ...contract.goalShape.allowedPaths].join(' ');
  const requiredRisks = detectHighImpactRisks(riskSignalText);
  if (requiredRisks.some(category => !risk.categories.includes(category))) {
    throw new Error(`acceptance contract risk assessment omits detected Goal risk: ${requiredRisks.filter(category => !risk.categories.includes(category)).join(', ')}`);
  }
  if (risk.categories.some(category => category !== 'none') && !contract.humanAcceptance.required) {
    throw new Error('risk-bearing Goals require humanAcceptance.required: true');
  }
  validateGoalAssurance(contract);
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

function phaseBoundary(doc, nextGoal, { requirePending = true } = {}) {
  const index = doc.goals.findIndex(goal => goal.id === nextGoal?.id);
  if (index <= 0 || requirePending && nextGoal.status !== 'pending') return null;
  const previous = doc.goals[index - 1];
  if (previous.phase === nextGoal.phase) return null;
  let start = index - 1;
  while (start > 0 && doc.goals[start - 1].phase === previous.phase) start -= 1;
  const completed = doc.goals.slice(start, index);
  if (!completed.length || completed.some(goal => goal.status !== 'complete')) return null;
  const match = previous.phase.match(/^Phase\s+([1-9]\d*)(?:\s|$)/i);
  if (!match) return { invalid: true };
  return { phase: previous.phase, nextPhase: nextGoal.phase, phaseNumber: match[1],
    completedGoalIds: completed.map(goal => goal.id) };
}

function phaseRetrospectivePaths(slug, phaseNumber) {
  const base = join(PLANS_DIR, slug, 'phases', phaseNumber);
  return { markdown: join(base, 'RETROSPECTIVE.md'), proof: join(base, 'retrospective.json'),
    report: join(PLANS_DIR, slug, 'reports', `PHASE_${phaseNumber}_REPORT.md`) };
}

function phaseGoalProofs(db, slug, goalIds) {
  const rows = db.prepare(`SELECT proof_json,proof_hash FROM lifecycle_plan_goal_proofs
    WHERE slug=? AND kind='goal' ORDER BY goal_id,proof_id`).all(slug);
  const byGoal = new Map();
  for (const row of rows) {
    if (sha256(row.proof_json) !== row.proof_hash) throw canonicalPlanError('CANONICAL_STORE_INVALID');
    let proof;
    try { proof = JSON.parse(row.proof_json); } catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
    if (goalIds.includes(proof.goalId)) {
      if (byGoal.has(proof.goalId)) throw canonicalPlanError('CANONICAL_STORE_INVALID');
      byGoal.set(proof.goalId, { goalId: proof.goalId, proofId: proof.proofId, proofDigest: proof.proofDigest });
    }
  }
  const result = goalIds.map(goalId => byGoal.get(goalId));
  if (result.some(item => !item || !/^[0-9a-f]{64}$/.test(item.proofId)
    || !/^[0-9a-f]{64}$/.test(item.proofDigest))) return null;
  return result;
}

function validRetrospectiveList(value, { allowEmpty = false } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 32
    && value.every(item => nonEmpty(item) && Buffer.byteLength(item, 'utf8') <= 4096);
}

function retrospectiveDigest(value) {
  const { artifactDigest: ignored, ...body } = value; void ignored;
  return sha256(canonicalJson(['qe-phase-retrospective-v1', body]));
}

function phaseCompletionGoalsSha(db, slug, boundary) {
  const lastGoalId = boundary.completedGoalIds.at(-1);
  const rows = db.prepare(`SELECT post_goals_sha256 FROM lifecycle_plan_goal_receipts
    WHERE slug=? AND kind='projected' AND action='complete' AND goal_id=? ORDER BY created_at`)
    .all(slug, lastGoalId);
  return rows.length === 1 && /^[0-9a-f]{64}$/.test(rows[0].post_goals_sha256)
    ? rows[0].post_goals_sha256 : null;
}

function phaseRetrospectiveGate(db, slug, doc, goalsRow, nextGoal, { historical = false } = {}) {
  const boundary = phaseBoundary(doc, nextGoal, { requirePending: !historical });
  if (!boundary) return { required: false };
  if (boundary.invalid) return { required: true, valid: false, code: 'PHASE_RETROSPECTIVE_INVALID' };
  const paths = phaseRetrospectivePaths(slug, boundary.phaseNumber);
  const proofRow = canonicalPlanReadRow(db, paths.proof);
  if (!proofRow) return { required: true, valid: false, code: 'PHASE_RETROSPECTIVE_REQUIRED', boundary };
  const markdownRow = canonicalPlanReadRow(db, paths.markdown);
  const reportRow = canonicalPlanReadRow(db, paths.report);
  let artifact;
  try { artifact = JSON.parse(canonicalPlanDecodeRow(proofRow)); }
  catch { return { required: true, valid: false, code: 'PHASE_RETROSPECTIVE_INVALID', boundary }; }
  const expectedProofs = phaseGoalProofs(db, slug, boundary.completedGoalIds);
  const exactKeys = ['schema', 'issuedBy', 'slug', 'phase', 'nextPhase', 'phaseNumber',
    'completedGoalIds', 'completedGoalProofs', 'sourceGoalsSha256', 'reportPath', 'reportSha256',
    'retrospectivePath', 'retrospectiveSha256', 'regression', 'summary', 'gaps', 'lessons',
    'actions', 'createdAt', 'artifactDigest'];
  const expectedGoalsSha = historical ? phaseCompletionGoalsSha(db, slug, boundary) : goalsRow.sha256;
  const valid = lifecycleExact(artifact, exactKeys) && artifact.schema === 1 && artifact.issuedBy === 'qe-ledger'
    && artifact.slug === slug && artifact.phase === boundary.phase && artifact.nextPhase === boundary.nextPhase
    && artifact.phaseNumber === boundary.phaseNumber
    && canonicalJson(artifact.completedGoalIds) === canonicalJson(boundary.completedGoalIds)
    && expectedProofs && canonicalJson(artifact.completedGoalProofs) === canonicalJson(expectedProofs)
    && expectedGoalsSha && artifact.sourceGoalsSha256 === expectedGoalsSha
    && artifact.reportPath === paths.report && reportRow && artifact.reportSha256 === reportRow.sha256
    && artifact.retrospectivePath === paths.markdown && markdownRow
    && artifact.retrospectiveSha256 === markdownRow.sha256
    && lifecycleExact(artifact.regression, ['command', 'exitCode', 'signal', 'passed', 'outputHash',
      'executedAt', 'runId', 'sessionId', 'verifier'])
    && artifact.regression.passed === true && isBehavioralEvidenceCommand(artifact.regression.command)
    && Number.isInteger(artifact.regression.exitCode) && artifact.regression.exitCode === 0
    && artifact.regression.signal === null && /^[0-9a-f]{64}$/.test(artifact.regression.outputHash)
    && MACHINE_SESSION_RE.test(artifact.regression.sessionId) && nonEmpty(artifact.regression.verifier)
    && /^[0-9a-f]{64}$/.test(artifact.regression.runId) && nonEmpty(artifact.regression.executedAt)
    && artifact.regression.runId === sha256(canonicalJson(['qe-phase-retrospective-run-v1', slug,
      boundary.phase, boundary.nextPhase, artifact.regression.command, artifact.regression.sessionId,
      artifact.regression.verifier, artifact.regression.exitCode, artifact.regression.signal,
      artifact.regression.outputHash, artifact.regression.executedAt]))
    && nonEmpty(artifact.summary) && Buffer.byteLength(artifact.summary, 'utf8') <= 16 * 1024
    && validRetrospectiveList(artifact.gaps, { allowEmpty: true })
    && validRetrospectiveList(artifact.lessons) && validRetrospectiveList(artifact.actions, { allowEmpty: true })
    && !Number.isNaN(Date.parse(artifact.createdAt)) && artifact.artifactDigest === retrospectiveDigest(artifact);
  return valid ? { required: true, valid: true, boundary, artifact }
    : { required: true, valid: false, code: 'PHASE_RETROSPECTIVE_INVALID', boundary };
}

function historicalRetrospectivesValid(db, slug, doc, goalsRow) {
  for (let index = 1; index < doc.goals.length; index += 1) {
    const goal = doc.goals[index]; const previous = doc.goals[index - 1];
    if (goal.phase === previous.phase || goal.status === 'pending') continue;
    const gate = phaseRetrospectiveGate(db, slug, doc, goalsRow, goal, { historical: true });
    if (!gate.required || !gate.valid) return false;
  }
  return true;
}

function validateRetrospectiveInput(input) {
  const keys = ['schema', 'phase', 'nextPhase', 'regressionCommand', 'verifier',
    'summary', 'gaps', 'lessons', 'actions'];
  if (!lifecycleExact(input, keys) || input.schema !== 1 || !nonEmpty(input.phase)
    || !nonEmpty(input.nextPhase) || !isBehavioralEvidenceCommand(input.regressionCommand)
    || !nonEmpty(input.verifier) || !nonEmpty(input.summary)
    || Buffer.byteLength(input.summary, 'utf8') > 16 * 1024
    || !validRetrospectiveList(input.gaps, { allowEmpty: true })
    || !validRetrospectiveList(input.lessons) || !validRetrospectiveList(input.actions, { allowEmpty: true })) {
    throw canonicalPlanError('PHASE_RETROSPECTIVE_INPUT_INVALID');
  }
  return JSON.parse(JSON.stringify(input));
}

function renderPhaseRetrospective(slug, boundary, input, regression, reportPath) {
  return `# Phase Retrospective — ${slug} ${boundary.phase}\n\n`
    + `> Next phase: ${boundary.nextPhase}\n> Phase report: \`${reportPath}\`\n`
    + `> Regression: \`${regression.command}\` (PASS)\n\n## Summary\n\n${input.summary}\n\n`
    + `## Gaps\n\n${input.gaps.length ? input.gaps.map(item => `- ${item}`).join('\n') : '- None'}\n\n`
    + `## Lessons Learned\n\n${input.lessons.map(item => `- ${item}`).join('\n')}\n\n`
    + `## Next-Phase Actions\n\n${input.actions.length ? input.actions.map(item => `- ${item}`).join('\n') : '- None'}\n`;
}

/** Run and seal the machine-verifiable retrospective required at a Phase boundary. */
export function runPhaseRetrospective(cwd, slug, { sessionId, input }) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !MACHINE_SESSION_RE.test(sessionId || '')) {
    throw canonicalPlanError('PHASE_RETROSPECTIVE_INPUT_INVALID');
  }
  const request = validateRetrospectiveInput(input);
  let db = canonicalPlanOpenDb(cwd, { readOnly: true });
  if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE');
  let snapshot;
  try {
    const rows = planGoalAdapterRows(db, slug); const queue = planGoalAdapterQueue(rows.doc);
    const nextGoal = queue.firstIncomplete;
    const gate = nextGoal ? phaseRetrospectiveGate(db, slug, rows.doc, rows.goals, nextGoal) : { required: false };
    if (!gate.required) throw canonicalPlanError('PHASE_RETROSPECTIVE_NOT_AT_BOUNDARY');
    if (gate.valid) return { ok: true, code: 'PHASE_RETROSPECTIVE_REPLAYED', artifact: gate.artifact };
    if (gate.code === 'PHASE_RETROSPECTIVE_INVALID') throw canonicalPlanError(gate.code);
    if (request.phase !== gate.boundary.phase || request.nextPhase !== gate.boundary.nextPhase) {
      throw canonicalPlanError('PHASE_RETROSPECTIVE_INPUT_INVALID');
    }
    snapshot = { goalsSha256: rows.goals.sha256, boundary: gate.boundary,
      completedGoalProofs: phaseGoalProofs(db, slug, gate.boundary.completedGoalIds) };
    if (!snapshot.completedGoalProofs) throw canonicalPlanError('PHASE_RETROSPECTIVE_PROOF_INCOMPLETE');
  } finally { closeSqlite(db); }

  const report = phaseReport(cwd, slug, snapshot.boundary.phaseNumber);
  if (report.error) throw canonicalPlanError('PHASE_RETROSPECTIVE_REPORT_FAILED', report.error);
  const commandRun = commandResult(cwd, request.regressionCommand);
  if (!commandRun.passed) throw canonicalPlanError('PHASE_RETROSPECTIVE_REGRESSION_FAILED');
  const runId = sha256(canonicalJson(['qe-phase-retrospective-run-v1', slug, request.phase,
    request.nextPhase, commandRun.command, sessionId, request.verifier, commandRun.exitCode,
    commandRun.signal, commandRun.outputHash, commandRun.executedAt]));
  const regression = { ...commandRun, runId, sessionId, verifier: request.verifier };
  const paths = phaseRetrospectivePaths(slug, snapshot.boundary.phaseNumber);
  const markdown = renderPhaseRetrospective(slug, snapshot.boundary, request, regression, paths.report);
  db = canonicalPlanOpenDb(cwd);
  if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    planGoalAdapterEnsureSchema(db); planGoalAdapterValidateAudit(db, slug, cwd);
    const rows = planGoalAdapterRows(db, slug); const nextGoal = planGoalAdapterQueue(rows.doc).firstIncomplete;
    if (rows.goals.sha256 !== snapshot.goalsSha256 || !nextGoal) throw canonicalPlanError('PHASE_RETROSPECTIVE_STALE');
    const existing = phaseRetrospectiveGate(db, slug, rows.doc, rows.goals, nextGoal);
    if (existing.valid) { db.exec('COMMIT'); return { ok: true, code: 'PHASE_RETROSPECTIVE_REPLAYED', artifact: existing.artifact }; }
    if (existing.code === 'PHASE_RETROSPECTIVE_INVALID') throw canonicalPlanError(existing.code);
    const reportRow = canonicalPlanReadRow(db, paths.report);
    if (!reportRow || canonicalPlanTextBytes(reportRow.content) === 0) throw canonicalPlanError('PHASE_RETROSPECTIVE_REPORT_FAILED');
    canonicalPlanWriteRow(db, paths.markdown, markdown, null);
    const markdownRow = canonicalPlanReadRow(db, paths.markdown);
    const artifact = { schema: 1, issuedBy: 'qe-ledger', slug, phase: request.phase,
      nextPhase: request.nextPhase, phaseNumber: snapshot.boundary.phaseNumber,
      completedGoalIds: snapshot.boundary.completedGoalIds,
      completedGoalProofs: snapshot.completedGoalProofs, sourceGoalsSha256: rows.goals.sha256,
      reportPath: paths.report, reportSha256: reportRow.sha256,
      retrospectivePath: paths.markdown, retrospectiveSha256: markdownRow.sha256,
      regression, summary: request.summary, gaps: request.gaps, lessons: request.lessons,
      actions: request.actions, createdAt: nowIso(), artifactDigest: '' };
    artifact.artifactDigest = retrospectiveDigest(artifact);
    canonicalPlanWriteRow(db, paths.proof, canonicalPlanSerializeJson(artifact), null);
    db.exec('COMMIT');
    return { ok: true, code: 'PHASE_RETROSPECTIVE_RECORDED', artifact };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error?.code ? error : canonicalPlanError('CANONICAL_STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

function legacyRunEvidenceId(slug, goalId, role, rawBytes) {
  return sha256(canonicalJson(['qe-plan-run-legacy-v1', slug, goalId, role, sha256(rawBytes)]));
}

function canonicalPlanValidateRunRecord(run, slug, goalId, role) {
  const keys = ['schema', 'goalId', 'role', 'attempt', 'invocationId', 'sessionId', 'verifier',
    'contractHash', 'runs', 'passed', 'executedAt', 'runId'];
  if (!lifecycleExact(run, keys) || run.schema !== 1 || run.goalId !== goalId || run.role !== role
    || !Number.isSafeInteger(run.attempt) || run.attempt < 0 || !LIFECYCLE_UUID_RE.test(run.invocationId)
    || !MACHINE_SESSION_RE.test(run.sessionId) || !/^[0-9a-f]{64}$/.test(run.contractHash)
    || (role === 'verification' ? !nonEmpty(run.verifier) : run.verifier !== null)
    || !Array.isArray(run.runs) || run.runs.length < 1 || typeof run.passed !== 'boolean'
    || !nonEmpty(run.executedAt) || !/^[0-9a-f]{64}$/.test(run.runId)) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  for (const item of run.runs) {
    if (!lifecycleExact(item, ['command', 'exitCode', 'signal', 'passed', 'outputHash', 'executedAt'])
      || !nonEmpty(item.command) || (item.exitCode !== null && !Number.isInteger(item.exitCode))
      || (item.signal !== null && typeof item.signal !== 'string') || typeof item.passed !== 'boolean'
      || !/^[0-9a-f]{64}$/.test(item.outputHash) || !nonEmpty(item.executedAt)) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID');
    }
  }
  const expected = sha256(canonicalJson(['qe-plan-run-v1', slug, goalId, role, run.attempt,
    run.invocationId, run.contractHash, run.sessionId, run.verifier, run.runs, run.executedAt]));
  if (run.runId !== expected || run.passed !== run.runs.every(item => item.passed)) {
    throw canonicalPlanError('CANONICAL_STORE_INVALID');
  }
  return run;
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
    const relGoals = join(PLANS_DIR, slug, 'goals.json');
    const relAcceptance = join(PLANS_DIR, slug, 'evidence', `${goalId}.acceptance.json`);
    const relCurrent = join(PLANS_DIR, slug, 'evidence', `${goalId}.${role}-run.json`);
    const relHistoryDir = join(PLANS_DIR, slug, 'evidence', 'runs');
    const sessionId = explicitSessionId || readCurrentSessionId(cwd);
    if (!sessionId || !MACHINE_SESSION_RE.test(sessionId)) {
      throw canonicalPlanError('CANONICAL_STORE_INVALID', sessionId
        ? 'machine evidence run requires a valid full QE session id'
        : 'machine evidence run requires a current QE session id');
    }
    const readDb = canonicalPlanOpenDb(cwd, { readOnly: true });
    if (!readDb) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE');
    let snapshot;
    try {
      const goalsRow = canonicalPlanReadRow(readDb, relGoals);
      const acceptanceRow = canonicalPlanReadRow(readDb, relAcceptance);
      const doc = canonicalPlanParseGoalsRow(goalsRow, slug);
      const goal = doc.goals.find(item => item.id === goalId);
      if (!goal || goal.status !== 'active') throw canonicalPlanError('CANONICAL_STORE_INVALID', 'evidence runs require the active Goal');
      if (!acceptanceRow) throw canonicalPlanError('CANONICAL_STORE_INVALID', 'acceptance contract changed after it was recorded');
      let parsed;
      try { parsed = JSON.parse(canonicalPlanDecodeRow(acceptanceRow)); }
      catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
      const contract = validateAcceptanceContract(parsed, goalId, goal.objective);
      if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) {
        throw canonicalPlanError('CANONICAL_STORE_INVALID', 'acceptance contract changed after it was recorded');
      }
      snapshot = {
        attempt: goal.attempts,
        contractHash: goal.acceptance.hash,
        goalsSha: goalsRow.sha256,
        acceptanceSha: acceptanceRow.sha256,
        commands: [...contract.requirements, ...contract.scenarios, contract.regression]
          .map(item => item.command).filter((value, index, values) => values.indexOf(value) === index),
      };
    } finally { closeSqlite(readDb); }

    const invocationId = randomUUID();
    const runs = snapshot.commands.map(command => commandResult(cwd, command));
    const executedAt = nowIso();
    const record = {
      schema: 1, goalId, role, attempt: snapshot.attempt, invocationId, sessionId,
      verifier: role === 'verification' ? verifier : null,
      contractHash: snapshot.contractHash, runs, passed: runs.every(run => run.passed), executedAt,
    };
    record.runId = sha256(canonicalJson([
      'qe-plan-run-v1', slug, goalId, role, record.attempt, invocationId, record.contractHash,
      sessionId, record.verifier, runs, executedAt,
    ]));
    const recordText = canonicalPlanSerializeJson(record);
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const currentRow = canonicalPlanReadRow(db, relGoals);
      const acceptanceRow = canonicalPlanReadRow(db, relAcceptance);
      const doc = canonicalPlanParseGoalsRow(currentRow, slug);
      const goal = doc.goals.find(item => item.id === goalId);
      if (!goal || goal.status !== 'active' || goal.attempts !== snapshot.attempt
        || goal.acceptance?.hash !== snapshot.contractHash || currentRow.sha256 !== snapshot.goalsSha
        || acceptanceRow?.sha256 !== snapshot.acceptanceSha) {
        throw canonicalPlanError('EVIDENCE_RUN_STALE');
      }
      const current = canonicalPlanReadRow(db, relCurrent);
      if (current) {
        const previousRaw = canonicalPlanDecodeRow(current);
        let previous;
        try { previous = JSON.parse(previousRaw); } catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
        const previousRunId = previous.runId
          ? canonicalPlanValidateRunRecord(previous, slug, goalId, role).runId
          : legacyRunEvidenceId(slug, goalId, role, previousRaw);
        const historyRel = join(relHistoryDir, `${goalId}.${role}.${previousRunId}.json`);
        const history = canonicalPlanReadRow(db, historyRel);
        if (history && canonicalPlanDecodeRow(history) !== previousRaw) throw canonicalPlanError('EVIDENCE_RUN_CONFLICT');
        if (!history) canonicalPlanWriteRow(db, historyRel, previousRaw, null);
      }
      canonicalPlanWriteRow(db, relCurrent, recordText, current?.sha256 || null);
      const event = { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `${role}-run=${join('evidence', `${goalId}.${role}-run.json`)}; passed=${record.passed}`, attempt: goal.attempts };
      const ledgerRel = join(PLANS_DIR, slug, 'ledger.jsonl');
      const appended = canonicalPlanAppendLedger(db, ledgerRel, event);
      const artifactSha = sha256(recordText);
      const identity = sha256(canonicalJson(['qe-plan-write-v1', `runGoalEvidence:${role}:${record.runId}`, slug, goalId, relCurrent, artifactSha]));
      canonicalPlanIdentity(db, identity, 'runGoalEvidence', slug, goalId, relCurrent, artifactSha, sha256(JSON.stringify(event)), appended.lineCount);
      canonicalPlanCommit(db);
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

function requirePassingRuns(cwd, slug, goal, goalId, db = null) {
  let implementationSession = null;
  for (const role of ['implementation', 'verification']) {
    const file = runEvidencePath(cwd, slug, goalId, role);
    const rel = join(PLANS_DIR, slug, 'evidence', `${goalId}.${role}-run.json`);
    const row = db ? canonicalPlanReadRow(db, rel) : null;
    if (!row && !existsSync(file)) throw new Error(`verified completion requires a ${role} machine evidence run`);
    let run;
    try { run = canonicalPlanValidateRunRecord(row ? JSON.parse(row.content) : readJsonFile(file, `${role} evidence run`), slug, goalId, role); }
    catch { throw new Error(`${role} machine evidence run is missing, stale, or failed`); }
    if (run.contractHash !== goal.acceptance?.hash || run.attempt !== goal.attempts
      || run.passed !== true || !run.runs.every(item => item.passed === true && nonEmpty(item.outputHash))) {
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
      const doc = canonicalPlanParseGoalsRow(current, slug);
      const goal = doc.goals?.find(item => item.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      if (goal.status !== 'pending') { db.exec('ROLLBACK'); throw new Error('acceptance contract can only be set before a Goal starts'); }
      const contract = prepareAcceptanceContract(readJsonFile(file, 'acceptance contract'), goalId,
        goal.objective, readCurrentSessionId(cwd), cwd);
      validateGoalDependencies(doc, goal, contract);
      const contractText = canonicalPlanSerializeJson(contract);
      const artifactSha = sha256(contractText);
      const identity = sha256(canonicalJson(['qe-plan-write-v1', 'setGoalAcceptance', slug, goalId, relAcceptance, artifactSha]));
      const existingAcceptance = canonicalPlanReadRow(db, relAcceptance);
      if (existingAcceptance && canonicalPlanDecodeRow(existingAcceptance) !== contractText) {
        db.exec('ROLLBACK'); throw canonicalPlanError('ACCEPTANCE_CONFLICT');
      }
      if (existingAcceptance) {
        const binding = goal.acceptance;
        if (!binding || binding.status !== 'defined' || binding.file !== join('evidence', `${goalId}.acceptance.json`)
          || binding.hash !== contractHash(contract)
          || !canonicalPlanReplayIdentity(db, identity, {
            operation: 'setGoalAcceptance', slug, goalId, artifactPath: relAcceptance, artifactSha256: artifactSha,
          })) throw canonicalPlanError('CANONICAL_STORE_INVALID');
        db.exec('COMMIT');
        return { goalId, acceptance: binding };
      }
      canonicalPlanWriteRow(db, relAcceptance, contractText, existingAcceptance?.sha256 || null);
      goal.acceptance = { status: 'defined', file: join('evidence', `${goalId}.acceptance.json`), hash: contractHash(contract) };
      const nextDoc = canonicalPlanSerializeJson(doc);
      canonicalPlanWriteRow(db, relGoals, nextDoc, current.sha256);
      const event = { ts: nowIso(), event: 'checkpoint', goalId, status: goal.status, evidence: `acceptance=${goal.acceptance.file}`, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, event);
      canonicalPlanIdentity(db, identity, 'setGoalAcceptance', slug, goalId, relAcceptance, artifactSha, sha256(JSON.stringify(event)), appended.lineCount);
      canonicalPlanCommit(db);
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
  const contract = prepareAcceptanceContract(readJsonFile(file, 'acceptance contract'), goalId,
    goal.objective, readCurrentSessionId(cwd), cwd);
  validateGoalDependencies(doc, goal, contract);
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
      const relAcceptance = join(PLANS_DIR, slug, 'evidence', `${goalId}.acceptance.json`);
      const relCompletion = join(PLANS_DIR, slug, 'evidence', `${goalId}.completion.json`);
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const doc = canonicalPlanParseGoalsRow(current, slug);
      const goal = doc.goals?.find(item => item.id === goalId);
      if (!goal) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `unknown goalId: ${goalId}`); }
      if (goal.status !== 'active') { db.exec('ROLLBACK'); throw new Error('completion evidence can only be recorded for the active Goal'); }
      const contractRow = canonicalPlanReadRow(db, relAcceptance);
      if (!contractRow) { db.exec('ROLLBACK'); throw new Error('Goal has no acceptance contract'); }
      let parsedContract;
      try { parsedContract = JSON.parse(canonicalPlanDecodeRow(contractRow)); }
      catch { throw canonicalPlanError('CANONICAL_STORE_INVALID'); }
      const contract = validateAcceptanceContract(parsedContract, goalId, goal.objective);
      if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) { db.exec('ROLLBACK'); throw new Error('acceptance contract changed after it was recorded'); }
      const evidence = validateCompletionEvidence(readJsonFile(file, 'completion evidence'), contract, goalId, goal.objective);
      const proofText = canonicalPlanSerializeJson(evidence);
      const artifactSha = sha256(proofText);
      const identity = sha256(canonicalJson(['qe-plan-write-v1', 'recordGoalEvidence', slug, goalId, relCompletion, artifactSha]));
      const existing = canonicalPlanReadRow(db, relCompletion);
      if (existing && canonicalPlanDecodeRow(existing) !== proofText) {
        db.exec('ROLLBACK'); throw canonicalPlanError('COMPLETION_EVIDENCE_CONFLICT');
      }
      requirePassingRuns(cwd, slug, goal, goalId, db);
      validateMicroScope(cwd, contract);
      debtAssertionInTransaction(db, slug);
      if (existing) {
        const binding = goal.completionEvidence;
        if (!binding || binding.status !== 'recorded' || binding.file !== join('evidence', `${goalId}.completion.json`)
          || !canonicalPlanReplayIdentity(db, identity, {
            operation: 'recordGoalEvidence', slug, goalId, artifactPath: relCompletion, artifactSha256: artifactSha,
          })) throw canonicalPlanError('CANONICAL_STORE_INVALID');
        db.exec('COMMIT');
        return { goalId, completionEvidence: binding };
      }
      canonicalPlanWriteRow(db, relCompletion, proofText, existing?.sha256 || null);
      goal.completionEvidence = { status: 'recorded', file: join('evidence', `${goalId}.completion.json`) };
      canonicalPlanWriteRow(db, relGoals, canonicalPlanSerializeJson(doc), current.sha256);
      const event = { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `completion=${goal.completionEvidence.file}; verifier=${evidence.independentVerification.verifier}`, attempt: goal.attempts };
      const appended = canonicalPlanAppendLedger(db, relLedger, event);
      canonicalPlanIdentity(db, identity, 'recordGoalEvidence', slug, goalId, relCompletion, artifactSha, sha256(JSON.stringify(event)), appended.lineCount);
      canonicalPlanCommit(db);
      return { goalId, completionEvidence: goal.completionEvidence };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw canonicalPlanWriteError(error);
    } finally { closeSqlite(db); }
  }
  const unavailable = new Error('PROJECTION_DEBT_UNAVAILABLE');
  unavailable.code = unavailable.message;
  throw unavailable;
}

function canonicalCompleteGoal(cwd, slug, goalId, evidenceText) {
  if (!canonicalPlanRoot(cwd)) {
    const error = new Error('PROJECTION_DEBT_UNAVAILABLE'); error.code = error.message; throw error;
  }
  const db = canonicalPlanOpenDb(cwd);
  if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    debtAssertionInTransaction(db, slug);
    const relGoals = join(PLANS_DIR, slug, 'goals.json');
    const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
    const current = canonicalPlanReadRow(db, relGoals);
    const ledger = canonicalPlanReadRow(db, relLedger);
    if (!current || !ledger) throw canonicalPlanError('CANONICAL_STORE_INVALID');
    canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledger));
    const doc = canonicalPlanParseGoalsRow(current, slug);
    const goal = doc.goals.find(item => item.id === goalId);
    if (!goal || goal.status !== 'active' || !goal.completionEvidence
      || goal.completionEvidence.status !== 'recorded') throw canonicalPlanError('CANONICAL_STORE_INVALID');
    goal.status = 'complete';
    canonicalPlanWriteRow(db, relGoals, canonicalPlanSerializeJson(doc), current.sha256);
    canonicalPlanAppendLedger(db, relLedger, { ts: nowIso(), event: 'verified', goalId,
      status: 'complete', evidence: evidenceText, attempt: goal.attempts });
    debtFault('completion-before-commit');
    canonicalPlanCommit(db);
    return { goalId, status: 'complete', attempts: goal.attempts };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw canonicalPlanWriteError(error);
  } finally { closeSqlite(db); }
}

/**
 * Advance the Plan-owned Goal queue by one safe lifecycle action.
 *
 * `next` starts the first pending Goal only when no Goal is active or blocked.
 * `complete` requires evidence for the sole active Goal and writes a reviewed,
 * provenance-linked knowledge page. This is the only normal write-back path.
 */
export function advanceGoal(cwd, slug, { action = 'next', evidence = '', sessionId = '' } = {}) {
  const ownerSession = sessionId || readCurrentSessionId(cwd);
  const input = action === 'block' || action === 'fail'
    ? { action, evidence, sessionId: ownerSession }
    : { action, sessionId: ownerSession };
  return executePlanGoalTransition(cwd, slug, input);
}

function planGoalAdapterSchemaDigest(db) {
  const names = [...PLAN_GOAL_ADAPTER_TABLES, ...PLAN_GOAL_ADAPTER_INDEXES, ...PLAN_GOAL_ADAPTER_TRIGGERS];
  const placeholders = names.map(() => '?').join(',');
  const rows = db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY type,name`)
    .all(...names);
  if (rows.length !== names.length || rows.some(row => typeof row.sql !== 'string')) {
    throw new Error('ADAPTER_STORE_CORRUPT');
  }
  return sha256(canonicalJson(['qe-plan-goal-adapter-schema-v1', PLAN_GOAL_ADAPTER_SCHEMA_VERSION, rows]));
}

function planGoalAdapterEnsureSchema(db) {
  const names = [...PLAN_GOAL_ADAPTER_TABLES, ...PLAN_GOAL_ADAPTER_INDEXES, ...PLAN_GOAL_ADAPTER_TRIGGERS];
  const placeholders = names.map(() => '?').join(',');
  const existing = db.prepare(`SELECT name FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY name`)
    .all(...names).map(row => row.name);
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(PLAN_GOAL_ADAPTER_SEAL_NAME);
  const fresh = existing.length === 0 && !seal;
  if (!fresh && (existing.join('|') !== [...names].sort().join('|') || !seal)) {
    throw new Error('ADAPTER_STORE_CORRUPT');
  }
  if (fresh) {
    db.exec(`
      CREATE TABLE lifecycle_plan_goal_bootstraps(
        bootstrap_id TEXT PRIMARY KEY, slug TEXT NOT NULL, manifest_json TEXT NOT NULL,
        manifest_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_plan_goal_intents(
        semantic_key TEXT PRIMARY KEY, slug TEXT NOT NULL, reservation_id TEXT NOT NULL UNIQUE,
        operation_id TEXT NOT NULL UNIQUE, action TEXT NOT NULL, goal_id TEXT NOT NULL,
        request_digest TEXT NOT NULL, base_hashes_json TEXT NOT NULL, evidence_digest TEXT NOT NULL,
        debt_digest TEXT NOT NULL, event_at TEXT NOT NULL, intent_json TEXT NOT NULL,
        intent_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX lifecycle_plan_goal_intent_slug ON lifecycle_plan_goal_intents(slug,semantic_key);
      CREATE TABLE lifecycle_plan_goal_heads(
        slug TEXT PRIMARY KEY, semantic_key TEXT NOT NULL UNIQUE, reservation_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_plan_goal_proofs(
        proof_id TEXT PRIMARY KEY, slug TEXT NOT NULL, goal_id TEXT NOT NULL,
        kind TEXT NOT NULL, proof_json TEXT NOT NULL, proof_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE lifecycle_plan_goal_receipts(
        receipt_id TEXT PRIMARY KEY, slug TEXT NOT NULL, semantic_key TEXT NOT NULL UNIQUE,
        operation_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, action TEXT NOT NULL,
        goal_id TEXT NOT NULL, request_digest TEXT NOT NULL, receipt_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL, post_goals_sha256 TEXT, post_ledger_sha256 TEXT,
        post_state_sha256 TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX lifecycle_plan_goal_receipt_request
        ON lifecycle_plan_goal_receipts(slug,action,request_digest,created_at);
      CREATE TABLE lifecycle_plan_goal_audit(
        slug TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, semantic_key TEXT NOT NULL,
        receipt_id TEXT NOT NULL, event_json TEXT NOT NULL, prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(slug,seq)
      );
    `);
    for (const table of PLAN_GOAL_ADAPTER_TABLES) {
      const deleteGuard = table === 'lifecycle_plan_goal_heads'
        ? `WHEN qe_plan_goal_adapter_write_v1()<>1`
        : '';
      db.exec(`
        CREATE TRIGGER ${table}_insert_guard BEFORE INSERT ON ${table}
          WHEN qe_plan_goal_adapter_write_v1()<>1
          BEGIN SELECT RAISE(ABORT,'PLAN_GOAL_ADAPTER_IMMUTABLE'); END;
        CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
          BEGIN SELECT RAISE(ABORT,'PLAN_GOAL_ADAPTER_IMMUTABLE'); END;
        CREATE TRIGGER ${table}_delete_guard BEFORE DELETE ON ${table}
          ${deleteGuard}
          BEGIN SELECT RAISE(ABORT,'PLAN_GOAL_ADAPTER_IMMUTABLE'); END;
      `);
    }
    const digest = planGoalAdapterSchemaDigest(db);
    db.prepare('INSERT INTO qe_schema_seals(name,version,digest,installed_at) VALUES(?,?,?,?)')
      .run(PLAN_GOAL_ADAPTER_SEAL_NAME, PLAN_GOAL_ADAPTER_SCHEMA_VERSION, digest, Date.now());
    return;
  }
  const digest = planGoalAdapterSchemaDigest(db);
  if (seal.version !== PLAN_GOAL_ADAPTER_SCHEMA_VERSION || seal.digest !== digest) {
    throw new Error('ADAPTER_STORE_CORRUPT');
  }
}

function planGoalAdapterPaths(slug) {
  return {
    goals: join(PLANS_DIR, slug, 'goals.json'),
    ledger: join(PLANS_DIR, slug, 'ledger.jsonl'),
    state: join(PLANS_DIR, slug, 'STATE.md'),
  };
}

function planGoalAdapterCanProjectInitialState(db, slug, doc) {
  if (!doc.goals.every(goal => goal.status === 'pending' && goal.attempts === 0)) return false;
  const tables = [
    'lifecycle_plan_goal_audit',
    'lifecycle_plan_goal_bootstraps',
    'lifecycle_plan_goal_heads',
    'lifecycle_plan_goal_intents',
    'lifecycle_plan_goal_proofs',
    'lifecycle_plan_goal_receipts',
  ];
  return tables.every(table => db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE slug=?`).get(slug).count === 0);
}

function planGoalAdapterRows(db, slug) {
  const paths = planGoalAdapterPaths(slug);
  const goals = canonicalPlanReadRow(db, paths.goals);
  const ledger = canonicalPlanReadRow(db, paths.ledger);
  const state = canonicalPlanReadRow(db, paths.state);
  if (!goals || !ledger || !state) throw new Error('CANONICAL_STATE_INVALID');
  canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledger));
  const doc = canonicalPlanParseGoalsRow(goals, slug);
  if (!Array.isArray(doc.goals) || doc.goals.length < 1 || doc.goals.length > 128) {
    throw new Error('CANONICAL_STATE_INVALID');
  }
  return {
    paths, goals, ledger, state, doc,
    baseHashes: { goalsSha256: goals.sha256, ledgerSha256: ledger.sha256, stateSha256: state.sha256 },
  };
}

function planGoalAdapterQueue(doc) {
  let nonComplete = false;
  let current = null;
  for (let index = 0; index < doc.goals.length; index += 1) {
    const goal = doc.goals[index];
    if (goal.id !== `G${String(index + 1).padStart(3, '0')}`
      || !STATUS_ENUM.includes(goal.status) || !Number.isSafeInteger(goal.attempts) || goal.attempts < 0) {
      throw new Error('CANONICAL_STATE_INVALID');
    }
    if (goal.status === 'complete') {
      if (nonComplete || goal.attempts < 1) throw new Error('CANONICAL_STATE_INVALID');
      continue;
    }
    nonComplete = true;
    if (goal.status === 'pending' && goal.attempts !== 0) throw new Error('CANONICAL_STATE_INVALID');
    if (['active', 'blocked', 'failed'].includes(goal.status) && goal.attempts < 1) throw new Error('CANONICAL_STATE_INVALID');
    if (['active', 'blocked'].includes(goal.status)) {
      if (current) throw new Error('CANONICAL_STATE_INVALID');
      current = goal;
    }
  }
  return { current, firstIncomplete: doc.goals.find(goal => goal.status !== 'complete') || null };
}

function planGoalAdapterDebtSnapshot(db, slug) {
  debtEnsureSchema(db);
  const outstanding = debtOutstanding(db, slug);
  const seal = db.prepare('SELECT version,digest FROM qe_schema_seals WHERE name=?').get(DEBT_SEAL_NAME);
  return {
    liabilityCount: outstanding.count,
    liabilityDigest: outstanding.digest,
    authorityDigest: sha256(canonicalJson(['qe-projection-debt-authority-v1', slug, seal, outstanding.items])),
  };
}

function planGoalAdapterAudit(db, slug, kind, semanticKey, receiptId, detail) {
  const last = db.prepare('SELECT seq,event_hash FROM lifecycle_plan_goal_audit WHERE slug=? ORDER BY seq DESC LIMIT 1').get(slug);
  const seq = last ? last.seq + 1 : 0;
  const prevHash = last?.event_hash || '0'.repeat(64);
  const event = { schema: 1, slug, seq, kind, semanticKey, receiptId, detail };
  const eventJson = canonicalJson(event);
  const eventHash = sha256(canonicalJson(['qe-plan-goal-audit-v1', prevHash, event]));
  db.prepare(`INSERT INTO lifecycle_plan_goal_audit
    (slug,seq,kind,semantic_key,receipt_id,event_json,prev_hash,event_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(slug, seq, kind, semanticKey, receiptId, eventJson, prevHash, eventHash, Date.now());
}

function planGoalAdapterFault(point) {
  const injector = globalThis[Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector')];
  return typeof injector === 'function' ? injector(point) : undefined;
}

function planGoalAdapterProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function planGoalAdapterValidateAudit(db, slug, cwd = null) {
  const bootstrapRefs = [];
  const receiptRefs = [];
  const receiptHeadSnapshots = [];
  for (const row of db.prepare('SELECT * FROM lifecycle_plan_goal_bootstraps WHERE slug=?').all(slug)) {
    let manifest;
    try { manifest = JSON.parse(row.manifest_json); } catch { throw new Error('ADAPTER_STORE_CORRUPT'); }
    if (canonicalJson(manifest) !== row.manifest_json || sha256(row.manifest_json) !== row.manifest_hash
      || sha256(canonicalJson(['qe-plan-goal-bootstrap-manifest-v1', manifest])) !== row.bootstrap_id
      || manifest.slug !== slug || !Number.isSafeInteger(manifest.orderedStep)
      || manifest.orderedStep < 0 || !/^[0-9a-f]{64}$/.test(manifest.artifactDigest)
      || !/^[0-9a-f]{64}$/.test(manifest.snapshotDigest)
      || !/^[0-9a-f]{64}$/.test(manifest.requestId)
      || !/^[0-9a-f]{64}$/.test(manifest.proofDigest)) throw new Error('ADAPTER_STORE_CORRUPT');
    const snapshotDigest = manifest.scope === 'goal'
      ? sha256(canonicalJson(['qe-plan-goal-bootstrap-goal-snapshot-v1', manifest.snapshotCore]))
      : sha256(canonicalJson(['qe-plan-goal-bootstrap-plan-snapshot-v1', slug,
        manifest.snapshotCore.goalSnapshotDigests]));
    const artifactDigest = manifest.scope === 'goal'
      ? sha256(canonicalJson(['qe-plan-goal-bootstrap-artifact-v1', 'goal', slug,
        manifest.goalId, manifest.targetState, snapshotDigest, manifest.proofDigest]))
      : sha256(canonicalJson(['qe-plan-goal-bootstrap-artifact-v1', 'plan', slug,
        manifest.targetState, snapshotDigest, manifest.proofDigest]));
    const requestId = sha256(canonicalJson(['qe-plan-goal-bootstrap-v1', slug, manifest.scope,
      manifest.goalId || 'plan', manifest.targetState, manifest.orderedStep, artifactDigest]));
    if (snapshotDigest !== manifest.snapshotDigest || artifactDigest !== manifest.artifactDigest
      || requestId !== manifest.requestId || manifest.resultRef?.requestId !== requestId) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
    bootstrapRefs.push(manifest.resultRef);
  }
  if (cwd) planGoalAdapterValidateControllerRefs(cwd, bootstrapRefs);
  for (const row of db.prepare('SELECT * FROM lifecycle_plan_goal_intents WHERE slug=?').all(slug)) {
    let intent;
    try { intent = JSON.parse(row.intent_json); } catch { throw new Error('ADAPTER_STORE_CORRUPT'); }
    if (canonicalJson(intent) !== row.intent_json || sha256(row.intent_json) !== row.intent_hash
      || intent.slug !== slug || intent.semanticKey !== row.semantic_key
      || intent.reservationId !== row.reservation_id || intent.operationId !== row.operation_id
      || canonicalJson(intent.baseHashes) !== row.base_hashes_json) throw new Error('ADAPTER_STORE_CORRUPT');
  }
  for (const row of db.prepare('SELECT * FROM lifecycle_plan_goal_heads WHERE slug=?').all(slug)) {
    if (!db.prepare(`SELECT 1 FROM lifecycle_plan_goal_intents
      WHERE slug=? AND semantic_key=? AND reservation_id=?`).get(slug, row.semantic_key, row.reservation_id)) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
  }
  for (const row of db.prepare('SELECT * FROM lifecycle_plan_goal_proofs WHERE slug=?').all(slug)) {
    let proof;
    try { proof = JSON.parse(row.proof_json); } catch { throw new Error('ADAPTER_STORE_CORRUPT'); }
    const { proofId, proofDigest, createdAt, ...body } = proof;
    const expectedDigest = planGoalAdapterProofDigest(body);
    const expectedId = proof.kind === 'goal'
      ? sha256(canonicalJson(['qe-plan-goal-proof-v1', 'goal', slug, proof.goalId,
        proof.attempt, proof.controllerRevision, expectedDigest]))
      : sha256(canonicalJson(['qe-plan-goal-proof-v1', 'plan', slug,
        proof.controllerRevision, expectedDigest]));
    if (canonicalJson(proof) !== row.proof_json || sha256(row.proof_json) !== row.proof_hash
      || proofId !== row.proof_id || proofDigest !== expectedDigest || proofId !== expectedId
      || proof.slug !== slug || createdAt == null) throw new Error('ADAPTER_STORE_CORRUPT');
  }
  for (const row of db.prepare('SELECT * FROM lifecycle_plan_goal_receipts WHERE slug=?').all(slug)) {
    const receipt = planGoalAdapterReceipt(row);
    if (receipt.kind === 'projected') {
      receiptRefs.push(...receipt.newlyAllowedResultRefs);
      receiptHeadSnapshots.push(...receipt.carriedHeadSnapshots);
    } else if (receipt.kind === 'controller-denied') {
      receiptRefs.push(...receipt.newlyAllowedResultRefs, receipt.deniedResultRef);
      receiptHeadSnapshots.push(...receipt.allowedHeadSnapshots);
    }
    if (!db.prepare(`SELECT 1 FROM lifecycle_plan_goal_intents
      WHERE slug=? AND semantic_key=? AND operation_id=?`).get(slug, row.semantic_key, row.operation_id)) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
  }
  if (cwd) {
    planGoalAdapterValidateControllerRefs(cwd, receiptRefs);
    planGoalAdapterValidateHeadSnapshots(cwd, receiptHeadSnapshots);
  }
  const rows = db.prepare('SELECT * FROM lifecycle_plan_goal_audit WHERE slug=? ORDER BY seq').all(slug);
  let previous = '0'.repeat(64);
  const allowedKinds = new Set(['bootstrap-step', 'intent-created', 'proof-ready',
    'controller-denied', 'projected', 'rejected']);
  for (let seq = 0; seq < rows.length; seq += 1) {
    const row = rows[seq];
    let event;
    try { event = JSON.parse(row.event_json); } catch { throw new Error('ADAPTER_STORE_CORRUPT'); }
    if (row.seq !== seq || row.prev_hash !== previous || !allowedKinds.has(row.kind)
      || event.schema !== 1 || event.slug !== slug || event.seq !== seq || event.kind !== row.kind
      || event.semanticKey !== row.semantic_key || event.receiptId !== row.receipt_id
      || canonicalJson(event) !== row.event_json
      || sha256(canonicalJson(['qe-plan-goal-audit-v1', previous, event])) !== row.event_hash) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
    if (row.kind === 'intent-created'
      && !db.prepare('SELECT 1 FROM lifecycle_plan_goal_intents WHERE semantic_key=? AND slug=?').get(row.semantic_key, slug)) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
    if (['projected', 'controller-denied', 'rejected'].includes(row.kind)
      && !db.prepare('SELECT 1 FROM lifecycle_plan_goal_receipts WHERE receipt_id=? AND semantic_key=? AND slug=?')
        .get(row.receipt_id, row.semantic_key, slug)) throw new Error('ADAPTER_STORE_CORRUPT');
    previous = row.event_hash;
  }
  const parsedAudit = rows.map(row => JSON.parse(row.event_json));
  for (const bootstrap of db.prepare('SELECT bootstrap_id FROM lifecycle_plan_goal_bootstraps WHERE slug=?').all(slug)) {
    if (parsedAudit.filter(event => event.kind === 'bootstrap-step'
      && event.detail?.bootstrapId === bootstrap.bootstrap_id).length !== 1) throw new Error('ADAPTER_STORE_CORRUPT');
  }
  for (const intent of db.prepare('SELECT semantic_key FROM lifecycle_plan_goal_intents WHERE slug=?').all(slug)) {
    if (parsedAudit.filter(event => event.kind === 'intent-created'
      && event.semanticKey === intent.semantic_key).length !== 1) throw new Error('ADAPTER_STORE_CORRUPT');
  }
  const terminalKind = { projected: 'projected', 'controller-denied': 'controller-denied', rejected: 'rejected' };
  for (const receipt of db.prepare('SELECT receipt_id,kind FROM lifecycle_plan_goal_receipts WHERE slug=?').all(slug)) {
    if (parsedAudit.filter(event => event.kind === terminalKind[receipt.kind]
      && event.receiptId === receipt.receipt_id).length !== 1) throw new Error('ADAPTER_STORE_CORRUPT');
  }
  for (const proof of db.prepare('SELECT proof_json FROM lifecycle_plan_goal_proofs WHERE slug=?').all(slug)) {
    const digest = JSON.parse(proof.proof_json).proofDigest;
    if (!parsedAudit.some(event => event.kind === 'proof-ready'
      && (event.detail?.goalProofDigest === digest || event.detail?.planProofDigest === digest
        || event.detail?.goalProofDigests?.includes(digest)))) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
  }
  return { seq: rows.length - 1, hash: previous };
}

function planGoalAdapterReceipt(row) {
  let receipt;
  try { receipt = JSON.parse(row.receipt_json); } catch { throw new Error('ADAPTER_STORE_CORRUPT'); }
  if (canonicalJson(receipt) !== row.receipt_json || sha256(row.receipt_json) !== row.receipt_hash
    || receipt.receiptId !== row.receipt_id || receipt.semanticKey !== row.semantic_key
    || receipt.operationId !== row.operation_id || receipt.kind !== row.kind
    || receipt.slug !== row.slug || receipt.action !== row.action || receipt.goalId !== row.goal_id
    || receipt.requestDigest !== row.request_digest) throw new Error('ADAPTER_STORE_CORRUPT');
  let expected;
  if (receipt.kind === 'projected') {
    expected = sha256(canonicalJson(['qe-plan-goal-receipt-v2', 'projected', receipt.slug,
      receipt.operationId, receipt.semanticKey, receipt.reservationId, receipt.generation,
      receipt.carryFromReceiptId, receipt.requestDigest, receipt.goalProofDigest,
      receipt.planProofDigest, receipt.allowedPrefixDigest, receipt.newlyAllowedResultRefs,
      receipt.eventContentDigest, receipt.targetHashes]));
  } else if (receipt.kind === 'controller-denied') {
    expected = sha256(canonicalJson(['qe-plan-goal-receipt-v2', 'controller-denied', receipt.slug,
      receipt.operationId, receipt.semanticKey, receipt.reservationId, receipt.generation,
      receipt.carryFromReceiptId, receipt.requestDigest, receipt.baseHashes, receipt.goalProofDigest,
      receipt.planProofDigest, receipt.allowedPrefixDigest, receipt.newlyAllowedResultRefs,
      receipt.deniedResultRef, receipt.code]));
  } else if (receipt.kind === 'rejected') {
    expected = sha256(canonicalJson(['qe-plan-goal-receipt-v1', 'rejected', receipt.slug,
      receipt.operationId, receipt.semanticKey, receipt.reservationId, receipt.code,
      receipt.requestDigest, receipt.baseHashes, receipt.liabilityDigest, receipt.authorityDigest]));
  }
  if (!expected || expected !== receipt.receiptId) throw new Error('ADAPTER_STORE_CORRUPT');
  return receipt;
}

function planGoalControllerHeadSnapshot(controller, processId, resultRef) {
  const read = controller.read(processId);
  if (!read?.ok || !read.snapshot || !Number.isSafeInteger(read.snapshot.revision)
    || !Number.isSafeInteger(read.auditSeq) || !/^[0-9a-f]{64}$/.test(read.auditHash)) {
    throw new Error('CONTROLLER_STATE_CONFLICT');
  }
  const controllerHeadSnapshotCore = { schema: 1, processId, state: read.snapshot.state,
    revision: read.snapshot.revision, lastAuditSeq: read.auditSeq, lastAuditHash: read.auditHash };
  return { resultRef, controllerHeadSnapshotCore,
    controllerHeadSnapshotDigest: sha256(canonicalJson(['qe-plan-goal-controller-head-snapshot-v1', controllerHeadSnapshotCore])) };
}

function planGoalAdapterValidateControllerRefs(cwd, refs) {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) throw new Error('CONTROLLER_STATE_CONFLICT');
  try {
    for (const ref of refs.filter(item => item && item !== PLAN_GOAL_NO_RESULT)) {
      const state = db.prepare('SELECT * FROM process_controller_state WHERE process_id=?').get(ref.processId);
      const rows = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq').all(ref.processId);
      let previous = '0'.repeat(64);
      let latestEvent = null;
      for (let index = 0; index < rows.length; index += 1) {
        const audit = rows[index];
        let event;
        try { event = JSON.parse(audit.event_json); } catch { throw new Error('CONTROLLER_STATE_CONFLICT'); }
        const hash = sha256(canonicalJson(['qe-process-controller-v1', ref.processId,
          index, previous, event]));
        if (audit.audit_seq !== index || audit.prev_hash !== previous || audit.event_hash !== hash
          || event.processId !== ref.processId || event.auditSeq !== index) {
          throw new Error('CONTROLLER_STATE_CONFLICT');
        }
        previous = audit.event_hash;
        latestEvent = event;
      }
      if (!state || !latestEvent || state.last_audit_seq !== rows.at(-1).audit_seq
        || state.last_audit_hash !== rows.at(-1).event_hash
        || canonicalJson(JSON.parse(state.snapshot_json)) !== canonicalJson(latestEvent.snapshotAfter)) {
        throw new Error('CONTROLLER_STATE_CONFLICT');
      }
      const row = rows.find(item => item.audit_seq === ref.auditSeq && item.event_hash === ref.auditHash
        && item.request_key === ref.requestId);
      let event;
      try { event = row ? JSON.parse(row.event_json) : null; } catch { event = null; }
      const compatibleBeforeRevision = event.stateRevisionBefore === ref.stateRevisionBefore
        || (ref.stateRevisionBefore === null && event.kind === 'decision'
          && event.stateRevisionBefore === event.result?.baseRevision);
      if (!row || !event || event.processId !== ref.processId
        || event.requestId !== ref.requestId || event.allowed !== ref.allowed || event.code !== ref.code
        || !compatibleBeforeRevision
        || event.stateRevisionAfter !== ref.stateRevisionAfter
        || sha256(canonicalJson(event.result)) !== ref.resultDigest) {
        throw new Error('CONTROLLER_STATE_CONFLICT');
      }
    }
  } finally { closeSqlite(db); }
}

function planGoalAdapterValidateHeadSnapshots(cwd, snapshots) {
  if (!snapshots.length) return;
  planGoalAdapterValidateControllerRefs(cwd, snapshots.map(item => item.resultRef));
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) throw new Error('CONTROLLER_STATE_CONFLICT');
  try {
    for (const snapshot of snapshots) {
      const historical = db.prepare(`SELECT audit_seq,event_hash,event_json FROM process_controller_audit
        WHERE process_id=? AND audit_seq=?`).get(snapshot.resultRef.processId,
        snapshot.controllerHeadSnapshotCore.lastAuditSeq);
      if (!historical) throw new Error('CONTROLLER_STATE_CONFLICT');
      const event = JSON.parse(historical.event_json);
      const core = { schema: 1, processId: snapshot.resultRef.processId,
        state: event.snapshotAfter.state, revision: event.snapshotAfter.revision,
        lastAuditSeq: historical.audit_seq, lastAuditHash: historical.event_hash };
      const digest = sha256(canonicalJson(['qe-plan-goal-controller-head-snapshot-v1', core]));
      if (canonicalJson(core) !== canonicalJson(snapshot.controllerHeadSnapshotCore)
        || digest !== snapshot.controllerHeadSnapshotDigest) throw new Error('CONTROLLER_STATE_CONFLICT');
    }
  } finally { closeSqlite(db); }
}

function planGoalAdapterTerminalReject(cwd, slug, prepared, code) {
  const db = canonicalPlanOpenDb(cwd);
  if (!db) return { ok: false, code, audited: false };
  try {
    db.exec('BEGIN IMMEDIATE');
    planGoalAdapterEnsureSchema(db);
    planGoalAdapterValidateAudit(db, slug, cwd);
    const head = db.prepare('SELECT semantic_key,reservation_id FROM lifecycle_plan_goal_heads WHERE slug=?').get(slug);
    if (!head || head.semantic_key !== prepared.semanticKey || head.reservation_id !== prepared.reservationId) {
      throw new Error('ADAPTER_STORE_CORRUPT');
    }
    const rejectionDebt = planGoalAdapterDebtSnapshot(db, slug);
    const receiptId = sha256(canonicalJson(['qe-plan-goal-receipt-v1', 'rejected', slug,
      prepared.operationId, prepared.semanticKey, prepared.reservationId, code,
      prepared.requestDigest, prepared.rows.baseHashes, rejectionDebt.liabilityDigest,
      rejectionDebt.authorityDigest]));
    const receipt = { schema: 1, kind: 'rejected', receiptId, slug,
      operationId: prepared.operationId, semanticKey: prepared.semanticKey,
      reservationId: prepared.reservationId, action: prepared.action, goalId: prepared.goal.id,
      code, requestDigest: prepared.requestDigest, baseHashes: prepared.rows.baseHashes,
      liabilityDigest: rejectionDebt.liabilityDigest, authorityDigest: rejectionDebt.authorityDigest,
      createdAt: nowIso() };
    const receiptJson = canonicalJson(receipt);
    planGoalAdapterWriteConnections.add(db);
    db.prepare(`INSERT INTO lifecycle_plan_goal_receipts
      (receipt_id,slug,semantic_key,operation_id,kind,action,goal_id,request_digest,receipt_json,
       receipt_hash,post_goals_sha256,post_ledger_sha256,post_state_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, slug, prepared.semanticKey,
      prepared.operationId, 'rejected', prepared.action, prepared.goal.id, prepared.requestDigest,
      receiptJson, sha256(receiptJson), null, null, null, Date.now());
    planGoalAdapterAudit(db, slug, 'rejected', prepared.semanticKey, receiptId,
      { code, requestDigest: prepared.requestDigest, phase: 'apply' });
    db.prepare('DELETE FROM lifecycle_plan_goal_heads WHERE slug=? AND semantic_key=?')
      .run(slug, prepared.semanticKey);
    planGoalAdapterWriteConnections.delete(db);
    db.exec('COMMIT');
    return { ok: false, code, audited: true };
  } catch {
    planGoalAdapterWriteConnections.delete(db);
    try { db.exec('ROLLBACK'); } catch {}
    return { ok: false, code, audited: false };
  } finally { closeSqlite(db); }
}

function planGoalAdapterAcceptance(db, slug, goal) {
  const rel = join(PLANS_DIR, slug, 'evidence', `${goal.id}.acceptance.json`);
  const row = canonicalPlanReadRow(db, rel);
  if (!row || !goal.acceptance || goal.acceptance.status !== 'defined'
    || goal.acceptance.file !== join('evidence', `${goal.id}.acceptance.json`)) return null;
  let contract;
  try { contract = validateAcceptanceContract(JSON.parse(row.content), goal.id, goal.objective); }
  catch { return null; }
  if (goal.acceptance.hash !== contractHash(contract)) return null;
  const identity = sha256(canonicalJson(['qe-plan-write-v1', 'setGoalAcceptance', slug, goal.id, rel, row.sha256]));
  const binding = db.prepare(`SELECT identity FROM plan_write_identities
    WHERE identity=? AND operation='setGoalAcceptance' AND slug=? AND goal_id=? AND artifact_path=? AND artifact_sha256=?`)
    .get(identity, slug, goal.id, rel, row.sha256);
  return binding ? { row, contract, identity, binding } : null;
}

function planGoalAdapterBackfillLegacyAcceptanceIdentities(db, slug, goals) {
  const ledger = canonicalPlanReadRow(db, join(PLANS_DIR, slug, 'ledger.jsonl'));
  if (!ledger) throw new Error('CANONICAL_STATE_INVALID');
  const lines = canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledger));
  for (const goal of goals) {
    const rel = join(PLANS_DIR, slug, 'evidence', `${goal.id}.acceptance.json`);
    const row = canonicalPlanReadRow(db, rel);
    if (!row || goal.acceptance?.status !== 'defined'
      || goal.acceptance.file !== join('evidence', `${goal.id}.acceptance.json`)) continue;
    let contract;
    try { contract = validateAcceptanceContract(JSON.parse(row.content), goal.id, goal.objective); }
    catch { continue; }
    if (goal.acceptance.hash !== contractHash(contract)) continue;
    const identity = sha256(canonicalJson(['qe-plan-write-v1', 'setGoalAcceptance', slug, goal.id, rel, row.sha256]));
    if (db.prepare('SELECT 1 FROM plan_write_identities WHERE identity=?').get(identity)) continue;
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      let event;
      try { event = JSON.parse(lines[index]); } catch { continue; }
      if (lifecycleExact(event, ['ts', 'event', 'goalId', 'status', 'evidence', 'attempt'])
        && event.event === 'checkpoint' && event.goalId === goal.id && event.status === 'pending'
        && event.evidence === `acceptance=${join('evidence', `${goal.id}.acceptance.json`)}`
        && event.attempt === 0 && typeof event.ts === 'string') matches.push({ index, event });
    }
    if (matches.length !== 1) continue;
    const match = matches[0];
    db.prepare(`INSERT INTO plan_write_identities
      (identity,operation,slug,goal_id,artifact_path,artifact_sha256,event_sha256,event_offset,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(identity, 'setGoalAcceptance', slug, goal.id, rel, row.sha256,
      sha256(JSON.stringify(match.event)), match.index + 1, Math.trunc(row.mtime_ms));
  }
}

function planGoalAdapterRowIdentity(row) {
  return row ? { presence: true, rawSha256: row.sha256 }
    : { presence: false, rawSha256: PLAN_GOAL_NO_ROW };
}

function planGoalAdapterAcceptanceSnapshot(db, slug, goal) {
  const acceptance = planGoalAdapterAcceptance(db, slug, goal);
  const row = canonicalPlanReadRow(db, join(PLANS_DIR, slug, 'evidence', `${goal.id}.acceptance.json`));
  const identity = acceptance?.binding
    ? { presence: true, rawSha256: sha256(canonicalJson(acceptance.binding)) }
    : { presence: false, rawSha256: PLAN_GOAL_NO_ROW };
  return { acceptance, row, digest: sha256(canonicalJson(['qe-plan-goal-acceptance-snapshot-v1',
    slug, goal.id, planGoalAdapterRowIdentity(row), identity])) };
}

function planGoalAdapterEvidenceSnapshot(db, slug, goalId, attempt) {
  const names = ['acceptance', 'completion', 'implementation-run', 'verification-run'];
  const tuples = names.map(kind => {
    const name = kind;
    const suffix = name === 'acceptance' ? 'acceptance.json'
      : name === 'completion' ? 'completion.json' : `${name}.json`;
    const rowIdentity = join(PLANS_DIR, slug, 'evidence', `${goalId}.${suffix}`);
    const row = canonicalPlanReadRow(db, rowIdentity);
    return { kind, rowIdentity, ...planGoalAdapterRowIdentity(row) };
  });
  const identities = db.prepare(`SELECT identity,operation,artifact_path,artifact_sha256,event_sha256,event_offset
    FROM plan_write_identities WHERE slug=? AND goal_id=? ORDER BY operation,identity`).all(slug, goalId);
  for (const identity of identities) {
    tuples.push({ kind: `plan-write-identity:${identity.operation}`, rowIdentity: identity.identity,
      presence: true, rawSha256: sha256(canonicalJson(identity)) });
  }
  tuples.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return { tuples, digest: sha256(canonicalJson(['qe-plan-goal-evidence-snapshot-v1',
    slug, goalId, attempt, tuples])) };
}

function planGoalAdapterProofDigest(body) {
  const normalized = JSON.parse(JSON.stringify(body));
  if (normalized.attestations) {
    for (const attestation of Object.values(normalized.attestations)) {
      if (attestation && typeof attestation === 'object') attestation.proofRef = 'qe-plan-goal-proof:self';
    }
  }
  for (const key of ['goalsVerified', 'independentVerification', 'goalAlignment']) {
    if (normalized[key] && typeof normalized[key] === 'object') {
      normalized[key].proofRef = 'qe-plan-goal-proof:self';
    }
  }
  return sha256(canonicalJson(normalized));
}

function planGoalAdapterFormalSivsCompletion(db, slug, goal, acceptance, evidenceRows) {
  if (acceptance.contract.assurance?.lane === 'bounded-micro') {
    return { required: false, lane: 'bounded-micro' };
  }
  const bindingRows = db.prepare('SELECT * FROM process_controller_sivs_task_binding ORDER BY process_id').all();
  const matches = [];
  for (const bindingRow of bindingRows) {
    let payload;
    try { payload = JSON.parse(bindingRow.payload_json); } catch { continue; }
    if (payload?.planSlug !== slug || payload?.goalId !== goal.id
      || payload?.goalAttempt !== goal.attempts || payload?.acceptanceHash !== goal.acceptance?.hash) continue;
    const bindingDigest = sha256(canonicalJson(['qe-sivs-task-binding-v1', bindingRow.process_id,
      bindingRow.controller_identity, bindingRow.token_sha256, payload]));
    if (bindingRow.binding_digest !== bindingDigest || sha256(bindingRow.token_text) !== bindingRow.token_sha256) continue;

    const stateRow = db.prepare('SELECT * FROM process_controller_state WHERE process_id=?').get(bindingRow.process_id);
    let snapshot;
    try { snapshot = JSON.parse(stateRow?.snapshot_json); } catch { continue; }
    if (stateRow?.layer !== 'sivs' || snapshot?.state !== 'complete'
      || snapshot.revision !== stateRow.revision || stateRow.last_audit_seq < 1) continue;
    const auditRows = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq')
      .all(bindingRow.process_id);
    if (auditRows.length !== stateRow.last_audit_seq + 1) continue;
    let previous = '0'.repeat(64); let validChain = true;
    for (let index = 0; index < auditRows.length; index += 1) {
      const row = auditRows[index];
      let event;
      try { event = JSON.parse(row.event_json); } catch { validChain = false; break; }
      const expected = sha256(canonicalJson([PROCESS_CONTROLLER_DOMAINS.process,
        bindingRow.process_id, index, previous, event]));
      if (row.audit_seq !== index || row.prev_hash !== previous || row.event_hash !== expected) {
        validChain = false; break;
      }
      previous = row.event_hash;
    }
    if (!validChain || previous !== stateRow.last_audit_hash) continue;
    const finalRow = auditRows.at(-1); let event;
    try { event = JSON.parse(finalRow.event_json); } catch { continue; }
    const projection = event?.request?.completionEvidenceProjection;
    if (event?.operation !== 'sivs-stage-transition' || event.allowed !== true
      || event.result?.to !== 'complete' || event.snapshotAfter?.state !== 'complete'
      || projection?.planSlug !== slug || projection?.goalId !== goal.id
      || projection?.goalAttempt !== goal.attempts || projection?.acceptanceHash !== goal.acceptance?.hash
      || projection.goalRowSha256 !== evidenceRows.goal.sha256
      || projection.acceptanceRowSha256 !== evidenceRows.acceptance.sha256
      || projection.completionRowSha256 !== evidenceRows.completion.sha256
      || projection.implementationRowSha256 !== evidenceRows.implementation.sha256
      || projection.verificationRowSha256 !== evidenceRows.verification.sha256
      || event.request.completionEvidenceDigest !== sha256(canonicalJson([
        'qe-sivs-completion-evidence-v1', projection]))) continue;
    const supervision = db.prepare(`SELECT proof_json,proof_digest FROM process_controller_sivs_supervision_proof
      WHERE process_id=? AND proof_digest=?`).get(bindingRow.process_id, projection.supervisionProofDigest);
    let supervisionProof;
    try { supervisionProof = JSON.parse(supervision?.proof_json); } catch { continue; }
    if (!supervision || !['PASS', 'WARN'].includes(supervisionProof?.verdict)
      || supervisionProof.planSlug !== slug || supervisionProof.goalId !== goal.id
      || supervisionProof.goalAttempt !== goal.attempts
      || supervisionProof.acceptanceHash !== goal.acceptance?.hash) continue;
    matches.push({ required: true, lane: 'formal', processId: bindingRow.process_id,
      auditSeq: finalRow.audit_seq, auditHash: finalRow.event_hash,
      completionEvidenceDigest: event.request.completionEvidenceDigest,
      supervisionProofDigest: projection.supervisionProofDigest,
      taskPath: payload.taskPath, checklistPath: payload.checklistPath });
  }
  return matches.length === 1 ? matches[0] : null;
}

function planGoalAdapterGoalProof(cwd, db, slug, goal, controllerRevision) {
  const acceptance = planGoalAdapterAcceptance(db, slug, goal);
  const base = join(PLANS_DIR, slug, 'evidence');
  const implementationRow = canonicalPlanReadRow(db, join(base, `${goal.id}.implementation-run.json`));
  const verificationRow = canonicalPlanReadRow(db, join(base, `${goal.id}.verification-run.json`));
  const completionRow = canonicalPlanReadRow(db, join(base, `${goal.id}.completion.json`));
  if (!acceptance || !implementationRow || !verificationRow || !completionRow
    || !goal.completionEvidence || goal.completionEvidence.status !== 'recorded') {
    return null;
  }
  try {
    const implementation = canonicalPlanValidateRunRecord(JSON.parse(implementationRow.content), slug, goal.id, 'implementation');
    const verification = canonicalPlanValidateRunRecord(JSON.parse(verificationRow.content), slug, goal.id, 'verification');
    const completion = validateCompletionEvidence(JSON.parse(completionRow.content), acceptance.contract, goal.id, goal.objective);
    if (!implementation.passed || !verification.passed || implementation.attempt !== goal.attempts
      || verification.attempt !== goal.attempts || implementation.sessionId === verification.sessionId
      || completion.independentVerification.verifier !== verification.verifier
      || completion.goalAlignment.verifier !== verification.verifier) {
      return null;
    }
    validateMicroScope(cwd, acceptance.contract);
    const sivsCompletion = planGoalAdapterFormalSivsCompletion(db, slug, goal, acceptance, {
      goal: canonicalPlanReadRow(db, join(PLANS_DIR, slug, 'goals.json')),
      acceptance: acceptance.row, completion: completionRow,
      implementation: implementationRow, verification: verificationRow,
    });
    if (!sivsCompletion) return null;
    const entry = (proofRef, issuedBy, sessionId, digest) => ({ status: 'valid', subject: 'goal',
      revision: controllerRevision, proofRef, issuedBy, sessionId, digest });
    const sourceRef = 'qe-plan-goal-proof:self';
    const attestations = {
      acceptance: entry(sourceRef, 'qe-plan-acceptance', `identity:${acceptance.identity}`, acceptance.row.sha256),
      implementation: entry(sourceRef, 'qe-evidence-runner', implementation.sessionId, implementationRow.sha256),
      machineVerification: entry(sourceRef, verification.verifier, verification.sessionId, verificationRow.sha256),
      independentVerification: entry(sourceRef, verification.verifier, verification.sessionId, verification.runId),
      goalAlignment: entry(sourceRef, verification.verifier, verification.sessionId, completionRow.sha256),
    };
    const humanAcceptance = acceptance.contract.humanAcceptance.required
      ? { required: true, status: completion.humanAcceptance.status, proofRef: completion.humanAcceptance.evidence }
      : { required: false, status: 'not-required' };
    const core = { schema: 1, kind: 'goal', slug, goalId: goal.id, attempt: goal.attempts,
      controllerRevision, acceptanceSha256: acceptance.row.sha256, acceptanceIdentity: acceptance.identity,
      implementationRunId: implementation.runId, verificationRunId: verification.runId,
      completionSha256: completionRow.sha256, sivsCompletion, attestations, humanAcceptance };
    const proofDigest = planGoalAdapterProofDigest(core);
    const proofId = sha256(canonicalJson(['qe-plan-goal-proof-v1', 'goal', slug, goal.id,
      goal.attempts, controllerRevision, proofDigest]));
    const proofRef = `qe-plan-goal-proof:${proofId}`;
    for (const attestation of Object.values(attestations)) attestation.proofRef = proofRef;
    return { proofId, proofDigest, proofRef: `qe-plan-goal-proof:${proofId}`,
      proof: { ...core, proofId, proofDigest, createdAt: new Date(completionRow.mtime_ms).toISOString() },
      attestations, humanAcceptance };
  } catch { return null; }
}

function planGoalAdapterResultRef(result, processId, requestId) {
  const { replayed: ignoredReplay, audited: ignoredAudit, auditSeq: ignoredSeq,
    auditHash: ignoredHash, ...controllerResult } = result;
  void ignoredReplay; void ignoredAudit; void ignoredSeq; void ignoredHash;
  return {
    processId, requestId, auditSeq: result.auditSeq, auditHash: result.auditHash,
    allowed: result.allowed, code: result.code,
    stateRevisionBefore: result.stateRevisionBefore ?? result.baseRevision ?? null,
    stateRevisionAfter: result.stateRevisionAfter ?? result.nextSnapshot?.revision ?? null,
    resultDigest: sha256(canonicalJson(controllerResult)),
  };
}

function planGoalAdapterControllers(cwd, slug, semanticKey, {
  action, includePlan, completePlan, goal, allGoals, proofByGoal, targetStatus, goalProof, planAttestations,
  bootstrapContext, bootstrapOnly = false,
}) {
  const planId = `qe-plan:${slug}`;
  const goalId = `${planId}:goal:${goal.id}`;
  const plan = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
  const goalController = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
  try {
    const bootstraps = [];
    let orderedStep = 0;
    const artifactFor = (scope, goalId, targetState) => {
      if (scope === 'goal') {
        const snapshot = bootstrapContext.goals.get(goalId);
        const proofDigest = targetState === 'complete'
          ? proofByGoal.get(goalId)?.proofDigest : PLAN_GOAL_NO_GOAL_PROOF;
        return { ...snapshot, proofDigest, artifactDigest: sha256(canonicalJson([
          'qe-plan-goal-bootstrap-artifact-v1', 'goal', slug, goalId, targetState,
          snapshot.snapshotDigest, proofDigest])) };
      }
      const proofDigest = targetState === 'complete' ? bootstrapContext.planProofDigest : PLAN_GOAL_NO_PLAN_PROOF;
      return { snapshotCore: bootstrapContext.planSnapshotCore,
        snapshotDigest: bootstrapContext.planSnapshotDigest,
        proofDigest,
        artifactDigest: sha256(canonicalJson(['qe-plan-goal-bootstrap-artifact-v1', 'plan',
          slug, targetState, bootstrapContext.planSnapshotDigest, proofDigest])) };
    };
    const bootstrapRequestId = (scope, goalId, targetState, step, artifactDigest) => sha256(canonicalJson([
      'qe-plan-goal-bootstrap-v1', slug, scope, goalId || 'plan', targetState, step, artifactDigest]));
    const recordBootstrap = (scope, processId, goalId, targetState, requestId, result, artifact) => {
      bootstraps.push({ scope, processId, goalId, targetState, orderedStep: orderedStep++,
        requestId, resultRef: planGoalAdapterResultRef(result, processId, requestId), ...artifact });
    };
    const persistedBootstrap = (processId, targetState) => bootstrapContext.existingBootstraps
      .get(`${processId}|${targetState}`);
    const recoverBootstrap = (controller, processId, requestId) => {
      const audit = controller.audit(processId);
      const index = audit.findIndex(item => item.request_key === requestId);
      const row = index < 0 ? null : audit[index];
      if (!row) return null;
      for (const suffix of audit.slice(index + 1)) {
        let event;
        try { event = JSON.parse(suffix.event_json); } catch { throw new Error('CONTROLLER_STATE_CONFLICT'); }
        if (event.allowed !== true) throw new Error('CONTROLLER_STATE_CONFLICT');
      }
      const event = JSON.parse(row.event_json);
      return { ...event.result, replayed: true, audited: true,
        auditSeq: row.audit_seq, auditHash: row.event_hash };
    };
    const consumePersisted = (processId, targetState) => {
      const persisted = persistedBootstrap(processId, targetState);
      if (!persisted) return false;
      orderedStep = Math.max(orderedStep, persisted.orderedStep + 1);
      return true;
    };
    const stateReachedByAdapter = (controller, processId, state) => controller.audit(processId)
      .some(row => bootstrapContext.authorizedRequestIds.has(row.request_key)
        && JSON.parse(row.event_json).snapshotAfter?.state === state);
    const validateExactControllerHistory = () => {
      const allowedRequestIds = new Set([
        ...bootstrapContext.authorizedRequestIds,
        ...[...bootstrapContext.existingBootstraps.values()].map(item => item.requestId),
        ...bootstraps.map(item => item.requestId),
      ]);
      const histories = [plan.audit(planId), ...allGoals.map(item =>
        goalController.audit(`${planId}:goal:${item.id}`))];
      if (histories.some(history => history.some(row => !allowedRequestIds.has(row.request_key)))) {
        throw new Error('CONTROLLER_STATE_CONFLICT');
      }
    };
    const planArtifact = artifactFor('plan', null, 'planned');
    const planInitRequestId = bootstrapRequestId('plan', null, 'planned', orderedStep, planArtifact.artifactDigest);
    let planRead = plan.read(planId);
    if (planRead.code === 'PROCESS_NOT_FOUND') {
      const planInit = plan.initialize({ processId: planId, requestId: planInitRequestId });
      if (!['INITIALIZED', 'IDEMPOTENT'].includes(planInit.code)) throw new Error('CONTROLLER_STATE_CONFLICT');
      recordBootstrap('plan', planId, null, 'planned', planInitRequestId, planInit, planArtifact);
      planRead = plan.read(planId);
    } else if (!consumePersisted(planId, 'planned')) {
      const recovered = recoverBootstrap(plan, planId, planInitRequestId);
      if (!recovered) throw new Error('CONTROLLER_STATE_CONFLICT');
      recordBootstrap('plan', planId, null, 'planned', planInitRequestId, recovered, planArtifact);
    }
    if (!planRead.ok) throw new Error('CONTROLLER_STATE_CONFLICT');
    let planSnapshot = planRead.snapshot;
    if (planSnapshot.state === 'planned' && !includePlan) {
      const artifact = artifactFor('plan', null, 'active');
      const requestId = bootstrapRequestId('plan', null, 'active', orderedStep, artifact.artifactDigest);
      const catchup = plan.transition({ processId: planId,
        requestId,
        to: 'active', expectedRevision: planSnapshot.revision, attestations: null, humanAcceptance: null });
      if (!catchup.allowed) throw new Error('CONTROLLER_STATE_CONFLICT');
      planSnapshot = plan.read(planId).snapshot;
      recordBootstrap('plan', planId, null, 'active', requestId, catchup, artifact);
    } else if (!includePlan && planSnapshot.state === 'active'
      && !stateReachedByAdapter(plan, planId, 'active') && !consumePersisted(planId, 'active')) {
      const artifact = artifactFor('plan', null, 'active');
      const requestId = bootstrapRequestId('plan', null, 'active', orderedStep, artifact.artifactDigest);
      const recovered = recoverBootstrap(plan, planId, requestId);
      if (!recovered) throw new Error('CONTROLLER_STATE_CONFLICT');
      recordBootstrap('plan', planId, null, 'active', requestId, recovered, artifact);
    }
    for (const canonicalGoal of allGoals) {
      const processId = `${planId}:goal:${canonicalGoal.id}`;
      const initArtifact = artifactFor('goal', canonicalGoal.id, 'pending');
      const initRequestId = bootstrapRequestId('goal', canonicalGoal.id, 'pending', orderedStep, initArtifact.artifactDigest);
      let goalRead = goalController.read(processId);
      if (goalRead.code === 'PROCESS_NOT_FOUND') {
        const initialized = goalController.initialize({ processId, requestId: initRequestId });
        if (!['INITIALIZED', 'IDEMPOTENT'].includes(initialized.code)) throw new Error('CONTROLLER_STATE_CONFLICT');
        recordBootstrap('goal', processId, canonicalGoal.id, 'pending', initRequestId, initialized, initArtifact);
        goalRead = goalController.read(processId);
      } else if (!consumePersisted(processId, 'pending')) {
        const recovered = recoverBootstrap(goalController, processId, initRequestId);
        if (!recovered) throw new Error('CONTROLLER_STATE_CONFLICT');
        recordBootstrap('goal', processId, canonicalGoal.id, 'pending', initRequestId, recovered, initArtifact);
      }
      if (!goalRead.ok) throw new Error('CONTROLLER_STATE_CONFLICT');
      let snapshot = goalRead.snapshot;
      const catchupStates = canonicalGoal.status === 'pending' ? []
        : canonicalGoal.status === 'active' ? ['active']
          : canonicalGoal.status === 'blocked' ? ['active', 'blocked']
            : canonicalGoal.status === 'failed' ? ['active', 'failed']
              : canonicalGoal.status === 'complete' ? ['active', 'complete'] : [];
      if (snapshot.state !== canonicalGoal.status) {
        if (snapshot.state !== 'pending') throw new Error('CONTROLLER_STATE_CONFLICT');
        for (const state of catchupStates) {
          const proof = state === 'complete' ? proofByGoal.get(canonicalGoal.id) : null;
          if (state === 'complete' && !proof) throw new Error('EVIDENCE_INCOMPLETE');
          const artifact = artifactFor('goal', canonicalGoal.id, state);
          const requestId = bootstrapRequestId('goal', canonicalGoal.id, state, orderedStep, artifact.artifactDigest);
          const catchup = goalController.transition({ processId, requestId,
            to: state, expectedRevision: snapshot.revision,
            attestations: proof?.attestations || null, humanAcceptance: proof?.humanAcceptance || null });
          if (!catchup.allowed) throw new Error('CONTROLLER_STATE_CONFLICT');
          snapshot = goalController.read(processId).snapshot;
          recordBootstrap('goal', processId, canonicalGoal.id, state, requestId, catchup, artifact);
        }
      } else if (canonicalGoal.status !== 'pending'
        && !stateReachedByAdapter(goalController, processId, canonicalGoal.status)) {
        for (const state of catchupStates) {
          if (consumePersisted(processId, state)) continue;
          const artifact = artifactFor('goal', canonicalGoal.id, state);
          const requestId = bootstrapRequestId('goal', canonicalGoal.id, state, orderedStep, artifact.artifactDigest);
          const recovered = recoverBootstrap(goalController, processId, requestId);
          if (!recovered) throw new Error('CONTROLLER_STATE_CONFLICT');
          recordBootstrap('goal', processId, canonicalGoal.id, state, requestId, recovered, artifact);
        }
      }
      if (snapshot.state !== canonicalGoal.status) throw new Error('CONTROLLER_STATE_CONFLICT');
    }
    if (bootstrapOnly) {
      if (planSnapshot.state === 'active') {
        const artifact = artifactFor('plan', null, 'complete');
        const requestId = bootstrapRequestId('plan', null, 'complete', orderedStep, artifact.artifactDigest);
        const catchup = plan.transition({ processId: planId, requestId, to: 'complete',
          expectedRevision: planSnapshot.revision, attestations: planAttestations,
          humanAcceptance: { required: false, status: 'not-required' } });
        if (!catchup.allowed) throw new Error('CONTROLLER_STATE_CONFLICT');
        recordBootstrap('plan', planId, null, 'complete', requestId, catchup, artifact);
        planSnapshot = plan.read(planId).snapshot;
      } else if (planSnapshot.state === 'complete'
        && !stateReachedByAdapter(plan, planId, 'complete') && !consumePersisted(planId, 'complete')) {
        const artifact = artifactFor('plan', null, 'complete');
        const requestId = bootstrapRequestId('plan', null, 'complete', orderedStep, artifact.artifactDigest);
        const recovered = recoverBootstrap(plan, planId, requestId);
        if (!recovered) throw new Error('CONTROLLER_STATE_CONFLICT');
        recordBootstrap('plan', planId, null, 'complete', requestId, recovered, artifact);
      }
      if (planSnapshot.state !== 'complete') throw new Error('CONTROLLER_STATE_CONFLICT');
      validateExactControllerHistory();
      return { children: [], bootstraps, close() { goalController.close(); plan.close(); } };
    }
    const goalSnapshot = goalController.read(goalId).snapshot;
    if (goalSnapshot.state !== goal.status) throw new Error('CONTROLLER_STATE_CONFLICT');
    const children = [];
    if (includePlan) children.push({ layer: 'plan', controller: plan, processId: planId,
      request: { processId: planId, requestId: sha256(canonicalJson(['qe-plan-goal-child-v1', semanticKey, 'plan'])).slice(0, 64),
        to: 'active', expectedRevision: 0, attestations: null, humanAcceptance: null } });
    children.push({ layer: 'goal', controller: goalController, processId: goalId,
      request: { processId: goalId, requestId: sha256(canonicalJson(['qe-plan-goal-child-v1', semanticKey, action, goal.id])).slice(0, 64),
        to: targetStatus, expectedRevision: goalSnapshot.revision,
        attestations: action === 'complete' ? goalProof.attestations : null,
        humanAcceptance: action === 'complete' ? goalProof.humanAcceptance : null } });
    if (completePlan) children.push({ layer: 'plan', controller: plan, processId: planId,
      request: { processId: planId, requestId: sha256(canonicalJson(['qe-plan-goal-child-v1', semanticKey, 'plan-complete'])).slice(0, 64),
        to: 'complete', expectedRevision: planSnapshot.revision,
        attestations: planAttestations, humanAcceptance: { required: false, status: 'not-required' } } });
    validateExactControllerHistory();
    return { children, bootstraps, close() { goalController.close(); plan.close(); } };
  } catch (error) {
    goalController.close(); plan.close(); throw error;
  }
}

function planGoalAdapterRecoveryBundle(cwd, operation) {
  const controllers = new Map();
  const controllerFor = layer => {
    if (!controllers.has(layer)) controllers.set(layer, createProcessController({ cwd, layer,
      authority: layer === 'plan' ? 'plan-controller' : 'goal-controller' }));
    return controllers.get(layer);
  };
  return {
    bootstraps: [],
    children: operation.children.map(child => ({ layer: child.layer,
      controller: controllerFor(child.layer), processId: child.processId, request: child.request })),
    close() { for (const controller of controllers.values()) controller.close(); },
  };
}

function planGoalAdapterApplyRecoveryBundle(cwd, operation, expectedChildren) {
  if (operation.status !== 'committed' || operation.children.length !== expectedChildren.length
    || operation.children.some((child, index) => child.status !== 'committed'
      || child.layer !== expectedChildren[index].layer
      || child.processId !== expectedChildren[index].processId
      || child.request?.to !== expectedChildren[index].to)) {
    throw new Error('CONTROLLER_STATE_CONFLICT');
  }
  planGoalAdapterValidateControllerRefs(cwd, operation.children.map(child => child.resultRef));
  const controllers = new Map();
  const controllerFor = layer => {
    if (!controllers.has(layer)) controllers.set(layer, createProcessController({ cwd, layer,
      authority: layer === 'plan' ? 'plan-controller' : 'goal-controller' }));
    return controllers.get(layer);
  };
  const children = operation.children.map(child => {
    const controller = controllerFor(child.layer);
    const current = controller.read(child.processId);
    if (!current.ok || current.snapshot.state !== child.request.to) throw new Error('CONTROLLER_STATE_CONFLICT');
    return { layer: child.layer, controller, processId: child.processId,
      request: { ...child.request, expectedRevision: current.snapshot.revision } };
  });
  return { bootstraps: [], children,
    close() { for (const controller of controllers.values()) controller.close(); } };
}

/**
 * Controller-bound canonical Plan/Goal transition entrypoint.
 *
 * The adapter is intentionally a closed envelope. Later phases of this
 * function install and validate the durable adapter authority before any
 * controller or canonical write; invalid and outside-root calls must remain
 * side-effect free.
 */
export function executePlanGoalTransition(cwd, slug, input) {
  if (!LIFECYCLE_SLUG_RE.test(slug) || !lifecyclePlainObject(input)) {
    return { ok: false, code: 'INVALID_INPUT', audited: false };
  }
  const keys = Object.keys(input).sort();
  const action = input.action;
  if (!['next', 'block', 'fail', 'complete'].includes(action)) {
    return { ok: false, code: 'INVALID_INPUT', audited: false };
  }
  if (action === 'block' || action === 'fail') {
    if (!['action|evidence', 'action|evidence|sessionId'].includes(keys.join('|'))
      || !lifecycleBoundedString(input.evidence, 48 * 1024)
      || (input.sessionId !== undefined && !MACHINE_SESSION_RE.test(input.sessionId))) {
      return { ok: false, code: 'INVALID_INPUT', audited: false };
    }
  } else if (!['action', 'action|sessionId'].includes(keys.join('|'))
    || (input.sessionId !== undefined && !MACHINE_SESSION_RE.test(input.sessionId))) {
    return { ok: false, code: 'INVALID_INPUT', audited: false };
  }
  const ownerSession = input.sessionId || readCurrentSessionId(cwd);
  if (!MACHINE_SESSION_RE.test(ownerSession || '')) {
    return { ok: false, code: 'SESSION_REQUIRED', audited: false };
  }
  if (!canonicalPlanRoot(cwd)) {
    return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
  }
  try {
    const initialDb = canonicalPlanOpenDb(cwd);
    if (!initialDb) return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
    let stateNeedsInitialProjection = false;
    try {
      const stateRow = canonicalPlanReadRow(initialDb, join(PLANS_DIR, slug, 'STATE.md'));
      const goalsRow = canonicalPlanReadRow(initialDb, join(PLANS_DIR, slug, 'goals.json'));
      const goalsDoc = goalsRow ? canonicalPlanParseGoalsRow(goalsRow, slug) : null;
      stateNeedsInitialProjection = !stateRow || !goalsDoc
        || projectionRenderState(canonicalPlanDecodeRow(stateRow), goalsDoc) !== canonicalPlanDecodeRow(stateRow);
      const adapterObjectCount = initialDb.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE name IN (${[...PLAN_GOAL_ADAPTER_TABLES, ...PLAN_GOAL_ADAPTER_INDEXES,
          ...PLAN_GOAL_ADAPTER_TRIGGERS].map(() => '?').join(',')})`)
        .get(...PLAN_GOAL_ADAPTER_TABLES, ...PLAN_GOAL_ADAPTER_INDEXES, ...PLAN_GOAL_ADAPTER_TRIGGERS).count;
      const adapterSeal = initialDb.prepare('SELECT 1 FROM qe_schema_seals WHERE name=?')
        .get(PLAN_GOAL_ADAPTER_SEAL_NAME);
      if (stateNeedsInitialProjection && (adapterObjectCount > 0 || adapterSeal)) {
        initialDb.exec('BEGIN');
        planGoalAdapterEnsureSchema(initialDb);
        planGoalAdapterValidateAudit(initialDb, slug, cwd);
        if (!goalsDoc || !planGoalAdapterCanProjectInitialState(initialDb, slug, goalsDoc)) {
          initialDb.exec('ROLLBACK');
          return { ok: false, code: 'CANONICAL_STATE_INVALID', audited: false };
        }
        initialDb.exec('COMMIT');
      }
    } finally { closeSqlite(initialDb); }
    if (stateNeedsInitialProjection) renderState(cwd, slug, { adapterBootstrap: true });
  } catch (error) {
    const code = error?.message === 'ADAPTER_STORE_CORRUPT'
      ? 'ADAPTER_STORE_CORRUPT' : 'CANONICAL_STATE_INVALID';
    return { ok: false, code, audited: false };
  }
  const requestCore = { schema: 1, slug, action, ownerSession,
    evidence: action === 'block' || action === 'fail' ? input.evidence : '' };
  const requestDigest = sha256(canonicalJson(['qe-plan-goal-request-v1', requestCore]));
  let db = canonicalPlanOpenDb(cwd);
  if (!db) return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
  let prepared;
  try {
    db.exec('BEGIN IMMEDIATE');
    planGoalAdapterEnsureSchema(db);
    planGoalAdapterValidateAudit(db, slug, cwd);
    const rows = planGoalAdapterRows(db, slug);
    const queue = planGoalAdapterQueue(rows.doc);
    planGoalAdapterBackfillLegacyAcceptanceIdentities(db, slug, rows.doc.goals);
    const replays = db.prepare(`SELECT * FROM lifecycle_plan_goal_receipts
      WHERE slug=? AND action=? AND request_digest=? AND kind='projected'
        AND post_goals_sha256=? AND post_ledger_sha256=? AND post_state_sha256=? ORDER BY created_at`)
      .all(slug, action, requestDigest, rows.baseHashes.goalsSha256,
        rows.baseHashes.ledgerSha256, rows.baseHashes.stateSha256);
    if (replays.length > 1) throw new Error('ADAPTER_CONFLICT');
    if (replays.length === 1) {
      const replay = replays[0];
      const receipt = planGoalAdapterReceipt(replay);
      const ledgerLines = canonicalPlanLedgerLines(canonicalPlanDecodeRow(rows.ledger));
      const line = JSON.parse(ledgerLines.at(-1));
      if (!line || line.receiptId !== receipt.receiptId || line.eventContentDigest !== receipt.eventContentDigest
        || receipt.postHashes.goalsSha256 !== rows.baseHashes.goalsSha256
        || receipt.postHashes.ledgerSha256 !== rows.baseHashes.ledgerSha256
        || receipt.postHashes.stateSha256 !== rows.baseHashes.stateSha256) throw new Error('ADAPTER_CONFLICT');
      const { eventContentDigest: ignoredEventDigest, receiptId: ignoredReceiptId, ...ledgerPayloadCore } = line;
      void ignoredEventDigest; void ignoredReceiptId;
      const recomputedEventDigest = sha256(canonicalJson(['qe-plan-goal-event-content-v2',
        receipt.reservationId, receipt.generation, receipt.carryFromReceiptId,
        receipt.allowedPrefixDigest, receipt.newlyAllowedResultRefs, receipt.goalResultRef,
        receipt.planResultRef, receipt.goalProofDigest, receipt.planProofDigest, ledgerPayloadCore]));
      if (recomputedEventDigest !== receipt.eventContentDigest || line.goal !== receipt.goalId
        || line.operationId !== receipt.operationId || line.semanticKey !== receipt.semanticKey
        || line.reservationId !== receipt.reservationId
        || canonicalJson(line.goalResultRef) !== canonicalJson(receipt.goalResultRef)
        || canonicalJson(line.planResultRef) !== canonicalJson(receipt.planResultRef)) {
        throw new Error('ADAPTER_CONFLICT');
      }
      planGoalAdapterValidateControllerRefs(cwd, [
        ...receipt.carriedHeadSnapshots.map(item => item.resultRef),
        ...receipt.newlyAllowedResultRefs,
      ]);
      const goal = rows.doc.goals.find(item => item.id === replay.goal_id);
      db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', audited: true, action,
        goal: { id: goal.id, status: goal.status, attempts: goal.attempts },
        operationId: replay.operation_id, receiptId: replay.receipt_id };
    }

    if (action === 'next' && queue.current?.status === 'active') {
      if (!queue.current.executionOwnerSession) {
        db.exec('COMMIT');
        return { ok: false, code: 'GOAL_OWNER_MISSING', audited: false };
      }
      if (queue.current.executionOwnerSession !== ownerSession) {
        db.exec('COMMIT');
        return { ok: false, code: 'GOAL_OWNED_BY_OTHER_SESSION', audited: false };
      }
      db.exec('COMMIT');
      return { ok: true, code: 'CONTINUE', audited: false, action: 'next',
        goal: { id: queue.current.id, status: queue.current.status, attempts: queue.current.attempts,
          executionOwnerSession: queue.current.executionOwnerSession } };
    }
    if (action === 'next' && queue.current?.status === 'blocked') {
      db.exec('COMMIT');
      return { ok: false, code: 'GOAL_BLOCKED', audited: false };
    }
    let goal;
    let targetStatus;
    let eventName;
    let actionEvidence = '';
    let bootstrapOnly = false;
    if (action === 'next') {
      goal = queue.firstIncomplete;
      targetStatus = 'active';
      eventName = 'started';
    } else if (action === 'block') {
      goal = queue.current?.status === 'active' ? queue.current : null;
      targetStatus = 'blocked';
      eventName = 'blocker';
      actionEvidence = input.evidence;
    } else if (action === 'fail') {
      goal = ['active', 'blocked'].includes(queue.current?.status) ? queue.current : null;
      targetStatus = 'failed';
      eventName = 'failed';
      actionEvidence = input.evidence;
    } else if (action === 'complete') {
      goal = queue.current?.status === 'active' ? queue.current : null;
      targetStatus = 'complete';
      eventName = 'verified';
    }
    if (action === 'next' && !goal) {
      bootstrapOnly = true;
      goal = rows.doc.goals.at(-1);
      targetStatus = 'complete';
      eventName = 'verified';
    }
    if (!goal) {
      db.exec('COMMIT');
      return { ok: false, code: 'NO_ACTIVE_GOAL', audited: false };
    }
    if (action !== 'next' && !bootstrapOnly) {
      if (!goal.executionOwnerSession) {
        if (action === 'complete') {
          db.exec('COMMIT');
          return { ok: false, code: 'GOAL_OWNER_MISSING', audited: false };
        }
      }
      if (goal.executionOwnerSession && goal.executionOwnerSession !== ownerSession) {
        db.exec('COMMIT');
        return { ok: false, code: 'GOAL_OWNED_BY_OTHER_SESSION', audited: false };
      }
    }
    if (action === 'next' && !bootstrapOnly && !['pending', 'failed'].includes(goal.status)) {
      throw new Error('CANONICAL_STATE_INVALID');
    }
    if (action === 'next' && goal.status === 'pending') {
      let retrospective;
      try { retrospective = phaseRetrospectiveGate(db, slug, rows.doc, rows.goals, goal); }
      catch { retrospective = { required: true, valid: false, code: 'PHASE_RETROSPECTIVE_INVALID',
        boundary: phaseBoundary(rows.doc, goal) }; }
      if (retrospective.required && !retrospective.valid) {
        db.exec('COMMIT');
        return { ok: false, code: retrospective.code, audited: false,
          phase: retrospective.boundary?.phase || null,
          nextPhase: retrospective.boundary?.nextPhase || null };
      }
    }

    const controllerStateRow = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='process_controller_state'").get()
      ? db.prepare('SELECT snapshot_json FROM process_controller_state WHERE process_id=?')
        .get(`qe-plan:${slug}:goal:${goal.id}`) : null;
    let controllerRevision = goal.status === 'pending' ? 0 : 1;
    try {
      if (controllerStateRow) {
        const controllerSnapshot = JSON.parse(controllerStateRow.snapshot_json);
        controllerRevision = controllerSnapshot.state === targetStatus && controllerSnapshot.state !== goal.status
          ? controllerSnapshot.revision - 1 : controllerSnapshot.revision;
      }
    }
    catch { throw new Error('CONTROLLER_STATE_CONFLICT'); }
    const goalProof = action === 'complete' || bootstrapOnly
      ? planGoalAdapterGoalProof(cwd, db, slug, goal, controllerRevision) : null;
    if ((action === 'complete' || bootstrapOnly) && goalProof) actionEvidence = goalProof.proofRef;
    const acceptanceSnapshot = planGoalAdapterAcceptanceSnapshot(db, slug, goal);
    let acceptance = action === 'next' ? acceptanceSnapshot.acceptance : { valid: true };
    if (action === 'next' && acceptance) {
      try { validateGoalDependencies(rows.doc, goal, acceptance.contract, { requireComplete: true }); }
      catch { acceptance = null; }
    }
    const evidenceSnapshot = planGoalAdapterEvidenceSnapshot(db, slug, goal.id, goal.attempts);
    const evidenceDigest = action === 'next'
      ? acceptanceSnapshot.digest
      : action === 'complete'
        ? evidenceSnapshot.digest
        : sha256(canonicalJson(['qe-plan-goal-action-evidence-v1', action, actionEvidence]));
    const debt = planGoalAdapterDebtSnapshot(db, slug);
    const goalRevision = { pending: 0, active: 1, blocked: 2, failed: 2 }[goal.status];
    const planActive = rows.doc.goals.some(item => item.status !== 'pending');
    const planRevision = planActive ? 1 : 0;
    const bootstrapGoalProofs = [];
    let bootstrapEvidenceComplete = true;
    for (const item of rows.doc.goals.filter(candidate => candidate.status === 'complete')) {
      const stateRow = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='process_controller_state'").get()
        ? db.prepare('SELECT snapshot_json FROM process_controller_state WHERE process_id=?')
          .get(`qe-plan:${slug}:goal:${item.id}`) : null;
      let revision = 1;
      try { if (stateRow) revision = Math.max(1, JSON.parse(stateRow.snapshot_json).revision - 1); } catch {}
      const proof = planGoalAdapterGoalProof(cwd, db, slug, item, revision);
      if (!proof) { bootstrapEvidenceComplete = false; break; }
      bootstrapGoalProofs.push(proof);
    }
    const completePlan = bootstrapOnly || action === 'complete'
      && rows.doc.goals.every(item => item.id === goal.id || item.status === 'complete');
    if ((action === 'complete' || bootstrapOnly)
      && !historicalRetrospectivesValid(db, slug, rows.doc, rows.goals)) {
      db.exec('COMMIT');
      return { ok: false, code: 'PHASE_RETROSPECTIVE_INVALID', audited: false };
    }
    const aggregateGoalProofs = [];
    if (completePlan && goalProof) {
      for (const item of rows.doc.goals) {
        if (item.id === goal.id) {
          aggregateGoalProofs.push(goalProof);
          continue;
        }
        const stateRow = db.prepare('SELECT snapshot_json FROM process_controller_state WHERE process_id=?')
          .get(`qe-plan:${slug}:goal:${item.id}`);
        let revision = 1;
        try { if (stateRow) revision = JSON.parse(stateRow.snapshot_json).revision; } catch {}
        const peerProof = bootstrapGoalProofs.find(proof => proof.proof.goalId === item.id)
          || planGoalAdapterGoalProof(cwd, db, slug, item, revision);
        if (!peerProof) { aggregateGoalProofs.length = 0; break; }
        aggregateGoalProofs.push(peerProof);
      }
    }
    const goalProofDigest = goalProof?.proofDigest || (action === 'complete' || bootstrapOnly
      ? sha256(canonicalJson(['qe-plan-goal-invalid-proof-v1', 'goal', evidenceSnapshot.digest]))
      : PLAN_GOAL_NO_GOAL_PROOF);
    let aggregateAttestations = null;
    if (completePlan && aggregateGoalProofs.length === rows.doc.goals.length) {
      const orderedRuns = aggregateGoalProofs.map(item => item.proof.verificationRunId);
      const sessionId = `aggregate:${sha256(canonicalJson(orderedRuns))}`;
      const proofRef = 'qe-plan-goal-proof:self';
      const planEntry = digest => ({ status: 'valid', subject: 'plan', revision: planRevision,
        proofRef, issuedBy: 'qe-plan-aggregate', sessionId, digest });
      aggregateAttestations = {
        goalsVerified: planEntry(sha256(canonicalJson(aggregateGoalProofs.map(item => [
          item.proof.goalId, item.proof.completionSha256, item.proofDigest])))),
        independentVerification: planEntry(sha256(canonicalJson(aggregateGoalProofs.map(item => [
          item.proof.goalId, item.proof.verificationRunId,
          item.proof.attestations.independentVerification.issuedBy,
          item.proof.attestations.independentVerification.sessionId])))),
        goalAlignment: planEntry(sha256(canonicalJson(aggregateGoalProofs.map(item => [
          item.proof.goalId, item.proof.attestations.goalAlignment.issuedBy,
          item.proof.attestations.goalAlignment.digest, item.proof.completionSha256])))),
      };
    }
    const planProofBody = aggregateAttestations ? { schema: 1, kind: 'plan', slug,
      controllerRevision: planRevision, goalCount: rows.doc.goals.length,
      goalIds: rows.doc.goals.map(item => item.id),
      goalProofDigests: aggregateGoalProofs.map(item => item.proofDigest),
      ...aggregateAttestations } : null;
    const invalidPeerRows = db.prepare(`SELECT proof_id,proof_hash FROM lifecycle_plan_goal_proofs
      WHERE slug=? AND kind='goal' ORDER BY goal_id,proof_id`).all(slug);
    const planProofDigest = planProofBody ? planGoalAdapterProofDigest(planProofBody)
      : completePlan ? sha256(canonicalJson(['qe-plan-goal-invalid-proof-v1', 'plan',
        evidenceSnapshot.digest, invalidPeerRows])) : PLAN_GOAL_NO_PLAN_PROOF;
    const planProof = completePlan && aggregateGoalProofs.length === rows.doc.goals.length
      ? (() => {
        const proofId = sha256(canonicalJson(['qe-plan-goal-proof-v1', 'plan', slug, planRevision, planProofDigest]));
        const proofRef = `qe-plan-goal-proof:${proofId}`;
        for (const attestation of Object.values(aggregateAttestations)) attestation.proofRef = proofRef;
        return { proofId, proofDigest: planProofDigest, proof: { ...planProofBody, proofId,
          proofDigest: planProofDigest, createdAt: nowIso() } };
      })() : null;
    const bootstrapGoals = new Map();
    for (let ordinal = 0; ordinal < rows.doc.goals.length; ordinal += 1) {
      const item = rows.doc.goals[ordinal];
      const acceptanceBinding = planGoalAdapterAcceptance(db, slug, item);
      const completionRow = canonicalPlanReadRow(db,
        join(PLANS_DIR, slug, 'evidence', `${item.id}.completion.json`));
      const snapshotCore = { schema: 1, slug, goalId: item.id, ordinal, status: item.status,
        attempts: item.attempts, acceptanceRawSha256: acceptanceBinding?.row.sha256 || PLAN_GOAL_NO_ROW,
        acceptanceIdentityRawSha256: acceptanceBinding?.identity ? sha256(acceptanceBinding.identity) : PLAN_GOAL_NO_ROW,
        completionRawSha256: completionRow?.sha256 || PLAN_GOAL_NO_ROW };
      bootstrapGoals.set(item.id, { snapshotCore,
        snapshotDigest: sha256(canonicalJson(['qe-plan-goal-bootstrap-goal-snapshot-v1', snapshotCore])) });
    }
    const planSnapshotCore = { schema: 1, slug,
      goalSnapshotDigests: rows.doc.goals.map(item => bootstrapGoals.get(item.id).snapshotDigest) };
    const planSnapshotDigest = sha256(canonicalJson(['qe-plan-goal-bootstrap-plan-snapshot-v1', slug,
      planSnapshotCore.goalSnapshotDigests]));
    const existingBootstraps = new Map(db.prepare(`SELECT manifest_json FROM lifecycle_plan_goal_bootstraps
      WHERE slug=?`).all(slug).map(row => {
      const manifest = JSON.parse(row.manifest_json);
      return [`${manifest.processId}|${manifest.targetState}`, manifest];
    }));
    const hasLifecycleOperations = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE type='table' AND name IN ('lifecycle_operations','lifecycle_operation_children')`).get().count === 2;
    const authorizedRequestIds = new Set(hasLifecycleOperations
      ? db.prepare(`SELECT child.request_id
          FROM lifecycle_operation_children child JOIN lifecycle_operations parent
            ON parent.operation_id=child.operation_id
          JOIN lifecycle_plan_goal_intents intent ON intent.operation_id=parent.operation_id
            AND intent.semantic_key=parent.semantic_key AND intent.slug=parent.slug
          WHERE parent.slug=? AND parent.kind='plan-goal-adapter' AND parent.finalized=1`)
        .all(slug).map(row => row.request_id)
      : []);
    const bootstrapContext = { goals: bootstrapGoals, planSnapshotCore, planSnapshotDigest,
      planProofDigest, existingBootstraps, authorizedRequestIds };
    let semanticKey = sha256(canonicalJson(['qe-plan-goal-adapter-v2', slug, action, goal.id, ownerSession,
      goal.attempts, goalRevision, planRevision, rows.baseHashes, evidenceDigest,
      goalProofDigest, planProofDigest, debt.liabilityDigest, debt.authorityDigest]));
    let reservationId = sha256(canonicalJson(['qe-plan-goal-reservation-v1', slug, semanticKey,
      action, goal.id, rows.baseHashes, evidenceDigest, goalProofDigest, planProofDigest,
      debt.liabilityDigest, debt.authorityDigest]));
    let generation = 0;
    let carryFromReceiptId = PLAN_GOAL_NO_RECEIPT;
    let carriedHeadSnapshots = [];
    let applyRecoveryOperationId = null;
    let applyRecoveryReceiptId = null;
    const rejectedRow = bootstrapOnly ? null
      : db.prepare("SELECT * FROM lifecycle_plan_goal_receipts WHERE semantic_key=? AND kind='rejected'").get(semanticKey);
    if (rejectedRow) {
      const rejected = planGoalAdapterReceipt(rejectedRow);
      if (rejected.liabilityDigest === debt.liabilityDigest
        && rejected.authorityDigest === debt.authorityDigest) {
        db.exec('COMMIT');
        return { ok: false, code: rejected.code, audited: true };
      }
      const rejectedAudit = db.prepare(`SELECT event_json FROM lifecycle_plan_goal_audit
        WHERE slug=? AND semantic_key=? AND receipt_id=? AND kind='rejected'`)
        .get(slug, rejected.semanticKey, rejected.receiptId);
      let rejectedEvent;
      try { rejectedEvent = rejectedAudit ? JSON.parse(rejectedAudit.event_json) : null; } catch {}
      if (rejectedEvent?.detail?.phase !== 'apply') throw new Error('ADAPTER_CONFLICT');
      applyRecoveryOperationId = rejected.operationId;
      applyRecoveryReceiptId = rejected.receiptId;
    }
    if (!bootstrapOnly) {
      const candidates = [];
      for (const row of db.prepare(`SELECT * FROM lifecycle_plan_goal_receipts
        WHERE slug=? AND action=? AND request_digest=? AND kind='rejected' ORDER BY created_at DESC`)
        .all(slug, action, requestDigest)) {
        const receipt = planGoalAdapterReceipt(row);
        if (receipt.goalId !== goal.id || canonicalJson(receipt.baseHashes) !== canonicalJson(rows.baseHashes)) continue;
        const auditRow = db.prepare(`SELECT event_json FROM lifecycle_plan_goal_audit
          WHERE slug=? AND semantic_key=? AND receipt_id=? AND kind='rejected'`).get(slug,
          receipt.semanticKey, receipt.receiptId);
        const priorIntentRow = db.prepare(`SELECT intent_json,intent_hash FROM lifecycle_plan_goal_intents
          WHERE semantic_key=?`).get(receipt.semanticKey);
        if (!auditRow || !priorIntentRow || sha256(priorIntentRow.intent_json) !== priorIntentRow.intent_hash) {
          throw new Error('ADAPTER_STORE_CORRUPT');
        }
        const auditEvent = JSON.parse(auditRow.event_json);
        const priorIntent = JSON.parse(priorIntentRow.intent_json);
        if (auditEvent.detail?.phase !== 'apply'
          || priorIntent.evidenceDigest !== evidenceDigest
          || priorIntent.goalProofDigest !== goalProofDigest
          || priorIntent.planProofDigest !== planProofDigest) continue;
        if (receipt.liabilityDigest === debt.liabilityDigest
          && receipt.authorityDigest === debt.authorityDigest) {
          db.exec('COMMIT');
          return { ok: false, code: receipt.code, audited: true };
        }
        if (receipt.operationId !== applyRecoveryOperationId) candidates.push(receipt);
      }
      if (candidates.length > 1 || (applyRecoveryOperationId && candidates.length)) {
        throw new Error('ADAPTER_CONFLICT');
      }
      if (candidates[0]) {
        applyRecoveryOperationId = candidates[0].operationId;
        applyRecoveryReceiptId = candidates[0].receiptId;
      }
    }
    if (applyRecoveryOperationId) {
      semanticKey = sha256(canonicalJson(['qe-plan-goal-apply-recovery-v1', semanticKey,
        applyRecoveryReceiptId, requestDigest, rows.baseHashes, goalProofDigest, planProofDigest,
        debt.liabilityDigest, debt.authorityDigest]));
      reservationId = sha256(canonicalJson(['qe-plan-goal-apply-recovery-reservation-v1', slug,
        semanticKey, applyRecoveryReceiptId]));
    }
    const deniedRows = bootstrapOnly ? [] : db.prepare(`SELECT * FROM lifecycle_plan_goal_receipts
      WHERE slug=? AND action=? AND request_digest=? AND kind='controller-denied' ORDER BY created_at DESC`)
      .all(slug, action, requestDigest);
    if (deniedRows.length) {
      const prior = planGoalAdapterReceipt(deniedRows[0]);
      const priorIntentRow = db.prepare('SELECT intent_json,intent_hash FROM lifecycle_plan_goal_intents WHERE semantic_key=?')
        .get(prior.semanticKey);
      if (!priorIntentRow || sha256(priorIntentRow.intent_json) !== priorIntentRow.intent_hash) {
        throw new Error('ADAPTER_STORE_CORRUPT');
      }
      const priorIntent = JSON.parse(priorIntentRow.intent_json);
      const carryMatches = prior.goalId === goal.id
        && canonicalJson(prior.baseHashes) === canonicalJson(rows.baseHashes)
        && prior.goalProofDigest === goalProofDigest && prior.planProofDigest === planProofDigest
        && priorIntent.debt?.liabilityDigest === debt.liabilityDigest
        && priorIntent.debt?.authorityDigest === debt.authorityDigest;
      if (!carryMatches) throw new Error('ADAPTER_CONFLICT');
      if (!Number.isSafeInteger(prior.generation) || prior.generation < 0
        || prior.generation >= PLAN_GOAL_MAX_GENERATION) {
        db.exec('COMMIT');
        return { ok: false, code: 'TRANSITION_DENIED', audited: true };
      }
      generation = prior.generation + 1;
      carryFromReceiptId = prior.receiptId;
      carriedHeadSnapshots = prior.allowedHeadSnapshots;
      planGoalAdapterValidateControllerRefs(cwd, [
        ...carriedHeadSnapshots.map(item => item.resultRef), prior.deniedResultRef,
      ]);
      const allowedPrefixDigest = sha256(canonicalJson(['qe-plan-goal-allowed-prefix-v1', carriedHeadSnapshots]));
      if (allowedPrefixDigest !== prior.allowedPrefixDigest) throw new Error('ADAPTER_CONFLICT');
      semanticKey = sha256(canonicalJson(['qe-plan-goal-adapter-carry-v1', prior.semanticKey,
        prior.receiptId, generation, allowedPrefixDigest, requestDigest, rows.baseHashes,
        goalProofDigest, planProofDigest, debt.liabilityDigest, debt.authorityDigest]));
      reservationId = sha256(canonicalJson(['qe-plan-goal-reservation-carry-v1', slug,
        semanticKey, prior.receiptId, generation, allowedPrefixDigest]));
    }
    const existingIntent = bootstrapOnly ? null
      : db.prepare('SELECT operation_id,intent_json,intent_hash,created_at FROM lifecycle_plan_goal_intents WHERE semantic_key=?')
        .get(semanticKey);
    let operationId = existingIntent?.operation_id || randomUUID();
    let eventAt = nowIso();
    if (existingIntent) {
      if (sha256(existingIntent.intent_json) !== existingIntent.intent_hash) throw new Error('ADAPTER_STORE_CORRUPT');
      const stored = JSON.parse(existingIntent.intent_json);
      if (stored.reservationId !== reservationId || stored.generation !== generation
        || stored.carryFromReceiptId !== carryFromReceiptId
        || canonicalJson(stored.carriedHeadSnapshots) !== canonicalJson(carriedHeadSnapshots)) {
        throw new Error('ADAPTER_CONFLICT');
      }
      eventAt = stored.eventAt;
    }
    const intent = { schema: 1, slug, semanticKey, reservationId, operationId, action, ownerSession,
      goalId: goal.id, requestDigest, baseHashes: rows.baseHashes, evidenceSnapshot, evidenceDigest, debt,
      goalProofDigest, planProofDigest, generation, carryFromReceiptId, carriedHeadSnapshots,
      ownerPid: process.pid, eventAt };
    planGoalAdapterWriteConnections.add(db);
    if (!existingIntent && !bootstrapOnly) {
      db.prepare(`INSERT INTO lifecycle_plan_goal_intents
        (semantic_key,slug,reservation_id,operation_id,action,goal_id,request_digest,base_hashes_json,
         evidence_digest,debt_digest,event_at,intent_json,intent_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(semanticKey, slug, reservationId, operationId,
        action, goal.id, requestDigest, canonicalJson(rows.baseHashes), evidenceDigest,
        sha256(canonicalJson(debt)), eventAt, canonicalJson(intent), sha256(canonicalJson(intent)), Date.now());
      db.prepare('INSERT INTO lifecycle_plan_goal_heads(slug,semantic_key,reservation_id,created_at) VALUES(?,?,?,?)')
        .run(slug, semanticKey, reservationId, Date.now());
      planGoalAdapterAudit(db, slug, 'intent-created', semanticKey, PLAN_GOAL_NO_RECEIPT,
        { operationId, reservationId, requestDigest, generation, carryFromReceiptId });
      planGoalAdapterFault('intent-head');
    } else if (!bootstrapOnly) {
      const head = db.prepare('SELECT semantic_key,reservation_id FROM lifecycle_plan_goal_heads WHERE slug=?').get(slug);
      if (!head || head.semantic_key !== semanticKey || head.reservation_id !== reservationId) {
        throw new Error('ADAPTER_STORE_CORRUPT');
      }
    }
    if (!acceptance || !bootstrapEvidenceComplete || ((action === 'complete' || bootstrapOnly) && (!goalProof
      || (completePlan && aggregateGoalProofs.length !== rows.doc.goals.length))) || debt.liabilityCount > 0) {
      const code = !acceptance ? 'ACCEPTANCE_REQUIRED'
        : !bootstrapEvidenceComplete || (action === 'complete' || bootstrapOnly) && (!goalProof || (completePlan && aggregateGoalProofs.length !== rows.doc.goals.length))
          ? 'EVIDENCE_INCOMPLETE' : 'PROJECTION_DEBT_OUTSTANDING';
      if (bootstrapOnly) {
        planGoalAdapterWriteConnections.delete(db);
        db.exec('ROLLBACK');
        return { ok: false, code, audited: false };
      }
      const receiptId = sha256(canonicalJson(['qe-plan-goal-receipt-v1', 'rejected', slug,
        operationId, semanticKey, reservationId, code, requestDigest, rows.baseHashes,
        debt.liabilityDigest, debt.authorityDigest]));
      const receipt = { schema: 1, kind: 'rejected', receiptId, slug, operationId, semanticKey,
        reservationId, action, goalId: goal.id, code, requestDigest, baseHashes: rows.baseHashes,
        liabilityDigest: debt.liabilityDigest, authorityDigest: debt.authorityDigest, createdAt: eventAt };
      const receiptJson = canonicalJson(receipt);
      db.prepare(`INSERT INTO lifecycle_plan_goal_receipts
        (receipt_id,slug,semantic_key,operation_id,kind,action,goal_id,request_digest,receipt_json,
         receipt_hash,post_goals_sha256,post_ledger_sha256,post_state_sha256,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, slug, semanticKey, operationId,
        'rejected', action, goal.id, requestDigest, receiptJson, sha256(receiptJson), null, null, null, Date.now());
      planGoalAdapterAudit(db, slug, 'rejected', semanticKey, receiptId, { code, requestDigest });
      db.prepare('DELETE FROM lifecycle_plan_goal_heads WHERE slug=? AND semantic_key=?').run(slug, semanticKey);
      planGoalAdapterWriteConnections.delete(db);
      canonicalPlanCommit(db);
      return { ok: false, code, audited: true };
    }
    const proofsToStore = new Map(bootstrapGoalProofs.map(proof => [proof.proofId, proof]));
    for (const proof of (completePlan ? aggregateGoalProofs : goalProof ? [goalProof] : [])) {
      proofsToStore.set(proof.proofId, proof);
    }
    for (const storedProof of proofsToStore.values()) {
      const proofJson = canonicalJson(storedProof.proof);
      const existingProof = db.prepare('SELECT proof_json,proof_hash FROM lifecycle_plan_goal_proofs WHERE proof_id=?')
        .get(storedProof.proofId);
      if (existingProof) {
        if (existingProof.proof_json !== proofJson || existingProof.proof_hash !== sha256(proofJson)) {
          throw new Error('ADAPTER_STORE_CORRUPT');
        }
      } else {
        db.prepare(`INSERT INTO lifecycle_plan_goal_proofs
          (proof_id,slug,goal_id,kind,proof_json,proof_hash,created_at) VALUES(?,?,?,?,?,?,?)`)
          .run(storedProof.proofId, slug, storedProof.proof.goalId, 'goal', proofJson, sha256(proofJson), Date.now());
      }
    }
    if (planProof) {
      const proofJson = canonicalJson(planProof.proof);
      const existingProof = db.prepare('SELECT proof_json,proof_hash FROM lifecycle_plan_goal_proofs WHERE proof_id=?')
        .get(planProof.proofId);
      if (existingProof) {
        if (existingProof.proof_json !== proofJson || existingProof.proof_hash !== sha256(proofJson)) {
          throw new Error('ADAPTER_STORE_CORRUPT');
        }
      } else {
        db.prepare(`INSERT INTO lifecycle_plan_goal_proofs
          (proof_id,slug,goal_id,kind,proof_json,proof_hash,created_at) VALUES(?,?,?,?,?,?,?)`)
          .run(planProof.proofId, slug, '__plan__', 'plan', proofJson, sha256(proofJson), Date.now());
      }
    }
    let planAttestations = null;
    if (completePlan && goalProof) {
      planAttestations = aggregateAttestations;
    }
    if (!db.prepare("SELECT 1 FROM lifecycle_plan_goal_audit WHERE slug=? AND semantic_key=? AND kind='proof-ready'")
      .get(slug, semanticKey)) {
      planGoalAdapterAudit(db, slug, 'proof-ready', semanticKey, PLAN_GOAL_NO_RECEIPT,
        { goalProofDigest, goalProofDigests: [...proofsToStore.values()].map(item => item.proofDigest),
          planProofDigest });
    }
    planGoalAdapterWriteConnections.delete(db);
    canonicalPlanCommit(db);
    planGoalAdapterFault('intent-committed');
    planGoalAdapterFault('proof-ready');
    prepared = { rows, goal, action, ownerSession, semanticKey, reservationId, operationId, eventAt, requestDigest,
      evidenceDigest, debt, includePlan: action === 'next' && !planActive,
      targetStatus, eventName, actionEvidence, goalProof, goalProofDigest, planProofDigest,
      completePlan, planAttestations, planProof, generation, carryFromReceiptId, carriedHeadSnapshots,
      existingIntent: Boolean(existingIntent), intentCreatedAt: existingIntent?.created_at || Date.now(), bootstrapContext,
      applyRecoveryOperationId,
      intentOwnerPid: existingIntent ? JSON.parse(existingIntent.intent_json).ownerPid : process.pid,
      bootstrapOnly,
      proofByGoal: new Map([...bootstrapGoalProofs, ...(goalProof ? [goalProof] : [])]
        .map(proof => [proof.proof.goalId, proof])) };
  } catch (error) {
    planGoalAdapterWriteConnections.delete(db);
    try { db.exec('ROLLBACK'); } catch {}
    const code = ['ADAPTER_STORE_CORRUPT', 'ADAPTER_CONFLICT', 'CANONICAL_STATE_INVALID'].includes(error?.message)
      ? error.message : 'STORE_UNAVAILABLE';
    return { ok: false, code, audited: false };
  } finally { closeSqlite(db); }

  let bundle;
  try {
    const recoveredOperation = prepared.existingIntent
      ? getLifecycleOperation(cwd, slug, prepared.operationId) : null;
    if (prepared.existingIntent && prepared.intentOwnerPid !== process.pid
      && planGoalAdapterProcessAlive(prepared.intentOwnerPid)) {
      return { ok: false, code: 'OPERATION_IN_PROGRESS', audited: false };
    }
    const applyRecoveryOperation = !recoveredOperation?.ok && prepared.applyRecoveryOperationId
      ? getLifecycleOperation(cwd, slug, prepared.applyRecoveryOperationId) : null;
    const planId = `qe-plan:${slug}`;
    const expectedRecoveryChildren = [
      ...(prepared.includePlan ? [{ layer: 'plan', processId: planId, to: 'active' }] : []),
      { layer: 'goal', processId: `${planId}:goal:${prepared.goal.id}`, to: prepared.targetStatus },
      ...(prepared.completePlan ? [{ layer: 'plan', processId: planId, to: 'complete' }] : []),
    ];
    bundle = recoveredOperation?.ok
      ? planGoalAdapterRecoveryBundle(cwd, recoveredOperation.operation)
      : applyRecoveryOperation?.ok
        ? planGoalAdapterApplyRecoveryBundle(cwd, applyRecoveryOperation.operation, expectedRecoveryChildren)
        : planGoalAdapterControllers(cwd, slug, prepared.semanticKey, {
      action, includePlan: prepared.includePlan, completePlan: prepared.completePlan,
      goal: prepared.goal, allGoals: prepared.rows.doc.goals, proofByGoal: prepared.proofByGoal,
      targetStatus: prepared.targetStatus, goalProof: prepared.goalProof,
      planAttestations: prepared.planAttestations, bootstrapContext: prepared.bootstrapContext,
      bootstrapOnly: prepared.bootstrapOnly,
    });
    if (!recoveredOperation?.ok && prepared.carriedHeadSnapshots.length > bundle.children.length) {
      throw new Error('CONTROLLER_STATE_CONFLICT');
    }
    for (let ordinal = 0; !recoveredOperation?.ok && ordinal < prepared.carriedHeadSnapshots.length; ordinal += 1) {
      const child = bundle.children[ordinal];
      const carried = prepared.carriedHeadSnapshots[ordinal];
      if (carried.resultRef.processId !== child.processId) throw new Error('CONTROLLER_STATE_CONFLICT');
      const reconstructed = planGoalControllerHeadSnapshot(child.controller, child.processId, carried.resultRef);
      if (canonicalJson(reconstructed) !== canonicalJson(carried)) throw new Error('CONTROLLER_STATE_CONFLICT');
    }
    if (!recoveredOperation?.ok) {
      bundle.children = bundle.children.slice(prepared.carriedHeadSnapshots.length);
    }
    const forcedDeniedOrdinal = planGoalAdapterFault('controller-roster');
    if (Number.isSafeInteger(forcedDeniedOrdinal) && forcedDeniedOrdinal >= 0
      && forcedDeniedOrdinal < bundle.children.length) {
      const child = bundle.children[forcedDeniedOrdinal];
      child.request = { ...child.request, to: child.layer === 'goal' ? 'complete' : 'planned',
        attestations: null, humanAcceptance: null };
    }
    planGoalAdapterFault('bootstrap-before-persist');
    const bootstrapDb = canonicalPlanOpenDb(cwd);
    if (!bootstrapDb) throw new Error('STORE_UNAVAILABLE');
    try {
      bootstrapDb.exec('BEGIN IMMEDIATE');
      planGoalAdapterEnsureSchema(bootstrapDb);
      planGoalAdapterValidateAudit(bootstrapDb, slug, cwd);
      planGoalAdapterWriteConnections.add(bootstrapDb);
      for (const item of bundle.bootstraps) {
        const manifest = { schema: 1, slug, scope: item.scope, processId: item.processId,
          goalId: item.goalId || null, targetState: item.targetState, orderedStep: item.orderedStep,
          snapshotCore: item.snapshotCore, snapshotDigest: item.snapshotDigest,
          proofDigest: item.proofDigest, artifactDigest: item.artifactDigest,
          requestId: item.requestId, resultRef: item.resultRef };
        const manifestJson = canonicalJson(manifest);
        const bootstrapId = sha256(canonicalJson(['qe-plan-goal-bootstrap-manifest-v1', manifest]));
        const existing = bootstrapDb.prepare('SELECT manifest_json,manifest_hash FROM lifecycle_plan_goal_bootstraps WHERE bootstrap_id=?')
          .get(bootstrapId);
        if (existing) {
          if (existing.manifest_json !== manifestJson || existing.manifest_hash !== sha256(manifestJson)) {
            throw new Error('CONTROLLER_STATE_CONFLICT');
          }
        } else {
          bootstrapDb.prepare(`INSERT INTO lifecycle_plan_goal_bootstraps
            (bootstrap_id,slug,manifest_json,manifest_hash,created_at) VALUES(?,?,?,?,?)`)
            .run(bootstrapId, slug, manifestJson, sha256(manifestJson), Date.now());
          planGoalAdapterAudit(bootstrapDb, slug, 'bootstrap-step', prepared.semanticKey,
            PLAN_GOAL_NO_RECEIPT, { bootstrapId, orderedStep: item.orderedStep,
              requestId: item.requestId, resultRef: item.resultRef });
        }
      }
      planGoalAdapterWriteConnections.delete(bootstrapDb);
      bootstrapDb.exec('COMMIT');
    } catch (error) {
      planGoalAdapterWriteConnections.delete(bootstrapDb);
      try { bootstrapDb.exec('ROLLBACK'); } catch {}
      throw error;
    } finally { closeSqlite(bootstrapDb); }
    if (prepared.bootstrapOnly) {
      bundle.close();
      return { ok: true, code: 'PLAN_COMPLETE', audited: false,
        action: 'next', total: prepared.rows.doc.goals.length };
    }
    const children = bundle.children.map(item => ({
      layer: item.layer, operation: 'transition', processId: item.processId,
      to: item.request.to, expectedRevision: item.request.expectedRevision,
      attestations: item.request.attestations, humanAcceptance: item.request.humanAcceptance,
    }));
    const created = createLifecycleOperation(cwd, slug, { operationId: prepared.operationId,
      semanticKey: prepared.semanticKey, kind: 'plan-goal-adapter',
      payload: { action, reservationId: prepared.reservationId, generation: prepared.generation,
        carryFromReceiptId: prepared.carryFromReceiptId }, children });
    if (!created.ok) throw new Error(`create:${created.code}`);
    planGoalAdapterFault('controller-reconciled');
    for (let ordinal = 0; ordinal < bundle.children.length; ordinal += 1) {
      const child = bundle.children[ordinal];
      const currentOperation = getLifecycleOperation(cwd, slug, prepared.operationId);
      const currentChild = currentOperation.ok ? currentOperation.operation.children[ordinal] : null;
      if (currentChild?.status === 'committed') continue;
      if (currentChild?.status === 'denied') break;
      const claim = claimLifecycleChild(cwd, slug, { operationId: prepared.operationId, ordinal,
        owner: 'plan-goal-adapter', leaseMs: 30000 });
      if (!claim.ok) throw new Error(`claim:${claim.code}`);
      child.controller.transition(claim.child.request);
      const settled = settleLifecycleChild(cwd, slug, { operationId: prepared.operationId,
        ordinal, claimToken: claim.child.claim.token });
      if (!settled.ok) throw new Error(`settle:${settled.code}`);
      planGoalAdapterFault(`controller-child-${ordinal}`);
    }
  } catch (error) {
    bundle?.close();
    const code = /^(claim|settle):/.test(String(error?.message))
      ? 'OPERATION_IN_PROGRESS' : 'CONTROLLER_STATE_CONFLICT';
    return { ok: false, code, audited: false };
  }
  const operation = getLifecycleOperation(cwd, slug, prepared.operationId);
  if (!operation.ok) {
    bundle.close();
    return { ok: false, code: prepared.existingIntent ? 'OPERATION_IN_PROGRESS' : 'CONTROLLER_STATE_CONFLICT', audited: false };
  }
  const operationHeadSnapshots = new Map();
  try {
    for (const child of operation.operation.children.filter(item => item.status === 'committed')) {
      const bundleChild = bundle.children.find(item => item.processId === child.processId);
      if (!bundleChild) throw new Error('CONTROLLER_STATE_CONFLICT');
      operationHeadSnapshots.set(child.processId,
        planGoalControllerHeadSnapshot(bundleChild.controller, child.processId, child.resultRef));
    }
  } catch {
    bundle.close();
    return { ok: false, code: prepared.existingIntent ? 'OPERATION_IN_PROGRESS' : 'CONTROLLER_STATE_CONFLICT', audited: false };
  }
  bundle.close();
  try {
    planGoalAdapterValidateControllerRefs(cwd, operation.operation.children
      .filter(child => child.status !== 'cancelled').map(child => child.resultRef));
    planGoalAdapterFault('controller-terminal');
  } catch {
    return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
  }
  if (operation.operation.status === 'denied') {
    const deniedDb = canonicalPlanOpenDb(cwd);
    if (!deniedDb) return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
    try {
      deniedDb.exec('BEGIN IMMEDIATE');
      planGoalAdapterEnsureSchema(deniedDb);
      planGoalAdapterValidateAudit(deniedDb, slug, cwd);
      const newlyAllowedResultRefs = operation.operation.children
        .filter(child => child.status === 'committed').map(child => child.resultRef);
      const newlyAllowedHeadSnapshots = operation.operation.children
        .filter(child => child.status === 'committed').map(child => operationHeadSnapshots.get(child.processId));
      const allowedHeadSnapshots = [...prepared.carriedHeadSnapshots, ...newlyAllowedHeadSnapshots];
      const deniedResultRef = operation.operation.children.find(child => child.status === 'denied')?.resultRef;
      const allowedPrefixDigest = sha256(canonicalJson(['qe-plan-goal-allowed-prefix-v1', allowedHeadSnapshots]));
      const receiptId = sha256(canonicalJson(['qe-plan-goal-receipt-v2', 'controller-denied', slug,
        prepared.operationId, prepared.semanticKey, prepared.reservationId, prepared.generation,
        prepared.carryFromReceiptId, prepared.requestDigest, prepared.rows.baseHashes,
        prepared.goalProofDigest, prepared.planProofDigest, allowedPrefixDigest, newlyAllowedResultRefs,
        deniedResultRef, 'TRANSITION_DENIED']));
      const receipt = { schema: 1, kind: 'controller-denied', receiptId, slug,
        operationId: prepared.operationId, semanticKey: prepared.semanticKey,
        reservationId: prepared.reservationId, generation: prepared.generation,
        carryFromReceiptId: prepared.carryFromReceiptId, action, goalId: prepared.goal.id,
        requestDigest: prepared.requestDigest, baseHashes: prepared.rows.baseHashes,
        goalProofDigest: prepared.goalProofDigest, planProofDigest: prepared.planProofDigest,
        allowedHeadSnapshots, allowedPrefixDigest,
        newlyAllowedResultRefs, deniedResultRef, code: 'TRANSITION_DENIED',
        createdAt: nowIso() };
      const receiptJson = canonicalJson(receipt);
      planGoalAdapterWriteConnections.add(deniedDb);
      deniedDb.prepare(`INSERT INTO lifecycle_plan_goal_receipts
        (receipt_id,slug,semantic_key,operation_id,kind,action,goal_id,request_digest,receipt_json,
         receipt_hash,post_goals_sha256,post_ledger_sha256,post_state_sha256,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, slug, prepared.semanticKey,
        prepared.operationId, 'controller-denied', action, prepared.goal.id, prepared.requestDigest,
        receiptJson, sha256(receiptJson), null, null, null, Date.now());
      planGoalAdapterAudit(deniedDb, slug, 'controller-denied', prepared.semanticKey, receiptId,
        { generation: prepared.generation, carryFromReceiptId: prepared.carryFromReceiptId,
          allowedPrefixDigest, newlyAllowedResultRefs, deniedResultRef });
      deniedDb.prepare('DELETE FROM lifecycle_plan_goal_heads WHERE slug=? AND semantic_key=?')
        .run(slug, prepared.semanticKey);
      planGoalAdapterWriteConnections.delete(deniedDb);
      deniedDb.exec('COMMIT');
      return { ok: false, code: 'TRANSITION_DENIED', audited: true };
    } catch {
      planGoalAdapterWriteConnections.delete(deniedDb);
      try { deniedDb.exec('ROLLBACK'); } catch {}
      return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
    } finally { closeSqlite(deniedDb); }
  }
  if (operation.operation.status !== 'committed') return { ok: false, code: 'OPERATION_IN_PROGRESS', audited: false };

  planGoalAdapterFault('before-apply');
  db = canonicalPlanOpenDb(cwd);
  if (!db) return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
  try {
    db.exec('BEGIN IMMEDIATE');
    planGoalAdapterEnsureSchema(db);
    planGoalAdapterValidateAudit(db, slug, cwd);
    const current = planGoalAdapterRows(db, slug);
    const concurrentProjected = db.prepare("SELECT * FROM lifecycle_plan_goal_receipts WHERE semantic_key=? AND kind='projected'")
      .get(prepared.semanticKey);
    if (concurrentProjected) {
      const receipt = planGoalAdapterReceipt(concurrentProjected);
      if (canonicalJson(receipt.postHashes) !== canonicalJson(current.baseHashes)) {
        throw new Error('ADAPTER_CONFLICT');
      }
      const concurrentGoal = current.doc.goals.find(item => item.id === prepared.goal.id);
      db.exec('COMMIT');
      return { ok: true, code: 'REPLAYED', audited: true, action,
        goal: { id: concurrentGoal.id, status: concurrentGoal.status, attempts: concurrentGoal.attempts },
        operationId: receipt.operationId, receiptId: receipt.receiptId };
    }
    if (canonicalJson(current.baseHashes) !== canonicalJson(prepared.rows.baseHashes)) {
      throw new Error('STALE_SNAPSHOT');
    }
    const debt = planGoalAdapterDebtSnapshot(db, slug);
    if (debt.liabilityCount !== 0 || canonicalJson(debt) !== canonicalJson(prepared.debt)) {
      throw new Error('PROJECTION_DEBT_OUTSTANDING');
    }
    const targetDoc = JSON.parse(JSON.stringify(current.doc));
    const targetGoal = targetDoc.goals.find(item => item.id === prepared.goal.id);
    targetGoal.status = prepared.targetStatus;
    if (action === 'next') {
      targetGoal.attempts += 1;
      targetGoal.executionOwnerSession = prepared.ownerSession;
    } else if (!targetGoal.executionOwnerSession) {
      targetGoal.executionOwnerSession = prepared.ownerSession;
    }
    planGoalAdapterQueue(targetDoc);
    const targetGoalsText = canonicalPlanSerializeJson(targetDoc);
    const targetStateText = projectionRenderState(current.state.content, targetDoc);
    const targetHashes = { goalsSha256: sha256(targetGoalsText), stateSha256: sha256(targetStateText) };
    const newlyAllowedResultRefs = operation.operation.children.map(child => child.resultRef);
    const carriedResultRefs = prepared.carriedHeadSnapshots.map(item => item.resultRef);
    const resultRefs = [...carriedResultRefs, ...newlyAllowedResultRefs];
    const goalResultRef = prepared.includePlan ? resultRefs[1] : resultRefs[0];
    const planResultRef = prepared.completePlan ? resultRefs.at(-1)
      : prepared.includePlan ? resultRefs[0] : PLAN_GOAL_NO_RESULT;
    const ledgerPayload = { ts: prepared.eventAt, event: prepared.eventName, goal: targetGoal.id,
      status: prepared.targetStatus, evidence: prepared.actionEvidence, attempt: targetGoal.attempts, operationId: prepared.operationId,
      semanticKey: prepared.semanticKey, reservationId: prepared.reservationId,
      goalResultRef, planResultRef,
      goalProofDigest: prepared.goalProofDigest,
      planProofDigest: prepared.planProofDigest };
    const allowedPrefixDigest = sha256(canonicalJson(['qe-plan-goal-allowed-prefix-v1', prepared.carriedHeadSnapshots]));
    const eventContentDigest = sha256(canonicalJson(['qe-plan-goal-event-content-v2',
      prepared.reservationId, prepared.generation, prepared.carryFromReceiptId,
      allowedPrefixDigest, newlyAllowedResultRefs, goalResultRef, planResultRef,
      prepared.goalProofDigest, prepared.planProofDigest, ledgerPayload]));
    const receiptId = sha256(canonicalJson(['qe-plan-goal-receipt-v2', 'projected', slug,
      prepared.operationId, prepared.semanticKey, prepared.reservationId, prepared.generation,
      prepared.carryFromReceiptId, prepared.requestDigest, prepared.goalProofDigest,
      prepared.planProofDigest, allowedPrefixDigest, newlyAllowedResultRefs,
      eventContentDigest, targetHashes]));
    const finalEvent = { ...ledgerPayload, eventContentDigest, receiptId };
    canonicalPlanWriteRow(db, current.paths.goals, targetGoalsText, current.goals.sha256);
    canonicalPlanWriteRow(db, current.paths.state, targetStateText, current.state.sha256);
    const appended = canonicalPlanAppendLedger(db, current.paths.ledger, finalEvent);
    const postHashes = { goalsSha256: targetHashes.goalsSha256,
      ledgerSha256: appended.sha, stateSha256: targetHashes.stateSha256 };
    const receipt = { schema: 1, kind: 'projected', receiptId, slug,
      operationId: prepared.operationId, semanticKey: prepared.semanticKey,
      reservationId: prepared.reservationId, generation: prepared.generation,
      carryFromReceiptId: prepared.carryFromReceiptId, action, goalId: targetGoal.id,
      requestDigest: prepared.requestDigest, goalResultRef, planResultRef,
      goalProofDigest: ledgerPayload.goalProofDigest, planProofDigest: ledgerPayload.planProofDigest,
      baseHashes: current.baseHashes, targetHashes, carriedHeadSnapshots: prepared.carriedHeadSnapshots,
      allowedPrefixDigest, newlyAllowedResultRefs, eventContentDigest, postHashes, projectedAt: prepared.eventAt };
    const receiptJson = canonicalJson(receipt);
    planGoalAdapterWriteConnections.add(db);
    db.prepare(`INSERT INTO lifecycle_plan_goal_receipts
      (receipt_id,slug,semantic_key,operation_id,kind,action,goal_id,request_digest,receipt_json,
       receipt_hash,post_goals_sha256,post_ledger_sha256,post_state_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, slug, prepared.semanticKey,
      prepared.operationId, 'projected', action, targetGoal.id, prepared.requestDigest,
      receiptJson, sha256(receiptJson), postHashes.goalsSha256, postHashes.ledgerSha256,
      postHashes.stateSha256, Date.now());
    planGoalAdapterAudit(db, slug, 'projected', prepared.semanticKey, receiptId,
      { operationId: prepared.operationId, generation: prepared.generation,
        carryFromReceiptId: prepared.carryFromReceiptId, allowedPrefixDigest,
        newlyAllowedResultRefs, eventContentDigest });
    db.prepare('DELETE FROM lifecycle_plan_goal_heads WHERE slug=? AND semantic_key=?')
      .run(slug, prepared.semanticKey);
    planGoalAdapterWriteConnections.delete(db);
    planGoalAdapterFault('pre-commit');
    canonicalPlanCommit(db);
    planGoalAdapterFault('post-commit');
    return { ok: true, code: 'PROJECTED', audited: true, action,
      goal: { id: targetGoal.id, status: targetGoal.status, attempts: targetGoal.attempts },
      operationId: prepared.operationId, receiptId };
  } catch (error) {
    planGoalAdapterWriteConnections.delete(db);
    try { db.exec('ROLLBACK'); } catch {}
    const code = ['STALE_SNAPSHOT', 'PROJECTION_DEBT_OUTSTANDING', 'ADAPTER_STORE_CORRUPT'].includes(error?.message)
      ? error.message : 'STORE_UNAVAILABLE';
    if (['STALE_SNAPSHOT', 'PROJECTION_DEBT_OUTSTANDING'].includes(code)) {
      return planGoalAdapterTerminalReject(cwd, slug, prepared, code);
    }
    return { ok: false, code, audited: false };
  } finally { closeSqlite(db); }
}

/** Render STATE.md's "## Phase Progress" block from goals.json (derived view). */
export function renderState(cwd, slug, { adapterBootstrap = false } = {}) {
  if (canonicalPlanRoot(cwd)) {
    const db = canonicalPlanOpenDb(cwd);
    if (!db) throw canonicalPlanError('CANONICAL_STORE_UNAVAILABLE', 'canonical store unavailable');
    try {
      db.exec('BEGIN IMMEDIATE');
      const relGoals = join(PLANS_DIR, slug, 'goals.json');
      const relLedger = join(PLANS_DIR, slug, 'ledger.jsonl');
      const relState = join(PLANS_DIR, slug, 'STATE.md');
      const current = canonicalPlanReadRow(db, relGoals);
      if (!current) { db.exec('ROLLBACK'); throw canonicalPlanError('CANONICAL_STORE_INVALID', `no goals.json for slug ${slug}`); }
      const ledgerRow = canonicalPlanReadRow(db, relLedger);
      if (!ledgerRow) throw canonicalPlanError('CANONICAL_STORE_INVALID');
      canonicalPlanLedgerLines(canonicalPlanDecodeRow(ledgerRow));
      const doc = canonicalPlanParseGoalsRow(current, slug);
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
      const currentState = canonicalPlanReadRow(db, relState);
      const prior = currentState ? canonicalPlanDecodeRow(currentState) : `# STATE — ${slug}\n`;
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
      const adapterInstalled = db.prepare('SELECT 1 FROM qe_schema_seals WHERE name=?')
        .get(PLAN_GOAL_ADAPTER_SEAL_NAME);
      if (adapterInstalled && currentState) {
        if (next !== prior && (!adapterBootstrap || !planGoalAdapterCanProjectInitialState(db, slug, doc))) {
          throw canonicalPlanError('DIRECT_TRANSITION_DENIED');
        }
        if (next !== prior) {
          canonicalPlanWriteRow(db, relState, next, currentState.sha256);
          canonicalPlanCommit(db);
          return { state: join(cwd, relState), phases: byPhase.size, initialized: true };
        }
        db.exec('COMMIT');
        return { state: join(cwd, relState), phases: byPhase.size, verified: true };
      }
      canonicalPlanWriteRow(db, relState, next, currentState?.sha256 ?? null);
      canonicalPlanCommit(db);
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
  try {
    const content = canonicalPlanReadText(cwd, join(PLANS_DIR, slug, 'ledger.jsonl'));
    if (content == null) return [];
    return content.split('\n')
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
    roadmapText = canonicalPlanReadText(cwd, join(PLANS_DIR, slug, 'ROADMAP.md')) || '';
    if (!roadmapText) roadmapErr = 'ROADMAP.md not found or empty';
  } catch (e) { roadmapErr = `ROADMAP.md read error: ${e.message}`; }

  try {
    requirementsText = canonicalPlanReadText(cwd, join(PLANS_DIR, slug, 'REQUIREMENTS.md')) || '';
    if (!requirementsText) requirementsErr = 'REQUIREMENTS.md not found or empty';
  } catch (e) { requirementsErr = `REQUIREMENTS.md read error: ${e.message}`; }

  try {
    decisionLogText = canonicalPlanReadText(cwd, join(PLANS_DIR, slug, 'DECISION_LOG.md')) || '';
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
  let goalsDoc = null;
  try { goalsDoc = canonicalPlanReadJson(cwd, join(PLANS_DIR, slug, 'goals.json')); } catch {}
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
  const rFile = reportPath(canonicalPlanRoot(cwd) || cwd, slug, phaseStr);
  try {
    const content = lines.join('\n') + '\n';
    if (canonicalPlanRoot(cwd)) {
      const db = canonicalPlanOpenDb(cwd);
      if (!db) throw new Error('canonical store unavailable');
      try {
        db.exec('BEGIN IMMEDIATE');
        const rel = join(PLANS_DIR, slug, 'reports', `PHASE_${phaseStr}_REPORT.md`);
        const current = canonicalPlanReadRow(db, rel);
        canonicalPlanWriteRow(db, rel, content, current?.sha256 || null);
        canonicalPlanCommit(db);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      } finally { closeSqlite(db); }
    } else {
      mkdirSync(join(rFile, '..'), { recursive: true });
      atomicWriteText(rFile, content);
    }
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
    else if (cmd === 'advance') res = advanceGoal(cwd, slug, {
      action: args.action, evidence: args.evidence, sessionId: args.session,
    });
    else if (cmd === 'stage-projection') res = stageLifecycleProjection(cwd, slug, {
      operationId: args['operation-id'], recipe: JSON.parse(readFileSync(args.file, 'utf8')),
    });
    else if (cmd === 'apply-projection') res = applyLifecycleOutcomeProjection(cwd, slug, { operationId: args['operation-id'] });
    else if (cmd === 'get-projection') res = getLifecycleProjection(cwd, slug, { operationId: args['operation-id'] });
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
