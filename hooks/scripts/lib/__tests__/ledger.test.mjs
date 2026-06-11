import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGoals, append, status, renderState, readGoals, recordEvent, tailLedger } from '../ledger.mjs';

const SLUG = 'demo-plan';

/** Create a temp project root with `.qe/planning/plans/{slug}/`. @returns {string} cwd */
function makeProject(slug = SLUG) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-test-'));
  mkdirSync(path.join(dir, '.qe', 'planning', 'plans', slug), { recursive: true });
  return dir;
}

function ledgerLines(cwd, slug = SLUG) {
  const p = path.join(cwd, '.qe', 'planning', 'plans', slug, 'ledger.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];
}

test('create-goals writes ordered microgoals + one created event each', () => {
  const cwd = makeProject();
  const res = createGoals(cwd, SLUG, ['Build::Build the thing', 'Verify::Verify it']);
  assert.equal(res.created, 2);
  const doc = readGoals(cwd, SLUG);
  assert.equal(doc.goals[0].id, 'G001');
  assert.equal(doc.goals[1].objective, 'Verify it');
  assert.equal(doc.goals[0].status, 'pending');
  assert.equal(ledgerLines(cwd).length, 2);
  rmSync(cwd, { recursive: true, force: true });
});

test('create-goals is idempotent (preserves existing history)', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  const res = createGoals(cwd, SLUG, ['B::b']);
  assert.ok(res.skipped);
  assert.equal(readGoals(cwd, SLUG).goals.length, 1);
  rmSync(cwd, { recursive: true, force: true });
});

test('append is append-only: prior lines are byte-preserved, new line at end', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a', 'B::b']);
  const before = ledgerLines(cwd);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  const after = ledgerLines(cwd);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(0, before.length), before); // existing lines untouched
  assert.match(after[after.length - 1], /"event":"started"/);
  rmSync(cwd, { recursive: true, force: true });
});

test('append mutates only the target goal; bumps attempts on started', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a', 'B::b']);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  append(cwd, SLUG, { goalId: 'G001', event: 'checkpoint', status: 'complete', evidence: 'done' });
  const doc = readGoals(cwd, SLUG);
  assert.equal(doc.goals[0].status, 'complete');
  assert.equal(doc.goals[0].attempts, 1);
  assert.equal(doc.goals[1].status, 'pending'); // untouched
  rmSync(cwd, { recursive: true, force: true });
});

test('append rejects invalid event/status (schema guard)', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  assert.throws(() => append(cwd, SLUG, { goalId: 'G001', event: 'bogus' }), /invalid event/);
  assert.throws(() => append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'nope' }), /invalid status/);
  assert.throws(() => append(cwd, SLUG, { goalId: 'GXXX', event: 'started' }), /unknown goalId/);
  rmSync(cwd, { recursive: true, force: true });
});

test('atomicity: no leftover .tmp files after writes', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  renderState(cwd, SLUG);
  const dir = path.join(cwd, '.qe', 'planning', 'plans', SLUG);
  assert.ok(!readdirSync(dir).some(f => f.endsWith('.tmp')));
  rmSync(cwd, { recursive: true, force: true });
});

test('two slugs do not collide', () => {
  const cwd = makeProject('alpha');
  mkdirSync(path.join(cwd, '.qe', 'planning', 'plans', 'beta'), { recursive: true });
  createGoals(cwd, 'alpha', ['A::a']);
  createGoals(cwd, 'beta', ['B::b', 'C::c']);
  assert.equal(readGoals(cwd, 'alpha').goals.length, 1);
  assert.equal(readGoals(cwd, 'beta').goals.length, 2);
  rmSync(cwd, { recursive: true, force: true });
});

test('status uses bounded tail read on a large ledger', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  for (let i = 0; i < 1000; i++) recordEvent(cwd, SLUG, { ts: 'x', event: 'checkpoint', goalId: 'G001', status: 'active', evidence: 'e'.repeat(50), attempt: i });
  const recent = tailLedger(cwd, SLUG, 3);
  assert.equal(recent.length, 3); // only last lines parsed, not all 1001
  const s = status(cwd, SLUG);
  assert.equal(s.total, 1);
  assert.equal(s.recent.length, 3);
  rmSync(cwd, { recursive: true, force: true });
});

test('bounded tail read survives multi-byte UTF-8 past the 8KB window', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  // Korean evidence (3 bytes/char) so the >8KB tail window can split a codepoint.
  for (let i = 0; i < 300; i++) {
    recordEvent(cwd, SLUG, { ts: 'x', event: 'checkpoint', goalId: 'G001', status: 'active', evidence: `한글증거${i}`.repeat(8), attempt: i });
  }
  const recent = tailLedger(cwd, SLUG, 3);
  assert.equal(recent.length, 3);
  // every returned line parsed cleanly and kept intact Korean (no U+FFFD)
  for (const ev of recent) {
    assert.match(ev.evidence, /한글증거/);
    assert.doesNotMatch(ev.evidence, /�/);
  }
  assert.equal(recent[2].attempt, 299); // newest event preserved, not dropped
  rmSync(cwd, { recursive: true, force: true });
});

test('render-state replaces the progress block idempotently', () => {
  const cwd = makeProject();
  const sp = path.join(cwd, '.qe', 'planning', 'plans', SLUG, 'STATE.md');
  writeFileSync(sp, '# STATE\n\n## Phase Progress\n\nold\n\n## Notes\nkeep me\n');
  createGoals(cwd, SLUG, ['A::a']);
  renderState(cwd, SLUG);
  renderState(cwd, SLUG); // twice → no duplication
  const out = readFileSync(sp, 'utf8');
  assert.equal(out.match(/## Phase Progress/g).length, 1);
  assert.match(out, /G001/);
  assert.match(out, /## Notes\nkeep me/); // trailing section preserved
  assert.doesNotMatch(out, /\nold\n/);
  rmSync(cwd, { recursive: true, force: true });
});

test('Qplan SKILL.md stays within line budget (baseline 240 + 15 = 255)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  const skill = path.join(repoRoot, 'skills', 'Qplan', 'SKILL.md');
  const lines = readFileSync(skill, 'utf8').split('\n').length;
  assert.ok(lines <= 255, `Qplan/SKILL.md is ${lines} lines, budget is 255`);
});
