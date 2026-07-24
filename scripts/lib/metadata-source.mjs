/**
 * metadata-source.mjs
 * Single source of truth for QE framework metadata.
 *
 * Counts are derived from the filesystem at call time (never hardcoded):
 *   - skillCount  = total number of SKILL.md files under skills/ (recursive;
 *                   skills may be flat `skills/X/SKILL.md` or categorized
 *                   `skills/cat/sub/X/SKILL.md`). Each SKILL.md is one skill.
 *   - agentCount  = number of *.md files under agents/.
 *   - version     = package.json "version" field (canonical; owned by Qrelease release flow).
 *
 * Consumers: sync-metadata.mjs (writer) and check-metadata-drift.mjs (gate).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');

/** Recursively count files named `filename` under `dir`. @internal */
function countFilesNamed(dir, filename) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      total += countFilesNamed(join(dir, entry.name), filename);
    } else if (entry.name === filename) {
      total += 1;
    }
  }
  return total;
}

/** @returns {number} total SKILL.md files under skills/ (one per skill). */
export function getSkillCount() {
  return countFilesNamed(join(ROOT, 'skills'), 'SKILL.md');
}

/**
 * @returns {string[]} sorted basenames of agent definition files in agents/.
 * Excludes ALL-CAPS docs (README.md, INDEX.md, TEMPLATE.md, CATALOG.md, …) so a
 * stray top-level doc is never miscounted as an agent or pushed into plugin.json.
 */
export function listAgents() {
  return readdirSync(join(ROOT, 'agents'))
    .filter((f) => f.endsWith('.md'))
    .filter((f) => {
      const stem = f.slice(0, -'.md'.length);
      return stem.toUpperCase() !== stem; // drop ALL-CAPS docs; agents are mixed-case (E*)
    })
    .sort();
}

/** @returns {number} number of agent definition files. */
export function getAgentCount() {
  return listAgents().length;
}

/** @returns {string} canonical version from package.json (owned by Qrelease release flow). */
export function getVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

/** @returns {{version:string, skillCount:number, agentCount:number}} the single source of truth. */
export function getMetadata() {
  return {
    version: getVersion(),
    skillCount: getSkillCount(),
    agentCount: getAgentCount(),
  };
}
