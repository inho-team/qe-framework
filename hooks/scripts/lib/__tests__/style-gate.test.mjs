#!/usr/bin/env node

/**
 * style-gate.test.mjs
 * Stage-1 response scanner: deterministic structure checks, operational-response
 * semantic review candidates, legacy drama precision/recall, and transcript extraction.
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
  STYLE_PATTERNS,
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
  assert.equal(DRAMA_PATTERNS, STYLE_PATTERNS);
  for (const p of STYLE_PATTERNS) {
    assert.equal(typeof p.rule, 'string');
    assert.ok(p.re instanceof RegExp);
  }
});

// ============================================================================
// ACTION-FIRST CONTRACT — deterministic structure + semantic-review routing
// ============================================================================

test('operational response: routes to semantic review without false missing-marker hits', () => {
  const text = [
    '다음 행동: 대상 테스트를 실행합니다.',
    '현재 상태: 구현 완료, 검증 진행 중이며 약 5분 남았습니다.',
    '완료: 문체 계약을 갱신했습니다.',
    '다음 단계: 테스트 결과를 확인합니다.',
  ].join('\n');
  const rules = scanStyleViolations(text).hits.map((hit) => hit.rule);
  assert.ok(rules.includes('operational-response-review'));
  assert.ok(!rules.includes('missing-action-lead'));
  assert.ok(!rules.includes('missing-current-state'));
  assert.ok(!rules.includes('missing-next-step'));
});

test('operational response: catches missing action lead, state, and concrete next step', () => {
  const text = [
    '구현을 진행했습니다.',
    '대상 파일을 수정했습니다.',
    '테스트도 실행할 예정입니다.',
  ].join('\n');
  const rules = scanStyleViolations(text).hits.map((hit) => hit.rule);
  assert.ok(rules.includes('missing-action-lead'));
  assert.ok(rules.includes('missing-current-state'));
  assert.ok(rules.includes('missing-next-step'));
});

test('list cap: six contiguous items trip, five items pass', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((x) => `- ${x}`).join('\n');
  const six = `${five}\n- f`;
  assert.equal(scanStyleViolations(five).hits.some((hit) => hit.rule === 'list-over-5'), false);
  assert.equal(scanStyleViolations(six).hits.some((hit) => hit.rule === 'list-over-5'), true);
});

test('list cap: fenced examples do not count as user-facing lists', () => {
  const text = ['```markdown', '- a', '- b', '- c', '- d', '- e', '- f', '```'].join('\n');
  assert.equal(scanStyleViolations(text).hits.some((hit) => hit.rule === 'list-over-5'), false);
});

test('no-closer contract: generic closer and recap opener trip', () => {
  assert.ok(scanStyleViolations('결과는 정상입니다.\n필요하시면 언제든지 말씀해 주세요.').hits.some((hit) => hit.rule === 'generic-closer'));
  assert.ok(scanStyleViolations('요약하면 변경은 세 가지입니다.').hits.some((hit) => hit.rule === 'recap-opener'));
});

test('minute estimate contract: vague timing trips, integer minutes pass', () => {
  assert.ok(scanStyleViolations('조금 걸립니다.').hits.some((hit) => hit.rule === 'vague-time-estimate'));
  assert.equal(scanStyleViolations('약 5분 걸립니다.').hits.some((hit) => hit.rule === 'vague-time-estimate'), false);
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

test('judgeStyle: adapter-owned token provider is lazy and enables judging', async () => {
  let providerCalls = 0;
  const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'PASS' }] }) });
  const v = await judgeStyle('결론: 완료.', {
    tokenProvider: () => { providerCalls += 1; return 'injected-token'; },
    fetchImpl: fakeFetch,
  });
  assert.equal(providerCalls, 1);
  assert.equal(v.judged, true);
});

test('judgeStyle: token provider failure remains fail-open', async () => {
  const v = await judgeStyle('잠깐 — 드라마', {
    tokenProvider: () => { throw new Error('credential backend unavailable'); },
    fetchImpl: () => { throw new Error('should not call'); },
  });
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

test('judgeStyle: prompt carries the complete action-first contract', async () => {
  let requestBody = null;
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ text: 'PASS' }] }) };
  };
  await judgeStyle('다음 행동: 검증합니다.', { token: 'x', fetchImpl: fakeFetch });
  const prompt = requestBody.messages[0].content;
  for (const cue of ['다음 행동', '현재 상태', '분 단위', '성과', '오류', '목록 5개', '곁가지', '반복 요약', '다음 단계']) {
    assert.match(prompt, new RegExp(cue));
  }
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
  assert.ok(/의식의 흐름/.test(rubric), `rubric missing expected content: ${rubric.slice(0, 80)}`);
  assert.ok(/다음 행동/.test(rubric));
  assert.ok(/목록은 최대 5개/.test(rubric));
});

test('loadStyleRubric: missing doc → fallback', () => {
  const rubric = loadStyleRubric('/nonexistent/dir');
  assert.ok(/의식의 흐름/.test(rubric));
  assert.ok(/현재 상태/.test(rubric));
});
