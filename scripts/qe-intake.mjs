#!/usr/bin/env node
import { readFileSync } from '../hooks/scripts/lib/qe-fs.mjs';
import { fileURLToPath } from 'node:url';
import {
  answerQuestion, confirmIntake, correctAnswer, correctSynthesis, createIntake,
  issueNextBatch, pauseIntake, rebaselineIntake, requestRebaseline, resumeIntake,
  skipQuestion, stopIntake, synthesizeIntake,
} from '../hooks/scripts/lib/knowledge-elicitation.mjs';
import {
  initializeIntakeRecord, mutateIntakeRecord, readIntakeRecord,
} from '../hooks/scripts/lib/knowledge-elicitation-store.mjs';

class CliError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    if (!['slug', 'session', 'expected-revision', 'input'].includes(key) || key in args) {
      throw new CliError('INTAKE_CLI_USAGE', `Unknown or duplicate option: ${token}`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new CliError('INTAKE_CLI_USAGE', `Missing value for ${token}`);
    args[key] = value;
  }
  return args;
}

function inputJson(path, required = false) {
  if (!path) {
    if (required) throw new CliError('INTAKE_CLI_INPUT_REQUIRED', '--input is required');
    return {};
  }
  let raw;
  try { raw = readFileSync(path === '-' ? '/dev/stdin' : path, 'utf8'); }
  catch { throw new CliError('INTAKE_CLI_INPUT_READ', `Unable to read input: ${path}`); }
  try { return JSON.parse(raw); }
  catch { throw new CliError('INTAKE_CLI_INVALID_JSON', 'Input is not valid JSON'); }
}

function transitionFor(operation, payload) {
  if (operation === 'next') return (state) => {
    const issued = issueNextBatch(state);
    return { state: issued.state, result: { questions: issued.questions } };
  };
  if (operation === 'answer') return (state) => answerQuestion(state, payload.questionId, payload.response);
  if (operation === 'skip') return (state) => skipQuestion(state, payload.questionId, payload.options);
  if (operation === 'correct') return (state) => correctAnswer(state, payload.questionId, payload.correction);
  if (operation === 'pause') return (state) => pauseIntake(state);
  if (operation === 'resume') return (state) => resumeIntake(state);
  if (operation === 'stop') return (state) => stopIntake(state);
  if (operation === 'confirm') return (state) => confirmIntake(state);
  if (operation === 'rebaseline') {
    if (payload.action === 'request') return (state) => requestRebaseline(state);
    if (['accept', 'decline'].includes(payload.action)) {
      return (state) => rebaselineIntake(state, { ...payload, decision: payload.action });
    }
    throw new CliError('INTAKE_CLI_INVALID_INPUT', 'rebaseline action must be request, accept, or decline');
  }
  if (operation === 'synthesize') {
    if (payload.action === 'correct') return (state) => correctSynthesis(state, payload);
    if (!payload.action || payload.action === 'create') return (state) => synthesizeIntake(state, payload);
    throw new CliError('INTAKE_CLI_INVALID_INPUT', 'synthesize action must be create or correct');
  }
  throw new CliError('INTAKE_CLI_USAGE', `Unknown operation: ${operation}`);
}

export function runIntakeCli(argv, cwd = process.cwd()) {
  const args = parseArgs(argv);
  const operation = args._[0];
  if (!operation || args._.length !== 1 || !args.slug) {
    throw new CliError('INTAKE_CLI_USAGE', 'Usage: qe-intake <operation> --slug <slug> [options]');
  }
  if (operation === 'status') {
    return { ok: true, operation, changed: false, record: readIntakeRecord(cwd, args.slug) };
  }
  if (!args.session) throw new CliError('INTAKE_CLI_USAGE', '--session is required');
  if (operation === 'init') {
    const state = createIntake(inputJson(args.input, true));
    return { ok: true, operation, changed: true, record: initializeIntakeRecord(cwd, args.slug, args.session, state) };
  }
  if (!args['expected-revision'] || !/^\d+$/.test(args['expected-revision'])) {
    throw new CliError('INTAKE_CLI_USAGE', '--expected-revision is required and must be an integer');
  }
  const payload = inputJson(args.input, ['answer', 'skip', 'correct', 'rebaseline', 'synthesize'].includes(operation));
  const mutation = mutateIntakeRecord(cwd, args.slug, {
    ownerSession: args.session,
    expectedRevision: Number(args['expected-revision']),
    transition: transitionFor(operation, payload),
  });
  return { ok: true, operation, ...mutation };
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(runIntakeCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? 'INTAKE_CLI_ERROR', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
