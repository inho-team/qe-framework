/**
 * session-resolver.test.mjs
 * Unit tests for per-session partitioning of Qcompact / Qresume artifacts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  shortenSid,
  normalizeSidBucket,
  readCurrentSid,
  resolveSid,
  getSessionContextDir,
  getSessionHandoffDir,
  ensureSessionDirs,
  readSessionName,
  readSessionPlan,
  writeSessionName,
  listSessionBuckets,
  latestHandoffIn,
  resolveResumeContext,
} from '../session-resolver.mjs';

/**
 * Create an isolated temp project root for one test case. Each call returns
 * a unique directory under the OS tmpdir so parallel test cases never share
 * state; callers are responsible for `rmSync`-ing it in a finally block.
 *
 * @returns {string} absolute path to a fresh temp directory
 */
function mkroot() {
  return mkdtempSync(join(tmpdir(), 'sess-resolver-'));
}

// ---------------------------------------------------------------------------
// shortenSid
// ---------------------------------------------------------------------------

test('shortenSid: takes first 8 lowercase hex chars from UUID', () => {
  assert.equal(shortenSid('A1B2C3D4-E5F6-7890-1234-56789ABCDEF0'), 'a1b2c3d4');
});

test('shortenSid: hyphens stripped before slicing so the head is high-entropy', () => {
  assert.equal(shortenSid('--ab-cd-ef-12-34'), 'abcdef12');
});

test('shortenSid: rejects non-strings, short inputs, and empty', () => {
  assert.equal(shortenSid(undefined), null);
  assert.equal(shortenSid(null), null);
  assert.equal(shortenSid(''), null);
  assert.equal(shortenSid(12345678), null);
  assert.equal(shortenSid('abc'), null);
});

test('shortenSid: filters out non-alphanumeric noise but still slices 8 from the rest', () => {
  assert.equal(shortenSid('aa/bb..cc dd ee ff 11 22'), 'aabbccdd');
});

// ---------------------------------------------------------------------------
// normalizeSidBucket
// ---------------------------------------------------------------------------

test('normalizeSidBucket: accepts 8-char hex slugs', () => {
  assert.equal(normalizeSidBucket('a1b2c3d4'), 'a1b2c3d4');
});

test('normalizeSidBucket: accepts reserved buckets _legacy and _unknown', () => {
  assert.equal(normalizeSidBucket('_legacy'), '_legacy');
  assert.equal(normalizeSidBucket('_unknown'), '_unknown');
});

test('normalizeSidBucket: rejects path-traversal and non-canonical shapes', () => {
  assert.equal(normalizeSidBucket('..'), null);
  assert.equal(normalizeSidBucket('../etc'), null);
  assert.equal(normalizeSidBucket('a/b'), null);
  assert.equal(normalizeSidBucket('A1B2C3D4'), null); // uppercase not allowed
  assert.equal(normalizeSidBucket('a1b2c3'), null);   // too short
  assert.equal(normalizeSidBucket('a1b2c3d4e'), null); // too long
});

// ---------------------------------------------------------------------------
// readCurrentSid + resolveSid
// ---------------------------------------------------------------------------

test('readCurrentSid: returns shortened sid from state file', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/state'), { recursive: true });
    writeFileSync(
      join(root, '.qe/state/current-session.json'),
      JSON.stringify({ session_id: 'abcdef12-3456-7890-1234-56789abcdef0' })
    );
    assert.equal(readCurrentSid(root), 'abcdef12');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readCurrentSid: returns null when state file missing', () => {
  const root = mkroot();
  try {
    assert.equal(readCurrentSid(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readCurrentSid: returns null when JSON malformed', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/state'), { recursive: true });
    writeFileSync(join(root, '.qe/state/current-session.json'), '{ broken');
    assert.equal(readCurrentSid(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveSid: explicit override beats state file', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/state'), { recursive: true });
    writeFileSync(
      join(root, '.qe/state/current-session.json'),
      JSON.stringify({ session_id: 'aaaaaaaa-1111-2222-3333-444444444444' })
    );
    assert.equal(resolveSid(root, 'bbbbbbbb'), 'bbbbbbbb');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveSid: falls back to _unknown bucket when nothing resolves', () => {
  const root = mkroot();
  try {
    assert.equal(resolveSid(root, null), '_unknown');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveSid: invalid override is ignored, state is used', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/state'), { recursive: true });
    writeFileSync(
      join(root, '.qe/state/current-session.json'),
      JSON.stringify({ session_id: 'cafebabe-dead-beef-cafe-babebabebabe' })
    );
    assert.equal(resolveSid(root, '../escape'), 'cafebabe');
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

test('getSessionContextDir / getSessionHandoffDir: build sessions/{sid} path', () => {
  const root = mkroot();
  try {
    const ctx = getSessionContextDir(root, 'a1b2c3d4');
    const hof = getSessionHandoffDir(root, 'a1b2c3d4');
    assert.equal(ctx, join(root, '.qe/context/sessions/a1b2c3d4'));
    assert.equal(hof, join(root, '.qe/handoffs/sessions/a1b2c3d4'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('ensureSessionDirs: creates both directories and returns resolved sid', () => {
  const root = mkroot();
  try {
    const result = ensureSessionDirs(root, 'a1b2c3d4');
    assert.equal(result.sid, 'a1b2c3d4');
    assert.ok(existsSync(result.contextDir));
    assert.ok(existsSync(result.handoffDir));
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// sessionName helpers
// ---------------------------------------------------------------------------

test('sessionName: reads empty string when field is missing or invalid', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
    writeFileSync(join(root, '.qe/planning/.sessions/a1b2c3d4.json'), JSON.stringify({ activePlanSlug: 'x' }));
    assert.equal(readSessionName(root, 'a1b2c3d4'), '');

    writeFileSync(join(root, '.qe/planning/.sessions/a1b2c3d4.json'), JSON.stringify({ sessionName: 123 }));
    assert.equal(readSessionName(root, 'a1b2c3d4'), '');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('sessionName: write caps to 48 chars and preserves existing fields', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
    const binding = join(root, '.qe/planning/.sessions/a1b2c3d4.json');
    writeFileSync(binding, JSON.stringify({ activePlanSlug: 'plan-a', summary: 'work', custom: true }));

    const result = writeSessionName(root, 'Z'.repeat(80), 'a1b2c3d4');
    assert.equal(result.sessionName.length, 48);

    const data = JSON.parse(readFileSync(binding, 'utf8'));
    assert.equal(data.activePlanSlug, 'plan-a');
    assert.equal(data.summary, 'work');
    assert.equal(data.custom, true);
    assert.equal(data.sessionName, 'Z'.repeat(48));
    assert.ok(data.updatedAt);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('sessionName: prefers existing UUID binding to avoid splitting activePlanSlug', () => {
  const root = mkroot();
  const sessionId = 'abcdef12-3456-7890-1234-56789abcdef0';
  try {
    mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
    writeFileSync(
      join(root, `.qe/planning/.sessions/${sessionId}.json`),
      JSON.stringify({ activePlanSlug: 'uuid-plan' }),
    );

    writeSessionName(root, 'Backend terminal', sessionId);
    assert.equal(readSessionName(root, sessionId), 'Backend terminal');
    assert.equal(readSessionPlan(root, sessionId), 'uuid-plan');
    assert.equal(existsSync(join(root, '.qe/planning/.sessions/abcdef12.json')), false);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// listSessionBuckets
// ---------------------------------------------------------------------------

test('listSessionBuckets: returns buckets sorted newest-first by mtime', async () => {
  const root = mkroot();
  try {
    const a = join(root, '.qe/context/sessions/a1b2c3d4');
    const b = join(root, '.qe/context/sessions/b1b2c3d4');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'snapshot.md'), 'a');
    // small delay so b's mtime is strictly later
    await new Promise(r => setTimeout(r, 10));
    writeFileSync(join(b, 'snapshot.md'), 'b');

    const list = listSessionBuckets(root);
    assert.equal(list.length, 2);
    assert.equal(list[0].sid, 'b1b2c3d4');
    assert.equal(list[1].sid, 'a1b2c3d4');
    assert.ok(list[0].hasSnapshot);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('listSessionBuckets: skips invalid directory names', () => {
  const root = mkroot();
  try {
    mkdirSync(join(root, '.qe/context/sessions/NOPE'), { recursive: true });
    mkdirSync(join(root, '.qe/context/sessions/a1b2c3d4'), { recursive: true });
    writeFileSync(join(root, '.qe/context/sessions/a1b2c3d4/snapshot.md'), 'x');

    const list = listSessionBuckets(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].sid, 'a1b2c3d4');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('listSessionBuckets: returns empty array when sessions dir absent', () => {
  const root = mkroot();
  try {
    assert.deepEqual(listSessionBuckets(root), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('listSessionBuckets: surfaces a handoff-only bucket (the root-cause case)', () => {
  const root = mkroot();
  try {
    // Bucket exists ONLY in the handoff domain — no auto-snapshot at all.
    const hof = join(root, '.qe/handoffs/sessions/7eaa0d54');
    mkdirSync(hof, { recursive: true });
    writeFileSync(join(hof, 'HANDOFF_20260622.md'), 'handoff');

    const list = listSessionBuckets(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].sid, '7eaa0d54');
    assert.equal(list[0].hasHandoff, true);
    assert.equal(list[0].hasSnapshot, false);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('listSessionBuckets: merges a bucket present in both domains into one entry', () => {
  const root = mkroot();
  try {
    const ctx = join(root, '.qe/context/sessions/a1b2c3d4');
    const hof = join(root, '.qe/handoffs/sessions/a1b2c3d4');
    mkdirSync(ctx, { recursive: true });
    mkdirSync(hof, { recursive: true });
    writeFileSync(join(ctx, 'snapshot.md'), 'snap');
    writeFileSync(join(hof, 'HANDOFF_20260622.md'), 'handoff');

    const list = listSessionBuckets(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].sid, 'a1b2c3d4');
    assert.equal(list[0].hasSnapshot, true);
    assert.equal(list[0].hasHandoff, true);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// latestHandoffIn
// ---------------------------------------------------------------------------

test('latestHandoffIn: returns null for missing dir and non-handoff files', () => {
  const root = mkroot();
  try {
    assert.equal(latestHandoffIn(join(root, 'nope')), null);
    const dir = join(root, 'h');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.md'), 'x');
    writeFileSync(join(dir, 'HANDOFF_20260101.txt'), 'x'); // wrong ext
    assert.equal(latestHandoffIn(dir), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('latestHandoffIn: picks the newest HANDOFF_*.md by mtime', async () => {
  const root = mkroot();
  try {
    const dir = join(root, 'h');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'HANDOFF_20260101.md'), 'old');
    await new Promise((r) => setTimeout(r, 10));
    writeFileSync(join(dir, 'HANDOFF_20260622.md'), 'new');

    const latest = latestHandoffIn(dir);
    assert.ok(latest);
    assert.equal(latest.path, join(dir, 'HANDOFF_20260622.md'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// resolveResumeContext (single source of truth)
// ---------------------------------------------------------------------------

/** Point the state file at a session id so resolveSid picks up `sid`. */
function setActiveSid(root, rawSessionId) {
  mkdirSync(join(root, '.qe/state'), { recursive: true });
  writeFileSync(
    join(root, '.qe/state/current-session.json'),
    JSON.stringify({ session_id: rawSessionId })
  );
}

test('resolveResumeContext: loads active sid context when present', () => {
  const root = mkroot();
  try {
    setActiveSid(root, 'a1b2c3d4-0000-0000-0000-000000000000');
    const ctx = join(root, '.qe/context/sessions/a1b2c3d4');
    mkdirSync(ctx, { recursive: true });
    writeFileSync(join(ctx, 'snapshot.md'), 'snap');

    const r = resolveResumeContext(root, null);
    assert.equal(r.sid, 'a1b2c3d4');
    assert.equal(r.source, 'active');
    assert.equal(r.fellBackFrom, null);
    assert.equal(r.contextFiles.length, 1);
    assert.equal(r.isEmpty, false);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveResumeContext: falls back to a handoff-only bucket when active sid empty', () => {
  const root = mkroot();
  try {
    // Active session has NOTHING; a prior session left a durable handoff.
    setActiveSid(root, '8ec5fe50-0000-0000-0000-000000000000');
    const hof = join(root, '.qe/handoffs/sessions/7eaa0d54');
    mkdirSync(hof, { recursive: true });
    writeFileSync(join(hof, 'HANDOFF_20260622.md'), 'handoff');

    const r = resolveResumeContext(root, null);
    assert.equal(r.source, 'fallback');
    assert.equal(r.sid, '7eaa0d54');
    assert.equal(r.fellBackFrom, '8ec5fe50');
    assert.equal(r.latestHandoff, join(hof, 'HANDOFF_20260622.md'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveResumeContext: explicit --from is honored even when empty (no fallback)', () => {
  const root = mkroot();
  try {
    // A newer bucket exists, but the user explicitly asked for an empty one.
    const hof = join(root, '.qe/handoffs/sessions/7eaa0d54');
    mkdirSync(hof, { recursive: true });
    writeFileSync(join(hof, 'HANDOFF_20260622.md'), 'handoff');

    const r = resolveResumeContext(root, 'deadbeef');
    assert.equal(r.sid, 'deadbeef');
    assert.equal(r.source, 'empty');
    assert.equal(r.fellBackFrom, null);
    assert.equal(r.isEmpty, true);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveResumeContext: a lone compact-trigger.json does not block fallback (the real bug)', () => {
  const root = mkroot();
  try {
    // Active bucket holds ONLY a compact-trigger.json — the exact state that
    // made the original /Qresume report "no snapshot" while a real handoff
    // sat under a prior sid.
    setActiveSid(root, '8ec5fe50-0000-0000-0000-000000000000');
    const ctx = join(root, '.qe/context/sessions/8ec5fe50');
    mkdirSync(ctx, { recursive: true });
    writeFileSync(join(ctx, 'compact-trigger.json'), '{}');
    const hof = join(root, '.qe/handoffs/sessions/7eaa0d54');
    mkdirSync(hof, { recursive: true });
    writeFileSync(join(hof, 'HANDOFF_20260622.md'), 'handoff');

    const r = resolveResumeContext(root, null);
    assert.equal(r.source, 'fallback');
    assert.equal(r.sid, '7eaa0d54');
    assert.equal(r.fellBackFrom, '8ec5fe50');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('resolveResumeContext: source empty when nothing exists anywhere', () => {
  const root = mkroot();
  try {
    setActiveSid(root, 'a1b2c3d4-0000-0000-0000-000000000000');
    const r = resolveResumeContext(root, null);
    assert.equal(r.source, 'empty');
    assert.equal(r.isEmpty, true);
    assert.equal(r.fellBackFrom, null);
  } finally {
    rmSync(root, { recursive: true });
  }
});
