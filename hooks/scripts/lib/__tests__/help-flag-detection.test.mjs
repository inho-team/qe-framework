#!/usr/bin/env node

/**
 * help-flag-detection.test.mjs
 * Test suite for help-flag-parser.mjs
 * Run with: node hooks/scripts/lib/__tests__/help-flag-detection.test.mjs
 */

import { parseHelpFlag } from '../help-flag-parser.mjs';
import assert from 'assert';

// Track test results
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failCount++;
  }
}

// ============================================================================
// Test Group 1: Basic matching cases
// ============================================================================

test('Pattern /Qcommit --help matches', () => {
  const result = parseHelpFlag('/Qcommit --help');
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.skillName, 'Qcommit');
});

test('Pattern /Qversion -h matches', () => {
  const result = parseHelpFlag('/Qversion -h');
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.skillName, 'Qversion');
});

test('Hyphenated skill name /Qexecute --help matches', () => {
  const result = parseHelpFlag('/Qexecute --help');
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.skillName, 'Qexecute');
});

// ============================================================================
// Test Group 2: Non-matching cases
// ============================================================================

test('Wrong flag /Qcommit --amend does not match', () => {
  const result = parseHelpFlag('/Qcommit --amend');
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.skillName, null);
});

test('Text without slash /help me does not match', () => {
  const result = parseHelpFlag('/help me');
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.skillName, null);
});

test('Flag alone --help does not match', () => {
  const result = parseHelpFlag('--help');
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.skillName, null);
});

// ============================================================================
// Test Group 3: Trailing content handling
// ============================================================================

test('Trailing args /Qcommit --help extra args matches', () => {
  const result = parseHelpFlag('/Qcommit --help extra args');
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.skillName, 'Qcommit');
});

// ============================================================================
// Test Group 4: Whitespace handling
// ============================================================================

test('Leading and trailing whitespace  /Qcommit --help   matches', () => {
  const result = parseHelpFlag('  /Qcommit --help  ');
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.skillName, 'Qcommit');
});

// ============================================================================
// Test Group 5: Invalid skill names
// ============================================================================

test('Lowercase prefix /lowercase --help does not match', () => {
  const result = parseHelpFlag('/lowercase --help');
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.skillName, null);
});

// ============================================================================
// Test Group 6: Edge cases
// ============================================================================

test('Empty string does not match', () => {
  const result = parseHelpFlag('');
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.skillName, null);
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`Test Results: ${passCount} passed, ${failCount} failed`);
console.log(`${'='.repeat(70)}`);

if (failCount > 0) {
  process.exit(1);
}
