import { createHash } from 'node:crypto';
import importedContract from '../../core/rules/harness-signal-fact-events.contract.json' with { type: 'json' };

export const EXPECTED_FACT_EVENT_CONTRACT_SHA256 = '7d846c1502475e6ee6ebc52262edac937bde9c95a723a3a54ecf78222f94cf36';
const COMMON_KEYS = Object.freeze(['channel', 'channelSequence', 'contract', 'eventId', 'kind', 'launchUuid',
  'observedAtNs', 'observer', 'ordinal', 'producer', 'producerSequence']);
const OBSERVER_FACT_CHANNEL = Object.freeze({ guardian: 'guardian-facts', outer: 'outer-facts',
  controller: 'controller-facts', sentinel: 'sentinel-facts', decoy: 'decoy-facts' });
const CHILD_ROLE_MAP = Object.freeze({ guardian: Object.freeze(['sentinel', 'fixture']),
  outer: Object.freeze(['guardian']), controller: Object.freeze(['outer', 'decoy']) });
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype; }

function assertExactKeys(value, keys, label) {
  const ownKeys = plainObject(value) ? Reflect.ownKeys(value) : [];
  if (!plainObject(value) || ownKeys.some(key => typeof key !== 'string') || ownKeys.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor?.enumerable || descriptor.get || descriptor.set;
  })
    || ownKeys.sort().join('|') !== [...keys].sort().join('|')) {
    throw new TypeError(`${label} has invalid keys`);
  }
}

function inspectAndSort(value, limits, depth = 0, seen = new Set(), counter = { nodes: 0 }) {
  counter.nodes += 1;
  if (counter.nodes > limits.maxNodes || depth > limits.maxDepth) throw new TypeError('canonical graph limit exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('invalid canonical number');
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxBytes) throw new TypeError('canonical string limit exceeded');
    if (!/^[\x20-\x7e]*$/.test(value)) throw new TypeError('invalid canonical string');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('invalid canonical graph');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > limits.maxNodes - counter.nodes) {
      throw new TypeError('canonical array limit exceeded');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length') throw new TypeError('invalid canonical array keys');
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.get || lengthDescriptor.set) {
      throw new TypeError('invalid canonical array length');
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError('invalid canonical array item');
      items.push(inspectAndSort(descriptor.value, limits, depth + 1, seen, counter));
    }
    result = items;
  } else {
    if (!plainObject(value)) throw new TypeError('non-plain canonical object');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) throw new TypeError('symbol canonical key');
    if (ownKeys.length > limits.maxNodes - counter.nodes) throw new TypeError('canonical object limit exceeded');
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set || !/^[\x20-\x7e]+$/.test(key)) {
        throw new TypeError('invalid canonical property');
      }
      if (Buffer.byteLength(key, 'utf8') > limits.maxBytes) throw new TypeError('canonical key limit exceeded');
    }
    result = Object.fromEntries(Object.keys(value).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return [key, inspectAndSort(descriptor.value, limits, depth + 1, seen, counter)];
    }));
  }
  seen.delete(value);
  return result;
}

function canonicalWithLimits(value, limits, pretty = false) {
  const sorted = inspectAndSort(value, limits);
  const text = pretty ? `${JSON.stringify(sorted, null, 2)}\n` : JSON.stringify(sorted);
  if (Buffer.byteLength(text, 'utf8') > limits.maxBytes) throw new TypeError('canonical byte limit exceeded');
  return text;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
const CONTRACT_CANONICAL = canonicalWithLimits(importedContract,
  { maxDepth: 32, maxNodes: 8192, maxBytes: 1024 * 1024 }, true);
if (sha256(CONTRACT_CANONICAL) !== EXPECTED_FACT_EVENT_CONTRACT_SHA256) {
  throw new TypeError('fact-event contract authority digest mismatch');
}

function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);
} return value; }

export const FACT_EVENT_CONTRACT = deepFreeze(JSON.parse(CONTRACT_CANONICAL));
const UUID_RE = new RegExp(FACT_EVENT_CONTRACT.patterns.uuidV4);
const UINT64_RE = new RegExp(FACT_EVENT_CONTRACT.patterns.uint64);
const DIGEST_RE = new RegExp(FACT_EVENT_CONTRACT.patterns.digest);
const RAW_HEX_RE = new RegExp(FACT_EVENT_CONTRACT.patterns.rawHex112);

export function canonicalFactJson(value) { return canonicalWithLimits(value,
  { maxDepth: 32, maxNodes: 8192, maxBytes: 1024 * 1024 }); }

export function factEventId(eventWithoutEventId) {
  return sha256(canonicalFactJson(['qe-signal-fact-event-v1', eventWithoutEventId])); }

function assertUint(value, min, max, label) { if (!Number.isSafeInteger(value) || value < min || value > max)
  throw new TypeError(`invalid ${label}`); }

function assertUint64String(value) {
  if (typeof value !== 'string' || !UINT64_RE.test(value)
    || BigInt(value) > BigInt(FACT_EVENT_CONTRACT.limits.maxUint64String)) {
    throw new TypeError('invalid observedAtNs');
  }
}

function validateFrame(value) {
  assertExactKeys(value, ['bytes', 'rawHex', 'sha256'], 'frame');
  if (value.bytes !== 112 || typeof value.rawHex !== 'string' || !RAW_HEX_RE.test(value.rawHex)
    || typeof value.sha256 !== 'string' || !DIGEST_RE.test(value.sha256)
    || sha256(Buffer.from(value.rawHex, 'hex')) !== value.sha256) throw new TypeError('invalid frame');
}

function validateWait(value) {
  assertExactKeys(value, ['exitKind', 'code', 'signal'], 'wait');
  if (value.exitKind === 'exit') {
    assertUint(value.code, 0, 255, 'exit code');
    if (value.signal !== null) throw new TypeError('exit signal must be null');
  } else if (value.exitKind === 'signal') {
    if (value.code !== null) throw new TypeError('signal code must be null');
    assertUint(value.signal, 1, 255, 'signal');
  } else throw new TypeError('invalid wait kind');
}

function withoutEventId(event) { return Object.fromEntries(Object.entries(event)
  .filter(([key]) => key !== 'eventId')); }

function validateResidual(event) {
  if (event.producer !== null || event.producerSequence !== null
    || OBSERVER_FACT_CHANNEL[event.observer] !== event.channel
    || !FACT_EVENT_CONTRACT.residualReasons.includes(event.reason)) throw new TypeError('invalid residual');
}

function validateProtocolFrame(event) {
  const frameProfile = FACT_EVENT_CONTRACT.frameProfiles[event.frameKind];
  if (!frameProfile || event.producer !== frameProfile.actor || event.producerSequence !== frameProfile.producerSequence
    || event.observer !== frameProfile.observer || event.channel !== frameProfile.channel) throw new TypeError('invalid frame profile');
  validateFrame(event.frame);
  if (frameProfile.returnedMode === 'null-only') {
    if (event.returned !== null || event.errno !== null) throw new TypeError('invalid null frame result');
  } else if (event.returned === true && event.errno !== 0) throw new TypeError('invalid successful frame result');
  else if (event.returned === false) assertUint(event.errno, 1, FACT_EVENT_CONTRACT.limits.maxUint32, 'errno');
  else if (event.returned !== true) throw new TypeError('invalid frame result');
}

function validateChildWait(event) {
  if (event.producer !== null || event.producerSequence !== null
    || OBSERVER_FACT_CHANNEL[event.observer] !== event.channel
    || !CHILD_ROLE_MAP[event.observer]?.includes(event.role)) throw new TypeError('invalid child wait');
  assertUint(event.pid, 1, FACT_EVENT_CONTRACT.limits.maxUint32, 'pid');
  validateWait(event.wait);
}

function validateCensusSnapshot(event) {
  if (event.observer !== 'guardian' || event.channel !== 'guardian-facts'
    || event.producer !== null || event.producerSequence !== null
    || !['empty', 'sentinel-only'].includes(event.phase) || ![1, 2].includes(event.sample)
    || !Array.isArray(event.members) || event.members.length > 1) throw new TypeError('invalid census');
  for (const pid of event.members) assertUint(pid, 1, FACT_EVENT_CONTRACT.limits.maxUint32, 'census pid');
  if ((event.phase === 'empty' && event.members.length !== 0)
    || (event.phase === 'sentinel-only' && event.members.length !== 1)
    || event.membersDigest !== sha256(canonicalFactJson(event.members))) throw new TypeError('invalid census membership');
}

function validateDecoyReport(event) {
  if (event.observer !== 'controller' || event.channel !== 'decoy-report'
    || event.producer !== 'decoy' || event.producerSequence !== 1) throw new TypeError('invalid decoy report');
  assertUint(event.termCount, 0, FACT_EVENT_CONTRACT.limits.maxUint32, 'termCount');
  validateFrame(event.frame);
}

function validateStreamClosure(event) {
  if (event.observer !== FACT_EVENT_CONTRACT.channelReaders[event.channel]
    || event.producer !== null || event.producerSequence !== null) throw new TypeError('invalid closure observer');
  if (event.closure === 'error') {
    if (typeof event.errorCode !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(event.errorCode)) throw new TypeError('invalid closure error');
  } else if (['eof', 'timeout'].includes(event.closure) && event.errorCode !== null) throw new TypeError('closure error must be null');
  else if (!['eof', 'timeout'].includes(event.closure)) throw new TypeError('invalid closure');
}

const EVENT_VALIDATORS = Object.freeze({ residual: validateResidual, 'protocol-frame': validateProtocolFrame,
  'child-wait': validateChildWait, 'census-snapshot': validateCensusSnapshot,
  'decoy-report': validateDecoyReport, 'stream-closed': validateStreamClosure });

function validateEventShape(event, launchUuid) {
  if (!plainObject(event) || !FACT_EVENT_CONTRACT.eventKinds.includes(event.kind)) throw new TypeError('invalid event');
  const profile = FACT_EVENT_CONTRACT.eventProfiles[event.kind];
  assertExactKeys(event, [...COMMON_KEYS, ...profile.extraKeys], 'event');
  if (event.contract !== 'qe.signal.fact-event.v1' || event.launchUuid !== launchUuid || !UUID_RE.test(event.launchUuid)
    || !FACT_EVENT_CONTRACT.observers.includes(event.observer) || !FACT_EVENT_CONTRACT.channels.includes(event.channel)
    || typeof event.eventId !== 'string' || !DIGEST_RE.test(event.eventId)) throw new TypeError('invalid event common fields');
  assertUint(event.ordinal, 1, FACT_EVENT_CONTRACT.maxEvents, 'ordinal');
  assertUint64String(event.observedAtNs);
  const isClosure = event.kind === 'stream-closed';
  assertUint(event.channelSequence, isClosure ? 65535 : 1, isClosure ? 65535 : 65534, 'channelSequence');
  if (event.eventId !== factEventId(withoutEventId(event))) throw new TypeError('eventId mismatch');

  EVENT_VALIDATORS[event.kind](event);
}

export function validateFactEvent(event, { launchUuid } = {}) {
  if (typeof launchUuid !== 'string' || !UUID_RE.test(launchUuid)) throw new TypeError('invalid launchUuid authority');
  const text = canonicalWithLimits(event, { maxDepth: FACT_EVENT_CONTRACT.limits.maxDepth,
    maxNodes: FACT_EVENT_CONTRACT.limits.maxEventNodes, maxBytes: FACT_EVENT_CONTRACT.limits.maxEventBytes });
  const copy = JSON.parse(text);
  validateEventShape(copy, launchUuid);
  return deepFreeze(copy);
}

function uniqueAdd(set, value, label) { if (set.has(value)) throw new TypeError(`duplicate ${label}`);
  set.add(value); }

export function validateFactTrace(trace) {
  assertExactKeys(trace, ['contract', 'events', 'launchUuid'], 'trace');
  const eventsDescriptor = Object.getOwnPropertyDescriptor(trace, 'events');
  if (!eventsDescriptor || !Array.isArray(eventsDescriptor.value)
    || eventsDescriptor.value.length > FACT_EVENT_CONTRACT.maxEvents) throw new TypeError('invalid trace event count');
  const text = canonicalWithLimits(trace, { maxDepth: FACT_EVENT_CONTRACT.limits.maxDepth,
    maxNodes: FACT_EVENT_CONTRACT.limits.maxNodes, maxBytes: FACT_EVENT_CONTRACT.limits.maxCanonicalBytes });
  const copy = JSON.parse(text);
  if (copy.contract !== 'qe.signal.fact-trace.v1' || !UUID_RE.test(copy.launchUuid)
    || !Array.isArray(copy.events) || copy.events.length > FACT_EVENT_CONTRACT.maxEvents) throw new TypeError('invalid trace');

  const ids = new Set(); const channelSequences = new Set(); const producerSequences = new Set();
  const frameKinds = new Set(); const waits = new Set(); const census = new Set(); const closure = new Set();
  let decoySeen = false;
  const lastTimeByObserver = new Map(); const protocolByChannel = new Map();
  const censusByPhase = new Map(); const validated = [];

  for (let index = 0; index < copy.events.length; index += 1) {
    const event = validateFactEvent(copy.events[index], { launchUuid: copy.launchUuid });
    if (event.ordinal !== index + 1) throw new TypeError('non-contiguous ordinal');
    uniqueAdd(ids, event.eventId, 'eventId');
    uniqueAdd(channelSequences, `${event.channel}:${event.channelSequence}`, 'channel sequence');
    const time = BigInt(event.observedAtNs);
    const priorTime = lastTimeByObserver.get(event.observer);
    if (priorTime !== undefined && time < priorTime) throw new TypeError('observer time regression');
    lastTimeByObserver.set(event.observer, time);
    if (event.producer !== null) uniqueAdd(producerSequences, `${event.producer}:${event.producerSequence}`, 'producer sequence');
    if (event.kind === 'protocol-frame') {
      uniqueAdd(frameKinds, `${event.channel}:${event.frameKind}`, 'frame kind');
      const items = protocolByChannel.get(event.channel) ?? [];
      items.push(event); protocolByChannel.set(event.channel, items);
    } else if (event.kind === 'child-wait') uniqueAdd(waits, `${event.role}:${event.pid}`, 'child wait');
    else if (event.kind === 'census-snapshot') {
      uniqueAdd(census, `${event.phase}:${event.sample}`, 'census sample');
      const items = censusByPhase.get(event.phase) ?? [];
      items.push(event); censusByPhase.set(event.phase, items);
    } else if (event.kind === 'decoy-report') {
      if (decoySeen) throw new TypeError('duplicate decoy report');
      decoySeen = true;
    } else if (event.kind === 'stream-closed') uniqueAdd(closure, event.channel, 'stream closure');
    validated.push(event);
  }

  for (const items of protocolByChannel.values()) {
    items.sort((a, b) => a.channelSequence - b.channelSequence);
    for (let index = 1; index < items.length; index += 1) {
      if (items[index - 1].producer === items[index].producer
        && items[index - 1].producerSequence >= items[index].producerSequence) {
        throw new TypeError('producer/channel order inversion');
      }
    }
  }
  for (const items of censusByPhase.values()) {
    if (items.length === 2) {
      const first = items.find(item => item.sample === 1);
      const second = items.find(item => item.sample === 2);
      if (!first || !second || first.channelSequence >= second.channelSequence
        || canonicalFactJson(first.members) !== canonicalFactJson(second.members)
        || first.membersDigest !== second.membersDigest) throw new TypeError('census pair mismatch');
    }
  }
  for (const closed of validated.filter(event => event.kind === 'stream-closed')) {
    if (validated.some(event => event.kind !== 'stream-closed' && event.channel === closed.channel
      && event.channelSequence >= closed.channelSequence)) throw new TypeError('fact after stream closure');
  }
  return deepFreeze({ contract: copy.contract, events: validated, launchUuid: copy.launchUuid });
}

export function isAppendOnlyExtension(base, candidate) {
  const left = validateFactTrace(base);
  const right = validateFactTrace(candidate);
  if (left.contract !== right.contract || left.launchUuid !== right.launchUuid
    || right.events.length < left.events.length) return false;
  return left.events.every((event, index) => canonicalFactJson(event) === canonicalFactJson(right.events[index]));
}
