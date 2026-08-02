#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'core', 'agent-registry.json'), 'utf8'));
const suite = JSON.parse(readFileSync(join(ROOT, 'evals', 'agent-cases.json'), 'utf8'));
const failures = [];
const byAgent = new Map();

for (const entry of suite.cases || []) {
  if (!registry.agents[entry.agent]) failures.push(`case names unknown agent ${entry.agent}`);
  if (byAgent.has(entry.agent)) failures.push(`duplicate case for ${entry.agent}`);
  byAgent.set(entry.agent, entry);
  if (!String(entry.positive || '').trim()) failures.push(`${entry.agent}: positive case missing`);
  if (!String(entry.boundary || '').trim()) failures.push(`${entry.agent}: boundary case missing`);
  if (!Array.isArray(entry.mustNotUse)) failures.push(`${entry.agent}: mustNotUse must be an array`);

  const granted = registry.agents[entry.agent]?.tools || [];
  for (const tool of entry.mustNotUse || []) {
    if (granted.includes(tool)) failures.push(`${entry.agent}: forbidden eval tool ${tool} is granted`);
  }
}

for (const name of Object.keys(registry.agents)) {
  if (!byAgent.has(name)) failures.push(`${name}: no positive/boundary eval case`);
}

if (failures.length) {
  console.error(`check-agent-evals: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`check-agent-evals: PASS (${byAgent.size} agents have positive/boundary/tool-policy cases)`);
