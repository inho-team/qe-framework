import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintHook } from '../scripts/lint-hooks.mjs';

test('lint explains how to fix a thrown placeholder even with an inline suppression', () => {
  const diagnostics = lintHook(
    [
      '/* eslint-disable no-restricted-syntax */',
      'export function loadGuide() {',
      '  throw new Error("Not implemented");',
      '}',
    ].join('\n'),
  );

  assert.equal(diagnostics.length, 1);
  const [error] = diagnostics;
  assert.equal(error.line, 3);
  assert.equal(error.column, 3);
  assert.match(error.message, /동작을 구현/);
  assert.match(error.message, /호출 경로/);
  assert.match(error.message, /npm run lint/);
});

test('lint accepts implemented behavior, ordinary errors, and comments that mention placeholders', () => {
  const diagnostics = lintHook(
    [
      '// Older plugins emitted throw new Error("Not implemented").',
      'export function loadGuide(file) {',
      '  if (!file) throw Error("A guide file is required");',
      '  return file.trim();',
      '}',
    ].join('\n'),
  );

  assert.deepEqual(diagnostics, []);
});

test('lint catches the Error call form and reports malformed JavaScript', () => {
  const [placeholder] = lintHook("if (ready) throw Error('Not implemented.');");
  assert.match(placeholder.message, /미구현/);

  const [syntaxError] = lintHook('function loadGuide( {');
  assert.match(syntaxError.message, /JavaScript 구문 오류/);
});

test('lint catches a fixed placeholder written as a template literal', () => {
  const diagnostics = lintHook('throw new Error(`Not implemented`);');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /미구현/);

  assert.deepEqual(lintHook('throw new Error(`Not implemented: ${feature}`);'), []);
});
