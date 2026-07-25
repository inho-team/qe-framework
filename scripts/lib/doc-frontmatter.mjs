import { parseYamlSubset } from './skill-frontmatter.mjs';

const OPENING = '<!-- qe-doc-frontmatter';

/**
 * Extract the one title-adjacent QE comment block. This deliberately does not
 * search Markdown prose: only the line after an H1 can opt a document in.
 */
export function extractDocFrontmatter(markdown) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  if (!/^#\s+\S/.test(lines[0] || '')) return { state: 'missing', metadata: null };

  const openingLine = lines[1] || '';
  if (!openingLine.startsWith(OPENING)) {
    return { state: 'missing', metadata: null };
  }
  if (!/^<!-- qe-doc-frontmatter\s*$/.test(openingLine)) {
    return { state: 'invalid', metadata: null, error: 'frontmatter opening marker must occupy its own line' };
  }

  const closeLine = lines.slice(2).findIndex(line => line.includes('-->'));
  if (closeLine === -1) {
    return { state: 'unterminated', metadata: null, error: 'unterminated qe-doc-frontmatter block' };
  }
  const closingIndex = closeLine + 2;
  const bodyLines = lines.slice(2, closingIndex);
  const closing = lines[closingIndex];
  const markerAt = closing.indexOf('-->');
  if (closing.slice(markerAt + 3).trim() !== '') {
    return { state: 'invalid', metadata: null, error: 'frontmatter closing marker must end its line' };
  }

  const yaml = bodyLines.join('\n');
  const parsed = parseYamlSubset(yaml);
  if (!parsed.ok) return { state: 'invalid', metadata: null, error: parsed.error };
  return {
    state: 'valid',
    metadata: parsed.value,
    yaml,
    startLine: 2,
    endLine: closingIndex + 1,
  };
}
