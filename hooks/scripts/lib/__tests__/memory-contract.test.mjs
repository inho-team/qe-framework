import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { addMemory, formatMemoryContext, getActiveMemories } from '../project-memory.mjs';
import { loadMemory as loadOnDemandMemory } from '../context-loader.mjs';

test('session-start and on-demand loading share the canonical memory store', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-memory-contract-'));
  try {
    addMemory(root, 'Use deterministic fixtures', 'convention', { priority: 'permanent' });
    assert.match(formatMemoryContext(root), /Use deterministic fixtures/);
    assert.equal(loadOnDemandMemory(root), formatMemoryContext(root));
    const saved = JSON.parse(readFileSync(join(root, '.qe/project-memory.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.entries.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy notes and directives remain readable without deleting their source', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-memory-legacy-'));
  try {
    const legacyDir = join(root, '.qe/memory');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'project-memory.json');
    writeFileSync(legacyPath, JSON.stringify({
      notes: [{ category: 'gotcha', note: 'Keep the lockfile', added_at: '2026-01-01T00:00:00Z' }],
      directives: [{ directive: 'Never bypass safety hooks', added_at: '2026-01-01T00:00:00Z' }],
    }));
    const entries = getActiveMemories(root);
    assert.deepEqual(entries.map(({ content }) => content), ['Never bypass safety hooks', 'Keep the lockfile']);
    assert.match(formatMemoryContext(root), /Never bypass safety hooks/);
    assert.match(formatMemoryContext(root), /Keep the lockfile/);
    assert.equal(readFileSync(legacyPath, 'utf8').includes('Never bypass safety hooks'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('memory specification names one canonical module and path', () => {
  const spec = readFileSync(new URL('../../../../core/MEMORY_SPEC.md', import.meta.url), 'utf8');
  assert.match(spec, /\.qe\/project-memory\.json/);
  assert.match(spec, /hooks\/scripts\/lib\/project-memory\.mjs/);
  assert.match(spec, /Legacy compatibility/);
  assert.doesNotMatch(spec, /import \{ addNote, addDirective/);
});
