import { existsSync as nativeExistsSync } from 'node:fs';
import { join } from 'node:path';

import { closeSqlite, openSqlite } from './store-sqlite.mjs';
import { canonicalJson, sha256 } from './process-controller-store.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const ROOT = '.qe/planning';

function fail(code, message = code) {
  const error = new Error(message); error.code = code; throw error;
}

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES || value.includes('\0')) {
    fail('PLAN_INPUT_INVALID', `${field} must be non-empty UTF-8 text under 1 MiB`);
  }
  return value.endsWith('\n') ? value : `${value}\n`;
}

function slugValue(value) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) fail('PLAN_INPUT_INVALID', 'invalid Plan slug');
  return value;
}

function sessionValue(value) {
  if (typeof value !== 'string' || !SESSION_RE.test(value)) fail('PLAN_INPUT_INVALID', 'invalid full session UUID');
  return value.toLowerCase();
}

function takeoverReason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\0\r\n]/.test(value)) {
    fail('PLAN_INPUT_INVALID', 'takeover reason must be one non-empty line under 1024 characters');
  }
  return value.trim();
}

function planPaths(slug) {
  const base = `${ROOT}/plans/${slug}`;
  return {
    base,
    roadmap: `${base}/ROADMAP.md`, requirements: `${base}/REQUIREMENTS.md`, state: `${base}/STATE.md`,
    goals: `${base}/goals.json`, ledger: `${base}/ledger.jsonl`, active: `${ROOT}/ACTIVE_PLAN`,
  };
}

function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function row(db, path) {
  const value = db.prepare('SELECT content,sha256 FROM qe_files WHERE path=?').get(path) || null;
  if (value && (typeof value.content !== 'string' || value.sha256 !== sha256(value.content))) {
    fail('PLAN_STORE_CORRUPT', `invalid canonical row: ${path}`);
  }
  return value;
}

function writeRow(db, path, content) {
  const now = Date.now(); const digest = sha256(content); const bytes = Buffer.byteLength(content, 'utf8');
  const current = row(db, path);
  if (current?.content === content && current.sha256 === digest) return false;
  if (current) {
    db.prepare(`UPDATE qe_files SET content=?,encoding='utf8',size=?,mode=420,mtime_ms=?,sha256=?,migrated_at=?
      WHERE path=? AND sha256=?`).run(content, bytes, now, digest, now, path, current.sha256);
  } else {
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,'utf8',?,420,?,?,?)`).run(path, content, bytes, now, digest, now);
  }
  if (db.prepare('SELECT changes() AS count').get().count !== 1) fail('PLAN_STORE_CONFLICT');
  return true;
}

function assertNoDiskSplitBrain(cwd, paths, db) {
  for (const path of Object.values(paths)) {
    if (path === paths.base) continue;
    if (nativeExistsSync(join(cwd, path)) && !row(db, path)) {
      fail('PLAN_BACKEND_CONFLICT', `disk-only Plan path must be migrated before DB initialization: ${path}`);
    }
  }
}

function validateGoalInput(goal, index) {
  if (!exactObject(goal, ['title', 'objective', 'phase', 'wave'])
    || typeof goal.title !== 'string' || !goal.title.trim()
    || typeof goal.objective !== 'string' || !goal.objective.trim()
    || typeof goal.phase !== 'string' || !goal.phase.trim()
    || typeof goal.wave !== 'string' || !goal.wave.trim()) {
    fail('PLAN_INPUT_INVALID', `invalid Goal at index ${index}`);
  }
  for (const value of Object.values(goal)) {
    if (Buffer.byteLength(value, 'utf8') > 4096 || value.includes('\0')) fail('PLAN_INPUT_INVALID');
  }
  return { id: `G${String(index + 1).padStart(3, '0')}`, title: goal.title.trim(),
    objective: goal.objective.trim(), status: 'pending', attempts: 0,
    phase: goal.phase.trim(), wave: goal.wave.trim() };
}

function validatePlanInput(input) {
  if (!exactObject(input, ['schema', 'roadmap', 'requirements', 'state', 'goals'])
    || input.schema !== 1 || !Array.isArray(input.goals) || input.goals.length < 1 || input.goals.length > 128) {
    fail('PLAN_INPUT_INVALID', 'Plan input must contain schema, three documents, and 1-128 Goals');
  }
  const goals = input.goals.map(validateGoalInput);
  let previousPhase = 0;
  for (const [index, goal] of goals.entries()) {
    const match = /^Phase ([1-9]\d*)$/.exec(goal.phase);
    if (!match) fail('PLAN_INPUT_INVALID', `Goal ${index + 1} phase must use "Phase N"`);
    const phase = Number(match[1]);
    if (phase < previousPhase || phase > previousPhase + 1 || (index === 0 && phase !== 1)) {
      fail('PLAN_INPUT_INVALID', 'Goal phases must start at Phase 1 and advance contiguously');
    }
    previousPhase = phase;
  }
  return { roadmap: text(input.roadmap, 'roadmap'), requirements: text(input.requirements, 'requirements'),
    state: text(input.state, 'state'), goals };
}

function parseBinding(current) {
  if (!current) return {};
  let value;
  try { value = JSON.parse(current.content); } catch { fail('PLAN_BINDING_CORRUPT'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PLAN_BINDING_CORRUPT');
  return value;
}

function bindInTransaction(db, slug, sessionId, paths) {
  const sessionPath = `${ROOT}/.sessions/${sessionId}.json`;
  const binding = parseBinding(row(db, sessionPath));
  const changed = [];
  if (writeRow(db, paths.active, `${slug}\n`)) changed.push(paths.active);
  if (writeRow(db, sessionPath, serialize({ ...binding, activePlanSlug: slug }))) changed.push(sessionPath);
  return changed;
}

function assertNoDiskBinding(cwd, db, sessionId) {
  const path = `${ROOT}/.sessions/${sessionId}.json`;
  if (nativeExistsSync(join(cwd, path)) && !row(db, path)) {
    fail('PLAN_BACKEND_CONFLICT', `disk-only session binding must be migrated before DB binding: ${path}`);
  }
}

function validCreatedLedger(content, goals) {
  if (typeof content !== 'string' || !content.endsWith('\n')) return false;
  const lines = content.trimEnd().split('\n');
  if (lines.length !== goals.length) return false;
  return lines.every((line, index) => {
    let event;
    try { event = JSON.parse(line); } catch { return false; }
    return exactObject(event, ['ts', 'event', 'goalId', 'status', 'evidence', 'attempt'])
      && typeof event.ts === 'string' && !Number.isNaN(Date.parse(event.ts))
      && event.event === 'created' && event.goalId === goals[index].id
      && event.status === 'pending' && event.evidence === '' && event.attempt === 0;
  });
}

export function initializePlan(cwd, { slug, sessionId, input }) {
  slug = slugValue(slug); sessionId = sessionValue(sessionId);
  const value = validatePlanInput(input); const paths = planPaths(slug);
  const db = openSqlite(cwd);
  if (!db) fail('PLAN_STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    assertNoDiskSplitBrain(cwd, paths, db);
    assertNoDiskBinding(cwd, db, sessionId);
    const existingCore = [paths.roadmap, paths.requirements, paths.state, paths.goals, paths.ledger]
      .map(path => row(db, path));
    if (existingCore.some(Boolean) && !existingCore.every(Boolean)) fail('PLAN_STORE_PARTIAL');
    const createdAt = new Date().toISOString();
    const goalsDoc = { planSlug: slug, schema: 1, createdAt, goals: value.goals };
    const ledger = value.goals.map(goal => canonicalJson({ ts: createdAt, event: 'created',
      goalId: goal.id, status: 'pending', evidence: '', attempt: 0 })).join('\n') + '\n';
    const desired = [value.roadmap, value.requirements, value.state, serialize(goalsDoc), ledger];
    const created = !existingCore.some(Boolean);
    if (!created) {
      let existingGoals;
      try { existingGoals = JSON.parse(existingCore[3].content); } catch { fail('PLAN_STORE_CORRUPT'); }
      const semanticGoals = existingGoals?.goals?.map(({ id, title, objective, status, attempts, phase, wave }) =>
        ({ id, title, objective, status, attempts, phase, wave }));
      if (existingGoals?.schema !== 1 || existingGoals?.planSlug !== slug
        || typeof existingGoals?.createdAt !== 'string' || Number.isNaN(Date.parse(existingGoals.createdAt))
        || existingCore[0].content !== value.roadmap || existingCore[1].content !== value.requirements
        || existingCore[2].content !== value.state || canonicalJson(semanticGoals) !== canonicalJson(value.goals)
        || !validCreatedLedger(existingCore[4].content, value.goals)) fail('PLAN_ALREADY_EXISTS');
    } else {
      [paths.roadmap, paths.requirements, paths.state, paths.goals, paths.ledger]
        .forEach((path, index) => writeRow(db, path, desired[index]));
    }
    const changedPaths = bindInTransaction(db, slug, sessionId, paths);
    db.exec('COMMIT');
    return { ok: true, code: created ? 'PLAN_INITIALIZED' : changedPaths.length ? 'PLAN_REBOUND' : 'PLAN_REPLAYED',
      slug, sessionId, goalIds: value.goals.map(goal => goal.id), changedPaths };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (String(error?.code || '').startsWith('PLAN_')) throw error;
    fail('PLAN_STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

export function bindPlan(cwd, { slug, sessionId }) {
  slug = slugValue(slug); sessionId = sessionValue(sessionId); const paths = planPaths(slug);
  const db = openSqlite(cwd);
  if (!db) fail('PLAN_STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    assertNoDiskSplitBrain(cwd, paths, db);
    assertNoDiskBinding(cwd, db, sessionId);
    for (const path of [paths.roadmap, paths.requirements, paths.state, paths.goals, paths.ledger]) {
      if (!row(db, path)) fail('PLAN_NOT_FOUND');
    }
    const changedPaths = bindInTransaction(db, slug, sessionId, paths);
    db.exec('COMMIT');
    return { ok: true, code: changedPaths.length ? 'PLAN_BOUND' : 'PLAN_BINDING_REPLAYED',
      slug, sessionId, changedPaths };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (String(error?.code || '').startsWith('PLAN_')) throw error;
    fail('PLAN_STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}

export function takeoverGoalOwnership(cwd, { slug, sessionId, previousSessionId, reason }) {
  slug = slugValue(slug);
  sessionId = sessionValue(sessionId);
  previousSessionId = sessionValue(previousSessionId);
  reason = takeoverReason(reason);
  if (sessionId === previousSessionId) fail('PLAN_INPUT_INVALID', 'takeover requires a different session');
  const paths = planPaths(slug);
  const db = openSqlite(cwd);
  if (!db) fail('PLAN_STORE_UNAVAILABLE');
  try {
    db.exec('BEGIN IMMEDIATE');
    assertNoDiskSplitBrain(cwd, paths, db);
    assertNoDiskBinding(cwd, db, sessionId);
    const goalsRow = row(db, paths.goals);
    const ledgerRow = row(db, paths.ledger);
    if (!goalsRow || !ledgerRow) fail('PLAN_NOT_FOUND');
    let doc;
    try { doc = JSON.parse(goalsRow.content); } catch { fail('PLAN_STORE_CORRUPT'); }
    const active = Array.isArray(doc?.goals)
      ? doc.goals.filter(goal => goal?.status === 'active') : [];
    if (active.length !== 1) fail('PLAN_GOAL_NOT_ACTIVE', 'takeover requires exactly one active Goal');
    const goal = active[0];
    const reasonHash = sha256(reason);
    if (goal.executionOwnerSession === sessionId
      && goal.ownershipTransfer?.previousSessionId === previousSessionId
      && goal.ownershipTransfer?.sessionId === sessionId
      && goal.ownershipTransfer?.reasonHash === reasonHash) {
      db.exec('COMMIT');
      return { ok: true, code: 'PLAN_GOAL_TAKEOVER_REPLAYED', slug, goalId: goal.id,
        previousSessionId, sessionId, changedPaths: [] };
    }
    if (goal.executionOwnerSession !== previousSessionId) {
      fail('PLAN_GOAL_OWNER_CONFLICT', 'active Goal owner no longer matches --previous-session');
    }
    const at = new Date().toISOString();
    goal.executionOwnerSession = sessionId;
    goal.ownershipTransfer = { previousSessionId, previousOwnerStatus: 'abandoned',
      sessionId, reasonHash, at };
    const event = canonicalJson({ ts: at, event: 'checkpoint', goalId: goal.id,
      status: 'active', evidence: `ownership-takeover ${previousSessionId} -> ${sessionId}; ${reason}`,
      attempt: goal.attempts });
    const changedPaths = [];
    if (writeRow(db, paths.goals, serialize(doc))) changedPaths.push(paths.goals);
    if (writeRow(db, paths.ledger, `${ledgerRow.content}${event}\n`)) changedPaths.push(paths.ledger);
    changedPaths.push(...bindInTransaction(db, slug, sessionId, paths));
    db.exec('COMMIT');
    return { ok: true, code: 'PLAN_GOAL_TAKEN_OVER', slug, goalId: goal.id,
      previousSessionId, sessionId, changedPaths };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (String(error?.code || '').startsWith('PLAN_')) throw error;
    fail('PLAN_STORE_UNAVAILABLE');
  } finally { closeSqlite(db); }
}
