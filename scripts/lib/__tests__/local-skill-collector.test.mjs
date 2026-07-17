import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_TTL_DAYS_BY_STACK,
  collectLocalSkillStates,
  evaluateSkillMetadata,
  validateCollectedSkillFrontmatter,
} from '../local-skill-collector.mjs';
import { computeSkillContentHash } from '../skill-frontmatter.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-skill-collector-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function skillMarkdown({ generated = true, collectedAt = '2026-01-01T00:00:00Z', ttlDays = 90, body = '# Body\n' } = {}) {
  const hash = computeSkillContentHash(body);
  return `---
source: Official docs
collected_at: ${collectedAt}
ttl_days: ${ttlDays}
expires_at: 2099-01-01T00:00:00Z
${generated ? 'generated_by: Qcollect-skill\n' : ''}content_hash: ${hash}
verification:
  devils_advocate_ran: true
  sources:
    - url: https://example.com/docs
      published_at: 2026-01-01
  conflicting_claims: []
---
${body}`;
}

test('classifies absent, valid, expired, manual, and broken skills', () => {
  const { dir, cleanup } = fixture();
  try {
    assert.deepEqual(collectLocalSkillStates(dir), []);
    const root = join(dir, '.claude', 'skills');
    mkdirSync(join(root, 'valid'), { recursive: true });
    mkdirSync(join(root, 'expired'), { recursive: true });
    mkdirSync(join(root, 'manual'), { recursive: true });
    mkdirSync(join(root, 'broken'), { recursive: true });
    writeFileSync(join(root, 'valid', 'SKILL.md'), skillMarkdown({ collectedAt: '2026-07-01T00:00:00Z', ttlDays: 90 }));
    writeFileSync(join(root, 'expired', 'SKILL.md'), skillMarkdown({ collectedAt: '2026-01-01T00:00:00Z', ttlDays: 90 }));
    writeFileSync(join(root, 'manual', 'SKILL.md'), skillMarkdown({ generated: false }));
    writeFileSync(join(root, 'broken', 'SKILL.md'), '---\nverification:\n  sources:\n   - bad: true\n---\nbody');

    const states = collectLocalSkillStates(dir, { clock: () => Date.parse('2026-07-17T00:00:00Z') });
    const byName = Object.fromEntries(states.map((state) => [state.name, state]));
    assert.equal(byName.valid.status, 'valid');
    assert.equal(byName.expired.status, 'expired');
    assert.equal(byName.manual.status, 'manual');
    assert.equal(byName.broken.status, 'invalid-frontmatter');
    assert.equal(byName.manual.skipped, true);
  } finally {
    cleanup();
  }
});

test('collected_at plus ttl_days is canonical over expires_at', () => {
  const state = evaluateSkillMetadata({
    name: 'react',
    metadata: {
      source: 'Docs',
      collected_at: '2026-01-01T00:00:00Z',
      ttl_days: 90,
      expires_at: '2099-01-01T00:00:00Z',
      generated_by: 'Qcollect-skill',
      content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      verification: {
        devils_advocate_ran: true,
        sources: [{ url: 'https://example.com', published_at: '2026-01-01' }],
        conflicting_claims: [],
      },
    },
    nowMs: Date.parse('2026-07-17T00:00:00Z'),
  });
  assert.equal(state.expired, true);
  assert.equal(state.canonicalExpiresAt, '2026-04-01T00:00:00.000Z');
});

test('TTL table matches the spec values', () => {
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.javascript, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.typescript, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.react, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.vue, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.angular, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.next, 90);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.python, 180);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.java, 180);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.spring, 180);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.go, 180);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.rust, 180);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.sql, 365);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.postgresql, 365);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.terraform, 120);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.kubernetes, 120);
  assert.equal(DEFAULT_TTL_DAYS_BY_STACK.security, 60);
});

test('verification rejects empty sources and missing published_at', () => {
  const base = {
    source: 'Docs',
    collected_at: '2026-07-17T00:00:00Z',
    ttl_days: 90,
    expires_at: '2026-10-15T00:00:00Z',
    generated_by: 'Qcollect-skill',
    content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    verification: { devils_advocate_ran: true, sources: [], conflicting_claims: [] },
  };
  assert.equal(validateCollectedSkillFrontmatter(base).ok, false);
  base.verification.sources = [{ url: 'https://example.com' }];
  const missingPublished = validateCollectedSkillFrontmatter(base);
  assert.equal(missingPublished.ok, false);
  assert.match(missingPublished.errors.join('\n'), /published_at/);
});
