import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  injectCodexContext,
  resolveActiveArtifacts,
} from '../codex-context-injector.mjs';

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), 'qe-codex-context-injector-'));
}

function writeFixture(cwd, relativePath, content, mtime = new Date()) {
  const filePath = join(cwd, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  utimesSync(filePath, mtime, mtime);
  return relativePath;
}

test('injectCodexContext injects task and checklist artifact context', async () => {
  const cwd = fixtureDir();
  writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_x.md', 'task fixture body\n');
  writeFixture(cwd, '.qe/checklists/pending/VERIFY_CHECKLIST_x.md', 'checklist fixture body\n');

  const result = await injectCodexContext(cwd, { prompt: 'Implement the task.' }, 'implement');

  assert.equal(result.injected, true);
  assert.equal(result.reason, 'injected');
  assert.match(result.updatedPrompt, /Implement the task\./);
  assert.match(result.updatedPrompt, /=== TASK_REQUEST/);
  assert.match(result.updatedPrompt, /task fixture body/);
  assert.match(result.updatedPrompt, /=== VERIFY_CHECKLIST/);
  assert.match(result.updatedPrompt, /checklist fixture body/);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.kind),
    ['TASK_REQUEST', 'VERIFY_CHECKLIST']
  );
});

test('injectCodexContext does not duplicate existing injected context', async () => {
  const cwd = fixtureDir();
  writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_x.md', 'task fixture body\n');

  const result = await injectCodexContext(cwd, { prompt: 'Already here\n=== TASK_REQUEST' }, 'implement');

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'already_present');
  assert.equal(result.updatedPrompt, null);
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.warnings, []);
});

test('injectCodexContext returns no_artifacts when no active artifacts exist', async () => {
  const cwd = fixtureDir();

  const result = await injectCodexContext(cwd, { prompt: 'Verify the task.' }, 'verify');

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'no_artifacts');
  assert.equal(result.updatedPrompt, null);
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.warnings, []);
});

test('resolveActiveArtifacts prefers in-progress over pending and newest within status', () => {
  const cwd = fixtureDir();
  const old = new Date('2024-01-01T00:00:00.000Z');
  const newer = new Date('2024-01-02T00:00:00.000Z');
  const newestPending = new Date('2024-01-03T00:00:00.000Z');

  writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_pending_newest.md', 'pending newest\n', newestPending);
  writeFixture(cwd, '.qe/tasks/in-progress/TASK_REQUEST_in_progress_old.md', 'in progress old\n', old);
  writeFixture(cwd, '.qe/tasks/in-progress/TASK_REQUEST_in_progress_newer.md', 'in progress newer\n', newer);
  writeFixture(cwd, '.qe/checklists/pending/VERIFY_CHECKLIST_pending_newest.md', 'pending newest\n', newestPending);
  writeFixture(cwd, '.qe/checklists/in-progress/VERIFY_CHECKLIST_in_progress_old.md', 'in progress old\n', old);
  writeFixture(cwd, '.qe/checklists/in-progress/VERIFY_CHECKLIST_in_progress_newer.md', 'in progress newer\n', newer);

  const result = resolveActiveArtifacts(cwd);

  assert.equal(result.taskPath, '.qe/tasks/in-progress/TASK_REQUEST_in_progress_newer.md');
  assert.equal(result.checklistPath, '.qe/checklists/in-progress/VERIFY_CHECKLIST_in_progress_newer.md');
});
