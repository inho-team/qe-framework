#!/usr/bin/env node
'use strict';

import { randomUUID } from 'node:crypto';
import { openSqlite } from './store-sqlite.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MEMBER_STATES = new Set(['live', 'dead', 'unknown']);

function validId(value, label) {
  const id = String(value || '');
  if (!ID_RE.test(id)) throw new Error(`invalid ${label}`);
  return id;
}

function openRuntimeDb(cwd) {
  const db = openSqlite(cwd, { timeoutMs: 5000 });
  if (!db) throw new Error('durable team runtime requires node:sqlite');
  db.exec(`CREATE TABLE IF NOT EXISTS team_runtime(
    team_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  return db;
}

function closeDb(db) {
  try { db?.close(); } catch { /* best effort */ }
}

function parseRow(row) {
  if (!row) return null;
  const state = JSON.parse(row.state_json);
  state.revision = Number(row.revision);
  return state;
}

function transact(cwd, teamId, mutate) {
  const id = validId(teamId, 'team id');
  const db = openRuntimeDb(cwd);
  try {
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT revision, state_json FROM team_runtime WHERE team_id = ?').get(id);
    const current = parseRow(row);
    const outcome = mutate(current);
    if (!outcome || !outcome.state) throw new Error('team transaction returned no state');
    const revision = current ? current.revision + 1 : 1;
    const state = { ...outcome.state, revision, updatedAt: outcome.now ?? Date.now() };
    db.prepare(`INSERT INTO team_runtime(team_id, revision, state_json, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET
        revision = excluded.revision,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at`)
      .run(id, revision, JSON.stringify(state), state.updatedAt);
    db.exec('COMMIT');
    return { ...outcome.result, state };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    throw error;
  } finally {
    closeDb(db);
  }
}

function assertTaskGraph(tasks) {
  const ids = new Set(Object.keys(tasks));
  for (const task of Object.values(tasks)) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`task ${task.id} has missing dependency ${dependency}`);
      if (dependency === task.id) throw new Error(`task ${task.id} depends on itself`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('task dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks[id].dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
}

export function createTeamRuntime(cwd, teamId, { tasks = [], members = [] } = {}) {
  const id = validId(teamId, 'team id');
  const memberMap = {};
  for (const raw of members) {
    const memberId = validId(typeof raw === 'string' ? raw : raw?.id, 'member id');
    if (memberMap[memberId]) throw new Error(`duplicate member ${memberId}`);
    memberMap[memberId] = { id: memberId, state: 'unknown', lastSeenAt: null };
  }
  const taskMap = {};
  for (const raw of tasks) {
    const taskId = validId(raw?.id, 'task id');
    if (taskMap[taskId]) throw new Error(`duplicate task ${taskId}`);
    const dependsOn = [...new Set((raw.dependsOn || []).map(value => validId(value, 'dependency id')))];
    taskMap[taskId] = { id: taskId, status: 'pending', dependsOn, claim: null, completedAt: null, result: null };
  }
  assertTaskGraph(taskMap);

  return transact(cwd, id, current => {
    if (current) throw new Error(`team runtime already exists: ${id}`);
    const now = Date.now();
    return {
      now,
      state: { schema: 1, teamId: id, tasks: taskMap, members: memberMap, mailboxes: {} },
      result: { created: true },
    };
  });
}

export function readTeamRuntime(cwd, teamId) {
  const id = validId(teamId, 'team id');
  const db = openRuntimeDb(cwd);
  try {
    return parseRow(db.prepare('SELECT revision, state_json FROM team_runtime WHERE team_id = ?').get(id));
  } finally {
    closeDb(db);
  }
}

function requireRuntime(state, teamId) {
  if (!state) throw new Error(`team runtime not found: ${teamId}`);
  return state;
}

export function claimTeamTask(cwd, teamId, { taskId, memberId, now = Date.now(), leaseMs = 30 * 60 * 1000 } = {}) {
  const taskKey = validId(taskId, 'task id');
  const memberKey = validId(memberId, 'member id');
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');

  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    const task = state.tasks[taskKey];
    if (!task) throw new Error(`task not found: ${taskKey}`);
    if (!state.members[memberKey]) throw new Error(`member not found: ${memberKey}`);
    if (task.status === 'complete') return { now, state, result: { claimed: false, reason: 'task-complete', task } };
    if (task.status === 'claimed') {
      if (task.claim.memberId === memberKey) return { now, state, result: { claimed: true, idempotent: true, task } };
      return { now, state, result: { claimed: false, reason: 'already-claimed', task } };
    }
    const incomplete = task.dependsOn.filter(id => state.tasks[id]?.status !== 'complete');
    if (incomplete.length > 0) return { now, state, result: { claimed: false, reason: 'dependencies-incomplete', dependencies: incomplete, task } };

    task.status = 'claimed';
    task.claim = { memberId: memberKey, token: randomUUID(), claimedAt: now, leaseUntil: now + leaseMs };
    state.members[memberKey] = { ...state.members[memberKey], state: 'live', lastSeenAt: now };
    return { now, state, result: { claimed: true, idempotent: false, task } };
  });
}

export function completeTeamTask(cwd, teamId, { taskId, memberId, token, result = null, now = Date.now() } = {}) {
  const taskKey = validId(taskId, 'task id');
  const memberKey = validId(memberId, 'member id');
  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    const task = state.tasks[taskKey];
    if (!task) throw new Error(`task not found: ${taskKey}`);
    if (task.status === 'complete') return { now, state, result: { completed: true, idempotent: true, task } };
    if (task.status !== 'claimed' || task.claim?.memberId !== memberKey || task.claim?.token !== token) {
      return { now, state, result: { completed: false, reason: 'claim-mismatch', task } };
    }
    task.status = 'complete';
    task.completedAt = now;
    task.result = result;
    task.claim = null;
    return { now, state, result: { completed: true, idempotent: false, task } };
  });
}

export function sendTeamMessage(cwd, teamId, { messageId = randomUUID(), to, from = 'lead', body, now = Date.now() } = {}) {
  const toId = validId(to, 'mailbox member id');
  const fromId = validId(from, 'sender id');
  const id = validId(messageId, 'message id');
  if (typeof body !== 'string' || !body.length) throw new Error('message body is required');
  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    if (!state.members[toId]) throw new Error(`member not found: ${toId}`);
    const mailbox = state.mailboxes[toId] ??= [];
    const existing = mailbox.find(message => message.id === id);
    if (existing) return { now, state, result: { queued: true, idempotent: true, message: existing } };
    const message = { id, to: toId, from: fromId, body, status: 'pending', deliveryCount: 0, createdAt: now, lastDeliveredAt: null, acknowledgedAt: null };
    mailbox.push(message);
    return { now, state, result: { queued: true, idempotent: false, message } };
  });
}

export function receiveTeamMailbox(cwd, teamId, { memberId, now = Date.now() } = {}) {
  const memberKey = validId(memberId, 'member id');
  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    if (!state.members[memberKey]) throw new Error(`member not found: ${memberKey}`);
    const messages = (state.mailboxes[memberKey] ?? []).filter(message => message.status !== 'acknowledged');
    for (const message of messages) {
      message.deliveryCount += 1;
      message.lastDeliveredAt = now;
    }
    state.members[memberKey] = { ...state.members[memberKey], state: 'live', lastSeenAt: now };
    return { now, state, result: { messages } };
  });
}

export function acknowledgeTeamMessage(cwd, teamId, { memberId, messageId, now = Date.now() } = {}) {
  const memberKey = validId(memberId, 'member id');
  const messageKey = validId(messageId, 'message id');
  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    const message = (state.mailboxes[memberKey] ?? []).find(item => item.id === messageKey);
    if (!message) return { now, state, result: { acknowledged: false, reason: 'message-not-found' } };
    const idempotent = message.status === 'acknowledged';
    message.status = 'acknowledged';
    message.acknowledgedAt ??= now;
    return { now, state, result: { acknowledged: true, idempotent, message } };
  });
}

export function reconcileTeamRuntime(cwd, teamId, { memberStates = {}, now = Date.now() } = {}) {
  return transact(cwd, teamId, current => {
    const state = requireRuntime(current, teamId);
    const classifications = {};
    for (const memberId of Object.keys(state.members).sort()) {
      const classification = MEMBER_STATES.has(memberStates[memberId]) ? memberStates[memberId] : 'unknown';
      classifications[memberId] = classification;
      state.members[memberId] = { ...state.members[memberId], state: classification };
    }

    const reclaimed = [];
    for (const task of Object.values(state.tasks).sort((a, b) => a.id.localeCompare(b.id))) {
      if (task.status !== 'claimed' || !task.claim) continue;
      const classification = classifications[task.claim.memberId] ?? 'unknown';
      const expired = task.claim.leaseUntil <= now;
      if (classification === 'dead' || (classification === 'unknown' && expired)) {
        reclaimed.push({ taskId: task.id, memberId: task.claim.memberId, reason: classification === 'dead' ? 'dead-member' : 'expired-unknown-member' });
        task.status = 'pending';
        task.claim = null;
      }
    }

    const redeliver = [];
    for (const memberId of Object.keys(state.mailboxes).sort()) {
      for (const message of state.mailboxes[memberId]) {
        if (message.status !== 'acknowledged') redeliver.push({ memberId, messageId: message.id, deliveryCount: message.deliveryCount });
      }
    }
    return { now, state, result: { classifications, reclaimed, redeliver } };
  });
}
