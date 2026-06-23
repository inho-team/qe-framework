#!/usr/bin/env node
/**
 * check-entrypoints.mjs
 *
 * Guards against the failure class that broke `npm run qe:mcp` / `npm run
 * qe:secret`: a CLI entrypoint (or a lib it imports) that no longer resolves
 * its import chain and crashes on load with ERR_MODULE_NOT_FOUND. Unit tests
 * miss this because they cover the *libs under test*, never the entrypoints —
 * so a dangling import (e.g. the removed `ai_team_config.mjs`) ships green.
 *
 * Two checks:
 *  1. Import-safe libs are dynamically imported — any unresolved import throws.
 *  2. CLI tools are spawned with no args (they print usage and exit) — output
 *     must not contain a module/syntax load error, and they must not hang.
 *
 * Auto-discovered and run by check-all.mjs.
 */

import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOAD_ERROR = /ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNSUPPORTED_DIR_IMPORT|SyntaxError/;

// Side-effect-free libs whose import chains must resolve. Importing them runs
// no main(), so a clean import proves every transitive dependency exists.
const IMPORT_LIBS = [
  'scripts/lib/json-io.mjs',
  'scripts/lib/qe_mcp_registry.mjs',
  'scripts/lib/qe_secrets.mjs',
];

// CLI tools that must at least load and print usage when given no args.
// (qe_mcp_server.mjs is intentionally excluded — it's a long-running stdio
// server that would block a no-arg spawn.)
const CLI_TOOLS = [
  'scripts/qe_mcp.mjs',
  'scripts/qe_secret.mjs',
];

const failures = [];

for (const rel of IMPORT_LIBS) {
  try {
    await import(join(REPO_ROOT, rel));
    console.log(`  [PASS] import ${rel}`);
  } catch (err) {
    console.error(`  [FAIL] import ${rel}: ${err.message.split('\n')[0]}`);
    failures.push(rel);
  }
}

for (const rel of CLI_TOOLS) {
  const r = spawnSync('node', [join(REPO_ROOT, rel)], {
    encoding: 'utf8',
    timeout: 15000,
    input: '',
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.signal) {
    console.error(`  [FAIL] ${rel}: did not exit (signal ${r.signal} — likely hang)`);
    failures.push(rel);
  } else if (LOAD_ERROR.test(out)) {
    console.error(`  [FAIL] ${rel}: load error — ${out.match(LOAD_ERROR)[0]}`);
    failures.push(rel);
  } else {
    console.log(`  [PASS] load ${rel} (exit ${r.status})`);
  }
}

if (failures.length) {
  console.error(`\ncheck-entrypoints: FAIL — ${failures.length} entrypoint(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\ncheck-entrypoints: PASS — ${IMPORT_LIBS.length + CLI_TOOLS.length} entrypoint(s) load cleanly`);
