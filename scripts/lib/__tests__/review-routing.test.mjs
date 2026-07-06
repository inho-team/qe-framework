import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomain, classifyChanges, reviewReadiness, REVIEW_ROUTING } from '../../../hooks/scripts/lib/changed-files.mjs';

test('classifyDomain respects precedence security > test > docs > config > analysis > code', () => {
  assert.equal(classifyDomain('src/auth/login.ts'), 'security');       // security beats code
  assert.equal(classifyDomain('.env'), 'security');
  assert.equal(classifyDomain('src/lib/foo.test.ts'), 'test');          // test beats code
  assert.equal(classifyDomain('src/__tests__/foo.ts'), 'test');
  assert.equal(classifyDomain('docs/guide.md'), 'docs');
  assert.equal(classifyDomain('README.md'), 'docs');
  assert.equal(classifyDomain('config/app.yaml'), 'config');
  assert.equal(classifyDomain('.qe/analysis/report.md'), 'analysis'); // analysis path beats .md docs suffix
  assert.equal(classifyDomain('src/lib/util.mjs'), 'code');
  assert.equal(classifyDomain('assets/logo.png'), 'other');
});

test('security keyword anywhere in path wins', () => {
  assert.equal(classifyDomain('lib/jwt-helper.mjs'), 'security');
  assert.equal(classifyDomain('services/PasswordReset.py'), 'security');
});

test('classifyChanges groups files by domain', () => {
  const grouped = classifyChanges(['a.md', 'b.mjs', 'c.test.mjs', 'auth/x.ts']);
  assert.deepEqual(grouped.docs, ['a.md']);
  assert.deepEqual(grouped.code, ['b.mjs']);
  assert.deepEqual(grouped.test, ['c.test.mjs']);
  assert.deepEqual(grouped.security, ['auth/x.ts']);
});

test('reviewReadiness summarizes domains, counts, and unique reviewers', () => {
  const r = reviewReadiness(['a.mjs', 'b.mjs', 'c.md', 'auth/s.ts']);
  assert.equal(r.totalFiles, 4);
  assert.equal(r.domains[0].domain, 'code');       // most files first
  assert.equal(r.domains[0].count, 2);
  assert.deepEqual(r.domains[0].reviewers, ['Ecode-reviewer', 'Ecode-test-engineer']);
  assert.ok(r.reviewers.includes('Esecurity-officer'));
  assert.ok(r.reviewers.includes('Edocs-supervisor'));
});

test('reviewReadiness accepts a getChangedFiles-style result', () => {
  const r = reviewReadiness({ all: ['x.mjs', 'y.md'] });
  assert.equal(r.totalFiles, 2);
});

test('REVIEW_ROUTING covers every classifiable domain', () => {
  for (const d of ['security', 'test', 'docs', 'config', 'analysis', 'code', 'other']) {
    assert.ok(REVIEW_ROUTING[d], `missing routing for ${d}`);
  }
});
