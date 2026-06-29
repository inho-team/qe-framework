#!/usr/bin/env node
'use strict';

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const STATUSES = new Set(['pending', 'done', 'blocked']);

function pad(n) {
  return String(n).padStart(2, '0');
}

export function timestampId(date = new Date()) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'user-action';
}

function ensureDirs(root) {
  for (const status of STATUSES) {
    mkdirSync(join(root, '.qe', 'user-actions', status), { recursive: true });
  }
}

export function userActionsRoot(root = process.cwd()) {
  return join(root, '.qe', 'user-actions');
}

function statusDir(root, status) {
  if (!STATUSES.has(status)) throw new Error(`invalid UAR status: ${status}`);
  return join(userActionsRoot(root), status);
}

function normalizeBlock(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

export function renderUserActionRequest(input = {}) {
  const title = normalizeBlock(input.title, '');
  const action = normalizeBlock(input.action, '');
  if (!title) throw new Error('title is required');
  if (!action) throw new Error('action is required');

  const created = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt || Date.now());
  const id = input.id || `${timestampId(created)}-${slugify(title)}`;
  const blocking = input.blocking === false ? 'no' : 'yes';
  const requestedBy = normalizeBlock(input.requestedBy, 'QE');
  const client = normalizeBlock(input.client, 'unknown');
  const category = normalizeBlock(input.category, 'general');

  return `# User Action Request: ${title}

Status: pending
ID: ${id}
Blocking: ${blocking}
Requested by: ${requestedBy}
Client: ${client}
Created: ${created.toISOString()}
Category: ${category}

## Why This Is Needed

${normalizeBlock(input.reason, 'The agent cannot complete this external action directly.')}

## Action

${action}

## Expected Result

${normalizeBlock(input.expectedResult, 'The required external action is complete.')}

## How To Report Back

${normalizeBlock(input.howToReport, `Reply with \`done: ${id}\`, or paste the error message.`)}

## If Blocked

${normalizeBlock(input.ifBlocked, 'Report what happened and keep this request in blocked status.')}
`;
}

export function createUserActionRequest(root = process.cwd(), input = {}) {
  ensureDirs(root);
  const created = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt || Date.now());
  const id = input.id || `${timestampId(created)}-${slugify(input.title)}`;
  const markdown = renderUserActionRequest({ ...input, id, createdAt: created });
  const filePath = join(statusDir(root, 'pending'), `${id}.md`);
  if (existsSync(filePath)) throw new Error(`UAR already exists: ${filePath}`);
  writeFileSync(filePath, markdown, 'utf8');
  return { id, status: 'pending', filePath, markdown };
}

function readStatusFromText(text) {
  const match = /^Status:\s*(\w+)/m.exec(text);
  return match ? match[1] : 'unknown';
}

function readIdFromText(text, fallback) {
  const match = /^ID:\s*(.+)$/m.exec(text);
  return match ? match[1].trim() : fallback.replace(/\.md$/i, '');
}

export function listUserActionRequests(root = process.cwd(), { status } = {}) {
  ensureDirs(root);
  const statuses = status ? [status] : [...STATUSES];
  const out = [];
  for (const current of statuses) {
    const dir = statusDir(root, current);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = join(dir, entry.name);
      const text = readFileSync(filePath, 'utf8');
      out.push({
        id: readIdFromText(text, entry.name),
        status: readStatusFromText(text),
        filePath,
        title: text.match(/^# User Action Request:\s*(.+)$/m)?.[1]?.trim() || entry.name,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function findUserActionRequest(root = process.cwd(), id) {
  if (!id) throw new Error('id is required');
  ensureDirs(root);
  for (const current of STATUSES) {
    const dir = statusDir(root, current);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = join(dir, entry.name);
      const text = readFileSync(filePath, 'utf8');
      const requestId = readIdFromText(text, entry.name);
      if (requestId === id || requestId.startsWith(id) || basename(filePath).startsWith(id)) {
        return { id: requestId, status: current, filePath, text };
      }
    }
  }
  return null;
}

export function updateUserActionStatus(root = process.cwd(), id, nextStatus, { note = '', now = new Date() } = {}) {
  if (!STATUSES.has(nextStatus)) throw new Error(`invalid UAR status: ${nextStatus}`);
  const found = findUserActionRequest(root, id);
  if (!found) throw new Error(`UAR not found: ${id}`);
  const nextPath = join(statusDir(root, nextStatus), basename(found.filePath));
  const updated = found.text
    .replace(/^Status:\s*\w+/m, `Status: ${nextStatus}`)
    + `\n## Status Update - ${now.toISOString()}\n\nMoved to \`${nextStatus}\`${note ? `: ${note}` : '.'}\n`;
  writeFileSync(found.filePath, updated, 'utf8');
  if (found.filePath !== nextPath) renameSync(found.filePath, nextPath);
  return { id: found.id, status: nextStatus, filePath: nextPath };
}
