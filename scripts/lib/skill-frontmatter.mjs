import { createHash } from 'crypto';

export const FRONTMATTER_BOUNDARY_RE = /^---\n([\s\S]*?)\n---\n?/;

// Do not reuse parseAgentFrontmatter() from scripts/lib/client_installers.mjs.
// That parser, and the other legacy frontmatter readers in this repo, split each
// line on line.indexOf(':') and flatten the result. For this task's contract that
// silently turns nested structures such as `verification.sources[].published_at`
// into garbage values (`verification: ''`, `sources: ''`) instead of reporting an
// error. This parser is intentionally a small nested YAML subset parser so schema
// validation can reject malformed research evidence.

export function splitSkillFrontmatter(markdown) {
  const match = String(markdown || '').match(FRONTMATTER_BOUNDARY_RE);
  if (!match) {
    return { frontmatter: null, body: String(markdown || '') };
  }
  return {
    frontmatter: match[1],
    body: String(markdown || '').slice(match[0].length),
  };
}

export function computeSkillContentHash(markdownOrBody) {
  const { body } = splitSkillFrontmatter(String(markdownOrBody || ''));
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export function parseSkillFrontmatter(markdown) {
  const split = splitSkillFrontmatter(markdown);
  if (split.frontmatter === null) {
    return { ok: false, error: 'missing frontmatter block', metadata: null, body: split.body };
  }
  const parsed = parseYamlSubset(split.frontmatter);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, metadata: null, body: split.body };
  }
  return { ok: true, metadata: parsed.value, body: split.body };
}

export function parseYamlSubset(source) {
  try {
    const lines = tokenizeYaml(source);
    if (lines.length === 0) {
      return { ok: true, value: {} };
    }
    const parsed = parseBlock(lines, 0, lines[0].indent);
    if (parsed.next < lines.length) {
      return { ok: false, error: `unexpected content at line ${lines[parsed.next].line}` };
    }
    return { ok: true, value: parsed.value };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

function tokenizeYaml(source) {
  const out = [];
  const rawLines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    if (indent % 2 !== 0) {
      throw new Error(`invalid indentation at line ${i + 1}: use two-space indentation`);
    }
    if (/\t/.test(raw.slice(0, indent))) {
      throw new Error(`invalid tab indentation at line ${i + 1}`);
    }
    const text = stripInlineComment(raw.slice(indent)).trimEnd();
    if (text.trim() === '') continue;
    out.push({ line: i + 1, indent, text: text.trimStart() });
  }
  return out;
}

function parseBlock(lines, index, indent) {
  if (index >= lines.length) return { value: {}, next: index };
  if (lines[index].indent < indent) return { value: {}, next: index };
  if (lines[index].indent !== indent) {
    throw new Error(`unexpected indentation at line ${lines[index].line}`);
  }
  return lines[index].text.startsWith('- ')
    ? parseList(lines, index, indent)
    : parseMap(lines, index, indent);
}

function parseMap(lines, index, indent) {
  const obj = {};
  let i = index;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const entry = parseKeyValue(lines[i].text, lines[i].line);
    if (!entry.key) throw new Error(`empty key at line ${lines[i].line}`);
    if (entry.valueText === '') {
      if (i + 1 >= lines.length || lines[i + 1].indent <= indent) {
        throw new Error(`missing nested value for "${entry.key}" at line ${lines[i].line}`);
      }
      const child = parseBlock(lines, i + 1, lines[i + 1].indent);
      obj[entry.key] = child.value;
      i = child.next;
    } else {
      obj[entry.key] = parseScalar(entry.valueText, lines[i].line);
      i++;
    }
  }
  if (i === index) {
    throw new Error(`expected mapping at line ${lines[index].line}`);
  }
  return { value: obj, next: i };
}

function parseList(lines, index, indent) {
  const arr = [];
  let i = index;
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
    const itemText = lines[i].text.slice(2).trim();
    if (itemText === '') {
      if (i + 1 >= lines.length || lines[i + 1].indent <= indent) {
        throw new Error(`missing list item value at line ${lines[i].line}`);
      }
      const child = parseBlock(lines, i + 1, lines[i + 1].indent);
      arr.push(child.value);
      i = child.next;
      continue;
    }

    if (looksLikeKeyValue(itemText)) {
      const first = parseKeyValue(itemText, lines[i].line);
      const item = {};
      if (first.valueText === '') {
        const child = parseNestedAfterListKey(lines, i, indent, first.key);
        item[first.key] = child.value;
        i = child.next;
      } else {
        item[first.key] = parseScalar(first.valueText, lines[i].line);
        i++;
      }
      while (i < lines.length && lines[i].indent > indent) {
        if (lines[i].indent !== indent + 2) {
          throw new Error(`unexpected indentation in list item at line ${lines[i].line}`);
        }
        if (lines[i].text.startsWith('- ')) {
          throw new Error(`nested list continuation is not supported at line ${lines[i].line}`);
        }
        const childEntry = parseKeyValue(lines[i].text, lines[i].line);
        if (childEntry.valueText === '') {
          if (i + 1 >= lines.length || lines[i + 1].indent <= lines[i].indent) {
            throw new Error(`missing nested value for "${childEntry.key}" at line ${lines[i].line}`);
          }
          const child = parseBlock(lines, i + 1, lines[i + 1].indent);
          item[childEntry.key] = child.value;
          i = child.next;
        } else {
          item[childEntry.key] = parseScalar(childEntry.valueText, lines[i].line);
          i++;
        }
      }
      arr.push(item);
      continue;
    }

    arr.push(parseScalar(itemText, lines[i].line));
    i++;
  }
  if (i === index) {
    throw new Error(`expected list at line ${lines[index].line}`);
  }
  return { value: arr, next: i };
}

function parseNestedAfterListKey(lines, index, indent, key) {
  if (index + 1 >= lines.length || lines[index + 1].indent <= indent) {
    throw new Error(`missing nested value for "${key}" at line ${lines[index].line}`);
  }
  return parseBlock(lines, index + 1, lines[index + 1].indent);
}

function parseKeyValue(text, line) {
  const idx = text.indexOf(':');
  if (idx === -1) {
    throw new Error(`expected key/value pair at line ${line}`);
  }
  return {
    key: text.slice(0, idx).trim(),
    valueText: text.slice(idx + 1).trim(),
  };
}

function looksLikeKeyValue(text) {
  const idx = text.indexOf(':');
  return idx > 0 && /^[A-Za-z0-9_.-]+$/.test(text.slice(0, idx).trim());
}

function parseScalar(text, line) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  if (text === '[]') return [];
  if (text === '{}') return {};
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`invalid inline JSON scalar at line ${line}`);
    }
  }
  if (text.includes(': ') && !/^https?:\/\//.test(text)) {
    throw new Error(`ambiguous scalar containing mapping syntax at line ${line}`);
  }
  return text;
}

function stripInlineComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'") && text[i - 1] !== '\\') {
      quote = quote === ch ? null : (quote || ch);
      continue;
    }
    if (!quote && ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}
