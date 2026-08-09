import test from 'node:test';
import assert from 'node:assert/strict';

import * as captureModule from '../pse-artifact-capture.mjs';

const { capturePseArtifactPair } = captureModule;

const encoder = new TextEncoder();

function bytes(text) {
  return encoder.encode(text);
}

function taskDoc({ uuid, plan, phase, created, status, linkPath, title = 'Capture Pair' }) {
  return `# TASK_REQUEST_${uuid}.md — ${title}\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: ${plan}\nphase: "${phase}"\ncreated: "${created}"\nstatus: ${status}\nlinks:\n  - "[[${linkPath}]]"\n-->\n\n## 무엇을 원하는가?\n\nBody.\n`;
}

function checklistDoc({ uuid, plan, phase, created, status, linkPath, title = 'Capture Pair' }) {
  return `# VERIFY_CHECKLIST_${uuid}.md — ${title}\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: ${plan}\nphase: "${phase}"\ncreated: "${created}"\nstatus: ${status}\nlinks:\n  - "[[${linkPath}]]"\n-->\n\n## 검증 기준\n\n- [ ] Body.\n`;
}

function validPair(overrides = {}) {
  const uuid = overrides.uuid ?? '08c744cb';
  const plan = overrides.plan ?? 'runtime-controller-lifecycle-10';
  const phase = overrides.phase ?? 'Phase 1 — Artifact Identity Foundation / G001';
  const created = overrides.created ?? '2026-08-06';
  const status = overrides.status ?? 'in-progress';
  const taskPath = overrides.taskPath ?? `.qe/tasks/${status}/TASK_REQUEST_${uuid}.md`;
  const checklistPath = overrides.checklistPath ?? `.qe/checklists/${status}/VERIFY_CHECKLIST_${uuid}.md`;
  const linkLocation = overrides.linkLocation ?? status;
  const taskText = taskDoc({
    uuid,
    plan,
    phase,
    created,
    status,
    linkPath: `.qe/checklists/${linkLocation}/VERIFY_CHECKLIST_${uuid}.md`,
  });
  const checklistText = checklistDoc({
    uuid,
    plan,
    phase,
    created,
    status,
    linkPath: `.qe/tasks/${linkLocation}/TASK_REQUEST_${uuid}.md`,
  });
  return {
    input: {
      taskPath,
      taskBytes: bytes(taskText),
      checklistPath,
      checklistBytes: bytes(checklistText),
    },
    taskText,
    checklistText,
    uuid,
    plan,
    phase,
    created,
    status,
    taskPath,
    checklistPath,
    linkLocation,
  };
}

test('captures a valid pair into a frozen detached projection', () => {
  assert.deepEqual(Object.keys(captureModule), ['capturePseArtifactPair']);
  const fixture = validPair();
  const result = capturePseArtifactPair(fixture.input);

  assert.deepEqual(result, {
    ok: true,
    code: 'CAPTURED',
    capture: {
      schema: 1,
      identity: {
        uuid: fixture.uuid,
        plan: fixture.plan,
        phase: fixture.phase,
        created: fixture.created,
      },
      location: 'in-progress',
      linkLocation: fixture.linkLocation,
      task: {
        path: fixture.taskPath,
        text: fixture.taskText.replace(/\r\n/g, '\n'),
        byteLength: fixture.input.taskBytes.byteLength,
        kind: 'spec',
        declaredStatus: fixture.status,
        linkPath: `.qe/checklists/${fixture.linkLocation}/VERIFY_CHECKLIST_${fixture.uuid}.md`,
      },
      checklist: {
        path: fixture.checklistPath,
        text: fixture.checklistText.replace(/\r\n/g, '\n'),
        byteLength: fixture.input.checklistBytes.byteLength,
        kind: 'verify',
        declaredStatus: fixture.status,
        linkPath: `.qe/tasks/${fixture.linkLocation}/TASK_REQUEST_${fixture.uuid}.md`,
      },
    },
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.capture), true);
  assert.equal(Object.isFrozen(result.capture.identity), true);
  assert.equal(Object.isFrozen(result.capture.task), true);
  assert.equal(Object.isFrozen(result.capture.checklist), true);
  assert.equal(Object.getPrototypeOf(result.capture), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);

  fixture.input.taskBytes[0] = 0x78;
  assert.equal(result.capture.task.text.startsWith('# TASK_REQUEST_08c744cb.md'), true);
});

test('rejects proxies, extra keys, and coercion side effects as INVALID_INPUT', () => {
  const fixture = validPair();
  const proxy = new Proxy(fixture.input, {});
  assert.deepEqual(capturePseArtifactPair(proxy), { ok: false, code: 'INVALID_INPUT' });

  const extra = { ...fixture.input, extra: 1 };
  assert.deepEqual(capturePseArtifactPair(extra), { ok: false, code: 'INVALID_INPUT' });

  let coerced = 0;
  const sideEffect = {
    toString() {
      coerced += 1;
      return fixture.taskPath;
    },
  };
  const envelope = {
    taskPath: sideEffect,
    taskBytes: fixture.input.taskBytes,
    checklistPath: sideEffect,
    checklistBytes: fixture.input.checklistBytes,
  };
  assert.deepEqual(capturePseArtifactPair(envelope), { ok: false, code: 'INVALID_INPUT' });
  assert.equal(coerced, 0);
});

test('honors compound precedence before checklist brand and oversize before expando checks', () => {
  const emptyTask = bytes('');
  const invalidChecklist = new Proxy(bytes('x'), {});
  assert.deepEqual(capturePseArtifactPair({
    taskPath: '.qe/tasks/pending/TASK_REQUEST_08c744cb.md',
    taskBytes: emptyTask,
    checklistPath: '.qe/checklists/pending/VERIFY_CHECKLIST_08c744cb.md',
    checklistBytes: invalidChecklist,
  }), { ok: false, code: 'INVALID_INPUT' });

  const oversized = bytes('x'.repeat(1024 * 1024 + 1));
  oversized.foo = 1;
  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    taskBytes: oversized,
  }), { ok: false, code: 'ARTIFACT_TOO_LARGE' });

  const emptyChecklist = bytes('');
  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    checklistBytes: emptyChecklist,
  }), { ok: false, code: 'ARTIFACT_EMPTY' });

  const oversizedChecklist = bytes('x'.repeat(1024 * 1024 + 1));
  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    checklistBytes: oversizedChecklist,
  }), { ok: false, code: 'ARTIFACT_TOO_LARGE' });

  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    taskBytes: oversized,
    checklistBytes: emptyChecklist,
  }), { ok: false, code: 'ARTIFACT_TOO_LARGE' });

  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    taskBytes: emptyTask,
    checklistBytes: oversizedChecklist,
  }), { ok: false, code: 'ARTIFACT_EMPTY' });

  assert.deepEqual(capturePseArtifactPair({
    ...validPair().input,
    taskBytes: bytes('x'),
  }), { ok: false, code: 'FRONTMATTER_INVALID' });
});

test('rejects BOM-preserved frontmatter and stray CR text as the documented codes', () => {
  const fixture = validPair();
  const bomTask = bytes(`\uFEFF${fixture.taskText}`);
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: bomTask,
  }), { ok: false, code: 'FRONTMATTER_INVALID' });

  const strayCr = bytes(fixture.taskText.replace('Body.\n', 'Body.\r'));
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: strayCr,
  }), { ok: false, code: 'TEXT_INVALID' });
});

test('captures on-hold lanes while preserving sticky declared status and pair links', () => {
  const fixture = validPair({
    status: 'completed',
    taskPath: '.qe/tasks/on-hold/TASK_REQUEST_08c744cb.md',
    checklistPath: '.qe/checklists/on-hold/VERIFY_CHECKLIST_08c744cb.md',
    linkLocation: 'on-hold',
  });
  const result = capturePseArtifactPair(fixture.input);

  assert.equal(result.ok, true);
  assert.equal(result.capture.location, 'on-hold');
  assert.equal(result.capture.linkLocation, 'on-hold');
  assert.equal(result.capture.task.declaredStatus, 'completed');
  assert.equal(result.capture.checklist.declaredStatus, 'completed');

  const producerGuidance = validPair({
    status: 'pending',
    taskPath: '.qe/tasks/on-hold/TASK_REQUEST_08c744cb.md',
    checklistPath: '.qe/checklists/on-hold/VERIFY_CHECKLIST_08c744cb.md',
    linkLocation: 'on-hold',
  });
  assert.equal(capturePseArtifactPair(producerGuidance.input).ok, true);
});

test('rejects mismatched counterpart links and duplicate frontmatter markers', () => {
  const fixture = validPair();
  const mismatched = bytes(fixture.taskText.replace(
    '.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md',
    '.qe/checklists/in-progress/VERIFY_CHECKLIST_deadbeef.md',
  ));
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: mismatched,
  }), { ok: false, code: 'PAIR_BINDING_INVALID' });

  const duplicated = bytes(`${fixture.taskText}\n<!-- qe-doc-frontmatter\nkind: spec\n-->`);
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: duplicated,
  }), { ok: false, code: 'FRONTMATTER_INVALID' });
});

test('accepts numeric-only identity strings and canonicalizes CRLF text', () => {
  const fixture = validPair({
    uuid: '00000000',
    plan: '12345678',
    taskPath: '.qe/tasks/completed/TASK_REQUEST_00000000.md',
    checklistPath: '.qe/checklists/completed/VERIFY_CHECKLIST_00000000.md',
    status: 'completed',
  });
  const result = capturePseArtifactPair({
    ...fixture.input,
    taskBytes: bytes(fixture.taskText.replace(/\n/g, '\r\n')),
    checklistBytes: bytes(fixture.checklistText.replace(/\n/g, '\r\n')),
  });

  assert.equal(result.ok, true);
  assert.equal(result.capture.identity.uuid, '00000000');
  assert.equal(result.capture.identity.plan, '12345678');
  assert.equal(result.capture.task.text.includes('\r'), false);
  assert.equal(result.capture.checklist.text.includes('\r'), false);
  assert.equal(result.capture.task.byteLength, bytes(fixture.taskText.replace(/\n/g, '\r\n')).byteLength);
  assert.equal(result.capture.checklist.byteLength, bytes(fixture.checklistText.replace(/\n/g, '\r\n')).byteLength);
});

test('rejects carrier brand spoofing, subclassing, shared backing, detachment, and path variants', () => {
  const fixture = validPair();

  const revocable = Proxy.revocable(fixture.input.taskBytes, {});
  revocable.revoke();
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: revocable.proxy }), { ok: false, code: 'INVALID_INPUT' });

  const hostileBytes = validPair().input.taskBytes;
  let hostileTagReads = 0;
  const hostileEnvelope = { ...fixture.input, taskBytes: hostileBytes };
  Object.defineProperty(hostileBytes.buffer, Symbol.toStringTag, {
    configurable: true,
    get() {
      hostileTagReads += 1;
      hostileEnvelope.taskPath = { toString: () => fixture.taskPath };
      throw new Error('must not execute');
    },
  });
  const hostileResult = capturePseArtifactPair(hostileEnvelope);
  assert.equal(hostileResult.ok, true);
  assert.equal(hostileTagReads, 0);
  assert.equal(typeof hostileResult.capture.task.path, 'string');

  const spoofed = validPair().input.taskBytes;
  Object.defineProperty(spoofed, 'byteLength', { value: 999 });
  Object.defineProperty(spoofed, 'buffer', { value: new ArrayBuffer(1) });
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: spoofed }), { ok: false, code: 'INVALID_INPUT' });

  const bufferCarrier = Buffer.from(fixture.taskText, 'utf8');
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: bufferCarrier }), { ok: false, code: 'INVALID_INPUT' });

  class CustomBytes extends Uint8Array {}
  const subclassCarrier = new CustomBytes(bytes(fixture.taskText));
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: subclassCarrier }), { ok: false, code: 'INVALID_INPUT' });

  const sharedCarrier = new Uint8Array(new SharedArrayBuffer(16));
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: sharedCarrier }), { ok: false, code: 'INVALID_INPUT' });

  const detachedBuffer = new ArrayBuffer(16);
  const detachedCarrier = new Uint8Array(detachedBuffer);
  detachedBuffer.transfer();
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: detachedCarrier }), { ok: false, code: 'INVALID_INPUT' });

  const resizableCarrier = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 32 }));
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: resizableCarrier }), { ok: false, code: 'INVALID_INPUT' });

  let accessed = 0;
  const accessorEnvelope = {
    get taskPath() { accessed += 1; return fixture.taskPath; },
    taskBytes: fixture.input.taskBytes,
    checklistPath: fixture.checklistPath,
    checklistBytes: fixture.input.checklistBytes,
  };
  assert.deepEqual(capturePseArtifactPair(accessorEnvelope), { ok: false, code: 'INVALID_INPUT' });
  assert.equal(accessed, 0);

  const symbolEnvelope = { ...fixture.input, [Symbol('extra')]: 1 };
  assert.deepEqual(capturePseArtifactPair(symbolEnvelope), { ok: false, code: 'INVALID_INPUT' });

  const boundedExpando = validPair().input.taskBytes;
  boundedExpando.extra = true;
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: boundedExpando }), { ok: false, code: 'INVALID_INPUT' });

  const boundedSymbol = validPair().input.taskBytes;
  boundedSymbol[Symbol('extra')] = true;
  assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskBytes: boundedSymbol }), { ok: false, code: 'INVALID_INPUT' });

  for (const hostilePath of [
    new String(fixture.taskPath),
    new Proxy({ toString: () => fixture.taskPath }, {}),
    { [Symbol.toPrimitive]: () => fixture.taskPath },
  ]) {
    assert.deepEqual(capturePseArtifactPair({ ...fixture.input, taskPath: hostilePath }), { ok: false, code: 'INVALID_INPUT' });
  }

  const absPath = capturePseArtifactPair({
    ...fixture.input,
    taskPath: '/abs/TASK_REQUEST_08c744cb.md',
  });
  assert.deepEqual(absPath, { ok: false, code: 'PATH_INVALID' });

  const traversalPath = capturePseArtifactPair({
    ...fixture.input,
    taskPath: '.qe/tasks/in-progress/../pending/TASK_REQUEST_08c744cb.md',
  });
  assert.deepEqual(traversalPath, { ok: false, code: 'PATH_INVALID' });

  const backslashPath = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: '.qe\\checklists\\in-progress\\VERIFY_CHECKLIST_08c744cb.md',
  });
  assert.deepEqual(backslashPath, { ok: false, code: 'PATH_INVALID' });

  const percentPath = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: '.qe/checklists/in-progress/VERIFY_CHECKLIST_%308c744cb.md',
  });
  assert.deepEqual(percentPath, { ok: false, code: 'PATH_INVALID' });

  const unicodeSeparatorPath = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: `.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb\u2215md`,
  });
  assert.deepEqual(unicodeSeparatorPath, { ok: false, code: 'PATH_INVALID' });

  const uppercaseUuidPath = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: '.qe/checklists/in-progress/VERIFY_CHECKLIST_08C744CB.md',
  });
  assert.deepEqual(uppercaseUuidPath, { ok: false, code: 'PATH_INVALID' });

  const foreignBasename = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: '.qe/checklists/in-progress/NOT_A_CHECKLIST_08c744cb.md',
  });
  assert.deepEqual(foreignBasename, { ok: false, code: 'PATH_INVALID' });

  for (const suffix of ['?raw=1', '#fragment']) {
    assert.deepEqual(capturePseArtifactPair({
      ...fixture.input,
      checklistPath: `${fixture.checklistPath}${suffix}`,
    }), { ok: false, code: 'PATH_INVALID' });
  }

  const uuidMismatch = capturePseArtifactPair({
    ...fixture.input,
    checklistPath: '.qe/checklists/in-progress/VERIFY_CHECKLIST_deadbeef.md',
  });
  assert.deepEqual(uuidMismatch, { ok: false, code: 'PAIR_BINDING_INVALID' });
});

test('rejects frontmatter duplicates, unknown keys, bad phases, and invalid UTF-8', () => {
  const fixture = validPair();

  const duplicateKey = bytes(fixture.taskText.replace(
    'status: in-progress\nlinks:',
    'status: in-progress\nstatus: completed\nlinks:',
  ));
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: duplicateKey,
  }), { ok: false, code: 'FRONTMATTER_INVALID' });

  const unknownKey = bytes(fixture.taskText.replace(
    'status: in-progress\nlinks:',
    'status: in-progress\nfoo: bar\nlinks:',
  ));
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: unknownKey,
  }), { ok: false, code: 'FRONTMATTER_INVALID' });

  const badPhase = bytes(fixture.taskText.replace(
    'phase: "Phase 1 — Artifact Identity Foundation / G001"',
    'phase: "Phase --> break"',
  ));
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: badPhase,
  }), { ok: false, code: 'FRONTMATTER_INVALID' });

  const invalidUtf8 = new Uint8Array([0xff]);
  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: invalidUtf8,
  }), { ok: false, code: 'TEXT_INVALID' });

  assert.deepEqual(capturePseArtifactPair({
    ...fixture.input,
    taskBytes: bytes(fixture.taskText.replace('Body.\n', 'Body.\u0000\n')),
  }), { ok: false, code: 'TEXT_INVALID' });

  const invalidForms = [
    ['# TASK_REQUEST_08c744cb.md — Capture Pair', '#  leading-space'],
    ['-->\n\n## 무엇을 원하는가?', '--> trailing\n\n## 무엇을 원하는가?'],
    ['plan: runtime-controller-lifecycle-10', 'plan: &anchor runtime-controller-lifecycle-10'],
    ['plan: runtime-controller-lifecycle-10', 'plan: *anchor'],
    ['plan: runtime-controller-lifecycle-10', '<<: *anchor'],
    ['phase: "Phase 1 — Artifact Identity Foundation / G001"', 'phase: |\n  multiline'],
    ['links:\n  - "[[.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md]]"', 'links: { nested: true }\n  - "[[.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md]]"'],
  ];
  for (const [before, after] of invalidForms) {
    assert.deepEqual(capturePseArtifactPair({
      ...fixture.input,
      taskBytes: bytes(fixture.taskText.replace(before, after)),
    }), { ok: false, code: 'FRONTMATTER_INVALID' });
  }

  for (const malformedLink of [
    '  - "[.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md]]"',
    '  - "[[.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md]]]"',
    '  - "[[ .qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md ]]"',
  ]) {
    assert.deepEqual(capturePseArtifactPair({
      ...fixture.input,
      taskBytes: bytes(fixture.taskText.replace(
        '  - "[[.qe/checklists/in-progress/VERIFY_CHECKLIST_08c744cb.md]]"',
        malformedLink,
      )),
    }), { ok: false, code: 'FRONTMATTER_INVALID' });
  }
});

test('accepts the exact 1 MiB task boundary without truncating raw length', () => {
  const fixture = validPair();
  const base = fixture.taskText;
  const padding = 'x'.repeat((1024 * 1024) - bytes(base).byteLength);
  const taskBytes = bytes(`${base}${padding}`);
  assert.equal(taskBytes.byteLength, 1024 * 1024);

  const result = capturePseArtifactPair({ ...fixture.input, taskBytes });
  assert.equal(result.ok, true);
  assert.equal(result.capture.task.byteLength, 1024 * 1024);
});
