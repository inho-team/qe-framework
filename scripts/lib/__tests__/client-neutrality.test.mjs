import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveTargets, scanFiles } from '../../check-client-neutrality.mjs';

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'qe-neutrality-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}

test('client-neutrality guard fails on unmarked generic slash command', (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'docs', 'sample.md'), [
    '# Generic Runtime',
    '',
    'Run /Qinit before continuing.',
  ].join('\n'), 'utf8');

  const findings = scanFiles(root, ['docs/sample.md']);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'bare-slash-command');
});

test('client-neutrality guard allows paired Claude and Codex examples', (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'docs', 'sample.md'), [
    '# Generic Runtime',
    '',
    'Claude: /Qinit',
    'Codex: $Qinit',
    'Use {adapter.commandPrefix}Qrun-task in shared text.',
  ].join('\n'), 'utf8');

  const findings = scanFiles(root, ['docs/sample.md']);
  assert.deepEqual(findings, []);
});

test('client-neutrality guard allows client-neutral instruction artifact wording', (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'docs', 'sample.md'), [
    '# Generic Runtime',
    '',
    'Use a project instruction artifact such as `CLAUDE.md` or `AGENTS.md`.',
    'Task state belongs in `.qe/TASK_LOG.md`.',
  ].join('\n'), 'utf8');

  const findings = scanFiles(root, ['docs/sample.md']);
  assert.deepEqual(findings, []);
});

test('client-neutrality guard rejects unqualified CLAUDE-only artifact wording', (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'docs', 'sample.md'), [
    '# Generic Runtime',
    '',
    'Create CLAUDE.md before running the framework.',
  ].join('\n'), 'utf8');

  const findings = scanFiles(root, ['docs/sample.md']);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'CLAUDE.md');
});

test('client-neutrality guard allows Claude adapter sections', (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'docs', 'sample.md'), [
    '# Lifecycle',
    '',
    '## Claude Adapter',
    '',
    'Claude uses AskUserQuestion here.',
  ].join('\n'), 'utf8');

  const findings = scanFiles(root, ['docs/sample.md']);
  assert.deepEqual(findings, []);
});

test('client-neutrality guard resolves public docs targets explicitly', () => {
  const targets = resolveTargets({ mode: 'docs' });
  assert.ok(targets.includes('README.md'));
  assert.ok(targets.includes('docs/INSTALL.md'));
  assert.ok(targets.includes('docs/USAGE_GUIDE.md'));
  assert.ok(targets.includes('docs/DOCUMENTATION_MAP.md'));
  assert.ok(targets.includes('core/LIFECYCLE_ADAPTER.md'));
});
