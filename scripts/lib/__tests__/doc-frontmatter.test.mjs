import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocFrontmatter } from '../doc-frontmatter.mjs';

test('extracts only the title-adjacent block and stops at its nearest closing marker', () => {
  const result = extractDocFrontmatter(`# Title\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: deadbeef\nlinks:\n  - "[[.qe/a.md]]"\n-->\n<!-- qe-doc-frontmatter\nkind: report\n-->`);
  assert.equal(result.state, 'valid');
  assert.equal(result.metadata.kind, 'spec');
  assert.equal(result.metadata.uuid, 'deadbeef');
});

test('rejects an unterminated title-adjacent block and ignores fenced examples', () => {
  const broken = extractDocFrontmatter('# Title\n<!-- qe-doc-frontmatter\nkind: spec');
  assert.equal(broken.state, 'unterminated');

  const fenced = extractDocFrontmatter('# Title\n```md\n<!-- qe-doc-frontmatter\nkind: spec\n```');
  assert.equal(fenced.state, 'missing');
});
