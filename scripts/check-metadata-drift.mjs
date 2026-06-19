#!/usr/bin/env node
/**
 * check-metadata-drift.mjs  (gate — auto-discovered by check-all.mjs)
 *
 * Asserts that every human-facing metadata location matches the single source
 * of truth (scripts/lib/metadata-source.mjs). Exits non-zero with a diff report
 * on any mismatch, so CI blocks the PR. Run `node scripts/sync-metadata.mjs`
 * to fix.
 *
 * Only marked current-state numbers and machine-readable fields are checked;
 * historical changelog entries (no markers) are intentionally ignored.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, getMetadata, listAgents } from './lib/metadata-source.mjs';

const meta = getMetadata();
const failures = [];

/** Extract all values inside `<!--qe:key-->…<!--/qe:key-->` regions. @returns {string[]} */
function markerValues(text, key) {
  const re = new RegExp(`<!--qe:${key}-->([\\s\\S]*?)<!--/qe:${key}-->`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

// 1. Markdown markers
const MARKDOWN_FILES = ['README.md', 'docs/SYSTEM_OVERVIEW.md'];
for (const rel of MARKDOWN_FILES) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  for (const [key, expected] of [
    ['skills', String(meta.skillCount)],
    ['agents', String(meta.agentCount)],
  ]) {
    const vals = markerValues(text, key);
    if (vals.length === 0) {
      failures.push(`${rel}: no <!--qe:${key}--> marker found (expected current-state count)`);
      continue;
    }
    for (const v of vals) {
      if (v !== expected) failures.push(`${rel}: qe:${key} = "${v}", expected "${expected}"`);
    }
  }
}

// 2. package.json description
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!new RegExp(`\\b${meta.skillCount} skills\\b`).test(pkg.description))
    failures.push(`package.json description: missing "${meta.skillCount} skills" (got: "${pkg.description}")`);
  if (!new RegExp(`\\b${meta.agentCount} agents\\b`).test(pkg.description))
    failures.push(`package.json description: missing "${meta.agentCount} agents"`);
}

// 3. plugin.json description + agents array + version mirror
{
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  if (!new RegExp(`\\b${meta.skillCount} skills\\b`).test(plugin.description))
    failures.push(`plugin.json description: missing "${meta.skillCount} skills" (got: "${plugin.description}")`);

  const expectedAgents = listAgents().map((f) => `./agents/${f}`);
  const got = plugin.agents || [];
  // Compare against the sorted canonical array sync produces (same definition).
  if (JSON.stringify(got) !== JSON.stringify(expectedAgents)) {
    if (got.length !== expectedAgents.length)
      failures.push(`plugin.json agents: ${got.length} listed, ${expectedAgents.length} on disk`);
    const missing = expectedAgents.filter((a) => !got.includes(a));
    if (missing.length) failures.push(`plugin.json agents: missing ${missing.join(', ')}`);
    const extra = got.filter((a) => !expectedAgents.includes(a));
    if (extra.length) failures.push(`plugin.json agents: unexpected ${extra.join(', ')}`);
    if (!missing.length && !extra.length)
      failures.push('plugin.json agents: order differs from sorted canonical');
  }

  if (plugin.version !== meta.version)
    failures.push(`plugin.json version "${plugin.version}" != package.json version "${meta.version}"`);
}

if (failures.length) {
  console.error(`check-metadata-drift: FAIL — source = ${meta.skillCount} skills, ${meta.agentCount} agents, v${meta.version}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('\n  → run: node scripts/sync-metadata.mjs');
  process.exit(1);
}

console.log(`check-metadata-drift: PASS (${meta.skillCount} skills, ${meta.agentCount} agents, v${meta.version})`);
