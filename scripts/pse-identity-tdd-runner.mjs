import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync as readNative } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileBoundedSync } from '../hooks/scripts/lib/qe-fs.mjs';
import { recordEvent } from '../hooks/scripts/lib/ledger.mjs';

export const EXPECTED_IDENTITY_TEST_SHA256 = 'e29d6fd04118c04619e8b73a7a28ca4957f7af453a8ba9b192cd7a818a1a6b93';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAN_SLUG = readFileBoundedSync(resolve(ROOT, '.qe/planning/ACTIVE_PLAN'), 256, 'utf8').trim();
const TEST_PATH = 'hooks/scripts/lib/__tests__/lifecycle-pse-artifact-identity.test.mjs';
const EVIDENCE_TEST_PATH = 'hooks/scripts/lib/__tests__/lifecycle-pse-identity-evidence.test.mjs';
const MODULE_PATH = 'hooks/scripts/lib/pse-artifact-identity.mjs';
const PREFIX = 'pse-identity-tdd-v1:';
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_KEYS = ['schema', 'phase', 'sessionId', 'command', 'testPath', 'testSha256', 'runnerSha256',
  'moduleAbsent', 'exitStatus', 'signal', 'stdoutBase64', 'stdoutBytes', 'stdoutSha256',
  'stderrBase64', 'stderrBytes', 'stderrSha256', 'recordedAt'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function decodeHeader(event) {
  try {
    if (typeof event?.evidence !== 'string' || !event.evidence.startsWith(PREFIX)) return null;
    if (event.event !== 'measurement' || event.goalId !== 'G001') return { conflict: true };
    const encoded = event.evidence.slice(PREFIX.length);
    const raw = Buffer.from(encoded, 'base64');
    if (raw.toString('base64') !== encoded) return { conflict: true };
    const record = JSON.parse(raw);
    if (Object.keys(record).join('|') !== RECORD_KEYS.join('|') || raw.toString() !== `${JSON.stringify(record, null, 2)}\n`
      || record?.schema !== 1 || !['red', 'green'].includes(record.phase)
      || !SESSION_RE.test(record.sessionId) || record.command !== `node --test ${TEST_PATH}`
      || record.testPath !== TEST_PATH || !/^[0-9a-f]{64}$/.test(record.testSha256)
      || !/^[0-9a-f]{64}$/.test(record.runnerSha256) || record.moduleAbsent !== (record.phase === 'red')
      || record.exitStatus !== (record.phase === 'red' ? 1 : 0) || record.signal !== null
      || event.status !== 'active' || event.attempt !== 1 || event.ts !== record.recordedAt
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.recordedAt)
      || !Number.isFinite(Date.parse(record.recordedAt))
      || new Date(record.recordedAt).toISOString() !== record.recordedAt) return { conflict: true };
    for (const stream of ['stdout', 'stderr']) {
      const encoded = record[`${stream}Base64`];
      if (typeof encoded !== 'string') return { conflict: true };
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded || bytes.length !== record[`${stream}Bytes`]
        || sha(bytes) !== record[`${stream}Sha256`]) return { conflict: true };
    }
    if (record.phase === 'red' && !Buffer.concat([Buffer.from(record.stdoutBase64, 'base64'),
      Buffer.from(record.stderrBase64, 'base64')]).includes(Buffer.from('ABSENT_EXPORT'))) return { conflict: true };
    return { phase: record.phase, testSha256: record.testSha256, runnerSha256: record.runnerSha256 };
  } catch { return { conflict: true }; }
}

export function classifyTddMeasurements(events, testSha256, runnerSha256 = null) {
  let red = null; let green = null;
  for (const event of events) {
    const header = decodeHeader(event);
    if (!header) continue;
    if (header.conflict || header.testSha256 !== testSha256
      || (runnerSha256 && header.runnerSha256 !== runnerSha256)) return { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' };
    if (header.phase === 'red') {
      if (red || green) return { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' };
      red = event;
    } else {
      if (!red || green) return { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' };
      green = event;
    }
  }
  if (red && green && !(Date.parse(red.ts) < Date.parse(green.ts))) {
    return { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' };
  }
  return { ok: true, red, green };
}

function productionAdapters() {
  const ledgerPath = resolve(ROOT, `.qe/planning/plans/${PLAN_SLUG}/ledger.jsonl`);
  return {
    readIdentityTest: () => readNative(resolve(ROOT, TEST_PATH)),
    readEvidenceTest: () => readNative(resolve(ROOT, EVIDENCE_TEST_PATH)),
    readRunner: () => readNative(fileURLToPath(import.meta.url)),
    activePlan: () => readFileBoundedSync(resolve(ROOT, '.qe/planning/ACTIVE_PLAN'), 256, 'utf8').trim(),
    acceptanceValid: () => {
      const goals = JSON.parse(readFileBoundedSync(resolve(ROOT, `.qe/planning/plans/${PLAN_SLUG}/goals.json`), 1_048_576, 'utf8'));
      const contract = JSON.parse(readFileBoundedSync(resolve(ROOT, `.qe/planning/plans/${PLAN_SLUG}/evidence/G001.acceptance.json`), 1_048_576, 'utf8'));
      const binding = goals.goals.find(goal => goal.id === 'G001')?.acceptance?.hash;
      return binding === sha(Buffer.from(JSON.stringify(contract)))
        && contract.requirements?.[2]?.criterion?.includes(EXPECTED_IDENTITY_TEST_SHA256)
        && contract.requirements?.[2]?.criterion?.includes(sha(readNative(resolve(ROOT, EVIDENCE_TEST_PATH))))
        && contract.requirements?.[2]?.criterion?.includes(sha(readNative(fileURLToPath(import.meta.url))))
        && contract.goalShape?.allowedPaths?.includes('scripts/pse-identity-tdd-runner.mjs');
    },
    readEvents: () => readFileBoundedSync(ledgerPath, 1_048_576, 'utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse),
    moduleExists: () => existsSync(resolve(ROOT, MODULE_PATH)),
    currentSessionId: () => JSON.parse(readFileBoundedSync(resolve(ROOT, '.qe/state/current-session.json'), 4096, 'utf8')).session_id,
    now: () => new Date().toISOString(),
    spawn: () => spawnSync(process.execPath, ['--test', TEST_PATH], { cwd: ROOT, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] }),
    append: event => recordEvent(ROOT, PLAN_SLUG, event),
  };
}

function lockedHashes(adapters) {
  const identity = Buffer.from(adapters.readIdentityTest());
  const evidence = Buffer.from(adapters.readEvidenceTest());
  if (sha(identity) !== EXPECTED_IDENTITY_TEST_SHA256) return null;
  if (!adapters.readRunner) return { identity: sha(identity), evidence: sha(evidence), runner: null };
  return { identity: sha(identity), evidence: sha(evidence), runner: sha(Buffer.from(adapters.readRunner())) };
}

export function executeTddAction(action, adapters = productionAdapters()) {
  if (!['record-red', 'record-green', 'validate'].includes(action)) return { ok: false, code: 'INVALID_ACTION' };
  const hashes = lockedHashes(adapters);
  if (!hashes) return { ok: false, code: 'LOCKED_TEST_MISMATCH' };
  if (adapters.activePlan && adapters.activePlan() !== PLAN_SLUG) return { ok: false, code: 'ACTIVE_PLAN_MISMATCH' };
  if (adapters.acceptanceValid && !adapters.acceptanceValid()) return { ok: false, code: 'ACCEPTANCE_BINDING_INVALID' };
  const initial = classifyTddMeasurements(adapters.readEvents(), hashes.identity, hashes.runner);
  if (!initial.ok) return initial;
  if (action === 'validate') {
    if (!initial.red || !initial.green || !adapters.moduleExists()) return { ok: false, code: 'TDD_MEASUREMENT_INCOMPLETE' };
    return { ok: true, code: 'VALID', line: `TDD_EVIDENCE_VALID red=${sha(Buffer.from(initial.red.evidence))} green=${sha(Buffer.from(initial.green.evidence))} test=${hashes.identity}` };
  }
  const phase = action === 'record-red' ? 'red' : 'green';
  if (phase === 'red' && initial.red) return initial.green
    ? { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' } : { ok: true, code: 'REPLAYED', phase };
  if (phase === 'green' && initial.green) return { ok: true, code: 'REPLAYED', phase };
  const absent = !adapters.moduleExists();
  if ((phase === 'red' && !absent) || (phase === 'green' && (absent || !initial.red))) {
    return { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' };
  }
  const sessionId = adapters.currentSessionId();
  if (!SESSION_RE.test(sessionId)) return { ok: false, code: 'SESSION_INVALID' };
  const result = adapters.spawn();
  const stdout = Buffer.from(result.stdout || ''); const stderr = Buffer.from(result.stderr || '');
  const expectedStatus = phase === 'red' ? 1 : 0;
  if (result.status !== expectedStatus || result.signal !== null
    || (phase === 'red' && !Buffer.concat([stdout, stderr]).includes(Buffer.from('ABSENT_EXPORT')))) {
    return { ok: false, code: 'TDD_COMMAND_UNEXPECTED' };
  }
  const ts = adapters.now();
  const record = {
    schema: 1, phase, sessionId, command: `node --test ${TEST_PATH}`, testPath: TEST_PATH,
    testSha256: hashes.identity, runnerSha256: hashes.runner, moduleAbsent: absent,
    exitStatus: result.status, signal: result.signal,
    stdoutBase64: stdout.toString('base64'), stdoutBytes: stdout.length, stdoutSha256: sha(stdout),
    stderrBase64: stderr.toString('base64'), stderrBytes: stderr.length, stderrSha256: sha(stderr), recordedAt: ts,
  };
  const event = { ts, event: 'measurement', goalId: 'G001', status: 'active', evidence: `${PREFIX}${canonical(record).toString('base64')}`, attempt: 1 };
  try { adapters.append(event); }
  catch {
    const after = classifyTddMeasurements(adapters.readEvents(), hashes.identity, hashes.runner);
    if (!after.ok) return after;
    const recovered = phase === 'red' ? after.red : after.green;
    if (recovered && JSON.stringify(recovered) === JSON.stringify(event)
      && ((phase === 'red' && !after.green) || (phase === 'green' && after.red))) {
      return { ok: true, code: 'RECOVERED', phase };
    }
    return { ok: false, code: 'TDD_APPEND_UNCERTAIN' };
  }
  return { ok: true, code: 'RECORDED', phase };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.length === 3 ? executeTddAction(process.argv[2]) : { ok: false, code: 'INVALID_ACTION' };
  if (result.ok && result.line) process.stdout.write(`${result.line}\n`);
  else process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
