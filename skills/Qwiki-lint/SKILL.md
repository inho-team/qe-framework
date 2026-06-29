---
name: Qwiki-lint
description: Runs 8 checks on the wiki — structural (contradiction grep, orphans, dead links, index/router count, shard cap, tier sync) plus conventions↔wiki-router consistency plus code↔wiki freshness. Auto-fixes high-confidence issues; reports the rest. Use when the user says "wiki 점검해줘", "모순 확인해줘", "인덱스 맞나". NOT triggered by ingest/compile/query.
invocation_trigger: When the user wants to audit wiki structure, detect contradictions, or verify index consistency.
recommendedModel: sonnet
---

# Qwiki-lint — Wiki 구조 점검기

## Role
`.qe/wiki/` 레이어의 8가지 점검(구조 6 + conventions↔router + 신선도)을 실행하고, 높은
확신도(high-confidence) 문제는 자동 수정, 나머지는 보고서로 제시한다.

**이 스킬은 SIVS 스테이지가 아니다.** SIVS stage 설정에 등재하지 않는다.

---

## 8가지 점검 항목

### CHECK 1: 모순 (`⚠️ Contradiction` grep)
```
grep -rn "⚠️ Contradiction" .qe/wiki/pages/
grep -rn "⚠️ Contradiction" .qe/wiki/indexes/
```
- 발견된 모든 위치를 파일명:줄번호 형태로 목록화.
- 사람 확인 필요 항목으로 분류 (자동 수정 불가).
- 출력: `[CONTRADICTION] {file}:{line} — {설명}`.

### CHECK 2: 고아 페이지 (Orphan)
- `pages/{topic}/{slug}.md` 파일 중 어떤 라우터(`pages/**/index.md`)에서도 참조되지 않는 파일.
- 어떤 인덱스(`indexes/*.md`)에서도 링크되지 않는 entity/concept 페이지.
- 고아 목록 출력: `[ORPHAN] {path}`.
- 자동 수정: 라우터 복구가 명확한 경우(주제 폴더가 존재) → 주제 라우터 목록에 추가 제안.

### CHECK 3: 죽은 링크 (Dead links)
모든 `[[link]]` 패턴 추출 → 대응 파일 존재 확인.
- `[[entities/slug]]` → `pages/{topic}/{slug}.md` (frontmatter `type: entity`) 또는
  `indexes/entities*.md` 줄에 존재하는지.
- `[[sources/slug]]` → **`pages/{topic}/{slug}.md` 중 frontmatter `type: source`인 파일**과
  매칭(여러 topic 폴더를 순회; `sources/`는 논리적 네임스페이스이지 물리 폴더가 아님).
  컴파일 전 원본은 `.qe/wiki/raw/{slug}.*` 폴백 — 단, raw는 링크 대상이 아니라 provenance 보관소.
- `[[concepts/slug]]` → `pages/{topic}/{slug}.md` (frontmatter `type: concept`).
- 미해결 링크: `[DEAD-LINK] {source_file} → [[{target}]]`.
- 자동 수정: 링크 대상이 aliases.md에 별칭으로 있으면 → 정본명 링크로 교체 제안.

### CHECK 4: 인덱스/라우터 개수 정합
각 주제별:
- 루트 라우터(`pages/index.md`)의 페이지 수 선언값.
- 실제 `pages/{topic}/` 파일 수 (index.md 제외).
- `indexes/{type}.md` 줄 수.
- 불일치 시: `[COUNT-MISMATCH] {topic}: router says {N}, actual {M}`.
- 자동 수정: 실제 파일 수로 라우터 업데이트 (숫자만 변경, 구조 유지).

### CHECK 5: 샤드 토큰 상한 (`wiki-router.mjs`)
각 `indexes/*.md` 파일:
- `shardCapExceeded(fileContent)` 호출 → true이면 경고.
- `[SHARD-OVERFLOW] {file}: estimated ≥ {budget} tokens (cap 50K × 65%)`.
- 자동 수정 불가 — 사람이 `shardKey(canonical)` 로 분기 키 확인 후 수동 분기.
- 분기 키 테이블이 라우터에 없으면 추가 제안.

### CHECK 6: Tier 동기화 (+ 인덱스 줄 비정규화 동기 — Phase 7)
- `tier: auto` 페이지 목록: `.qe/wiki/pages/` 에서 `tier: auto` frontmatter 수집.
- 자동 생성 레지스트리(`pages/auto-generated.md`)와 대조.
- `pages/auto-generated.md`가 없으면 생성 (tier: auto 페이지 목록으로 초기화).
- `tier: reviewed` 인데 소크라테스 게이트 통과 기록이 없는 페이지: `[TIER-UNVERIFIED] {path}`.
- **인덱스 줄 동기(거버넌스)**: `indexes/{type}.md`의 `(tier:X)` == 해당 페이지 frontmatter `tier`,
  그리고 줄의 `flag:contradiction` ⇔ 본문 `⚠️ Contradiction` 존재(CHECK 1 grep 결과 재사용)인지 검사.
  불일치: `[TIER-LINE-DESYNC] {ref}` / `[FLAG-DESYNC] {ref}`. (승격/모순해소 후 줄 미재기입 탐지)

### CHECK 7: conventions.md ↔ wiki-router.mjs 불일치

`core/wiki-conventions.template.md` (또는 `.qe/wiki/conventions.md`)와
`scripts/lib/wiki-router.mjs`의 핵심 상수·정책이 일치하는지 검사.

점검 항목:
| conventions 항목 | wiki-router 대응 |
|-----------------|----------------|
| 샤드 상한 50K 토큰 | `SHARD_CAP_TOKENS = 50_000` |
| 보수 예산 60–70% | `BUDGET_FACTOR = 0.65` |
| 한글 → 별도 namespace 샤드 | `isHangul()` → `'ko'` 반환 |
| NFC 정규화 우선 | `canonical.normalize('NFC')` |
| 별칭 lookup 방향 (별칭→정본명) | `normalizeAlias(term, aliasMap)` |

불일치 발견 시:
- `[CONVENTIONS-MISMATCH] {항목}: conventions says {X}, wiki-router says {Y}`.
- **wiki-router.mjs를 실행 권위로 우선시** — conventions 파일 수정 제안.
- 자동 수정: 명백한 숫자 상수 불일치는 conventions 파일에서 수정 가능.

### CHECK 8: 신선도 (코드↔wiki 드리프트 — Phase 7)
`scripts/lib/wiki-freshness.mjs`로 코드 변경 대비 stale 페이지를 탐지한다.
- 신호: 페이지 `updated` vs `.qe/analysis/` 스냅샷 mtime(Erefresh가 코드 변경시에만 재기록).
- **대상**: `source_file` 보유 또는 `provenance: extracted` 페이지만. `type: concept`·무코드 페이지 제외(오탐 방지).
- `node scripts/lib/wiki-freshness.mjs` 실행 → `[STALE] {page} (updated: ...)` 보고. 자동 수정 불가(사람 검토).
- `.qe/wiki` 또는 `.qe/analysis` 없으면 skip(graceful).

---

## 실행 절차

### Step 1: 점검 환경 준비
`.qe/wiki/` 존재 확인 → 없으면 "wiki가 초기화되지 않음" 보고 후 종료.

### Step 2: 8가지 점검 순차 실행
각 점검 결과를 누적.

### Step 3: 자동 수정 적용
high-confidence 항목만:
- COUNT-MISMATCH: 라우터 숫자 업데이트.
- DEAD-LINK (aliases 해결 가능): 링크 교체.
- ORPHAN (라우터 복구 명확): 추가.
- CONVENTIONS-MISMATCH (상수): conventions 파일 업데이트.

수정 전 사용자에게 변경 목록 미리 보여주고 확인 (auto-fix 모드 아닌 경우).

### Step 4: 보고서 출력
```
=== Qwiki-lint 결과 ===
[CHECK 1] 모순: {N}건
[CHECK 2] 고아 페이지: {N}건 ({K}건 자동 수정)
[CHECK 3] 죽은 링크: {N}건 ({K}건 자동 수정)
[CHECK 4] 개수 불일치: {N}건 ({K}건 자동 수정)
[CHECK 5] 샤드 상한 초과: {N}건
[CHECK 6] Tier 불일치: {N}건
[CHECK 7] conventions↔router 불일치: {N}건 ({K}건 자동 수정)
[CHECK 8] 신선도(stale 페이지): {N}건 · 줄/frontmatter tier·flag desync: {N}건

수동 조치 필요: {total}건
```

---

## 트리거 경계

### 트리거해야 할 때
- "wiki 점검해줘", "위키 검사해줘"
- "모순 확인해줘", "⚠️ Contradiction 찾아줘"
- "인덱스 맞나", "링크 깨진 거 있어?"
- "샤드 한도 넘었나"

### 트리거하면 안 될 때
- "저장해줘" → `Qwiki-ingest`
- "위키로 정리해줘" → `Qwiki-compile`
- "wiki에서 찾아줘" → `Qwiki-query`

## 불변식
- 자동 수정은 high-confidence 항목만 — 모순·샤드 분기·tier는 사람 판단 필요.
- SIVS 비대상 utility skill.
- wiki-router.mjs가 실행 권위: conventions 불일치 시 router가 옳다.

## 참고
- `core/wiki-conventions.template.md` — §7 라우터·§8 샤딩·§13 provenance·§14 소크라테스 규약
- `scripts/lib/wiki-router.mjs` — `shardCapExceeded`, `shardKey` (CHECK 5·7에서 참조)
- `skills/Qwiki-compile/SKILL.md` — 모순/고아 생성 원인 파악 시 참조
