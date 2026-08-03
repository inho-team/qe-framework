/**
 * Durable, semantic idempotency ledger for replayable lifecycle hooks.
 *
 * Each hook event is split into named effects. A delivered effect is skipped
 * on replay, while pending/failed effects are attempted again. Only hashes and
 * bounded diagnostics are persisted; raw hook payloads are never stored.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from './qe-fs.mjs';
import { atomicWriteJson } from './state.mjs';

const LEDGER_FILE = '.qe/state/delivery-ledger.json';
const MAX_ENTRIES = 2048;
const MAX_ERROR_LENGTH = 240;

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function transcriptRevision(payload) {
  const transcriptPath = payload?.transcript_path || payload?.transcriptPath;
  if (!transcriptPath) return null;
  try {
    const info = statSync(transcriptPath);
    return `${transcriptPath}:${info.size}:${Math.round(info.mtimeMs || 0)}`;
  } catch {
    return String(transcriptPath);
  }
}

/** Build a stable semantic identity without retaining payload contents. */
export function semanticEventKey(eventType, payload = {}) {
  const type = String(eventType || '').trim();
  if (!type) throw new Error('delivery eventType is required');

  const explicit = payload.hook_event_id || payload.hookEventId || payload.event_id ||
    payload.eventId || payload.delivery_id || payload.deliveryId || payload.idempotency_key;
  let identity;
  if (explicit) {
    identity = `explicit:${explicit}`;
  } else if (type === 'TaskCompleted') {
    const taskId = payload.task_id || payload.taskId || payload.uuid || 'unknown-task';
    identity = `task:${taskId}:status:${payload.status || 'complete'}`;
  } else if (type === 'Stop') {
    const sessionId = payload.session_id || payload.sessionId || 'unknown-session';
    const revision = payload.turn_id || payload.turnId ||
      (typeof payload.last_assistant_message === 'string' ? `message:${hash(payload.last_assistant_message)}` : null) ||
      transcriptRevision(payload) || `payload:${hash(JSON.stringify(stable(payload)))}`;
    identity = `session:${sessionId}:revision:${revision}`;
  } else {
    identity = `payload:${hash(JSON.stringify(stable(payload)))}`;
  }
  return `${type}:${hash(identity)}`;
}

function ledgerPath(cwd) {
  return join(cwd, LEDGER_FILE);
}

function readLedger(cwd) {
  const path = ledgerPath(cwd);
  if (!existsSync(path)) return { schema: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.schema === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
  } catch {}
  return { schema: 1, entries: {} };
}

function prune(entries) {
  const rows = Object.entries(entries);
  if (rows.length <= MAX_ENTRIES) return entries;
  rows.sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || '')));
  return Object.fromEntries(rows.slice(0, MAX_ENTRIES));
}

function writeLedger(cwd, ledger) {
  atomicWriteJson(ledgerPath(cwd), { schema: 1, entries: prune(ledger.entries) });
}

function diagnostic(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);
}

/**
 * Run one named effect once per semantic event.
 * Failed or interrupted attempts remain retryable; delivered attempts dedupe.
 */
export function deliverOnce(cwd, { eventType, payload = {}, effect, run, now = () => new Date().toISOString() }) {
  if (!cwd) throw new Error('delivery cwd is required');
  if (typeof run !== 'function') throw new Error('delivery run callback is required');
  const effectName = String(effect || '').trim();
  if (!effectName) throw new Error('delivery effect is required');

  const eventKey = semanticEventKey(eventType, payload);
  const key = `${eventKey}:${hash(effectName)}`;
  const ledger = readLedger(cwd);
  const prior = ledger.entries[key];
  if (prior?.status === 'delivered') {
    return { key, eventKey, effect: effectName, status: 'duplicate', attempts: prior.attempts };
  }

  const attempts = Number(prior?.attempts || 0) + 1;
  ledger.entries[key] = {
    eventType,
    effect: effectName,
    status: 'pending',
    attempts,
    updatedAt: now(),
  };
  writeLedger(cwd, ledger);

  try {
    const value = run();
    ledger.entries[key] = {
      ...ledger.entries[key],
      status: 'delivered',
      deliveredAt: now(),
      updatedAt: now(),
    };
    writeLedger(cwd, ledger);
    return { key, eventKey, effect: effectName, status: 'delivered', attempts, value };
  } catch (error) {
    ledger.entries[key] = {
      ...ledger.entries[key],
      status: 'failed',
      error: diagnostic(error),
      updatedAt: now(),
    };
    writeLedger(cwd, ledger);
    throw error;
  }
}

/** Read-only diagnostic view used by tests and doctor-style consumers. */
export function readDeliveryLedger(cwd) {
  return readLedger(cwd);
}

