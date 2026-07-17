import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  collectExpiredSkillHints,
  formatExpiredSkillHint,
} from '../skill-expiry-hint.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-skill-expiry-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeSkill(dir, name, frontmatter) {
  const skillDir = join(dir, '.claude', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n# ${name}\n`);
}

test('no .claude/skills is a no-op', () => {
  const { dir, cleanup } = fixture();
  try {
    assert.deepEqual(collectExpiredSkillHints(dir, {}, { clock: () => Date.parse('2026-07-17T00:00:00Z') }), []);
  } finally {
    cleanup();
  }
});

test('manual skills do not produce hints', () => {
  const { dir, cleanup } = fixture();
  try {
    writeSkill(dir, 'manual', 'collected_at: 2026-01-01T00:00:00Z\nttl_days: 1');
    assert.deepEqual(collectExpiredSkillHints(dir, {}, { clock: () => Date.parse('2026-07-17T00:00:00Z') }), []);
  } finally {
    cleanup();
  }
});

test('expired generated skills produce a hint', () => {
  const { dir, cleanup } = fixture();
  try {
    writeSkill(dir, 'react', 'generated_by: Qcollect-skill\ncollected_at: 2026-01-01T00:00:00Z\nttl_days: 90');
    const hints = collectExpiredSkillHints(dir, {}, { clock: () => Date.parse('2026-07-17T00:00:00Z') });
    assert.equal(hints.length, 1);
    assert.equal(hints[0].name, 'react');
    assert.match(formatExpiredSkillHint(hints, '/'), /\/Qcollect-skill/);
  } finally {
    cleanup();
  }
});

test('broken frontmatter is skipped and config false disables hints', () => {
  const { dir, cleanup } = fixture();
  try {
    writeSkill(dir, 'broken', 'generated_by: Qcollect-skill\ncollected_at: nope\nttl_days: nope');
    writeSkill(dir, 'expired', 'generated_by: Qcollect-skill\ncollected_at: 2026-01-01T00:00:00Z\nttl_days: 90');
    assert.equal(collectExpiredSkillHints(dir, {}, { clock: () => Date.parse('2026-07-17T00:00:00Z') }).length, 1);
    assert.deepEqual(collectExpiredSkillHints(dir, { skill_expiry_hint_enabled: false }, { clock: () => Date.parse('2026-07-17T00:00:00Z') }), []);
  } finally {
    cleanup();
  }
});

test('hint path contains no spawn, write, network, or tech-stack access', () => {
  const moduleSource = readFileSync(resolve(fileURLToPath(new URL('../skill-expiry-hint.mjs', import.meta.url))), 'utf8');
  assert.doesNotMatch(moduleSource, /\bspawn\b|\bexec\b|writeFile|rename|fetch|https?:|tech-stack\.md/);
});

test('session-start keeps override-map qe-admin lines separate from the inserted hint block', () => {
  const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
  const source = readFileSync(join(repoRoot, 'hooks', 'scripts', 'session-start.mjs'), 'utf8');
  const lines = source.split('\n');
  const qeAdminLines = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.includes('qe-admin-mcp'));
  assert.ok(qeAdminLines.length >= 2);
  for (const entry of qeAdminLines) {
    assert.doesNotMatch(entry.line, /Qcollect-skill|collectExpiredSkillHints|Local collected skills/);
  }
  assert.ok(source.indexOf('collectExpiredSkillHints') < source.indexOf('[QE OVERRIDE MAP]'));
});
