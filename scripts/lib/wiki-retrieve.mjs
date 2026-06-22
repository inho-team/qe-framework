/**
 * wiki-retrieve.mjs — `.qe/wiki/` 소비 프리미티브 (Phase A 라우팅을 코드로)
 *
 * 의도 문자열을 받아 라우터/인덱스 **줄만 얕게** 읽어 키워드 매칭 → 최소-관련 후보를 반환한다.
 * AI 판단(Qplan/Qgs/Qrun-task… + UserPromptSubmit)이 소비한다.
 *
 * 회귀 0 / 성능 불변 (D-WIKI-03, NFR5/6):
 *   - **첫 동작이 `existsSync('.qe/wiki')` 단락** — 없으면 즉시 []. 어떤 read·import보다 먼저.
 *   - wiki-router는 existsSync 통과 **후 lazy `import()`** — wiki 없으면 import·selfTest 비용 0.
 *   - 전체 페이지 read·재귀 walk 금지(라우터·인덱스 줄만).
 *   - MIN_SCORE 미만 → [] (sparse wiki·무관 프롬프트 노이즈 차단).
 *   - tier-aware(Phase 7): 인덱스 줄의 `(tier:X[,flag:contradiction])`만 파싱(본문 미독) →
 *     reviewed>auto 업랭크 + flag:contradiction hard-exclude.
 *
 * Node 내장만 정적 import. zero external deps.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** 검색 채택 최소 점수 (이 미만은 노이즈로 간주, [] 반환) */
export const MIN_SCORE = 2;
/** push(전역 주입) 채택 최소 점수 — 검색보다 엄격(매 프롬프트 오염 방지) */
export const PUSH_FLOOR = 4;
/** 반환 후보 상한 */
const TOP_K = 5;

const STOPWORDS = new Set([
  'the','a','an','of','to','in','on','for','and','or','is','are','what','how','do','does',
  '이','그','저','은','는','을','를','에','의','와','과','도','로','으로','에서','뭐','어떻게','대해','관련','알아','해줘','좀',
]);

/** 텍스트 → 정규화 토큰 배열 (NFC·소문자·stopword 제거·길이≥2). */
function tokenize(text) {
  if (typeof text !== 'string') return [];
  return text.normalize('NFC').toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** 인덱스/라우터 본문에서 `- [[ref]] — summary` 줄을 파싱 → {pageRef, summary}. */
function parseIndexLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    // 앵커: [[ref]] (tier:..,flag:..)?  — summary  — 토큰은 반드시 `—` 앞에서만 파싱(summary 괄호 무관).
    const m = line.match(/^\s*[-*]\s*\[\[([^\]]+)\]\]\s*(?:\(([^)]*)\)\s*)?(?:[—\-:]\s*(.*))?$/);
    if (!m) continue;
    const meta = m[2] || '';
    const tierM = meta.match(/tier:\s*(reviewed|auto)/);
    out.push({
      pageRef: m[1].trim(),
      summary: (m[3] || '').trim(),
      tier: tierM ? tierM[1] : null,            // 실 tier(없으면 null)
      contradiction: /\bflag:\s*contradiction\b/.test(meta),
    });
  }
  return out;
}

/** 얕게: pages/ 1단계 주제 폴더 목록. */
function listTopics(pagesDir) {
  try {
    return readdirSync(pagesDir).filter((n) => {
      if (n.startsWith('.')) return false;
      try { return statSync(join(pagesDir, n)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
}

/** 한 주제의 인덱스/라우터 줄을 모은다 (index.md + indexes/*.md, 얕게). */
function collectTopicLines(topicDir) {
  const lines = [];
  for (const f of ['index.md', 'overview.md']) {
    const p = join(topicDir, f);
    if (existsSync(p)) { try { lines.push(...parseIndexLines(readFileSync(p, 'utf8'))); } catch {} }
  }
  const idxDir = join(topicDir, 'indexes');
  if (existsSync(idxDir)) {
    let files = [];
    try { files = readdirSync(idxDir).filter((n) => n.endsWith('.md')); } catch {}
    for (const f of files) {
      try { lines.push(...parseIndexLines(readFileSync(join(idxDir, f), 'utf8'))); } catch {}
    }
  }
  return lines;
}

/**
 * 의도에 가장 관련된 wiki 페이지 후보를 회수한다.
 *
 * @param {string} intent - 의도/작업/프롬프트 문자열
 * @param {string} [projectRoot] - 프로젝트 루트 (기본 cwd)
 * @returns {Promise<Array<{pageRef:string, summary:string, tier:null, score:number, topic:string}>>}
 *   wiki 없거나 MIN_SCORE 미만이면 []. score 내림차순, 최대 TOP_K.
 */
export async function wikiRetrieve(intent, projectRoot) {
  const root = projectRoot || process.cwd();
  const wikiRoot = join(root, '.qe', 'wiki');
  if (!existsSync(wikiRoot)) return [];          // ← 단락: I/O·import 전. wiki 없으면 0 비용.

  let normalizeAlias, parseAliasFile;
  try {
    // lazy: wiki 존재 확인 후에만 wiki-router 로드(selfTest 포함). 부재 시 여기 도달 안 함.
    ({ normalizeAlias, parseAliasFile } = await import('./wiki-router.mjs'));
  } catch {
    normalizeAlias = (t) => t; parseAliasFile = () => new Map();
  }

  const pagesDir = join(wikiRoot, 'pages');
  if (!existsSync(pagesDir)) return [];

  const qTokens = tokenize(intent);
  if (qTokens.length === 0) return [];

  const candidates = [];
  for (const topic of listTopics(pagesDir)) {
    const topicDir = join(pagesDir, topic);
    // 주제 aliases 로드 → 의도 토큰을 정본명으로 정규화(있으면)
    let aliasMap = new Map();
    const ap = join(topicDir, 'aliases.md');
    if (existsSync(ap)) { try { aliasMap = parseAliasFile(readFileSync(ap, 'utf8')); } catch {} }
    const normTokens = qTokens.map((t) => normalizeAlias(t, aliasMap).toLowerCase());

    for (const { pageRef, summary, tier, contradiction } of collectTopicLines(topicDir)) {
      if (contradiction) continue;             // flag:contradiction → hard-exclude (line-only)
      const hay = (pageRef + ' ' + summary).normalize('NFC').toLowerCase();
      let score = 0;
      for (const t of normTokens) if (t && hay.includes(t)) score += 1;
      if (score < MIN_SCORE) continue;         // 관련성 플로어는 토큰 점수로만 판정
      // tier 업랭크: reviewed는 검증본이라 가중(+2), auto/미표기는 중립.
      const ranked = score + (tier === 'reviewed' ? 2 : 0);
      candidates.push({ pageRef, summary, tier, score: ranked, topic });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, TOP_K);
}

// ── CLI: `node scripts/lib/wiki-retrieve.mjs "<intent>"` → JSON (스킬 pull 경유) ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const intent = process.argv.slice(2).join(' ');
  wikiRetrieve(intent).then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch(() => { process.stdout.write('[]\n'); });
}
