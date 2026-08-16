import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assessAnalysisDrift,
  classifyStructuralPath,
  detectAnalysisDrift,
  formatAnalysisDrift,
} from '../analysis-drift.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-analysis-drift-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'qe@example.test');
  git(cwd, 'config', 'user.name', 'QE Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(cwd, 'src', 'lib'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'lib', 'base.mjs'), 'export const base = true;\n');
  git(cwd, 'add', 'src/lib/base.mjs');
  git(cwd, 'commit', '-q', '-m', 'base');
  const baseline = git(cwd, 'rev-parse', 'HEAD');
  mkdirSync(join(cwd, '.qe', 'analysis'), { recursive: true });
  writeFileSync(join(cwd, '.qe', 'analysis', 'files.json'), JSON.stringify({ git_commit: baseline }));
  return { cwd, baseline };
}

test('classifies high-signal structural paths and ignores ordinary source', () => {
  assert.equal(classifyStructuralPath('packages/ui/src/index.ts'), 'barrel');
  assert.equal(classifyStructuralPath('supabase/migrations/20260816_users.sql'), 'migration');
  assert.equal(classifyStructuralPath('src/routes/users.tsx'), 'route');
  assert.equal(classifyStructuralPath('src/lib/helper.ts'), null);
  assert.equal(classifyStructuralPath('.agents/skills/generated/SKILL.md'), null);
  assert.equal(classifyStructuralPath('.claude/settings.json'), null);
  assert.equal(classifyStructuralPath('.qe/analysis/files.json'), null);
});

test('pure detector deduplicates new directories and applies the threshold', () => {
  const result = detectAnalysisDrift({
    baselinePaths: ['src/lib/base.mjs'],
    addedPaths: ['plugins/a/one.mjs', 'plugins/a/two.mjs', 'plugins/b/one.mjs'],
    threshold: 2,
  });
  assert.deepEqual(result.elements, [
    { category: 'new_directory', path: 'plugins' },
  ]);
  assert.equal(result.actionRequired, false);
});

test('repository assessment includes committed and untracked structural additions', (t) => {
  const { cwd, baseline } = fixture(t);
  mkdirSync(join(cwd, 'packages', 'ui', 'src'), { recursive: true });
  mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(join(cwd, 'packages', 'ui', 'src', 'index.ts'), 'export {};\n');
  writeFileSync(join(cwd, 'supabase', 'migrations', '20260816_users.sql'), 'select 1;\n');
  git(cwd, 'add', 'packages/ui/src/index.ts');
  git(cwd, 'commit', '-q', '-m', 'add package');
  mkdirSync(join(cwd, 'src', 'routes'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'routes', 'users.ts'), 'export {};\n');

  const result = assessAnalysisDrift(cwd, { threshold: 3 });
  assert.equal(result.skipped, false);
  assert.equal(result.baseline, baseline);
  assert.equal(result.actionRequired, true);
  assert.deepEqual(result.elements.map((item) => item.category).sort(), ['barrel', 'migration', 'route']);
  assert.match(formatAnalysisDrift(result), /Read live sources before planning or verification/);
});

test('ordinary edits do not make the structural analysis gate actionable', (t) => {
  const { cwd } = fixture(t);
  writeFileSync(join(cwd, 'src', 'lib', 'base.mjs'), 'export const base = false;\n');
  const result = assessAnalysisDrift(cwd, { threshold: 1 });
  assert.equal(result.skipped, false);
  assert.equal(result.actionRequired, false);
  assert.deepEqual(result.elements, []);
});

test('missing and hostile baselines fail open without invoking Git with them', (t) => {
  const { cwd } = fixture(t);
  writeFileSync(join(cwd, '.qe', 'analysis', 'files.json'), JSON.stringify({ git_commit: '--upload-pack=evil' }));
  const result = assessAnalysisDrift(cwd);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'missing-analysis-baseline');
});

test('history rewrite is non-blocking but surfaces whole-analysis staleness', (t) => {
  const { cwd, baseline } = fixture(t);
  git(cwd, 'switch', '--orphan', 'rewritten');
  writeFileSync(join(cwd, 'replacement.txt'), 'replacement\n');
  git(cwd, 'add', 'replacement.txt');
  git(cwd, 'commit', '-q', '-m', 'rewrite');

  const result = assessAnalysisDrift(cwd);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'baseline-not-ancestor');
  assert.equal(result.baseline, baseline);
  assert.match(formatAnalysisDrift(result), /Treat all generated analysis as stale/);
});
