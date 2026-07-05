#!/usr/bin/env node
/**
 * Catalog pressure report for QE skill routing.
 *
 * This script is intentionally report-only. It measures local catalog size and
 * likely description/keyword collisions without deleting, moving, or rewriting
 * any installed skill or agent.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO_SKILLS = join(ROOT, 'skills');
const REPO_AGENTS = join(ROOT, 'agents');
const INSTALLED_SKILLS = join(homedir(), '.codex', 'skills');
const ROUTES_PATH = join(ROOT, 'hooks', 'scripts', 'lib', 'intent-routes.json');

const CORE_AUTO = new Set([
  'Qinit', 'Qplan', 'Qgenerate-spec', 'Qgs', 'Qrun-task', 'Qatomic-run',
  'Qcode-run-task', 'Qcommit', 'Qcompact', 'Qresume', 'Qrefresh', 'Qversion',
  'Mbump',
]);
const EXPLICIT_ONLY = new Set([
  'Qarchive', 'Qupdate', 'Qdoctor', 'Qprofile', 'Qfind-skills',
  'Qjira-cli', 'Qissue', 'Qmcp-setup', 'Qsivs-config',
]);

/**
 * Recursively collects SKILL.md files below a root directory.
 * @param {string} dir - Root directory.
 * @param {string[]} [out] - Accumulator.
 * @returns {string[]}
 */
function collectSkillFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skill = join(full, 'SKILL.md');
      if (existsSync(skill)) out.push(skill);
      else collectSkillFiles(full, out);
    }
  }
  return out;
}

/**
 * Collects markdown agent files.
 * @param {string} dir - Agent directory.
 * @returns {string[]}
 */
function collectAgentFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/**
 * Parses simple YAML frontmatter key-value pairs.
 * @param {string} content - Markdown content.
 * @returns {Record<string, string>}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) result[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

/**
 * Builds metadata rows for skills and agents.
 * @param {string[]} files - Markdown files.
 * @param {string} baseDir - Base directory for relative names.
 * @returns {Array<{name: string, path: string, description: string, descriptionLength: number}>}
 */
function metadataRows(files, baseDir) {
  return files.map((path) => {
    const content = readFileSync(path, 'utf8');
    const fm = parseFrontmatter(content);
    const rel = relative(baseDir, path).replace(/\/SKILL\.md$/, '').replace(/\.md$/, '');
    const name = fm.name || rel;
    const description = fm.description || '';
    return { name, path, description, descriptionLength: description.length };
  });
}

/**
 * Tokenizes text into routing-salient words.
 * @param {string} text - Source text.
 * @returns {string[]}
 */
function tokenize(text) {
  const stop = new Set(['the', 'and', 'for', 'with', 'when', 'use', 'used', 'using', 'that', 'this', 'from', 'into', 'your']);
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter((token) => token.length > 2 && !stop.has(token));
}

/**
 * Computes Jaccard similarity for two token lists.
 * @param {string[]} left - First token list.
 * @param {string[]} right - Second token list.
 * @returns {number}
 */
function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / (a.size + b.size - overlap);
}

/**
 * Finds top description collision pairs.
 * @param {Array<{name: string, description: string}>} rows - Metadata rows.
 * @param {number} limit - Maximum rows.
 * @returns {Array<{left: string, right: string, score: number}>}
 */
function topCollisions(rows, limit = 10) {
  const tokenized = rows.map((row) => ({ ...row, tokens: tokenize(row.description) }));
  const pairs = [];
  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const score = jaccard(tokenized[i].tokens, tokenized[j].tokens);
      if (score > 0) pairs.push({ left: tokenized[i].name, right: tokenized[j].name, score });
    }
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Classifies a routing surface for reporting.
 * @param {string} name - Skill or agent name.
 * @returns {string}
 */
function surfaceClass(name) {
  if (CORE_AUTO.has(name)) return 'core-auto';
  if (EXPLICIT_ONLY.has(name)) return 'explicit-only';
  if (/^E/.test(name)) return 'delegated-agent';
  return 'optional';
}

/**
 * Computes basic numeric stats for description lengths.
 * @param {number[]} values - Numeric values.
 * @returns {{min: number, median: number, p95: number, max: number, avg: number}}
 */
function stats(values) {
  if (values.length === 0) return { min: 0, median: 0, p95: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    min: sorted[0],
    median: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil((sorted.length - 1) * 0.95)],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / values.length),
  };
}

/**
 * Renders a markdown table.
 * @param {string[]} headers - Table headers.
 * @param {string[][]} rows - Table rows.
 * @returns {string}
 */
function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const repoSkillRows = metadataRows(collectSkillFiles(REPO_SKILLS), REPO_SKILLS);
const installedSkillRows = metadataRows(collectSkillFiles(INSTALLED_SKILLS), INSTALLED_SKILLS);
const agentRows = metadataRows(collectAgentFiles(REPO_AGENTS), REPO_AGENTS);
const routes = JSON.parse(readFileSync(ROUTES_PATH, 'utf8')).routes || {};
const routeEntries = Object.entries(routes).map(([keywords, target]) => ({
  keywords,
  target: typeof target === 'string' ? target : target?.skill || '',
  keywordCount: keywords.split('/').length,
  keywordLength: keywords.length,
}));
const routePressure = routeEntries
  .sort((a, b) => b.keywordCount - a.keywordCount || b.keywordLength - a.keywordLength)
  .slice(0, 10);
const surfaceCounts = new Map();
for (const row of [...repoSkillRows, ...agentRows]) {
  const cls = surfaceClass(row.name);
  surfaceCounts.set(cls, (surfaceCounts.get(cls) || 0) + 1);
}
for (const route of routeEntries) {
  const cls = surfaceClass(route.target);
  if (!surfaceCounts.has(cls)) surfaceCounts.set(cls, 0);
}
const descriptionStats = stats([...repoSkillRows, ...agentRows].map((row) => row.descriptionLength));
const collisions = topCollisions([...repoSkillRows, ...agentRows], 12);

console.log(`# Catalog Pressure Report

Generated: ${new Date().toISOString()}

## Counts

${table(['Metric', 'Value'], [
  ['Repo skills', String(repoSkillRows.length)],
  ['Installed Codex skills', String(installedSkillRows.length)],
  ['Repo agents', String(agentRows.length)],
  ['Intent routes', String(routeEntries.length)],
])}

## Description Lengths

${table(['min', 'median', 'avg', 'p95', 'max'], [[
  String(descriptionStats.min),
  String(descriptionStats.median),
  String(descriptionStats.avg),
  String(descriptionStats.p95),
  String(descriptionStats.max),
]])}

## Surface Classes

${table(['Class', 'Count', 'Policy'], [
  ['core-auto', String(surfaceCounts.get('core-auto') || 0), 'Small PSE/lifecycle set that may be suggested automatically.'],
  ['explicit-only', String(surfaceCounts.get('explicit-only') || 0), 'Useful command surface, but should be invoked directly or by narrow keywords.'],
  ['delegated-agent', String(surfaceCounts.get('delegated-agent') || 0), 'Internal E-agent role; prefer Q/M wrappers for user-facing commands.'],
  ['optional', String(surfaceCounts.get('optional') || 0), 'Domain or long-tail skill surface; keep out of hard auto-routing unless benchmarked.'],
])}

## Route Keyword Pressure

${table(['Target', 'Keyword parts', 'Keyword chars', 'Keywords'], routePressure.map((route) => [
  route.target,
  String(route.keywordCount),
  String(route.keywordLength),
  route.keywords.replace(/\|/g, '\\|'),
]))}

## Top Collision Clusters

${table(['Left', 'Right', 'Jaccard'], collisions.map((pair) => [
  pair.left,
  pair.right,
  pair.score.toFixed(2),
]))}

## Slim-Catalog Guidance

QE core behavior depends on the core-auto wrappers, hard safety routes, and
agent-backed delegation contracts. Personal catalog slimming should therefore
prefer removing or hiding optional domain skills first, while preserving:

- PSE core-auto commands: Qplan, Qgs/Qgenerate-spec, Qrun-task, Qatomic-run,
  Qcode-run-task, Qcommit, Qcompact, Qresume, Qrefresh, Qversion.
- Maintainer safety surfaces: Mbump and the commit/version override routes.
- E-agents only behind documented Q/M wrappers unless the route is explicitly
  marked as an expert-only direct-agent fallback.

This report does not delete or move anything. It only supplies evidence for a
future catalog policy task.
`);
