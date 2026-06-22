/**
 * wiki-status.mjs — `.qe/wiki/` 레이어 상태 조회 (단일 권위, 성능 제한)
 *
 * session-start 훅과 HUD wiki 요소가 공유한다. 둘 다 매 세션/매 리드로마다
 * 실행되므로 **재귀 디렉터리 walk 금지** — 얕은 readdirSync 한두 번 + existsSync
 * 단락만 사용한다. wiki가 없으면 즉시 null/0을 반환해 부재 비용을 최소화한다.
 *
 * Node 내장 모듈만 사용 (zero external deps, D006).
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** inbox에서 미컴파일 소스로 셀 확장자 */
const SOURCE_EXTS = new Set(['.md', '.txt', '.pdf']);

/**
 * `.qe/wiki/inbox`의 미컴파일 소스 개수를 센다 (얕은 readdir, 재귀 없음).
 * README는 제외한다. inbox가 없으면 0.
 *
 * @param {string} projectRoot 프로젝트 루트 절대경로
 * @returns {number} 미컴파일 소스 개수 (오류 시 0 — fail-open)
 */
export function countInbox(projectRoot) {
  if (!projectRoot) return 0;
  const inbox = join(projectRoot, '.qe', 'wiki', 'inbox');
  if (!existsSync(inbox)) return 0;
  try {
    return readdirSync(inbox).filter((name) => {
      if (name === 'README.md') return false;
      const dot = name.lastIndexOf('.');
      if (dot < 0) return false;
      return SOURCE_EXTS.has(name.slice(dot).toLowerCase());
    }).length;
  } catch {
    return 0; // fail-open — never block the caller
  }
}

/**
 * `.qe/wiki/pages`의 주제(topic) 폴더 개수를 센다 (얕은 readdir, 1단계만).
 * 페이지 전수를 walk하지 않는다 — 토픽 수는 라우터 규모의 싼 프록시다.
 *
 * @param {string} projectRoot 프로젝트 루트 절대경로
 * @returns {number} 주제 폴더 개수 (오류 시 0)
 */
export function countTopics(projectRoot) {
  if (!projectRoot) return 0;
  const pages = join(projectRoot, '.qe', 'wiki', 'pages');
  if (!existsSync(pages)) return 0;
  try {
    return readdirSync(pages).filter((name) => {
      if (name.startsWith('.')) return false;
      try { return statSync(join(pages, name)).isDirectory(); } catch { return false; }
    }).length;
  } catch {
    return 0;
  }
}

/**
 * wiki 레이어 요약. `.qe/wiki/`가 아예 없으면 null (HUD/훅이 무출력하도록).
 *
 * @param {string} projectRoot 프로젝트 루트 절대경로
 * @returns {{ topics: number, inbox: number }|null}
 */
export function wikiSummary(projectRoot) {
  if (!projectRoot) return null;
  const wikiRoot = join(projectRoot, '.qe', 'wiki');
  if (!existsSync(wikiRoot)) return null; // 부재 비용 = 1 existsSync
  return { topics: countTopics(projectRoot), inbox: countInbox(projectRoot) };
}
