import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { countInbox, countTopics, wikiSummary } from '../wiki-status.mjs';

/** Temp project root. @returns {string} */
function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), 'wiki-status-'));
}
/** Recursively create a directory. @param {string} dir */
function mk(dir) { mkdirSync(dir, { recursive: true }); }
/** Write a file (creating it). @param {string} file @param {string} [body] */
function touch(file, body = 'x') { writeFileSync(file, body); }

// ── absence = zero-cost, no output ───────────────────────────────────────────

test('wikiSummary: returns null when .qe/wiki absent (non-wiki project unchanged)', () => {
  const root = makeRoot();
  try { assert.equal(wikiSummary(root), null); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('countInbox: returns 0 when inbox absent', () => {
  const root = makeRoot();
  try { assert.equal(countInbox(root), 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── inbox counting (shallow, README excluded, ext filter) ────────────────────

test('countInbox: counts .md/.txt/.pdf, excludes README and other extensions', () => {
  const root = makeRoot();
  const inbox = path.join(root, '.qe', 'wiki', 'inbox');
  mk(inbox);
  touch(path.join(inbox, '2026-06-20-a.md'));
  touch(path.join(inbox, 'b.txt'));
  touch(path.join(inbox, 'c.pdf'));
  touch(path.join(inbox, 'README.md'));   // excluded
  touch(path.join(inbox, 'notes.json'));  // wrong ext, excluded
  try { assert.equal(countInbox(root), 3); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('countInbox: does NOT recurse into subdirectories (perf bound)', () => {
  const root = makeRoot();
  const inbox = path.join(root, '.qe', 'wiki', 'inbox');
  mk(path.join(inbox, 'nested'));
  touch(path.join(inbox, 'top.md'));
  touch(path.join(inbox, 'nested', 'deep.md')); // must NOT be counted
  try { assert.equal(countInbox(root), 1); } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── topic counting (shallow dir count) ───────────────────────────────────────

test('countTopics: counts topic dirs under pages, ignores dotfiles and files', () => {
  const root = makeRoot();
  const pages = path.join(root, '.qe', 'wiki', 'pages');
  mk(path.join(pages, 'ai-history'));
  mk(path.join(pages, 'napoleon'));
  touch(path.join(pages, 'index.md'));   // file, not a topic
  mk(path.join(pages, '.hidden'));        // dotfile dir, ignored
  try { assert.equal(countTopics(root), 2); } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── full summary ─────────────────────────────────────────────────────────────

test('wikiSummary: reports topics + inbox when wiki layer exists', () => {
  const root = makeRoot();
  mk(path.join(root, '.qe', 'wiki', 'pages', 'topic-a'));
  const inbox = path.join(root, '.qe', 'wiki', 'inbox');
  mk(inbox);
  touch(path.join(inbox, 'x.md'));
  try {
    assert.deepEqual(wikiSummary(root), { topics: 1, inbox: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('wikiSummary: empty wiki (no pages/inbox) → {0,0} not null', () => {
  const root = makeRoot();
  mk(path.join(root, '.qe', 'wiki'));
  try { assert.deepEqual(wikiSummary(root), { topics: 0, inbox: 0 }); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
