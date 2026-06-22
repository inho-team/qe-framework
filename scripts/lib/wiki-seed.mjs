/**
 * wiki-seed.mjs — 지식 플라이휠 적재 (work → `.qe/wiki/inbox/`)
 *
 * 프레임워크 자신의 지식 아티팩트를 wiki inbox source로 시드한다. 이후 `/Qwiki-compile`이
 * 페이지로 합성한다(이 스크립트는 합성하지 않는다).
 *
 * 자기참조·자기수집 차단 (게이트 2라운드 결정 / D-WIKI-02·03):
 *   - 시드 대상 = DECISION_LOG.md · MISTAKE.md · plans/<plan>/phases/<n>/RETROSPECTIVE.md 뿐.
 *   - **`.qe/analysis/*` 제외** (자동 파생 코드 스냅샷은 raw 소스 아님 — D-WIKI-02).
 *   - **`.qe/wiki/` 내부(queries·pages·inbox 등) 제외** (wiki 파생 출력 되먹임 루프 차단).
 *   - 시드는 `seed_origin: framework-self` + `seed_provenance: inferred` →
 *     compile이 `provenance: inferred`(=(추론) 마킹 + 소크라테스 게이트) 부여, `--batch` 금지.
 *   - inbox 계약 준수: `type: inbox` · `status: uncompiled`.
 *   - 멱등 supersede-in-place: `.qe/wiki/.seed-state.json {파일경로 → contentHash}`, 파일당 1 source,
 *     안정 slug 재생성(append/pile-up 금지).
 *
 * Node 내장만. zero external deps.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

/** 시드 출처 → slug/제목 정의. RETROSPECTIVE는 동적 수집. */
function seedTargets(root) {
  const out = [];
  const push = (abs, slug, title) => { if (existsSync(abs)) out.push({ abs, slug, title }); };
  push(join(root, '.qe', 'planning', 'DECISION_LOG.md'), 'decision-log', 'Decision Log (architectural/strategic 결정)');
  push(join(root, '.qe', 'MISTAKE.md'), 'mistakes', 'Project Mistakes (반복 방지)');
  // RETROSPECTIVE: plans/*/phases/*/RETROSPECTIVE.md (재귀, plan+phase로 disambiguate)
  const plansDir = join(root, '.qe', 'planning', 'plans');
  if (existsSync(plansDir)) {
    for (const plan of safeDirs(plansDir)) {
      const phasesDir = join(plansDir, plan, 'phases');
      if (!existsSync(phasesDir)) continue;
      for (const ph of safeDirs(phasesDir)) {
        const rp = join(phasesDir, ph, 'RETROSPECTIVE.md');
        if (existsSync(rp)) out.push({ abs: rp, slug: `${plan}-phase${ph}-retrospective`, title: `Retrospective — ${plan} Phase ${ph}` });
      }
    }
  }
  return out;
}

/** 얕은 디렉터리 목록(점파일 제외). */
function safeDirs(dir) {
  try {
    return readdirSync(dir).filter((n) => {
      if (n.startsWith('.')) return false;
      try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * 프레임워크 자기-아티팩트를 wiki inbox로 시드한다(supersede-in-place, 멱등).
 *
 * @param {string} [projectRoot] 기본 cwd
 * @returns {{ seeded: string[], skipped: string[], wikiAbsent?: boolean }}
 *   seeded=새로/갱신 시드된 slug, skipped=내용 무변경으로 건너뛴 slug
 */
export function wikiSeedSelf(projectRoot) {
  const root = projectRoot || process.cwd();
  const inbox = join(root, '.qe', 'wiki', 'inbox');
  // wiki 스켈레톤이 없으면 graceful no-op (부트스트랩은 Qinit이 생성 후 호출)
  if (!existsSync(join(root, '.qe', 'wiki'))) return { seeded: [], skipped: [], wikiAbsent: true };
  mkdirSync(inbox, { recursive: true });

  const statePath = join(root, '.qe', 'wiki', '.seed-state.json');
  let state = {};
  if (existsSync(statePath)) { try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; } }

  const seeded = [], skipped = [];
  for (const { abs, slug, title } of seedTargets(root)) {
    let body;
    try { body = readFileSync(abs, 'utf8'); } catch { continue; }
    const key = relative(root, abs);
    const hash = sha(body);
    if (state[key] === hash) { skipped.push(slug); continue; } // 무변경 → supersede 불필요

    const fileName = `seed-${slug}.md`;                 // 안정 slug → 같은 파일 재생성(supersede)
    const front = [
      '---',
      'type: inbox',
      'status: uncompiled',
      'seed_origin: framework-self',
      'seed_provenance: inferred',
      `source_artifact: ${key}`,
      `title: "${title}"`,
      '---',
      '',
      `<!-- 자동 시드(wiki-seed --seed-self). 원본: ${key}. compile이 provenance:inferred로 합성하고`,
      `     소크라테스 게이트를 적용한다(--batch 금지). 이 본문은 원본 스냅샷이다. -->`,
      '',
      body.trimEnd(),
      '',
    ].join('\n');
    writeFileSync(join(inbox, fileName), front);
    state[key] = hash;
    seeded.push(slug);
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return { seeded, skipped };
}

// ── CLI: `node scripts/lib/wiki-seed.mjs --seed-self` ──
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--seed-self')) {
    const r = wikiSeedSelf();
    if (r.wikiAbsent) {
      process.stdout.write('.qe/wiki/ 없음 — 먼저 wiki 스켈레톤을 만든 뒤 시드하세요 (Qinit 부트스트랩 또는 mkdir -p .qe/wiki/inbox).\n');
    } else {
      process.stdout.write(`seeded ${r.seeded.length} (갱신/신규: ${r.seeded.join(', ') || '없음'}), unchanged ${r.skipped.length}.\n`);
      if (r.seeded.length) process.stdout.write('다음: /Qwiki-compile 로 inbox를 위키 페이지로 합성하세요 (--batch 금지: self-seed는 게이트 필수).\n');
    }
  } else {
    process.stdout.write('usage: node scripts/lib/wiki-seed.mjs --seed-self\n');
  }
}
