import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CONTRACT_PATH = join(ROOT, 'core', 'rules', 'harness-signal-fact-events.contract.json');
const MODULE_PATH = join(ROOT, 'scripts', 'lib', 'harness-signal-fact-events.mjs');
const EXPECTED_CONTRACT_SHA256 = '7d846c1502475e6ee6ebc52262edac937bde9c95a723a3a54ecf78222f94cf36';
const LAUNCH = '12345678-1234-4234-9234-123456789abc';
const artifactsPresent = existsSync(CONTRACT_PATH) && existsSync(MODULE_PATH);
const EXPECTED_CONTRACT = JSON.parse(`{
  "channelReaders":{"controller-facts":"controller","decoy-facts":"controller","decoy-report":"controller","guardian-facts":"outer","outer-facts":"controller","plan-ack":"guardian","retire-ack":"guardian","retire-command":"sentinel","sentinel-direct":"outer","sentinel-facts":"guardian"},
  "channels":["guardian-facts","outer-facts","controller-facts","sentinel-facts","decoy-facts","sentinel-direct","plan-ack","retire-command","retire-ack","decoy-report"],
  "contract":"qe.signal.fact-contract.v1",
  "eventKinds":["residual","protocol-frame","child-wait","census-snapshot","decoy-report","stream-closed"],
  "eventProfiles":{
    "census-snapshot":{"channelMode":"guardian-facts","extraKeys":["members","membersDigest","phase","sample"],"producerMode":"null"},
    "child-wait":{"channelMode":"observer-facts","extraKeys":["pid","role","wait"],"producerMode":"null"},
    "decoy-report":{"channelMode":"decoy-report","extraKeys":["frame","termCount"],"producerMode":"decoy-sequence-1"},
    "protocol-frame":{"channelMode":"frame-profile","extraKeys":["errno","frame","frameKind","returned"],"producerMode":"frame-profile"},
    "residual":{"channelMode":"observer-facts","extraKeys":["reason"],"producerMode":"null"},
    "stream-closed":{"channelMode":"reader-bound","extraKeys":["closure","errorCode"],"producerMode":"null"}
  },
  "frameProfiles":{
    "kill-observation":{"actor":"sentinel","channel":"sentinel-direct","observer":"outer","producerSequence":4,"returnedMode":"null-only"},
    "plan-accepted-ack":{"actor":"sentinel","channel":"plan-ack","observer":"guardian","producerSequence":2,"returnedMode":"null-only"},
    "plan-accepted-direct":{"actor":"sentinel","channel":"sentinel-direct","observer":"outer","producerSequence":1,"returnedMode":"null-only"},
    "retire-ack":{"actor":"sentinel","channel":"retire-ack","observer":"guardian","producerSequence":5,"returnedMode":"null-only"},
    "retire-command":{"actor":"guardian","channel":"retire-command","observer":"sentinel","producerSequence":1,"returnedMode":"null-only"},
    "term-result":{"actor":"sentinel","channel":"sentinel-direct","observer":"outer","producerSequence":3,"returnedMode":"boolean-errno"}
  },
  "limitations":["OPAQUE_FRAME_SEMANTICS","NO_TERMINAL_PROJECTION","CALLER_PROVENANCE_REQUIRED"],
  "limits":{"closureSequence":65535,"maxCanonicalBytes":1048576,"maxChannelSequence":65534,"maxDepth":32,"maxEventBytes":2048,"maxEventNodes":128,"maxEvents":256,"maxMembers":1,"maxNodes":65536,"maxRawFrameBytes":112,"maxUint32":4294967295,"maxUint64String":"18446744073709551615","minPid":1},
  "maxEvents":256,
  "observers":["guardian","outer","sentinel","controller","decoy"],
  "patterns":{"digest":"^[0-9a-f]{64}$","rawHex112":"^[0-9a-f]{224}$","uint64":"^(0|[1-9][0-9]{0,19})$","uuidV4":"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"},
  "producers":["guardian","sentinel","decoy"],
  "residualReasons":["PLAN_NOT_ACCEPTED","ACK_UNOBSERVED","GUARDIAN_LOST","PROTOCOL_INVALID","SIGNAL_FAILED","WAIT_INCOMPLETE","CENSUS_UNCERTAIN","ROLE_TIMEOUT","RESULT_INVALID","OBSERVER_TIMEOUT","INTERLOCK_FAILED"],
  "version":1
}`);

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('RED: shipped contract and validator artifacts exist', () => {
  assert.equal(existsSync(CONTRACT_PATH), true, 'contract artifact must exist');
  assert.equal(existsSync(MODULE_PATH), true, 'validator artifact must exist');
});

async function loadModule() {
  return import(`${pathToFileURL(MODULE_PATH).href}?test=${Date.now()}-${Math.random()}`);
}

function frame(byte = 0x41) {
  const bytes = Buffer.alloc(112, byte);
  return { bytes: 112, rawHex: bytes.toString('hex'), sha256: sha256(bytes) };
}

function eventFactory(api, overrides = {}) {
  const core = {
    contract: 'qe.signal.fact-event.v1',
    kind: 'residual',
    ordinal: 1,
    launchUuid: LAUNCH,
    observer: 'controller',
    observedAtNs: '1',
    channel: 'controller-facts',
    channelSequence: 1,
    producer: null,
    producerSequence: null,
    reason: 'WAIT_INCOMPLETE',
    ...overrides,
  };
  delete core.eventId;
  if (core.kind !== 'residual') delete core.reason;
  return { ...core, eventId: api.factEventId(core) };
}

function trace(events) {
  return { contract: 'qe.signal.fact-trace.v1', launchUuid: LAUNCH, events };
}

test('pinned canonical contract bytes and exported clone are exact', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const bytes = readFileSync(CONTRACT_PATH);
  assert.equal(bytes.length, 4178);
  assert.equal(sha256(bytes), EXPECTED_CONTRACT_SHA256);
  assert.equal(api.EXPECTED_FACT_EVENT_CONTRACT_SHA256, EXPECTED_CONTRACT_SHA256);
  assert.deepEqual(api.FACT_EVENT_CONTRACT, EXPECTED_CONTRACT);
  assert.deepEqual(api.FACT_EVENT_CONTRACT.channels, [
    'guardian-facts', 'outer-facts', 'controller-facts', 'sentinel-facts', 'decoy-facts',
    'sentinel-direct', 'plan-ack', 'retire-command', 'retire-ack', 'decoy-report',
  ]);
  assert.deepEqual(api.FACT_EVENT_CONTRACT.limits, {
    closureSequence: 65535,
    maxCanonicalBytes: 1048576,
    maxChannelSequence: 65534,
    maxDepth: 32,
    maxEventBytes: 2048,
    maxEventNodes: 128,
    maxEvents: 256,
    maxMembers: 1,
    minPid: 1,
    maxNodes: 65536,
    maxRawFrameBytes: 112,
    maxUint32: 4294967295,
    maxUint64String: '18446744073709551615',
  });
  assert(Object.isFrozen(api.FACT_EVENT_CONTRACT));
  assert(Object.isFrozen(api.FACT_EVENT_CONTRACT.limits));
});

test('residual facts validate and exact-key/scalar mutations fail', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const valid = eventFactory(api);
  assert.deepEqual(api.validateFactEvent(valid, { launchUuid: LAUNCH }), valid);
  for (const bad of [
    { ...valid, launchUuid: LAUNCH.toUpperCase() },
    { ...valid, observedAtNs: '01' },
    { ...valid, observedAtNs: '18446744073709551616' },
    { ...valid, channelSequence: 65535 },
    { ...valid, observerSequence: 1 },
    { ...valid, eventId: 'A'.repeat(64) },
  ]) assert.throws(() => api.validateFactEvent(bad, { launchUuid: LAUNCH }), TypeError);
});

test('protocol frames bind profiles, raw bytes, producer and local order', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const direct = eventFactory(api, {
    kind: 'protocol-frame', observer: 'outer', channel: 'sentinel-direct', channelSequence: 10,
    producer: 'sentinel', producerSequence: 1, frameKind: 'plan-accepted-direct',
    frame: frame(1), returned: null, errno: null,
  });
  const term = eventFactory(api, {
    kind: 'protocol-frame', ordinal: 2, observer: 'outer', observedAtNs: '2',
    channel: 'sentinel-direct', channelSequence: 11, producer: 'sentinel', producerSequence: 3,
    frameKind: 'term-result', frame: frame(2), returned: true, errno: 0,
  });
  assert.equal(api.validateFactTrace(trace([direct, term])).events.length, 2);
  const wrong = { ...term, producerSequence: 4 };
  wrong.eventId = api.factEventId(Object.fromEntries(Object.entries(wrong).filter(([key]) => key !== 'eventId')));
  assert.throws(() => api.validateFactTrace(trace([direct, wrong])), TypeError);
  const badFrame = { ...direct, frame: { ...direct.frame, rawHex: 'A'.repeat(224) } };
  badFrame.eventId = api.factEventId(Object.fromEntries(Object.entries(badFrame).filter(([key]) => key !== 'eventId')));
  assert.throws(() => api.validateFactEvent(badFrame, { launchUuid: LAUNCH }), TypeError);

  const invertedDirect = eventFactory(api, { ...Object.fromEntries(Object.entries(direct).filter(([key]) => key !== 'eventId')), channelSequence: 12 });
  const invertedTerm = eventFactory(api, { ...Object.fromEntries(Object.entries(term).filter(([key]) => key !== 'eventId')), channelSequence: 11 });
  assert.throws(() => api.validateFactTrace(trace([invertedDirect, invertedTerm])), /order inversion/);
});

test('PID, wait and census boundaries are exact', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const waitCore = {
    kind: 'child-wait', observer: 'guardian', channel: 'guardian-facts', channelSequence: 1,
    producer: null, producerSequence: null, role: 'sentinel', pid: 1,
    wait: { exitKind: 'exit', code: 0, signal: null },
  };
  const wait = eventFactory(api, waitCore);
  assert.doesNotThrow(() => api.validateFactEvent(wait, { launchUuid: LAUNCH }));
  const zero = eventFactory(api, { ...waitCore, pid: 0 });
  assert.throws(() => api.validateFactEvent(zero, { launchUuid: LAUNCH }), TypeError);

  const emptyMembers = [];
  const empty = eventFactory(api, {
    kind: 'census-snapshot', observer: 'guardian', channel: 'guardian-facts', channelSequence: 2,
    producer: null, producerSequence: null, phase: 'empty', sample: 1,
    members: emptyMembers, membersDigest: sha256(api.canonicalFactJson(emptyMembers)),
  });
  const oneMembers = [4294967295];
  const one = eventFactory(api, {
    kind: 'census-snapshot', ordinal: 2, observer: 'guardian', observedAtNs: '2',
    channel: 'guardian-facts', channelSequence: 3, producer: null, producerSequence: null,
    phase: 'sentinel-only', sample: 1, members: oneMembers,
    membersDigest: sha256(api.canonicalFactJson(oneMembers)),
  });
  assert.doesNotThrow(() => api.validateFactTrace(trace([empty, one])));
  const two = eventFactory(api, {
    ...one, ordinal: 1, eventId: undefined, members: [1, 2],
    membersDigest: sha256(api.canonicalFactJson([1, 2])),
  });
  assert.throws(() => api.validateFactEvent(two, { launchUuid: LAUNCH }), TypeError);
});

test('collector arrival, per-observer time and closure sequence remain independent', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const ack = eventFactory(api, {
    kind: 'protocol-frame', observer: 'guardian', observedAtNs: '50', channel: 'plan-ack',
    channelSequence: 20, producer: 'sentinel', producerSequence: 2,
    frameKind: 'plan-accepted-ack', frame: frame(3), returned: null, errno: null,
  });
  const direct = eventFactory(api, {
    kind: 'protocol-frame', ordinal: 2, observer: 'outer', observedAtNs: '10',
    channel: 'sentinel-direct', channelSequence: 5, producer: 'sentinel', producerSequence: 1,
    frameKind: 'plan-accepted-direct', frame: frame(4), returned: null, errno: null,
  });
  assert.doesNotThrow(() => api.validateFactTrace(trace([ack, direct])));

  const closure = eventFactory(api, {
    kind: 'stream-closed', ordinal: 3, observer: 'outer', observedAtNs: '11',
    channel: 'sentinel-direct', channelSequence: 65535, producer: null, producerSequence: null,
    closure: 'eof', errorCode: null,
  });
  assert.doesNotThrow(() => api.validateFactTrace(trace([ack, direct, closure])));
  const sameObserverBackwards = eventFactory(api, {
    kind: 'residual', ordinal: 4, observer: 'outer', observedAtNs: '9', channel: 'outer-facts',
    channelSequence: 1, producer: null, producerSequence: null, reason: 'WAIT_INCOMPLETE',
  });
  assert.throws(() => api.validateFactTrace(trace([ack, direct, closure, sameObserverBackwards])), TypeError);
});

test('closure-first collector arrival permits smaller local late fact and rejects invalid closure values', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const closure = eventFactory(api, {
    kind: 'stream-closed', observer: 'outer', observedAtNs: '1', channel: 'sentinel-direct',
    channelSequence: 65535, producer: null, producerSequence: null, closure: 'eof', errorCode: null,
  });
  const direct = eventFactory(api, {
    kind: 'protocol-frame', ordinal: 2, observer: 'outer', observedAtNs: '2',
    channel: 'sentinel-direct', channelSequence: 65534, producer: 'sentinel', producerSequence: 1,
    frameKind: 'plan-accepted-direct', frame: frame(5), returned: null, errno: null,
  });
  assert.doesNotThrow(() => api.validateFactTrace(trace([closure, direct])));
  const wrongClosure = { ...closure, channelSequence: 65534 };
  wrongClosure.eventId = api.factEventId(Object.fromEntries(Object.entries(wrongClosure).filter(([key]) => key !== 'eventId')));
  assert.throws(() => api.validateFactEvent(wrongClosure, { launchUuid: LAUNCH }), TypeError);
});

test('decoy, retire, waits, census and residual remain independent in one full trace', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const specs = [
    { kind: 'protocol-frame', observer: 'guardian', observedAtNs: '1', channel: 'plan-ack', channelSequence: 10, producer: 'sentinel', producerSequence: 2, frameKind: 'plan-accepted-ack', frame: frame(10), returned: null, errno: null },
    { kind: 'protocol-frame', observer: 'outer', observedAtNs: '1', channel: 'sentinel-direct', channelSequence: 5, producer: 'sentinel', producerSequence: 1, frameKind: 'plan-accepted-direct', frame: frame(11), returned: null, errno: null },
    { kind: 'residual', observer: 'outer', observedAtNs: '2', channel: 'outer-facts', channelSequence: 1, producer: null, producerSequence: null, reason: 'ACK_UNOBSERVED' },
    { kind: 'child-wait', observer: 'guardian', observedAtNs: '2', channel: 'guardian-facts', channelSequence: 1, producer: null, producerSequence: null, role: 'sentinel', pid: 42, wait: { exitKind: 'exit', code: 0, signal: null } },
    { kind: 'census-snapshot', observer: 'guardian', observedAtNs: '3', channel: 'guardian-facts', channelSequence: 2, producer: null, producerSequence: null, phase: 'empty', sample: 1, members: [], membersDigest: sha256(api.canonicalFactJson([])) },
    { kind: 'census-snapshot', observer: 'guardian', observedAtNs: '4', channel: 'guardian-facts', channelSequence: 3, producer: null, producerSequence: null, phase: 'empty', sample: 2, members: [], membersDigest: sha256(api.canonicalFactJson([])) },
    { kind: 'protocol-frame', observer: 'sentinel', observedAtNs: '1', channel: 'retire-command', channelSequence: 1, producer: 'guardian', producerSequence: 1, frameKind: 'retire-command', frame: frame(12), returned: null, errno: null },
    { kind: 'protocol-frame', observer: 'guardian', observedAtNs: '5', channel: 'retire-ack', channelSequence: 1, producer: 'sentinel', producerSequence: 5, frameKind: 'retire-ack', frame: frame(13), returned: null, errno: null },
    { kind: 'decoy-report', observer: 'controller', observedAtNs: '1', channel: 'decoy-report', channelSequence: 1, producer: 'decoy', producerSequence: 1, termCount: 0, frame: frame(14) },
    { kind: 'stream-closed', observer: 'outer', observedAtNs: '3', channel: 'sentinel-direct', channelSequence: 65535, producer: null, producerSequence: null, closure: 'eof', errorCode: null },
  ];
  const events = specs.map((spec, index) => eventFactory(api, { ...spec, ordinal: index + 1 }));
  assert.equal(api.validateFactTrace(trace(events)).events.length, specs.length);
  for (const forbidden of ['status', 'success', 'quiescent', 'terminalResult', 'guardianResult', 'reducer']) {
    const bad = { ...events[2], [forbidden]: true };
    bad.eventId = api.factEventId(Object.fromEntries(Object.entries(bad).filter(([key]) => key !== 'eventId')));
    assert.throws(() => api.validateFactEvent(bad, { launchUuid: LAUNCH }), TypeError);
  }
});

test('append-only extension preserves canonical prefix', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const first = eventFactory(api);
  const second = eventFactory(api, { ordinal: 2, observedAtNs: '2', channelSequence: 2, reason: 'ROLE_TIMEOUT' });
  const base = trace([first]);
  const next = trace([first, second]);
  assert.equal(api.isAppendOnlyExtension(base, next), true);
  const changed = trace([{ ...first, reason: 'ROLE_TIMEOUT' }, second]);
  changed.events[0].eventId = api.factEventId(Object.fromEntries(Object.entries(changed.events[0]).filter(([key]) => key !== 'eventId')));
  assert.equal(api.isAppendOnlyExtension(base, changed), false);
});

test('max trace and graph boundaries are enforced', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const events = Array.from({ length: 256 }, (_, index) => eventFactory(api, {
    ordinal: index + 1, observedAtNs: String(index + 1), channelSequence: index + 1,
    reason: index % 2 ? 'ROLE_TIMEOUT' : 'WAIT_INCOMPLETE',
  }));
  assert.equal(api.validateFactTrace(trace(events)).events.length, 256);
  const tooMany = [...events, eventFactory(api, { ordinal: 257, observedAtNs: '257', channelSequence: 257 })];
  assert.throws(() => api.validateFactTrace(trace(tooMany)), TypeError);

  const oversized = { ...events[0], padding: 'x'.repeat(3000) };
  oversized.eventId = api.factEventId(Object.fromEntries(Object.entries(oversized).filter(([key]) => key !== 'eventId')));
  assert.throws(() => api.validateFactEvent(oversized, { launchUuid: LAUNCH }), /limit/);

  const tooManyNodes = { ...events[0], padding: Array.from({ length: 130 }, () => 0) };
  tooManyNodes.eventId = api.factEventId(Object.fromEntries(Object.entries(tooManyNodes).filter(([key]) => key !== 'eventId')));
  assert.throws(() => api.validateFactEvent(tooManyNodes, { launchUuid: LAUNCH }), /limit/);

  const giantTrace = { contract: 'qe.signal.fact-trace.v1', launchUuid: LAUNCH, events: Array(100000).fill(null) };
  const started = performance.now();
  assert.throws(() => api.validateFactTrace(giantTrace), /event count/);
  assert(performance.now() - started < 100);
});

test('hostile arrays, accessors, symbols, prototypes, cycles and large strings fail before side effects', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  let getterCalls = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { getterCalls += 1; return 'x'; } });
  assert.throws(() => api.canonicalFactJson(accessor), TypeError);
  assert.equal(getterCalls, 0);

  const hidden = [];
  Object.defineProperty(hidden, 'hidden', { value: 1, enumerable: false });
  assert.throws(() => api.canonicalFactJson(hidden), TypeError);
  const symbolic = [];
  symbolic[Symbol('x')] = 1;
  assert.throws(() => api.canonicalFactJson(symbolic), TypeError);
  const altered = [];
  Object.setPrototypeOf(altered, null);
  assert.throws(() => api.canonicalFactJson(altered), TypeError);
  const cycle = [];
  cycle.push(cycle);
  assert.throws(() => api.canonicalFactJson(cycle), TypeError);
  assert.throws(() => api.canonicalFactJson('x'.repeat(1024 * 1024 + 1)), /string limit/);
});

test('all frame profiles, wait branches, scalar limits and forbidden source time are covered', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const profiles = [
    ['plan-accepted-direct', 'outer', 'sentinel-direct', 'sentinel', 1, null, null],
    ['plan-accepted-ack', 'guardian', 'plan-ack', 'sentinel', 2, null, null],
    ['term-result', 'outer', 'sentinel-direct', 'sentinel', 3, true, 0],
    ['term-result', 'outer', 'sentinel-direct', 'sentinel', 3, false, 4294967295],
    ['kill-observation', 'outer', 'sentinel-direct', 'sentinel', 4, null, null],
    ['retire-command', 'sentinel', 'retire-command', 'guardian', 1, null, null],
    ['retire-ack', 'guardian', 'retire-ack', 'sentinel', 5, null, null],
  ];
  for (const [frameKind, observer, channel, producer, producerSequence, returned, errno] of profiles) {
    const value = eventFactory(api, {
      kind: 'protocol-frame', observer, channel, channelSequence: 1, producer, producerSequence,
      frameKind, frame: frame(producerSequence), returned, errno,
    });
    assert.doesNotThrow(() => api.validateFactEvent(value, { launchUuid: LAUNCH }), frameKind);
  }

  const signalWait = eventFactory(api, {
    kind: 'child-wait', observer: 'guardian', channel: 'guardian-facts', channelSequence: 1,
    producer: null, producerSequence: null, role: 'fixture', pid: 4294967295,
    wait: { exitKind: 'signal', code: null, signal: 255 }, observedAtNs: '18446744073709551615',
  });
  assert.doesNotThrow(() => api.validateFactEvent(signalWait, { launchUuid: LAUNCH }));
  for (const override of [
    { pid: 4294967296 },
    { wait: { exitKind: 'signal', code: 0, signal: 15 } },
    { observedAtNs: '18446744073709551616' },
    { sourceObservedAtNs: '1' },
  ]) {
    const bad = { ...signalWait, ...override };
    bad.eventId = api.factEventId(Object.fromEntries(Object.entries(bad).filter(([key]) => key !== 'eventId')));
    assert.throws(() => api.validateFactEvent(bad, { launchUuid: LAUNCH }), TypeError);
  }
});

test('every trace uniqueness class, census pair and closure isolation rejects or accepts exactly', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const residual = (ordinal, channelSequence, reason = 'WAIT_INCOMPLETE') => eventFactory(api, {
    ordinal, observedAtNs: String(ordinal), channelSequence, reason,
  });
  const duplicateChannel = [residual(1, 1), residual(2, 1, 'ROLE_TIMEOUT')];
  assert.throws(() => api.validateFactTrace(trace(duplicateChannel)), /channel sequence/);

  const direct1 = eventFactory(api, {
    kind: 'protocol-frame', observer: 'outer', channel: 'sentinel-direct', channelSequence: 1,
    producer: 'sentinel', producerSequence: 1, frameKind: 'plan-accepted-direct',
    frame: frame(21), returned: null, errno: null,
  });
  const direct2 = eventFactory(api, {
    kind: 'protocol-frame', ordinal: 2, observer: 'outer', observedAtNs: '2',
    channel: 'sentinel-direct', channelSequence: 2, producer: 'sentinel', producerSequence: 1,
    frameKind: 'plan-accepted-direct', frame: frame(22), returned: null, errno: null,
  });
  assert.throws(() => api.validateFactTrace(trace([direct1, direct2])), /producer sequence/);
  const duplicateId = { ...residual(2, 2), eventId: residual(1, 1).eventId };
  assert.throws(() => api.validateFactTrace(trace([residual(1, 1), duplicateId])), /eventId/);

  const wait1 = eventFactory(api, {
    kind: 'child-wait', observer: 'guardian', channel: 'guardian-facts', channelSequence: 1,
    producer: null, producerSequence: null, role: 'sentinel', pid: 9,
    wait: { exitKind: 'exit', code: 0, signal: null },
  });
  const wait2 = eventFactory(api, {
    kind: 'child-wait', ordinal: 2, observer: 'guardian', observedAtNs: '2',
    channel: 'guardian-facts', channelSequence: 2, producer: null, producerSequence: null,
    role: 'sentinel', pid: 9, wait: { exitKind: 'signal', code: null, signal: 9 },
  });
  assert.throws(() => api.validateFactTrace(trace([wait1, wait2])), /child wait/);

  const censusEvent = (ordinal, sample, channelSequence, members, digest = sha256(api.canonicalFactJson(members))) => eventFactory(api, {
    kind: 'census-snapshot', ordinal, observer: 'guardian', observedAtNs: String(ordinal),
    channel: 'guardian-facts', channelSequence, producer: null, producerSequence: null,
    phase: members.length ? 'sentinel-only' : 'empty', sample, members, membersDigest: digest,
  });
  assert.throws(() => api.validateFactTrace(trace([censusEvent(1, 1, 2, []), censusEvent(2, 2, 1, [])])), /census pair/);
  assert.throws(() => api.validateFactTrace(trace([censusEvent(1, 1, 1, [1]), censusEvent(2, 2, 2, [2])])), /census pair/);
  assert.throws(() => api.validateFactEvent(censusEvent(1, 1, 1, [], '0'.repeat(64)), { launchUuid: LAUNCH }), /membership/);

  const closure = eventFactory(api, {
    kind: 'stream-closed', observer: 'outer', channel: 'sentinel-direct', channelSequence: 65535,
    producer: null, producerSequence: null, closure: 'eof', errorCode: null,
  });
  const otherChannel = residual(2, 1);
  assert.doesNotThrow(() => api.validateFactTrace(trace([closure, otherChannel])));
  const closure2 = eventFactory(api, {
    kind: 'stream-closed', ordinal: 2, observer: 'outer', observedAtNs: '2',
    channel: 'sentinel-direct', channelSequence: 65535, producer: null, producerSequence: null,
    closure: 'timeout', errorCode: null,
  });
  assert.throws(() => api.validateFactTrace(trace([closure, closure2])), /channel sequence|closure/);

  const decoy = ordinal => eventFactory(api, {
    kind: 'decoy-report', ordinal, observer: 'controller', observedAtNs: String(ordinal),
    channel: 'decoy-report', channelSequence: ordinal, producer: 'decoy', producerSequence: 1,
    termCount: 0, frame: frame(30 + ordinal),
  });
  assert.throws(() => api.validateFactTrace(trace([decoy(1), decoy(2)])), /producer sequence|decoy/);
});

test('event and trace byte/node thresholds reject at the intended preflight layer', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const base = eventFactory(api);
  const baseCore = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'eventId'));

  const sized = paddingLength => {
    const core = { ...baseCore, padding: 'x'.repeat(paddingLength) };
    return { ...core, eventId: api.factEventId(core) };
  };
  const emptyLength = Buffer.byteLength(api.canonicalFactJson(sized(0)));
  const exactBytes = sized(2048 - emptyLength);
  assert.equal(Buffer.byteLength(api.canonicalFactJson(exactBytes)), 2048);
  assert.throws(() => api.validateFactEvent(exactBytes, { launchUuid: LAUNCH }), /invalid keys/);
  assert.throws(() => api.validateFactEvent(sized(2049 - emptyLength), { launchUuid: LAUNCH }), /limit/);

  let firstNodeLimit = null;
  for (let length = 0; length < 140; length += 1) {
    const core = { ...baseCore, padding: Array.from({ length }, () => 0) };
    const value = { ...core, eventId: api.factEventId(core) };
    try { api.validateFactEvent(value, { launchUuid: LAUNCH }); }
    catch (error) { if (/limit/.test(String(error.message))) { firstNodeLimit = { length, value }; break; } }
  }
  assert(firstNodeLimit);
  assert.throws(() => api.validateFactEvent(firstNodeLimit.value, { launchUuid: LAUNCH }), /limit/);
});

test('contract cache poisoning fails before validator exports and post-load mutation is isolated', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  const require = createRequire(import.meta.url);
  const cached = require(CONTRACT_PATH);
  cached.maxEvents = 999;
  assert.equal(api.FACT_EVENT_CONTRACT.maxEvents, 256);
  cached.maxEvents = 256;

  const child = `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const require = createRequire(import.meta.url);
    const value = require(${JSON.stringify(CONTRACT_PATH)});
    value.maxEvents = 999;
    try {
      await import(pathToFileURL(${JSON.stringify(MODULE_PATH)}).href + '?poison=1');
      process.exit(7);
    } catch (error) {
      process.exit(/contract/i.test(String(error?.message)) ? 0 : 8);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { timeout: 5000 });
  assert.equal(result.status, 0, result.stderr?.toString());

  const accessorChild = `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const require = createRequire(import.meta.url);
    const value = require(${JSON.stringify(CONTRACT_PATH)});
    globalThis.calls = 0;
    Object.defineProperty(value.channels, '0', { enumerable: true, configurable: true, get() { globalThis.calls += 1; return 'guardian-facts'; } });
    try { await import(pathToFileURL(${JSON.stringify(MODULE_PATH)}).href + '?poison=accessor'); process.exit(7); }
    catch { process.exit(globalThis.calls === 0 ? 0 : 9); }
  `;
  const accessorResult = spawnSync(process.execPath, ['--input-type=module', '-e', accessorChild], { timeout: 5000 });
  assert.equal(accessorResult.status, 0, accessorResult.stderr?.toString());
});

test('package dry-run ships contract and validator but excludes tests', { skip: !artifactsPresent }, () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const files = new Set(output[0].files.map(item => item.path));
  assert(files.has('core/rules/harness-signal-fact-events.contract.json'));
  assert(files.has('scripts/lib/harness-signal-fact-events.mjs'));
  assert(!files.has('scripts/lib/__tests__/harness-signal-fact-events.test.mjs'));
});

test('validator source has exact imports/exports and no runtime side effects', { skip: !artifactsPresent }, () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.match(source, /from 'node:crypto'/);
  assert.match(source, /with \{ type: 'json' \}/);
  for (const forbidden of [
    'node:fs', 'node:child_process', 'process.kill', 'process.env', 'setTimeout(', 'setInterval(',
    'fetch(', 'node:net', 'node:http', 'killpg', 'spawn(', 'exec(', 'eval(', 'new Function',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
  for (const forbiddenKey of ['terminalResult', 'guardianResult', "status: 'quiescent'", 'success: true']) {
    assert.equal(source.includes(forbiddenKey), false, forbiddenKey);
  }
});

test('module namespace and bounded package failure helpers are exact', { skip: !artifactsPresent }, async () => {
  const api = await loadModule();
  assert.deepEqual(Object.keys(api).sort(), [
    'EXPECTED_FACT_EVENT_CONTRACT_SHA256', 'FACT_EVENT_CONTRACT', 'canonicalFactJson',
    'factEventId', 'isAppendOnlyExtension', 'validateFactEvent', 'validateFactTrace',
  ].sort());
  assert.throws(() => JSON.parse('{not-json'));
  const timeout = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 20 });
  assert(timeout.error);
  const overflow = spawnSync(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBuffer: 1024 });
  assert(overflow.error);
  const nonzero = spawnSync(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(nonzero.status, 3);
});
