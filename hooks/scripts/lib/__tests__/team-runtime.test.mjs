import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  acknowledgeTeamMessage,
  claimTeamTask,
  completeTeamTask,
  createTeamRuntime,
  readTeamRuntime,
  receiveTeamMailbox,
  reconcileTeamRuntime,
  sendTeamMessage,
} from '../team-runtime.mjs';
import {
  readSessionTeamLink,
  reconcileSessionTeamRuntime,
  writeSessionTeamLink,
} from '../session-resolver.mjs';

function root() {
  return mkdtempSync(join(tmpdir(), 'qe-team-runtime-'));
}

const execFileAsync = promisify(execFile);

test('dependency-aware claims are durable, exclusive, and idempotent for the owner', () => {
  const cwd = root();
  createTeamRuntime(cwd, 'team-a', {
    members: ['alice', 'bob'],
    tasks: [{ id: 'prepare' }, { id: 'build', dependsOn: ['prepare'] }],
  });

  const blocked = claimTeamTask(cwd, 'team-a', { taskId: 'build', memberId: 'bob', now: 10 });
  assert.equal(blocked.claimed, false);
  assert.deepEqual(blocked.dependencies, ['prepare']);

  const first = claimTeamTask(cwd, 'team-a', { taskId: 'prepare', memberId: 'alice', now: 20 });
  const duplicate = claimTeamTask(cwd, 'team-a', { taskId: 'prepare', memberId: 'alice', now: 21 });
  const competing = claimTeamTask(cwd, 'team-a', { taskId: 'prepare', memberId: 'bob', now: 22 });
  assert.equal(first.claimed, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.task.claim.token, first.task.claim.token);
  assert.equal(competing.claimed, false);
  assert.equal(competing.reason, 'already-claimed');

  const completed = completeTeamTask(cwd, 'team-a', {
    taskId: 'prepare', memberId: 'alice', token: first.task.claim.token, result: 'ok', now: 30,
  });
  assert.equal(completed.completed, true);
  assert.equal(claimTeamTask(cwd, 'team-a', { taskId: 'build', memberId: 'bob', now: 40 }).claimed, true);
  assert.equal(readTeamRuntime(cwd, 'team-a').tasks.prepare.result, 'ok');
});

test('concurrent processes atomically select only one task owner', async () => {
  const cwd = root();
  createTeamRuntime(cwd, 'team-race', { members: ['alice', 'bob'], tasks: [{ id: 'task' }] });
  const moduleUrl = pathToFileURL(resolve('hooks/scripts/lib/team-runtime.mjs')).href;
  const claim = async (memberId) => {
    const source = `import { claimTeamTask } from ${JSON.stringify(moduleUrl)};` +
      `const result = claimTeamTask(${JSON.stringify(cwd)}, 'team-race', {taskId:'task', memberId:${JSON.stringify(memberId)}, now:10});` +
      `process.stdout.write(JSON.stringify({claimed:result.claimed, reason:result.reason || null, owner:result.task.claim?.memberId || null}));`;
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
    return JSON.parse(stdout);
  };

  const results = await Promise.all([claim('alice'), claim('bob')]);
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(results.filter(result => result.reason === 'already-claimed').length, 1);
  assert.equal(readTeamRuntime(cwd, 'team-race').tasks.task.claim.memberId, results.find(result => result.claimed).owner);
});

test('mailbox delivery is at-least-once until durable acknowledgement', () => {
  const cwd = root();
  createTeamRuntime(cwd, 'team-mail', { members: ['alice'] });
  sendTeamMessage(cwd, 'team-mail', { messageId: 'msg-1', to: 'alice', body: 'review', now: 10 });
  assert.equal(sendTeamMessage(cwd, 'team-mail', { messageId: 'msg-1', to: 'alice', body: 'review', now: 11 }).idempotent, true);

  const first = receiveTeamMailbox(cwd, 'team-mail', { memberId: 'alice', now: 20 });
  const retry = receiveTeamMailbox(cwd, 'team-mail', { memberId: 'alice', now: 30 });
  assert.equal(first.messages.length, 1);
  assert.equal(retry.messages[0].deliveryCount, 2);
  assert.equal(acknowledgeTeamMessage(cwd, 'team-mail', { memberId: 'alice', messageId: 'msg-1', now: 40 }).acknowledged, true);
  assert.deepEqual(receiveTeamMailbox(cwd, 'team-mail', { memberId: 'alice', now: 50 }).messages, []);
});

test('resume reconciliation preserves completed work and reclaims dead or expired unknown claims', () => {
  const cwd = root();
  createTeamRuntime(cwd, 'team-resume', {
    members: ['live-one', 'dead-one', 'unknown-one'],
    tasks: [{ id: 'done' }, { id: 'dead-task' }, { id: 'unknown-task' }],
  });
  const done = claimTeamTask(cwd, 'team-resume', { taskId: 'done', memberId: 'live-one', now: 10 });
  completeTeamTask(cwd, 'team-resume', { taskId: 'done', memberId: 'live-one', token: done.task.claim.token, now: 20 });
  claimTeamTask(cwd, 'team-resume', { taskId: 'dead-task', memberId: 'dead-one', now: 30, leaseMs: 1000 });
  claimTeamTask(cwd, 'team-resume', { taskId: 'unknown-task', memberId: 'unknown-one', now: 30, leaseMs: 10 });
  sendTeamMessage(cwd, 'team-resume', { messageId: 'resume-msg', to: 'dead-one', body: 'pending', now: 40 });

  const result = reconcileTeamRuntime(cwd, 'team-resume', {
    memberStates: { 'live-one': 'live', 'dead-one': 'dead', 'unknown-one': 'unknown' },
    now: 100,
  });
  assert.deepEqual(result.classifications, { 'dead-one': 'dead', 'live-one': 'live', 'unknown-one': 'unknown' });
  assert.deepEqual(result.reclaimed.map(item => item.taskId), ['dead-task', 'unknown-task']);
  assert.deepEqual(result.redeliver, [{ memberId: 'dead-one', messageId: 'resume-msg', deliveryCount: 0 }]);
  assert.equal(result.state.tasks.done.status, 'complete');
  assert.equal(result.state.tasks['dead-task'].status, 'pending');
});

test('live and unexpired unknown reservations survive reconciliation', () => {
  const cwd = root();
  createTeamRuntime(cwd, 'team-live', { members: ['alice', 'bob'], tasks: [{ id: 'a' }, { id: 'b' }] });
  claimTeamTask(cwd, 'team-live', { taskId: 'a', memberId: 'alice', now: 10, leaseMs: 100 });
  claimTeamTask(cwd, 'team-live', { taskId: 'b', memberId: 'bob', now: 10, leaseMs: 100 });
  const result = reconcileTeamRuntime(cwd, 'team-live', { memberStates: { alice: 'live', bob: 'unknown' }, now: 20 });
  assert.deepEqual(result.reclaimed, []);
  assert.equal(result.state.tasks.a.status, 'claimed');
  assert.equal(result.state.tasks.b.status, 'claimed');
});

test('session binding drives deterministic team resume reconciliation', () => {
  const cwd = root();
  const session = '11111111-2222-4333-8444-555555555555';
  createTeamRuntime(cwd, 'team-session', { members: ['worker'], tasks: [{ id: 'task' }] });
  claimTeamTask(cwd, 'team-session', { taskId: 'task', memberId: 'worker', now: 10, leaseMs: 10 });
  writeSessionTeamLink(cwd, { teamId: 'team-session', memberId: 'worker' }, session);
  assert.deepEqual(readSessionTeamLink(cwd, session), { teamId: 'team-session', memberId: 'worker' });

  const resumed = reconcileSessionTeamRuntime(cwd, session, { memberStates: { worker: 'dead' }, now: 30 });
  assert.equal(resumed.linked, true);
  assert.deepEqual(resumed.reclaimed.map(item => item.taskId), ['task']);
  assert.equal(readTeamRuntime(cwd, 'team-session').tasks.task.status, 'pending');
});
