import { createHash } from 'node:crypto';
import { closeSqlite, openSqlite } from './store-sqlite.mjs';

const ZERO_HASH = '0'.repeat(64);
const PROCESS_DOMAIN = 'qe-process-controller-v1';
const REJECTION_DOMAIN = 'qe-runtime-controller-rejections-v1';
const EVENT_KEYS = [
  'schema', 'domain', 'processId', 'layer', 'auditSeq', 'kind', 'requestId',
  'controllerIdentity', 'operation', 'requestDigest', 'stateRevisionBefore',
  'stateRevisionAfter', 'allowed', 'code', 'request', 'result', 'snapshotAfter',
];

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
    CREATE TRIGGER IF NOT EXISTS process_controller_audit_no_update
      BEFORE UPDATE ON process_controller_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_audit_no_delete
      BEFORE DELETE ON process_controller_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_rejection_no_update
      BEFORE UPDATE ON process_controller_rejection_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
    CREATE TRIGGER IF NOT EXISTS process_controller_rejection_no_delete
      BEFORE DELETE ON process_controller_rejection_audit BEGIN SELECT RAISE(ABORT, 'append-only audit'); END;
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
  const db = openSqlite(cwd, { timeoutMs: options.timeoutMs ?? 5000 });
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
    fault('before-commit');
    db.exec('COMMIT');
    fault('after-commit');
    return { ...result, replayed: false, audited: true, auditSeq: seq, auditHash: hash };
  }

  return {
    apply,
    appendControllerRejection,
    read(processId) { return processRead(db, processId); },
    audit(processId) { return db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq').all(processId); },
    close() { closeSqlite(db); },
  };
}

export const PROCESS_CONTROLLER_DOMAINS = Object.freeze({ process: PROCESS_DOMAIN, rejection: REJECTION_DOMAIN });
