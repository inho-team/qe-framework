#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bindPlan, initializePlan } from '../hooks/scripts/lib/plan-store.mjs';
import { runPhaseRetrospective } from '../hooks/scripts/lib/ledger.mjs';

class CliError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    if (!['slug', 'session', 'input', 'cwd'].includes(key) || key in out) {
      throw new CliError('PLAN_CLI_USAGE', `unknown or duplicate option: ${token}`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new CliError('PLAN_CLI_USAGE', `missing value for ${token}`);
    out[key] = value;
  }
  return out;
}

function readInput(path) {
  if (!path) throw new CliError('PLAN_CLI_USAGE', '--input is required for init');
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { throw new CliError('PLAN_CLI_INPUT_READ', `unable to read input: ${path}`); }
  try { return JSON.parse(raw); } catch { throw new CliError('PLAN_CLI_INVALID_JSON', 'input is not valid JSON'); }
}

export function runPlanCli(argv, defaultCwd = process.cwd()) {
  const args = parseArgs(argv); const operation = args._[0];
  if (!['init', 'bind', 'retrospective'].includes(operation) || args._.length !== 1 || !args.slug || !args.session) {
    throw new CliError('PLAN_CLI_USAGE', 'usage: qe-plan init|bind|retrospective --slug <slug> --session <uuid> [--input <json>]');
  }
  const cwd = args.cwd || defaultCwd;
  if (operation === 'init') {
    return initializePlan(cwd, { slug: args.slug, sessionId: args.session, input: readInput(args.input) });
  }
  if (operation === 'retrospective') {
    return runPhaseRetrospective(cwd, args.slug,
      { sessionId: args.session, input: readInput(args.input) });
  }
  return bindPlan(cwd, { slug: args.slug, sessionId: args.session });
}

function main() {
  try { process.stdout.write(`${JSON.stringify(runPlanCli(process.argv.slice(2)))}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'PLAN_CLI_ERROR', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
