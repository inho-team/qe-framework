#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync,
  renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createEligibleProcessController } from '../hooks/scripts/lib/process-controller.mjs';

import {
  buildCodexArgs,
  buildPilotSchedule,
  appendPilotAttemptEvent,
  createPilotAttemptContext,
  createPilotCell,
  createPilotRuntimeBudget,
  createPilotTerminalRun,
  deriveSmokeAdmission,
  loadPilotFixture,
  parseCodexResult,
  projectPilotAttempts,
  runPilot,
  runBoundedProcess,
  scoreHiddenAcceptance,
  validatePilotFixture,
} from './lib/harness-pilot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = join(ROOT, 'scripts', 'fixtures', 'harness-pilot.json');
const OWNER_FILE = '.qe-harness-owner.json';
const LOCK_DIR = '.pilot-lock';
const LOCK_OWNER = 'owner.json';
const MAX_LOCK_OWNER_BYTES = 4096;

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertNoSymlinkComponents(target) {
  const absolute = resolve(target);
  const parsedRoot = resolve(absolute, sep);
  const parts = relative(parsedRoot, absolute).split(sep).filter(Boolean);
  let cursor = parsedRoot;
  for (const part of parts) {
    cursor = join(cursor, part);
    let entry;
    try { entry = lstatSync(cursor); }
    catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (entry.isSymbolicLink()) throw codedError('PILOT_OUTPUT_UNSAFE', `symlink component: ${cursor}`);
  }
}

/** Resolve an output root without creating or mutating it. */
export function resolvePilotOutputRoot({ repoRoot = ROOT, outputDir = null } = {}) {
  const repo = realpathSync(resolve(repoRoot));
  const relativeExplicit = outputDir !== null && !isAbsolute(outputDir);
  const requested = resolve(outputDir === null
    ? join(repo, '.qe', 'runtime', 'harness-pilot', 'codex')
    : relativeExplicit ? join(repo, outputDir) : outputDir);
  if ([resolve(sep), resolve(homedir()), repo].includes(requested)) {
    throw codedError('PILOT_OUTPUT_UNSAFE', 'filesystem root, home, and repository root are forbidden');
  }
  assertNoSymlinkComponents(requested);
  if (within(repo, requested)) {
    const runtimeRoot = resolve(repo, '.qe', 'runtime');
    if (!within(runtimeRoot, requested) || requested === runtimeRoot) {
      throw codedError('PILOT_OUTPUT_UNSAFE', 'repository output must be a dedicated .qe/runtime child');
    }
  } else if (relativeExplicit) {
    throw codedError('PILOT_OUTPUT_UNSAFE', 'external output must be an absolute path');
  }
  return requested;
}

function outputMarker(repoRoot) {
  return { schema: 1, kind: 'qe-harness-runtime', repository: realpathSync(resolve(repoRoot)) };
}

function exactJson(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function canonicalIso(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function readBoundedJsonNoFollow(path, maxBytes, code) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw codedError(code, `${path}: expected a bounded regular file`);
  }
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) {
      throw codedError(code, `${path}: identity changed`);
    }
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytes === 0) throw codedError(code, `${path}: short read`);
      offset += bytes;
    }
    try { return JSON.parse(buffer.toString('utf8')); }
    catch { throw codedError(code, `${path}: invalid JSON`); }
  } finally { closeSync(fd); }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(fd);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) {
      throw codedError('PILOT_DURABILITY_UNCERTAIN', `${directory}: ${error.message}`);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function ensureRealDirectory(path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
    throw codedError('PILOT_OUTPUT_UNSAFE', `${path}: expected a real directory`);
  }
  return path;
}

export function atomicWritePilotFile(target, content, {
  directorySync = syncDirectory, beforeRename = () => {},
} = {}) {
  if (typeof content !== 'string') throw new TypeError('atomic pilot content must be a string');
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const temp = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);
  let fd;
  let renamed = false;
  try {
    fd = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    const data = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    beforeRename(temp, target);
    renameSync(temp, target);
    renamed = true;
    directorySync(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!renamed && existsSync(temp)) unlinkSync(temp);
  }
  return target;
}

export function atomicWritePilotJson(target, value, options) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return atomicWritePilotFile(target, serialized, options);
}

export function preparePilotOutputRoot({ repoRoot = ROOT, outputDir = null } = {}) {
  const target = resolvePilotOutputRoot({ repoRoot, outputDir });
  const repo = realpathSync(resolve(repoRoot));
  const existed = existsSync(target);
  if (!existed) mkdirSync(target, { recursive: true, mode: 0o700 });
  const realTarget = realpathSync(target);
  if (realTarget !== target || lstatSync(realTarget).isSymbolicLink() || !statSync(realTarget).isDirectory()) {
    throw codedError('PILOT_OUTPUT_UNSAFE', 'output root must be a real directory');
  }
  const markerPath = join(realTarget, OWNER_FILE);
  const expected = outputMarker(repoRoot);
  if (existsSync(markerPath)) {
    if (lstatSync(markerPath).isSymbolicLink() || !lstatSync(markerPath).isFile()) {
      throw codedError('PILOT_OUTPUT_UNSAFE', 'invalid output ownership marker');
    }
    const marker = readBoundedJsonNoFollow(markerPath, MAX_LOCK_OWNER_BYTES, 'PILOT_OUTPUT_UNSAFE');
    if (!exactJson(marker, ['schema', 'kind', 'repository'])
      || JSON.stringify(marker) !== JSON.stringify(expected)) {
      throw codedError('PILOT_OUTPUT_UNSAFE', 'output ownership marker mismatch');
    }
  } else {
    const entries = readdirSync(realTarget);
    if (existed && (!within(repo, realTarget) || entries.length > 0)) {
      throw codedError('PILOT_OUTPUT_UNSAFE', 'existing output directory is not harness-owned');
    }
    atomicWritePilotJson(markerPath, expected);
  }
  const identity = statSync(realTarget);
  return { path: realTarget, dev: identity.dev, ino: identity.ino };
}

export function assertPilotOutputIdentity(identity) {
  const current = statSync(identity.path);
  if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino
    || realpathSync(identity.path) !== identity.path) {
    throw codedError('PILOT_OUTPUT_CHANGED', identity.path);
  }
  return true;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM' ? null : error?.code === 'ESRCH' ? false : null; }
}

function readLockOwner(lockPath) {
  if (!lstatSync(lockPath).isDirectory() || readdirSync(lockPath).join('|') !== LOCK_OWNER) {
    throw codedError('PILOT_LOCK_INVALID', `${lockPath}; quarantine manually after confirming no active harness`);
  }
  const ownerPath = join(lockPath, LOCK_OWNER);
  const before = lstatSync(ownerPath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_LOCK_OWNER_BYTES) {
    throw codedError('PILOT_LOCK_INVALID', `${ownerPath}; owner must be a bounded regular file`);
  }
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const fd = openSync(ownerPath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw codedError('PILOT_LOCK_INVALID', 'lock owner identity changed');
    }
    const buffer = Buffer.alloc(opened.size);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes !== opened.size) throw codedError('PILOT_LOCK_INVALID', 'lock owner short read');
    let owner;
    try { owner = JSON.parse(buffer.toString('utf8')); } catch { owner = null; }
    if (!exactJson(owner, ['schema', 'pid', 'token', 'createdAt']) || owner.schema !== 1
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.token || '')
      || !canonicalIso(owner.createdAt)) {
      throw codedError('PILOT_LOCK_INVALID', 'malformed lock owner');
    }
    return { owner, identity: { dev: opened.dev, ino: opened.ino, size: opened.size } };
  } finally { closeSync(fd); }
}

function quarantineLock(lockPath, expectedToken) {
  const quarantine = `${lockPath}.quarantine-${randomUUID()}`;
  renameSync(lockPath, quarantine);
  try {
    const current = readLockOwner(quarantine);
    if (current.owner.token !== expectedToken) throw codedError('PILOT_LOCK_INVALID', 'lock token changed during quarantine');
    unlinkSync(join(quarantine, LOCK_OWNER));
    rmdirSync(quarantine);
  } catch (error) {
    if (existsSync(quarantine) && !existsSync(lockPath)) renameSync(quarantine, lockPath);
    throw error;
  }
}

/** Acquire the single local-host output authority. */
export function acquirePilotOutputLock(outputRoot) {
  const lockPath = join(outputRoot, LOCK_DIR);
  const token = randomUUID();
  const claim = () => {
    mkdirSync(lockPath, { mode: 0o700 });
    const owner = { schema: 1, pid: process.pid, token, createdAt: new Date().toISOString() };
    const ownerPath = join(lockPath, LOCK_OWNER);
    const fd = openSync(ownerPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try {
      const data = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8');
      writeSync(fd, data, 0, data.length);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    return owner;
  };
  let owner;
  try { owner = claim(); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readLockOwner(lockPath);
    const alive = processAlive(existing.owner.pid);
    if (alive === true) throw codedError('PILOT_LOCKED', `${lockPath} pid=${existing.owner.pid}`);
    if (alive === null) throw codedError('PILOT_LOCK_INVALID', 'lock owner liveness is unknown');
    quarantineLock(lockPath, existing.owner.token);
    owner = claim();
  }
  let released = false;
  return {
    owner,
    outputRoot,
    release() {
      if (released) return;
      const current = readLockOwner(lockPath);
      if (current.owner.token !== token || current.owner.pid !== process.pid) {
        throw codedError('PILOT_LOCK_INVALID', 'refusing to release a foreign lock');
      }
      quarantineLock(lockPath, token);
      released = true;
    },
  };
}

function assertPilotLockAuthority(authority, outputRoot) {
  if (!authority || authority.outputRoot !== outputRoot) {
    throw codedError('PILOT_LOCK_REQUIRED', 'captured operation requires its output lock authority');
  }
  const current = readLockOwner(join(outputRoot, LOCK_DIR));
  if (current.owner.pid !== process.pid || current.owner.token !== authority.owner?.token) {
    throw codedError('PILOT_LOCK_INVALID', 'captured operation lock authority mismatch');
  }
  return true;
}

/** Load the frozen fixture from the captured commit object, never the live file. */
export function loadCapturedPilotFixture({ repoRoot = ROOT, revision, fixturePath = DEFAULT_FIXTURE }) {
  const repo = realpathSync(resolve(repoRoot));
  const lexicalRepo = resolve(repoRoot);
  const absolute = resolve(fixturePath);
  let rel = within(lexicalRepo, absolute) ? relative(lexicalRepo, absolute) : null;
  if (rel === null && existsSync(absolute)) {
    const canonical = realpathSync(absolute);
    if (within(repo, canonical)) rel = relative(repo, canonical);
  }
  if (rel === null || rel === '') {
    throw codedError('PILOT_FIXTURE_UNTRUSTED', 'fixture must be tracked by the repository');
  }
  rel = rel.split(sep).join('/');
  const shown = spawnSync('git', ['show', `${revision}:${rel}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (shown.status !== 0) throw codedError('PILOT_FIXTURE_UNTRUSTED', shown.stderr || shown.stdout || rel);
  let parsed;
  try { parsed = JSON.parse(shown.stdout); } catch { throw codedError('PILOT_FIXTURE_UNTRUSTED', 'captured fixture is not JSON'); }
  return validatePilotFixture(parsed);
}

/** Publish a complete multi-file result generation and its authoritative pointer. */
export function publishPilotGeneration({ outputIdentity, lockAuthority, revision,
  generation = randomUUID(), runtime, results, report, runSummary }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(generation)
    || !/^[0-9a-f]{40}$/.test(revision || '') || typeof runSummary !== 'string'
    || !outputIdentity?.path) {
    throw new TypeError('invalid pilot generation');
  }
  const outputRoot = outputIdentity.path;
  assertPilotOutputIdentity(outputIdentity);
  assertPilotLockAuthority(lockAuthority, outputRoot);
  const generationRoot = join(outputRoot, 'generations', generation);
  const generationsRoot = ensureRealDirectory(join(outputRoot, 'generations'));
  syncDirectory(outputRoot);
  mkdirSync(generationRoot, { recursive: false, mode: 0o700 });
  syncDirectory(generationsRoot);
  const files = {
    'runtime.json': `${JSON.stringify(runtime, null, 2)}\n`,
    'results.json': `${JSON.stringify(results, null, 2)}\n`,
    'report.json': `${JSON.stringify(report, null, 2)}\n`,
    'RUN.md': runSummary,
  };
  const hashes = {};
  for (const [name, content] of Object.entries(files)) {
    assertPilotOutputIdentity(outputIdentity);
    atomicWritePilotFile(join(generationRoot, name), content);
    hashes[name] = sha256(content);
  }
  const manifest = { schema: 1, generation, revision, files: hashes };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  assertPilotOutputIdentity(outputIdentity);
  atomicWritePilotFile(join(generationRoot, 'manifest.json'), manifestText);
  const manifestHash = sha256(manifestText);
  assertPilotOutputIdentity(outputIdentity);
  assertPilotLockAuthority(lockAuthority, outputRoot);
  atomicWritePilotJson(join(outputRoot, 'current.json'), { schema: 1, generation, revision, manifestHash });
  return { generation, manifest, manifestHash };
}

export function capturePilotRevision(repoRoot = ROOT) {
  const repo = realpathSync(resolve(repoRoot));
  const revisionRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const revision = revisionRun.stdout.trim();
  if (revisionRun.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw codedError('PILOT_REVISION_UNAVAILABLE', revisionRun.stderr || 'cannot resolve HEAD');
  }
  const statusRun = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (statusRun.status !== 0 || statusRun.stdout.trim() !== '') {
    throw codedError('PILOT_REPOSITORY_DIRTY', 'tracked worktree changes are forbidden');
  }
  return revision;
}

export function assertPilotRevision(repoRoot, revision) {
  const repo = realpathSync(resolve(repoRoot));
  const current = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo, encoding: 'utf8',
  });
  if (current.status !== 0 || current.stdout.trim() !== revision) {
    throw codedError('PILOT_REVISION_CHANGED', revision);
  }
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (status.status !== 0 || status.stdout.trim() !== '') {
    throw codedError('PILOT_REPOSITORY_DIRTY', 'tracked worktree changes are forbidden');
  }
  return true;
}

function nextIso(history, now = () => Date.now()) {
  const previous = history.events.at(-1)?.at;
  const floor = previous ? Date.parse(previous) + 1 : 0;
  return new Date(Math.max(now(), floor)).toISOString();
}

function readPilotHistory(path, budget) {
  if (!existsSync(path)) return { schema: 2, budget, events: [] };
  return readBoundedJsonNoFollow(path, 1024 * 1024, 'PILOT_HISTORY_INVALID');
}

/** Run one captured smoke attempt or an admitted balanced generation. */
export async function runCapturedPilotOperation({
  mode, repoRoot = ROOT, fixture, revision, outputIdentity, concurrency = 1,
  lockAuthority, actor, scorer, runPilotImpl = runPilot, now = () => Date.now(), attemptIdFactory = randomUUID,
  temporaryRootFactory = () => mkdtempSync(join(tmpdir(), 'qe-harness-pilot-')),
}) {
  if (!['smoke', 'execute'].includes(mode) || !fixture || !/^[0-9a-f]{40}$/.test(revision || '')
    || !outputIdentity || typeof actor !== 'function' || typeof scorer !== 'function') {
    throw new TypeError('invalid captured pilot operation');
  }
  assertPilotOutputIdentity(outputIdentity);
  assertPilotLockAuthority(lockAuthority, outputIdentity.path);
  assertPilotRevision(repoRoot, revision);
  const budget = createPilotRuntimeBudget(fixture.budget);
  const first = buildPilotSchedule(fixture)[0];
  const cell = createPilotCell({ ...first, model: fixture.model, effort: fixture.effort }, budget);
  if (cell.condition !== 'full-sivs-durable') {
    throw codedError('PILOT_SMOKE_CELL_INVALID', 'first preregistered cell must be full-sivs-durable');
  }
  const historyPath = join(outputIdentity.path, 'smoke-history.json');
  const history = readPilotHistory(historyPath, budget);
  const runRoot = temporaryRootFactory();
  try {
    if (mode === 'execute') {
      const admission = deriveSmokeAdmission(history, { revision, cell, expectedBudget: budget });
      if (!admission.admitted) {
        throw codedError('PILOT_SMOKE_NOT_ADMITTED', 'two adjacent successful captured smoke attempts are required');
      }
      const guardedActor = async request => {
        assertPilotOutputIdentity(outputIdentity);
        assertPilotRevision(repoRoot, revision);
        const result = await actor(request);
        assertPilotOutputIdentity(outputIdentity);
        assertPilotRevision(repoRoot, revision);
        return result;
      };
      const output = await runPilotImpl(fixture, {
        root: runRoot, revision, concurrency, baselineRepository: repoRoot,
        actor: guardedActor, scorer,
      });
      assertPilotOutputIdentity(outputIdentity);
      assertPilotRevision(repoRoot, revision);
      const runtime = { schema: 1, mode, revision, budget,
        smokeAttemptIds: admission.selectedAttemptIds };
      const published = publishPilotGeneration({
        outputIdentity,
        lockAuthority,
        revision,
        runtime,
        results: { ...output.dataset, rawRuns: output.rawRuns },
        report: output.report,
        runSummary: markdownSummary(output),
      });
      return { output, published, admission };
    }

    const attempts = projectPilotAttempts(history, { cell, expectedBudget: budget });
    const sequence = attempts.length + 1;
    const id = attemptIdFactory();
    const context = createPilotAttemptContext({
      sequence, attemptId: id, revision, cell,
      workspaceId: `workspace-${id}`, controllerProcessId: `pilot-${id}`,
    });
    const started = { kind: 'started', sequence, attemptId: id, revision, cell,
      cellIdentity: context.cellIdentity, workspaceId: context.workspaceId,
      controllerProcessId: context.controllerProcessId, contextDigest: context.contextDigest,
      at: nextIso(history, now) };
    let nextHistory = appendPilotAttemptEvent(history, started);
    atomicWritePilotJson(historyPath, nextHistory);
    const guardedActor = async request => {
      assertPilotOutputIdentity(outputIdentity);
      assertPilotRevision(repoRoot, revision);
      const result = await actor({ ...request, controllerProcessId: context.controllerProcessId });
      assertPilotOutputIdentity(outputIdentity);
      assertPilotRevision(repoRoot, revision);
      return result;
    };
    const output = await runPilotImpl(fixture, {
      root: runRoot, revision, concurrency: 1, baselineRepository: repoRoot, cellLimit: 1,
      actor: guardedActor, scorer,
    });
    assertPilotOutputIdentity(outputIdentity);
    assertPilotRevision(repoRoot, revision);
    const terminalRun = createPilotTerminalRun(output.rawRuns[0], context);
    const terminal = { kind: 'terminal', sequence, attemptId: id,
      contextDigest: context.contextDigest, run: terminalRun, at: nextIso(nextHistory, now) };
    nextHistory = appendPilotAttemptEvent(nextHistory, terminal);
    atomicWritePilotJson(historyPath, nextHistory);
    const attemptsAfter = projectPilotAttempts(nextHistory, { cell, expectedBudget: budget });
    const latest = attemptsAfter.at(-1);
    atomicWritePilotJson(join(outputIdentity.path, 'smoke.json'), {
      schema: 1, status: latest.verdict.success ? 'passed' : 'failed', revision,
      attemptId: id, verdict: latest.verdict, run: terminalRun,
    });
    return { output, attempt: latest };
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, execute: false, smoke: false, fixture: DEFAULT_FIXTURE,
    outputDir: null, concurrency: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--execute') out.execute = true;
    else if (arg === '--smoke') out.smoke = true;
    else if (arg === '--fixture') out.fixture = resolve(argv[++index] || '');
    else if (arg === '--output-dir') out.outputDir = argv[++index] || '';
    else if (arg === '--concurrency') out.concurrency = Number(argv[++index]);
    else throw new TypeError(`unknown argument: ${arg}`);
  }
  if (Number(out.dryRun) + Number(out.execute) + Number(out.smoke) !== 1) {
    throw new TypeError('choose exactly one of --dry-run, --smoke, or --execute');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 4) {
    throw new TypeError('--concurrency must be an integer from 1 to 4');
  }
  return out;
}

function initializeGit(workspace) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const commands = [
    ['init', '-q'],
    ['config', 'user.name', 'QE Harness'],
    ['config', 'user.email', 'qe-harness@example.invalid'],
    ['add', '.'],
    ['commit', '-q', '-m', 'starter'],
  ];
  for (const args of commands) {
    const run = spawnSync('git', args, { cwd: workspace, env, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.stderr || run.stdout}`);
  }
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).stdout.trim();
}

function createCodexActor() {
  return async request => {
    const starterRevision = initializeGit(request.workspace);
    const startedAt = Date.now();
    const durable = request.condition.endsWith('-durable');
    const processId = request.controllerProcessId || `pilot-${request.taskId}-${request.condition}`;
    let controller = null;
    let controllerEvidence = null;
    if (durable) {
      const admitted = createEligibleProcessController({
        cwd: request.workspace,
        layer: 'goal',
        authority: 'goal-controller',
        executionMode: 'durable',
        longRunning: false,
        highRisk: false,
      });
      controller = admitted.controller;
      const initialized = controller?.initialize({ processId, requestId: `${processId}-initialize` });
      const active = controller?.transition({ processId, requestId: `${processId}-active`,
        to: 'active', expectedRevision: 0 });
      controllerEvidence = {
        admitted: admitted.admitted === true,
        admissionCode: admitted.code,
        initializeCode: initialized?.code || null,
        activeCode: active?.code || null,
        terminalCode: null,
        processId,
        auditDigest: null,
      };
    }
    const args = buildCodexArgs(request);
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let signal = null;
    const run = await runBoundedProcess('codex', args, {
      cwd: request.workspace,
      timeoutMs: request.budget.maxWallSeconds * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = run.stdout;
    stderr = run.stderr;
    exitCode = run.exitCode;
    timedOut = run.timedOut;
    signal = run.signal;
    const bufferExceeded = run.bufferExceeded;
    const wallSeconds = (Date.now() - startedAt) / 1000;
    const parsed = parseCodexResult(stdout, { wallSeconds, exitCode });
    if (!parsed.result && stderr) parsed.result = stderr.slice(0, 8000);
    if (controller) {
      const terminal = controller.transition({ processId, requestId: `${processId}-blocked`,
        to: 'blocked', expectedRevision: 1 });
      controllerEvidence.terminalCode = terminal.code;
      controllerEvidence.auditDigest = createHash('sha256')
        .update(JSON.stringify(controller.audit(processId))).digest('hex');
      controller.close();
      parsed.wallSeconds = (Date.now() - startedAt) / 1000;
    }
    const diff = spawnSync('git', ['diff', '--binary', '--no-ext-diff'], {
      cwd: request.workspace,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }).stdout || '';
    return {
      ...parsed,
      exitCode,
      timedOut,
      signal,
      bufferExceeded,
      controller: controllerEvidence,
      starterRevision,
      patchHash: createHash('sha256').update(diff).digest('hex'),
      patch: diff,
    };
  };
}

function markdownSummary(output) {
  const lines = [
    '# Progressive Assurance Harness Pilot',
    '',
    `- Model: ${output.rawRuns[0]?.model || 'unknown'}`,
    `- Revision: ${output.rawRuns[0]?.revision || 'unknown'}`,
    `- Balanced task/repetition pairs: ${output.report.balancedPairs}`,
    `- Runs: ${output.dataset.runs.length}`,
    '',
    '| Condition | Success | Input tokens | Output tokens | Wall seconds |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const [condition, result] of Object.entries(output.report.conditions)) {
    const means = result.means;
    lines.push(`| ${condition} | ${means.success.toFixed(3)} | ${means.inputTokens.toFixed(1)} | ${means.outputTokens.toFixed(1)} | ${means.wallSeconds.toFixed(1)} |`);
  }
  lines.push('', '> Pilot only: one repetition cannot establish production effectiveness.', '');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) {
    const fixture = loadPilotFixture(options.fixture);
    const schedule = buildPilotSchedule(fixture);
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', model: fixture.model,
      effort: fixture.effort, budget: fixture.budget, schedule }, null, 2)}\n`);
    return;
  }
  const outputIdentity = preparePilotOutputRoot({ repoRoot: ROOT, outputDir: options.outputDir });
  const lock = acquirePilotOutputLock(outputIdentity.path);
  try {
    const revision = capturePilotRevision(ROOT);
    const fixture = loadCapturedPilotFixture({ repoRoot: ROOT, revision, fixturePath: options.fixture });
    try {
      const result = await runCapturedPilotOperation({
        mode: options.smoke ? 'smoke' : 'execute',
        repoRoot: ROOT,
        fixture,
        revision,
        outputIdentity,
        lockAuthority: lock,
        concurrency: options.concurrency,
        actor: createCodexActor(),
        scorer: request => scoreHiddenAcceptance(request),
      });
      if (options.smoke) {
        process.stdout.write(`${JSON.stringify({ mode: 'smoke', outputDir: outputIdentity.path,
          attemptId: result.attempt.attemptId, admitted: result.attempt.verdict.success })}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ mode: 'execute', outputDir: outputIdentity.path,
          generation: result.published.generation, runs: result.output.dataset.runs.length,
          balancedPairs: result.output.report.balancedPairs })}\n`);
      }
    } catch (error) {
      if (error?.code === 'PILOT_INVALID_ACTOR_RUN') {
        atomicWritePilotJson(join(outputIdentity.path, 'failure.json'), {
          schema: 1,
          status: 'invalid',
          reason: error.code,
          budget: fixture.budget,
          ...error.details,
        });
      }
      throw error;
    }
  } finally {
    lock.release();
  }
}

const IS_DIRECT_EXECUTION = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_DIRECT_EXECUTION) {
  main().catch(error => {
    process.stderr.write(`run-harness-pilot: ${error.message}\n`);
    process.exitCode = 2;
  });
}
