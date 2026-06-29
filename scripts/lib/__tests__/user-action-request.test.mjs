import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createUserActionRequest,
  findUserActionRequest,
  listUserActionRequests,
  renderUserActionRequest,
  slugify,
  updateUserActionStatus,
} from '../user_action_request.mjs';

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'uar-'));
}

test('slugify produces stable ASCII slugs', () => {
  assert.equal(slugify('Approve Codex Hooks!'), 'approve-codex-hooks');
  assert.equal(slugify(''), 'user-action');
});

test('renderUserActionRequest validates required fields', () => {
  assert.throws(() => renderUserActionRequest({ title: 'Missing action' }), /action is required/);
  const text = renderUserActionRequest({
    title: 'Approve Codex hooks',
    action: 'Run /hooks and approve QE entries.',
    createdAt: new Date('2026-06-29T02:30:00Z'),
    client: 'codex',
  });
  assert.match(text, /^Status: pending$/m);
  assert.match(text, /^Blocking: yes$/m);
  assert.match(text, /^Client: codex$/m);
  assert.match(text, /Run \/hooks/);
});

test('create, list, find, and update a user action request', (t) => {
  const root = tempRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const created = createUserActionRequest(root, {
    title: 'Approve Codex hooks',
    action: 'Run /hooks and approve QE entries.',
    reason: 'Codex requires manual hook trust.',
    createdAt: new Date('2026-06-29T02:30:00Z'),
    requestedBy: 'Codex',
    client: 'codex',
    category: 'permissions',
  });

  assert.equal(created.id, '20260629-023000-approve-codex-hooks');
  assert.ok(created.filePath.endsWith('.qe/user-actions/pending/20260629-023000-approve-codex-hooks.md'));

  const pending = listUserActionRequests(root, { status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].title, 'Approve Codex hooks');

  const found = findUserActionRequest(root, '20260629-023000');
  assert.equal(found.id, created.id);

  const done = updateUserActionStatus(root, created.id, 'done', {
    note: 'hooks trusted',
    now: new Date('2026-06-29T02:45:00Z'),
  });
  assert.ok(done.filePath.includes('/done/'));
  const text = readFileSync(done.filePath, 'utf8');
  assert.match(text, /^Status: done$/m);
  assert.match(text, /hooks trusted/);
  assert.equal(listUserActionRequests(root, { status: 'pending' }).length, 0);
  assert.equal(listUserActionRequests(root, { status: 'done' }).length, 1);
});
