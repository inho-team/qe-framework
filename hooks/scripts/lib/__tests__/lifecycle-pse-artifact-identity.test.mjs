import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseStaticModuleRequests } from '../../../../scripts/lib/pse-capture-attestation.mjs';

let identifyPseArtifactPair;
try {
  ({ identifyPseArtifactPair } = await import('../pse-artifact-identity.mjs'));
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const requireExport = () => assert.equal(typeof identifyPseArtifactPair, 'function', 'ABSENT_EXPORT');
const taskText = Buffer.from('IyBUQVNLX1JFUVVFU1RfYWFhYWFhYWEubWQg4oCUIFYKPCEtLSBxZS1kb2MtZnJvbnRtYXR0ZXIKa2luZDogc3BlYwp1dWlkOiBhYWFhYWFhYQpwbGFuOiBwCnBoYXNlOiAiUCIKY3JlYXRlZDogIjIwMjYtMDgtMDciCnN0YXR1czogaW4tcHJvZ3Jlc3MKbGlua3M6CiAgLSAiW1sucWUvY2hlY2tsaXN0cy9pbi1wcm9ncmVzcy9WRVJJRllfQ0hFQ0tMSVNUX2FhYWFhYWFhLm1kXV0iCi0tPgoKIyMg7LK07YGs66as7Iqk7Yq4CgotIFsgXSBhbHBoYQo=', 'base64').toString();
const checklistText = Buffer.from('IyBWRVJJRllfQ0hFQ0tMSVNUX2FhYWFhYWFhLm1kIOKAlCBWCjwhLS0gcWUtZG9jLWZyb250bWF0dGVyCmtpbmQ6IHZlcmlmeQp1dWlkOiBhYWFhYWFhYQpwbGFuOiBwCnBoYXNlOiAiUCIKY3JlYXRlZDogIjIwMjYtMDgtMDciCnN0YXR1czogaW4tcHJvZ3Jlc3MKbGlua3M6CiAgLSAiW1sucWUvdGFza3MvaW4tcHJvZ3Jlc3MvVEFTS19SRVFVRVNUX2FhYWFhYWFhLm1kXV0iCi0tPgoKIyMg6rKA7KadIOq4sOykgAoKLSBbIF0gYmV0YQoKIyMg7ZSE66CI7J6E7JuM7YGsIOustOqysOyEsSDssrTtgawKCi0gWyBdIGdhbW1hCg==', 'base64').toString();
const encoder = new TextEncoder();
function input(task = taskText, checklist = checklistText) {
  return {
    taskPath: '.qe/tasks/in-progress/TASK_REQUEST_aaaaaaaa.md', taskBytes: encoder.encode(task),
    checklistPath: '.qe/checklists/in-progress/VERIFY_CHECKLIST_aaaaaaaa.md', checklistBytes: encoder.encode(checklist),
  };
}
function replaceAfter(text, heading, body) {
  const at = text.indexOf(heading);
  assert.notEqual(at, -1);
  return `${text.slice(0, at)}${heading}\n${body}`;
}
function assertFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child, seen);
}

test('returns acceptance-owned known-answer identity with exact ordering and freezing', () => {
  requireExport();
  const result = identifyPseArtifactPair(input());
  assert.deepEqual(result, {
    ok: true, code: 'IDENTIFIED', identity: {
      schema: 1, captureIdentity: { uuid: 'aaaaaaaa', plan: 'p', phase: 'P', created: '2026-08-07' },
      task: { documentDigest: 'abf5286d90239c19cbb2d0be85bb7b8860e76851e5d0b0540c546f090ddb2010', items: [
        { section: '## 체크리스트', ordinal: 0, digest: 'a622d1ecbea3ea351a3af70ea206fedeae2a5cb63c0b0883c1a6402cbd854b19' },
      ] },
      checklist: { documentDigest: 'dc4c0af0a12c3a1337377d1302f23ca31411680399a6c0130139966694df398a', items: [
        { section: '## 검증 기준', ordinal: 0, digest: '9251f073ed84baad5d2e5ce946572c7a31b3d5d57d5a1eee64b41d071f9d1171' },
        { section: '## 프레임워크 무결성 체크', ordinal: 0, digest: 'c9768f435da8d62195d4677f2e227eaab96e01f21d2da2caac089a340ca1b636' },
      ] },
      pairDigest: '31ebba417da9e86f1a72db87063cdcf2d29ff3b4fd65b400c4b6ab5df96aed7d',
    },
  });
  assertFrozen(result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('marker completion changes document/pair identity but preserves item identity', () => {
  requireExport();
  const before = identifyPseArtifactPair(input());
  const after = identifyPseArtifactPair(input(taskText.replace('- [ ] alpha', '- [x] alpha')));
  assert.equal(after.identity.task.items[0].digest, before.identity.task.items[0].digest);
  assert.notEqual(after.identity.task.documentDigest, before.identity.task.documentDigest);
  assert.notEqual(after.identity.pairDigest, before.identity.pairDigest);
});

test('enforces global inclusive line, H2, and visible marker caps before grammar', () => {
  requireExport();
  const taskWith = body => replaceAfter(taskText, '## 체크리스트', body);
  const taskPrefix = taskText.slice(0, taskText.indexOf('## 체크리스트'));
  const visibleItems = text => text.split('\n').filter(line => /^- \[[ x]\] /.test(line)).length;
  const withItemTotal = total => {
    const baseline = visibleItems(taskText) + visibleItems(checklistText);
    return `${taskPrefix}${Array.from({ length: total - baseline }, (_, i) => `- [ ] outside${i}`).join('\n')}\n## 체크리스트\n- [ ] alpha\n`;
  };
  for (const [total, code] of [[2000, 'IDENTIFIED'], [2001, 'IDENTITY_LIMIT_EXCEEDED']]) {
    const task = withItemTotal(total);
    assert.equal(visibleItems(task) + visibleItems(checklistText), total);
    assert.equal(identifyPseArtifactPair(input(task)).code, code);
  }
  const emptyAtCap = withItemTotal(2000).replace('- [ ] outside0', '- [ ]  ');
  assert.equal(identifyPseArtifactPair(input(emptyAtCap)).code, 'GRAMMAR_INVALID');
  const emptyOverCap = withItemTotal(2001).replace('- [ ] outside0', '- [ ]  ');
  assert.equal(identifyPseArtifactPair(input(emptyOverCap)).code, 'IDENTITY_LIMIT_EXCEEDED');

  const visibleH2 = text => text.split('\n').filter(line => /^## [^ \t](?:.*[^ \t])?$/.test(line)).length;
  const withH2Total = total => {
    const baseline = visibleH2(taskText) + visibleH2(checklistText);
    return `${taskPrefix}${Array.from({ length: total - baseline }, (_, i) => `## H${i}`).join('\n')}\n## 체크리스트\n- [ ] alpha\n`;
  };
  for (const [total, code] of [[64, 'IDENTIFIED'], [65, 'IDENTITY_LIMIT_EXCEEDED']]) {
    const task = withH2Total(total);
    assert.equal(visibleH2(task) + visibleH2(checklistText), total);
    assert.equal(identifyPseArtifactPair(input(task)).code, code);
  }

  const withLineTotal = total => {
    const prefix = taskText.slice(0, taskText.indexOf('## 체크리스트'));
    const skeleton = `${prefix}## 체크리스트\n- [ ] alpha`;
    const missing = total - skeleton.split('\n').length - checklistText.split('\n').length;
    return `${prefix}${Array.from({ length: missing }, () => 'text').join('\n')}\n## 체크리스트\n- [ ] alpha`;
  };
  for (const [total, code] of [[20_000, 'IDENTIFIED'], [20_001, 'IDENTITY_LIMIT_EXCEEDED']]) {
    const task = withLineTotal(total);
    assert.equal(task.split('\n').length + checklistText.split('\n').length, total);
    assert.equal(identifyPseArtifactPair(input(task)).code, code);
  }
});

test('applies comment/fence state priority, required section order, and exact failure objects', () => {
  requireExport();
  const invalid = [
    replaceAfter(taskText, '## 체크리스트', '<!--\n- [ ] hidden\n'),
    replaceAfter(taskText, '## 체크리스트', '```js\n- [ ] hidden\n'),
    replaceAfter(taskText, '## 체크리스트', '-->\n- [ ] alpha\n'),
    replaceAfter(taskText, '## 체크리스트', '- [ ]  \n'),
    replaceAfter(taskText, '## 체크리스트', '## 체크리스트\n- [ ] duplicate\n'),
  ];
  for (const task of invalid) {
    const result = identifyPseArtifactPair(input(task));
    assert.deepEqual(result, { ok: false, code: 'GRAMMAR_INVALID' });
    assert.deepEqual(Object.keys(result), ['ok', 'code']);
    assertFrozen(result);
  }
  const reversed = checklistText.replace('## 검증 기준', '## TEMP').replace('## 프레임워크 무결성 체크', '## 검증 기준').replace('## TEMP', '## 프레임워크 무결성 체크');
  assert.equal(identifyPseArtifactPair(input(taskText, reversed)).code, 'GRAMMAR_INVALID');
  const hidden = replaceAfter(taskText, '## 체크리스트', '<!-- ``` -->\n- [ ] alpha\n');
  assert.equal(identifyPseArtifactPair(input(hidden)).code, 'IDENTIFIED');
  const hiddenOverflow = replaceAfter(taskText, '## 체크리스트', `<!--\n${Array.from({ length: 2001 }, () => '- [ ] hidden').join('\n')}`);
  assert.equal(identifyPseArtifactPair(input(hiddenOverflow)).code, 'GRAMMAR_INVALID');
  const overflowThenUnclosed = replaceAfter(taskText, '## 체크리스트', `${Array.from({ length: 2001 }, (_, i) => `- [ ] v${i}`).join('\n')}\n<!--`);
  assert.equal(identifyPseArtifactPair(input(overflowThenUnclosed)).code, 'IDENTITY_LIMIT_EXCEEDED');
  const duplicateOverflow = replaceAfter(taskText, '## 체크리스트', `${Array.from({ length: 2001 }, (_, i) => `- [ ] v${i}`).join('\n')}\n## 체크리스트\n- [ ] x`);
  assert.equal(identifyPseArtifactPair(input(duplicateOverflow)).code, 'IDENTITY_LIMIT_EXCEEDED');
});

test('delegates malformed raw envelopes to capture and rejects capture projections', () => {
  requireExport();
  for (const value of [{}, null, { ok: true, code: 'CAPTURED', capture: {} }]) {
    assert.equal(identifyPseArtifactPair(value).code, 'INVALID_INPUT');
  }
});

test('runtime loader proves one exact capture call, reference preservation, and no post-failure hashing', () => {
  requireExport();
  const source = readFileSync(new URL('../pse-artifact-identity.mjs', import.meta.url), 'utf8');
  const imports = parseStaticModuleRequests(source, 'hooks/scripts/lib/pse-artifact-identity.mjs')
    .map(request => request.specifier).sort();
  assert.deepEqual(imports, ['./pse-artifact-capture.mjs', 'node:crypto']);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.match(source, /import\s*\{\s*createHash\s*\}\s*from ['"]node:crypto['"]/);
  assert.match(source, /createHash\(['"]sha256['"]\)/);
  assert.doesNotMatch(source, /webcrypto|subtle|crypto\.createHash/);
  const dir = mkdtempSync(resolve(tmpdir(), 'pse-identity-loader-'));
  try {
    const loader = resolve(dir, 'loader.mjs');
    writeFileSync(loader, `export async function resolve(specifier, context, next) {
      if (context.parentURL?.endsWith('/pse-artifact-identity.mjs') && specifier === './pse-artifact-capture.mjs') return { url: 'data:text/javascript,' + encodeURIComponent('export function capturePseArtifactPair(input){globalThis.captureCalls++;globalThis.sameInput=input===globalThis.input;return globalThis.failure}'), shortCircuit: true };
      if (context.parentURL?.endsWith('/pse-artifact-identity.mjs') && specifier === 'node:crypto') return { url: 'data:text/javascript,' + encodeURIComponent('export function createHash(){globalThis.hashCalls++;throw new Error("HASH_AFTER_FAILURE")}'), shortCircuit: true };
      return next(specifier, context);
    }\n`);
    const moduleUrl = new URL('../pse-artifact-identity.mjs', import.meta.url).href;
    const code = `globalThis.captureCalls=0;globalThis.hashCalls=0;globalThis.unexpectedReads=0;globalThis.input=Object.freeze({sentinel:true});const target=Object.freeze({ok:false,code:'SENTINEL'});globalThis.failure=new Proxy(target,{get(t,k,r){if(k!=='ok'&&k!=='code')globalThis.unexpectedReads++;return Reflect.get(t,k,r)}});const {identifyPseArtifactPair}=await import(${JSON.stringify(moduleUrl)});const result=identifyPseArtifactPair(globalThis.input);console.log(JSON.stringify({sameResult:result===globalThis.failure,sameInput:globalThis.sameInput,captureCalls:globalThis.captureCalls,hashCalls:globalThis.hashCalls,unexpectedReads:globalThis.unexpectedReads}));`;
    const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', loader, '--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { sameResult: true, sameInput: true, captureCalls: 1, hashCalls: 0, unexpectedReads: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
