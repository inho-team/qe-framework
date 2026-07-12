#!/usr/bin/env node
/**
 * check-sivs-routing-default.mjs
 * Guard the recommended SIVS default: Claude Head / Codex Body.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  SIVS_PROFILES,
  getDefaultSivsConfig,
  resolveProfileName,
} from './lib/codex_bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const expected = {
  spec: 'claude',
  implement: 'codex',
  verify: 'codex',
  supervise: 'claude',
};

const failures = [];

function fail(message) {
  failures.push(message);
}

function assertStageMap(label, config) {
  for (const [stage, engine] of Object.entries(expected)) {
    if (config?.[stage]?.engine !== engine && config?.[stage] !== engine) {
      fail(`${label}.${stage} expected ${engine}, got ${JSON.stringify(config?.[stage])}`);
    }
  }
}

assertStageMap('SIVS_PROFILES.claude-head', SIVS_PROFILES['claude-head']);
assertStageMap('getDefaultSivsConfig(codexAvailable=true)', getDefaultSivsConfig({ codexAvailable: true }));

const effectiveProfile = resolveProfileName({}, { codexAvailable: true });
if (effectiveProfile !== 'claude-head') {
  fail(`resolveProfileName({}, codexAvailable=true) expected claude-head, got ${effectiveProfile}`);
}

const conventions = readFileSync(join(root, 'QE_CONVENTIONS.md'), 'utf8');
if (!conventions.includes('claude-head') || !conventions.includes('Claude Head / Codex Body')) {
  fail('QE_CONVENTIONS.md must name claude-head as Claude Head / Codex Body');
}

const qsivs = readFileSync(join(root, 'skills', 'Qsivs-config', 'SKILL.md'), 'utf8');
if (!qsivs.includes('| `claude-head` | claude | codex | codex | claude |')) {
  fail('Qsivs-config profile table must define claude-head as claude/codex/codex/claude');
}

const forbiddenDisjointClaims = [
  '`codex-head`/`claude-head` are disjoint',
  '`claude-head`/`codex-head` are disjoint',
];
for (const claim of forbiddenDisjointClaims) {
  if (qsivs.includes(claim)) {
    fail(`Qsivs-config must not claim ${claim}; claude-head uses Codex for both Body stages`);
  }
}

if (failures.length) {
  console.error('[sivs-routing-default] FAIL');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[sivs-routing-default] PASS — recommended default is Claude Head / Codex Body');
