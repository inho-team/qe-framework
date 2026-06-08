import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendGateAudit } from '../gate-audit.mjs';

/** Create an isolated temp project root for a test. @returns {string} */
function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'gate-audit-test-'));
}

test('gate-audit: writes a single newline-terminated line with the schema', () => {
  const cwd = makeTempDir();
  try {
    const r = appendGateAudit(cwd, 'verify', {
      verdict: 'PASS', agents: 3, crossmodel: 'true', route: '-', uuid: 'abc123',
      timestamp: '2026-06-08T00:00:00.000Z',
    });
    assert.equal(r.written, true);
    assert.ok(r.line.endsWith('\n'));
    const content = readFileSync(r.file, 'utf-8');
    assert.equal(
      content,
      '2026-06-08T00:00:00.000Z | verify | verdict=PASS | agents=3 | crossmodel=true | route=- | uuid=abc123\n'
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: file is named {stage}-gate.log under .qe/agent-results', () => {
  const cwd = makeTempDir();
  try {
    const r = appendGateAudit(cwd, 'supervise', { verdict: 'FAIL', uuid: 'x' });
    assert.equal(path.basename(r.file), 'supervise-gate.log');
    assert.ok(r.file.includes(path.join('.qe', 'agent-results')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: sanitizes newlines and pipes to keep one line per record', () => {
  const cwd = makeTempDir();
  try {
    const r = appendGateAudit(cwd, 'spec', {
      verdict: 'WARN\ninjected', route: 'a|b', uuid: 'u1',
      timestamp: '2026-06-08T00:00:00.000Z',
    });
    // exactly one newline (the terminator) and exactly 6 pipe delimiters
    assert.equal((r.line.match(/\n/g) || []).length, 1);
    assert.equal((r.line.match(/\|/g) || []).length, 6);
    assert.ok(r.line.includes('verdict=WARN injected'));
    assert.ok(r.line.includes('route=a b'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: unknown stage normalizes to "unknown" file', () => {
  const cwd = makeTempDir();
  try {
    const r = appendGateAudit(cwd, 'bogus', { verdict: 'PASS', uuid: 'u' });
    assert.equal(path.basename(r.file), 'unknown-gate.log');
    assert.ok(r.line.includes(' | unknown | '));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: many sequential appends each land as a whole line', () => {
  const cwd = makeTempDir();
  try {
    const N = 50;
    for (let i = 0; i < N; i++) {
      appendGateAudit(cwd, 'verify', { verdict: 'PASS', uuid: `u${i}`, timestamp: '2026-06-08T00:00:00.000Z' });
    }
    const file = path.join(cwd, '.qe', 'agent-results', 'verify-gate.log');
    assert.ok(existsSync(file));
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, N);
    for (const l of lines) assert.match(l, /^\S+ \| verify \| verdict=PASS \| /);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: value that throws on String() coercion does not throw', () => {
  const cwd = makeTempDir();
  try {
    const bad = Object.create(null); // no prototype → String() throws
    const r = appendGateAudit(cwd, 'verify', { verdict: bad, uuid: 'u', timestamp: '2026-06-08T00:00:00.000Z' });
    assert.equal(r.written, true);
    assert.ok(r.line.includes('verdict=[unstringifiable]'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate-audit: missing fields render as "-"', () => {
  const cwd = makeTempDir();
  try {
    const r = appendGateAudit(cwd, 'verify', { timestamp: '2026-06-08T00:00:00.000Z' });
    assert.equal(
      r.line,
      '2026-06-08T00:00:00.000Z | verify | verdict=- | agents=- | crossmodel=- | route=- | uuid=-\n'
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
