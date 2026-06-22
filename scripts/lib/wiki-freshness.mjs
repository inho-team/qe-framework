/**
 * wiki-freshness.mjs — 코드↔wiki 드리프트(stale) 탐지 (Qwiki-lint CHECK 8용)
 *
 * 신선도 신호 = 페이지 `updated` vs `.qe/analysis/` 스냅샷 최신 mtime.
 * `.qe/analysis/`는 Erefresh-executor가 **코드가 변경됐을 때만** 재기록하므로(미변경 파일은
 * mtime 보존) 코드 변경의 유효한 프록시다. (immutable한 raw mtime과 비교하던 잘못된 신호를 교체)
 *
 * 오탐 방지: **코드 연관 페이지만** 대상 — frontmatter에 `source_file`이 있거나
 * `provenance: extracted`인 페이지. `type: concept`·무코드 페이지는 제외(영구 stale 오탐 차단).
 *
 * lint(온디맨드)에서만 호출되므로 페이지 frontmatter read는 허용(소비 hot-path 아님).
 * `.qe/wiki` 또는 `.qe/analysis` 없으면 graceful([]). Node 내장만, zero-dep.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/** 디렉터리 내 최신 mtime(ms). 없으면 0. (얕게 — analysis는 평평한 폴더) */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  try {
    for (const f of readdirSync(dir)) {
      try { const m = statSync(join(dir, f)).mtimeMs; if (m > newest) newest = m; } catch {}
    }
  } catch {}
  return newest;
}

/** frontmatter에서 키 한 줄을 뽑는다(단순 `key: value`). */
function fmField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
}

/** `.qe/wiki/pages/` 아래 모든 .md 페이지를 재귀 수집(lint용 — hot-path 아님). */
function allPages(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allPages(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/**
 * 코드↔wiki 드리프트로 stale한 페이지 목록을 반환한다.
 *
 * @param {string} [projectRoot]
 * @returns {{ stale: Array<{page:string, updated:string|null}>, analysisMtime:number, checked:number }}
 *   wiki/analysis 없으면 stale=[] (graceful).
 */
export function wikiFreshness(projectRoot) {
  const root = projectRoot || process.cwd();
  const wikiPages = join(root, '.qe', 'wiki', 'pages');
  const analysisDir = join(root, '.qe', 'analysis');
  if (!existsSync(wikiPages) || !existsSync(analysisDir)) return { stale: [], analysisMtime: 0, checked: 0 };

  const analysisMtime = newestMtime(analysisDir);
  if (!analysisMtime) return { stale: [], analysisMtime: 0, checked: 0 };

  const stale = [];
  let checked = 0;
  for (const page of allPages(wikiPages)) {
    let text;
    try { text = readFileSync(page, 'utf8'); } catch { continue; }
    const type = fmField(text, 'type');
    if (type === 'concept' || type === 'index' || type === 'overview' || type === 'aliases') continue; // 무코드 페이지 제외
    const hasCodeLink = !!fmField(text, 'source_file') || fmField(text, 'provenance') === 'extracted';
    if (!hasCodeLink) continue;                 // 코드 연관 페이지만 — 오탐 방지
    checked++;
    const updated = fmField(text, 'updated');
    const pageMs = updated ? Date.parse(updated) : NaN;
    // 페이지가 analysis 갱신(코드 변경)보다 오래됐으면 stale 후보
    if (!Number.isFinite(pageMs) || pageMs < analysisMtime) {
      stale.push({ page: relative(root, page), updated });
    }
  }
  return { stale, analysisMtime, checked };
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = wikiFreshness();
  process.stdout.write(`checked ${r.checked} code-linked page(s); stale ${r.stale.length}.\n`);
  for (const s of r.stale) process.stdout.write(`  [STALE] ${s.page} (updated: ${s.updated || 'none'})\n`);
}
