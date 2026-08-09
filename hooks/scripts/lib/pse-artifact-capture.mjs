import { TextDecoder, types } from 'node:util';
import { extractDocFrontmatter } from '../../../scripts/lib/doc-frontmatter.mjs';

const MAX_BYTES = 1024 * 1024;
const OPENING_MARKER = '<!-- qe-doc-frontmatter';
const CLOSING_MARKER = '-->';
const H1_RE = /^# [^\t\r\n ](?:[^\t\r\n]*[^\t\r\n ])?$/;
const TASK_PATH_RE = /^\.qe\/tasks\/(pending|in-progress|on-hold|completed)\/TASK_REQUEST_([0-9a-f]{8})\.md$/;
const CHECKLIST_PATH_RE = /^\.qe\/checklists\/(pending|in-progress|on-hold|completed)\/VERIFY_CHECKLIST_([0-9a-f]{8})\.md$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const canonicalIndexRe = /^(0|[1-9]\d*)$/;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const arrayBufferPrototype = ArrayBuffer.prototype;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'byteLength').get;
const arrayBufferResizableGetter = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'resizable').get;
const arrayBufferDetachedGetter = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'detached').get;

function failure(code) {
  return Object.freeze({ ok: false, code });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function invalidInput() {
  return failure('INVALID_INPUT');
}

function validateEnvelope(input) {
  if (typeof types.isProxy !== 'function' || types.isProxy(input)) return null;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;

  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;

  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(input);
  } catch {
    return null;
  }

  const expected = ['taskPath', 'taskBytes', 'checklistPath', 'checklistBytes'];
  if (ownKeys.length !== expected.length) return null;
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !expected.includes(key)) return null;
  }

  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    if (descriptor.get || descriptor.set) return null;
  }

  const taskPath = Object.getOwnPropertyDescriptor(input, 'taskPath').value;
  const taskBytes = Object.getOwnPropertyDescriptor(input, 'taskBytes').value;
  const checklistPath = Object.getOwnPropertyDescriptor(input, 'checklistPath').value;
  const checklistBytes = Object.getOwnPropertyDescriptor(input, 'checklistBytes').value;
  if (typeof taskPath !== 'string' || typeof checklistPath !== 'string') return null;
  return { taskPath, taskBytes, checklistPath, checklistBytes };
}

function inspectCarrierBrand(value) {
  if (typeof types.isProxy !== 'function') return null;
  if (types.isProxy(value)) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;

  let byteLength;
  let buffer;
  try {
    byteLength = typedArrayByteLengthGetter.call(value);
    buffer = typedArrayBufferGetter.call(value);
  } catch {
    return null;
  }

  if (typeof buffer !== 'object' || buffer === null) return null;
  try {
    // Intrinsic ArrayBuffer getters reject SharedArrayBuffer and forged brands
    // without consulting user-defined Symbol.toStringTag hooks.
    if (arrayBufferDetachedGetter.call(buffer) === true) return null;
    if (arrayBufferResizableGetter.call(buffer) === true) return null;
    arrayBufferByteLengthGetter.call(buffer);
  } catch {
    return null;
  }

  return { carrier: value, byteLength };
}

function validateTypedArrayOwnKeys(carrier, byteLength) {
  let keys;
  try {
    keys = Reflect.ownKeys(carrier);
  } catch {
    return false;
  }

  if (keys.length !== byteLength) return false;
  for (const key of keys) {
    if (typeof key !== 'string' || !canonicalIndexRe.test(key)) return false;
    const index = Number(key);
    if (index < 0 || index >= byteLength) return false;
    const descriptor = Object.getOwnPropertyDescriptor(carrier, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
    if (descriptor.get || descriptor.set) return false;
  }

  return true;
}

function canonicalizeText(bytes) {
  let text;
  try {
    text = decoder.decode(Uint8Array.prototype.slice.call(bytes));
  } catch {
    return null;
  }
  if (text.includes('\u0000')) return null;
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) return null;
  if (normalized.length === 0) return null;
  return normalized;
}

function parsePath(path, kind) {
  const match = kind === 'spec' ? TASK_PATH_RE.exec(path) : CHECKLIST_PATH_RE.exec(path);
  if (!match) return null;
  return { location: match[1], uuid: match[2], path };
}

function parseArtifactDocument(text, kind, pathInfo) {
  if ((text.match(/<!-- qe-doc-frontmatter/g) || []).length !== 1) return null;

  const lines = text.split('\n');
  if (lines.length < 11) return null;
  if (!H1_RE.test(lines[0] || '')) return null;
  if (lines[1] !== OPENING_MARKER) return null;
  if (lines[10] !== CLOSING_MARKER) return null;

  const [kindLine, uuidLine, planLine, phaseLine, createdLine, statusLine, linksLine, linkItemLine] = lines.slice(2, 10);
  if (kindLine !== `kind: ${kind}`) return null;

  const uuidMatch = uuidLine?.match(/^uuid: ([0-9a-f]{8})$/);
  if (!uuidMatch) return null;

  const planMatch = planLine?.match(/^plan: ([a-z0-9][a-z0-9-]{0,63})$/);
  if (!planMatch) return null;

  const phaseMatch = phaseLine?.match(/^phase: "([^"\\\x00-\x1F]+)"$/);
  if (!phaseMatch || phaseMatch[1].includes('-->')) return null;

  const createdMatch = createdLine?.match(/^created: "(\d{4}-\d{2}-\d{2})"$/);
  if (!createdMatch) return null;

  const statusMatch = statusLine?.match(/^status: (pending|in-progress|completed)$/);
  if (!statusMatch) return null;

  if (linksLine !== 'links:') return null;
  const linkMatch = linkItemLine?.match(/^  - "\[\[(\.qe\/(?:tasks|checklists)\/(?:pending|in-progress|on-hold|completed)\/(?:TASK_REQUEST|VERIFY_CHECKLIST)_[0-9a-f]{8}\.md)\]\]"$/);
  if (!linkMatch) return null;

  const linkInfo = parsePath(linkMatch[1], kind === 'spec' ? 'verify' : 'spec');
  if (!linkInfo) return null;

  try {
    if (extractDocFrontmatter(text).state !== 'valid') return null;
  } catch {
    return null;
  }

  const identity = {
    uuid: uuidMatch[1],
    plan: planMatch[1],
    phase: phaseMatch[1],
    created: createdMatch[1],
  };

  return {
    schema: 1,
    identity,
    location: pathInfo.location,
    linkLocation: linkInfo.location,
    artifact: {
      path: pathInfo.path,
      text,
      byteLength: pathInfo.byteLength,
      kind,
      declaredStatus: statusMatch[1],
      linkPath: linkInfo.path,
    },
  };
}

function counterpartPath(kind, location, uuid) {
  return kind === 'spec'
    ? `.qe/checklists/${location}/VERIFY_CHECKLIST_${uuid}.md`
    : `.qe/tasks/${location}/TASK_REQUEST_${uuid}.md`;
}

export function capturePseArtifactPair(input) {
  const envelope = validateEnvelope(input);
  if (!envelope) return invalidInput();

  const taskBrand = inspectCarrierBrand(envelope.taskBytes);
  if (!taskBrand) return invalidInput();

  const checklistBrand = inspectCarrierBrand(envelope.checklistBytes);
  if (!checklistBrand) return invalidInput();

  if (taskBrand.byteLength === 0) return failure('ARTIFACT_EMPTY');
  if (taskBrand.byteLength > MAX_BYTES) return failure('ARTIFACT_TOO_LARGE');
  if (checklistBrand.byteLength === 0) return failure('ARTIFACT_EMPTY');
  if (checklistBrand.byteLength > MAX_BYTES) return failure('ARTIFACT_TOO_LARGE');

  if (!validateTypedArrayOwnKeys(taskBrand.carrier, taskBrand.byteLength)) return invalidInput();
  if (!validateTypedArrayOwnKeys(checklistBrand.carrier, checklistBrand.byteLength)) return invalidInput();

  const taskText = canonicalizeText(taskBrand.carrier);
  if (taskText === null) return failure('TEXT_INVALID');
  const checklistText = canonicalizeText(checklistBrand.carrier);
  if (checklistText === null) return failure('TEXT_INVALID');

  const taskPathInfo = parsePath(envelope.taskPath, 'spec');
  const checklistPathInfo = parsePath(envelope.checklistPath, 'verify');
  if (!taskPathInfo || !checklistPathInfo) return failure('PATH_INVALID');
  if (taskPathInfo.location !== checklistPathInfo.location) return failure('PAIR_BINDING_INVALID');
  if (taskPathInfo.uuid !== checklistPathInfo.uuid) return failure('PAIR_BINDING_INVALID');

  const taskDoc = parseArtifactDocument(taskText, 'spec', {
    ...taskPathInfo,
    byteLength: taskBrand.byteLength,
  });
  if (!taskDoc) return failure('FRONTMATTER_INVALID');

  const checklistDoc = parseArtifactDocument(checklistText, 'verify', {
    ...checklistPathInfo,
    byteLength: checklistBrand.byteLength,
  });
  if (!checklistDoc) return failure('FRONTMATTER_INVALID');

  if (
    taskDoc.identity.uuid !== checklistDoc.identity.uuid ||
    taskDoc.identity.uuid !== taskPathInfo.uuid ||
    checklistDoc.identity.uuid !== checklistPathInfo.uuid ||
    taskDoc.identity.plan !== checklistDoc.identity.plan ||
    taskDoc.identity.phase !== checklistDoc.identity.phase ||
    taskDoc.identity.created !== checklistDoc.identity.created ||
    taskDoc.artifact.declaredStatus !== checklistDoc.artifact.declaredStatus ||
    taskDoc.linkLocation !== checklistDoc.linkLocation ||
    taskDoc.artifact.linkPath !== counterpartPath('spec', taskDoc.linkLocation, taskDoc.identity.uuid) ||
    checklistDoc.artifact.linkPath !== counterpartPath('verify', checklistDoc.linkLocation, checklistDoc.identity.uuid)
  ) {
    return failure('PAIR_BINDING_INVALID');
  }

  if (taskDoc.identity.uuid !== taskPathInfo.uuid || checklistDoc.identity.uuid !== checklistPathInfo.uuid) {
    return failure('PAIR_BINDING_INVALID');
  }

  const capture = {
    schema: 1,
    identity: taskDoc.identity,
    location: taskDoc.location,
    linkLocation: taskDoc.linkLocation,
    task: taskDoc.artifact,
    checklist: checklistDoc.artifact,
  };

  deepFreeze(capture);
  return Object.freeze({
    ok: true,
    code: 'CAPTURED',
    capture,
  });
}
