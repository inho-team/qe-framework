/**
 * wiki-router.mjs — Qwiki 정본화·샤딩 실행 권위 (zero external dependencies)
 *
 * 이 파일은 `core/wiki-conventions.template.md`가 문서화하는 규칙의
 * 실행 권위(executable authority)다. 두 파일 간 불일치가 있으면
 * 이 파일을 기준으로 conventions를 수정한다.
 *
 * Token heuristic error band:
 *   - 라틴 텍스트: ±15% 오차 (char/4 근사치)
 *   - CJK(한글/중국어/일본어): 토큰당 글자 수가 적어 심각하게 과소 추정됨
 *     (실제 토큰 수가 추정치의 2–3배일 수 있음)
 *   - 보수 예산: 50K 상한의 60–70%에서 분기 권장
 *   - 이 추정치는 non-authoritative; 실제 과금·컨텍스트 판단에 사용 금지.
 *
 * Node built-ins only. No external imports.
 */

'use strict';

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 샤드 토큰 상한 (conventions §8 기준) */
const SHARD_CAP_TOKENS = 50_000;

/** 보수 예산 계수 — 실제 분기 기준은 CAP * BUDGET_FACTOR */
const BUDGET_FACTOR = 0.65; // 65% ≈ 32,500 토큰

/** 한글 완성형 범위 (Unicode Block: Hangul Syllables) */
const HANGUL_START = 0xac00;
const HANGUL_END   = 0xd7a3;

/** 한글 자모 범위 (Jamo: U+1100–U+11FF, Compatibility Jamo: U+3130–U+318F) */
const JAMO_RANGES = [
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0xa960, 0xa97f],  // Hangul Jamo Extended-A
  [0xd7b0, 0xd7ff],  // Hangul Jamo Extended-B
];

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * 주어진 코드포인트가 한글(완성형 또는 자모)인지 판별한다.
 * @param {number} cp - Unicode 코드포인트
 * @returns {boolean}
 */
function isHangul(cp) {
  if (cp >= HANGUL_START && cp <= HANGUL_END) return true;
  for (const [lo, hi] of JAMO_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

// ─── 핵심 export ─────────────────────────────────────────────────────────────

/**
 * 정본명(canonical)의 첫 글자를 기반으로 결정론적 샤드 키를 반환한다.
 *
 * 규칙:
 *   1. String.normalize('NFC') 적용 후 첫 글자 추출.
 *   2. 한글(완성형·자모) → 'ko' (한글 전용 namespace 샤드)
 *   3. 라틴 소문자 a–m → 'a-m'
 *   4. 라틴 소문자 n–z → 'n-z'
 *   5. 그 외 → 'misc'
 *
 * **범위 주의 (의도된 동작):** 라틴 판별은 **ASCII a–z 전용**이다. 따라서
 *   - 악센트 라틴(É·ñ·ü 등)·키릴·기타 문자 → 'misc'
 *   - 선행 공백/구두점(' apple', '#tag', '"q"') → 'misc'
 * 정본명은 안정적 kebab-case ASCII 슬러그를 권장(conventions §4). 한글은 §2 규칙으로
 * 별도 'ko' 샤드에 모인다. (국제화 확장이 필요하면 향후 Unicode 라틴 블록까지 넓힌다.)
 *
 * 동일 입력 → 동일 출력 (결정론 보장, 상태 없음).
 *
 * @param {string} canonical - 정본명 문자열 (임의 길이)
 * @returns {string} 샤드 키: 'ko' | 'a-m' | 'n-z' | 'misc'
 */
export function shardKey(canonical) {
  if (typeof canonical !== 'string' || canonical.length === 0) return 'misc';

  const nfc = canonical.normalize('NFC');
  // 첫 글자의 코드포인트 (surrogate pair 지원)
  const cp = nfc.codePointAt(0);
  if (cp === undefined) return 'misc';

  // 한글 판별 우선
  if (isHangul(cp)) return 'ko';

  // 라틴 알파벳 소문자 변환 후 범위 분류
  const lower = String.fromCodePoint(cp).toLowerCase();
  const code = lower.codePointAt(0);
  if (code >= 0x61 && code <= 0x6d) return 'a-m'; // a–m
  if (code >= 0x6e && code <= 0x7a) return 'n-z'; // n–z

  return 'misc';
}

/**
 * 텍스트의 토큰 수를 문자 기반 휴리스틱으로 추정한다.
 *
 * 방법: 전체 문자 수를 4로 나눔 (영어 기준 1 토큰 ≈ 4 chars).
 * CJK 문자는 토큰 밀도가 높아 이 추정치가 **심각하게 과소평가**될 수 있음.
 * 보수 예산(BUDGET_FACTOR) 적용을 강력히 권장한다.
 *
 * @param {string} text
 * @returns {{ estimated_tokens: number, heuristic: true, warning: string }}
 */
export function estimateTokens(text) {
  if (typeof text !== 'string') return { estimated_tokens: 0, heuristic: true, warning: 'non-string input' };

  const charCount = text.length;
  const estimated_tokens = Math.ceil(charCount / 4);

  return {
    estimated_tokens,
    heuristic: true,
    warning: 'CJK text may be 2–3x underestimated; use with BUDGET_FACTOR=0.65 margin',
  };
}

/**
 * 텍스트가 샤드 토큰 상한을 초과하는지 보수적으로 판단한다.
 *
 * 실제 비교 기준: `estimated_tokens >= capTokens * BUDGET_FACTOR`
 * (실제 상한보다 35% 낮은 기준으로 조기 분기 — CJK 오차 완충)
 *
 * @param {string} text
 * @param {number} [capTokens=50000] - 상한 (기본값: SHARD_CAP_TOKENS)
 * @returns {boolean} true = 상한 초과 (분기 권장)
 */
export function shardCapExceeded(text, capTokens = SHARD_CAP_TOKENS) {
  // NaN/음수/0 방어: IEEE754에서 `x >= NaN`은 항상 false라 가드가 조용히 무력화됨.
  if (!Number.isFinite(capTokens) || capTokens <= 0) capTokens = SHARD_CAP_TOKENS;
  const { estimated_tokens } = estimateTokens(text);
  return estimated_tokens >= capTokens * BUDGET_FACTOR;
}

/**
 * 별칭(term)을 정본명(canonical)으로 정규화한다.
 *
 * 처리 순서:
 *   1. term에 NFC 정규화 적용.
 *   2. aliasMap에서 NFC(term) 키 lookup.
 *   3. 매칭 없으면 NFC(term) 그대로 반환 (identity fallback).
 *
 * @param {string} term - 조회할 별칭 또는 정본명
 * @param {Map<string, string>|Record<string, string>} aliasMap
 *   - Map 또는 plain object 모두 허용
 *   - 형식: { 별칭 → 정본명 } (aliases.md 파싱 결과)
 * @returns {string} 정본명 (항상 NFC)
 */
export function normalizeAlias(term, aliasMap) {
  if (typeof term !== 'string') return '';
  const nfcTerm = term.normalize('NFC');

  // Map 또는 plain object 지원
  let canonical;
  if (aliasMap instanceof Map) {
    canonical = aliasMap.get(nfcTerm);
  } else if (aliasMap && typeof aliasMap === 'object') {
    canonical = aliasMap[nfcTerm];
  }

  return typeof canonical === 'string' ? canonical.normalize('NFC') : nfcTerm;
}

/**
 * aliases.md 텍스트를 `Map<별칭, 정본명>`으로 파싱한다.
 *
 * 라인 형식 (conventions §4):
 *   `별칭 → 정본명`        (구분자: `→` U+2192, 또는 ASCII `->`)
 *   - 양쪽 trim, NFC 정규화
 *   - 빈 줄 무시
 *   - `#`로 시작하는 줄 = 주석, 무시
 *   - 마크다운 표(`|`) 라인: `| 별칭 | 정본명 |` 형식도 허용 (셀 trim)
 *   - 구분자 없는 줄은 무시 (오류 내성)
 *
 * normalizeAlias()가 소비할 단일 권위 파서. 각 Qwiki 스킬은 이 함수로
 * aliases.md를 Map으로 변환한 뒤 normalizeAlias(term, map)을 호출한다.
 *
 * @param {string} text - aliases.md 파일 내용
 * @returns {Map<string, string>} 별칭(NFC) → 정본명(NFC)
 */
export function parseAliasFile(text) {
  const map = new Map();
  if (typeof text !== 'string') return map;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    // 마크다운 표 행: | 별칭 | 정본명 | → 셀 배열
    let alias, canonical;
    if (line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cells.length < 2) continue;
      // 헤더/구분선(---) 스킵
      if (/^:?-{2,}:?$/.test(cells[0]) || cells[0] === '별칭' || cells[0].toLowerCase() === 'alias') continue;
      [alias, canonical] = cells;
    } else {
      const m = line.split(/\s*(?:→|->)\s*/);
      // 정확히 2조각만 허용 — 구분자 없는 줄(<2)과 다중 화살표 모호 줄(>2, 예 `a → b → c`)을
      // 모두 거부해 조용한 오매핑을 막는다.
      if (m.length !== 2) continue;
      [alias, canonical] = m;
    }

    alias = (alias || '').trim().normalize('NFC');
    canonical = (canonical || '').trim().normalize('NFC');
    if (alias && canonical) map.set(alias, canonical);
  }
  return map;
}

// ─── 자체 검증 (import 시 1회 실행, 외부 테스트 프레임워크 없음) ─────────────
// escape hatch: WIKI_ROUTER_SKIP_SELF_TEST=1 이면 건너뛴다. 테스트 하니스가
// 핫루프로 import하거나, 자체검증 throw가 import-time fail-close가 되는 것을 방지.

function selfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`wiki-router selfTest FAIL: ${msg}`); };

  // shardKey: 한글
  assert(shardKey('가나다') === 'ko', 'Hangul syllable → ko');
  assert(shardKey('ㄱㄴㄷ') === 'ko', 'Hangul jamo → ko');

  // shardKey: 라틴
  assert(shardKey('apple') === 'a-m', 'a → a-m');
  assert(shardKey('Mango') === 'a-m', 'M (uppercase) → a-m');
  assert(shardKey('noodle') === 'n-z', 'n → n-z');
  assert(shardKey('Zebra') === 'n-z', 'Z → n-z');

  // shardKey: misc
  assert(shardKey('123abc') === 'misc', 'digit-first → misc');
  assert(shardKey('') === 'misc', 'empty → misc');

  // shardKey: NFC 정규화 (NFD 입력 → NFC 후 분류)
  const nfd = '가'; // 가 in NFD
  assert(shardKey(nfd) === 'ko', 'NFD Hangul → NFC → ko');

  // estimateTokens: 기본 동작
  const result = estimateTokens('hello world'); // 11 chars → ceil(11/4) = 3
  assert(result.heuristic === true, 'heuristic flag');
  assert(typeof result.estimated_tokens === 'number', 'estimated_tokens is number');
  assert(result.estimated_tokens > 0, 'positive estimate');

  // normalizeAlias: Map lookup
  const aliasMap = new Map([['AI', '인공지능'], ['머신러닝', 'Machine Learning']]);
  assert(normalizeAlias('AI', aliasMap) === '인공지능', 'Map alias lookup');
  assert(normalizeAlias('Unknown', aliasMap) === 'Unknown', 'Map identity fallback');

  // normalizeAlias: plain object
  const objMap = { 'GPT': 'ChatGPT' };
  assert(normalizeAlias('GPT', objMap) === 'ChatGPT', 'object alias lookup');

  // shardCapExceeded: long text
  const longText = 'a'.repeat(4 * 50_000); // 200K chars → 50K tokens → exactly at cap
  assert(shardCapExceeded(longText) === true, 'at-cap text exceeds budget');
  const shortText = 'a'.repeat(100);
  assert(shardCapExceeded(shortText) === false, 'short text under budget');

  // shardCapExceeded: NaN/잘못된 cap 방어 (기본 상한으로 폴백)
  assert(shardCapExceeded(longText, NaN) === true, 'NaN cap falls back to default (at-cap → true)');
  assert(shardCapExceeded(shortText, NaN) === false, 'NaN cap falls back to default (short → false)');
  assert(shardCapExceeded(shortText, -1) === false, 'negative cap falls back to default');

  // parseAliasFile: 화살표 형식 + 표 형식 + 주석/빈줄 내성
  const aliasText = [
    '# 주석 줄',
    '',
    'Parasite → 기생충',
    '샬라메 -> Timothée Chalamet',
    '| 별칭 | 정본명 |',
    '| --- | --- |',
    '| AI | 인공지능 |',
    'garbage-line-no-separator',
    'a → b → c',
  ].join('\n');
  const parsed = parseAliasFile(aliasText);
  assert(parsed.get('Parasite') === '기생충', 'arrow → parse');
  assert(parsed.get('샬라메') === 'Timothée Chalamet', 'ascii -> parse');
  assert(parsed.get('AI') === '인공지능', 'markdown table row parse');
  assert(!parsed.has('garbage-line-no-separator'), 'separator-less line ignored');
  assert(!parsed.has('a'), 'ambiguous multi-arrow line rejected');
  assert(!parsed.has('별칭'), 'table header skipped');
  // parseAliasFile → normalizeAlias 엔드투엔드
  assert(normalizeAlias('Parasite', parsed) === '기생충', 'parseAliasFile→normalizeAlias e2e');
}

if (!process.env.WIKI_ROUTER_SKIP_SELF_TEST) selfTest();
