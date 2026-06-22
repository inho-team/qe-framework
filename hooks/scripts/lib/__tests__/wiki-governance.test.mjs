import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { wikiRetrieve } from '../../../../scripts/lib/wiki-retrieve.mjs';
import { wikiFreshness } from '../../../../scripts/lib/wiki-freshness.mjs';

/** @returns {string} */ function root() { return mkdtempSync(path.join(tmpdir(), 'wiki-gov-')); }
/** @param {string} f @param {string} b */ function w(f, b) { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, b); }

// ── tier-aware retrieval (line-only) ─────────────────────────────────────────

test('wikiRetrieve: reviewed ranks above auto (tier downrank)', async () => {
  const r = root();
  try {
    w(path.join(r, '.qe', 'wiki', 'pages', 'h', 'indexes', 'entities.md'),
      '- [[entities/rev]] (tier:reviewed) — napoleon 기동전 검증본\n' +
      '- [[entities/aut]] (tier:auto) — napoleon 기동전 자동본\n');
    const res = await wikiRetrieve('napoleon 기동전', r);
    assert.equal(res[0].pageRef, 'entities/rev', 'reviewed should rank first');
    assert.equal(res[0].tier, 'reviewed');
    assert.equal(res.find((x) => x.pageRef === 'entities/aut').tier, 'auto');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('wikiRetrieve: flag:contradiction is hard-excluded (line-only, no page body needed)', async () => {
  const r = root();
  try {
    // NOTE: only an index line exists — NO page body file. Exclusion must work from the line alone.
    w(path.join(r, '.qe', 'wiki', 'pages', 'h', 'indexes', 'entities.md'),
      '- [[entities/bad]] (tier:auto,flag:contradiction) — napoleon 기동전 모순\n' +
      '- [[entities/ok]] (tier:auto) — napoleon 기동전 정상\n');
    const res = await wikiRetrieve('napoleon 기동전', r);
    assert.ok(!res.some((x) => x.pageRef === 'entities/bad'), 'contradiction page excluded');
    assert.ok(res.some((x) => x.pageRef === 'entities/ok'), 'normal page retained');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('wikiRetrieve: (tier:..) inside summary after — does NOT mis-parse (anchored)', async () => {
  const r = root();
  try {
    w(path.join(r, '.qe', 'wiki', 'pages', 'h', 'indexes', 'entities.md'),
      '- [[entities/x]] (tier:reviewed) — napoleon 기동전 설명 (tier:auto) 같은 괄호 포함\n');
    const res = await wikiRetrieve('napoleon 기동전', r);
    assert.equal(res[0].tier, 'reviewed', 'must read the anchored tier, not the one in summary');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// ── freshness (analysis mtime, not immutable raw) ────────────────────────────

test('wikiFreshness: code-linked page older than analysis → stale', async () => {
  const r = root();
  try {
    w(path.join(r, '.qe', 'analysis', 'architecture.md'), '# arch\n');
    w(path.join(r, '.qe', 'wiki', 'pages', 'h', 'old.md'),
      '---\ntype: source\nsource_file: .qe/wiki/raw/x.md\nupdated: 2020-01-01\n---\nbody\n');
    // make analysis newer than the 2020 page
    const now = Date.now() / 1000;
    utimesSync(path.join(r, '.qe', 'analysis', 'architecture.md'), now, now);
    const res = wikiFreshness(r);
    assert.ok(res.stale.some((s) => s.page.includes('old.md')), 'old code-linked page flagged stale');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('wikiFreshness: pure concept page is NEVER flagged stale (no false-positive)', async () => {
  const r = root();
  try {
    w(path.join(r, '.qe', 'analysis', 'architecture.md'), '# arch\n');
    w(path.join(r, '.qe', 'wiki', 'pages', 'h', 'concept.md'),
      '---\ntype: concept\nupdated: 2020-01-01\n---\na timeless idea\n');
    const res = wikiFreshness(r);
    assert.ok(!res.stale.some((s) => s.page.includes('concept.md')), 'concept page must not be stale');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('wikiFreshness: graceful when analysis or wiki absent', () => {
  const r = root();
  try {
    assert.deepEqual(wikiFreshness(r).stale, []);   // neither dir exists
  } finally { rmSync(r, { recursive: true, force: true }); }
});
