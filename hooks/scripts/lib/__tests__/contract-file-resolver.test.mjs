#!/usr/bin/env node
'use strict';

/**
 * Unit tests for contract-file-resolver.mjs
 * Tests extractMarkers, resolveImplPath, and resolveTestPath functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extractMarkers, resolveImplPath, resolveTestPath } from '../contract-file-resolver.mjs';

// Test: extractMarkers
test('extractMarkers returns both null when no markers present', () => {
  const contractText = 'This is a contract with no markers.';
  const result = extractMarkers(contractText);
  assert.equal(result.target, null);
  assert.equal(result.tests, null);
});

test('extractMarkers returns target when only target marker present', () => {
  const contractText = 'Some text\n<!-- target: custom/impl.mjs -->\nMore text';
  const result = extractMarkers(contractText);
  assert.equal(result.target, 'custom/impl.mjs');
  assert.equal(result.tests, null);
});

test('extractMarkers returns tests when only tests marker present', () => {
  const contractText = 'Some text\n<!-- tests: custom/test.mjs -->\nMore text';
  const result = extractMarkers(contractText);
  assert.equal(result.target, null);
  assert.equal(result.tests, 'custom/test.mjs');
});

test('extractMarkers returns both when both markers present', () => {
  const contractText = `
Some contract text.
<!-- target: src/module.mjs -->
More text.
<!-- tests: tests/module.test.mjs -->
End.
  `;
  const result = extractMarkers(contractText);
  assert.equal(result.target, 'src/module.mjs');
  assert.equal(result.tests, 'tests/module.test.mjs');
});

test('extractMarkers tolerates inner whitespace and trims paths', () => {
  const contractText = '<!--  target:  path/to/file  -->';
  const result = extractMarkers(contractText);
  assert.equal(result.target, 'path/to/file');
});

test('extractMarkers returns both null for non-string input (null)', () => {
  const result = extractMarkers(null);
  assert.equal(result.target, null);
  assert.equal(result.tests, null);
});

test('extractMarkers returns both null for non-string input (undefined)', () => {
  const result = extractMarkers(undefined);
  assert.equal(result.target, null);
  assert.equal(result.tests, null);
});

test('extractMarkers returns both null for non-string input (number)', () => {
  const result = extractMarkers(123);
  assert.equal(result.target, null);
  assert.equal(result.tests, null);
});

test('extractMarkers returns both null for non-string input (object)', () => {
  const result = extractMarkers({ text: 'some text' });
  assert.equal(result.target, null);
  assert.equal(result.tests, null);
});

// Test: resolveImplPath
test('resolveImplPath returns marker path when marker present', () => {
  const contractText = '<!-- target: custom/impl.mjs -->';
  const result = resolveImplPath('test-contract', contractText);
  assert.equal(result, 'custom/impl.mjs');
});

test('resolveImplPath returns convention path when no marker', () => {
  const contractText = 'Just a plain contract with no markers.';
  const result = resolveImplPath('test-contract', contractText);
  assert.equal(result, 'hooks/scripts/lib/test-contract.mjs');
});

test('resolveImplPath rejects invalid contract name', () => {
  const contractText = 'Some text';
  assert.throws(() => {
    resolveImplPath('TEMPLATE', contractText);
  }, /Invalid contract name/);
});

test('resolveImplPath rejects marker with parent traversal', () => {
  const contractText = '<!-- target: ../../etc/passwd -->';
  assert.throws(() => {
    resolveImplPath('valid-name', contractText);
  }, /escapes project root/);
});

// Test: resolveTestPath
test('resolveTestPath returns marker path when marker present', () => {
  const contractText = '<!-- tests: custom/test.mjs -->';
  const result = resolveTestPath('test-contract', contractText);
  assert.equal(result, 'custom/test.mjs');
});

test('resolveTestPath returns convention path when no marker', () => {
  const contractText = 'Just a plain contract with no markers.';
  const result = resolveTestPath('test-contract', contractText);
  assert.equal(result, 'hooks/scripts/lib/__tests__/test-contract.test.mjs');
});

test('resolveTestPath rejects invalid contract name', () => {
  const contractText = 'Some text';
  assert.throws(() => {
    resolveTestPath('TEMPLATE', contractText);
  }, /Invalid contract name/);
});

test('resolveTestPath rejects marker with parent traversal', () => {
  const contractText = '<!-- tests: ../../malicious.test.mjs -->';
  assert.throws(() => {
    resolveTestPath('valid-name', contractText);
  }, /escapes project root/);
});

// Integration test: real contract
test('integration: real contract sivs-enforcer resolves valid paths', { skip: !existsSync('.qe/contracts/active/sivs-enforcer.md') }, () => {
  // Read the actual sivs-enforcer.md contract
  const contractPath = '.qe/contracts/active/sivs-enforcer.md';
  let contractText;
  try {
    contractText = readFileSync(contractPath, 'utf-8');
  } catch (err) {
    // Provide helpful error if contract doesn't exist
    assert.fail(`Failed to read contract at ${contractPath}: ${err.message}`);
  }

  // Test resolveImplPath with real contract
  const implPath = resolveImplPath('sivs-enforcer', contractText);
  assert.ok(typeof implPath === 'string');
  assert.ok(implPath.length > 0);
  // Should resolve to convention (no marker in sivs-enforcer.md)
  assert.equal(implPath, 'hooks/scripts/lib/sivs-enforcer.mjs');

  // Test resolveTestPath with real contract
  const testPath = resolveTestPath('sivs-enforcer', contractText);
  assert.ok(typeof testPath === 'string');
  assert.ok(testPath.length > 0);
  // Should resolve to convention (no marker in sivs-enforcer.md)
  assert.equal(testPath, 'hooks/scripts/lib/__tests__/sivs-enforcer.test.mjs');
});

// --- Placeholder-marker handling (regression: Haiku agents sometimes write template stubs) ---

test('extractMarkers: triple-dot placeholder is treated as no marker', () => {
  const text = '<!-- tests: hooks/scripts/lib/__tests__/... -->';
  const { target, tests } = extractMarkers(text);
  assert.equal(tests, null, 'Triple-dot path should be treated as placeholder, not a real marker');
  assert.equal(target, null);
});

test('extractMarkers: <bracket> placeholder is treated as no marker', () => {
  const text = '<!-- target: <path-to-impl> -->';
  const { target } = extractMarkers(text);
  assert.equal(target, null);
});

test('extractMarkers: TODO/TBD/WIP/FIXME placeholders are treated as no marker', () => {
  assert.equal(extractMarkers('<!-- tests: TODO write tests -->').tests, null);
  assert.equal(extractMarkers('<!-- target: TBD -->').target, null);
  assert.equal(extractMarkers('<!-- tests: WIP-test-path -->').tests, null);
  assert.equal(extractMarkers('<!-- target: src/FIXME/foo.mjs -->').target, null);
});

test('extractMarkers: real paths with normal dots still work', () => {
  const text = '<!-- target: hooks/scripts/lib/foo.bar.mjs -->';
  const { target } = extractMarkers(text);
  assert.equal(target, 'hooks/scripts/lib/foo.bar.mjs');
});

test('resolveTestPath: placeholder marker falls back to convention, not error', () => {
  // This is the exact Haiku-agent-generated bug from v6.5.0 Tier 1 dogfooding.
  // Before the placeholder fix, this threw "Marker path escapes project root".
  const text = '<!-- tests: hooks/scripts/lib/__tests__/... -->';
  const result = resolveTestPath('regression-gate', text);
  assert.equal(result, 'hooks/scripts/lib/__tests__/regression-gate.test.mjs');
});
