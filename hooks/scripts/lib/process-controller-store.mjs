import { createHash, randomBytes } from 'node:crypto';
import { closeSqlite, openSqlite } from './store-sqlite.mjs';

const ZERO_HASH = '0'.repeat(64);
const PROCESS_DOMAIN = 'qe-process-controller-v1';
const REJECTION_DOMAIN = 'qe-runtime-controller-rejections-v1';
const SIVS_COMPLETION_EVIDENCE_DOMAIN = 'qe-sivs-completion-evidence-v1';
const SIVS_COMPLETION_REQUEST_DOMAIN = 'qe-sivs-stage-completion-request-v1';
const PERSISTENT_LEASE_DOMAIN = 'qe-persistent-completion-lease-v1';
const PERSISTENT_STOP_DOMAIN = 'qe-persistent-stop-decision-v1';
const SIVS_REMEDIATION_DOMAIN = 'qe-sivs-bounded-remediation-v1';
const PROCESS_METRICS_DOMAIN = 'qe-process-metrics-report-v1';
const PROCESS_METRICS_SCOPE = 'controller-sivs-lifecycle-v1';
const EVENT_KEYS = [
  'schema', 'domain', 'processId', 'layer', 'auditSeq', 'kind', 'requestId',
  'controllerIdentity', 'operation', 'requestDigest', 'stateRevisionBefore',
  'stateRevisionAfter', 'allowed', 'code', 'request', 'result', 'snapshotAfter',
];
const PROCESS_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const METRIC_NAMES = ['taskResolutionRate', 'codeChurnRate', 'verificationTax',
  'harnessConstraintEffect', 'defectEscapeRate', 'passAt1Rate'];
const METRIC_UNKNOWN_REASONS = ['TASK_CREATED_ANCHOR_UNAVAILABLE',
  'CODE_CHANGE_EVIDENCE_UNAVAILABLE', 'IMPLEMENT_VERIFY_DURATION_EVIDENCE_UNAVAILABLE',
  'AB_COHORT_EVIDENCE_UNAVAILABLE', 'POST_VERIFY_REOPEN_EVIDENCE_UNAVAILABLE'];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function eventHash(domain, scope, seq, previous, eventJson) {
  return sha256(canonicalJson([domain, scope, seq, previous, JSON.parse(eventJson)]));
}

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_controller_state(
      process_id TEXT PRIMARY KEY, layer TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      revision INTEGER NOT NULL, last_audit_seq INTEGER NOT NULL,
      last_audit_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_audit(
      process_id TEXT NOT NULL, audit_seq INTEGER NOT NULL, request_key TEXT,
      event_json TEXT NOT NULL, prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      PRIMARY KEY(process_id, audit_seq), UNIQUE(process_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS process_controller_rejection_audit(
      audit_seq INTEGER PRIMARY KEY, event_json TEXT NOT NULL, prev_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL, recorded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_rejection_head(
      domain TEXT PRIMARY KEY, latest_seq INTEGER NOT NULL, latest_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_pse_preparation(
      process_id TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
      receipt_text TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      consumed_audit_seq INTEGER, consumed_audit_hash TEXT,
      PRIMARY KEY(process_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS process_controller_pse_task_binding(
      process_id TEXT PRIMARY KEY, controller_identity TEXT NOT NULL,
      token_text TEXT NOT NULL, token_sha256 TEXT NOT NULL UNIQUE,
      original_request_id TEXT NOT NULL, original_request_digest TEXT NOT NULL,
      payload_json TEXT NOT NULL, binding_digest TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_sivs_task_binding(
      process_id TEXT PRIMARY KEY, controller_identity TEXT NOT NULL,
      token_text TEXT NOT NULL, token_sha256 TEXT NOT NULL UNIQUE,
      original_request_id TEXT NOT NULL, original_request_digest TEXT NOT NULL,
      payload_json TEXT NOT NULL, binding_digest TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_sivs_verification_proof(
      process_id TEXT NOT NULL, verification_seq INTEGER NOT NULL,
      request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
      task_binding_sha256 TEXT NOT NULL, proof_json TEXT NOT NULL,
      proof_digest TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(process_id,verification_seq), UNIQUE(process_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS process_controller_sivs_supervision_proof(
      process_id TEXT NOT NULL, supervision_seq INTEGER NOT NULL,
      request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
      task_binding_sha256 TEXT NOT NULL, proof_json TEXT NOT NULL,
      proof_digest TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(process_id,supervision_seq), UNIQUE(process_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS process_controller_persistent_clock(
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), watermark_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_persistent_lease_current(
      session_id TEXT NOT NULL, process_id TEXT NOT NULL, generation INTEGER NOT NULL,
      status TEXT NOT NULL, fence INTEGER NOT NULL, token_text TEXT NOT NULL,
      token_sha256 TEXT NOT NULL, renew_count INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      latest_event_seq INTEGER NOT NULL, latest_event_hash TEXT NOT NULL,
      predecessor_terminal_digest TEXT, process_audit_hash TEXT NOT NULL,
      PRIMARY KEY(session_id,process_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS process_controller_persistent_session_current
      ON process_controller_persistent_lease_current(session_id);
    CREATE TABLE IF NOT EXISTS process_controller_persistent_lease_event(
      session_id TEXT NOT NULL, process_id TEXT NOT NULL, generation INTEGER NOT NULL,
      event_seq INTEGER NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
      kind TEXT NOT NULL, payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      PRIMARY KEY(session_id,process_id,generation,event_seq),
      UNIQUE(session_id,process_id,generation,request_id)
    );
    CREATE TABLE IF NOT EXISTS process_controller_persistent_stop_decision(
      event_key TEXT PRIMARY KEY, session_id TEXT NOT NULL, process_id TEXT NOT NULL,
      request_digest TEXT NOT NULL, authority_generation TEXT NOT NULL,
      result_json TEXT NOT NULL, recorded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_sivs_remediation_current(
      process_id TEXT PRIMARY KEY, task_binding_sha256 TEXT NOT NULL,
      status TEXT NOT NULL, round_count INTEGER NOT NULL, depth_count INTEGER NOT NULL,
      last_stagnation_digest TEXT, latest_event_seq INTEGER NOT NULL,
      latest_event_hash TEXT NOT NULL, process_revision INTEGER NOT NULL,
      process_audit_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_controller_sivs_remediation_event(
      process_id TEXT NOT NULL, event_seq INTEGER NOT NULL, request_id TEXT NOT NULL,
      request_digest TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      PRIMARY KEY(process_id,event_seq), UNIQUE(process_id,request_id)
    );
    CREATE TRIGGER IF NOT EXISTS process_controller_audit_no_update
      BEFORE UPDATE ON process_controller_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_audit_no_delete
      BEFORE DELETE ON process_controller_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_rejection_no_update
      BEFORE UPDATE ON process_controller_rejection_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_rejection_no_delete
      BEFORE DELETE ON process_controller_rejection_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_pse_task_binding_no_update
      BEFORE UPDATE ON process_controller_pse_task_binding BEGIN SELECT RAISE(ABORT, 'immutable PSE task binding'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_pse_task_binding_no_delete
      BEFORE DELETE ON process_controller_pse_task_binding BEGIN SELECT RAISE(ABORT, 'immutable PSE task binding'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_task_binding_no_update
      BEFORE UPDATE ON process_controller_sivs_task_binding BEGIN SELECT RAISE(ABORT, 'immutable SIVS task binding'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_task_binding_no_delete
      BEFORE DELETE ON process_controller_sivs_task_binding BEGIN SELECT RAISE(ABORT, 'immutable SIVS task binding'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_verification_no_update
      BEFORE UPDATE ON process_controller_sivs_verification_proof BEGIN SELECT RAISE(ABORT, 'immutable SIVS verification proof'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_verification_no_delete
      BEFORE DELETE ON process_controller_sivs_verification_proof BEGIN SELECT RAISE(ABORT, 'immutable SIVS verification proof'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_supervision_no_update
      BEFORE UPDATE ON process_controller_sivs_supervision_proof BEGIN SELECT RAISE(ABORT, 'immutable SIVS supervision proof'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_supervision_no_delete
      BEFORE DELETE ON process_controller_sivs_supervision_proof BEGIN SELECT RAISE(ABORT, 'immutable SIVS supervision proof'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_persistent_event_no_update
      BEFORE UPDATE ON process_controller_persistent_lease_event BEGIN SELECT RAISE(ABORT, 'append-only persistent lease'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_persistent_event_no_delete
      BEFORE DELETE ON process_controller_persistent_lease_event BEGIN SELECT RAISE(ABORT, 'append-only persistent lease'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_persistent_decision_no_update
      BEFORE UPDATE ON process_controller_persistent_stop_decision BEGIN SELECT RAISE(ABORT, 'immutable Stop decision'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_persistent_decision_no_delete
      BEFORE DELETE ON process_controller_persistent_stop_decision BEGIN SELECT RAISE(ABORT, 'immutable Stop decision'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_remediation_event_no_update
      BEFORE UPDATE ON process_controller_sivs_remediation_event BEGIN SELECT RAISE(ABORT, 'append-only SIVS remediation'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_sivs_remediation_event_no_delete
      BEFORE DELETE ON process_controller_sivs_remediation_event BEGIN SELECT RAISE(ABORT, 'append-only SIVS remediation'); END;
  `);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function validateProcessRows(state, rows) {
  let previous = ZERO_HASH;
  let previousRevision = null;
  let lastGoodSnapshot = null;
  let failure = null;
  let layer = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const event = parseJson(row.event_json);
    const validShape = exactKeys(event, EVENT_KEYS);
    const valid = validShape
      && event.schema === 1 && event.domain === PROCESS_DOMAIN
      && event.processId === row.process_id && event.auditSeq === index
      && row.audit_seq === index && row.prev_hash === previous
      && eventHash(PROCESS_DOMAIN, row.process_id, index, previous, row.event_json) === row.event_hash
      && (index !== 0 || (event.kind === 'initialize' && event.stateRevisionBefore === null
        && event.stateRevisionAfter === 0 && row.prev_hash === ZERO_HASH))
      && (index === 0 || event.stateRevisionBefore === previousRevision)
      && (index === 0 || (event.allowed
        ? event.stateRevisionAfter === previousRevision || event.stateRevisionAfter === previousRevision + 1
        : event.stateRevisionAfter === previousRevision))
      && event.snapshotAfter && event.snapshotAfter.revision === event.stateRevisionAfter
      && (layer === null || event.layer === layer);
    if (!valid) { failure = 'AUDIT_CORRUPT'; break; }
    layer = event.layer;
    previous = row.event_hash;
    previousRevision = event.stateRevisionAfter;
    lastGoodSnapshot = event.snapshotAfter;
  }

  if (rows.length === 0 || rows[0]?.audit_seq !== 0) {
    return { ok: false, code: 'CONTROLLER_CORRUPT', lastGoodSnapshot: null };
  }
  if (failure) return { ok: false, code: 'CONTROLLER_CORRUPT', lastGoodSnapshot };
  const snapshot = parseJson(state?.snapshot_json);
  const latest = rows.at(-1);
  const stateValid = state && snapshot && state.layer === layer
    && state.revision === lastGoodSnapshot?.revision
    && state.last_audit_seq === latest.audit_seq
    && state.last_audit_hash === latest.event_hash
    && canonicalJson(snapshot) === canonicalJson(lastGoodSnapshot);
  if (!stateValid) return { ok: false, code: 'CONTROLLER_CORRUPT', lastGoodSnapshot };
  return { ok: true, code: 'OK', layer, snapshot, auditSeq: latest.audit_seq, auditHash: latest.event_hash };
}

function processRead(db, processId) {
  const state = db.prepare('SELECT * FROM process_controller_state WHERE process_id=?').get(processId);
  const rows = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq').all(processId);
  if (!state && rows.length === 0) return { ok: false, code: 'PROCESS_NOT_FOUND', lastGoodSnapshot: null };
  return validateProcessRows(state, rows);
}

function pseFailure(code, extra = {}) {
  return { ok: false, allowed: false, code, audited: false, ...extra };
}

function artifactRow(db, path) {
  let row;
  try { row = db.prepare('SELECT * FROM qe_files WHERE path=?').get(path); }
  catch { return { ok: false, code: 'STORE_UNAVAILABLE' }; }
  if (!row) return { ok: false, code: 'PSE_ARTIFACT_NOT_FOUND' };
  if (row.encoding !== 'utf8' || typeof row.content !== 'string'
    || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > 1024 * 1024
    || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) {
    return { ok: false, code: 'PSE_ARTIFACT_CORRUPT' };
  }
  const bytes = Buffer.from(row.content, 'utf8');
  if (bytes.length !== row.size || sha256(bytes) !== row.sha256) {
    return { ok: false, code: 'PSE_ARTIFACT_CORRUPT' };
  }
  return { ok: true, path, text: row.content, bytes: new Uint8Array(bytes), sha256: row.sha256, mode: row.mode };
}

function preparationValue(row) {
  if (!row || typeof row.request_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.request_digest)
    || typeof row.receipt_text !== 'string' || !/^[0-9a-f]{64}$/.test(row.receipt_text)
    || typeof row.receipt_sha256 !== 'string' || row.receipt_sha256 !== sha256(row.receipt_text)
    || typeof row.payload_json !== 'string' || !Number.isSafeInteger(row.created_at) || row.created_at < 0
    || ((row.consumed_audit_seq === null) !== (row.consumed_audit_hash === null))
    || (row.consumed_audit_seq !== null && (!Number.isSafeInteger(row.consumed_audit_seq)
      || row.consumed_audit_seq < 0 || !/^[0-9a-f]{64}$/.test(String(row.consumed_audit_hash || ''))))) return null;
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { return null; }
  const payloadKeys = ['auditHash', 'auditSeq', 'checklistPath', 'checklistSha256', 'controllerIdentity',
    'layer', 'pairDigest', 'processId', 'schema', 'stateRevision', 'taskPath', 'taskSha256'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || canonicalJson(payload) !== row.payload_json
    || Object.keys(payload).sort().join('|') !== payloadKeys.join('|')
    || payload.schema !== 1 || typeof payload.processId !== 'string' || payload.layer !== 'goal'
    || payload.processId !== row.process_id
    || typeof payload.controllerIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(payload.controllerIdentity)
    || !Number.isSafeInteger(payload.stateRevision) || payload.stateRevision < 0
    || !Number.isSafeInteger(payload.auditSeq) || payload.auditSeq < 0
    || !/^[0-9a-f]{64}$/.test(String(payload.auditHash || ''))
    || typeof payload.taskPath !== 'string' || !/^[0-9a-f]{64}$/.test(String(payload.taskSha256 || ''))
    || typeof payload.checklistPath !== 'string' || !/^[0-9a-f]{64}$/.test(String(payload.checklistSha256 || ''))
    || !/^[0-9a-f]{64}$/.test(String(payload.pairDigest || ''))) return null;
  return { payload, receipt: row.receipt_text };
}

const PSE_BINDING_PAYLOAD_KEYS = ['controllerIdentity', 'immutableDigest', 'processId', 'schema', 'uuid'];
const PSE_LANES = ['pending', 'in-progress', 'on-hold', 'completed'];

function bindingValue(row) {
  if (!row || typeof row.process_id !== 'string'
    || typeof row.controller_identity !== 'string' || !/^[0-9a-f]{64}$/.test(row.controller_identity)
    || typeof row.token_text !== 'string' || !/^[0-9a-f]{64}$/.test(row.token_text)
    || typeof row.token_sha256 !== 'string' || row.token_sha256 !== sha256(row.token_text)
    || typeof row.original_request_id !== 'string' || row.original_request_id.length === 0
    || typeof row.original_request_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.original_request_digest)
    || typeof row.payload_json !== 'string' || typeof row.binding_digest !== 'string'
    || !/^[0-9a-f]{64}$/.test(row.binding_digest)
    || !Number.isSafeInteger(row.created_at) || row.created_at < 0) return null;
  const payload = parseJson(row.payload_json);
  if (!payload || !exactKeys(payload, PSE_BINDING_PAYLOAD_KEYS)
    || canonicalJson(payload) !== row.payload_json || payload.schema !== 1
    || payload.processId !== row.process_id || payload.controllerIdentity !== row.controller_identity
    || typeof payload.uuid !== 'string' || !/^[0-9a-f]{8}$/.test(payload.uuid)
    || typeof payload.immutableDigest !== 'string' || !/^[0-9a-f]{64}$/.test(payload.immutableDigest)) return null;
  const digest = sha256(canonicalJson(['qe-pse-task-binding-v1', row.process_id,
    row.controller_identity, row.token_sha256, payload]));
  if (digest !== row.binding_digest) return null;
  return { payload, token: row.token_text };
}

function pseCandidatePaths(uuid) {
  return PSE_LANES.flatMap(lane => [
    `.qe/tasks/${lane}/TASK_REQUEST_${uuid}.md`,
    `.qe/checklists/${lane}/VERIFY_CHECKLIST_${uuid}.md`,
  ]);
}

function callerUuid(taskPath, checklistPath) {
  const task = /^\.qe\/tasks\/(?:pending|in-progress|on-hold|completed)\/TASK_REQUEST_([0-9a-f]{8})\.md$/.exec(taskPath);
  const checklist = /^\.qe\/checklists\/(?:pending|in-progress|on-hold|completed)\/VERIFY_CHECKLIST_([0-9a-f]{8})\.md$/.exec(checklistPath);
  return task && checklist && task[1] === checklist[1] ? task[1] : null;
}

function uniquePsePair(db, uuid, taskPath, checklistPath, project, identify = null) {
  const paths = pseCandidatePaths(uuid);
  let present;
  try {
    present = db.prepare(`SELECT path FROM qe_files WHERE path IN (${paths.map(() => '?').join(',')}) ORDER BY path`)
      .all(...paths).map(row => row.path);
  } catch { return { ok: false, code: 'STORE_UNAVAILABLE' }; }
  const tasks = present.filter(path => path.includes('/tasks/'));
  const checklists = present.filter(path => path.includes('/checklists/'));
  if (tasks.length !== 1 || checklists.length !== 1
    || tasks[0] !== taskPath || checklists[0] !== checklistPath
    || callerUuid(taskPath, checklistPath) !== uuid) {
    return { ok: false, code: 'PSE_TASK_BINDING_MISMATCH' };
  }
  const task = artifactRow(db, taskPath); const checklist = artifactRow(db, checklistPath);
  if (!task.ok || !checklist.ok) {
    return { ok: false, code: task.code === 'STORE_UNAVAILABLE' || checklist.code === 'STORE_UNAVAILABLE'
      ? 'STORE_UNAVAILABLE' : 'PSE_TASK_BINDING_MISMATCH' };
  }
  const input = { taskPath: task.path, taskBytes: task.bytes,
    checklistPath: checklist.path, checklistBytes: checklist.bytes };
  const projected = project(input);
  if (!projected?.ok || projected.projection?.captureIdentity?.uuid !== uuid) {
    return { ok: false, code: 'PSE_TASK_BINDING_MISMATCH' };
  }
  let identified = null;
  if (identify) {
    identified = identify(input);
    if (!identified?.ok || identified.identity.captureIdentity.uuid !== uuid) {
      return { ok: false, code: 'PSE_TASK_BINDING_MISMATCH' };
    }
  }
  return { ok: true, task, checklist, projection: projected.projection, identified };
}

const HEX64 = /^[0-9a-f]{64}$/;
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIVS_BINDING_KEYS = ['schema', 'processId', 'controllerIdentity', 'pseProcessId',
  'pseBindingSha256', 'pseRevision', 'pseAuditSeq', 'pseAuditHash', 'planSlug', 'goalId',
  'goalAttempt', 'acceptanceHash', 'uuid', 'taskPath', 'checklistPath', 'immutableDigest'];

function sivsFailure(code, audited = false) {
  return { ok: false, allowed: false, code, audited };
}

function sivsBindingValue(row) {
  if (!row || !HEX64.test(String(row.controller_identity || ''))
    || !HEX64.test(String(row.token_text || '')) || row.token_sha256 !== sha256(row.token_text)
    || typeof row.original_request_id !== 'string' || !HEX64.test(String(row.original_request_digest || ''))
    || !HEX64.test(String(row.binding_digest || '')) || !Number.isSafeInteger(row.created_at)) return null;
  const payload = parseJson(row.payload_json);
  if (!payload || !exactKeys(payload, SIVS_BINDING_KEYS)
    || canonicalJson(payload) !== row.payload_json || payload.schema !== 1
    || payload.processId !== row.process_id || payload.controllerIdentity !== row.controller_identity
    || !HEX64.test(payload.pseBindingSha256) || !HEX64.test(payload.pseAuditHash)
    || !HEX64.test(payload.acceptanceHash) || !HEX64.test(payload.immutableDigest)
    || !Number.isSafeInteger(payload.pseRevision) || payload.pseRevision < 0
    || !Number.isSafeInteger(payload.pseAuditSeq) || payload.pseAuditSeq < 0
    || !Number.isSafeInteger(payload.goalAttempt) || payload.goalAttempt <= 0
    || !/^[0-9a-f]{8}$/.test(payload.uuid) || typeof payload.planSlug !== 'string'
    || typeof payload.goalId !== 'string' || typeof payload.taskPath !== 'string'
    || typeof payload.checklistPath !== 'string') return null;
  const digest = sha256(canonicalJson(['qe-sivs-task-binding-v1', row.process_id,
    row.controller_identity, row.token_sha256, payload]));
  return digest === row.binding_digest ? { payload, token: row.token_text, digest } : null;
}

function planGoal(db, planSlug, goalId, allowInactive = false) {
  const path = `.qe/planning/plans/${planSlug}/goals.json`;
  const row = artifactRow(db, path);
  if (!row.ok) return null;
  const doc = parseJson(row.text);
  const goal = Array.isArray(doc?.goals) ? doc.goals.find(item => item?.id === goalId) : null;
  if (!goal || (!allowInactive && goal.status !== 'active')
    || (allowInactive && !['pending', 'active', 'blocked', 'failed', 'complete'].includes(goal.status))
    || !Number.isSafeInteger(goal.attempts) || goal.attempts <= 0
    || goal.acceptance?.status !== 'defined' || !HEX64.test(String(goal.acceptance.hash || ''))) return null;
  return { goal, row };
}

function runValue(row, slug, goalId, role) {
  if (!row?.ok) return null;
  const run = parseJson(row.text);
  const keys = ['schema', 'goalId', 'role', 'attempt', 'invocationId', 'sessionId', 'verifier',
    'contractHash', 'runs', 'passed', 'executedAt', 'runId'];
  if (!run || !exactKeys(run, keys) || run.schema !== 1 || run.goalId !== goalId || run.role !== role
    || !Number.isSafeInteger(run.attempt) || run.attempt <= 0 || !FULL_UUID.test(run.invocationId)
    || !FULL_UUID.test(run.sessionId) || !HEX64.test(run.contractHash) || !HEX64.test(run.runId)
    || (role === 'implementation' ? run.verifier !== null : typeof run.verifier !== 'string' || !run.verifier.trim())
    || !Array.isArray(run.runs) || run.runs.length < 1 || typeof run.passed !== 'boolean'
    || typeof run.executedAt !== 'string') return null;
  for (const item of run.runs) {
    if (!exactKeys(item, ['command', 'exitCode', 'signal', 'passed', 'outputHash', 'executedAt'])
      || typeof item.command !== 'string' || !HEX64.test(String(item.outputHash || ''))
      || typeof item.passed !== 'boolean') return null;
  }
  const expected = sha256(canonicalJson(['qe-plan-run-v1', slug, goalId, role, run.attempt,
    run.invocationId, run.contractHash, run.sessionId, run.verifier, run.runs, run.executedAt]));
  return expected === run.runId && run.passed === run.runs.every(item => item.passed) ? { run, row } : null;
}

function validateProofRows(rows, kind, bindingSha, sealed = null) {
  const seqKey = kind === 'verification' ? 'verification_seq' : 'supervision_seq';
  const domain = `qe-sivs-${kind}-proof-v1`;
  const expectedColumns = kind === 'verification'
    ? ['process_id', 'verification_seq', 'request_id', 'request_digest', 'task_binding_sha256', 'proof_json', 'proof_digest', 'created_at']
    : ['process_id', 'supervision_seq', 'request_id', 'request_digest', 'task_binding_sha256', 'proof_json', 'proof_digest', 'created_at'];
  const proofKeys = kind === 'verification'
    ? ['schema', 'processId', 'taskBindingSha256', 'uuid', 'planSlug', 'goalId', 'goalAttempt',
      'acceptanceHash', 'pseProcessId', 'pseRevision', 'pseAuditSeq', 'pseAuditHash',
      'implementationRunId', 'implementationSessionId', 'verificationRunId',
      'verificationSessionId', 'verdict', 'reviewer', 'findingsDigest']
    : ['schema', 'processId', 'taskBindingSha256', 'uuid', 'planSlug', 'goalId', 'goalAttempt',
      'acceptanceHash', 'pseProcessId', 'pseRevision', 'pseAuditSeq', 'pseAuditHash',
      'verificationProofDigest', 'verificationRunId', 'verificationSessionId', 'verdict',
      'supervisor', 'sessionId', 'riskDigest'];
  const out = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]; const proof = parseJson(row.proof_json);
    if (Object.keys(row).join('|') !== expectedColumns.join('|') || row[seqKey] !== index + 1
      || row.task_binding_sha256 !== bindingSha || !HEX64.test(row.request_digest)
      || !HEX64.test(row.proof_digest) || !Number.isSafeInteger(row.created_at)
      || typeof row.process_id !== 'string' || typeof row.request_id !== 'string'
      || !proof || !exactKeys(proof, proofKeys) || canonicalJson(proof) !== row.proof_json
      || proof.schema !== 1 || proof.processId !== row.process_id
      || proof.taskBindingSha256 !== row.task_binding_sha256
      || !/^[0-9a-f]{8}$/.test(proof.uuid) || typeof proof.planSlug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(proof.planSlug)
      || !/^G[0-9]{3}$/.test(proof.goalId) || !Number.isSafeInteger(proof.goalAttempt) || proof.goalAttempt <= 0
      || !HEX64.test(proof.acceptanceHash) || typeof proof.pseProcessId !== 'string'
      || !Number.isSafeInteger(proof.pseRevision) || proof.pseRevision < 0
      || !Number.isSafeInteger(proof.pseAuditSeq) || proof.pseAuditSeq < 0 || !HEX64.test(proof.pseAuditHash)
      || (sealed && (proof.uuid !== sealed.uuid || proof.planSlug !== sealed.planSlug
        || proof.goalId !== sealed.goalId || proof.goalAttempt !== sealed.goalAttempt
        || proof.acceptanceHash !== sealed.acceptanceHash || proof.pseProcessId !== sealed.pseProcessId
        || proof.pseRevision !== sealed.pseRevision || proof.pseAuditSeq !== sealed.pseAuditSeq
        || proof.pseAuditHash !== sealed.pseAuditHash || proof.taskBindingSha256 !== bindingSha))
      || (kind === 'verification' && (!HEX64.test(proof.implementationRunId)
        || !FULL_UUID.test(proof.implementationSessionId) || !HEX64.test(proof.verificationRunId)
        || !FULL_UUID.test(proof.verificationSessionId) || !['PASS', 'FAIL'].includes(proof.verdict)
        || typeof proof.reviewer !== 'string' || proof.reviewer !== proof.reviewer.trim()
        || Buffer.byteLength(proof.reviewer) < 1 || Buffer.byteLength(proof.reviewer) > 128
        || proof.reviewer.includes('\0') || !HEX64.test(proof.findingsDigest)))
      || (kind === 'supervision' && (!HEX64.test(proof.verificationProofDigest)
        || !HEX64.test(proof.verificationRunId) || !FULL_UUID.test(proof.verificationSessionId)
        || !['PASS', 'WARN', 'FAIL'].includes(proof.verdict) || typeof proof.supervisor !== 'string'
        || proof.supervisor !== proof.supervisor.trim() || Buffer.byteLength(proof.supervisor) < 1
        || Buffer.byteLength(proof.supervisor) > 128 || proof.supervisor.includes('\0')
        || !FULL_UUID.test(proof.sessionId) || !HEX64.test(proof.riskDigest)))
      || row.proof_digest !== sha256(canonicalJson([domain, proof]))) return null;
    out.push({ row, proof });
  }
  return out;
}

function rejectionEvent(seq, code, processIdDigest = null, operationHint = null) {
  return { schema: 1, domain: REJECTION_DOMAIN, auditSeq: seq, code, processIdDigest, operationHint };
}

function validateRejectionChain(db) {
  const head = db.prepare('SELECT * FROM process_controller_rejection_head WHERE domain=?').get(REJECTION_DOMAIN);
  const rows = db.prepare('SELECT * FROM process_controller_rejection_audit ORDER BY audit_seq').all();
  if (!head || rows.length === 0 || rows.length !== head.latest_seq + 1
    || rows.at(-1).audit_seq !== head.latest_seq || rows.at(-1).event_hash !== head.latest_hash) return false;
  let previous = ZERO_HASH;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const event = parseJson(row.event_json);
    if (!event || Object.keys(event).join('|') !== 'schema|domain|auditSeq|code|processIdDigest|operationHint'
      || event.schema !== 1 || event.domain !== REJECTION_DOMAIN || event.auditSeq !== index
      || row.audit_seq !== index || row.prev_hash !== previous
      || eventHash(REJECTION_DOMAIN, REJECTION_DOMAIN, index, previous, row.event_json) !== row.event_hash) return false;
    previous = row.event_hash;
  }
  return true;
}

function ensureRejectionGenesis(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM process_controller_rejection_audit').get().n;
    const head = db.prepare('SELECT * FROM process_controller_rejection_head WHERE domain=?').get(REJECTION_DOMAIN);
    if (count === 0 && !head) {
      const eventJson = JSON.stringify(rejectionEvent(0, 'GENESIS'));
      const hash = eventHash(REJECTION_DOMAIN, REJECTION_DOMAIN, 0, ZERO_HASH, eventJson);
      db.prepare('INSERT INTO process_controller_rejection_audit VALUES(?,?,?,?,?)')
        .run(0, eventJson, ZERO_HASH, hash, Date.now());
      db.prepare('INSERT INTO process_controller_rejection_head VALUES(?,?,?)')
        .run(REJECTION_DOMAIN, 0, hash);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function makeEvent(input, seq, before, after, result, snapshotAfter) {
  return {
    schema: 1, domain: PROCESS_DOMAIN, processId: input.processId, layer: input.layer,
    auditSeq: seq, kind: input.operation === 'initialize' ? 'initialize' : 'decision',
    requestId: input.requestId, controllerIdentity: input.controllerIdentity,
    operation: input.operation, requestDigest: input.requestDigest,
    stateRevisionBefore: before, stateRevisionAfter: after, allowed: result.allowed === true,
    code: result.code, request: input.request, result, snapshotAfter,
  };
}

export function createProcessControllerStore(cwd, options = {}) {
  const db = openSqlite(cwd, { timeoutMs: options.timeoutMs ?? 5000,
    statementObserver: options.metricsStatementObserver });
  if (!db) return null;
  try {
    schema(db);
    ensureRejectionGenesis(db);
  } catch {
    closeSqlite(db);
    return null;
  }
  const fault = typeof options.faultInjector === 'function' ? options.faultInjector : () => {};

  function appendControllerRejection(code, details = {}) {
    try {
      db.exec('BEGIN IMMEDIATE');
      if (!validateRejectionChain(db)) { db.exec('ROLLBACK'); return { ok: false, code: 'CONTROLLER_AUDIT_CORRUPT', audited: false }; }
      const head = db.prepare('SELECT * FROM process_controller_rejection_head WHERE domain=?').get(REJECTION_DOMAIN);
      const seq = head.latest_seq + 1;
      const eventJson = JSON.stringify(rejectionEvent(seq, code, details.processIdDigest ?? null, details.operationHint ?? null));
      const hash = eventHash(REJECTION_DOMAIN, REJECTION_DOMAIN, seq, head.latest_hash, eventJson);
      db.prepare('INSERT INTO process_controller_rejection_audit VALUES(?,?,?,?,?)')
        .run(seq, eventJson, head.latest_hash, hash, Date.now());
      db.prepare('UPDATE process_controller_rejection_head SET latest_seq=?,latest_hash=? WHERE domain=?')
        .run(seq, hash, REJECTION_DOMAIN);
      db.exec('COMMIT');
      return { ok: false, code, audited: true };
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return { ok: false, code: 'STORE_UNAVAILABLE', audited: false };
    }
  }

  function apply(input, decide) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = processRead(db, input.processId);
      if (input.operation !== 'initialize' && current.code === 'PROCESS_NOT_FOUND') {
        db.exec('ROLLBACK');
        return appendControllerRejection(input.missingCode || 'PROCESS_NOT_FOUND', { processIdDigest: sha256(input.processId), operationHint: input.operation });
      }
      if (current.code === 'CONTROLLER_CORRUPT') {
        db.exec('ROLLBACK');
        const rejected = appendControllerRejection('CONTROLLER_CORRUPT', { processIdDigest: sha256(input.processId), operationHint: input.operation });
        return { ...rejected, lastGoodSnapshot: current.lastGoodSnapshot };
      }
      if (!current.ok && input.forceCode) {
        db.exec('ROLLBACK');
        return appendControllerRejection(input.forceCode, {
          processIdDigest: sha256(input.processId), operationHint: input.operation,
        });
      }
      if (current.ok && current.layer !== input.layer) {
        return appendProcessDecision(
          { ...input, layer: current.layer }, current,
          { allowed: false, code: 'LAYER_MISMATCH' }, current.snapshot, null,
        );
      }
      if (current.ok && input.forceCode) {
        return appendProcessDecision(
          { ...input, layer: current.layer }, current,
          { allowed: false, code: input.forceCode }, current.snapshot, null,
        );
      }

      if (current.ok && current.layer === 'sivs' && input.operation !== 'initialize') {
        const halted = isRemediationHalted(input.processId, current);
        if (halted.error) {
          return appendProcessDecision(input, current,
            { allowed: false, code: halted.error }, current.snapshot, input.requestId);
        }
        if (halted.halted) {
          return appendProcessDecision(input, current,
            { allowed: false, code: 'SIVS_REMEDIATION_HALTED' }, current.snapshot, input.requestId);
        }
      }

      if (current.ok) {
        const prior = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? AND request_key=?')
          .get(input.processId, input.requestId);
        if (prior) {
          const event = parseJson(prior.event_json);
          const same = event && event.controllerIdentity === input.controllerIdentity
            && event.operation === input.operation && event.requestDigest === input.requestDigest;
          if (same) { db.exec('COMMIT'); return { ...event.result, replayed: true, audited: true }; }
          return appendProcessDecision(input, current, { allowed: false, code: 'REQUEST_ID_CONFLICT' }, current.snapshot, null);
        }
      }

      if (input.operation === 'initialize' && !current.ok) {
        const snapshot = input.initialSnapshot;
        const result = { allowed: true, code: 'INITIALIZED', layer: input.layer, nextSnapshot: snapshot };
        return appendProcessDecision(input, null, result, snapshot, input.requestId);
      }
      if (input.operation === 'initialize') {
        return appendProcessDecision(input, current, { allowed: false, code: 'ALREADY_INITIALIZED' }, current.snapshot, input.requestId);
      }
      const result = decide(current.snapshot);
      const snapshot = result.allowed && result.nextSnapshot ? result.nextSnapshot : current.snapshot;
      return appendProcessDecision(input, current, result, snapshot, input.requestId);
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return { ok: false, allowed: false, code: 'STORE_UNAVAILABLE', audited: false };
    }
  }

  function appendProcessDecision(input, current, result, snapshot, requestKey) {
    const before = current?.snapshot?.revision ?? null;
    const seq = current ? current.auditSeq + 1 : 0;
    const previous = current?.auditHash ?? ZERO_HASH;
    const after = snapshot.revision;
    const event = makeEvent(input, seq, before, after, result, snapshot);
    const eventJson = canonicalJson(event);
    const hash = eventHash(PROCESS_DOMAIN, input.processId, seq, previous, eventJson);
    fault('before-write');
    const snapshotJson = canonicalJson(snapshot);
    if (current) {
      db.prepare(`UPDATE process_controller_state SET snapshot_json=?,revision=?,last_audit_seq=?,last_audit_hash=?
        WHERE process_id=? AND revision=? AND last_audit_seq=?`)
        .run(snapshotJson, after, seq, hash, input.processId, before, current.auditSeq);
    } else {
      db.prepare('INSERT INTO process_controller_state VALUES(?,?,?,?,?,?)')
        .run(input.processId, input.layer, snapshotJson, after, seq, hash);
    }
    fault('between-write-and-audit');
    db.prepare('INSERT INTO process_controller_audit VALUES(?,?,?,?,?,?,?)')
      .run(input.processId, seq, requestKey, eventJson, previous, hash, Date.now());
    if (input.layer === 'sivs') {
      db.prepare(`UPDATE process_controller_sivs_remediation_current
        SET process_revision=?,process_audit_hash=? WHERE process_id=?`)
        .run(after, hash, input.processId);
    }
    fault('before-commit');
    db.exec('COMMIT');
    fault('after-commit');
    return { ...result, replayed: false, audited: true, auditSeq: seq, auditHash: hash };
  }

  function preparePse(input, identify) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = processRead(db, input.processId);
      if (current.code === 'PROCESS_NOT_FOUND') { db.exec('ROLLBACK'); return pseFailure('PROCESS_NOT_FOUND'); }
      if (current.code === 'CONTROLLER_CORRUPT') {
        db.exec('ROLLBACK'); return pseFailure('CONTROLLER_CORRUPT', { lastGoodSnapshot: current.lastGoodSnapshot });
      }
      if (!current.ok || current.layer !== 'goal') { db.exec('ROLLBACK'); return pseFailure('LAYER_MISMATCH'); }

      const existing = db.prepare(`SELECT * FROM process_controller_pse_preparation
        WHERE process_id=? AND request_id=?`).get(input.processId, input.requestId);
      if (existing) {
        const value = preparationValue(existing);
        if (!value) { db.exec('ROLLBACK'); return pseFailure('PSE_PROVENANCE_INVALID'); }
        if (existing.request_digest !== input.requestDigest) {
          db.exec('ROLLBACK'); return pseFailure('REQUEST_ID_CONFLICT');
        }
        db.exec('COMMIT');
        return { ok: true, code: 'PSE_PREPARED', receipt: value.receipt, provenance: value.payload };
      }

      const task = artifactRow(db, input.taskPath);
      if (!task.ok) { db.exec('ROLLBACK'); return pseFailure(task.code); }
      const checklist = artifactRow(db, input.checklistPath);
      if (!checklist.ok) { db.exec('ROLLBACK'); return pseFailure(checklist.code); }
      const identified = identify({ taskPath: task.path, taskBytes: task.bytes,
        checklistPath: checklist.path, checklistBytes: checklist.bytes });
      if (!identified?.ok) { db.exec('ROLLBACK'); return pseFailure(identified?.code || 'PSE_ARTIFACT_CORRUPT'); }
      const payload = {
        schema: 1, processId: input.processId, layer: 'goal', controllerIdentity: input.controllerIdentity,
        stateRevision: current.snapshot.revision, auditSeq: current.auditSeq, auditHash: current.auditHash,
        taskPath: task.path, taskSha256: task.sha256,
        checklistPath: checklist.path, checklistSha256: checklist.sha256,
        pairDigest: identified.identity.pairDigest,
      };
      const payloadJson = canonicalJson(payload);
      let receipt = null;
      for (let attempt = 0; attempt < 3 && receipt === null; attempt += 1) {
        const candidate = randomBytes(32).toString('hex');
        try {
          db.prepare(`INSERT INTO process_controller_pse_preparation
            (process_id,request_id,request_digest,receipt_text,receipt_sha256,payload_json,created_at,consumed_audit_seq,consumed_audit_hash)
            VALUES(?,?,?,?,?,?,?,NULL,NULL)`)
            .run(input.processId, input.requestId, input.requestDigest, candidate, sha256(candidate), payloadJson, Date.now());
          receipt = candidate;
        } catch (error) {
          if (!/UNIQUE constraint failed.*receipt_text/i.test(String(error?.message || ''))) throw error;
        }
      }
      if (receipt === null) { db.exec('ROLLBACK'); return pseFailure('STORE_UNAVAILABLE'); }
      db.exec('COMMIT');
      return { ok: true, code: 'PSE_PREPARED', receipt, provenance: payload };
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return pseFailure('STORE_UNAVAILABLE');
    }
  }

  function psePublic(event, row, replayed) {
    return {
      ok: true, allowed: true, code: 'PSE_TRANSITION_COMMITTED', replayed, audited: true,
      auditSeq: row.audit_seq, auditHash: row.event_hash, consistency: event.result.consistency,
    };
  }

  function applyPse(input, decide) {
    let committed = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = processRead(db, input.processId);
      if (current.code === 'PROCESS_NOT_FOUND') { db.exec('ROLLBACK'); return pseFailure('PROCESS_NOT_FOUND'); }
      if (current.code === 'CONTROLLER_CORRUPT') {
        db.exec('ROLLBACK'); return pseFailure('CONTROLLER_CORRUPT', { lastGoodSnapshot: current.lastGoodSnapshot });
      }
      if (!current.ok || current.layer !== 'goal') { db.exec('ROLLBACK'); return pseFailure('LAYER_MISMATCH'); }

      const prior = db.prepare(`SELECT * FROM process_controller_audit
        WHERE process_id=? AND request_key=?`).get(input.processId, input.requestId);
      if (prior) {
        const event = parseJson(prior.event_json);
        const same = event && event.controllerIdentity === input.controllerIdentity
          && event.operation === input.operation && event.requestDigest === input.requestDigest;
        if (!same) { db.exec('ROLLBACK'); return pseFailure('REQUEST_ID_CONFLICT'); }
        db.exec('COMMIT'); return psePublic(event, prior, true);
      }

      const preparation = db.prepare(`SELECT * FROM process_controller_pse_preparation
        WHERE receipt_text=?`).get(input.receipt);
      const issued = preparationValue(preparation);
      if (!issued || preparation.process_id !== input.processId
        || issued.payload.controllerIdentity !== input.controllerIdentity) {
        db.exec('ROLLBACK'); return pseFailure('PSE_PROVENANCE_INVALID');
      }
      if (preparation.consumed_audit_seq !== null
        || issued.payload.stateRevision !== current.snapshot.revision
        || issued.payload.auditSeq !== current.auditSeq || issued.payload.auditHash !== current.auditHash) {
        db.exec('ROLLBACK'); return pseFailure('PSE_PROVENANCE_STALE');
      }
      const task = artifactRow(db, issued.payload.taskPath);
      const checklist = artifactRow(db, issued.payload.checklistPath);
      if (!task.ok || !checklist.ok || task.sha256 !== issued.payload.taskSha256
        || checklist.sha256 !== issued.payload.checklistSha256) {
        db.exec('ROLLBACK'); return pseFailure('PSE_PROVENANCE_STALE');
      }

      const decision = decide(current.snapshot, {
        taskPath: task.path, taskBytes: task.bytes,
        checklistPath: checklist.path, checklistBytes: checklist.bytes,
      });
      if (!decision?.allowed) { db.exec('ROLLBACK'); return pseFailure(decision?.code || 'INVALID_REQUEST'); }

      const destinations = [
        { source: task, path: input.taskPath, bytes: input.taskBytes },
        { source: checklist, path: input.checklistPath, bytes: input.checklistBytes },
      ];
      for (const item of destinations) {
        if (item.path !== item.source.path && db.prepare('SELECT 1 FROM qe_files WHERE path=?').get(item.path)) {
          db.exec('ROLLBACK'); return pseFailure('PSE_DESTINATION_COLLISION');
        }
      }

      const beforeRevision = current.snapshot.revision;
      const seq = current.auditSeq + 1;
      const snapshot = decision.nextSnapshot;
      const eventResult = { allowed: true, code: 'PSE_TRANSITION_COMMITTED',
        nextSnapshot: snapshot, consistency: decision.consistency };
      const event = makeEvent(input, seq, beforeRevision, snapshot.revision, eventResult, snapshot);
      const eventJson = canonicalJson(event);
      const hash = eventHash(PROCESS_DOMAIN, input.processId, seq, current.auditHash, eventJson);
      const now = Date.now();
      fault('before-artifact-write');
      for (let index = 0; index < destinations.length; index += 1) {
        const item = destinations[index];
        const bytes = Buffer.from(item.bytes);
        const text = bytes.toString('utf8');
        const digest = sha256(bytes);
        if (item.path === item.source.path) {
          const changed = db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
            WHERE path=? AND sha256=?`)
            .run(text, bytes.length, item.source.mode ?? 0o644, now, digest, now, item.path, item.source.sha256).changes;
          if (changed !== 1) throw new Error('artifact CAS');
        } else {
          db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
            VALUES(?,?,'utf8',?,?,?,?,?)`)
            .run(item.path, text, bytes.length, item.source.mode ?? 0o644, now, digest, now);
        }
        if (index === 0) fault('between-artifact-writes');
      }
      for (const item of destinations) {
        if (item.path !== item.source.path) {
          if (!db.prepare('SELECT 1 FROM qe_files WHERE path=?').get(item.path)) throw new Error('destination absent');
          const changed = db.prepare('DELETE FROM qe_files WHERE path=? AND sha256=?')
            .run(item.source.path, item.source.sha256).changes;
          if (changed !== 1) throw new Error('source CAS');
        }
      }
      fault('between-artifact-and-state');
      const stateChanged = db.prepare(`UPDATE process_controller_state
        SET snapshot_json=?,revision=?,last_audit_seq=?,last_audit_hash=?
        WHERE process_id=? AND revision=? AND last_audit_seq=? AND last_audit_hash=?`)
        .run(canonicalJson(snapshot), snapshot.revision, seq, hash, input.processId,
          beforeRevision, current.auditSeq, current.auditHash).changes;
      if (stateChanged !== 1) throw new Error('state CAS');
      fault('between-state-and-audit');
      db.prepare('INSERT INTO process_controller_audit VALUES(?,?,?,?,?,?,?)')
        .run(input.processId, seq, input.requestId, eventJson, current.auditHash, hash, now);
      const consumed = db.prepare(`UPDATE process_controller_pse_preparation
        SET consumed_audit_seq=?,consumed_audit_hash=?
        WHERE process_id=? AND request_id=? AND consumed_audit_seq IS NULL`)
        .run(seq, hash, preparation.process_id, preparation.request_id).changes;
      if (consumed !== 1) throw new Error('preparation CAS');
      fault('before-commit');
      db.exec('COMMIT'); committed = true;
      const row = { audit_seq: seq, event_hash: hash };
      fault('after-commit');
      return psePublic(event, row, false);
    } catch {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch {}
        return pseFailure('STORE_UNAVAILABLE');
      }
      try {
        const row = db.prepare(`SELECT * FROM process_controller_audit
          WHERE process_id=? AND request_key=?`).get(input.processId, input.requestId);
        const event = row && parseJson(row.event_json);
        if (event && event.controllerIdentity === input.controllerIdentity
          && event.operation === input.operation && event.requestDigest === input.requestDigest) {
          return psePublic(event, row, false);
        }
      } catch {}
      return pseFailure('STORE_UNAVAILABLE');
    }
  }

  function bindPse(input, project) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = processRead(db, input.processId);
      if (current.code === 'PROCESS_NOT_FOUND') { db.exec('ROLLBACK'); return pseFailure('PROCESS_NOT_FOUND'); }
      if (current.code === 'CONTROLLER_CORRUPT') {
        db.exec('ROLLBACK'); return pseFailure('CONTROLLER_CORRUPT', { lastGoodSnapshot: current.lastGoodSnapshot });
      }
      if (!current.ok || current.layer !== 'pse') { db.exec('ROLLBACK'); return pseFailure('LAYER_MISMATCH'); }

      const existing = db.prepare('SELECT * FROM process_controller_pse_task_binding WHERE process_id=?')
        .get(input.processId);
      let issued = null;
      if (existing) {
        issued = bindingValue(existing);
        if (!issued) { db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_CORRUPT'); }
        if (issued.payload.controllerIdentity !== input.controllerIdentity) {
          db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_MISMATCH');
        }
        if (existing.original_request_id === input.requestId) {
          if (existing.original_request_digest !== input.requestDigest) {
            db.exec('ROLLBACK'); return pseFailure('REQUEST_ID_CONFLICT');
          }
          db.exec('COMMIT');
          return { ok: true, code: 'PSE_TASK_BOUND', binding: issued.token,
            identity: { uuid: issued.payload.uuid, immutableDigest: issued.payload.immutableDigest }, replayed: true };
        }
      }

      const uuid = callerUuid(input.taskPath, input.checklistPath);
      if (!uuid) { db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_MISMATCH'); }
      const pair = uniquePsePair(db, uuid, input.taskPath, input.checklistPath, project);
      if (!pair.ok) { db.exec('ROLLBACK'); return pseFailure(pair.code); }
      const immutableDigest = pair.projection.immutableDigest;
      if (issued) {
        if (issued.payload.uuid !== uuid || issued.payload.immutableDigest !== immutableDigest) {
          db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_CONFLICT');
        }
        db.exec('COMMIT');
        return { ok: true, code: 'PSE_TASK_BOUND', binding: issued.token,
          identity: { uuid, immutableDigest }, replayed: true };
      }

      const payload = { schema: 1, processId: input.processId,
        controllerIdentity: input.controllerIdentity, uuid, immutableDigest };
      const payloadJson = canonicalJson(payload);
      let token = null;
      for (let attempt = 0; attempt < 3 && token === null; attempt += 1) {
        const candidate = randomBytes(32).toString('hex'); const tokenSha256 = sha256(candidate);
        const bindingDigest = sha256(canonicalJson(['qe-pse-task-binding-v1', input.processId,
          input.controllerIdentity, tokenSha256, payload]));
        try {
          db.prepare(`INSERT INTO process_controller_pse_task_binding
            (process_id,controller_identity,token_text,token_sha256,original_request_id,
             original_request_digest,payload_json,binding_digest,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(input.processId, input.controllerIdentity, candidate,
            tokenSha256, input.requestId, input.requestDigest, payloadJson, bindingDigest, Date.now());
          token = candidate;
        } catch (error) {
          if (!/UNIQUE constraint failed.*token_sha256/i.test(String(error?.message || ''))) throw error;
        }
      }
      if (token === null) { db.exec('ROLLBACK'); return pseFailure('STORE_UNAVAILABLE'); }
      db.exec('COMMIT');
      return { ok: true, code: 'PSE_TASK_BOUND', binding: token,
        identity: { uuid, immutableDigest }, replayed: false };
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return pseFailure('STORE_UNAVAILABLE');
    }
  }

  function stagePublic(event, row, replayed) {
    return { ok: true, allowed: true, code: 'PSE_STAGE_TRANSITION_COMMITTED',
      action: event.result.action, to: event.result.to, replayed, audited: true,
      auditSeq: row.audit_seq, auditHash: row.event_hash,
      evidenceDigest: event.result.evidenceDigest };
  }

  function applyPseStage(input, helpers) {
    let committed = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      const current = processRead(db, input.processId);
      if (current.code === 'PROCESS_NOT_FOUND') { db.exec('ROLLBACK'); return pseFailure('PROCESS_NOT_FOUND'); }
      if (current.code === 'CONTROLLER_CORRUPT') {
        db.exec('ROLLBACK'); return pseFailure('CONTROLLER_CORRUPT', { lastGoodSnapshot: current.lastGoodSnapshot });
      }
      if (!current.ok || current.layer !== 'pse') { db.exec('ROLLBACK'); return pseFailure('LAYER_MISMATCH'); }

      const tokenSha256 = sha256(input.binding);
      const row = db.prepare('SELECT * FROM process_controller_pse_task_binding WHERE token_sha256=?')
        .get(tokenSha256);
      if (!row) { db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_INVALID'); }
      const binding = bindingValue(row);
      if (!binding) { db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_CORRUPT'); }
      if (binding.token !== input.binding || row.process_id !== input.processId
        || binding.payload.controllerIdentity !== input.controllerIdentity) {
        db.exec('ROLLBACK'); return pseFailure('PSE_TASK_BINDING_MISMATCH');
      }

      const pair = uniquePsePair(db, binding.payload.uuid, input.taskPath, input.checklistPath,
        helpers.project, helpers.identify);
      if (!pair.ok || pair.projection.immutableDigest !== binding.payload.immutableDigest) {
        db.exec('ROLLBACK'); return pseFailure(pair.code === 'STORE_UNAVAILABLE'
          ? 'STORE_UNAVAILABLE' : 'PSE_TASK_BINDING_MISMATCH');
      }
      const evidenceProjection = { taskPath: pair.task.path, taskSha256: pair.task.sha256,
        checklistPath: pair.checklist.path, checklistSha256: pair.checklist.sha256,
        pairDigest: pair.identified.identity.pairDigest,
        immutableDigest: pair.projection.immutableDigest };
      const evidenceDigest = sha256(canonicalJson(['qe-pse-stage-evidence-v1', evidenceProjection]));
      const requestDigest = sha256(canonicalJson(['qe-pse-stage-request-v1', input.controllerIdentity,
        'pse-stage-transition', input.processId, input.requestId, tokenSha256, input.action,
        input.expectedRevision, evidenceProjection]));

      const prior = db.prepare(`SELECT * FROM process_controller_audit
        WHERE process_id=? AND request_key=?`).get(input.processId, input.requestId);
      if (prior) {
        const event = parseJson(prior.event_json);
        const priorEvidence = event?.request?.evidenceDigest;
        if (event?.operation === 'pse-stage-transition' && priorEvidence !== evidenceDigest) {
          db.exec('ROLLBACK'); return pseFailure('PSE_STAGE_EVIDENCE_STALE');
        }
        if (!event || event.controllerIdentity !== input.controllerIdentity
          || event.operation !== 'pse-stage-transition' || event.requestDigest !== requestDigest) {
          db.exec('ROLLBACK'); return pseFailure('REQUEST_ID_CONFLICT');
        }
        if (prior.audit_seq !== current.auditSeq || prior.event_hash !== current.auditHash) {
          db.exec('ROLLBACK'); return pseFailure('PSE_STAGE_REPLAY_STALE');
        }
        db.exec('COMMIT'); return stagePublic(event, prior, true);
      }

      const decision = helpers.decide(current.snapshot);
      if (!decision?.allowed) { db.exec('ROLLBACK'); return pseFailure(decision?.code || 'INVALID_REQUEST'); }
      const snapshot = decision.nextSnapshot;
      const seq = current.auditSeq + 1; const now = Date.now();
      const auditRequest = { processId: input.processId, requestId: input.requestId,
        action: input.action, expectedRevision: input.expectedRevision, bindingSha256: tokenSha256,
        evidenceProjection, evidenceDigest };
      const eventInput = { processId: input.processId, requestId: input.requestId, layer: 'pse',
        controllerIdentity: input.controllerIdentity, operation: 'pse-stage-transition',
        requestDigest, request: auditRequest };
      const eventResult = { allowed: true, code: 'PSE_STAGE_TRANSITION_COMMITTED',
        nextSnapshot: snapshot, action: input.action, to: decision.to, evidenceDigest };
      const event = makeEvent(eventInput, seq, current.snapshot.revision, snapshot.revision,
        eventResult, snapshot);
      const eventJson = canonicalJson(event);
      const hash = eventHash(PROCESS_DOMAIN, input.processId, seq, current.auditHash, eventJson);
      fault('before-state');
      const changed = db.prepare(`UPDATE process_controller_state
        SET snapshot_json=?,revision=?,last_audit_seq=?,last_audit_hash=?
        WHERE process_id=? AND revision=? AND last_audit_seq=? AND last_audit_hash=?`)
        .run(canonicalJson(snapshot), snapshot.revision, seq, hash, input.processId,
          current.snapshot.revision, current.auditSeq, current.auditHash).changes;
      if (changed !== 1) throw new Error('state CAS');
      fault('between-state-and-audit');
      db.prepare('INSERT INTO process_controller_audit VALUES(?,?,?,?,?,?,?)')
        .run(input.processId, seq, input.requestId, eventJson, current.auditHash, hash, now);
      fault('before-commit');
      db.exec('COMMIT'); committed = true;
      const committedRow = { audit_seq: seq, event_hash: hash };
      fault('after-commit');
      return stagePublic(event, committedRow, false);
    } catch {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch {}
        return pseFailure('STORE_UNAVAILABLE');
      }
      try {
        const row = db.prepare(`SELECT * FROM process_controller_audit
          WHERE process_id=? AND request_key=?`).get(input.processId, input.requestId);
        const event = row && parseJson(row.event_json);
        if (event?.controllerIdentity === input.controllerIdentity
          && event.operation === 'pse-stage-transition') return stagePublic(event, row, false);
      } catch {}
      return pseFailure('STORE_UNAVAILABLE');
    }
  }

  function sivsReject(code, input) {
    try {
      if (!validateRejectionChain(db)) {
        db.exec('ROLLBACK'); return sivsFailure('CONTROLLER_AUDIT_CORRUPT', false);
      }
      const head = db.prepare('SELECT * FROM process_controller_rejection_head WHERE domain=?').get(REJECTION_DOMAIN);
      const seq = head.latest_seq + 1;
      const eventJson = JSON.stringify(rejectionEvent(seq, code,
        input?.processId ? sha256(input.processId) : null, input?.operation || 'sivs-adapter'));
      const hash = eventHash(REJECTION_DOMAIN, REJECTION_DOMAIN, seq, head.latest_hash, eventJson);
      fault('before-rejection-audit');
      db.prepare('INSERT INTO process_controller_rejection_audit VALUES(?,?,?,?,?)')
        .run(seq, eventJson, head.latest_hash, hash, Date.now());
      db.prepare('UPDATE process_controller_rejection_head SET latest_seq=?,latest_hash=? WHERE domain=?')
        .run(seq, hash, REJECTION_DOMAIN);
      fault('before-rejection-commit');
      db.exec('COMMIT');
      return sivsFailure(code, true);
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return sivsFailure('STORE_UNAVAILABLE', false);
    }
  }

  function requireSivsProcess(input) {
    const current = processRead(db, input.processId);
    if (current.code === 'PROCESS_NOT_FOUND') return { error: 'PROCESS_NOT_FOUND' };
    if (current.code === 'CONTROLLER_CORRUPT') return { error: 'CONTROLLER_CORRUPT' };
    if (!current.ok || current.layer !== 'sivs') return { error: 'LAYER_MISMATCH' };
    return { current };
  }

  function requireSivsBinding(input, helpers, fresh = true) {
    const tokenSha = sha256(input.binding);
    const row = db.prepare('SELECT * FROM process_controller_sivs_task_binding WHERE token_sha256=?').get(tokenSha);
    if (!row) return { error: 'SIVS_TASK_BINDING_INVALID' };
    const issued = sivsBindingValue(row);
    if (!issued) return { error: 'SIVS_TASK_BINDING_CORRUPT' };
    if (issued.token !== input.binding || row.process_id !== input.processId
      || issued.payload.controllerIdentity !== input.controllerIdentity) return { error: 'SIVS_TASK_BINDING_MISMATCH' };
    if (!fresh) return { row, issued, tokenSha };
    const pse = processRead(db, issued.payload.pseProcessId);
    if (!pse.ok || pse.layer !== 'pse' || pse.snapshot.state !== 'execute'
      || pse.snapshot.revision !== issued.payload.pseRevision || pse.auditSeq !== issued.payload.pseAuditSeq
      || pse.auditHash !== issued.payload.pseAuditHash) return { error: 'SIVS_TASK_BINDING_MISMATCH' };
    const pseRow = db.prepare('SELECT * FROM process_controller_pse_task_binding WHERE process_id=?')
      .get(issued.payload.pseProcessId);
    const pseBinding = bindingValue(pseRow);
    if (!pseBinding || pseRow.token_sha256 !== issued.payload.pseBindingSha256
      || pseBinding.payload.uuid !== issued.payload.uuid
      || pseBinding.payload.immutableDigest !== issued.payload.immutableDigest) return { error: 'SIVS_TASK_BINDING_MISMATCH' };
    const goal = planGoal(db, issued.payload.planSlug, issued.payload.goalId, fresh === 'completion');
    if (!goal || goal.goal.attempts !== issued.payload.goalAttempt
      || goal.goal.acceptance.hash !== issued.payload.acceptanceHash) return { error: 'SIVS_TASK_BINDING_MISMATCH' };
    const pair = uniquePsePair(db, issued.payload.uuid, issued.payload.taskPath,
      issued.payload.checklistPath, helpers.project, helpers.identify);
    if (!pair.ok || pair.projection.immutableDigest !== issued.payload.immutableDigest) {
      return { error: pair.code === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : 'SIVS_TASK_BINDING_MISMATCH' };
    }
    return { row, issued, tokenSha, pse, goal, pair };
  }

  function bindSivs(input, helpers) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const process = requireSivsProcess(input);
      if (process.error) return sivsReject(process.error, input);
      const existing = db.prepare('SELECT * FROM process_controller_sivs_task_binding WHERE process_id=?')
        .get(input.processId);
      if (existing) {
        const issued = sivsBindingValue(existing);
        if (!issued) return sivsReject('SIVS_TASK_BINDING_CORRUPT', input);
        if (issued.payload.controllerIdentity !== input.controllerIdentity) return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
        if (existing.original_request_id === input.requestId) {
          if (existing.original_request_digest !== input.requestDigest) return sivsReject('REQUEST_ID_CONFLICT', input);
          db.exec('COMMIT');
          return { ok: true, code: 'SIVS_TASK_BOUND', binding: issued.token,
            task: { uuid: issued.payload.uuid, planSlug: issued.payload.planSlug,
              goalId: issued.payload.goalId, acceptanceHash: issued.payload.acceptanceHash }, replayed: true };
        }
      }
      const pseRow = db.prepare('SELECT * FROM process_controller_pse_task_binding WHERE token_sha256=?')
        .get(sha256(input.pseBinding));
      const pseBinding = bindingValue(pseRow);
      if (!pseBinding || pseRow.process_id !== input.pseProcessId || pseBinding.token !== input.pseBinding) {
        return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      }
      const pse = processRead(db, input.pseProcessId);
      if (!pse.ok || pse.layer !== 'pse' || pse.snapshot.state !== 'execute') {
        return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      }
      const uuid = callerUuid(input.taskPath, input.checklistPath);
      const pair = uuid && uniquePsePair(db, uuid, input.taskPath, input.checklistPath,
        helpers.project, helpers.identify);
      if (!uuid || !pair?.ok || pseBinding.payload.uuid !== uuid
        || pseBinding.payload.immutableDigest !== pair.projection.immutableDigest) {
        return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      }
      const goal = planGoal(db, input.planSlug, input.goalId);
      if (!goal) return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      const payload = { schema: 1, processId: input.processId, controllerIdentity: input.controllerIdentity,
        pseProcessId: input.pseProcessId, pseBindingSha256: sha256(input.pseBinding),
        pseRevision: pse.snapshot.revision, pseAuditSeq: pse.auditSeq, pseAuditHash: pse.auditHash,
        planSlug: input.planSlug, goalId: input.goalId, goalAttempt: goal.goal.attempts,
        acceptanceHash: goal.goal.acceptance.hash, uuid, taskPath: input.taskPath,
        checklistPath: input.checklistPath, immutableDigest: pair.projection.immutableDigest };
      if (existing) {
        const issued = sivsBindingValue(existing);
        if (canonicalJson(issued.payload) !== canonicalJson(payload)) return sivsReject('SIVS_TASK_BINDING_CONFLICT', input);
        db.exec('COMMIT');
        return { ok: true, code: 'SIVS_TASK_BOUND', binding: issued.token,
          task: { uuid, planSlug: input.planSlug, goalId: input.goalId,
            acceptanceHash: goal.goal.acceptance.hash }, replayed: true };
      }
      const token = randomBytes(32).toString('hex'); const tokenSha = sha256(token);
      const digest = sha256(canonicalJson(['qe-sivs-task-binding-v1', input.processId,
        input.controllerIdentity, tokenSha, payload]));
      db.prepare(`INSERT INTO process_controller_sivs_task_binding
        (process_id,controller_identity,token_text,token_sha256,original_request_id,
         original_request_digest,payload_json,binding_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(input.processId, input.controllerIdentity, token, tokenSha, input.requestId,
          input.requestDigest, canonicalJson(payload), digest, Date.now());
      db.exec('COMMIT');
      return { ok: true, code: 'SIVS_TASK_BOUND', binding: token,
        task: { uuid, planSlug: input.planSlug, goalId: input.goalId,
          acceptanceHash: goal.goal.acceptance.hash }, replayed: false };
    } catch { return sivsReject('STORE_UNAVAILABLE', input); }
  }

  function proofRows(kind, processId) {
    const table = kind === 'verification' ? 'process_controller_sivs_verification_proof'
      : 'process_controller_sivs_supervision_proof';
    const seq = kind === 'verification' ? 'verification_seq' : 'supervision_seq';
    return db.prepare(`SELECT * FROM ${table} WHERE process_id=? ORDER BY ${seq}`).all(processId);
  }

  function recordSivsVerification(input, helpers) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const process = requireSivsProcess(input); if (process.error) return sivsReject(process.error, input);
      const bound = requireSivsBinding(input, helpers, false); if (bound.error) return sivsReject(bound.error, input);
      const validated = validateProofRows(proofRows('verification', input.processId), 'verification', bound.tokenSha, bound.issued.payload);
      if (!validated) return sivsReject('SIVS_VERIFICATION_PROOF_CORRUPT', input);
      const prior = validated.find(item => item.row.request_id === input.requestId);
      if (prior) {
        if (prior.row.request_digest !== input.requestDigest) return sivsReject('REQUEST_ID_CONFLICT', input);
        db.exec('COMMIT'); return { ok: true, code: 'SIVS_VERIFICATION_RECORDED',
          proofRef: `qe-sivs-verification:${prior.row.proof_digest}`, verdict: prior.proof.verdict,
          sequence: prior.row.verification_seq, replayed: true };
      }
      if (process.current.snapshot.state !== 'verify') return sivsReject('SIVS_PROOF_STATE_DENIED', input);
      const fresh = requireSivsBinding(input, helpers, true); if (fresh.error) return sivsReject(fresh.error, input);
      const p = bound.issued.payload; const a = input.assertion;
      const implRow = artifactRow(db, `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.implementation-run.json`);
      const verifyRow = artifactRow(db, `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.verification-run.json`);
      const impl = runValue(implRow, p.planSlug, p.goalId, 'implementation');
      const verify = runValue(verifyRow, p.planSlug, p.goalId, 'verification');
      if (!impl) return sivsReject(implRow.code === 'PSE_ARTIFACT_NOT_FOUND'
        ? 'SIVS_IMPLEMENTATION_PROOF_MISSING' : 'SIVS_IMPLEMENTATION_PROOF_CORRUPT', input);
      if (!impl.run.passed) return sivsReject('SIVS_IMPLEMENTATION_FAILED', input);
      if (!verify) return sivsReject(verifyRow.code === 'PSE_ARTIFACT_NOT_FOUND'
        ? 'SIVS_VERIFICATION_PROOF_MISSING' : 'SIVS_VERIFICATION_PROOF_CORRUPT', input);
      if (impl.run.sessionId === verify.run.sessionId || a.sessionId !== verify.run.sessionId) return sivsReject('SIVS_PROOF_SESSION_CONFLICT', input);
      if (a.uuid !== p.uuid || a.planSlug !== p.planSlug || a.goalId !== p.goalId
        || a.goalAttempt !== p.goalAttempt || a.acceptanceHash !== p.acceptanceHash
        || a.implementationRunId !== impl.run.runId || a.verificationRunId !== verify.run.runId
        || a.reviewer !== verify.run.verifier || a.verdict !== (verify.run.passed ? 'PASS' : 'FAIL')) {
        return sivsReject('SIVS_VERIFICATION_ASSERTION_MISMATCH', input);
      }
      const proof = { schema: 1, processId: input.processId, taskBindingSha256: bound.tokenSha,
        uuid: p.uuid, planSlug: p.planSlug, goalId: p.goalId, goalAttempt: p.goalAttempt,
        acceptanceHash: p.acceptanceHash, pseProcessId: p.pseProcessId, pseRevision: p.pseRevision,
        pseAuditSeq: p.pseAuditSeq, pseAuditHash: p.pseAuditHash,
        implementationRunId: impl.run.runId, implementationSessionId: impl.run.sessionId,
        verificationRunId: verify.run.runId, verificationSessionId: verify.run.sessionId,
        verdict: a.verdict, reviewer: a.reviewer, findingsDigest: a.findingsDigest };
      const digest = sha256(canonicalJson(['qe-sivs-verification-proof-v1', proof])); const seq = validated.length + 1;
      db.prepare(`INSERT INTO process_controller_sivs_verification_proof
        VALUES(?,?,?,?,?,?,?,?)`).run(input.processId, seq, input.requestId, input.requestDigest,
          bound.tokenSha, canonicalJson(proof), digest, Date.now());
      db.exec('COMMIT');
      return { ok: true, code: 'SIVS_VERIFICATION_RECORDED', proofRef: `qe-sivs-verification:${digest}`,
        verdict: a.verdict, sequence: seq, replayed: false };
    } catch { return sivsReject('STORE_UNAVAILABLE', input); }
  }

  function recordSivsSupervision(input, helpers) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const process = requireSivsProcess(input); if (process.error) return sivsReject(process.error, input);
      const bound = requireSivsBinding(input, helpers, false); if (bound.error) return sivsReject(bound.error, input);
      const validated = validateProofRows(proofRows('supervision', input.processId), 'supervision', bound.tokenSha, bound.issued.payload);
      if (!validated) return sivsReject('SIVS_SUPERVISION_PROOF_CORRUPT', input);
      const prior = validated.find(item => item.row.request_id === input.requestId);
      if (prior) {
        if (prior.row.request_digest !== input.requestDigest) return sivsReject('REQUEST_ID_CONFLICT', input);
        db.exec('COMMIT'); return { ok: true, code: 'SIVS_SUPERVISION_RECORDED',
          proofRef: `qe-sivs-supervision:${prior.row.proof_digest}`, verdict: prior.proof.verdict,
          sequence: prior.row.supervision_seq, replayed: true };
      }
      if (process.current.snapshot.state !== 'supervise') return sivsReject('SIVS_PROOF_STATE_DENIED', input);
      const fresh = requireSivsBinding(input, helpers, true); if (fresh.error) return sivsReject(fresh.error, input);
      const p = bound.issued.payload; const a = input.assertion;
      const verifications = validateProofRows(proofRows('verification', input.processId), 'verification', bound.tokenSha, bound.issued.payload);
      if (!verifications) return sivsReject('SIVS_VERIFICATION_PROOF_CORRUPT', input);
      const verification = verifications.at(-1);
      if (!verification || verification.proof.verdict !== 'PASS'
        || verification.row.proof_digest !== a.verificationProofDigest) return sivsReject('SIVS_VERIFICATION_PROOF_MISSING', input);
      const attested = attestVerification(bound, verification);
      if (!attested.ok) return sivsReject(attested.code, input);
      if (a.uuid !== p.uuid || a.planSlug !== p.planSlug || a.goalId !== p.goalId
        || a.goalAttempt !== p.goalAttempt || a.acceptanceHash !== p.acceptanceHash
        || !['PASS', 'WARN', 'FAIL'].includes(a.verdict) || typeof a.supervisor !== 'string'
        || a.supervisor !== a.supervisor.trim() || Buffer.byteLength(a.supervisor) < 1
        || Buffer.byteLength(a.supervisor) > 128 || a.supervisor.includes('\0')
        || !FULL_UUID.test(a.sessionId) || !HEX64.test(a.riskDigest)) {
        return sivsReject('SIVS_SUPERVISION_ASSERTION_MISMATCH', input);
      }
      if ([verification.proof.implementationSessionId, verification.proof.verificationSessionId].includes(a.sessionId)) {
        return sivsReject('SIVS_PROOF_SESSION_CONFLICT', input);
      }
      const proof = { schema: 1, processId: input.processId, taskBindingSha256: bound.tokenSha,
        uuid: p.uuid, planSlug: p.planSlug, goalId: p.goalId, goalAttempt: p.goalAttempt,
        acceptanceHash: p.acceptanceHash, pseProcessId: p.pseProcessId, pseRevision: p.pseRevision,
        pseAuditSeq: p.pseAuditSeq, pseAuditHash: p.pseAuditHash,
        verificationProofDigest: verification.row.proof_digest,
        verificationRunId: verification.proof.verificationRunId,
        verificationSessionId: verification.proof.verificationSessionId,
        verdict: a.verdict, supervisor: a.supervisor, sessionId: a.sessionId, riskDigest: a.riskDigest };
      const digest = sha256(canonicalJson(['qe-sivs-supervision-proof-v1', proof])); const seq = validated.length + 1;
      db.prepare('INSERT INTO process_controller_sivs_supervision_proof VALUES(?,?,?,?,?,?,?,?)')
        .run(input.processId, seq, input.requestId, input.requestDigest, bound.tokenSha,
          canonicalJson(proof), digest, Date.now());
      db.exec('COMMIT');
      return { ok: true, code: 'SIVS_SUPERVISION_RECORDED', proofRef: `qe-sivs-supervision:${digest}`,
        verdict: a.verdict, sequence: seq, replayed: false };
    } catch { return sivsReject('STORE_UNAVAILABLE', input); }
  }

  function attestVerification(bound, item) {
    const p = bound.issued.payload;
    const implRow = artifactRow(db, `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.implementation-run.json`);
    const verifyRow = artifactRow(db, `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.verification-run.json`);
    if (!implRow.ok) return { code: implRow.code === 'PSE_ARTIFACT_NOT_FOUND'
      ? 'SIVS_IMPLEMENTATION_PROOF_MISSING' : 'SIVS_IMPLEMENTATION_PROOF_CORRUPT' };
    const impl = runValue(implRow, p.planSlug, p.goalId, 'implementation');
    if (!impl || impl.run.attempt !== p.goalAttempt || impl.run.contractHash !== p.acceptanceHash) return { code: 'SIVS_IMPLEMENTATION_PROOF_CORRUPT' };
    if (!impl.run.passed) return { code: 'SIVS_IMPLEMENTATION_FAILED' };
    if (!verifyRow.ok) return { code: verifyRow.code === 'PSE_ARTIFACT_NOT_FOUND'
      ? 'SIVS_VERIFICATION_PROOF_MISSING' : 'SIVS_VERIFICATION_PROOF_CORRUPT' };
    const verify = runValue(verifyRow, p.planSlug, p.goalId, 'verification');
    if (!verify || verify.run.attempt !== p.goalAttempt || verify.run.contractHash !== p.acceptanceHash) return { code: 'SIVS_VERIFICATION_PROOF_CORRUPT' };
    const proof = item.proof;
    const valid = proof.implementationRunId === impl.run.runId
      && proof.implementationSessionId === impl.run.sessionId
      && proof.verificationRunId === verify.run.runId
      && proof.verificationSessionId === verify.run.sessionId
      && proof.reviewer === verify.run.verifier
      && proof.verdict === (verify.run.passed ? 'PASS' : 'FAIL')
      && impl.run.sessionId !== verify.run.sessionId;
    return valid ? { ok: true } : { code: 'SIVS_VERIFICATION_PROOF_CORRUPT' };
  }

  function sivsProofProjection(input, bound, current) {
    const p = bound.issued.payload; const state = current.snapshot.state;
    const none = { kind: 'none', status: 'not-required', rowSha256: null, sequence: null,
      proofDigest: null, runId: null, sessionId: null, verdict: null };
    if (state === 'spec' || (state === 'blocked' && ['spec', 'implement'].includes(current.snapshot.resumeState))) return none;
    const target = input.action === 'remediate' ? 'remediate'
      : state === 'blocked' ? current.snapshot.resumeState : state;
    if (target === 'implement') {
      const path = `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.implementation-run.json`;
      const row = db.prepare('SELECT path,encoding,size,mode,mtime_ms,sha256,migrated_at,content FROM qe_files WHERE path=?').get(path);
      if (!row) return { ...none, kind: 'implementation', status: 'missing' };
      let rowSha256 = null;
      try { const raw = canonicalJson(row); if (Buffer.byteLength(raw) <= 65536) rowSha256 = sha256(canonicalJson(['qe-sivs-proof-row-v1', 'implementation', row])); } catch {}
      const run = runValue(artifactRow(db, path), p.planSlug, p.goalId, 'implementation');
      if (!run || run.run.attempt !== p.goalAttempt || run.run.contractHash !== p.acceptanceHash) {
        return { ...none, kind: 'implementation', status: 'corrupt', rowSha256 };
      }
      return { kind: 'implementation', status: run.run.passed ? 'pass' : 'failed', rowSha256,
        sequence: null, proofDigest: row.sha256, runId: run.run.runId,
        sessionId: run.run.sessionId, verdict: run.run.passed ? 'PASS' : 'FAIL' };
    }
    const verification = validateProofRows(proofRows('verification', input.processId), 'verification', bound.tokenSha, bound.issued.payload);
    const supervision = validateProofRows(proofRows('supervision', input.processId), 'supervision', bound.tokenSha, bound.issued.payload);
    if (target === 'verify') {
      if (!verification) return { ...none, kind: 'verification', status: 'corrupt' };
      const item = verification.at(-1);
      if (!item) return { ...none, kind: 'verification', status: 'missing' };
      if (!attestVerification(bound, item).ok) return { ...none, kind: 'verification', status: 'corrupt' };
      const rowSha256 = sha256(canonicalJson(['qe-sivs-proof-row-v1', 'verification', item.row]));
      return { kind: 'verification', status: item.proof.verdict.toLowerCase(), rowSha256,
        sequence: item.row.verification_seq, proofDigest: item.row.proof_digest,
        runId: item.proof.verificationRunId, sessionId: item.proof.verificationSessionId,
        verdict: item.proof.verdict };
    }
    if (target === 'supervise') {
      if (!supervision) return { ...none, kind: 'supervision', status: 'corrupt' };
      const item = supervision.at(-1);
      if (!item) return { ...none, kind: 'supervision', status: 'missing' };
      const latest = verification?.at(-1);
      if (!latest || !attestVerification(bound, latest).ok || latest.proof.verdict !== 'PASS'
        || item.proof.verificationProofDigest !== latest.row.proof_digest
        || item.proof.verificationRunId !== latest.proof.verificationRunId
        || item.proof.verificationSessionId !== latest.proof.verificationSessionId
        || [latest.proof.implementationSessionId, latest.proof.verificationSessionId].includes(item.proof.sessionId)) {
        return { ...none, kind: 'supervision', status: 'corrupt' };
      }
      return { kind: 'supervision', status: item.proof.verdict.toLowerCase(),
        rowSha256: sha256(canonicalJson(['qe-sivs-proof-row-v1', 'supervision', item.row])),
        sequence: item.row.supervision_seq, proofDigest: item.row.proof_digest, runId: null,
        sessionId: item.proof.sessionId, verdict: item.proof.verdict };
    }
    if (target === 'remediate') {
      const event = parseJson(db.prepare('SELECT event_json FROM process_controller_audit WHERE process_id=? AND audit_seq=?')
        .get(input.processId, current.auditSeq)?.event_json);
      const sealed = event?.request?.evidenceProjection?.proof;
      if (sealed?.kind === 'remediation' && sealed.status === 'fail') {
        const candidates = [...(verification || []), ...(supervision || [])]
          .filter(item => item.proof.verdict === 'FAIL' && item.row.proof_digest === sealed.proofDigest);
        const matched = candidates.find(item => {
          const isS = Object.hasOwn(item.row, 'supervision_seq');
          const kind = isS ? 'supervision' : 'verification';
          const sequence = item.row[isS ? 'supervision_seq' : 'verification_seq'];
          const rowSha256 = sha256(canonicalJson(['qe-sivs-proof-row-v1', kind, item.row]));
          const sessionId = isS ? item.proof.sessionId : item.proof.verificationSessionId;
          const runId = isS ? null : item.proof.verificationRunId;
          return item.row.task_binding_sha256 === bound.tokenSha && sequence === sealed.sequence
            && rowSha256 === sealed.rowSha256 && sessionId === sealed.sessionId
            && runId === sealed.runId && sealed.verdict === 'FAIL';
        });
        return matched ? sealed : { ...none, kind: 'remediation', status: 'corrupt' };
      }
      const failedV = verification?.filter(item => item.proof.verdict === 'FAIL').at(-1);
      const failedS = supervision?.filter(item => item.proof.verdict === 'FAIL').at(-1);
      const item = state === 'verify' ? failedV : failedS || failedV;
      if (!item) return { ...none, kind: 'remediation', status: 'missing' };
      const isS = Object.hasOwn(item.row, 'supervision_seq');
      return { kind: 'remediation', status: 'fail',
        rowSha256: sha256(canonicalJson(['qe-sivs-proof-row-v1', isS ? 'supervision' : 'verification', item.row])),
        sequence: item.row[isS ? 'supervision_seq' : 'verification_seq'], proofDigest: item.row.proof_digest,
        runId: isS ? null : item.proof.verificationRunId,
        sessionId: isS ? item.proof.sessionId : item.proof.verificationSessionId, verdict: 'FAIL' };
    }
    return none;
  }

  function stageDecision(snapshot, action, proof) {
    const state = snapshot.state;
    if (action === 'block' && state !== 'complete' && state !== 'blocked') return { to: 'blocked' };
    if (action === 'resume' && state === 'blocked' && snapshot.resumeState) {
      const target = snapshot.resumeState;
      if (target === 'verify' && proof.status !== 'pass') return { error: proof.status === 'missing' ? 'SIVS_IMPLEMENTATION_PROOF_MISSING' : 'SIVS_IMPLEMENTATION_FAILED' };
      if (target === 'supervise' && proof.status !== 'pass') return { error: proof.status === 'missing' ? 'SIVS_VERIFICATION_PROOF_MISSING' : 'SIVS_VERIFICATION_FAILED' };
      if (target === 'remediate' && proof.status !== 'fail') return { error: 'SIVS_REMEDIATION_NOT_AUTHORIZED' };
      return { to: target };
    }
    if (action === 'forward') {
      if (state === 'spec') return { to: 'implement' };
      if (state === 'implement') return proof.status === 'pass' ? { to: 'verify' }
        : { error: proof.status === 'missing' ? 'SIVS_IMPLEMENTATION_PROOF_MISSING'
          : proof.status === 'corrupt' ? 'SIVS_IMPLEMENTATION_PROOF_CORRUPT' : 'SIVS_IMPLEMENTATION_FAILED' };
      if (state === 'verify') return proof.status === 'pass' ? { to: 'supervise' }
        : { error: proof.status === 'missing' ? 'SIVS_VERIFICATION_PROOF_MISSING'
          : proof.status === 'corrupt' ? 'SIVS_VERIFICATION_PROOF_CORRUPT' : 'SIVS_VERIFICATION_FAILED' };
      if (state === 'supervise') return { error: proof.status === 'fail'
        ? 'SIVS_SUPERVISION_FAILED' : proof.status === 'missing' ? 'SIVS_SUPERVISION_PROOF_MISSING'
          : proof.status === 'corrupt' ? 'SIVS_SUPERVISION_PROOF_CORRUPT' : 'SIVS_COMPLETION_EVIDENCE_MISSING' };
    }
    if (action === 'remediate' && ['verify', 'supervise'].includes(state)) {
      return proof.status === 'fail' ? { to: 'remediate' } : { error: 'SIVS_REMEDIATION_NOT_AUTHORIZED' };
    }
    return { error: 'SIVS_STAGE_ACTION_DENIED' };
  }

  function completionEvidence(bound, proof) {
    const p = bound.issued.payload; const base = `.qe/planning/plans/${p.planSlug}`;
    const supervision = validateProofRows(proofRows('supervision', p.processId), 'supervision',
      bound.tokenSha, p)?.at(-1);
    if (!supervision || supervision.row.proof_digest !== proof.proofDigest) return { error: 'SIVS_SUPERVISION_PROOF_CORRUPT' };
    const supervisionProof = supervision.proof;
    const paths = { goal: `${base}/goals.json`, acceptance: `${base}/evidence/${p.goalId}.acceptance.json`,
      completion: `${base}/evidence/${p.goalId}.completion.json`, implementation: `${base}/evidence/${p.goalId}.implementation-run.json`,
      verification: `${base}/evidence/${p.goalId}.verification-run.json` };
    const rows = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, artifactRow(db, path)]));
    if (!rows.completion.ok) return { error: rows.completion.code === 'PSE_ARTIFACT_NOT_FOUND'
      ? 'SIVS_COMPLETION_EVIDENCE_MISSING' : 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    const completion = parseJson(rows.completion.text);
    if (!completion || rows.completion.text !== `${JSON.stringify(completion, null, 2)}\n`
      || completion.schema !== 1 || completion.goalId !== p.goalId) return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    if (!rows.goal.ok) return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    const goalDoc = parseJson(rows.goal.text); const goal = goalDoc?.goals?.find(item => item?.id === p.goalId);
    if (!goal || typeof goal.status !== 'string') return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    if (goal.status !== 'active' || goal.attempts !== p.goalAttempt || goal.acceptance?.hash !== p.acceptanceHash
      || goal.completionEvidence?.status !== 'recorded'
      || goal.completionEvidence?.file !== `evidence/${p.goalId}.completion.json`) return { error: 'SIVS_COMPLETION_EVIDENCE_STALE' };
    if (Object.entries(rows).some(([key, row]) => !['completion', 'goal'].includes(key) && !row.ok)) return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    const acceptance = parseJson(rows.acceptance.text);
    if (!acceptance || rows.acceptance.text !== `${JSON.stringify(acceptance, null, 2)}\n`
      || ![1, 2].includes(acceptance.schema) || acceptance.goalId !== p.goalId) return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    const cover = (source, actual) => Array.isArray(source) && Array.isArray(actual)
      && new Set(actual.map(item => item?.id)).size === actual.length
      && source.every(item => actual.filter(value => value?.id === item.id && value.outcome === 'pass'
        && typeof value.evidence === 'string' && value.evidence.trim()).length === 1);
    if (!cover(acceptance.requirements, completion.requirements) || !cover(acceptance.scenarios, completion.scenarios)
      || completion.regression?.outcome !== 'pass' || !completion.regression?.evidence?.trim()
      || completion.independentVerification?.mode !== 'machine-reexecution'
      || completion.independentVerification?.outcome !== 'pass' || !completion.independentVerification?.verifier?.trim()
      || completion.goalAlignment?.outcome !== 'pass'
      || completion.goalAlignment?.verifier !== completion.independentVerification.verifier
      || String(completion.goalAlignment?.objective || '').replace(/\s+/g, ' ').trim()
        !== String(goal.objective || '').replace(/\s+/g, ' ').trim()
      || (acceptance.schema === 2
        && completion.goalAlignment?.outcomeId !== acceptance.goalShape?.outcomes?.[0]?.id)) {
      return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    }
    const impl = runValue(rows.implementation, p.planSlug, p.goalId, 'implementation');
    const verify = runValue(rows.verification, p.planSlug, p.goalId, 'verification');
    if (!impl || !verify || !impl.run.passed || !verify.run.passed || impl.run.sessionId === verify.run.sessionId
      || verify.run.verifier !== completion.independentVerification.verifier) return { error: 'SIVS_COMPLETION_EVIDENCE_CORRUPT' };
    const rowHash = row => row.sha256;
    const supervisionDigest = supervision.row.proof_digest;
    const projection = { schema: 1, planSlug: p.planSlug, goalId: p.goalId, goalAttempt: p.goalAttempt,
      acceptanceHash: p.acceptanceHash, goalPath: paths.goal, goalRowSha256: rowHash(rows.goal),
      acceptancePath: paths.acceptance, acceptanceRowSha256: rowHash(rows.acceptance), completionPath: paths.completion,
      completionRowSha256: rowHash(rows.completion), implementationPath: paths.implementation,
      implementationRowSha256: rowHash(rows.implementation), implementationRunId: impl.run.runId,
      implementationSessionId: impl.run.sessionId, verificationPath: paths.verification,
      verificationRowSha256: rowHash(rows.verification), verificationRunId: verify.run.runId,
      verificationSessionId: verify.run.sessionId, verifier: verify.run.verifier,
      verificationProofDigest: supervisionProof.verificationProofDigest, supervisionProofDigest: supervisionDigest,
      supervisionSessionId: supervisionProof.sessionId, humanAcceptanceRequired: acceptance.humanAcceptance?.required === true,
      humanAcceptanceStatus: completion.humanAcceptance?.status };
    return { projection, impl, verify, completion, acceptance };
  }

  function sivsStagePublic(event, row, replayed) {
    return { ok: true, allowed: true, code: 'SIVS_STAGE_TRANSITION_COMMITTED',
      action: event.result.action, to: event.result.to, replayed, audited: true,
      auditSeq: row.audit_seq, auditHash: row.event_hash, evidenceDigest: event.result.evidenceDigest };
  }

  const clockNow = typeof options.now === 'function' ? options.now : Date.now;

  function persistentFailure(code, extra = {}) {
    return { ok: false, allowed: false, code, ...extra };
  }

  function capturePersistentNow() {
    const nowMs = clockNow();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      const error = new Error('invalid persistent clock'); error.code = 'PERSISTENT_CLOCK_ROLLBACK'; throw error;
    }
    const row = db.prepare('SELECT watermark_ms FROM process_controller_persistent_clock WHERE singleton=1').get();
    if (row && nowMs < row.watermark_ms) {
      const error = new Error('persistent clock rollback'); error.code = 'PERSISTENT_CLOCK_ROLLBACK'; throw error;
    }
    if (row) db.prepare('UPDATE process_controller_persistent_clock SET watermark_ms=? WHERE singleton=1').run(nowMs);
    else db.prepare('INSERT INTO process_controller_persistent_clock VALUES(1,?)').run(nowMs);
    return nowMs;
  }

  function persistentScope(sessionId, processId, generation) {
    return `${sessionId}:${processId}:${generation}`;
  }

  function persistentEventHash(sessionId, processId, generation, seq, previous, payloadJson) {
    return eventHash(PERSISTENT_LEASE_DOMAIN, persistentScope(sessionId, processId, generation),
      seq, previous, payloadJson);
  }

  function validatePersistentCurrent(row) {
    if (!row || !FULL_UUID.test(row.session_id) || typeof row.process_id !== 'string'
      || !Number.isSafeInteger(row.generation) || row.generation < 1
      || !['active', 'expired', 'released'].includes(row.status)
      || row.fence !== row.generation || !HEX64.test(row.token_text)
      || row.token_sha256 !== sha256(row.token_text)
      || !Number.isSafeInteger(row.renew_count) || row.renew_count < 0 || row.renew_count > 32
      || !Number.isSafeInteger(row.expires_at) || row.expires_at < 0
      || !Number.isSafeInteger(row.latest_event_seq) || row.latest_event_seq < 0 || row.latest_event_seq > 34
      || !HEX64.test(row.latest_event_hash) || !HEX64.test(row.process_audit_hash)
      || (row.generation === 1 ? row.predecessor_terminal_digest !== null
        : !HEX64.test(row.predecessor_terminal_digest || ''))) return null;
    const rows = db.prepare(`SELECT * FROM process_controller_persistent_lease_event
      WHERE session_id=? AND process_id=? AND generation=? ORDER BY event_seq`)
      .all(row.session_id, row.process_id, row.generation);
    if (rows.length < 1 || rows.length > 35 || rows.at(-1).event_seq !== row.latest_event_seq) return null;
    let previous = ZERO_HASH; let renews = 0; let terminal = null; let expiresAt = null;
    let processAuditHash = null;
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index]; const payload = parseJson(item.payload_json);
      if (item.event_seq !== index || item.prev_hash !== previous || !payload
        || canonicalJson(payload) !== item.payload_json
        || item.event_hash !== persistentEventHash(row.session_id, row.process_id,
          row.generation, index, previous, item.payload_json)
        || payload.schema !== 1 || payload.domain !== PERSISTENT_LEASE_DOMAIN
        || payload.sessionId !== row.session_id || payload.processId !== row.process_id
        || payload.generation !== row.generation || payload.eventSeq !== index
        || payload.requestId !== item.request_id || payload.requestDigest !== item.request_digest
        || payload.kind !== item.kind || payload.fence !== row.fence
        || payload.tokenSha256 !== row.token_sha256 || !Number.isSafeInteger(payload.expiresAt)) return null;
      if ((payload.predecessorTerminalDigest ?? null) !== row.predecessor_terminal_digest) return null;
      if (index === 0 && item.kind !== 'acquire') return null;
      if (index > 0 && item.kind === 'acquire') return null;
      if (item.kind === 'renew') { if (terminal || ++renews > 32) return null; }
      else if (['expired', 'released'].includes(item.kind)) {
        const expiryThenRelease = terminal?.kind === 'expired' && item.kind === 'released'
          && index === rows.length - 1;
        if ((terminal && !expiryThenRelease) || (index !== rows.length - 1
          && !(item.kind === 'expired' && rows[index + 1]?.kind === 'released'))) return null;
        if (item.kind === 'expired' && item.recorded_at < payload.expiresAt) return null;
        terminal = item;
      } else if (item.kind !== 'acquire') return null;
      if (!HEX64.test(payload.processAuditHash || '')) return null;
      expiresAt = payload.expiresAt; processAuditHash = payload.processAuditHash; previous = item.event_hash;
    }
    if (previous !== row.latest_event_hash || renews !== row.renew_count || expiresAt !== row.expires_at
      || processAuditHash !== row.process_audit_hash
      || (terminal ? row.status !== terminal.kind : row.status !== 'active')) return null;
    return { row, rows, terminal, terminalDigest: terminal?.event_hash || null };
  }

  function appendPersistentEvent(row, { requestId, requestDigest, kind, nowMs, expiresAt, processAuditHash }) {
    const seq = row ? row.latest_event_seq + 1 : 0;
    const previous = row ? row.latest_event_hash : ZERO_HASH;
    const generation = row?.generation;
    const payload = { schema: 1, domain: PERSISTENT_LEASE_DOMAIN,
      sessionId: row.session_id, processId: row.process_id, generation, eventSeq: seq,
      requestId, requestDigest, kind, fence: row.fence, tokenSha256: row.token_sha256,
      expiresAt, processAuditHash, predecessorTerminalDigest: row.predecessor_terminal_digest };
    const payloadJson = canonicalJson(payload);
    const hash = persistentEventHash(row.session_id, row.process_id, generation, seq, previous, payloadJson);
    db.prepare(`INSERT INTO process_controller_persistent_lease_event
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.session_id, row.process_id, generation, seq,
      requestId, requestDigest, kind, payloadJson, previous, hash, nowMs);
    return { seq, hash, payload };
  }

  function persistentAuthority(validated) {
    const row = validated.row;
    return sha256(canonicalJson([PERSISTENT_LEASE_DOMAIN, 'authority', row.session_id,
      row.process_id, row.generation, row.status, row.fence, row.latest_event_hash,
      row.predecessor_terminal_digest, row.process_audit_hash]));
  }

  function processAuditContains(processId, auditHash) {
    return Boolean(db.prepare(`SELECT 1 AS present FROM process_controller_audit
      WHERE process_id=? AND event_hash=?`).get(processId, auditHash));
  }

  function persistentSivsAuthority(processId) {
    const process = processRead(db, processId);
    if (!process.ok || process.layer !== 'sivs') return null;
    const row = db.prepare(`SELECT * FROM process_controller_sivs_task_binding
      WHERE process_id=?`).get(processId);
    const binding = sivsBindingValue(row);
    if (!binding || binding.payload.processId !== processId || binding.payload.controllerIdentity !== row.controller_identity) {
      return null;
    }
    return { process, binding, row };
  }

  function acquirePersistentLease(input) {
    let committed = false; let recovery = null;
    try {
      if (!input || !FULL_UUID.test(input.sessionId || '') || typeof input.processId !== 'string'
        || typeof input.requestId !== 'string' || !input.requestId.trim()
        || !Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 86_400_000) {
        return persistentFailure('PERSISTENT_LEASE_INVALID');
      }
      db.exec('BEGIN IMMEDIATE');
      const authority = persistentSivsAuthority(input.processId); const process = authority?.process;
      if (!authority || process.snapshot.state === 'complete') {
        db.exec('ROLLBACK'); return persistentFailure(authority
          ? 'PERSISTENT_PROCESS_INVALID' : 'PERSISTENT_LEASE_CORRUPT');
      }
      const remediation = isRemediationHalted(input.processId, process);
      if (remediation.error || remediation.halted) {
        db.exec('ROLLBACK'); return persistentFailure(remediation.error || 'SIVS_REMEDIATION_HALTED');
      }
      const current = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE session_id=? AND process_id=?`).get(input.sessionId, input.processId);
      const sessionCurrent = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE session_id=? LIMIT 1`).get(input.sessionId);
      if (!current && sessionCurrent) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_ACTIVE');
      }
      const requestDigest = sha256(canonicalJson([PERSISTENT_LEASE_DOMAIN, 'acquire', input.sessionId,
        input.processId, input.requestId, input.durationMs, process.auditHash]));
      if (current) {
        const valid = validatePersistentCurrent(current);
        if (!valid) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT'); }
        if (!processAuditContains(input.processId, current.process_audit_hash)) {
          db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT');
        }
        const prior = valid.rows.find(item => item.request_id === input.requestId);
        if (prior) {
          if (prior.request_digest !== requestDigest || prior.kind !== 'acquire') {
            db.exec('ROLLBACK'); return persistentFailure('REQUEST_ID_CONFLICT');
          }
          db.exec('COMMIT'); return { ok: true, code: 'PERSISTENT_LEASE_ACQUIRED', replayed: true,
            token: current.token_text, generation: current.generation, fence: current.fence,
            expiresAt: JSON.parse(prior.payload_json).expiresAt };
        }
        if (!valid.terminal || !['expired', 'released'].includes(current.status)) {
          db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_ACTIVE');
        }
      }
      const foreign = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE process_id=? AND status='active' LIMIT 1`).get(input.processId);
      if (foreign && foreign.session_id !== input.sessionId) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_ACTIVE');
      }
      const nowMs = capturePersistentNow(); const expiresAt = nowMs + input.durationMs;
      if (!Number.isSafeInteger(expiresAt)) throw new Error('lease expiry overflow');
      const generation = current ? current.generation + 1 : 1;
      const token = randomBytes(32).toString('hex');
      const next = { session_id: input.sessionId, process_id: input.processId, generation,
        status: 'active', fence: generation, token_text: token, token_sha256: sha256(token),
        renew_count: 0, expires_at: expiresAt, latest_event_seq: -1,
        latest_event_hash: ZERO_HASH, predecessor_terminal_digest: current?.latest_event_hash || null,
        process_audit_hash: process.auditHash };
      fault('persistent-acquire-before-row');
      const event = appendPersistentEvent(next, { requestId: input.requestId, requestDigest,
        kind: 'acquire', nowMs, expiresAt, processAuditHash: process.auditHash });
      next.latest_event_seq = event.seq; next.latest_event_hash = event.hash;
      recovery = { requestDigest, generation, token, expiresAt };
      if (current) fault('persistent-rollover-after-predecessor-validation');
      fault(current ? 'persistent-rollover-between-checkpoint-and-current'
        : 'persistent-acquire-between-event-and-head');
      db.prepare(`INSERT INTO process_controller_persistent_lease_current VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(session_id,process_id) DO UPDATE SET generation=excluded.generation,status=excluded.status,
        fence=excluded.fence,token_text=excluded.token_text,token_sha256=excluded.token_sha256,
        renew_count=excluded.renew_count,expires_at=excluded.expires_at,latest_event_seq=excluded.latest_event_seq,
        latest_event_hash=excluded.latest_event_hash,predecessor_terminal_digest=excluded.predecessor_terminal_digest,
        process_audit_hash=excluded.process_audit_hash`).run(next.session_id, next.process_id, next.generation,
        next.status, next.fence, next.token_text, next.token_sha256, next.renew_count, next.expires_at,
        next.latest_event_seq, next.latest_event_hash, next.predecessor_terminal_digest, next.process_audit_hash);
      fault('persistent-acquire-before-commit'); db.exec('COMMIT'); committed = true;
      fault('persistent-acquire-after-commit');
      return { ok: true, code: 'PERSISTENT_LEASE_ACQUIRED', replayed: false, token,
        generation, fence: generation, expiresAt };
    } catch (error) {
      if (!committed) try { db.exec('ROLLBACK'); } catch {}
      if (committed && recovery) {
        try {
          const row = db.prepare(`SELECT * FROM process_controller_persistent_lease_event
            WHERE session_id=? AND process_id=? AND generation=? AND request_id=?`).get(
            input.sessionId, input.processId, recovery.generation, input.requestId);
          if (row?.request_digest === recovery.requestDigest && row.kind === 'acquire') {
            return { ok: true, code: 'PERSISTENT_LEASE_ACQUIRED', replayed: false,
              token: recovery.token, generation: recovery.generation, fence: recovery.generation,
              expiresAt: recovery.expiresAt };
          }
        } catch {}
      }
      return persistentFailure(error?.code === 'PERSISTENT_CLOCK_ROLLBACK'
        ? 'PERSISTENT_CLOCK_ROLLBACK' : 'PERSISTENT_STORE_UNAVAILABLE');
    }
  }

  function renewPersistentLease(input) {
    let committed = false; let recovery = null;
    try {
      if (!input || !FULL_UUID.test(input.sessionId || '') || !HEX64.test(input.token || '')
        || typeof input.processId !== 'string' || typeof input.requestId !== 'string'
        || !Number.isSafeInteger(input.generation) || !Number.isSafeInteger(input.fence)
        || !Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 86_400_000) {
        return persistentFailure('PERSISTENT_LEASE_INVALID');
      }
      db.exec('BEGIN IMMEDIATE');
      const current = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE session_id=? AND process_id=?`).get(input.sessionId, input.processId);
      const valid = validatePersistentCurrent(current);
      if (!valid) { db.exec('ROLLBACK'); return persistentFailure(current ? 'PERSISTENT_LEASE_CORRUPT' : 'PERSISTENT_LEASE_NOT_FOUND'); }
      const requestDigest = sha256(canonicalJson([PERSISTENT_LEASE_DOMAIN, 'renew', input.sessionId,
        input.processId, input.requestId, sha256(input.token), input.generation, input.fence, input.durationMs]));
      const prior = valid.rows.find(item => item.request_id === input.requestId);
      if (prior) {
        if (prior.request_digest !== requestDigest || prior.kind !== 'renew') {
          db.exec('ROLLBACK'); return persistentFailure('REQUEST_ID_CONFLICT');
        }
        db.exec('COMMIT'); return { ok: true, code: 'PERSISTENT_LEASE_RENEWED', replayed: true,
          generation: current.generation, fence: current.fence, expiresAt: JSON.parse(prior.payload_json).expiresAt };
      }
      const authority = persistentSivsAuthority(input.processId); const process = authority?.process;
      if (!authority || !processAuditContains(input.processId, current.process_audit_hash)) {
        db.exec('ROLLBACK'); return persistentFailure(!authority
          ? 'PERSISTENT_LEASE_CORRUPT' : 'PERSISTENT_LEASE_STALE');
      }
      const remediation = isRemediationHalted(input.processId, process);
      if (remediation.error || remediation.halted) {
        db.exec('ROLLBACK'); return persistentFailure(remediation.error || 'SIVS_REMEDIATION_HALTED');
      }
      if (process.snapshot.state === 'complete' || current.status !== 'active'
        || current.generation !== input.generation || current.fence !== input.fence
        || current.token_text !== input.token) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_STALE');
      }
      if (current.renew_count >= 32) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_RENEWAL_EXHAUSTED'); }
      const nowMs = capturePersistentNow();
      if (nowMs >= current.expires_at) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_EXPIRED'); }
      const expiresAt = nowMs + input.durationMs;
      if (!Number.isSafeInteger(expiresAt)) throw new Error('lease expiry overflow');
      const event = appendPersistentEvent(current, { requestId: input.requestId, requestDigest,
        kind: 'renew', nowMs, expiresAt, processAuditHash: process.auditHash });
      recovery = { requestDigest, generation: current.generation, fence: current.fence, expiresAt };
      fault('persistent-renew-between-event-and-head');
      db.prepare(`UPDATE process_controller_persistent_lease_current SET renew_count=renew_count+1,
        expires_at=?,latest_event_seq=?,latest_event_hash=?,process_audit_hash=? WHERE session_id=? AND process_id=?
        AND generation=? AND latest_event_hash=?`).run(expiresAt, event.seq, event.hash, process.auditHash,
        input.sessionId, input.processId, input.generation, current.latest_event_hash);
      fault('persistent-renew-before-commit'); db.exec('COMMIT'); committed = true;
      fault('persistent-renew-after-commit');
      return { ok: true, code: 'PERSISTENT_LEASE_RENEWED', replayed: false,
        generation: current.generation, fence: current.fence, expiresAt };
    } catch (error) {
      if (!committed) try { db.exec('ROLLBACK'); } catch {}
      if (committed && recovery) {
        try {
          const row = db.prepare(`SELECT * FROM process_controller_persistent_lease_event
            WHERE session_id=? AND process_id=? AND generation=? AND request_id=?`).get(
            input.sessionId, input.processId, recovery.generation, input.requestId);
          if (row?.request_digest === recovery.requestDigest && row.kind === 'renew') {
            return { ok: true, code: 'PERSISTENT_LEASE_RENEWED', replayed: false,
              generation: recovery.generation, fence: recovery.fence, expiresAt: recovery.expiresAt };
          }
        } catch {}
      }
      return persistentFailure(error?.code === 'PERSISTENT_CLOCK_ROLLBACK'
        ? 'PERSISTENT_CLOCK_ROLLBACK' : 'PERSISTENT_STORE_UNAVAILABLE');
    }
  }

  function decidePersistentStop(input) {
    let committed = false;
    try {
      if (!input || typeof input.eventKey !== 'string' || !input.eventKey.trim()) {
        return persistentFailure('PERSISTENT_SESSION_INVALID');
      }
      db.exec('BEGIN IMMEDIATE');
      const hasLease = db.prepare('SELECT 1 AS present FROM process_controller_persistent_lease_current LIMIT 1').get();
      if (!hasLease) { db.exec('COMMIT'); return { ok: true, code: 'PERSISTENT_LEASE_NOT_FOUND', legacy: true }; }
      if (!FULL_UUID.test(input.sessionId || '')) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_SESSION_INVALID');
      }
      const current = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE session_id=? ORDER BY generation DESC LIMIT 1`).get(input.sessionId);
      if (!current) { db.exec('COMMIT'); return { ok: true, code: 'PERSISTENT_LEASE_NOT_FOUND', legacy: true }; }
      const valid = validatePersistentCurrent(current);
      if (!valid) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT'); }
      const authorityGeneration = persistentAuthority(valid);
      const projection = { eventKey: input.eventKey, cwd: String(input.cwd || ''),
        transcriptPath: String(input.transcriptPath || ''), turnId: String(input.turnId || ''),
        userTextSha256: sha256(String(input.userText || '')),
        assistantTextSha256: sha256(String(input.assistantText || '')), sessionId: input.sessionId };
      const requestDigest = sha256(canonicalJson([PERSISTENT_STOP_DOMAIN, projection]));
      const prior = db.prepare('SELECT * FROM process_controller_persistent_stop_decision WHERE event_key=?')
        .get(input.eventKey);
      if (prior) {
        if (prior.request_digest !== requestDigest) { db.exec('ROLLBACK'); return persistentFailure('REQUEST_ID_CONFLICT'); }
        if (prior.authority_generation !== authorityGeneration) {
          db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_STOP_REPLAY_STALE');
        }
        const result = parseJson(prior.result_json);
        if (!result) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT'); }
        db.exec('COMMIT'); return { ...result, replayed: true };
      }
      const authority = persistentSivsAuthority(current.process_id); const process = authority?.process;
      if (!authority) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT');
      }
      const remediation = isRemediationHalted(current.process_id, process);
      if (remediation.error) {
        db.exec('ROLLBACK'); return persistentFailure(remediation.error);
      }
      const complete = process.snapshot.state === 'complete';
      const remediationHalted = remediation.halted;
      if (!processAuditContains(current.process_id, current.process_audit_hash)) {
        db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT');
      }
      const nowMs = capturePersistentNow(); let code; let allow; let event = null;
      if (remediationHalted) {
        code = 'PERSISTENT_REMEDIATION_HALTED'; allow = true;
      } else if (current.status === 'released') {
        if (!complete) { db.exec('ROLLBACK'); return persistentFailure('PERSISTENT_LEASE_CORRUPT'); }
        code = 'PERSISTENT_PROCESS_COMPLETE'; allow = true;
      } else if (current.status === 'expired') {
        code = complete ? 'PERSISTENT_PROCESS_COMPLETE' : 'PERSISTENT_LEASE_EXPIRED'; allow = true;
      } else if (complete) {
        event = appendPersistentEvent(current, { requestId: `stop-release:${input.eventKey}`, requestDigest,
          kind: 'released', nowMs, expiresAt: current.expires_at, processAuditHash: process.auditHash });
        fault('persistent-stop-complete-between-event-and-head');
        db.prepare(`UPDATE process_controller_persistent_lease_current SET status='released',
          latest_event_seq=?,latest_event_hash=?,process_audit_hash=? WHERE session_id=? AND process_id=?`)
          .run(event.seq, event.hash, process.auditHash, current.session_id, current.process_id);
        code = 'PERSISTENT_PROCESS_COMPLETE'; allow = true;
      } else if (nowMs >= current.expires_at) {
        event = appendPersistentEvent(current, { requestId: `stop-expire:${input.eventKey}`, requestDigest,
          kind: 'expired', nowMs, expiresAt: current.expires_at, processAuditHash: process.auditHash });
        fault('persistent-stop-expiry-between-event-and-head');
        db.prepare(`UPDATE process_controller_persistent_lease_current SET status='expired',
          latest_event_seq=?,latest_event_hash=?,process_audit_hash=? WHERE session_id=? AND process_id=?`)
          .run(event.seq, event.hash, process.auditHash, current.session_id, current.process_id);
        code = 'PERSISTENT_LEASE_EXPIRED'; allow = true;
      } else { code = 'PERSISTENT_LEASE_ACTIVE'; allow = false; }
      const result = { ok: true, code, allow, processId: current.process_id,
        generation: current.generation, fence: current.fence, replayed: false };
      const finalCurrent = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE session_id=? AND process_id=?`).get(current.session_id, current.process_id);
      const finalValid = validatePersistentCurrent(finalCurrent);
      if (!finalValid) throw new Error('persistent terminal invalid');
      const finalAuthority = persistentAuthority(finalValid);
      fault('persistent-stop-before-decision');
      fault('persistent-stop-between-audit-and-decision');
      db.prepare('INSERT INTO process_controller_persistent_stop_decision VALUES(?,?,?,?,?,?,?)')
        .run(input.eventKey, input.sessionId, current.process_id, requestDigest,
          finalAuthority, canonicalJson(result), nowMs);
      fault('persistent-stop-before-commit'); db.exec('COMMIT'); committed = true;
      fault('persistent-stop-after-commit');
      return result;
    } catch (error) {
      if (!committed) try { db.exec('ROLLBACK'); } catch {}
      if (committed) {
        try {
          const row = db.prepare('SELECT * FROM process_controller_persistent_stop_decision WHERE event_key=?')
            .get(input.eventKey); const result = row && parseJson(row.result_json);
          if (result) return result;
        } catch {}
      }
      return persistentFailure(error?.code === 'PERSISTENT_CLOCK_ROLLBACK'
        ? 'PERSISTENT_CLOCK_ROLLBACK' : 'PERSISTENT_STORE_UNAVAILABLE');
    }
  }

  function couplePersistentCompletion(processId, processAuditHash) {
    const nowMs = capturePersistentNow();
    const rows = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
      WHERE process_id=? ORDER BY session_id`).all(processId);
    for (const current of rows) {
      const valid = validatePersistentCurrent(current);
      if (!valid) throw new Error('persistent lease corrupt');
      if (current.status === 'released' || current.status === 'expired') continue;
      const kind = current.status === 'active' && nowMs >= current.expires_at ? 'expired' : 'released';
      const requestId = `completion:${processAuditHash}:${kind}`;
      const requestDigest = sha256(canonicalJson([PERSISTENT_LEASE_DOMAIN, 'completion',
        current.session_id, processId, current.generation, kind, processAuditHash]));
      const event = appendPersistentEvent(current, { requestId, requestDigest, kind, nowMs,
        expiresAt: current.expires_at, processAuditHash });
      fault('persistent-completion-between-event-and-head');
      db.prepare(`UPDATE process_controller_persistent_lease_current SET status=?,latest_event_seq=?,
        latest_event_hash=?,process_audit_hash=? WHERE session_id=? AND process_id=?`)
        .run(kind, event.seq, event.hash, processAuditHash, current.session_id, processId);
    }
  }

  function remediationEventHash(processId, seq, previous, payloadJson) {
    return eventHash(SIVS_REMEDIATION_DOMAIN, processId, seq, previous, payloadJson);
  }

  function validateRemediationCurrent(processId, suppliedRow, suppliedRows) {
    const row = arguments.length >= 2 ? suppliedRow : db.prepare(`SELECT * FROM process_controller_sivs_remediation_current
      WHERE process_id=?`).get(processId);
    const rows = arguments.length >= 3 ? suppliedRows : db.prepare(`SELECT * FROM process_controller_sivs_remediation_event
      WHERE process_id=? ORDER BY event_seq`).all(processId);
    if (!row) return rows.length ? { error: 'SIVS_REMEDIATION_STATE_CORRUPT' } : { row: null, rows: [] };
    if (!HEX64.test(row.task_binding_sha256) || !['active', 'halted'].includes(row.status)
      || !Number.isSafeInteger(row.round_count) || row.round_count < 0 || row.round_count > 3
      || !Number.isSafeInteger(row.depth_count) || row.depth_count < 0 || row.depth_count > 5
      || (row.last_stagnation_digest !== null && !HEX64.test(row.last_stagnation_digest))
      || !Number.isSafeInteger(row.latest_event_seq) || row.latest_event_seq < 0
      || !HEX64.test(row.latest_event_hash) || !Number.isSafeInteger(row.process_revision)
      || row.process_revision < 0 || !HEX64.test(row.process_audit_hash)
      || rows.length !== row.latest_event_seq + 1) return { error: 'SIVS_REMEDIATION_STATE_CORRUPT' };
    let previous = ZERO_HASH;
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index]; const payload = parseJson(item.payload_json);
      if (item.event_seq !== index || item.prev_hash !== previous || !HEX64.test(item.request_digest)
        || !payload || canonicalJson(payload) !== item.payload_json || payload.schema !== 1
        || payload.domain !== SIVS_REMEDIATION_DOMAIN || payload.processId !== processId
        || payload.eventSeq !== index || payload.requestId !== item.request_id
        || payload.requestDigest !== item.request_digest || payload.kind !== item.kind
        || !['round', 'halted'].includes(item.kind)
        || item.event_hash !== remediationEventHash(processId, index, previous, item.payload_json)
        || !Number.isSafeInteger(payload.round) || payload.round < 0 || payload.round > 3
        || !Number.isSafeInteger(payload.depth) || payload.depth < 0 || payload.depth > 5
        || !HEX64.test(payload.roundDigest) || !HEX64.test(payload.stagnationDigest)
        || !HEX64.test(payload.sourceAuditHash) || !Number.isSafeInteger(payload.sourceRevision)
        || !['implement', 'verify'].includes(payload.route) || ![1, 2].includes(payload.cost)
        || !['verification', 'supervision'].includes(payload.proofKind)
        || !HEX64.test(payload.proofDigest) || !HEX64.test(payload.semanticFailureDigest)
        || (item.kind === 'round' && payload.code !== 'SIVS_REMEDIATION_COMMITTED')
        || (item.kind === 'halted' && !['SIVS_REMEDIATION_STAGNATED',
          'SIVS_REMEDIATION_ROUND_LIMIT', 'SIVS_REMEDIATION_DEPTH_LIMIT'].includes(payload.code))) {
        return { error: 'SIVS_REMEDIATION_STATE_CORRUPT' };
      }
      previous = item.event_hash;
    }
    const last = parseJson(rows.at(-1)?.payload_json);
    if (!last || previous !== row.latest_event_hash || last.round !== row.round_count
      || last.depth !== row.depth_count || last.stagnationDigest !== row.last_stagnation_digest
      || (row.status === 'halted') !== (rows.at(-1).kind === 'halted')) {
      return { error: 'SIVS_REMEDIATION_STATE_CORRUPT' };
    }
    return { row, rows };
  }

  function isRemediationHalted(processId, current = null) {
    const remediation = validateRemediationCurrent(processId);
    if (remediation.error) return remediation;
    if (!remediation.row) return { halted: false };
    if (current && (remediation.row.process_revision !== current.snapshot.revision
      || remediation.row.process_audit_hash !== current.auditHash)) {
      return { error: 'SIVS_REMEDIATION_STATE_CORRUPT' };
    }
    return { halted: remediation.row.status === 'halted', remediation };
  }

  function remediationProof(input, bound, process) {
    const verification = validateProofRows(proofRows('verification', input.processId),
      'verification', bound.tokenSha, bound.issued.payload);
    const supervision = validateProofRows(proofRows('supervision', input.processId),
      'supervision', bound.tokenSha, bound.issued.payload);
    if (!verification || !supervision) return { error: 'SIVS_REMEDIATION_PROOF_CORRUPT' };
    const p = bound.issued.payload;
    if (process.snapshot.state !== 'remediate') return { error: 'SIVS_REMEDIATION_NOT_AUTHORIZED' };
    const sourceEvent = parseJson(db.prepare(`SELECT event_json FROM process_controller_audit
      WHERE process_id=? AND audit_seq=?`).get(input.processId, process.auditSeq)?.event_json);
    const sealed = sourceEvent?.request?.evidenceProjection?.proof;
    if (sealed?.kind !== 'remediation' || sealed.status !== 'fail' || !HEX64.test(sealed.proofDigest)) {
      return { error: 'SIVS_REMEDIATION_PROOF_CORRUPT' };
    }
    const verificationItem = verification.find(item => item.row.proof_digest === sealed.proofDigest);
    const supervisionItem = supervision.find(item => item.row.proof_digest === sealed.proofDigest);
    if (verificationItem) {
      const item = verificationItem;
      if (item.proof.verdict !== 'FAIL' || !attestVerification(bound, item).ok
        || verification.at(-1) !== item || supervision.some(candidate => candidate.row.created_at > item.row.created_at)) {
        return { error: 'SIVS_REMEDIATION_NOT_AUTHORIZED' };
      }
      const path = `.qe/planning/plans/${p.planSlug}/evidence/${p.goalId}.verification-run.json`;
      const run = runValue(artifactRow(db, path), p.planSlug, p.goalId, 'verification');
      if (!run || run.run.runId !== item.proof.verificationRunId || run.run.passed) {
        return { error: 'SIVS_REMEDIATION_PROOF_CORRUPT' };
      }
      const failing = run.run.runs.filter(entry => !entry.passed).map(entry => ({
        command: entry.command, exitCode: entry.exitCode, signal: entry.signal, outputHash: entry.outputHash,
      }));
      if (!failing.length) return { error: 'SIVS_REMEDIATION_PROOF_CORRUPT' };
      return { kind: 'verification', route: 'implement', cost: 2, item,
        semanticFailure: { source: 'verification-run', failing },
        semanticFailureDigest: sha256(canonicalJson(['qe-sivs-verification-failure-v1', failing])) };
    }
    if (supervisionItem) {
      const item = supervisionItem; const verified = verification.at(-1);
      if (supervision.at(-1) !== item || item.proof.verdict !== 'FAIL'
        || !verified || !attestVerification(bound, verified).ok
        || verified.proof.verdict !== 'PASS' || item.proof.verificationProofDigest !== verified.row.proof_digest) {
        return { error: item ? 'SIVS_REMEDIATION_NOT_AUTHORIZED' : 'SIVS_REMEDIATION_PROOF_MISSING' };
      }
      return { kind: 'supervision', route: 'verify', cost: 1, item,
        semanticFailure: { source: 'trusted-supervisor-riskDigest', riskDigest: item.proof.riskDigest },
        semanticFailureDigest: item.proof.riskDigest };
    }
    return { error: 'SIVS_REMEDIATION_PROOF_CORRUPT' };
  }

  function remediationPublic(event, row, replayed) {
    return { ok: true, allowed: true, code: event.result.code, to: event.result.to,
      round: event.result.round, depth: event.result.depth, halted: event.result.halted,
      replayed, audited: true, auditSeq: row.audit_seq, auditHash: row.event_hash,
      roundDigest: event.result.roundDigest, stagnationDigest: event.result.stagnationDigest };
  }

  function applySivsRemediation(input, helpers) {
    let committed = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      const process = requireSivsProcess(input); if (process.error) return sivsReject(process.error, input);
      const bound = requireSivsBinding(input, helpers, false); if (bound.error) return sivsReject(bound.error, input);
      if (bound.issued.payload.taskPath !== input.taskPath
        || bound.issued.payload.checklistPath !== input.checklistPath) {
        return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      }
      const prior = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? AND request_key=?')
        .get(input.processId, input.requestId);
      if (prior) {
        const event = parseJson(prior.event_json);
        if (event?.operation !== 'sivs-remediation') return sivsReject('REQUEST_ID_CONFLICT', input);
        const expected = sha256(canonicalJson([SIVS_REMEDIATION_DOMAIN, input.controllerIdentity,
          input.processId, input.requestId, bound.tokenSha, input.expectedRevision,
          input.taskPath, input.checklistPath]));
        if (event.requestDigest !== expected || event.controllerIdentity !== input.controllerIdentity) {
          return sivsReject('REQUEST_ID_CONFLICT', input);
        }
        if (prior.audit_seq !== process.current.auditSeq || prior.event_hash !== process.current.auditHash) {
          return sivsReject('SIVS_REMEDIATION_REPLAY_STALE', input);
        }
        db.exec('COMMIT'); return remediationPublic(event, prior, true);
      }
      if (input.expectedRevision !== process.current.snapshot.revision) return sivsReject('STALE_SNAPSHOT', input);
      const fresh = requireSivsBinding(input, helpers, true); if (fresh.error) return sivsReject(fresh.error, input);
      const remediation = validateRemediationCurrent(input.processId);
      if (remediation.error) return sivsReject(remediation.error, input);
      if (remediation.row && (remediation.row.task_binding_sha256 !== bound.tokenSha
        || remediation.row.process_revision !== process.current.snapshot.revision
        || remediation.row.process_audit_hash !== process.current.auditHash)) {
        return sivsReject('SIVS_REMEDIATION_STATE_CORRUPT', input);
      }
      if (remediation.row?.status === 'halted') return sivsReject('SIVS_REMEDIATION_HALTED', input);
      const leaseRows = db.prepare(`SELECT * FROM process_controller_persistent_lease_current
        WHERE process_id=? ORDER BY session_id`).all(input.processId);
      if (leaseRows.length !== 1) return sivsReject(leaseRows.length
        ? 'PERSISTENT_LEASE_CORRUPT' : 'PERSISTENT_LEASE_NOT_FOUND', input);
      const lease = leaseRows[0]; const validLease = validatePersistentCurrent(lease);
      if (!validLease) return sivsReject('PERSISTENT_LEASE_CORRUPT', input);
      if (lease.status !== 'active') return sivsReject('SIVS_REMEDIATION_LEASE_EXPIRED', input);
      if (!processAuditContains(input.processId, lease.process_audit_hash)) {
        return sivsReject('PERSISTENT_LEASE_CORRUPT', input);
      }
      const proof = remediationProof(input, bound, process.current);
      if (proof.error) return sivsReject(proof.error, input);
      const nowMs = capturePersistentNow();
      const currentRound = remediation.row?.round_count || 0;
      const currentDepth = remediation.row?.depth_count || 0;
      const candidateRound = currentRound + 1; const candidateDepth = currentDepth + proof.cost;
      const p = bound.issued.payload;
      const stagnationDigest = sha256(canonicalJson(['qe-sivs-remediation-stagnation-v1',
        bound.tokenSha, p.acceptanceHash, proof.route, proof.kind, proof.semanticFailureDigest]));
      const roundProjection = { schema: 1, taskBindingSha256: bound.tokenSha,
        goalAttempt: p.goalAttempt, acceptanceHash: p.acceptanceHash,
        candidateRound, candidateDepth, route: proof.route, cost: proof.cost,
        proofKind: proof.kind, proofDigest: proof.item.row.proof_digest,
        semanticFailure: proof.semanticFailure, taskSha256: fresh.pair.task.sha256,
        checklistSha256: fresh.pair.checklist.sha256,
        sourceRevision: process.current.snapshot.revision, sourceAuditHash: process.current.auditHash };
      const roundDigest = sha256(canonicalJson(['qe-sivs-remediation-round-v1', roundProjection]));
      let code = 'SIVS_REMEDIATION_COMMITTED';
      if (remediation.row?.last_stagnation_digest === stagnationDigest) code = 'SIVS_REMEDIATION_STAGNATED';
      else if (candidateRound > 3) code = 'SIVS_REMEDIATION_ROUND_LIMIT';
      else if (candidateDepth > 5) code = 'SIVS_REMEDIATION_DEPTH_LIMIT';
      const halted = code !== 'SIVS_REMEDIATION_COMMITTED';
      if (nowMs >= lease.expires_at && !halted) {
        // The captured clock watermark is part of this candidate transaction.
        // An ordinary overdue rejection must not commit even that bookkeeping.
        db.exec('ROLLBACK'); db.exec('BEGIN IMMEDIATE');
        return sivsReject('SIVS_REMEDIATION_LEASE_EXPIRED', input);
      }
      const finalRound = halted ? currentRound : candidateRound;
      const finalDepth = halted ? currentDepth : candidateDepth;
      const snapshot = halted
        ? { state: 'blocked', revision: process.current.snapshot.revision + 1,
          resumeState: process.current.snapshot.state, remediationHalted: true }
        : { state: proof.route, revision: process.current.snapshot.revision + 1 };
      const requestDigest = sha256(canonicalJson([SIVS_REMEDIATION_DOMAIN, input.controllerIdentity,
        input.processId, input.requestId, bound.tokenSha, input.expectedRevision,
        input.taskPath, input.checklistPath]));
      const seq = process.current.auditSeq + 1;
      const result = { allowed: true, code, to: snapshot.state, round: finalRound,
        depth: finalDepth, halted, roundDigest, stagnationDigest };
      const request = { processId: input.processId, requestId: input.requestId,
        expectedRevision: input.expectedRevision, bindingSha256: bound.tokenSha,
        taskPath: input.taskPath, checklistPath: input.checklistPath,
        roundProjection, roundDigest, stagnationDigest, nowMs };
      const event = makeEvent({ ...input, requestDigest, request }, seq,
        process.current.snapshot.revision, snapshot.revision, result, snapshot);
      const eventJson = canonicalJson(event);
      const hash = eventHash(PROCESS_DOMAIN, input.processId, seq, process.current.auditHash, eventJson);
      const remediationSeq = remediation.row ? remediation.row.latest_event_seq + 1 : 0;
      const remediationPrevious = remediation.row?.latest_event_hash || ZERO_HASH;
      const remediationPayload = { schema: 1, domain: SIVS_REMEDIATION_DOMAIN,
        processId: input.processId, eventSeq: remediationSeq, requestId: input.requestId,
        requestDigest, kind: halted ? 'halted' : 'round', code, round: finalRound,
        depth: finalDepth, route: proof.route, cost: proof.cost, roundDigest,
        stagnationDigest, proofKind: proof.kind, proofDigest: proof.item.row.proof_digest,
        semanticFailureDigest: proof.semanticFailureDigest,
        sourceRevision: process.current.snapshot.revision, sourceAuditHash: process.current.auditHash };
      const remediationJson = canonicalJson(remediationPayload);
      const remediationHash = remediationEventHash(input.processId, remediationSeq,
        remediationPrevious, remediationJson);
      fault('sivs-remediation-before-current');
      db.prepare(`INSERT INTO process_controller_sivs_remediation_current VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(process_id) DO UPDATE SET status=excluded.status,
        round_count=excluded.round_count,depth_count=excluded.depth_count,
        last_stagnation_digest=excluded.last_stagnation_digest,
        latest_event_seq=excluded.latest_event_seq,latest_event_hash=excluded.latest_event_hash,
        process_revision=excluded.process_revision,process_audit_hash=excluded.process_audit_hash`)
        .run(input.processId, bound.tokenSha, halted ? 'halted' : 'active', finalRound,
          finalDepth, stagnationDigest, remediationSeq, remediationHash, snapshot.revision, hash);
      fault('sivs-remediation-between-current-and-event');
      db.prepare('INSERT INTO process_controller_sivs_remediation_event VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.processId, remediationSeq, input.requestId, requestDigest,
          halted ? 'halted' : 'round', remediationJson, remediationPrevious, remediationHash, nowMs);
      fault('sivs-remediation-between-event-and-process-state');
      db.prepare(`UPDATE process_controller_state SET snapshot_json=?,revision=?,last_audit_seq=?,last_audit_hash=?
        WHERE process_id=? AND revision=? AND last_audit_seq=? AND last_audit_hash=?`)
        .run(canonicalJson(snapshot), snapshot.revision, seq, hash, input.processId,
          process.current.snapshot.revision, process.current.auditSeq, process.current.auditHash);
      fault('sivs-remediation-between-process-state-and-audit');
      db.prepare('INSERT INTO process_controller_audit VALUES(?,?,?,?,?,?,?)')
        .run(input.processId, seq, input.requestId, eventJson, process.current.auditHash, hash, nowMs);
      if (halted) {
        let leaseHead = lease;
        if (nowMs >= lease.expires_at) {
          const expiredDigest = sha256(canonicalJson([SIVS_REMEDIATION_DOMAIN, 'halt-expire', requestDigest]));
          const expired = appendPersistentEvent(leaseHead, { requestId: `remediation-expire:${input.requestId}`,
            requestDigest: expiredDigest, kind: 'expired', nowMs,
            expiresAt: lease.expires_at, processAuditHash: hash });
          leaseHead = { ...leaseHead, status: 'expired', latest_event_seq: expired.seq,
            latest_event_hash: expired.hash, process_audit_hash: hash };
          fault('sivs-remediation-between-lease-expire-and-release');
        }
        const releaseDigest = sha256(canonicalJson([SIVS_REMEDIATION_DOMAIN, 'halt-release', requestDigest]));
        const released = appendPersistentEvent(leaseHead, { requestId: `remediation-release:${input.requestId}`,
          requestDigest: releaseDigest, kind: 'released', nowMs,
          expiresAt: lease.expires_at, processAuditHash: hash });
        fault('sivs-remediation-between-lease-event-and-head');
        db.prepare(`UPDATE process_controller_persistent_lease_current SET status='released',
          latest_event_seq=?,latest_event_hash=?,process_audit_hash=?
          WHERE session_id=? AND process_id=?`).run(released.seq, released.hash, hash,
          lease.session_id, input.processId);
      }
      fault('sivs-remediation-before-commit'); db.exec('COMMIT'); committed = true;
      fault('sivs-remediation-after-commit');
      return remediationPublic(event, { audit_seq: seq, event_hash: hash }, false);
    } catch (error) {
      if (!committed) try { db.exec('ROLLBACK'); } catch {}
      if (committed) {
        try {
          const row = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? AND request_key=?')
            .get(input.processId, input.requestId); const event = parseJson(row?.event_json);
          if (event?.operation === 'sivs-remediation') return remediationPublic(event, row, false);
        } catch {}
      }
      return sivsFailure(error?.code === 'PERSISTENT_CLOCK_ROLLBACK'
        ? 'PERSISTENT_CLOCK_ROLLBACK' : 'STORE_UNAVAILABLE', false);
    }
  }

  function applySivsStage(input, helpers) {
    let committed = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      const process = requireSivsProcess(input); if (process.error) return sivsReject(process.error, input);
      const remediation = isRemediationHalted(input.processId, process.current);
      if (remediation.error || remediation.halted) {
        return sivsReject(remediation.error || 'SIVS_REMEDIATION_HALTED', input);
      }
      const bound = requireSivsBinding(input, helpers, false); if (bound.error) return sivsReject(bound.error, input);
      if (bound.issued.payload.taskPath !== input.taskPath || bound.issued.payload.checklistPath !== input.checklistPath) {
        return sivsReject('SIVS_TASK_BINDING_MISMATCH', input);
      }
      const prior = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? AND request_key=?')
        .get(input.processId, input.requestId);
      if (prior) {
        const event = parseJson(prior.event_json);
        if (event?.operation !== 'sivs-stage-transition') return sivsReject('REQUEST_ID_CONFLICT', input);
        const stored = event.request;
        const digest = stored.completionEvidenceProjection
          ? sha256(canonicalJson([SIVS_COMPLETION_REQUEST_DOMAIN, input.controllerIdentity,
            'sivs-stage-transition', input.processId, input.requestId, bound.tokenSha, input.action,
            input.expectedRevision, stored.sourceState, stored.sourceResumeState, stored.evidenceProjection,
            stored.completionEvidenceProjection, stored.completionEvidenceDigest]))
          : sha256(canonicalJson(['qe-sivs-stage-request-v1', input.controllerIdentity,
            'sivs-stage-transition', input.processId, input.requestId, bound.tokenSha, input.action,
            input.expectedRevision, stored.sourceState, stored.sourceResumeState, stored.evidenceProjection]));
        if (event.controllerIdentity !== input.controllerIdentity || event.requestDigest !== digest) return sivsReject('REQUEST_ID_CONFLICT', input);
        if (prior.audit_seq !== process.current.auditSeq || prior.event_hash !== process.current.auditHash) return sivsReject('SIVS_STAGE_REPLAY_STALE', input);
        db.exec('COMMIT'); return sivsStagePublic(event, prior, true);
      }
      const completionCandidate = process.current.snapshot.state === 'supervise' && input.action === 'forward';
      const fresh = requireSivsBinding(input, helpers, completionCandidate ? 'completion' : true);
      if (fresh.error) return sivsReject(fresh.error, input);
      if (input.expectedRevision !== process.current.snapshot.revision) return sivsReject('STALE_SNAPSHOT', input);
      const proof = sivsProofProjection(input, bound, process.current);
      const p = bound.issued.payload;
      const evidenceProjection = { schema: 1, sourceState: process.current.snapshot.state,
        sourceResumeState: process.current.snapshot.resumeState ?? null,
        taskPath: p.taskPath, taskSha256: fresh.pair.task.sha256,
        checklistPath: p.checklistPath, checklistSha256: fresh.pair.checklist.sha256,
        immutableDigest: p.immutableDigest, planSlug: p.planSlug, goalId: p.goalId,
        goalAttempt: p.goalAttempt, acceptanceHash: p.acceptanceHash,
        pseProcessId: p.pseProcessId, pseRevision: p.pseRevision,
        pseAuditSeq: p.pseAuditSeq, pseAuditHash: p.pseAuditHash, proof };
      let completion = null;
      let decision;
      if (process.current.snapshot.state === 'supervise' && input.action === 'forward'
        && ['pass', 'warn'].includes(proof.status)) {
        completion = completionEvidence(bound, proof);
        if (completion.error) return sivsReject(completion.error, input);
        const cp = completion.projection; const revision = process.current.snapshot.revision;
        const attestation = (proofRef, sessionId, digest) => ({ status: 'valid', subject: 'sivs',
          revision, proofRef, issuedBy: 'sivs-controller', sessionId, digest });
        const attestations = {
          specification: attestation(`qe-sivs-completion-specification:${cp.acceptanceRowSha256}`, cp.verificationSessionId, cp.acceptanceRowSha256),
          implementation: attestation(`qe-plan-run:${cp.implementationRunId}`, cp.implementationSessionId, cp.implementationRowSha256),
          verification: attestation(`qe-sivs-verification:${cp.verificationProofDigest}`, cp.verificationSessionId, cp.verificationProofDigest),
          supervision: attestation(`qe-sivs-supervision:${cp.supervisionProofDigest}`, cp.supervisionSessionId, cp.supervisionProofDigest),
        };
        const humanAcceptance = cp.humanAcceptanceStatus === 'passed'
          ? { required: cp.humanAcceptanceRequired, status: 'passed', proofRef: `qe-plan-completion:${cp.completionRowSha256}` }
          : { required: cp.humanAcceptanceRequired, status: 'not-required' };
        const kernel = helpers.complete(process.current.snapshot, attestations, humanAcceptance);
        decision = kernel.allowed ? { to: 'complete', nextSnapshot: kernel.nextSnapshot } : { error: kernel.code };
      } else decision = stageDecision(process.current.snapshot, input.action, proof);
      if (decision.error) return sivsReject(decision.error, input);
      const completionEvidenceDigest = completion
        ? sha256(canonicalJson([SIVS_COMPLETION_EVIDENCE_DOMAIN, completion.projection])) : null;
      const evidenceDigest = completion
        ? sha256(canonicalJson(['qe-sivs-stage-evidence-v2', evidenceProjection, completion.projection]))
        : sha256(canonicalJson(['qe-sivs-stage-evidence-v1', evidenceProjection]));
      const requestDigest = completion ? sha256(canonicalJson([SIVS_COMPLETION_REQUEST_DOMAIN,
        input.controllerIdentity, 'sivs-stage-transition', input.processId, input.requestId, bound.tokenSha,
        input.action, input.expectedRevision, evidenceProjection.sourceState, evidenceProjection.sourceResumeState,
        evidenceProjection, completion.projection, completionEvidenceDigest]))
        : sha256(canonicalJson(['qe-sivs-stage-request-v1', input.controllerIdentity,
          'sivs-stage-transition', input.processId, input.requestId, bound.tokenSha, input.action,
          input.expectedRevision, evidenceProjection.sourceState, evidenceProjection.sourceResumeState,
          evidenceProjection]));
      const snapshot = decision.nextSnapshot || { state: decision.to, revision: process.current.snapshot.revision + 1 };
      if (input.action === 'block') snapshot.resumeState = process.current.snapshot.state;
      const seq = process.current.auditSeq + 1;
      const auditRequest = { processId: input.processId, requestId: input.requestId,
        action: input.action, expectedRevision: input.expectedRevision, bindingSha256: bound.tokenSha,
        sourceState: evidenceProjection.sourceState, sourceResumeState: evidenceProjection.sourceResumeState,
        evidenceProjection, evidenceDigest };
      if (completion) {
        auditRequest.completionEvidenceProjection = completion.projection;
        auditRequest.completionEvidenceDigest = completionEvidenceDigest;
      }
      const result = { allowed: true, code: 'SIVS_STAGE_TRANSITION_COMMITTED', nextSnapshot: snapshot,
        action: input.action, to: decision.to, evidenceDigest };
      const event = makeEvent({ ...input, layer: 'sivs', requestDigest, request: auditRequest }, seq,
        process.current.snapshot.revision, snapshot.revision, result, snapshot);
      const eventJson = canonicalJson(event); const hash = eventHash(PROCESS_DOMAIN, input.processId,
        seq, process.current.auditHash, eventJson);
      fault('before-state');
      const changed = db.prepare(`UPDATE process_controller_state SET snapshot_json=?,revision=?,last_audit_seq=?,last_audit_hash=?
        WHERE process_id=? AND revision=? AND last_audit_seq=? AND last_audit_hash=?`)
        .run(canonicalJson(snapshot), snapshot.revision, seq, hash, input.processId,
          process.current.snapshot.revision, process.current.auditSeq, process.current.auditHash).changes;
      if (changed !== 1) throw new Error('state CAS');
      fault('between-state-and-audit');
      db.prepare('INSERT INTO process_controller_audit VALUES(?,?,?,?,?,?,?)')
        .run(input.processId, seq, input.requestId, eventJson, process.current.auditHash, hash, Date.now());
      db.prepare(`UPDATE process_controller_sivs_remediation_current
        SET process_revision=?,process_audit_hash=? WHERE process_id=? AND status='active'`)
        .run(snapshot.revision, hash, input.processId);
      if (decision.to === 'complete') {
        fault('persistent-completion-between-process-audit-and-lease-event');
        couplePersistentCompletion(input.processId, hash);
        fault('persistent-completion-before-commit');
      }
      fault('before-commit'); db.exec('COMMIT'); committed = true;
      if (decision.to === 'complete') fault('persistent-completion-after-commit');
      fault('after-commit');
      return sivsStagePublic(event, { audit_seq: seq, event_hash: hash }, false);
    } catch (error) {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch {}
        return sivsFailure(error?.code === 'PERSISTENT_CLOCK_ROLLBACK'
          ? 'PERSISTENT_CLOCK_ROLLBACK' : 'STORE_UNAVAILABLE', false);
      }
      try {
        const row = db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? AND request_key=?')
          .get(input.processId, input.requestId); const event = parseJson(row?.event_json);
        if (event?.operation === 'sivs-stage-transition') return sivsStagePublic(event, row, false);
      } catch {}
      return sivsFailure('STORE_UNAVAILABLE', false);
    }
  }

  function metricsCorrupt() {
    return { ok: false, code: 'PROCESS_METRICS_CORRUPT' };
  }

  function validWriterRequestId(value) {
    return typeof value === 'string' && value.trim() !== ''
      && Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= 128;
  }

  function proofRequestAssertion(item, kind) {
    const p = item.proof;
    return kind === 'verification'
      ? { schema: 1, uuid: p.uuid, planSlug: p.planSlug, goalId: p.goalId,
        goalAttempt: p.goalAttempt, acceptanceHash: p.acceptanceHash,
        implementationRunId: p.implementationRunId, verificationRunId: p.verificationRunId,
        verdict: p.verdict, reviewer: p.reviewer, sessionId: p.verificationSessionId,
        findingsDigest: p.findingsDigest }
      : { schema: 1, uuid: p.uuid, planSlug: p.planSlug, goalId: p.goalId,
        goalAttempt: p.goalAttempt, acceptanceHash: p.acceptanceHash,
        verificationProofDigest: p.verificationProofDigest, verdict: p.verdict,
        supervisor: p.supervisor, sessionId: p.sessionId, riskDigest: p.riskDigest };
  }

  function validateMetricsProofs(rows, kind, bound, verifications = []) {
    const validated = validateProofRows(rows, kind, bound.row.token_sha256, bound.issued.payload);
    if (!validated) return null;
    const rowDigests = [];
    for (const item of validated) {
      if (!validWriterRequestId(item.row.request_id)) return null;
      const requestDomain = `qe-sivs-${kind}-request-v1`;
      const expected = sha256(canonicalJson([requestDomain, bound.row.controller_identity,
        item.row.process_id, item.row.request_id, bound.row.token_sha256,
        proofRequestAssertion(item, kind)]));
      if (item.row.request_digest !== expected) return null;
      if (kind === 'supervision') {
        const referenced = verifications.find(candidate => candidate.row.proof_digest
          === item.proof.verificationProofDigest);
        if (!referenced || referenced.proof.verdict !== 'PASS'
          || referenced.proof.verificationRunId !== item.proof.verificationRunId
          || referenced.proof.verificationSessionId !== item.proof.verificationSessionId) return null;
      }
      rowDigests.push(sha256(canonicalJson(['qe-sivs-proof-row-v1', kind, item.row])));
    }
    return { rows: validated, rowDigests };
  }

  function validateMetricsRemediation(processId, process, bound, verifications, supervisions,
    auditRows, current, rows) {
    if (!current) return rows.length ? null : { source: null };
    const structural = validateRemediationCurrent(processId, current, rows);
    if (structural.error || !structural.row || current.task_binding_sha256 !== bound.row.token_sha256
      || current.process_revision !== process.snapshot.revision
      || current.process_audit_hash !== process.auditHash) return null;
    const payloadKeys = ['schema', 'domain', 'processId', 'eventSeq', 'requestId', 'requestDigest',
      'kind', 'code', 'round', 'depth', 'route', 'cost', 'roundDigest', 'stagnationDigest',
      'proofKind', 'proofDigest', 'semanticFailureDigest', 'sourceRevision', 'sourceAuditHash'];
    const roundKeys = ['schema', 'taskBindingSha256', 'goalAttempt', 'acceptanceHash',
      'candidateRound', 'candidateDepth', 'route', 'cost', 'proofKind', 'proofDigest',
      'semanticFailure', 'taskSha256', 'checklistSha256', 'sourceRevision', 'sourceAuditHash'];
    const requestKeys = ['processId', 'requestId', 'expectedRevision', 'bindingSha256',
      'taskPath', 'checklistPath', 'roundProjection', 'roundDigest', 'stagnationDigest', 'nowMs'];
    const resultKeys = ['allowed', 'code', 'to', 'round', 'depth', 'halted',
      'roundDigest', 'stagnationDigest'];
    let priorRound = 0; let priorDepth = 0; let priorStagnation = null; let halted = false;
    for (const row of rows) {
      if (halted || !validWriterRequestId(row.request_id) || !Number.isSafeInteger(row.recorded_at)) return null;
      const payload = parseJson(row.payload_json);
      if (!exactKeys(payload, payloadKeys)) return null;
      const later = auditRows.find(candidate => candidate.request_key === row.request_id);
      const event = parseJson(later?.event_json);
      const source = auditRows.find(candidate => candidate.audit_seq === later?.audit_seq - 1);
      const sourceEvent = parseJson(source?.event_json);
      const sealed = sourceEvent?.request?.evidenceProjection?.proof;
      if (!later || !source || later.prev_hash !== source.event_hash
        || payload.sourceAuditHash !== source.event_hash
        || payload.sourceRevision !== event?.stateRevisionBefore
        || sourceEvent?.operation !== 'sivs-stage-transition'
        || sourceEvent?.result?.to !== 'remediate' || sealed?.kind !== 'remediation'
        || sealed?.status !== 'fail' || sealed.proofDigest !== payload.proofDigest
        || sealed.sequence !== (payload.proofKind === 'verification'
          ? verifications.rows.find(item => item.row.proof_digest === payload.proofDigest)?.row.verification_seq
          : supervisions.rows.find(item => item.row.proof_digest === payload.proofDigest)?.row.supervision_seq)
        || event?.kind !== 'decision' || event.operation !== 'sivs-remediation'
        || event.processId !== processId || event.requestId !== row.request_id
        || event.controllerIdentity !== bound.row.controller_identity
        || event.requestDigest !== row.request_digest || payload.requestDigest !== row.request_digest
        || !exactKeys(event.request, requestKeys) || !exactKeys(event.result, resultKeys)
        || !exactKeys(event.request.roundProjection, roundKeys)) return null;
      const expectedRequestDigest = sha256(canonicalJson([SIVS_REMEDIATION_DOMAIN,
        bound.row.controller_identity, processId, row.request_id, bound.row.token_sha256,
        payload.sourceRevision, bound.issued.payload.taskPath, bound.issued.payload.checklistPath]));
      const projection = event.request.roundProjection;
      if (row.request_digest !== expectedRequestDigest || event.request.processId !== processId
        || event.request.requestId !== row.request_id || event.request.expectedRevision !== payload.sourceRevision
        || event.request.bindingSha256 !== bound.row.token_sha256
        || event.request.taskPath !== bound.issued.payload.taskPath
        || event.request.checklistPath !== bound.issued.payload.checklistPath
        || event.request.nowMs !== row.recorded_at || !Number.isSafeInteger(event.request.nowMs)
        || projection.schema !== 1 || projection.taskBindingSha256 !== bound.row.token_sha256
        || projection.goalAttempt !== bound.issued.payload.goalAttempt
        || projection.acceptanceHash !== bound.issued.payload.acceptanceHash
        || projection.proofKind !== payload.proofKind || projection.proofDigest !== payload.proofDigest
        || projection.sourceRevision !== payload.sourceRevision
        || projection.sourceAuditHash !== payload.sourceAuditHash
        || !HEX64.test(projection.taskSha256) || !HEX64.test(projection.checklistSha256)) return null;
      const proofItem = payload.proofKind === 'verification'
        ? verifications.rows.find(item => item.row.proof_digest === payload.proofDigest)
        : supervisions.rows.find(item => item.row.proof_digest === payload.proofDigest);
      if (!proofItem || proofItem.proof.verdict !== 'FAIL') return null;
      const proofRowDigest = sha256(canonicalJson(['qe-sivs-proof-row-v1', payload.proofKind,
        proofItem.row]));
      const proofSequence = proofItem.row[payload.proofKind === 'verification'
        ? 'verification_seq' : 'supervision_seq'];
      const proofRunId = payload.proofKind === 'verification'
        ? proofItem.proof.verificationRunId : null;
      const proofSessionId = payload.proofKind === 'verification'
        ? proofItem.proof.verificationSessionId : proofItem.proof.sessionId;
      if (sealed.rowSha256 !== proofRowDigest || sealed.sequence !== proofSequence
        || sealed.runId !== proofRunId || sealed.sessionId !== proofSessionId
        || sealed.verdict !== 'FAIL') return null;
      let route; let cost; let semanticDigest;
      if (payload.proofKind === 'verification') {
        route = 'implement'; cost = 2;
        const failure = projection.semanticFailure;
        if (!exactKeys(failure, ['source', 'failing']) || failure.source !== 'verification-run'
          || !Array.isArray(failure.failing) || failure.failing.length < 1
          || failure.failing.some(item => !exactKeys(item, ['command', 'exitCode', 'signal', 'outputHash'])
            || typeof item.command !== 'string' || !HEX64.test(String(item.outputHash || '')))) return null;
        semanticDigest = sha256(canonicalJson(['qe-sivs-verification-failure-v1', failure.failing]));
      } else {
        route = 'verify'; cost = 1;
        if (!exactKeys(projection.semanticFailure, ['source', 'riskDigest'])
          || projection.semanticFailure.source !== 'trusted-supervisor-riskDigest'
          || projection.semanticFailure.riskDigest !== proofItem.proof.riskDigest) return null;
        semanticDigest = proofItem.proof.riskDigest;
        const verified = verifications.rows.find(item => item.row.proof_digest
          === proofItem.proof.verificationProofDigest);
        if (!verified || verified.proof.verdict !== 'PASS') return null;
      }
      const candidateRound = priorRound + 1; const candidateDepth = priorDepth + cost;
      const stagnationDigest = sha256(canonicalJson(['qe-sivs-remediation-stagnation-v1',
        bound.row.token_sha256, bound.issued.payload.acceptanceHash, route,
        payload.proofKind, semanticDigest]));
      const roundDigest = sha256(canonicalJson(['qe-sivs-remediation-round-v1', projection]));
      let code = 'SIVS_REMEDIATION_COMMITTED';
      if (priorStagnation === stagnationDigest) code = 'SIVS_REMEDIATION_STAGNATED';
      else if (candidateRound > 3) code = 'SIVS_REMEDIATION_ROUND_LIMIT';
      else if (candidateDepth > 5) code = 'SIVS_REMEDIATION_DEPTH_LIMIT';
      halted = code !== 'SIVS_REMEDIATION_COMMITTED';
      const finalRound = halted ? priorRound : candidateRound;
      const finalDepth = halted ? priorDepth : candidateDepth;
      const snapshot = halted
        ? { state: 'blocked', revision: payload.sourceRevision + 1,
          resumeState: 'remediate', remediationHalted: true }
        : { state: route, revision: payload.sourceRevision + 1 };
      if (projection.candidateRound !== candidateRound || projection.candidateDepth !== candidateDepth
        || projection.route !== route || projection.cost !== cost
        || payload.route !== route || payload.cost !== cost || payload.code !== code
        || payload.round !== finalRound || payload.depth !== finalDepth
        || payload.semanticFailureDigest !== semanticDigest
        || payload.stagnationDigest !== stagnationDigest || payload.roundDigest !== roundDigest
        || event.request.roundDigest !== roundDigest || event.request.stagnationDigest !== stagnationDigest
        || event.result.allowed !== true || event.result.code !== code
        || event.result.to !== snapshot.state || event.result.round !== finalRound
        || event.result.depth !== finalDepth || event.result.halted !== halted
        || event.result.roundDigest !== roundDigest || event.result.stagnationDigest !== stagnationDigest
        || event.stateRevisionBefore !== payload.sourceRevision
        || event.stateRevisionAfter !== payload.sourceRevision + 1
        || canonicalJson(event.snapshotAfter) !== canonicalJson(snapshot)) return null;
      if (!halted) { priorRound = candidateRound; priorDepth = candidateDepth; }
      priorStagnation = stagnationDigest;
    }
    return { source: { sequence: current.latest_event_seq, hash: current.latest_event_hash } };
  }

  function processMetrics() {
    try {
      db.exec('BEGIN');
      const stateRows = db.prepare('SELECT * FROM process_controller_state ORDER BY process_id').all();
      const allAuditRows = db.prepare('SELECT * FROM process_controller_audit ORDER BY process_id,audit_seq').all();
      const bindingRows = db.prepare('SELECT * FROM process_controller_sivs_task_binding ORDER BY process_id').all();
      const allVerificationRows = db.prepare(`SELECT * FROM process_controller_sivs_verification_proof
        ORDER BY process_id,verification_seq`).all();
      const allSupervisionRows = db.prepare(`SELECT * FROM process_controller_sivs_supervision_proof
        ORDER BY process_id,supervision_seq`).all();
      const remediationCurrentRows = db.prepare(`SELECT * FROM process_controller_sivs_remediation_current
        ORDER BY process_id`).all();
      const allRemediationRows = db.prepare(`SELECT * FROM process_controller_sivs_remediation_event
        ORDER BY process_id,event_seq`).all();
      const byProcess = rows => {
        const grouped = new Map();
        for (const row of rows) {
          const group = grouped.get(row.process_id) || [];
          group.push(row); grouped.set(row.process_id, group);
        }
        return grouped;
      };
      const states = new Map(stateRows.map(row => [row.process_id, row]));
      const audits = byProcess(allAuditRows);
      const bindings = new Map(bindingRows.map(row => [row.process_id, row]));
      const verificationsByProcess = byProcess(allVerificationRows);
      const supervisionsByProcess = byProcess(allSupervisionRows);
      const remediationCurrentByProcess = new Map(remediationCurrentRows.map(row => [row.process_id, row]));
      const remediationsByProcess = byProcess(allRemediationRows);
      const ids = [...new Set([stateRows, allAuditRows, bindingRows, allVerificationRows,
        allSupervisionRows, remediationCurrentRows, allRemediationRows]
        .flatMap(rows => rows.map(row => row.process_id)))];
      const sources = []; const logical = new Map(); let hasUnbound = false;
      for (const processId of ids) {
        if (!PROCESS_ID.test(String(processId || ''))) { db.exec('ROLLBACK'); return metricsCorrupt(); }
        const state = states.get(processId);
        const auditRows = audits.get(processId) || [];
        const process = validateProcessRows(state, auditRows);
        if (!process.ok || !['plan', 'goal', 'pse', 'sivs'].includes(process.layer)) {
          db.exec('ROLLBACK'); return metricsCorrupt();
        }
        const bindingRow = bindings.get(processId);
        const verificationRows = verificationsByProcess.get(processId) || [];
        const supervisionRows = supervisionsByProcess.get(processId) || [];
        const remediationCurrent = remediationCurrentByProcess.get(processId);
        const remediationEvents = remediationsByProcess.get(processId) || [];
        const hasAux = Boolean(bindingRow || verificationRows.length || supervisionRows.length
          || remediationCurrent || remediationEvents.length);
        if (process.layer !== 'sivs') {
          if (hasAux) { db.exec('ROLLBACK'); return metricsCorrupt(); }
          continue;
        }
        if (!bindingRow) {
          if (hasAux) { db.exec('ROLLBACK'); return metricsCorrupt(); }
          hasUnbound = true;
          sources.push({ processId, audit: { seq: process.auditSeq, hash: process.auditHash },
            binding: null, verification: null, supervision: null, remediation: null });
          continue;
        }
        const issued = sivsBindingValue(bindingRow);
        if (!issued || bindingRow.process_id !== processId) { db.exec('ROLLBACK'); return metricsCorrupt(); }
        const bound = { row: bindingRow, issued };
        const verification = validateMetricsProofs(verificationRows, 'verification', bound);
        const supervision = verification
          && validateMetricsProofs(supervisionRows, 'supervision', bound, verification.rows);
        if (!verification || !supervision) { db.exec('ROLLBACK'); return metricsCorrupt(); }
        const remediation = validateMetricsRemediation(processId, process, bound,
          verification, supervision, auditRows, remediationCurrent, remediationEvents);
        if (!remediation) { db.exec('ROLLBACK'); return metricsCorrupt(); }
        const logicalKey = [issued.payload.uuid, issued.payload.planSlug, issued.payload.goalId,
          issued.payload.goalAttempt, issued.payload.acceptanceHash];
        const key = canonicalJson(logicalKey); const group = logical.get(key) || [];
        group.push({ verification }); logical.set(key, group);
        const proofHead = (proof, kind) => proof.rows.length ? {
          sequence: proof.rows.at(-1).row[kind === 'verification' ? 'verification_seq' : 'supervision_seq'],
          digest: proof.rows.at(-1).row.proof_digest,
          ...(kind === 'verification' ? {
            firstDigest: proof.rows[0].row.proof_digest, firstRowDigest: proof.rowDigests[0],
          } : {}),
          historyDigest: sha256(canonicalJson([`qe-sivs-${kind}-history-v1`, processId,
            proof.rowDigests])),
        } : null;
        sources.push({ processId, audit: { seq: process.auditSeq, hash: process.auditHash },
          binding: { tokenSha256: bindingRow.token_sha256,
            bindingDigest: bindingRow.binding_digest, logicalKey },
          verification: proofHead(verification, 'verification'),
          supervision: proofHead(supervision, 'supervision'), remediation: remediation.source });
      }
      sources.sort((left, right) => Buffer.compare(Buffer.from(left.processId), Buffer.from(right.processId)));
      const boundTasks = logical.size;
      const verifiedTasks = [...logical.values()].filter(group => group.some(item => item.verification.rows.length)).length;
      const counts = { controllerProcesses: ids.length, sivsProcesses: sources.length,
        boundTasks, verifiedTasks };
      const metrics = METRIC_NAMES.slice(0, 5).map((name, index) => ({ name, status: 'unknown',
        reason: METRIC_UNKNOWN_REASONS[index] }));
      const ambiguous = [...logical.values()].some(group => group.length > 1);
      let passAt1;
      if (ambiguous) passAt1 = { name: 'passAt1Rate', status: 'unknown', reason: 'LOGICAL_TASK_IDENTITY_AMBIGUOUS' };
      else if (hasUnbound) passAt1 = { name: 'passAt1Rate', status: 'unknown', reason: 'UNBOUND_TASK_HISTORY_UNPROVABLE' };
      else if (boundTasks > verifiedTasks) passAt1 = { name: 'passAt1Rate', status: 'unknown', reason: 'VERIFICATION_HISTORY_UNPROVABLE' };
      else if (boundTasks === 0) passAt1 = { name: 'passAt1Rate', status: 'unknown', reason: 'VERIFICATION_PROOF_POPULATION_EMPTY' };
      else {
        const numerator = [...logical.values()].filter(group => group[0].verification.rows[0].proof.verdict === 'PASS').length;
        passAt1 = { name: 'passAt1Rate', status: 'measured', unit: 'basis-points', numerator,
          denominator: boundTasks,
          valueBasisPoints: Number((BigInt(numerator) * 10000n + BigInt(boundTasks) / 2n) / BigInt(boundTasks)) };
      }
      metrics.push(passAt1);
      const report = { schema: 1, domain: PROCESS_METRICS_DOMAIN, scope: PROCESS_METRICS_SCOPE,
        counts, sources, metrics };
      report.digest = sha256(canonicalJson([PROCESS_METRICS_DOMAIN, 1, PROCESS_METRICS_SCOPE,
        counts, sources, metrics]));
      db.exec('COMMIT');
      return report;
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return metricsCorrupt();
    }
  }

  return {
    apply,
    preparePse,
    applyPse,
    bindPse,
    applyPseStage,
    bindSivs,
    recordSivsVerification,
    recordSivsSupervision,
    applySivsStage,
    applySivsRemediation,
    acquirePersistentLease,
    renewPersistentLease,
    decidePersistentStop,
    appendControllerRejection,
    processMetrics,
    read(processId) { return processRead(db, processId); },
    audit(processId) { return db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq').all(processId); },
    close() { closeSqlite(db); },
  };
}

export const PROCESS_CONTROLLER_DOMAINS = Object.freeze({ process: PROCESS_DOMAIN, rejection: REJECTION_DOMAIN });
