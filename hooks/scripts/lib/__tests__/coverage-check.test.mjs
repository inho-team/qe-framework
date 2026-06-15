#!/usr/bin/env node

/**
 * coverage-check.test.mjs
 * Test suite for coverage-check.mjs (TASK_REQUEST → VERIFY_CHECKLIST coverage).
 * Run with: node --test hooks/scripts/lib/__tests__/coverage-check.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTaskOutputs, coverageReport, classifyOutput } from '../coverage-check.mjs';

const TASK = `# Phase X

## What
Do stuff.

## Checklist

### Wave 1

- [ ] 1. Merge A into B. → output: \`skills/a/SKILL.md\` (수정), \`skills/old/\` (삭제)
- [ ] 2. Write report. → output: \`.qe/reports/eval.md\`
- [ ] 3. Run tests.

## Notes
- not a checklist item → output: \`should/not/parse.md\`
`;

test('extractTaskOutputs: only parses the ## Checklist section', () => {
  const items = extractTaskOutputs(TASK);
  assert.equal(items.length, 3);
  // The "## Notes" line with an output trailer must NOT be picked up.
  assert.ok(!items.some((i) => i.outputs.includes('should/not/parse.md')));
});

test('extractTaskOutputs: pulls backtick paths after the output marker', () => {
  const items = extractTaskOutputs(TASK);
  assert.deepEqual(items[0].outputs, ['skills/a/SKILL.md', 'skills/old/']);
  assert.equal(items[0].id, '1');
  assert.deepEqual(items[1].outputs, ['.qe/reports/eval.md']);
  assert.deepEqual(items[2].outputs, []); // "Run tests" declares no artifact
});

test('coverageReport: directory + file outputs covered (trailing slash ignored)', () => {
  const verify = `# Verify
- [ ] \`skills/old/\` 디렉토리가 삭제되었는가
- [ ] \`skills/a/SKILL.md\`에 키워드가 통합되었는가
- [ ] eval 보고서 \`.qe/reports/eval.md\` 가 생성되었는가
`;
  const r = coverageReport(TASK, verify);
  assert.equal(r.ok, true);
  assert.equal(r.orphans.length, 0);
  assert.equal(r.totalOutputs, 3);
  assert.equal(r.coveredOutputs, 3);
  assert.equal(r.noOutputItems, 1); // item 3 "Run tests"
});

test('coverageReport: flags an orphan output not referenced in verify', () => {
  const verify = `# Verify
- [ ] \`skills/a/SKILL.md\`에 키워드가 통합되었는가
`;
  const r = coverageReport(TASK, verify);
  assert.equal(r.ok, false);
  const orphanPaths = r.orphans.map((o) => o.path).sort();
  assert.deepEqual(orphanPaths, ['.qe/reports/eval.md', 'skills/old/']);
  assert.equal(r.orphans[0].id !== undefined, true);
});

test('coverageReport: case-insensitive path matching', () => {
  const verify = '- [ ] SKILLS/A/SKILL.MD updated';
  const r = coverageReport('## Checklist\n- [ ] 1. x → output: `skills/a/SKILL.md`', verify);
  assert.equal(r.ok, true);
});

test('coverageReport: empty / malformed inputs never throw', () => {
  assert.equal(coverageReport('', '').ok, true);
  assert.equal(coverageReport(null, null).ok, true);
  assert.deepEqual(extractTaskOutputs(undefined), []);
});

test('extractTaskOutputs: ignores fenced code blocks inside the checklist', () => {
  const md = `## Checklist
\`\`\`
- [ ] 9. fake item in code → output: \`nope.md\`
\`\`\`
- [ ] 1. real → output: \`real.md\`
`;
  const items = extractTaskOutputs(md);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].outputs, ['real.md']);
});

test('classifyOutput: tiers — path > basename > stem > orphan', () => {
  assert.equal(classifyOutput('skills/a/b.md', 'see `skills/a/b.md` here'), 'path');
  // distinctive basename only
  assert.equal(classifyOutput('x/y/UNDERSTAND_ANYTHING_EVAL.md', '보고서(UNDERSTAND_ANYTHING_EVAL.md)'), 'basename');
  // stem only (CHANGELOG.md verified by a "## CHANGELOG" section)
  assert.equal(classifyOutput('CHANGELOG.md', '## CHANGELOG\n- [ ] unreleased'), 'stem');
  // no trace at all
  assert.equal(classifyOutput('a/b/missing.md', 'nothing relevant'), null);
});

test('classifyOutput: generic basenames do NOT count as matches', () => {
  // bare SKILL.md in verify must not mask a real full-path requirement
  assert.equal(classifyOutput('skills/a/SKILL.md', 'a SKILL.md was touched'), null);
  assert.equal(classifyOutput('pkg/README.md', 'the README.md file'), null);
});

test('coverageReport: weak matches keep ok=true but are listed in .weak', () => {
  const task = '## Checklist\n- [ ] 1. report → output: `x/UNDERSTAND_ANYTHING_EVAL.md`\n- [ ] 2. log → output: `CHANGELOG.md`';
  const verify = '- [ ] 보고서(UNDERSTAND_ANYTHING_EVAL.md) 생성\n## CHANGELOG\n- [ ] [Unreleased] Added';
  const r = coverageReport(task, verify);
  assert.equal(r.ok, true);
  assert.equal(r.orphans.length, 0);
  assert.equal(r.weak.length, 2);
  assert.deepEqual(r.weak.map((w) => w.tier).sort(), ['basename', 'stem']);
});

test('coverageReport: supports ASCII -> output marker', () => {
  const r = coverageReport('## Checklist\n- [ ] 1. x -> output: `a/b.md`', '`a/b.md`');
  assert.equal(r.ok, true);
  assert.equal(r.totalOutputs, 1);
});
