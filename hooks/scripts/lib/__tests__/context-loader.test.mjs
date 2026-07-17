#!/usr/bin/env node

/**
 * context-loader.test.mjs
 *
 * Run with: node --test hooks/scripts/lib/__tests__/context-loader.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadProfile, loadDocs, loadPrinciples, loadPendingContext, LOADER_KEYS } from '../context-loader.mjs';

function mkproject() {
  const root = mkdtempSync(join(tmpdir(), 'qe-context-loader-'));
  mkdirSync(join(root, '.qe'), { recursive: true });
  return root;
}

function writeProfile(root, filename, content) {
  const profileDir = join(root, '.qe', 'profile');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, filename), content);
}

function writeDoc(root, filename, content) {
  const docsDir = join(root, '.qe', 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, filename), content);
}

// ============================================================================
// Regression: section-terminator lookahead must handle end-of-input AND must
// not truncate on any character (previous bug: `\Z` is not a JS regex anchor —
// it matched a literal `Z`, so any section that was last in its file got cut
// at the first uppercase Z in its body).
// ============================================================================

test('loadProfile: corrections section as last section is not truncated at "Z"', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeProfile(root, 'corrections.md', '## Corrections\n- Use Zod for schema validation\n');

  const result = loadProfile(root);
  assert.ok(result, 'profile should load');
  assert.ok(result.includes('Zod'), 'text at the uppercase Z must survive');
  assert.ok(result.includes('schema validation'), 'text after the uppercase Z must survive');
});

test('loadProfile: top commands section as last section is not truncated at "Z"', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeProfile(root, 'command-patterns.md', '## Top Commands\n- Zip the release bundle\n');

  const result = loadProfile(root);
  assert.ok(result, 'profile should load');
  assert.ok(result.includes('Zip the release bundle'), 'command text must survive the uppercase Z');
});

test('loadProfile: corrections followed by another section still stops at that section', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeProfile(
    root,
    'corrections.md',
    '## Corrections\n- Zod is preferred\n\n## Other Section\n- should not appear\n'
  );

  const result = loadProfile(root);
  assert.ok(result.includes('Zod is preferred'), 'own section content must be kept');
  assert.ok(!result.includes('should not appear'), 'the next section must not bleed in');
});

// ============================================================================
// loadPrinciples: core/PRINCIPLES.md went unread by any code until this loader
// existed (issue #16). These assert the rules actually make it into the payload —
// "Minimal change" in particular, which sits last in the section and so is the
// first casualty of a too-tight character budget.
// ============================================================================

test('loadPrinciples: delivers the code quality rules', () => {
  const result = loadPrinciples();

  assert.ok(result, 'principles should load from the packaged core/PRINCIPLES.md');
  for (const rule of ['KISS', 'YAGNI', 'Evidence-based decisions', 'Minimal change principle']) {
    assert.ok(result.includes(rule), `${rule} must survive the character budget`);
  }
});

test('loadPrinciples: points back at the full document', () => {
  const result = loadPrinciples();

  assert.ok(result.includes('core/PRINCIPLES.md'), 'digest must cite the full source');
});

test('loadPendingContext: offers principles when not already loaded, skips when loaded', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const fresh = loadPendingContext(root, []);
  assert.ok(
    fresh.some(item => item.key === LOADER_KEYS.PRINCIPLES),
    'a session with nothing loaded should be offered the principles'
  );

  const repeat = loadPendingContext(root, [LOADER_KEYS.PRINCIPLES]);
  assert.ok(
    !repeat.some(item => item.key === LOADER_KEYS.PRINCIPLES),
    'principles must not be re-injected once the session has them'
  );
});

test('loadDocs: core rules as last section are not truncated at "Z"', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeDoc(
    root,
    'api.md',
    '---\ntopic: API\ndomain: backend\nconfirmed: true\n---\n\n## Core Rules\n- Validate payloads with Zod schemas\n'
  );

  const result = loadDocs(root);
  assert.ok(result, 'docs should load');
  assert.ok(result.includes('Zod schemas'), 'rule text must survive the uppercase Z');
  assert.ok(result.includes('backend/API'), 'frontmatter domain/topic should still be summarised');
});
