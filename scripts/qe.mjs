#!/usr/bin/env node
/** Unified public CLI for DB-backed QE documents and named state queries. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = process.argv.slice(2);
const cwdAt = raw.indexOf('--cwd');
const cwdEq = raw.findIndex(arg => arg.startsWith('--cwd='));
const cwdValue = cwdAt >= 0 ? raw[cwdAt + 1] : (cwdEq >= 0 ? raw[cwdEq].slice(6) : null);
if (cwdValue) {
  const cwd = resolve(cwdValue);
  if (!existsSync(cwd)) { console.error(`qe: --cwd path does not exist: ${cwd}`); process.exit(1); }
  process.chdir(cwd);
}
const argsv = raw.filter((arg, index) => arg !== '--cwd' && !arg.startsWith('--cwd=') && !(cwdAt >= 0 && index === cwdAt + 1));
const [action, target, ...rest] = argsv;
if (!action || !['read', 'list', 'exists', 'query', 'reindex', 'archive-analysis'].includes(action)) {
  console.error('usage: node scripts/qe.mjs [--cwd DIR] read|list|exists <.qe/path> | query <name> [--key=value] [--json|--table|--md] | reindex | archive-analysis <name.md|name.json>');
  process.exit(1);
}

const format = rest.includes('--table') ? 'table' : rest.includes('--md') ? 'md' : 'json';
const render = (rows) => {
  if (format === 'json') return `${JSON.stringify(rows, null, 2)}\n`;
  if (!Array.isArray(rows) || rows.length === 0) return format === 'md' ? '_(no rows)_\n' : '(no rows)\n';
  const cols = [...new Set(rows.flatMap(Object.keys))];
  if (format === 'md') return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map(row => `| ${cols.map(c => String(row[c] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n') + '\n';
  return [cols.join('\t'), ...rows.map(row => cols.map(c => String(row[c] ?? '').replace(/\s+/g, ' ').slice(0, 80)).join('\t'))].join('\n') + '\n';
};

try {
  const { openStore } = await import('../hooks/scripts/lib/store.mjs');
  const { reindex } = await import('../hooks/scripts/lib/store-indexer.mjs');
  const { readQeDocument, qeDocumentExists, listQeDocuments, queryQeState, queryQeDiagnostics } = await import('../hooks/scripts/lib/qe-access.mjs');
  if (action === 'archive-analysis') {
    if (!target || target.includes('..') || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,126}\.(?:md|json)$/.test(target)) {
      throw new Error('archive-analysis requires a safe .md or .json basename');
    }
    const { existsSync: qeExistsSync, mkdirSync, renameSync } = await import('../hooks/scripts/lib/qe-fs.mjs');
    const source = `.qe/analysis/${target}`;
    const archiveDir = '.qe/analysis/archive';
    const destination = `${archiveDir}/${target}`;
    if (!qeExistsSync(source)) throw new Error(`analysis record not found: ${target}`);
    if (qeExistsSync(destination)) throw new Error(`archived analysis record already exists: ${target}`);
    mkdirSync(archiveDir, { recursive: true });
    renameSync(source, destination);
    process.stdout.write(`${destination}\n`);
  }
  else if (action === 'read') process.stdout.write(readQeDocument(target, 'utf8'));
  else if (action === 'list') process.stdout.write(render(listQeDocuments(target).map(name => ({ name }))));
  else if (action === 'exists') process.stdout.write(`${qeDocumentExists(target) ? '1' : '0'}\n`);
  else {
    const store = openStore(process.cwd());
    try {
      const params = Object.fromEntries(rest.filter(item => item.startsWith('--') && !['--table', '--md', '--json'].includes(item)).map(item => { const [key, value = true] = item.slice(2).split('='); return [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]; }));
      if (params.limit !== undefined) params.limit = Number(params.limit);
      const result = action === 'reindex' ? reindex(process.cwd(), store) : (queryQeDiagnostics(process.cwd(), target, params) ?? queryQeState(store, target, params));
      process.stdout.write(render(Array.isArray(result) ? result : [result]));
    } finally { store.close(); }
  }
} catch (error) { console.error(`qe: ${error.message || error}`); process.exit(2); }
