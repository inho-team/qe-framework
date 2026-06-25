#!/usr/bin/env node

/**
 * style-gate.test.mjs
 * Stage-1 drama pre-filter: precision (no false positives on clean answers) and
 * recall (catches the actual 의식의 흐름 / 추임새 markers), plus transcript extraction.
 * Run with: node --test hooks/scripts/lib/__tests__/style-gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  scanStyleViolations,
  extractLastAssistantText,
  DRAMA_PATTERNS,
  loadStyleRubric,
  judgeStyle,
  parseJudgeOutput,
} from '../style-gate.mjs';

// ============================================================================
// RECALL — drama must trip
// ============================================================================

const DRAMA_SAMPLES = [
  ['잠깐 — working tree가 비어 있다.', 'interjection-dash'],
  ['맞다 — 모델 정확하다.', 'interjection-dash'],
  ['아 잠깐 — gitignore를 보니 그렇네.', 'interjection-dash'],
  ['그러네 — 결국 그 경로를 참조한다.', 'interjection-dash'],
  ['음, baseline이 없네.', 'filler-opener'],
  ['아, 그건 다르게 봐야 한다.', 'filler-opener'],
  ['흠, 이건 좀 애매하다.', 'filler-opener'],
  ['좋은 질문입니다. 설명하겠습니다.', 'banned-opener-question'],
  ['좋은 질문이네요!', 'banned-opener-question'],
  ['이 코드에 대해 설명드리겠습니다.', 'banned-opener-explain'],
];

for (const [sample, expectedRule] of DRAMA_SAMPLES) {
  test(`recall: trips on "${sample.slice(0, 24)}…"`, () => {
    const res = scanStyleViolations(sample);
    assert.ok(res.tripped, `expected trip on: ${sample}`);
    assert.ok(
      res.hits.some((h) => h.rule === expectedRule),
      `expected rule ${expectedRule}, got ${JSON.stringify(res.hits)}`
    );
  });
}

test('recall: drama mid-text (after a clean line) still trips', () => {
  const text = '결론부터 말하면 X다.\n잠깐 — 근데 확인이 필요하다.';
  assert.ok(scanStyleViolations(text).tripped);
});

// ============================================================================
// PRECISION — clean OUTPUT_STYLE-compliant answers must NOT trip
// ============================================================================

const CLEAN_SAMPLES = [
  // legitimate em-dash use (the style doc itself does this constantly)
  'B를 추천합니다 — 가장 빠릅니다. A는 안전하지만 느립니다.',
  '결론: 테스트가 clean clone에서 깨집니다. (사실 — 직접 재현)',
  'CI도 실패할 것으로 보입니다. (추정 — 로컬만 확인)',
  // words that merely CONTAIN a marker char but are not interjections
  '음악 파일을 분석합니다.',
  '아니요, 그 경로는 gitignore되어 있습니다.',
  '맞다는 점을 코드로 확인했습니다.',
  '어긋남 검사를 먼저 돌립니다.',
  // a normal verdict block
  '원인: 테스트가 gitignore된 baseline 경로를 참조합니다.\n근거 수준: ★★★★★ 직접 재현',
  // "설명" without the banned-opener shape
  '이 함수는 입력을 검증한 뒤 결과를 반환합니다.',
  // question word without the banned opener
  '질문이 두 갈래라 나눠서 답합니다.',
];

for (const sample of CLEAN_SAMPLES) {
  test(`precision: clean on "${sample.slice(0, 28)}…"`, () => {
    const res = scanStyleViolations(sample);
    assert.equal(res.tripped, false, `false positive on: ${sample} → ${JSON.stringify(res.hits)}`);
  });
}

// ============================================================================
// edge cases / fault tolerance
// ============================================================================

test('scan: empty / non-string → no trip', () => {
  assert.equal(scanStyleViolations('').tripped, false);
  assert.equal(scanStyleViolations(null).tripped, false);
  assert.equal(scanStyleViolations(undefined).tripped, false);
  assert.equal(scanStyleViolations(42).tripped, false);
});

test('patterns: every entry has a rule name and RegExp', () => {
  for (const p of DRAMA_PATTERNS) {
    assert.equal(typeof p.rule, 'string');
    assert.ok(p.re instanceof RegExp);
  }
});

// ============================================================================
// transcript extraction
// ============================================================================

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-style-'));
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8');
  return { dir, p };
}

test('extract: returns final assistant prose after last human user turn', (t) => {
  const { dir, p } = writeTranscript([
    { type: 'user', message: { role: 'user', content: '커밋하자' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '첫 답변.' }] } },
    { type: 'user', message: { role: 'user', content: '화법 고쳐' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '잠깐 — 확인한다.' }] } },
  ]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const text = extractLastAssistantText(p);
  assert.equal(text, '잠깐 — 확인한다.');
  assert.ok(scanStyleViolations(text).tripped);
});

test('extract: ignores tool_use blocks, keeps text across split turn', (t) => {
  const { dir, p } = writeTranscript([
    { type: 'user', message: { role: 'user', content: '해줘' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '먼저 본다.' }, { type: 'tool_use', name: 'Bash', input: {} }] } },
    // tool_result arrives as a user-type line — must NOT reset the "last human user" anchor
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '결론: 완료.' }] } },
  ]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const text = extractLastAssistantText(p);
  assert.equal(text, '먼저 본다.\n결론: 완료.');
  assert.equal(scanStyleViolations(text).tripped, false);
});

test('extract: missing / malformed transcript → empty string', (t) => {
  assert.equal(extractLastAssistantText('/nonexistent/path.jsonl'), '');
  assert.equal(extractLastAssistantText(''), '');
  assert.equal(extractLastAssistantText(null), '');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-style-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(p, 'not json\n{also bad\n', 'utf8');
  assert.equal(extractLastAssistantText(p), '');
});

// ============================================================================
// Stage 2: judge — parse contract + fail-open + injected fetch
// ============================================================================

test('parseJudgeOutput: BLOCK with reason → severe', () => {
  const v = parseJudgeOutput('BLOCK 추임새 사용');
  assert.equal(v.severe, true);
  assert.equal(v.judged, true);
  assert.equal(v.reason, '추임새 사용');
});

test('parseJudgeOutput: BLOCK with colon → severe, reason trimmed', () => {
  const v = parseJudgeOutput('BLOCK: 의식의 흐름\n(추가설명 무시)');
  assert.equal(v.severe, true);
  assert.equal(v.reason, '의식의 흐름');
});

test('parseJudgeOutput: bare BLOCK → severe with default reason', () => {
  const v = parseJudgeOutput('BLOCK');
  assert.equal(v.severe, true);
  assert.equal(v.reason, '문체 위반');
});

test('parseJudgeOutput: PASS → not severe', () => {
  assert.deepEqual(parseJudgeOutput('PASS'), { severe: false, reason: '', judged: true });
});

test('parseJudgeOutput: empty / junk → not severe (judged still false on empty)', () => {
  assert.equal(parseJudgeOutput('').judged, false);
  assert.equal(parseJudgeOutput('blah blah').severe, false);
});

test('judgeStyle: no token → fail-open (judged:false)', async () => {
  const v = await judgeStyle('잠깐 — 드라마', { token: null, fetchImpl: () => { throw new Error('should not call'); } });
  assert.deepEqual(v, { severe: false, reason: '', judged: false });
});

test('judgeStyle: injected fetch returns BLOCK → severe', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'BLOCK 추임새' }] }) });
  const v = await judgeStyle('잠깐 — 확인한다', { token: 'x', fetchImpl: fakeFetch });
  assert.equal(v.severe, true);
  assert.equal(v.judged, true);
});

test('judgeStyle: injected fetch returns PASS → not severe', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'PASS' }] }) });
  const v = await judgeStyle('결론: 완료.', { token: 'x', fetchImpl: fakeFetch });
  assert.equal(v.severe, false);
  assert.equal(v.judged, true);
});

test('judgeStyle: fetch throws (timeout) → fail-open', async () => {
  const fakeFetch = async () => { throw new Error('timeout'); };
  const v = await judgeStyle('잠깐 — 드라마', { token: 'x', fetchImpl: fakeFetch });
  assert.equal(v.severe, false);
  assert.equal(v.judged, false);
});

test('judgeStyle: non-ok response → fail-open', async () => {
  const fakeFetch = async () => ({ ok: false, json: async () => ({}) });
  const v = await judgeStyle('잠깐 — 드라마', { token: 'x', fetchImpl: fakeFetch });
  assert.equal(v.severe, false);
});

test('loadStyleRubric: reads 안티패턴 section from this repo OUTPUT_STYLE.md', () => {
  const rubric = loadStyleRubric(process.cwd());
  assert.ok(rubric.length > 0);
  // The real doc's anti-pattern section mentions 의식의 흐름; fallback also does.
  assert.ok(/의식의 흐름/.test(rubric), `rubric missing expected content: ${rubric.slice(0, 80)}`);
});

test('loadStyleRubric: missing doc → fallback', () => {
  const rubric = loadStyleRubric('/nonexistent/dir');
  assert.ok(/의식의 흐름/.test(rubric));
});
