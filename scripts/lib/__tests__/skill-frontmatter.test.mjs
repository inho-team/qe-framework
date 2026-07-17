import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSkillContentHash,
  parseSkillFrontmatter,
  parseYamlSubset,
} from '../skill-frontmatter.mjs';

test('parses nested maps, lists, and list of maps', () => {
  const parsed = parseYamlSubset(`
source: Official docs
ttl_days: 90
verification:
  devils_advocate_ran: true
  sources:
    - url: https://example.com/docs
      published_at: 2025-11-02
    - url: "https://example.com/release"
      published_at: 2026-01-03
  conflicting_claims: []
`);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.value.verification.devils_advocate_ran, true);
  assert.deepEqual(parsed.value.verification.sources[0], {
    url: 'https://example.com/docs',
    published_at: '2025-11-02',
  });
  assert.deepEqual(parsed.value.verification.conflicting_claims, []);
});

test('parse failures return explicit errors', () => {
  const parsed = parseYamlSubset(`
verification:
  sources:
   - url: https://example.com
`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /indentation/);
});

test('content_hash ignores frontmatter and tolerates body delimiters', () => {
  const a = `---
source: a
---
# Body

---
inside body
`;
  const b = `---
source: b
ttl_days: 90
---
# Body

---
inside body
`;
  assert.equal(computeSkillContentHash(a), computeSkillContentHash(b));
});

test('parseSkillFrontmatter keeps nested metadata and body', () => {
  const markdown = `---
source: Docs
collected_at: 2026-07-17T12:00:00Z
ttl_days: 90
expires_at: 2026-10-15T12:00:00Z
generated_by: Qcollect-skill
content_hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
verification:
  devils_advocate_ran: true
  sources:
    - url: https://example.com
      published_at: 2026-07-01
  conflicting_claims: []
---
# Skill
`;
  const parsed = parseSkillFrontmatter(markdown);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.metadata.verification.sources[0].published_at, '2026-07-01');
  assert.equal(parsed.body, '# Skill\n');
});
