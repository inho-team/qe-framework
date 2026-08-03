import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  checkStaleEditPrecondition,
  createLineAnchor,
  evaluateEditPrecondition,
  hashLineContent,
  staleEditPreconditionFromToolInput,
  validateLineAnchor,
} from '../stale-edit-guard.mjs';

test('matching line content hash allows the edit', () => {
  const content = 'alpha\nbeta\ngamma\n';
  const anchor = createLineAnchor(content, 2);
  const result = validateLineAnchor(content, anchor);

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'line-hash-matched');
  assert.deepEqual(result.current, { line: 2, hash: hashLineContent('beta') });
});

test('changed target line is rejected with its current line/hash remap', () => {
  const anchor = createLineAnchor('alpha\nbeta\ngamma', 2);
  const result = validateLineAnchor('alpha\nchanged\ngamma', anchor);

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'line-hash-mismatch');
  assert.deepEqual(result.remap, { line: 2, hash: hashLineContent('changed'), kind: 'current-line-changed' });
});

test('moved observed line is rejected with a unique remapped line and hash', () => {
  const anchor = createLineAnchor('alpha\nbeta\ngamma', 2);
  const result = validateLineAnchor('inserted\nalpha\nbeta\ngamma', anchor);

  assert.equal(result.allowed, false);
  assert.deepEqual(result.remap, { line: 3, hash: anchor.hash, kind: 'unique-hash-match' });
  assert.deepEqual(result.candidates, [3]);
});

test('malformed anchors and unreadable targets fail closed', () => {
  assert.equal(validateLineAnchor('alpha', { line: 1, hash: 'bad' }).reason, 'invalid-line-anchor');
  const result = evaluateEditPrecondition({
    toolName: 'Edit',
    toolInput: { file_path: '/missing/qe-stale-edit', line_anchor: { line: 1, hash: hashLineContent('alpha') } },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'edit-target-unreadable');
});

test('unanchored Edit remains compatible and passing anchors are stripped', () => {
  const unanchored = { file_path: '/tmp/a', old_string: 'a', new_string: 'b' };
  assert.deepEqual(evaluateEditPrecondition({ toolName: 'Edit', toolInput: unanchored }), {
    applies: false,
    allowed: true,
    sanitizedInput: unanchored,
  });

  const anchored = evaluateEditPrecondition({
    toolName: 'Edit',
    toolInput: { ...unanchored, line_anchor: { line: 1, hash: hashLineContent('alpha') } },
    readFile: () => 'alpha',
  });
  assert.equal(anchored.allowed, true);
  assert.equal(Object.hasOwn(anchored.sanitizedInput, 'line_anchor'), false);
});

test('multi-line compatibility envelope fails closed and returns a unique remap', () => {
  const anchor = createLineAnchor('alpha\nbeta\ngamma', 2);
  const parsed = staleEditPreconditionFromToolInput({
    file_path: 'target.txt',
    stale_edit_precondition: { observations: [anchor] },
  });
  assert.equal(parsed.filePath, 'target.txt');
  const verdict = checkStaleEditPrecondition('/workspace', parsed.filePath, parsed.observations, {
    readFile: () => 'inserted\nalpha\nbeta\ngamma',
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.conflicts[0].remap, { kind: 'unique', line: 3, hash: anchor.hash });
});

test('PreToolUse blocks stale anchored Edit and exposes a unique remap', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-stale-edit-'));
  const file = join(root, 'target.txt');
  const anchor = createLineAnchor('alpha\nbeta\ngamma', 2);
  writeFileSync(file, 'inserted\nalpha\nbeta\ngamma', 'utf8');
  const payload = {
    cwd: root,
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: 'beta', new_string: 'delta', line_anchor: anchor },
  };
  const hook = resolve('hooks/scripts/pre-tool-use.mjs');
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8' });

  assert.equal(result.status, 2, result.stdout || result.stderr);
  assert.match(result.stderr, /skill=_stale_edit/);
  assert.match(result.stderr, /unique-hash-match/);
  assert.match(result.stderr, /"line":3/);
});

test('PreToolUse allows a matching anchor and removes metadata from updatedInput', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-stale-edit-'));
  const file = join(root, 'target.txt');
  const content = 'alpha\nbeta\ngamma';
  writeFileSync(file, content, 'utf8');
  const payload = {
    cwd: root,
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: 'beta', new_string: 'delta', line_anchor: createLineAnchor(content, 2) },
  };
  const hook = resolve('hooks/scripts/pre-tool-use.mjs');
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(output.hookSpecificOutput.updatedInput, 'line_anchor'), false);
  assert.equal(output.hookSpecificOutput.updatedInput.old_string, 'beta');
});
