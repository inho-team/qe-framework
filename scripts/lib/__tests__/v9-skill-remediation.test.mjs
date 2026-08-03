import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

for (const rel of ['skills/Qexecute/SKILL.md', 'skills/Qgenerate-spec/SKILL.md']) {
  test(`${rel} stays within the documented 250-line hard limit`, () => {
    const lines = read(rel).trimEnd().split(/\r?\n/).length;
    assert.ok(lines <= 250, `${rel} has ${lines} lines`);
  });

  test(`${rel} progressive-disclosure markdown links resolve`, () => {
    const text = read(rel);
    const links = [...text.matchAll(/\[[^\]]+\]\((\.\/[^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    assert.ok(links.length > 0, `${rel} should delegate detail to reference docs`);
    for (const link of links) {
      assert.ok(existsSync(join(ROOT, dirname(rel), link)), `missing ${rel} -> ${link}`);
    }
  });
}

test('Qcritical-review names only the canonical supervision orchestrator', () => {
  const text = read('skills/Qcritical-review/SKILL.md');
  assert.match(text, /Esupervision-orchestrator/);
  assert.doesNotMatch(text, /\bEsupervision\b(?!-orchestrator)/);
});

test('catalog pressure guidance names Qrelease and never recommends removed Mbump', () => {
  const text = read('scripts/catalog-pressure-report.mjs');
  assert.match(text, /Qrelease/);
  assert.doesNotMatch(text, /\bMbump\b/);
});

test('compact Qexecute retains hard safety and lifecycle contracts', () => {
  const text = read('skills/Qexecute/SKILL.md');
  for (const term of [
    'Code Risk Gate', 'hard block', 'Risk Proof Gate', 'Qcritical-review --risk {UUID}',
    'Eqa-orchestrator', 'Lifecycle Cleanup', 'wait_agent', 'close_agent',
    'open handles: 0', 'stale warning', 'final report',
  ]) assert.ok(text.includes(term), `Qexecute missing ${term}`);
});

test('compact Qgenerate-spec retains the complete code risk template', () => {
  const text = read('skills/Qgenerate-spec/SKILL.md');
  for (const term of [
    'Code Risk Register', '## Risk Register', 'Worst-case failure',
    'Data loss / corruption risk', 'Security / permission risk',
    'Concurrency / race risk', 'Rollback strategy', 'Unverified assumptions',
    'High-risk findings are mitigated',
  ]) assert.ok(text.includes(term), `Qgenerate-spec missing ${term}`);
});
