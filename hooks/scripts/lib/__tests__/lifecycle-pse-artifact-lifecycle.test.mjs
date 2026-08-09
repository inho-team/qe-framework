import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import * as identityModule from '../pse-artifact-identity.mjs';

const { identifyPseArtifactPair, comparePseArtifactGenerations } = identityModule;
const encoder = new TextEncoder();
const uuid = 'bbbbbbbb';

function pair({ lane = 'in-progress', status = lane === 'on-hold' ? 'in-progress' : lane,
  taskChecks = [false], checklistChecks = [false, false], taskProse = '', crlf = false, bom = false } = {}) {
  const taskPath = `.qe/tasks/${lane}/TASK_REQUEST_${uuid}.md`;
  const checklistPath = `.qe/checklists/${lane}/VERIFY_CHECKLIST_${uuid}.md`;
  const marker = value => value ? 'x' : ' ';
  let task = `# TASK_REQUEST_${uuid}.md — T\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${checklistPath}]]"\n-->\n${taskProse}\n## 체크리스트\n${taskChecks.map((v, i) => `- [${marker(v)}] task-${i}`).join('\n')}\n`;
  let checklist = `# VERIFY_CHECKLIST_${uuid}.md — V\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [${marker(checklistChecks[0])}] verify-0\n\n## 프레임워크 무결성 체크\n${checklistChecks.slice(1).map((v, i) => `- [${marker(v)}] wire-${i}`).join('\n')}\n`;
  if (crlf) { task = task.replaceAll('\n', '\r\n'); checklist = checklist.replaceAll('\n', '\r\n'); }
  if (bom) { task = `\uFEFF${task}`; checklist = `\uFEFF${checklist}`; }
  return { taskPath, taskBytes: encoder.encode(task), checklistPath, checklistBytes: encoder.encode(checklist) };
}

const compare = (before, after, resume = null) => {
  assert.equal(typeof comparePseArtifactGenerations, 'function', 'ABSENT_EXPORT');
  return comparePseArtifactGenerations({ before, after, resume });
};

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value); assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test('exports the pure comparator and returns the exact fresh frozen success projection', () => {
  const before = pair();
  const after = pair({ taskChecks: [true] });
  const result = compare(before, after);
  const beforeIdentity = identifyPseArtifactPair(before).identity;
  const afterIdentity = identifyPseArtifactPair(after).identity;
  assert.deepEqual(result, { ok: true, code: 'CONSISTENT', consistency: {
    schema: 1, beforeClass: 'active', afterClass: 'active', transition: 'STAY_ACTIVE',
    taskChecks: [true], checklistChecks: [false, false],
    beforePairDigest: beforeIdentity.pairDigest, afterPairDigest: afterIdentity.pairDigest,
    authoritative: false,
  } });
  assert.deepEqual(Object.keys(result.consistency), ['schema', 'beforeClass', 'afterClass', 'transition', 'taskChecks', 'checklistChecks', 'beforePairDigest', 'afterPairDigest', 'authoritative']);
  assert.notEqual(result.consistency.taskChecks, result.consistency.checklistChecks);
  assertDeepFrozen(result);
});

test('accepts only the exact class and transition matrix with frozen held/completed vectors', () => {
  const cases = [
    ['pending', 'pending', 'pending', 'pending', 'STAY_PENDING'],
    ['pending', 'pending', 'in-progress', 'in-progress', 'ADVANCE_TO_ACTIVE'],
    ['in-progress', 'in-progress', 'in-progress', 'in-progress', 'STAY_ACTIVE'],
    ['in-progress', 'in-progress', 'on-hold', 'in-progress', 'HOLD'],
    ['on-hold', 'in-progress', 'on-hold', 'in-progress', 'STAY_HELD'],
    ['in-progress', 'in-progress', 'completed', 'completed', 'COMPLETE'],
    ['completed', 'completed', 'completed', 'completed', 'STAY_COMPLETED'],
  ];
  for (const [aLane, aStatus, bLane, bStatus, token] of cases) {
    const all = token.includes('COMPLETE') ? [true, true] : [false, false];
    const result = compare(pair({ lane: aLane, status: aStatus, taskChecks: [all[0]], checklistChecks: all }), pair({ lane: bLane, status: bStatus, taskChecks: [all[0]], checklistChecks: all }));
    assert.equal(result.consistency.transition, token);
  }
  assert.equal(compare(pair({ lane: 'on-hold' }), pair({ lane: 'on-hold', taskChecks: [true] })).code, 'LIFECYCLE_REGRESSION');
  assert.equal(compare(pair({ lane: 'completed', status: 'completed' }), pair({ lane: 'completed', status: 'completed', taskChecks: [true], checklistChecks: [true, true] })).code, 'LIFECYCLE_REGRESSION');
  assert.equal(compare(pair(), pair({ lane: 'completed', status: 'completed', taskChecks: [true], checklistChecks: [true, true] })).code, 'LIFECYCLE_REGRESSION');
});

test('validates bounded held resume snapshots without granting authority', () => {
  const held = pair({ lane: 'on-hold', taskChecks: [true], checklistChecks: [false, true] });
  const active = pair({ taskChecks: [true], checklistChecks: [false, true] });
  const resume = { class: 'on-hold', taskChecks: [true], checklistChecks: [false, true] };
  const result = compare(held, active, resume);
  assert.equal(result.consistency.transition, 'RESUME');
  assert.equal(result.consistency.authoritative, false);
  assert.equal(Object.isFrozen(resume), false);
  assert.notEqual(result.consistency.taskChecks, resume.taskChecks);
  assert.equal(compare(held, active, { ...resume, taskChecks: [false] }).code, 'RESUME_INCONSISTENT');
  assert.equal(compare(pair(), pair(), resume).code, 'RESUME_INCONSISTENT');
  assert.equal(compare(held, active, { class: 'on-hold', taskChecks: Array(1999).fill(false), checklistChecks: [false] }).code, 'RESUME_INCONSISTENT');
  assert.equal(compare(held, active, { class: 'on-hold', taskChecks: Array(2000).fill(false), checklistChecks: [false] }).code, 'GENERATION_INVALID');
  const hugeSparse = []; hugeSparse.length = 2001;
  assert.equal(compare(held, active, { class: 'on-hold', taskChecks: hugeSparse, checklistChecks: [] }).code, 'GENERATION_INVALID');
});

test('neutralizes only validated lifecycle spans and required marker offsets', () => {
  const pending = pair({ lane: 'pending', status: 'pending' });
  const active = pair();
  assert.equal(compare(pending, active).consistency.transition, 'ADVANCE_TO_ACTIVE');
  const proseA = pair({ taskProse: '\n## Notes\n- [ ] prose status: pending .qe/tasks/pending/x\n' });
  const proseB = pair({ taskProse: '\n## Notes\n- [x] prose status: in-progress .qe/tasks/in-progress/x\n' });
  assert.equal(compare(proseA, proseB).code, 'IDENTITY_MISMATCH');
  assert.equal(compare(pair({ crlf: true }), pair()).code, 'CONSISTENT');
  assert.equal(compare(pair({ bom: true }), pair()).code, 'FRONTMATTER_INVALID');
  assert.equal(compare(pair({ taskProse: '\né\n' }), pair({ taskProse: '\ne\u0301\n' })).code, 'IDENTITY_MISMATCH');
  assert.equal(compare(pair({ taskProse: '\n😀\n' }), pair({ taskProse: '\n😀\n', taskChecks: [true] })).code, 'CONSISTENT');
});

test('pins descriptor grammar, caps, aliases, and total comparator precedence', () => {
  let getterCalls = 0;
  const accessor = { after: pair(), resume: null };
  Object.defineProperty(accessor, 'before', { enumerable: true, get() { getterCalls += 1; return pair(); } });
  assert.equal(comparePseArtifactGenerations(accessor).code, 'GENERATION_INVALID');
  assert.equal(getterCalls, 0);
  assert.equal(comparePseArtifactGenerations({ before: pair(), after: pair(), resume: null, extra: true }).code, 'GENERATION_INVALID');
  const same = pair();
  assert.equal(compare(same, same).code, 'CONSISTENT');
  const aliased = [true, true];
  const resume = { class: 'on-hold', taskChecks: aliased, checklistChecks: aliased };
  const aliasResult = compare(pair({ lane: 'on-hold', taskChecks: [true, true], checklistChecks: [true, true] }), pair({ taskChecks: [true, true], checklistChecks: [true, true] }), resume);
  assert.equal(aliasResult.code, 'CONSISTENT');
  assert.notEqual(aliasResult.consistency.taskChecks, aliasResult.consistency.checklistChecks);
  assert.notEqual(aliasResult.consistency.taskChecks, aliased);
  const transparent = new Proxy({ before: same, after: same, resume: null }, {});
  assert.equal(comparePseArtifactGenerations(transparent).code, 'CONSISTENT');
  const throwing = new Proxy({}, { ownKeys() { throw new Error('caller trap'); } });
  assert.equal(comparePseArtifactGenerations(throwing).code, 'GENERATION_INVALID');
  const driftAndBadClass = pair({ lane: 'pending', status: 'completed', taskProse: '\ndrift\n' });
  assert.equal(compare(pair(), driftAndBadClass).code, 'IDENTITY_MISMATCH');
  const invalidClass = pair({ lane: 'pending', status: 'completed' });
  assert.equal(compare(pair(), invalidClass).code, 'GENERATION_INVALID');
});

test('runtime loader proves capture order, exact failure reference, and short-circuit', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'pse-lifecycle-loader-'));
  try {
    const loader = resolve(dir, 'loader.mjs');
    writeFileSync(loader, `export async function resolve(specifier, context, next) {
      if (context.parentURL?.endsWith('/pse-artifact-identity.mjs') && specifier === './pse-artifact-capture.mjs') return {url:'data:text/javascript,'+encodeURIComponent('export function capturePseArtifactPair(input){globalThis.calls.push(input);return globalThis.failure}'),shortCircuit:true};
      return next(specifier, context);
    }`);
    const moduleUrl = new URL('../pse-artifact-identity.mjs', import.meta.url).href;
    const code = `globalThis.calls=[];globalThis.failure=Object.freeze({ok:false,code:'SENTINEL'});const m=await import(${JSON.stringify(moduleUrl)});const before=Object.freeze({a:1});const after=Object.freeze({b:2});const result=m.comparePseArtifactGenerations({before,after,resume:null});console.log(JSON.stringify({same:result===globalThis.failure,count:globalThis.calls.length,first:globalThis.calls[0]===before}));`;
    const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', loader, '--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { same: true, count: 1, first: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
