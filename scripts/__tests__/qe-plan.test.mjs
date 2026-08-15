import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPlanCli } from '../qe-plan.mjs';
import { closeSqlite, openSqlite } from '../../hooks/scripts/lib/store-sqlite.mjs';
import { sha256 } from '../../hooks/scripts/lib/process-controller-store.mjs';

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222';

function fixture() { return mkdtempSync(join(tmpdir(), 'qe-plan-cli-')); }

function input(overrides = {}) {
  return {
    schema: 1,
    roadmap: '# Roadmap\n\n## Phase 1\n- Build the writer\n',
    requirements: '# Requirements\n\n- R001: atomic initialization\n',
    state: '# State\n\n## Phase Progress\n',
    goals: [{ title: 'Atomic writer', objective: 'Create the Plan atomically', phase: 'Phase 1', wave: 'Wave 1' }],
    ...overrides,
  };
}

function inputFile(cwd, value = input(), name = 'plan.json') {
  const path = join(cwd, name); writeFileSync(path, JSON.stringify(value), 'utf8'); return path;
}

function rows(cwd) {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) return {};
  try { return Object.fromEntries(db.prepare('SELECT path,content FROM qe_files ORDER BY path').all().map(row => [row.path, row.content])); }
  finally { closeSqlite(db); }
}

test('init atomically creates canonical Plan documents, Goal ledger, and bindings', () => {
  const cwd = fixture();
  try {
    const result = runPlanCli(['init', '--slug', 'atomic-plan', '--session', SESSION,
      '--input', inputFile(cwd, input()), '--cwd', cwd], cwd);
    assert.equal(result.code, 'PLAN_INITIALIZED');
    assert.deepEqual(result.goalIds, ['G001']);
    const stored = rows(cwd);
    const base = '.qe/planning/plans/atomic-plan';
    for (const name of ['ROADMAP.md', 'REQUIREMENTS.md', 'STATE.md', 'goals.json', 'ledger.jsonl']) {
      assert.equal(typeof stored[`${base}/${name}`], 'string', name);
    }
    assert.equal(stored['.qe/planning/ACTIVE_PLAN'], 'atomic-plan\n');
    assert.equal(JSON.parse(stored[`.qe/planning/.sessions/${SESSION}.json`]).activePlanSlug, 'atomic-plan');
    const goals = JSON.parse(stored[`${base}/goals.json`]);
    assert.deepEqual(goals.goals.map(goal => [goal.id, goal.status, goal.attempts]), [['G001', 'pending', 0]]);
    assert.equal(JSON.parse(stored[`${base}/ledger.jsonl`].trim()).event, 'created');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('init replays exactly and rejects divergent or partial Plans without changing bindings', () => {
  const cwd = fixture();
  try {
    const file = inputFile(cwd);
    assert.equal(runPlanCli(['init', '--slug', 'replay-plan', '--session', SESSION, '--input', file], cwd).code,
      'PLAN_INITIALIZED');
    assert.equal(runPlanCli(['init', '--slug', 'replay-plan', '--session', SESSION, '--input', file], cwd).code,
      'PLAN_REPLAYED');
    const before = rows(cwd);
    const divergent = inputFile(cwd, input({ roadmap: '# Different\n' }), 'different.json');
    assert.throws(() => runPlanCli(['init', '--slug', 'replay-plan', '--session', OTHER_SESSION,
      '--input', divergent], cwd), error => error.code === 'PLAN_ALREADY_EXISTS');
    assert.deepEqual(rows(cwd), before);

    const db = openSqlite(cwd);
    const path = '.qe/planning/plans/partial-plan/ROADMAP.md'; const content = '# Partial\n'; const now = Date.now();
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,'utf8',?,420,?,?,?)`).run(path, content, Buffer.byteLength(content), now, sha256(content), now);
    closeSqlite(db);
    assert.throws(() => runPlanCli(['init', '--slug', 'partial-plan', '--session', SESSION,
      '--input', file], cwd), error => error.code === 'PLAN_STORE_PARTIAL');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('bind preserves session metadata and rejects missing or disk-only Plans', () => {
  const cwd = fixture();
  try {
    const file = inputFile(cwd);
    runPlanCli(['init', '--slug', 'bind-plan', '--session', SESSION, '--input', file], cwd);
    const db = openSqlite(cwd); const path = `.qe/planning/.sessions/${OTHER_SESSION}.json`;
    const content = `${JSON.stringify({ sessionName: 'review lane' }, null, 2)}\n`; const now = Date.now();
    db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?,'utf8',?,420,?,?,?)`).run(path, content, Buffer.byteLength(content), now, sha256(content), now);
    closeSqlite(db);
    assert.equal(runPlanCli(['bind', '--slug', 'bind-plan', '--session', OTHER_SESSION], cwd).code, 'PLAN_BOUND');
    const binding = JSON.parse(rows(cwd)[path]);
    assert.equal(binding.sessionName, 'review lane');
    assert.equal(binding.activePlanSlug, 'bind-plan');
    assert.throws(() => runPlanCli(['bind', '--slug', 'missing-plan', '--session', SESSION], cwd),
      error => error.code === 'PLAN_NOT_FOUND');

    mkdirSync(join(cwd, '.qe/planning/plans/disk-plan'), { recursive: true });
    writeFileSync(join(cwd, '.qe/planning/plans/disk-plan/ROADMAP.md'), '# Disk only\n');
    assert.throws(() => runPlanCli(['init', '--slug', 'disk-plan', '--session', SESSION,
      '--input', file], cwd), error => error.code === 'PLAN_BACKEND_CONFLICT');

    mkdirSync(join(cwd, '.qe/planning/.sessions'), { recursive: true });
    const diskSession = '33333333-3333-4333-8333-333333333333';
    writeFileSync(join(cwd, `.qe/planning/.sessions/${diskSession}.json`), JSON.stringify({ sessionName: 'disk' }));
    assert.throws(() => runPlanCli(['bind', '--slug', 'bind-plan', '--session', diskSession], cwd),
      error => error.code === 'PLAN_BACKEND_CONFLICT');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('takeover atomically transfers an active Goal with explicit CAS evidence and replays safely', () => {
  const cwd = fixture();
  try {
    runPlanCli(['init', '--slug', 'takeover-plan', '--session', SESSION,
      '--input', inputFile(cwd)], cwd);
    const db = openSqlite(cwd);
    const goalsPath = '.qe/planning/plans/takeover-plan/goals.json';
    const current = db.prepare('SELECT content FROM qe_files WHERE path=?').get(goalsPath);
    const goals = JSON.parse(current.content);
    goals.goals[0].status = 'active';
    goals.goals[0].attempts = 1;
    goals.goals[0].executionOwnerSession = SESSION;
    const content = `${JSON.stringify(goals, null, 2)}\n`; const now = Date.now();
    db.prepare('UPDATE qe_files SET content=?,size=?,mtime_ms=?,sha256=?,migrated_at=? WHERE path=?')
      .run(content, Buffer.byteLength(content), now, sha256(content), now, goalsPath);
    closeSqlite(db);

    const result = runPlanCli(['takeover', '--slug', 'takeover-plan', '--session', OTHER_SESSION,
      '--previous-session', SESSION, '--reason', 'previous process terminated before handoff'], cwd);
    assert.equal(result.code, 'PLAN_GOAL_TAKEN_OVER');
    assert.equal(result.goalId, 'G001');
    const stored = rows(cwd);
    const transferred = JSON.parse(stored[goalsPath]).goals[0];
    assert.equal(transferred.executionOwnerSession, OTHER_SESSION);
    assert.equal(transferred.ownershipTransfer.previousSessionId, SESSION);
    assert.equal(transferred.ownershipTransfer.previousOwnerStatus, 'abandoned');
    assert.equal(transferred.ownershipTransfer.sessionId, OTHER_SESSION);
    assert.match(transferred.ownershipTransfer.reasonHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.parse(stored[`.qe/planning/.sessions/${OTHER_SESSION}.json`]).activePlanSlug, 'takeover-plan');
    assert.match(stored['.qe/planning/plans/takeover-plan/ledger.jsonl'], /ownership-takeover/);

    const replay = runPlanCli(['takeover', '--slug', 'takeover-plan', '--session', OTHER_SESSION,
      '--previous-session', SESSION, '--reason', 'previous process terminated before handoff'], cwd);
    assert.equal(replay.code, 'PLAN_GOAL_TAKEOVER_REPLAYED');
    assert.throws(() => runPlanCli(['takeover', '--slug', 'takeover-plan', '--session', SESSION,
      '--previous-session', '33333333-3333-4333-8333-333333333333', '--reason', 'stale guess'], cwd),
    error => error.code === 'PLAN_GOAL_OWNER_CONFLICT');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('CLI rejects malformed options and input before opening the store', () => {
  const cwd = fixture();
  try {
    assert.throws(() => runPlanCli(['init', '--slug', 'x'], cwd), error => error.code === 'PLAN_CLI_USAGE');
    assert.throws(() => runPlanCli(['retrospective', '--slug', 'x', '--session', SESSION], cwd),
      error => error.code === 'PLAN_CLI_USAGE');
    assert.throws(() => runPlanCli(['takeover', '--slug', 'x', '--session', SESSION], cwd),
      error => error.code === 'PLAN_CLI_USAGE');
    assert.throws(() => runPlanCli(['bind', '--slug', 'x', '--session', 'short'], cwd),
      error => error.code === 'PLAN_INPUT_INVALID');
    assert.throws(() => runPlanCli(['init', '--slug', '../x', '--session', SESSION,
      '--input', inputFile(cwd)], cwd), error => error.code === 'PLAN_INPUT_INVALID');
    assert.equal(Object.keys(rows(cwd)).length, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
