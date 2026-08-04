#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'inho-team/qe-framework';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 32 * 1024;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ISSUE_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/issues\/[1-9][0-9]*$/;
const TYPES = new Set(['bug', 'feature', 'question']);

export class QissueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QissueError';
    this.code = code;
  }
}

function boundedString(value, field, maxBytes, { nonblank = true } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new QissueError('QISSUE_INVALID_REQUEST', `${field} is invalid`);
  }
  if (nonblank && value.trim() === '') throw new QissueError('QISSUE_INVALID_REQUEST', `${field} is blank`);
  return value;
}

export function parseRequest(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
    throw new QissueError('QISSUE_INVALID_REQUEST', 'request exceeds the input limit');
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new QissueError('QISSUE_INVALID_REQUEST', 'request must be JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QissueError('QISSUE_INVALID_REQUEST', 'request must be an object');
  }
  const repo = value.repo === undefined ? DEFAULT_REPO : boundedString(value.repo, 'repo', 200);
  const type = boundedString(value.type, 'type', 16);
  const title = boundedString(value.title, 'title', 320);
  const body = boundedString(value.body, 'body', MAX_BODY_BYTES);
  const [owner, name] = repo.split('/');
  const unsafeRepoSegment = [owner, name].some(segment => segment === '.' || segment === '..');
  if (!REPO_RE.test(repo) || unsafeRepoSegment || !TYPES.has(type) || Array.from(title).length > 80 || title.trim() !== title || /[\r\n]/u.test(title)) {
    throw new QissueError('QISSUE_INVALID_REQUEST', 'repo, type, or title is invalid');
  }
  return Object.freeze({ repo, type, title, body });
}

function qeVersion(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'n/a';
  } catch { return 'n/a'; }
}

export function prepareIssue(request, environment = {}) {
  const qe = environment.qeVersion ?? qeVersion(environment.cwd ?? process.cwd());
  const node = environment.nodeVersion ?? process.version;
  const os = environment.osInfo ?? `${platform()} ${release()} ${arch()}`;
  const body = `${request.body.trim()}\n\n---\n\n**Environment**\n- QE Framework: ${qe}\n- OS: ${os}\n- Node: ${node}\n\n<sub>Submitted via optional Qissue adapter</sub>`;
  return Object.freeze({ ...request, body });
}

function run(spawn, command, args, options = {}) {
  return spawn(command, args, { encoding: 'utf8', shell: false, maxBuffer: 128 * 1024, ...options });
}

function boundedDiagnostic(result) {
  const text = typeof result?.stderr === 'string' ? result.stderr.trim() : '';
  return text.slice(0, 2048) || 'gh command failed';
}

export function createIssue(issue, { spawn = spawnSync } = {}) {
  const installed = run(spawn, 'gh', ['--version']);
  if (installed.error?.code === 'ENOENT') throw new QissueError('QISSUE_GH_MISSING', 'GitHub CLI is not installed');
  if (installed.status !== 0) throw new QissueError('QISSUE_GH_MISSING', 'GitHub CLI is unavailable');

  const githubEnvironment = { ...process.env, GH_HOST: 'github.com' };
  const authenticated = run(spawn, 'gh', ['auth', 'status', '--hostname=github.com'], { env: githubEnvironment });
  if (authenticated.status !== 0) throw new QissueError('QISSUE_GH_AUTH', 'Run gh auth login before using Qissue');

  const created = run(spawn, 'gh', [
    'issue', 'create',
    `--repo=${issue.repo}`,
    `--label=${issue.type}`,
    `--title=${issue.title}`,
    '--body-file=-',
  ], { input: issue.body, env: githubEnvironment });
  if (created.status !== 0) throw new QissueError('QISSUE_CREATE_FAILED', boundedDiagnostic(created));
  const url = typeof created.stdout === 'string' ? created.stdout.trim() : '';
  if (!ISSUE_URL_RE.test(url)) throw new QissueError('QISSUE_INVALID_RESPONSE', 'gh returned no canonical issue URL');
  return Object.freeze({ url, repo: issue.repo, type: issue.type, title: issue.title });
}

function parseArgs(argv) {
  const result = { dryRun: false, requestFile: null };
  for (const arg of argv) {
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg.startsWith('--request-file=')) result.requestFile = arg.slice('--request-file='.length);
    else throw new QissueError('QISSUE_INVALID_REQUEST', `unknown argument: ${arg}`);
  }
  return result;
}

function readRequest(path) {
  if (!path) return readFileSync(0, 'utf8');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) throw new QissueError('QISSUE_INVALID_REQUEST', 'request file is invalid');
  return readFileSync(path, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const issue = prepareIssue(parseRequest(readRequest(args.requestFile)));
    const result = args.dryRun ? { dryRun: true, ...issue } : createIssue(issue);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof QissueError ? error.code : 'QISSUE_CREATE_FAILED';
    const message = error instanceof QissueError ? error.message : 'unexpected adapter failure';
    process.stderr.write(`${code}: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
