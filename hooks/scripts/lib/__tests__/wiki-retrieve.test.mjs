import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { wikiRetrieve, MIN_SCORE, PUSH_FLOOR } from '../../../../scripts/lib/wiki-retrieve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_CHECK = path.resolve(__dirname, '../../prompt-check.mjs');

/** Temp project root. @returns {string} */
function makeRoot() { return mkdtempSync(path.join(tmpdir(), 'wiki-retrieve-')); }
/** @param {string} d */ function mk(d) { mkdirSync(d, { recursive: true }); }
/** @param {string} f @param {string} b */ function w(f, b) { writeFileSync(f, b); }

// ── empty-wiki no-op (NFR5) ──────────────────────────────────────────────────

test('wikiRetrieve: returns [] when .qe/wiki absent (zero-cost no-op)', async () => {
  const root = makeRoot();
  try { assert.deepEqual(await wikiRetrieve('napoleon tactics', root), []); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('wikiRetrieve: empty intent → []', async () => {
  const root = makeRoot();
  mk(path.join(root, '.qe', 'wiki', 'pages'));
  try { assert.deepEqual(await wikiRetrieve('', root), []); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('PUSH_FLOOR is stricter than MIN_SCORE (noise discipline)', () => {
  assert.ok(PUSH_FLOOR > MIN_SCORE, 'push floor must exceed retrieval floor');
});

// ── MIN_SCORE floor: single weak token → [] (sparse-wiki noise guard) ─────────

test('wikiRetrieve: single-token weak match below MIN_SCORE → []', async () => {
  const root = makeRoot();
  const idx = path.join(root, '.qe', 'wiki', 'pages', 'misc', 'indexes');
  mk(idx);
  w(path.join(idx, 'entities.md'), '- [[entities/foo]] — something about widgets only\n');
  try { assert.deepEqual(await wikiRetrieve('napoleon', root), []); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

// ── no recursion: nested dirs under indexes are NOT walked ───────────────────

test('wikiRetrieve: does not recurse into nested page trees', async () => {
  const root = makeRoot();
  const topic = path.join(root, '.qe', 'wiki', 'pages', 'history');
  mk(path.join(topic, 'indexes', 'nested'));
  w(path.join(topic, 'indexes', 'entities.md'), '- [[entities/a]] — alpha beta gamma delta\n');
  // a deep nested index that must be ignored (no recursion)
  w(path.join(topic, 'indexes', 'nested', 'deep.md'), '- [[entities/deep]] — alpha beta gamma delta\n');
  try {
    const r = await wikiRetrieve('alpha beta', root);
    assert.ok(r.every((h) => h.pageRef !== 'entities/deep'), 'nested index must not be retrieved');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── prompt-check subprocess: wiki absent → additionalContext has NO [Wiki] ───

test('prompt-check: no [Wiki] hint when .qe/wiki absent (regression — zero injection)', () => {
  const root = makeRoot();
  try {
    const out = execFileSync('node', [PROMPT_CHECK], {
      input: JSON.stringify({ user_message: 'napoleon 기동전 뭐 알아', cwd: root }),
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out);
    const ctx = parsed?.hookSpecificOutput?.additionalContext || '';
    assert.ok(!ctx.includes('[Wiki]'), 'absent wiki must inject no [Wiki] hint');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prompt-check: strong match emits a [Wiki] hint (push path works)', () => {
  const root = makeRoot();
  const idx = path.join(root, '.qe', 'wiki', 'pages', 'history', 'indexes');
  mk(idx);
  w(path.join(idx, 'entities.md'), '- [[entities/napoleon]] — napoleon 기동전 코르시카 워털루 대육군\n');
  w(path.join(root, '.qe', 'wiki', 'pages', 'history', 'aliases.md'),
    '| 별칭 | 정본명 |\n| --- | --- |\n| 나폴레옹 | napoleon |\n');
  try {
    const out = execFileSync('node', [PROMPT_CHECK], {
      input: JSON.stringify({ user_message: '나폴레옹 기동전 코르시카 워털루 napoleon', cwd: root }),
      encoding: 'utf8',
    });
    const ctx = JSON.parse(out)?.hookSpecificOutput?.additionalContext || '';
    assert.ok(ctx.includes('[Wiki]'), 'strong match should emit a [Wiki] hint');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
