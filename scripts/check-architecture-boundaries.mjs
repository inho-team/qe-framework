#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx']);
const DEFAULT_ROOTS = ['core', 'scripts/lib', 'hooks/scripts/lib', 'hooks/scripts/codex', 'adapters'];

// The legacy edge budget is intentionally zero. New exceptions require a new
// architecture decision and must not be added as a convenience bypass.
export const LEGACY_BOUNDARY_EDGES = new Map();

function posix(value) {
  return value.replaceAll('\\', '/');
}

function listSources(root, relPath) {
  const absolute = resolve(root, relPath);
  if (!existsSync(absolute)) return [];
  const stat = statSync(absolute);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(extname(absolute)) ? [absolute] : [];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'fixtures') continue;
    files.push(...listSources(root, join(relPath, entry)));
  }
  return files;
}

export function classifyArchitecturePath(relPath) {
  const rel = posix(relPath);
  const base = rel.split('/').pop().toLowerCase();
  if (/(?:^|\/)adapters?\/claude(?:\/|$)/.test(rel) || /(?:^|[-_.])claude(?:[-_.]|$)/.test(base)) return 'adapter:claude';
  if (/(?:^|\/)adapters?\/codex(?:\/|$)/.test(rel) || rel.startsWith('hooks/scripts/codex/') || /(?:^|[-_.])codex(?:[-_.]|$)/.test(base)) return 'adapter:codex';
  if (rel.startsWith('core/') || rel.startsWith('scripts/lib/') || rel.startsWith('hooks/scripts/lib/')) return 'core';
  return 'outside';
}

export function extractStaticImports(source) {
  const imports = [];
  let inBlockComment = false;
  const lines = String(source).split(/\r?\n/);
  lines.forEach((raw, index) => {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    while (line.includes('/*')) {
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start + 2);
      if (end < 0) {
        line = line.slice(0, start);
        inBlockComment = true;
        break;
      }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    if (/^\s*\/\//.test(line)) return;

    const patterns = [
      /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    ];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        imports.push({ specifier: match[1], line: index + 1 });
        break;
      }
    }
  });
  return imports;
}

function resolveImport(root, importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = normalize(resolve(dirname(importer), specifier));
  const choices = extname(candidate)
    ? [candidate]
    : [...SOURCE_EXTENSIONS].map(extension => `${candidate}${extension}`);
  const target = choices.find(existsSync);
  return target ? posix(relative(root, target)) : null;
}

export function scanArchitectureBoundaries(root, options = {}) {
  const rootAbs = resolve(root);
  const roots = options.roots ?? DEFAULT_ROOTS;
  const allowlist = options.allowlist ?? LEGACY_BOUNDARY_EDGES;
  const findings = [];
  const debts = [];

  for (const importer of roots.flatMap(rel => listSources(rootAbs, rel))) {
    const importerRel = posix(relative(rootAbs, importer));
    const importerZone = classifyArchitecturePath(importerRel);
    if (importerZone === 'outside') continue;
    const source = readFileSync(importer, 'utf8');
    for (const imported of extractStaticImports(source)) {
      const targetRel = resolveImport(rootAbs, importer, imported.specifier);
      if (!targetRel) continue;
      const targetZone = classifyArchitecturePath(targetRel);
      let boundary = null;
      if (importerZone === 'core' && targetZone.startsWith('adapter:')) boundary = 'core-to-adapter';
      if (importerZone.startsWith('adapter:') && targetZone.startsWith('adapter:') && importerZone !== targetZone) boundary = 'adapter-cross-import';
      if (!boundary) continue;

      const edge = `${importerRel} -> ${targetRel}`;
      if (allowlist.has(edge)) {
        debts.push({ edge, reason: allowlist.get(edge), boundary, file: importerRel, line: imported.line });
      } else {
        findings.push({ edge, boundary, file: importerRel, line: imported.line, target: targetRel });
      }
    }
  }
  return { findings, debts };
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : process.cwd();
  const { findings, debts } = scanArchitectureBoundaries(root);
  if (findings.length > 0) {
    console.error(`check-architecture-boundaries: FAIL (${findings.length} violation(s); policy: core/ARCHITECTURE_BOUNDARIES.md)`);
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.boundary}] imports ${finding.target}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`check-architecture-boundaries: PASS (0 new violations; ${debts.length} named legacy edge(s))`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
