import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLearnings, decayScore, topLearnings, addLearning, pruneLearnings, HALF_LIFE_DAYS,
} from '../../../hooks/scripts/lib/learnings.mjs';

const NOW = Date.UTC(2026, 6, 6); // 2026-07-06
const DAY = 86_400_000;

const DOC = [
  '# Learning Registry', '', '---', '',
  '### L001: fresh critical', '- **Type**: mistake', '- **Severity**: critical',
  '- **Date**: 2026-07-05', '- **Learning**: do not repeat X', '- **Context**: hookA', '', '---', '',
  '### L002: old critical', '- **Type**: gotcha', '- **Severity**: critical',
  '- **Date**: 2026-01-01', '- **Learning**: stale gotcha', '', '---', '',
  '### L003: fresh info', '- **Type**: convention', '- **Severity**: info',
  '- **Date**: 2026-07-05', '- **Learning**: minor convention', '', '---', '',
  '### L004: resolved [RESOLVED]', '- **Type**: mistake', '- **Severity**: critical',
  '- **Date**: 2026-07-05', '- **Learning**: fixed already', '', '---', '',
].join('\n');

test('parseLearnings extracts fields and flags resolved', () => {
  const e = parseLearnings(DOC);
  assert.equal(e.length, 4);
  const l1 = e.find((x) => x.id === 'L001');
  assert.equal(l1.type, 'mistake');
  assert.equal(l1.severity, 'critical');
  assert.equal(l1.context, 'hookA');
  assert.equal(l1.date, Date.UTC(2026, 6, 5));
  assert.equal(e.find((x) => x.id === 'L004').resolved, true);
});

test('decayScore: resolved scores 0; fresh outranks old at equal severity', () => {
  const e = parseLearnings(DOC);
  const byId = Object.fromEntries(e.map((x) => [x.id, x]));
  assert.equal(decayScore(byId.L004, NOW), 0);
  assert.ok(decayScore(byId.L001, NOW) > decayScore(byId.L002, NOW), 'fresh critical > old critical');
  assert.ok(decayScore(byId.L001, NOW) > decayScore(byId.L003, NOW), 'critical > info at same age');
});

test('decayScore halves after one half-life', () => {
  const fresh = { severity: 'important', date: NOW, resolved: false };
  const aged = { severity: 'important', date: NOW - HALF_LIFE_DAYS * DAY, resolved: false };
  assert.ok(Math.abs(decayScore(aged, NOW) / decayScore(fresh, NOW) - 0.5) < 1e-9);
});

test('topLearnings returns active entries ranked by relevance, excludes resolved', () => {
  const top = topLearnings(DOC, 2, NOW);
  assert.equal(top.length, 2);
  assert.equal(top[0].id, 'L001'); // fresh critical wins
  assert.ok(!top.some((x) => x.id === 'L004')); // resolved excluded
});

test('addLearning appends a new id and creates a header when empty', () => {
  const empty = addLearning('', { type: 'convention', severity: 'info', title: 'first', learning: 'be nice' }, NOW);
  assert.equal(empty.id, 'L001');
  assert.match(empty.content, /# Learning Registry/);
  assert.match(empty.content, /### L001: first/);

  const next = addLearning(DOC, { type: 'decision', severity: 'important', title: 'chose X', learning: 'because Y' }, NOW);
  assert.equal(next.id, 'L005');
  assert.match(next.content, /### L005: chose X/);
  assert.match(next.content, /- \*\*Date\*\*: 2026-07-06/);
});

test('pruneLearnings removes resolved and decayed-below-threshold entries (dry-run object)', () => {
  const { removed, content } = pruneLearnings(DOC, { now: NOW, threshold: 0.1 });
  const removedIds = removed.map((r) => r.id).sort();
  assert.ok(removedIds.includes('L004'), 'resolved pruned');
  assert.ok(removedIds.includes('L002'), 'old critical below threshold pruned');
  assert.doesNotMatch(content, /### L004:/);
  assert.match(content, /### L001:/, 'fresh entry kept');
});
