import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as neutral from '../bridge-runtime.mjs';
import * as claude from '../claude_bridge.mjs';
import * as codex from '../codex_bridge.mjs';

function fixture() {
  return mkdtempSync(join(tmpdir(), 'qe-bridge-runtime-'));
}

test('both compatibility bridges expose the same neutral primitives', () => {
  assert.equal(claude.buildDelegationContext, neutral.buildDelegationContext);
  assert.equal(claude.loadSivsConfig, neutral.loadSivsConfig);
  assert.equal(codex.buildDelegationContext, neutral.buildDelegationContext);
  assert.equal(codex.loadSivsConfig, neutral.loadSivsConfig);
  const claudeSource = readFileSync(new URL('../claude_bridge.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(claudeSource, /from ['"]\.\/codex_bridge\.mjs['"]/);
});

test('delegation context is bounded, UTF-8 safe, and degrades for absent artifacts', () => {
  const cwd = fixture();
  const task = join(cwd, 'task.md');
  writeFileSync(task, `${'가'.repeat(30_000)}SECRET_TAIL`, 'utf8');
  const result = neutral.buildDelegationContext('verify', {
    cwd,
    taskPath: 'task.md',
    checklistPath: 'missing.md',
    audit: false,
  });
  assert.equal(result.artifacts[0].truncated, true);
  assert.match(result.context, /TRUNCATED/);
  assert.doesNotMatch(result.context, /SECRET_TAIL/);
  assert.equal(result.warnings.length, 1);
  assert.throws(() => neutral.buildDelegationContext('unknown'), /Unknown stage/);
});

test('SIVS config loading preserves single-AI policy', () => {
  const cwd = fixture();
  assert.deepEqual(neutral.loadSivsConfig(cwd), {});
  mkdirSync(join(cwd, '.qe'), { recursive: true });
  writeFileSync(join(cwd, '.qe', 'sivs-config.json'), JSON.stringify({ verify: { effort: 'high' } }));
  assert.deepEqual(neutral.loadSivsConfig(cwd), { verify: { effort: 'high' } });
  writeFileSync(join(cwd, '.qe', 'sivs-config.json'), JSON.stringify({ verify: { engine: 'codex' } }));
  assert.throws(() => neutral.loadSivsConfig(cwd), /Invalid single-AI SIVS config/);
});
