#!/usr/bin/env node
/**
 * sync-metadata.mjs  (writer — run by qe-admin-mcp release/bump workflow, or manually)
 *
 * Propagates the single source of truth (scripts/lib/metadata-source.mjs)
 * into all human-facing metadata locations. Idempotent: a second run makes
 * no changes.
 *
 * Targets:
 *   - Markdown current-state counts wrapped in markers:
 *       <!--qe:skills-->N<!--/qe:skills-->   <!--qe:agents-->M<!--/qe:agents-->
 *     Only marked regions are touched, so historical changelog numbers stay
 *     frozen (they carry no markers).
 *   - package.json  "description"  →  "... N skills and M agents"
 *   - plugin.json   "description"  →  "... N skills"
 *   - plugin.json   "agents"       →  rebuilt from agents/*.md (sorted)
 *   - marketplace.json qe-framework plugin "version" → package.json version
 *
 * Does NOT write package.json "version" (owned by qe-admin-mcp release/bump workflow). Writes plugin.json
 * and marketplace.json "version" only to mirror package.json so release metadata never drifts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, getMetadata, listAgents } from './lib/metadata-source.mjs';

const MARKDOWN_FILES = ['README.md', 'docs/SYSTEM_OVERVIEW.md'];

/** Replace the contents of every `<!--qe:key-->…<!--/qe:key-->` region with `value`. */
function replaceMarker(text, key, value) {
  const re = new RegExp(`<!--qe:${key}-->[\\s\\S]*?<!--/qe:${key}-->`, 'g');
  return text.replace(re, `<!--qe:${key}-->${value}<!--/qe:${key}-->`);
}

/** Write skill/agent counts into marked regions of markdown files. @returns {string[]} changed paths. */
function syncMarkdown(meta) {
  const changed = [];
  for (const rel of MARKDOWN_FILES) {
    const abs = join(ROOT, rel);
    const before = readFileSync(abs, 'utf8');
    for (const key of ['skills', 'agents']) {
      if (!before.includes(`<!--qe:${key}-->`)) {
        console.warn(`  ! warning: ${rel} has no <!--qe:${key}--> marker — count not synced there`);
      }
    }
    let after = before;
    after = replaceMarker(after, 'skills', meta.skillCount);
    after = replaceMarker(after, 'agents', meta.agentCount);
    if (after !== before) {
      writeFileSync(abs, after);
      changed.push(rel);
    }
  }
  return changed;
}

/** Rewrite the skill/agent counts in package.json `description`. @returns {string[]} changed labels. */
function syncPackageJson(meta) {
  const abs = join(ROOT, 'package.json');
  const raw = readFileSync(abs, 'utf8');
  const pkg = JSON.parse(raw);
  const next = pkg.description
    .replace(/\d+\+?\s+skills/gi, `${meta.skillCount} skills`)
    .replace(/\d+\+?\s+agents/gi, `${meta.agentCount} agents`);
  if (next === pkg.description) return [];
  pkg.description = next;
  writeFileSync(abs, JSON.stringify(pkg, null, 2) + '\n');
  return ['package.json'];
}

/** Sync plugin.json description, rebuild agents array from disk, mirror version. @returns {string[]} changed labels. */
function syncPluginJson(meta) {
  const abs = join(ROOT, '.claude-plugin/plugin.json');
  const raw = readFileSync(abs, 'utf8');
  const plugin = JSON.parse(raw);
  const changed = [];

  const nextDesc = plugin.description
    .replace(/\d+\+?\s+skills/gi, `${meta.skillCount} skills`)
    .replace(/\d+\+?\s+agents/gi, `${meta.agentCount} agents`);
  if (nextDesc !== plugin.description) {
    plugin.description = nextDesc;
    changed.push('description');
  }

  const agents = listAgents().map((f) => `./agents/${f}`);
  if (JSON.stringify(agents) !== JSON.stringify(plugin.agents)) {
    plugin.agents = agents;
    changed.push('agents');
  }

  if (plugin.version !== meta.version) {
    plugin.version = meta.version;
    changed.push('version(mirror)');
  }

  if (changed.length === 0) return [];
  writeFileSync(abs, JSON.stringify(plugin, null, 2) + '\n');
  return [`plugin.json (${changed.join(', ')})`];
}

/** Sync marketplace.json nested qe-framework plugin version. @returns {string[]} changed labels. */
function syncMarketplaceJson(meta) {
  const abs = join(ROOT, '.claude-plugin/marketplace.json');
  const raw = readFileSync(abs, 'utf8');
  const marketplace = JSON.parse(raw);
  const plugin = (marketplace.plugins || []).find((entry) => entry?.name === 'qe-framework');
  if (!plugin || plugin.version === meta.version) return [];
  plugin.version = meta.version;
  writeFileSync(abs, JSON.stringify(marketplace, null, 2) + '\n');
  return ['marketplace.json (qe-framework version mirror)'];
}

const meta = getMetadata();
const changed = [
  ...syncMarkdown(meta),
  ...syncPackageJson(meta),
  ...syncPluginJson(meta),
  ...syncMarketplaceJson(meta),
];

console.log(`sync-metadata: source = ${meta.skillCount} skills, ${meta.agentCount} agents, v${meta.version}`);
if (changed.length === 0) {
  console.log('sync-metadata: already in sync (no changes).');
} else {
  console.log('sync-metadata: updated:');
  for (const c of changed) console.log(`  - ${c}`);
}
