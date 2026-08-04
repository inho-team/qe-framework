import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  QissueError,
  parseRequest,
  prepareIssue,
  createIssue,
} from '../skills/qissue/scripts/create-issue.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'skills', 'qissue', 'scripts', 'create-issue.mjs');

function request(overrides = {}) {
  return {
    repo: 'inho-team/qe-framework',
    type: 'bug',
    title: 'trace command returns the wrong exit code',
    body: 'Steps\n1. Run the trace command\n\nExpected: exit 3\nActual: exit 1',
    ...overrides,
  };
}

test('parseRequest applies the default repository and rejects unsafe fields', () => {
  const parsed = parseRequest(JSON.stringify({ type: 'feature', title: 'Add issue adapter', body: 'Problem and proposed outcome' }));
  assert.equal(parsed.repo, 'inho-team/qe-framework');
  assert.equal(parsed.type, 'feature');
  assert.throws(
    () => parseRequest(JSON.stringify(request({ repo: '../other', title: 'bad' }))),
    error => error instanceof QissueError && error.code === 'QISSUE_INVALID_REQUEST',
  );
  assert.throws(
    () => parseRequest(JSON.stringify(request({ title: 'line one\nline two' }))),
    error => error instanceof QissueError && error.code === 'QISSUE_INVALID_REQUEST',
  );
});

test('prepareIssue appends bounded environment metadata', () => {
  const prepared = prepareIssue(parseRequest(JSON.stringify(request())), {
    qeVersion: '8.3.0',
    nodeVersion: 'v22.0.0',
    osInfo: 'TestOS arm64',
  });
  assert.match(prepared.body, /QE Framework: 8\.3\.0/);
  assert.match(prepared.body, /OS: TestOS arm64/);
  assert.match(prepared.body, /Submitted via optional Qissue adapter/);
});

test('createIssue uses direct gh argv and sends the body over stdin', () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === '--version') return { status: 0, stdout: 'gh version', stderr: '' };
    if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: 'https://github.com/inho-team/qe-framework/issues/42\n', stderr: '' };
  };
  const issue = prepareIssue(parseRequest(JSON.stringify(request())), { qeVersion: '8.3.0', nodeVersion: 'v22', osInfo: 'test' });
  const result = createIssue(issue, { spawn });
  assert.equal(result.url, 'https://github.com/inho-team/qe-framework/issues/42');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].args, ['auth', 'status', '--hostname=github.com']);
  assert.equal(calls[1].options.env.GH_HOST, 'github.com');
  assert.deepEqual(calls[2].args.slice(0, 2), ['issue', 'create']);
  assert.ok(calls[2].args.includes('--body-file=-'));
  assert.equal(calls[2].options.shell, false);
  assert.equal(calls[2].options.env.GH_HOST, 'github.com');
  assert.equal(calls[2].options.input, issue.body);
});

test('createIssue stops before mutation when gh is not authenticated', () => {
  let calls = 0;
  const spawn = (_command, args) => {
    calls += 1;
    return args[0] === '--version' ? { status: 0, stdout: '', stderr: '' } : { status: 1, stdout: '', stderr: 'not logged in' };
  };
  assert.throws(
    () => createIssue(prepareIssue(parseRequest(JSON.stringify(request()))), { spawn }),
    error => error instanceof QissueError && error.code === 'QISSUE_GH_AUTH',
  );
  assert.equal(calls, 2);
});

test('CLI dry-run validates and previews without calling gh', () => {
  const result = spawnSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    input: JSON.stringify(request()),
  });
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.repo, 'inho-team/qe-framework');
  assert.match(preview.body, /\*\*Environment\*\*/);
});
