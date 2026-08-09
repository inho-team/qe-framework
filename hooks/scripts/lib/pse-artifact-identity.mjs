import { createHash } from 'node:crypto';
import { capturePseArtifactPair } from './pse-artifact-capture.mjs';

const TASK_SECTION = '## 체크리스트';
const CHECK_SECTIONS = ['## 검증 기준', '## 프레임워크 무결성 체크'];
const H2_RE = /^## [^ \t](?:.*[^ \t])?$/;
const ITEM_RE = /^- \[[ x]\] /;

const hashTuple = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = code => Object.freeze({ ok: false, code });
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function commentTransition(line, initialOpen) {
  let open = initialOpen; let grammar = false; let index = 0;
  while (index < line.length) {
    const nextOpen = line.indexOf('<!--', index);
    const nextClose = line.indexOf('-->', index);
    if (nextOpen < 0 && nextClose < 0) break;
    if (nextOpen >= 0 && (nextClose < 0 || nextOpen < nextClose)) {
      if (!open) open = true;
      index = nextOpen + 4;
    } else {
      if (open) open = false;
      else grammar = true;
      index = nextClose + 3;
    }
  }
  return { open, grammar };
}

function scan(text, kind) {
  const required = kind === 'task' ? [TASK_SECTION] : CHECK_SECTIONS;
  const requiredSet = new Set(required);
  const seenRequired = new Map(required.map(section => [section, 0]));
  const output = new Map(required.map(section => [section, []]));
  const checks = new Map(required.map(section => [section, []]));
  const markerOffsets = new Map(required.map(section => [section, []]));
  let currentSection = null; let commentOpen = false; let fence = null;
  let h2Count = 0; let candidateCount = 0; let grammar = false;

  let lineStart = 0;
  for (const line of text.split('\n')) {
    const currentLineStart = lineStart;
    lineStart += line.length + 1;
    if (fence) {
      const match = fence.char === '`' ? /^(`+)[ \t]*$/.exec(line) : /^(~+)[ \t]*$/.exec(line);
      if (match && match[1].length >= fence.length) fence = null;
      continue;
    }
    if (commentOpen) {
      const transition = commentTransition(line, true);
      commentOpen = transition.open; grammar ||= transition.grammar;
      continue;
    }
    if (line.includes('<!--') || line.includes('-->')) {
      const transition = commentTransition(line, false);
      commentOpen = transition.open; grammar ||= transition.grammar;
      continue;
    }
    const backticks = /^(`{3,})([^`]*)$/.exec(line);
    const tildes = /^(~{3,})(.*)$/.exec(line);
    if (backticks || tildes) {
      const opener = backticks || tildes;
      fence = { char: opener[1][0], length: opener[1].length };
      continue;
    }
    if (H2_RE.test(line)) {
      h2Count += 1; currentSection = line;
      if (requiredSet.has(line)) seenRequired.set(line, seenRequired.get(line) + 1);
      continue;
    }
    if (ITEM_RE.test(line)) {
      candidateCount += 1;
      const content = line.slice(6);
      const validContent = /[^ \t]/.test(content);
      if (!validContent) grammar = true;
      if (validContent && requiredSet.has(currentSection)) {
        output.get(currentSection).push(content);
        checks.get(currentSection).push(line[3] === 'x');
        markerOffsets.get(currentSection).push(currentLineStart + 3);
      }
    }
  }

  if (commentOpen || fence) grammar = true;
  if (required.some(section => seenRequired.get(section) !== 1 || output.get(section).length === 0)) grammar = true;
  if (kind === 'checklist') {
    const visible = [];
    for (const line of text.split('\n')) if (H2_RE.test(line) && requiredSet.has(line)) visible.push(line);
    if (visible.length !== 2 || visible[0] !== CHECK_SECTIONS[0] || visible[1] !== CHECK_SECTIONS[1]) grammar = true;
  }
  return { h2Count, candidateCount, grammar, output, checks, markerOffsets };
}

function itemIdentities(kind, sections, output) {
  const items = [];
  for (const section of sections) {
    output.get(section).forEach((content, ordinal) => {
      items.push({ section, ordinal,
        digest: hashTuple(['qe-pse-item-identity-v1', kind, section, ordinal, content]) });
    });
  }
  return items;
}

function analyzeCapturedPair(capture) {
  const lineCount = capture.task.text.split('\n').length + capture.checklist.text.split('\n').length;
  if (lineCount > 20_000) return { result: failure('IDENTITY_LIMIT_EXCEEDED') };
  const taskScan = scan(capture.task.text, 'task');
  const checklistScan = scan(capture.checklist.text, 'checklist');
  if (taskScan.h2Count + checklistScan.h2Count > 64
    || taskScan.candidateCount + checklistScan.candidateCount > 2_000) {
    return { result: failure('IDENTITY_LIMIT_EXCEEDED') };
  }
  if (taskScan.grammar || checklistScan.grammar) return { result: failure('GRAMMAR_INVALID') };

  const taskItems = itemIdentities('spec', [TASK_SECTION], taskScan.output);
  const checklistItems = itemIdentities('verify', CHECK_SECTIONS, checklistScan.output);
  const taskDocumentDigest = hashTuple(['qe-pse-document-identity-v1', 'spec', capture.task.path, capture.task.text]);
  const checklistDocumentDigest = hashTuple(['qe-pse-document-identity-v1', 'verify', capture.checklist.path, capture.checklist.text]);
  const captureIdentity = { uuid: capture.identity.uuid, plan: capture.identity.plan,
    phase: capture.identity.phase, created: capture.identity.created };
  const pairDigest = hashTuple(['qe-pse-pair-identity-v1',
    [captureIdentity.uuid, captureIdentity.plan, captureIdentity.phase, captureIdentity.created],
    taskDocumentDigest, checklistDocumentDigest,
    taskItems.map(item => item.digest), checklistItems.map(item => item.digest)]);
  const result = deepFreeze({ ok: true, code: 'IDENTIFIED', identity: {
    schema: 1, captureIdentity,
    task: { documentDigest: taskDocumentDigest, items: taskItems },
    checklist: { documentDigest: checklistDocumentDigest, items: checklistItems }, pairDigest,
  } });
  return { result, taskScan, checklistScan };
}

export function identifyPseArtifactPair(input) {
  const captured = capturePseArtifactPair(input);
  if (!captured.ok) return captured;
  return analyzeCapturedPair(captured.capture).result;
}

function exactDataRecord(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key, index) => key !== keys[index])) return null;
    const values = {};
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch { return null; }
}

function booleanVector(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!Number.isInteger(length) || length < 0 || length > 2_000) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys[length] !== 'length') return null;
    const copy = [];
    for (let index = 0; index < length; index += 1) {
      if (keys[index] !== String(index)) return null;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'boolean') return null;
      copy.push(descriptor.value);
    }
    return copy;
  } catch { return null; }
}

function validateComparatorInput(input) {
  const wrapper = exactDataRecord(input, ['before', 'after', 'resume']);
  if (!wrapper) return null;
  if (wrapper.resume === null) return { ...wrapper, resume: null };
  const resume = exactDataRecord(wrapper.resume, ['class', 'taskChecks', 'checklistChecks']);
  if (!resume || resume.class !== 'on-hold') return null;
  const taskChecks = booleanVector(resume.taskChecks);
  const checklistChecks = booleanVector(resume.checklistChecks);
  if (!taskChecks || !checklistChecks || taskChecks.length + checklistChecks.length > 2_000) return null;
  return { ...wrapper, resume: { class: 'on-hold', taskChecks, checklistChecks } };
}

function flatten(map, sections) {
  return sections.flatMap(section => map.get(section));
}

function replaceOffsets(text, offsets) {
  const chars = text.split('');
  for (const offset of offsets) chars[offset] = '?';
  return chars.join('');
}

function normalizedDocument(capture, artifact, scan, sections) {
  const text = replaceOffsets(artifact.text, flatten(scan.markerOffsets, sections));
  const lines = text.split('\n');
  lines[7] = 'status: <lifecycle-status>';
  lines[9] = artifact.kind === 'spec'
    ? `  - "[[.qe/checklists/<lifecycle-lane>/VERIFY_CHECKLIST_${capture.identity.uuid}.md]]"`
    : `  - "[[.qe/tasks/<lifecycle-lane>/TASK_REQUEST_${capture.identity.uuid}.md]]"`;
  const basename = artifact.path.slice(artifact.path.lastIndexOf('/') + 1);
  return JSON.stringify([artifact.kind, basename, lines.join('\n')]);
}

function generationProjection(capture, analysis) {
  return {
    taskChecks: flatten(analysis.taskScan.checks, [TASK_SECTION]),
    checklistChecks: flatten(analysis.checklistScan.checks, CHECK_SECTIONS),
    immutable: JSON.stringify([
      analysis.result.identity.captureIdentity,
      analysis.result.identity.task.items,
      analysis.result.identity.checklist.items,
      normalizedDocument(capture, capture.task, analysis.taskScan, [TASK_SECTION]),
      normalizedDocument(capture, capture.checklist, analysis.checklistScan, CHECK_SECTIONS),
    ]),
    pairDigest: analysis.result.identity.pairDigest,
  };
}

export function projectPseImmutableGeneration(input) {
  const captured = capturePseArtifactPair(input);
  if (!captured.ok) return captured;
  const analysis = analyzeCapturedPair(captured.capture);
  if (!analysis.result.ok) return analysis.result;
  const projected = generationProjection(captured.capture, analysis);
  const [captureIdentity, taskItems, checklistItems, normalizedTaskDocument,
    normalizedChecklistDocument] = JSON.parse(projected.immutable);
  const immutableDigest = hashTuple(['qe-pse-immutable-generation-v1', captureIdentity,
    taskItems, checklistItems, normalizedTaskDocument, normalizedChecklistDocument]);
  return deepFreeze({ ok: true, code: 'IMMUTABLE_PROJECTED', projection: {
    schema: 1, captureIdentity, taskItems, checklistItems, immutableDigest,
  } });
}

function classifyGeneration(capture) {
  const status = capture.task.declaredStatus;
  if (status !== capture.checklist.declaredStatus) return null;
  const tuple = `${capture.location}|${capture.linkLocation}|${status}`;
  return ({
    'pending|pending|pending': 'pending',
    'in-progress|in-progress|in-progress': 'active',
    'on-hold|on-hold|in-progress': 'held',
    'completed|completed|completed': 'completed',
  })[tuple] || null;
}

const TRANSITIONS = Object.freeze({
  'pending>pending': 'STAY_PENDING', 'pending>active': 'ADVANCE_TO_ACTIVE',
  'active>active': 'STAY_ACTIVE', 'active>held': 'HOLD',
  'held>held': 'STAY_HELD', 'held>active': 'RESUME',
  'active>completed': 'COMPLETE', 'completed>completed': 'STAY_COMPLETED',
});

const equalVector = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const monotonicVector = (left, right) => left.length === right.length && left.every((value, index) => !value || right[index]);
const allTrue = vector => vector.every(Boolean);

export function comparePseArtifactGenerations(input) {
  const validated = validateComparatorInput(input);
  if (!validated) return failure('GENERATION_INVALID');

  const beforeCapture = capturePseArtifactPair(validated.before);
  if (!beforeCapture.ok) return beforeCapture;
  const beforeAnalysis = analyzeCapturedPair(beforeCapture.capture);
  if (!beforeAnalysis.result.ok) return beforeAnalysis.result;

  const afterCapture = capturePseArtifactPair(validated.after);
  if (!afterCapture.ok) return afterCapture;
  const afterAnalysis = analyzeCapturedPair(afterCapture.capture);
  if (!afterAnalysis.result.ok) return afterAnalysis.result;

  const before = generationProjection(beforeCapture.capture, beforeAnalysis);
  const after = generationProjection(afterCapture.capture, afterAnalysis);
  if (before.immutable !== after.immutable) return failure('IDENTITY_MISMATCH');

  const beforeClass = classifyGeneration(beforeCapture.capture);
  const afterClass = classifyGeneration(afterCapture.capture);
  if (!beforeClass || !afterClass) return failure('GENERATION_INVALID');
  const transition = TRANSITIONS[`${beforeClass}>${afterClass}`];
  if (!transition) return failure('LIFECYCLE_REGRESSION');

  const taskEqual = equalVector(before.taskChecks, after.taskChecks);
  const checklistEqual = equalVector(before.checklistChecks, after.checklistChecks);
  let lifecycleValid;
  if (transition === 'STAY_PENDING' || transition === 'STAY_ACTIVE') {
    lifecycleValid = monotonicVector(before.taskChecks, after.taskChecks)
      && monotonicVector(before.checklistChecks, after.checklistChecks);
  } else lifecycleValid = taskEqual && checklistEqual;
  if (beforeClass === 'completed' && (!allTrue(before.taskChecks) || !allTrue(before.checklistChecks))) lifecycleValid = false;
  if (afterClass === 'completed' && (!allTrue(after.taskChecks) || !allTrue(after.checklistChecks))) lifecycleValid = false;
  if (!lifecycleValid) return failure('LIFECYCLE_REGRESSION');

  if (transition === 'RESUME') {
    const resume = validated.resume;
    if (!resume || !equalVector(resume.taskChecks, before.taskChecks)
      || !equalVector(resume.checklistChecks, before.checklistChecks)) return failure('RESUME_INCONSISTENT');
  } else if (validated.resume !== null) return failure('RESUME_INCONSISTENT');

  return deepFreeze({ ok: true, code: 'CONSISTENT', consistency: {
    schema: 1, beforeClass, afterClass, transition,
    taskChecks: [...after.taskChecks], checklistChecks: [...after.checklistChecks],
    beforePairDigest: before.pairDigest, afterPairDigest: after.pairDigest, authoritative: false,
  } });
}
