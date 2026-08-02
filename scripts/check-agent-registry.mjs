#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'core', 'agent-registry.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const failures = [];

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const diskAgents = readdirSync(join(ROOT, 'agents'))
  .filter((name) => /^E.*\.md$/.test(name))
  .map((name) => name.slice(0, -3))
  .sort();
const registered = Object.keys(registry.agents).sort();

if (JSON.stringify(diskAgents) !== JSON.stringify(registered)) {
  failures.push(`registry/files mismatch: files=${diskAgents.join(',')} registry=${registered.join(',')}`);
}

const pluginAgents = (plugin.agents || []).map((p) => p.split('/').pop().replace(/\.md$/, '')).sort();
if (JSON.stringify(pluginAgents) !== JSON.stringify(registered)) {
  failures.push(`registry/plugin mismatch: plugin=${pluginAgents.join(',')} registry=${registered.join(',')}`);
}

for (const [name, spec] of Object.entries(registry.agents)) {
  const path = join(ROOT, 'agents', `${name}.md`);
  let fm;
  let body;
  try { body = readFileSync(path, 'utf8'); fm = frontmatter(body); }
  catch { failures.push(`${name}: definition missing`); continue; }

  if (fm.name !== name) failures.push(`${name}: frontmatter name=${fm.name || '(missing)'}`);
  if (fm.recommendedModel !== spec.model) failures.push(`${name}: model=${fm.recommendedModel}, registry=${spec.model}`);
  if (Number(fm.maxTurns) !== spec.maxTurns) failures.push(`${name}: maxTurns=${fm.maxTurns}, registry=${spec.maxTurns}`);

  const tools = String(fm.tools || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (JSON.stringify(tools) !== JSON.stringify(spec.tools)) {
    failures.push(`${name}: tools=${tools.join(',')} registry=${spec.tools.join(',')}`);
  }
  if (!Array.isArray(spec.callers) || spec.callers.length === 0) failures.push(`${name}: no caller declared`);
  if (!body.includes('core/AGENT_BASE.md')) failures.push(`${name}: AGENT_BASE contract not referenced`);
  if (/agent-results\/[\w-]+-latest\.md/.test(body)) failures.push(`${name}: shared latest result path is forbidden`);
  if (/\.qe\/agent-triggers\//.test(body)) failures.push(`${name}: trigger files are forbidden`);
  if (fm.permissionMode) failures.push(`${name}: permissionMode is ignored for plugin agents`);

  if (!spec.mutatesProject && !spec.artifactWriteOnly) {
    for (const forbidden of ['Write', 'Edit']) {
      if (tools.includes(forbidden)) failures.push(`${name}: read-only class has ${forbidden}`);
    }
  }
  if (spec.artifactWriteOnly && tools.includes('Edit')) failures.push(`${name}: artifact-only role may not Edit source`);
  if (spec.class === 'orchestrator' && !tools.includes('Agent')) failures.push(`${name}: orchestrator lacks Agent tool`);
}

if (failures.length) {
  console.error(`check-agent-registry: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`check-agent-registry: PASS (${registered.length} agents, metadata/tools/callers aligned)`);
