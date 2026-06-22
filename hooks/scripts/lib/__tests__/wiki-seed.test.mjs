import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { wikiSeedSelf } from '../../../../scripts/lib/wiki-seed.mjs';

/** @returns {string} */ function root() { return mkdtempSync(path.join(tmpdir(), 'wiki-seed-')); }
/** @param {string} d */ function mk(d) { mkdirSync(d, { recursive: true }); }
/** @param {string} f @param {string} b */ function w(f, b) { mk(path.dirname(f)); writeFileSync(f, b); }
/** @param {string} r */ function inboxFiles(r) {
  const d = path.join(r, '.qe', 'wiki', 'inbox');
  return existsSync(d) ? readdirSync(d) : [];
}
/** seed a full fixture (wiki skeleton + artifacts incl. things that must be excluded). @param {string} r */
function fixture(r) {
  mk(path.join(r, '.qe', 'wiki', 'inbox'));
  w(path.join(r, '.qe', 'planning', 'DECISION_LOG.md'), '# Decision Log\n| ID | D |\n| D1 | x |\n');
  w(path.join(r, '.qe', 'MISTAKE.md'), '# Mistakes\n### M001: oops\n');
  w(path.join(r, '.qe', 'planning', 'plans', 'alpha', 'phases', '1', 'RETROSPECTIVE.md'), '# retro alpha 1\n');
  w(path.join(r, '.qe', 'planning', 'plans', 'beta', 'phases', '2', 'RETROSPECTIVE.md'), '# retro beta 2\n');
  // must NEVER be seeded:
  w(path.join(r, '.qe', 'analysis', 'architecture.md'), 'ANALYSIS-LEAK-MARKER\n');
  w(path.join(r, '.qe', 'wiki', 'queries', 'q1.md'), '---\ntype: query\n---\nQUERY-LEAK-MARKER\n');
}

// ── graceful when wiki absent ────────────────────────────────────────────────

test('wikiSeedSelf: graceful no-op when .qe/wiki absent', () => {
  const r = root();
  try {
    w(path.join(r, '.qe', 'planning', 'DECISION_LOG.md'), '# d\n');
    const res = wikiSeedSelf(r);
    assert.equal(res.wikiAbsent, true);
    assert.deepEqual(res.seeded, []);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// ── seeds the right set, excludes analysis + wiki-internal ───────────────────

test('wikiSeedSelf: seeds DECISION_LOG/MISTAKE/RETRO; NEVER analysis or query filebacks', () => {
  const r = root();
  try {
    fixture(r);
    const res = wikiSeedSelf(r);
    assert.deepEqual(res.seeded.sort(), ['alpha-phase1-retrospective', 'beta-phase2-retrospective', 'decision-log', 'mistakes'].sort());
    const files = inboxFiles(r);
    // analysis + query content must not leak into any inbox file
    for (const f of files) {
      const body = readFileSync(path.join(r, '.qe', 'wiki', 'inbox', f), 'utf8');
      assert.ok(!body.includes('ANALYSIS-LEAK-MARKER'), `${f} leaked analysis`);
      assert.ok(!body.includes('QUERY-LEAK-MARKER'), `${f} leaked query fileback`);
    }
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// ── frontmatter: inferred (NOT extracted), inbox contract ────────────────────

test('wikiSeedSelf: seed frontmatter is inbox/uncompiled + seed_provenance:inferred (never extracted)', () => {
  const r = root();
  try {
    fixture(r);
    wikiSeedSelf(r);
    const body = readFileSync(path.join(r, '.qe', 'wiki', 'inbox', 'seed-decision-log.md'), 'utf8');
    assert.match(body, /^type: inbox$/m);
    assert.match(body, /^status: uncompiled$/m);
    assert.match(body, /^seed_provenance: inferred$/m);
    assert.match(body, /^seed_origin: framework-self$/m);
    assert.ok(!/provenance: extracted/.test(body), 'must not seed as extracted');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// ── RETRO multi-file slug disambiguation (no collision) ──────────────────────

test('wikiSeedSelf: multiple RETROSPECTIVE files get distinct slugs', () => {
  const r = root();
  try {
    fixture(r);
    wikiSeedSelf(r);
    const files = inboxFiles(r);
    assert.ok(files.includes('seed-alpha-phase1-retrospective.md'));
    assert.ok(files.includes('seed-beta-phase2-retrospective.md'));
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// ── idempotent supersede-in-place (no pile-up) ───────────────────────────────

test('wikiSeedSelf: re-seed with no change → all skipped, file count stable', () => {
  const r = root();
  try {
    fixture(r);
    const a = wikiSeedSelf(r);
    assert.equal(a.seeded.length, 4);
    const countA = inboxFiles(r).length;
    const b = wikiSeedSelf(r);
    assert.deepEqual(b.seeded, []);
    assert.equal(b.skipped.length, 4);
    assert.equal(inboxFiles(r).length, countA, 'no pile-up on re-seed');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('wikiSeedSelf: edited artifact supersedes same slug (no duplicate)', () => {
  const r = root();
  try {
    fixture(r);
    wikiSeedSelf(r);
    const before = inboxFiles(r).filter((f) => f.includes('decision-log')).length;
    w(path.join(r, '.qe', 'planning', 'DECISION_LOG.md'), '# Decision Log\n| ID | D |\n| D1 | x |\n| D2 | new |\n');
    const res = wikiSeedSelf(r);
    assert.ok(res.seeded.includes('decision-log'), 'changed file re-seeds');
    const after = inboxFiles(r).filter((f) => f.includes('decision-log')).length;
    assert.equal(after, before, 'supersede in place — exactly one decision-log seed');
  } finally { rmSync(r, { recursive: true, force: true }); }
});
