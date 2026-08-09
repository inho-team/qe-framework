import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync as readNative } from 'node:fs';
import { resolve } from 'node:path';
import { readFileBoundedSync } from '../qe-fs.mjs';
import { EXPECTED_IDENTITY_TEST_SHA256, PLAN_SLUG, classifyTddMeasurements,
  executeTddAction } from '../../../../scripts/pse-identity-tdd-runner.mjs';

const ROOT = resolve(import.meta.dirname, '../../../..');
const TEST_PATH = 'hooks/scripts/lib/__tests__/lifecycle-pse-artifact-identity.test.mjs';
const MODULE_PATH = 'hooks/scripts/lib/pse-artifact-identity.mjs';
const PREFIX = 'pse-identity-tdd-v1:';
const RUNNER_SHA256 = 'f674dcf228054e7af8131ad7eec1474e36be74576e699624975b2ea71ef958da';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value && !Array.isArray(value)
  && Object.keys(value).join('|') === keys.join('|');
const canonicalBase64 = value => typeof value === 'string'
  && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

function parseMeasurement(event, phase) {
  assert.equal(event.event, 'measurement');
  assert.equal(event.goalId, 'G001');
  assert.equal(event.status, 'active');
  assert.equal(event.attempt, 1);
  assert.ok(event.evidence.startsWith(PREFIX));
  const raw = Buffer.from(event.evidence.slice(PREFIX.length), 'base64');
  assert.equal(raw.toString('base64'), event.evidence.slice(PREFIX.length));
  const record = JSON.parse(raw);
  const topKeys = ['schema', 'phase', 'sessionId', 'command', 'testPath', 'testSha256', 'runnerSha256', 'moduleAbsent', 'exitStatus',
    'signal', 'stdoutBase64', 'stdoutBytes', 'stdoutSha256', 'stderrBase64', 'stderrBytes', 'stderrSha256', 'recordedAt'];
  assert.ok(exactKeys(record, topKeys));
  assert.equal(raw.toString(), `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(record.schema, 1);
  assert.equal(record.phase, phase);
  assert.match(record.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(record.command, `node --test ${TEST_PATH}`);
  assert.equal(record.testPath, TEST_PATH);
  assert.match(record.testSha256, /^[0-9a-f]{64}$/);
  assert.equal(record.runnerSha256, RUNNER_SHA256);
  assert.equal(record.moduleAbsent, phase === 'red');
  assert.equal(record.exitStatus, phase === 'red' ? 1 : 0);
  assert.equal(record.signal, null);
  assert.equal(record.recordedAt, event.ts);
  assert.match(record.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  for (const stream of ['stdout', 'stderr']) {
    const base64 = record[`${stream}Base64`];
    assert.ok(canonicalBase64(base64));
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.length, record[`${stream}Bytes`]);
    assert.equal(sha(bytes), record[`${stream}Sha256`]);
  }
  if (phase === 'red') {
    const output = Buffer.concat([Buffer.from(record.stdoutBase64, 'base64'), Buffer.from(record.stderrBase64, 'base64')]);
    assert.ok(output.includes(Buffer.from('ABSENT_EXPORT')));
  }
  return record;
}

test('authenticates append-only RED then GREEN measurements with identical locked test bytes', () => {
  assert.equal(readFileBoundedSync('.qe/planning/ACTIVE_PLAN', 256, 'utf8').trim(), PLAN_SLUG);
  const ledger = readFileBoundedSync(`.qe/planning/plans/${PLAN_SLUG}/ledger.jsonl`, 1_048_576, 'utf8');
  assert.ok(!ledger.includes('\r') && !ledger.includes('\n\n'));
  const events = ledger.trimEnd().split('\n').map(JSON.parse);
  const measurements = events.filter(event => typeof event.evidence === 'string' && event.evidence.startsWith(PREFIX));
  assert.equal(measurements.length, 2);
  const red = parseMeasurement(measurements[0], 'red');
  const green = parseMeasurement(measurements[1], 'green');
  assert.equal(red.testSha256, green.testSha256);
  assert.equal(red.testSha256, EXPECTED_IDENTITY_TEST_SHA256);
  assert.equal(red.testSha256, sha(readNative(resolve(ROOT, TEST_PATH))));
  assert.equal(sha(readNative(resolve(ROOT, 'scripts/pse-identity-tdd-runner.mjs'))), RUNNER_SHA256);
  assert.deepEqual(classifyTddMeasurements(events, red.testSha256, RUNNER_SHA256), { ok: true, red: measurements[0], green: measurements[1] });
  assert.ok(Date.parse(red.recordedAt) < Date.parse(green.recordedAt));
  assert.ok(readNative(resolve(ROOT, MODULE_PATH)).length > 0);
  process.stdout.write(`TDD_EVIDENCE_VALID red=${sha(Buffer.from(measurements[0].evidence))} green=${sha(Buffer.from(measurements[1].evidence))} test=${red.testSha256}\n`);
});

test('runner classification is create-once, idempotent, and conflict-failing', () => {
  const mk = (phase, testSha = EXPECTED_IDENTITY_TEST_SHA256, mutate = value => value) => {
    const ts = phase === 'red' ? '2026-08-07T00:00:00.000Z' : '2026-08-07T00:00:01.000Z';
    const stdout = Buffer.from(phase === 'red' ? 'ABSENT_EXPORT\n' : 'PASS\n'); const stderr = Buffer.alloc(0);
    const value = mutate({ schema: 1, phase, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      command: `node --test ${TEST_PATH}`, testPath: TEST_PATH, testSha256: testSha, runnerSha256: RUNNER_SHA256,
      moduleAbsent: phase === 'red', exitStatus: phase === 'red' ? 1 : 0, signal: null,
      stdoutBase64: stdout.toString('base64'), stdoutBytes: stdout.length, stdoutSha256: sha(stdout),
      stderrBase64: '', stderrBytes: 0, stderrSha256: sha(stderr), recordedAt: ts });
    return { ts, event: 'measurement', goalId: 'G001', status: 'active', attempt: 1,
      evidence: `${PREFIX}${Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64')}` };
  };
  const red = mk('red'); const green = mk('green');
  assert.deepEqual(classifyTddMeasurements([], EXPECTED_IDENTITY_TEST_SHA256, RUNNER_SHA256), { ok: true, red: null, green: null });
  assert.deepEqual(classifyTddMeasurements([red], EXPECTED_IDENTITY_TEST_SHA256, RUNNER_SHA256), { ok: true, red, green: null });
  assert.deepEqual(classifyTddMeasurements([red, green], EXPECTED_IDENTITY_TEST_SHA256, RUNNER_SHA256), { ok: true, red, green });
  for (const events of [[green], [red, red], [red, green, green], [mk('red', '0'.repeat(64))],
    [mk('red', EXPECTED_IDENTITY_TEST_SHA256, value => { delete value.sessionId; return value; })],
    [{ ...red, event: 'checkpoint' }], [{ ...red, goalId: 'G002' }],
    [mk('red', EXPECTED_IDENTITY_TEST_SHA256, value => { value.recordedAt = '2026-99-99T99:99:99.999Z'; return value; })]]) {
    assert.deepEqual(classifyTddMeasurements(events, EXPECTED_IDENTITY_TEST_SHA256, RUNNER_SHA256), { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' });
  }
});

test('trusted runner observes state, executes fixed command once, appends once, and recovers ambiguity', () => {
  assert.equal(EXPECTED_IDENTITY_TEST_SHA256, sha(readNative(resolve(ROOT, TEST_PATH))));
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const makeAdapters = ({ events = [], moduleExists = false, status = 1, appendMode = 'ok' } = {}) => {
    let spawns = 0; let appends = 0; let reads = 0; const backend = structuredClone(events);
    return {
      adapters: {
        readIdentityTest: () => readNative(resolve(ROOT, TEST_PATH)),
        readEvidenceTest: () => readNative(new URL(import.meta.url)),
        readRunner: () => readNative(resolve(ROOT, 'scripts/pse-identity-tdd-runner.mjs')),
        activePlan: () => PLAN_SLUG,
        acceptanceValid: () => true,
        readEvents: () => { reads += 1; return structuredClone(backend); },
        moduleExists: () => moduleExists,
        currentSessionId: () => sessionId,
        now: () => moduleExists ? '2026-08-07T00:00:01.000Z' : '2026-08-07T00:00:00.000Z',
        spawn: () => { spawns += 1; return { status, signal: null,
          stdout: Buffer.from(status ? 'ABSENT_EXPORT\n' : 'PASS\n'), stderr: Buffer.alloc(0) }; },
        append: event => {
          appends += 1;
          if (appendMode === 'different') {
            const changed = structuredClone(event); const raw = JSON.parse(Buffer.from(changed.evidence.slice(PREFIX.length), 'base64'));
            raw.sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
            changed.evidence = `${PREFIX}${Buffer.from(`${JSON.stringify(raw, null, 2)}\n`).toString('base64')}`; backend.push(changed);
          } else if (appendMode === 'duplicate') backend.push(structuredClone(event), structuredClone(event));
          else if (appendMode !== 'drop') backend.push(event);
          if (appendMode !== 'ok') throw new Error('ambiguous');
        },
      },
      counts: () => ({ spawns, appends, reads }), events: backend,
    };
  };

  const red = makeAdapters();
  assert.deepEqual(executeTddAction('record-red', red.adapters), { ok: true, code: 'RECORDED', phase: 'red' });
  assert.deepEqual(red.counts(), { spawns: 1, appends: 1, reads: 1 });
  assert.deepEqual(executeTddAction('record-red', red.adapters), { ok: true, code: 'REPLAYED', phase: 'red' });
  assert.deepEqual(red.counts(), { spawns: 1, appends: 1, reads: 2 });

  const greenBeforeRed = makeAdapters({ moduleExists: true, status: 0 });
  assert.deepEqual(executeTddAction('record-green', greenBeforeRed.adapters), { ok: false, code: 'TDD_MEASUREMENT_CONFLICT' });
  assert.deepEqual(greenBeforeRed.counts(), { spawns: 0, appends: 0, reads: 1 });

  const recovered = makeAdapters({ appendMode: 'throw' });
  assert.deepEqual(executeTddAction('record-red', recovered.adapters), { ok: true, code: 'RECOVERED', phase: 'red' });
  assert.deepEqual(recovered.counts(), { spawns: 1, appends: 1, reads: 2 });
  const uncertain = makeAdapters({ appendMode: 'drop' });
  assert.deepEqual(executeTddAction('record-red', uncertain.adapters), { ok: false, code: 'TDD_APPEND_UNCERTAIN' });
  assert.deepEqual(uncertain.counts(), { spawns: 1, appends: 1, reads: 2 });
  for (const appendMode of ['different', 'duplicate']) {
    const fixture = makeAdapters({ appendMode });
    assert.equal(executeTddAction('record-red', fixture.adapters).ok, false);
    assert.deepEqual(fixture.counts(), { spawns: 1, appends: 1, reads: 2 });
  }
  for (const override of [{ activePlan: () => 'wrong' }, { acceptanceValid: () => false },
    { currentSessionId: () => 'bad' }]) {
    const fixture = makeAdapters(); Object.assign(fixture.adapters, override);
    assert.equal(executeTddAction('record-red', fixture.adapters).ok, false);
    assert.equal(fixture.counts().spawns, 0); assert.equal(fixture.counts().appends, 0);
  }
});

test('pins fresh manifest and complete predecessor bytes through bounded reads', async () => {
  const { buildPseCaptureAttestationManifest } = await import('../../../../scripts/lib/pse-capture-attestation.mjs');
  assert.equal(buildPseCaptureAttestationManifest({ cwd: ROOT }).manifestDigest, '92aa3f503d9172a7c3ebc04e6f92366d52e1b0b26718e24fb1c446e079c7ff4c');
  const pins = [
    { slug: 'pse-capture-attestation-3', attempts: 3,
      acceptanceBinding: 'b96f95e62b058307352d362b42f765160efe4e1596324c1b7ef4b30d187d2154',
      goals: 'e531c214250a95b7b90dff45e7f347aa966903cc76d3b1120cf844364e42a0ba', acceptance: '3316b30b9098043ee39c7c28045a982fb14d237bf9c3ad2012ceb7abaef4ef5b', completion: '06b68eb35c21d0addb86aff62ad123101b932f4544fe7f249696c2e10bf59a12', ledger: '8d024caf79a871998c605af8b719f2539ef7bcf3e4d2e3cc95a66f7f51d006a5', receipt: '679f1596a1a60e44b2e21df6e2fb23f346dc853fc26145bf01b85f35c68f704a', eventDigest: '6714c2dce0ce3ea48cc013fad358d77684b8b5472842d0b09b042490682805ac' },
    { slug: 'runtime-controller-bounded-qe-read', attempts: 1,
      acceptanceBinding: 'f24e6a188661f121a7721d26da1524ff0aca7f4571393f8fe02fe08f4cd7f40f',
      goals: '50ab2253b0be159b8ff2e47ac10dfcdba27df9a57dd346d3d73948e6b137425f', acceptance: '509d96e50d362563b21ae6f61b31eda32aa33b665e0fdef6368444c511272bcd', completion: '2b4cf4da4eb7ec5a475c1b0aaa8e3b2dfb9d42aec7badda5930e3c5355f85e13', ledger: 'd2d55a258cd9ee8312aeebe7acdc783acb7c4c99424280528226ef5e20a2d5c8', receipt: '6289b624b58c43abdcaa707254e57c733e257ea09b80fb36495fabca65c5923f', eventDigest: '350db2c02eb9e90f72ea3489a0ed76b1af4db11d40e87df2f0a8d0b834795e5b' },
  ];
  for (const pin of pins) {
    const root = `.qe/planning/plans/${pin.slug}`;
    const raw = Object.fromEntries(['goals', 'acceptance', 'completion', 'ledger'].map(kind => {
      const suffix = kind === 'goals' ? 'goals.json' : kind === 'ledger' ? 'ledger.jsonl' : `evidence/G001.${kind}.json`;
      return [kind, Buffer.from(readFileBoundedSync(`${root}/${suffix}`, 1_048_576))];
    }));
    for (const kind of Object.keys(raw)) assert.equal(sha(raw[kind]), pin[kind]);
    const goals = JSON.parse(raw.goals); const completion = JSON.parse(raw.completion);
    const goal = goals.goals.find(item => item.id === 'G001');
    assert.deepEqual({ status: goal.status, attempts: goal.attempts, completion: goal.completionEvidence?.status,
      acceptance: goal.acceptance?.status, binding: goal.acceptance?.hash },
    { status: 'complete', attempts: pin.attempts, completion: 'recorded', acceptance: 'defined', binding: pin.acceptanceBinding });
    assert.equal(JSON.parse(raw.acceptance).goalId, 'G001');
    assert.equal(completion.goalId, 'G001');
    assert.ok(completion.requirements.every(item => item.outcome === 'pass'));
    assert.ok(completion.scenarios.every(item => item.outcome === 'pass'));
    assert.equal(completion.regression.outcome, 'pass');
    assert.equal(completion.independentVerification.outcome, 'pass');
    assert.equal(completion.goalAlignment.verifier, completion.independentVerification.verifier);
    const text = raw.ledger.toString();
    assert.ok(!text.includes('\r') && !text.includes('\n\n'));
    const events = text.trimEnd().split('\n').map(JSON.parse);
    const verified = events.filter(event => event.event === 'verified' && event.goal === 'G001');
    assert.equal(verified.length, 1);
    assert.equal(events.at(-1), verified[0]);
    assert.equal(verified[0].receiptId, pin.receipt);
    assert.equal(verified[0].eventContentDigest, pin.eventDigest);
  }
});
