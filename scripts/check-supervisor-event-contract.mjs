#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const contractPath = join(root, 'docs', 'SUPERVISOR_EVENT_CONTRACT.md');
const adrPath = join(root, '.qe', 'planning', 'ADR-026-mcp-daemon-supervisor.md');
const ranks = Object.freeze({ INFO: 0, WARN: 1, FAIL: 2, CRITICAL: 3 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(existsSync(path), `missing required file: ${path}`);
  return readFileSync(path, 'utf8');
}

function event(overrides = {}) {
  return {
    schema: 'qe.supervisor.event.v1',
    event_id: 'evt_1',
    severity: 'WARN',
    source: 'qe-mcp',
    workspace: '/tmp/workspace',
    monitor_id: 'qe-mcp-doctor',
    dedupe_key: 'registry-missing',
    first_seen_at: '2026-07-01T00:00:00.000Z',
    last_seen_at: '2026-07-01T00:00:00.000Z',
    ack: { state: 'unacked', acked_at: null, acked_by: null, expires_at: null },
    summary: 'Registry missing',
    details: 'bounded detail',
    evidence_path: '.qe/state/supervisor/logs/qe-mcp-doctor.log',
    evidence_fingerprint: 'sha256:a',
    remediation_hint: 'Run Qmcp ensure',
    ...overrides,
  };
}

function identity(e) {
  return `${e.workspace}\u0000${e.source}\u0000${e.monitor_id}\u0000${e.dedupe_key}`;
}

function validate(e) {
  for (const field of [
    'schema',
    'event_id',
    'severity',
    'source',
    'workspace',
    'monitor_id',
    'dedupe_key',
    'first_seen_at',
    'last_seen_at',
    'ack',
    'summary',
    'evidence_fingerprint',
    'remediation_hint',
  ]) {
    if (!(field in e)) return false;
  }
  return e.schema === 'qe.supervisor.event.v1' && Object.hasOwn(ranks, e.severity);
}

function apply(state, incoming) {
  assert(validate(incoming), 'invalid event fixture');
  const key = identity(incoming);
  const prior = state.get(key);
  if (!prior) {
    state.set(key, incoming);
    return 'created';
  }
  if (prior.ack.state !== 'acked') return 'collapsed';
  if (
    ranks[incoming.severity] > ranks[prior.severity] ||
    incoming.evidence_fingerprint !== prior.evidence_fingerprint
  ) {
    state.set(key, { ...incoming, ack: { ...incoming.ack, state: 'unacked' } });
    return 'reopened';
  }
  return 'duplicate_hidden';
}

function parseJsonl(text) {
  if (text === null) return ['missing_file'];
  if (text === 'EACCES') return ['unreadable'];
  if (text === 'LOCKED') return ['locked'];
  const errors = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > 16 * 1024) {
      errors.push('oversized_event');
      continue;
    }
    try {
      JSON.parse(line);
    } catch {
      errors.push('malformed_or_truncated');
    }
  }
  return errors;
}

try {
  const contract = read(contractPath);
  const adr = read(adrPath);
  for (const token of [
    'internal MCP timers',
    'resident MCP scheduler loops',
    'hidden background daemon starts',
    'silent remediation',
    'source writes',
    'client config writes',
    'secret or raw environment',
    'runner delegation',
    'recursive agent/tool invocation',
    'auto-refresh',
    'qcron',
    'QE MCP Maintenance Parity Matrix',
    'workspace + monitor_id + dedupe_key',
    'duplicate after ack stays hidden',
    'higher-severity reopen',
    'same-key new-evidence reopen',
    'missing, unreadable, locked, truncated, or malformed',
    'UNSUPPORTED_PLATFORM',
    'side_effects',
  ]) {
    assert(contract.includes(token), `contract missing token: ${token}`);
  }
  assert(adr.includes('Qdebate') && adr.includes('OS-native scheduler'), 'ADR missing decision context');

  const state = new Map();
  assert(apply(state, event()) === 'created', 'valid event create failed');
  assert(apply(state, event({ event_id: 'evt_2' })) === 'collapsed', 'duplicate collapse failed');
  assert(apply(state, event({ source: 'qe-framework' })) === 'created', 'source non-collapse failed');
  assert(apply(state, event({ monitor_id: 'qe-mcp-sync-dry-run' })) === 'created', 'monitor non-collapse failed');
  const key = identity(event());
  state.get(key).ack.state = 'acked';
  assert(apply(state, event({ event_id: 'evt_3' })) === 'duplicate_hidden', 'duplicate after ack failed');
  assert(apply(state, event({ event_id: 'evt_4', severity: 'FAIL' })) === 'reopened', 'severity reopen failed');
  state.get(key).ack.state = 'acked';
  assert(apply(state, event({ event_id: 'evt_5', evidence_fingerprint: 'sha256:b' })) === 'reopened', 'evidence reopen failed');
  assert(parseJsonl('{bad').includes('malformed_or_truncated'), 'malformed fixture failed');
  assert(parseJsonl(null).includes('missing_file'), 'missing fixture failed');
  assert(parseJsonl('EACCES').includes('unreadable'), 'unreadable fixture failed');
  assert(parseJsonl('LOCKED').includes('locked'), 'locked fixture failed');
  assert(parseJsonl(`${'x'.repeat(17 * 1024)}\n`).includes('oversized_event'), 'oversized fixture failed');

  const unsupported = {
    status: 'degraded',
    error_code: 'UNSUPPORTED_PLATFORM',
    platform: 'freebsd',
    supported_platforms: ['darwin'],
    next_step: 'Use dry-run/status only or wait for a platform adapter',
    side_effects: 'none',
  };
  assert(unsupported.error_code === 'UNSUPPORTED_PLATFORM' && unsupported.side_effects === 'none', 'unsupported shape failed');
  console.log('check-supervisor-event-contract: PASS');
} catch (error) {
  console.error(`check-supervisor-event-contract: FAIL - ${error.message}`);
  process.exit(1);
}
