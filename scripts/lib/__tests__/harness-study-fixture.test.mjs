import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CONDITIONS, buildActorPrompt, buildPilotSchedule, loadPilotFixture, materializeTask, scoreHiddenAcceptance } from '../harness-pilot.mjs';
import { createPilotExecuteClaim } from '../../run-harness-pilot.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/harness-study.json', import.meta.url));
const EXPECTED_FIXTURE_DIGEST = '8cbf703085d7bb5b131e389875ad0c0e817a28b9ac285efd31a6d23f840df249';
const EXPECTED_SCHEDULE_DIGEST = 'ab35919e13b0ebda16b31b4f61c68a1073d83816a4fb4e5f9d8c4da162b80da9';
const ORACLES = Object.freeze({
  "collapse-marker-runs": {
    "targetPath": "pilot-task/src/collapse-marker.mjs",
    "referenceSource": "export function collapseMarker(value) { if (typeof value !== 'string') throw new TypeError('value'); while (value.includes('mkmk')) value = value.replaceAll('mkmk', 'mk'); return value; }\n",
    "mutantSource": "export function collapseMarker(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replaceAll('mkmk', 'mk'); }\n",
    "sentinel": "0f6e53ee4d0a89a4dea6f4bfe58dd752",
    "hiddenOnlyLiterals": [
      "omegamkmkmkzeta",
      "omegamkzeta"
    ],
    "contractClass": "canonicalize-repeated-marker-runs",
    "defectClass": "single-pass-replacement",
    "hiddenCaseId": "triple-marker-overlap"
  },
  "ensure-single-prefix": {
    "targetPath": "pilot-task/src/ensure-prefix.mjs",
    "referenceSource": "export function ensurePrefix(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.startsWith('pre') ? value : 'pre' + value; }\n",
    "mutantSource": "export function ensurePrefix(value) { if (typeof value !== 'string') throw new TypeError('value'); return 'pre' + value; }\n",
    "sentinel": "7724c5ae5ff9475c69af231084dd091c",
    "hiddenOnlyLiterals": [
      "prehiddenomega",
      "secondhidden",
      "presecondhidden"
    ],
    "contractClass": "idempotent-prefix-insertion",
    "defectClass": "unconditional-prefix-duplication",
    "hiddenCaseId": "already-prefixed-token"
  },
  "strip-terminal-suffix": {
    "targetPath": "pilot-task/src/strip-suffix.mjs",
    "referenceSource": "export function stripSuffix(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.endsWith('end') ? value.slice(0, -3) : value; }\n",
    "mutantSource": "export function stripSuffix(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replace('end', ''); }\n",
    "sentinel": "a70108b715b70e566e3cc3713ab61ef5",
    "hiddenOnlyLiterals": [
      "hiddenendmiddle",
      "hiddenomegaend",
      "hiddenomega"
    ],
    "contractClass": "terminal-suffix-removal",
    "defectClass": "nonterminal-substring-removal",
    "hiddenCaseId": "suffix-token-in-middle"
  },
  "parse-toggle-token": {
    "targetPath": "pilot-task/src/parse-toggle.mjs",
    "referenceSource": "export function parseToggle(value) { if (value === 'enabled') return true; if (value === 'disabled') return false; throw new TypeError('toggle'); }\n",
    "mutantSource": "export function parseToggle(value) { return value === 'enabled'; }\n",
    "sentinel": "ac803a30adf2708238aa06929424ca91",
    "hiddenOnlyLiterals": [
      "disabled",
      "invalidtoggle"
    ],
    "contractClass": "closed-toggle-token-parser",
    "defectClass": "unknown-token-defaulting",
    "hiddenCaseId": "unknown-toggle-rejection"
  },
  "reverse-delimited-segments": {
    "targetPath": "pilot-task/src/reverse-segments.mjs",
    "referenceSource": "export function reverseSegments(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.split('sep').reverse().join('sep'); }\n",
    "mutantSource": "export function reverseSegments(value) { if (typeof value !== 'string') throw new TypeError('value'); const parts = value.split('sep'); return parts.length === 2 ? parts.reverse().join('sep') : value; }\n",
    "sentinel": "f2cdb928cedd7d163be3463abe1e7ee9",
    "hiddenOnlyLiterals": [
      "hiddenasephiddenbsephiddenc",
      "hiddencsephiddenbsephiddena"
    ],
    "contractClass": "arbitrary-segment-reversal",
    "defectClass": "two-segment-special-case",
    "hiddenCaseId": "three-segment-order"
  },
  "title-delimited-segments": {
    "targetPath": "pilot-task/src/title-segments.mjs",
    "referenceSource": "export function titleSegments(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.split('sep').map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part).join('sep'); }\n",
    "mutantSource": "export function titleSegments(value) { if (typeof value !== 'string') throw new TypeError('value'); return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }\n",
    "sentinel": "a3f1f79ffe16032790b84b335461c1d8",
    "hiddenOnlyLiterals": [
      "hiddenalphasephiddenbeta",
      "HiddenalphasepHiddenbeta"
    ],
    "contractClass": "per-segment-title-casing",
    "defectClass": "first-segment-only-transform",
    "hiddenCaseId": "second-segment-capitalization"
  },
  "dedupe-casefolded-tokens": {
    "targetPath": "pilot-task/src/dedupe-tokens.mjs",
    "referenceSource": "export function dedupeTokens(value) { if (typeof value !== 'string') throw new TypeError('value'); const seen = new Set(); return value.split('sep').filter(part => { const key = part.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).join('sep'); }\n",
    "mutantSource": "export function dedupeTokens(value) { if (typeof value !== 'string') throw new TypeError('value'); return [...new Set(value.split('sep'))].join('sep'); }\n",
    "sentinel": "cdaa5756546ebf3f526ffae897910a08",
    "hiddenOnlyLiterals": [
      "HiddenAlphasephiddenalphasepHiddenBeta",
      "HiddenAlphasepHiddenBeta"
    ],
    "contractClass": "stable-casefolded-deduplication",
    "defectClass": "case-sensitive-set-membership",
    "hiddenCaseId": "case-variant-duplicate"
  },
  "replace-all-markers": {
    "targetPath": "pilot-task/src/replace-markers.mjs",
    "referenceSource": "export function replaceMarkers(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replaceAll('key', 'mask'); }\n",
    "mutantSource": "export function replaceMarkers(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replace('key', 'mask'); }\n",
    "sentinel": "25b28a0077bc434bcca8535477526ba0",
    "hiddenOnlyLiterals": [
      "vaultkeynorthkeywest",
      "vaultmasknorthmaskwest"
    ],
    "contractClass": "global-fixed-marker-replacement",
    "defectClass": "first-match-only-replacement",
    "hiddenCaseId": "multiple-marker-occurrences"
  },
  "compress-consecutive-runs": {
    "targetPath": "pilot-task/src/compress-runs.mjs",
    "referenceSource": "export function compressRuns(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replace(/(.)\\1+/g, '$1'); }\n",
    "mutantSource": "export function compressRuns(value) { if (typeof value !== 'string') throw new TypeError('value'); return [...new Set(value)].join(''); }\n",
    "sentinel": "6028e5cb8bd61626c4ad5b41218a97eb",
    "hiddenOnlyLiterals": [
      "hiddenrunnaabbccaa",
      "hidenrunabca"
    ],
    "contractClass": "consecutive-character-run-compression",
    "defectClass": "global-character-deduplication",
    "hiddenCaseId": "nonconsecutive-repeat-preservation"
  },
  "casefolded-palindrome": {
    "targetPath": "pilot-task/src/palindrome.mjs",
    "referenceSource": "export function isPalindrome(value) { if (typeof value !== 'string') throw new TypeError('value'); const normalized = value.toLowerCase(); return normalized === [...normalized].reverse().join(''); }\n",
    "mutantSource": "export function isPalindrome(value) { if (typeof value !== 'string') throw new TypeError('value'); return value === [...value].reverse().join(''); }\n",
    "sentinel": "bbb0f2d713d3359aa1d45f71872c75e1",
    "hiddenOnlyLiterals": [
      "Abcddcba",
      "QuartzSignal"
    ],
    "contractClass": "case-insensitive-palindrome-check",
    "defectClass": "case-sensitive-comparison",
    "hiddenCaseId": "mixed-case-palindrome"
  },
  "longest-common-prefix": {
    "targetPath": "pilot-task/src/common-prefix.mjs",
    "referenceSource": "export function commonPrefix(left, right) { if (typeof left !== 'string' || typeof right !== 'string') throw new TypeError('value'); let index = 0; while (index < left.length && left.charAt(index) === right.charAt(index)) index += 1; return left.slice(0, index); }\n",
    "mutantSource": "export function commonPrefix(left, right) { if (typeof left !== 'string' || typeof right !== 'string') throw new TypeError('value'); return left.charAt(0) === right.charAt(0) ? left.charAt(0) : ''; }\n",
    "sentinel": "e60c443fb5081b395692ef2e0867c785",
    "hiddenOnlyLiterals": [
      "sharedtokenalpha",
      "sharedtokenbeta",
      "sharedtoken"
    ],
    "contractClass": "full-common-prefix-discovery",
    "defectClass": "first-character-only-prefix",
    "hiddenCaseId": "multi-character-common-prefix"
  },
  "rotate-token-left": {
    "targetPath": "pilot-task/src/rotate-left.mjs",
    "referenceSource": "export function rotateLeft(value) { if (typeof value !== 'string' || value.length === 0) throw new TypeError('value'); return value.slice(1) + value.charAt(0); }\n",
    "mutantSource": "export function rotateLeft(value) { if (typeof value !== 'string' || value.length === 0) throw new TypeError('value'); return [...value].reverse().join(''); }\n",
    "sentinel": "024342de4dd7c889136b4d3ed420da23",
    "hiddenOnlyLiterals": [
      "rotationtoken",
      "otationtokenr"
    ],
    "contractClass": "single-position-left-rotation",
    "defectClass": "full-string-reversal",
    "hiddenCaseId": "length-greater-than-two-rotation"
  },
  "reject-reserved-identifiers": {
    "targetPath": "pilot-task/src/validate-identifier.mjs",
    "referenceSource": "export function validateIdentifier(value) { if (typeof value !== 'string') return false; return /^[A-Za-z][A-Za-z0-9]*$/.test(value) && value !== 'constructor' && value !== 'prototype'; }\n",
    "mutantSource": "export function validateIdentifier(value) { if (typeof value !== 'string') return false; return /^[A-Za-z][A-Za-z0-9]*$/.test(value); }\n",
    "sentinel": "ef494fdb2e898fc6b10b7a4eef9115ef",
    "hiddenOnlyLiterals": [
      "constructor",
      "prototype"
    ],
    "contractClass": "reserved-identifier-rejection",
    "defectClass": "syntax-only-identifier-validation",
    "hiddenCaseId": "prototype-pollution-names"
  },
  "exact-scope-membership": {
    "targetPath": "pilot-task/src/scope-membership.mjs",
    "referenceSource": "export function hasScope(list, required) { if (typeof list !== 'string' || typeof required !== 'string') throw new TypeError('value'); return list.split('sep').includes(required); }\n",
    "mutantSource": "export function hasScope(list, required) { if (typeof list !== 'string' || typeof required !== 'string') throw new TypeError('value'); return list.includes(required); }\n",
    "sentinel": "632ad8b92c7bdb9eb2411c53b2a19533",
    "hiddenOnlyLiterals": [
      "readsepprivilegeextra",
      "privilege"
    ],
    "contractClass": "delimiter-aware-scope-membership",
    "defectClass": "substring-authorization-match",
    "hiddenCaseId": "scope-prefix-confusion"
  },
  "redact-all-secrets": {
    "targetPath": "pilot-task/src/redact-secrets.mjs",
    "referenceSource": "export function redactSecrets(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replaceAll('sec', 'mask'); }\n",
    "mutantSource": "export function redactSecrets(value) { if (typeof value !== 'string') throw new TypeError('value'); return value.replace('sec', 'mask'); }\n",
    "sentinel": "23abd3eed1ac7c7e49b38c0be7324a9b",
    "hiddenOnlyLiterals": [
      "ciphersecnorthseceast",
      "ciphermasknorthmaskeast"
    ],
    "contractClass": "complete-secret-marker-redaction",
    "defectClass": "first-secret-only-redaction",
    "hiddenCaseId": "multiple-secret-occurrences"
  },
  "verify-token-envelope": {
    "targetPath": "pilot-task/src/verify-envelope.mjs",
    "referenceSource": "export function verifyEnvelope(value) { if (typeof value !== 'string') return false; return value.startsWith('start') && value.endsWith('end'); }\n",
    "mutantSource": "export function verifyEnvelope(value) { if (typeof value !== 'string') return false; return value.startsWith('start'); }\n",
    "sentinel": "01280959296d28e747e08fe1c2461bac",
    "hiddenOnlyLiterals": [
      "starthiddenmissing",
      "hiddenonlyend"
    ],
    "contractClass": "two-sided-token-envelope-validation",
    "defectClass": "prefix-only-envelope-check",
    "hiddenCaseId": "missing-terminal-boundary"
  },
  "run-all-pipeline-stages": {
    "targetPath": "pilot-task/src/run-pipeline.mjs",
    "referenceSource": "export function runPipeline(value, stages) { if (!Array.isArray(stages)) throw new TypeError('stages'); for (const stage of stages) value = stage(value); return value; }\n",
    "mutantSource": "export function runPipeline(value, stages) { if (!Array.isArray(stages)) throw new TypeError('stages'); return stages.length ? stages[0](value) : value; }\n",
    "sentinel": "5b27c13cff984f1cc1e601d3aff7c683",
    "hiddenOnlyLiterals": [
      "basehidden",
      "firststage",
      "secondstage",
      "basehiddenfirststagesecondstage"
    ],
    "contractClass": "ordered-multi-stage-pipeline",
    "defectClass": "first-stage-only-execution",
    "hiddenCaseId": "two-stage-composition"
  },
  "batch-with-remainder": {
    "targetPath": "pilot-task/src/batch-pairs.mjs",
    "referenceSource": "export function batchPairs(items) { if (!Array.isArray(items)) throw new TypeError('items'); const batches = []; for (let index = 0; index < items.length; index += 2) batches.push(items.slice(index, index + 2)); return batches; }\n",
    "mutantSource": "export function batchPairs(items) { if (!Array.isArray(items)) throw new TypeError('items'); const batches = []; const limit = Math.floor(items.length / 2) * 2; for (let index = 0; index < limit; index += 2) batches.push(items.slice(index, index + 2)); return batches; }\n",
    "sentinel": "447421fdc7df08139a0084224eb135ed",
    "hiddenOnlyLiterals": [
      "firstbatchtoken",
      "secondbatchtoken",
      "thirdbatchtoken"
    ],
    "contractClass": "fixed-pair-batching-with-remainder",
    "defectClass": "remainder-dropping-batcher",
    "hiddenCaseId": "odd-cardinality-final-batch"
  },
  "join-records-by-id": {
    "targetPath": "pilot-task/src/join-by-id.mjs",
    "referenceSource": "export function joinById(left, right) { if (!Array.isArray(left) || !Array.isArray(right)) throw new TypeError('items'); return left.map(item => { const match = right.find(candidate => candidate.id === item.id); return { ...item, value: match ? match.value : null }; }); }\n",
    "mutantSource": "export function joinById(left, right) { if (!Array.isArray(left) || !Array.isArray(right)) throw new TypeError('items'); return left.map((item, index) => ({ ...item, value: right[index] ? right[index].value : null })); }\n",
    "sentinel": "4a8dd7c1d2d457d7273166798dc692dd",
    "hiddenOnlyLiterals": [
      "hiddenidalpha",
      "hiddenidbeta",
      "hiddenvaluealpha",
      "hiddenvaluebeta"
    ],
    "contractClass": "keyed-record-join",
    "defectClass": "positional-record-zip",
    "hiddenCaseId": "reordered-right-input"
  },
  "reconcile-latest-events": {
    "targetPath": "pilot-task/src/latest-events.mjs",
    "referenceSource": "export function latestById(events) { if (!Array.isArray(events)) throw new TypeError('events'); const order = []; const latest = new Map(); for (const event of events) { if (!latest.has(event.id)) order.push(event.id); latest.set(event.id, event); } return order.map(id => latest.get(id)); }\n",
    "mutantSource": "export function latestById(events) { if (!Array.isArray(events)) throw new TypeError('events'); const seen = new Set(); return events.filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; }); }\n",
    "sentinel": "6df4e5da0a151ce2ee95fa5543a60377",
    "hiddenOnlyLiterals": [
      "chroniclekey",
      "amberpayload",
      "violetpayload"
    ],
    "contractClass": "last-write-wins-event-reconciliation",
    "defectClass": "first-write-wins-reconciliation",
    "hiddenCaseId": "duplicate-id-later-event"
  }
});
const PACKAGE_TEXT = '{"type":"module","scripts":{"test":"node --test test/public.test.mjs"}}\n';

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}
function normalizeLeak(value) { return String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function outputHash(run) { return createHash('sha256').update(`${run.stdout || ''}\n${run.stderr || ''}`).digest('hex'); }
function directHidden(workspace, command) {
  return spawnSync('/bin/sh', ['-lc', command], { cwd: workspace, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 });
}
function runPublic(workspace) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', 'pilot-task/test/public.test.mjs'], { cwd: workspace, encoding: 'utf8', timeout: 120000, env });
}
function recursiveText(root) {
  const output = [];
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) visit(target);
      else output.push(readFileSync(target, 'utf8'));
    }
  };
  visit(root);
  return output.join('\n');
}
function parseHidden(task, oracle) {
  const match = /^cd pilot-task && node --input-type=module -e "([^"\\$`\r\n\0]*)"$/.exec(task.hiddenAcceptance.command);
  assert.ok(match, `invalid hidden shell grammar: ${task.id}`);
  const program = match[1];
  assert.equal(`cd pilot-task && node --input-type=module -e "${program}"`, task.hiddenAcceptance.command);
  const expectedTarget = `./src/${oracle.targetPath.split('/').at(-1)}`;
  const literals = [...program.matchAll(/'([^']*)'/g)].map(item => item[1]);
  assert.equal(literals.filter(value => value === 'node:assert/strict').length, 1);
  assert.equal(literals.filter(value => value === expectedTarget).length, 1);
  assert.equal(literals.filter(value => value === oracle.sentinel).length, 1);
  const hiddenStrings = literals.filter(value => !['node:assert/strict', expectedTarget, oracle.sentinel].includes(value));
  const withoutStrings = program.replace(/'[^']*'/g, '');
  const hiddenNumbers = [...withoutStrings.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(item => item[0]);
  const derived = [...new Set([...hiddenStrings, ...hiddenNumbers])].sort();
  assert.deepEqual(derived, [...oracle.hiddenOnlyLiterals].sort(), `hidden literal set mismatch: ${task.id}`);
  for (const literal of derived) assert.equal([...hiddenStrings, ...hiddenNumbers].filter(value => value === literal).length, 1, `hidden literal must occur once: ${task.id}:${literal}`);
  for (const literal of derived) assert.match(literal, /^[A-Za-z0-9]{8,}$/);
  return program;
}
const JS_WORDS = new Set([
  'as','async','await','break','case','catch','class','const','continue','debugger','default','delete','do','else','export',
  'extends','false','finally','for','from','function','get','if','import','in','instanceof','let','new','null','of','return',
  'set','static','super','switch','this','throw','true','try','typeof','undefined','var','void','while','with','yield','NaN',
]);
const PURE_GLOBALS = new Set(['Array','Object','String','Number','Math','Set','Map','RegExp','Error','TypeError','RangeError','Promise']);
function lexicalIdentifiers(source) {
  const scrubbed = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/\/(?![/*])(?:[^/\\\n]|\\.)+\/[dgimsuvy]*/g, ' ')
    .replace(/\.[A-Za-z_$][A-Za-z0-9_$]*/g, ' ')
    .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\s*:/g, ' ');
  return [...scrubbed.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)].map(item => item[0]);
}
function declaredIdentifiers(source) {
  const declared = new Set();
  for (const match of source.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) declared.add(match[1]);
  for (const match of source.matchAll(/\bfunction(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/g)) {
    for (const value of match[1].match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) declared.add(value);
  }
  for (const match of source.matchAll(/(?:\(([A-Za-z0-9_$,\s]*)\)|\b([A-Za-z_$][A-Za-z0-9_$]*))\s*=>/g)) {
    for (const value of (match[1] || match[2] || '').match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) declared.add(value);
  }
  for (const match of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g)) declared.add(match[1]);
  return declared;
}
function assertLexicallyClosed(source, allowed, label) {
  const declared = declaredIdentifiers(source);
  const unknown = lexicalIdentifiers(source).filter(value => !JS_WORDS.has(value) && !PURE_GLOBALS.has(value)
    && !allowed.has(value) && !declared.has(value));
  assert.deepEqual([...new Set(unknown)], [], `unknown lexical capability: ${label}`);
}
function assertCapabilityClosed(task, oracle, program) {
  const forbidden = /(?:\b(?:process|globalThis|require|module|Buffer|Deno|Bun|fetch|WebSocket|eval|Function|child_process|worker_threads|fs|net|http|https|dns|dgram|tls)\b|import\s*\(|\.\s*(?:constructor|prototype|__proto__)\b)/;
  assert.doesNotMatch(program, forbidden);
  assert.doesNotMatch(program, /\b[A-Za-z_$][A-Za-z0-9_$]*\s*\[/);
  assertLexicallyClosed(program, new Set(['assert', task.prompt.match(/Implement ([A-Za-z0-9_]+)/)[1]]), `${task.id}:hidden`);
  for (const source of [task.starterFiles[oracle.targetPath], oracle.referenceSource, oracle.mutantSource]) {
    assert.doesNotMatch(source, forbidden);
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(item => item[1]);
    assert.ok(imports.every(value => value === 'node:path'));
    assertLexicallyClosed(source, new Set(), `${task.id}:target`);
  }
  const publicSource = task.starterFiles['pilot-task/test/public.test.mjs'];
  const imports = [...publicSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(item => item[1]);
  assert.deepEqual(imports, ['node:test', 'node:assert/strict', `../src/${oracle.targetPath.split('/').at(-1)}`]);
}
function claimFor(fixture) {
  return createPilotExecuteClaim({ fixture, invocationId: '11111111-1111-4111-8111-111111111111',
    revision: 'a'.repeat(40), createdAt: '2026-08-11T00:00:00.000Z',
    smokeAttemptIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'] });
}

test('freezes exact schema, balance, unique semantics, and runtime authority digests', () => {
  assert.equal(existsSync(FIXTURE_PATH), true);
  const fixture = loadPilotFixture(FIXTURE_PATH);
  assert.ok(exactKeys(fixture, ['schema','seed','model','effort','repetition','budget','tasks']));
  assert.equal(fixture.schema, 1); assert.equal(fixture.model, 'gpt-5.6-sol'); assert.equal(fixture.effort, 'medium');
  assert.equal(fixture.repetition, 3); assert.equal(fixture.tasks.length, 20);
  assert.deepEqual(fixture.budget, { maxInputTokens: 500000, maxOutputTokens: 50000, maxWallSeconds: 600, maxBudgetUsd: 0.5 });
  const categories = new Map();
  const dimensions = { id: [], target: [], contract: [], defect: [], hiddenCase: [], prompt: [], starter: [], public: [], hidden: [] };
  for (const task of fixture.tasks) {
    assert.ok(exactKeys(task, ['id','category','prompt','starterFiles','hiddenAcceptance']));
    assert.ok(exactKeys(task.hiddenAcceptance, ['command']));
    const oracle = ORACLES[task.id];
    assert.ok(exactKeys(oracle, ['targetPath','referenceSource','mutantSource','sentinel','hiddenOnlyLiterals','contractClass','defectClass','hiddenCaseId']));
    assert.equal(task.starterFiles['pilot-task/package.json'], PACKAGE_TEXT);
    assert.deepEqual(Object.keys(task.starterFiles).filter(path => /^pilot-task\/src\/.*\.mjs$/.test(path)), [oracle.targetPath]);
    assert.match(oracle.sentinel, /^[a-f0-9]{32}$/);
    assert.ok(Array.isArray(oracle.hiddenOnlyLiterals) && oracle.hiddenOnlyLiterals.length >= 2);
    categories.set(task.category, (categories.get(task.category) || 0) + 1);
    dimensions.id.push(task.id); dimensions.target.push(oracle.targetPath); dimensions.contract.push(oracle.contractClass);
    dimensions.defect.push(oracle.defectClass); dimensions.hiddenCase.push(oracle.hiddenCaseId); dimensions.prompt.push(task.prompt);
    dimensions.starter.push(JSON.stringify(task.starterFiles)); dimensions.public.push(task.starterFiles['pilot-task/test/public.test.mjs']);
    dimensions.hidden.push(task.hiddenAcceptance.command);
    const program = parseHidden(task, oracle); assertCapabilityClosed(task, oracle, program);
  }
  assert.deepEqual(Object.fromEntries([...categories].sort()), { debugging: 4, feature: 4, integration: 4, 'micro-fix': 4, security: 4 });
  for (const [name, values] of Object.entries(dimensions)) assert.equal(new Set(values).size, 20, `${name} must be unique`);
  const schedule = buildPilotSchedule(fixture);
  assert.equal(schedule.length, 240);
  for (const task of fixture.tasks) for (let repetition = 1; repetition <= 3; repetition += 1) {
    assert.deepEqual(schedule.filter(cell => cell.taskId === task.id && cell.repetition === repetition)
      .map(cell => cell.condition).sort(), [...CONDITIONS].sort());
  }
  const claim = claimFor(fixture);
  assert.equal(claim.fixtureDigest, EXPECTED_FIXTURE_DIGEST);
  assert.equal(claim.scheduleDigest, EXPECTED_SCHEDULE_DIGEST);
  assert.equal(claim.expectedCellCount, 240);
});

test('proves starter failure, reference solvability, and hidden-discriminating mutants', async () => {
  const fixture = loadPilotFixture(FIXTURE_PATH);
  for (const task of fixture.tasks) {
    const root = mkdtempSync(join(tmpdir(), 'qe-study-corpus-'));
    try {
      const workspace = materializeTask(root, task);
      const oracle = ORACLES[task.id];
      const starter = runPublic(workspace);
      assert.notEqual(starter.status, 0, `starter unexpectedly passed: ${task.id}`);
      const starterOutput = `${starter.stdout}
${starter.stderr}`;
      assert.match(starterOutput, /AssertionError/); assert.doesNotMatch(starterOutput, /SyntaxError|ERR_MODULE_NOT_FOUND/);
      writeFileSync(join(workspace, oracle.targetPath), oracle.referenceSource, 'utf8');
      const referencePublic = runPublic(workspace); assert.equal(referencePublic.status, 0, referencePublic.stderr);
      const referenceDirect = directHidden(workspace, task.hiddenAcceptance.command);
      const referenceScore = await scoreHiddenAcceptance({ workspace, task });
      assert.equal(referenceDirect.error, undefined); assert.equal(referenceDirect.signal, null); assert.equal(referenceDirect.status, 0, referenceDirect.stderr);
      assert.equal(referenceScore.passed, true); assert.equal(referenceScore.outputHash, outputHash(referenceDirect));
      writeFileSync(join(workspace, oracle.targetPath), oracle.mutantSource, 'utf8');
      const mutantPublic = runPublic(workspace); assert.equal(mutantPublic.status, 0, mutantPublic.stderr);
      const mutantDirect = directHidden(workspace, task.hiddenAcceptance.command);
      const mutantScore = await scoreHiddenAcceptance({ workspace, task });
      assert.equal(mutantDirect.error, undefined); assert.equal(mutantDirect.signal, null); assert.notEqual(mutantDirect.status, 0, `mutant hidden unexpectedly passed: ${task.id}`);
      assert.match(mutantDirect.stderr, /AssertionError/); assert.match(mutantDirect.stderr, new RegExp(oracle.sentinel));
      assert.equal(mutantScore.passed, false); assert.equal(mutantScore.outputHash, outputHash(mutantDirect));
      assert.notEqual(task.starterFiles[oracle.targetPath], oracle.referenceSource);
      assert.notEqual(task.starterFiles[oracle.targetPath], oracle.mutantSource);
      assert.notEqual(oracle.referenceSource, oracle.mutantSource);
      const exports = source => [...source.matchAll(/export function ([A-Za-z0-9_]+)/g)].map(item => item[1]);
      assert.deepEqual(exports(oracle.referenceSource), exports(oracle.mutantSource));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('keeps hidden commands, literals, and sentinel fragments out of every actor-visible surface', () => {
  const fixture = loadPilotFixture(FIXTURE_PATH);
  const dry = spawnSync(process.execPath, ['scripts/run-harness-pilot.mjs', '--dry-run', '--fixture', FIXTURE_PATH],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(dry.status, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).schedule.length, 240);
  const surfaces = [dry.stdout, dry.stderr];
  for (const task of fixture.tasks) {
    const root = mkdtempSync(join(tmpdir(), 'qe-study-visible-'));
    try {
      const workspace = materializeTask(root, task);
      surfaces.push(task.prompt, JSON.stringify(task.starterFiles), recursiveText(workspace));
      for (const condition of CONDITIONS) surfaces.push(buildActorPrompt(task.prompt, condition, task.category));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  const aggregate = surfaces.map(normalizeLeak).join('zzzzzzzzzzzzzzzz');
  const sentinelFragments = new Set();
  for (const task of fixture.tasks) {
    const oracle = ORACLES[task.id];
    assert.equal(aggregate.includes(normalizeLeak(task.hiddenAcceptance.command)), false);
    for (const literal of oracle.hiddenOnlyLiterals) {
      const normalized = normalizeLeak(literal);
      for (let index = 0; index <= normalized.length - 8; index += 1) {
        const fragment = normalized.slice(index, index + 8);
        assert.equal(aggregate.includes(fragment), false, `hidden literal leak: ${task.id}:${literal}:${fragment}`);
      }
    }
    const sentinel = normalizeLeak(oracle.sentinel);
    for (let index = 0; index <= sentinel.length - 12; index += 1) {
      const fragment = sentinel.slice(index, index + 12);
      assert.equal(sentinelFragments.has(fragment), false); sentinelFragments.add(fragment);
      assert.equal(aggregate.includes(fragment), false, `sentinel leak: ${task.id}:${fragment}`);
    }
  }
});

test('rejects shell grammar and capability escape variants', () => {
  const fixture = loadPilotFixture(FIXTURE_PATH); const task = fixture.tasks[0]; const oracle = ORACLES[task.id];
  const invalid = [
    task.hiddenAcceptance.command + '; uname',
    task.hiddenAcceptance.command.replace('"', "'"),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;process.exit'),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;globalThis.process.exit'),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;import('),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;Function('),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;Date.now();assert.equal'),
    task.hiddenAcceptance.command.replace('assert.equal', 'assert.equal;value[constructor]'),
  ];
  for (const command of invalid) {
    const candidate = { ...task, hiddenAcceptance: { command } };
    assert.throws(() => { const program = parseHidden(candidate, oracle); assertCapabilityClosed(candidate, oracle, program); });
  }
});
