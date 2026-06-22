---
name: Qwiki-compile
description: Processes .qe/wiki/inbox/ items into wiki pages — synthesizes source summaries, extracts entities/concepts, canonicalizes via wiki-router, updates routers/indexes/overview, moves originals to raw/, runs Socratic gate, then commits via Qcommit. Use when the user says "위키로 정리해줘", "컴파일해줘", "inbox 처리해줘". NOT triggered by ingest/query/lint or raw file edits.
invocation_trigger: When the user wants to process the wiki inbox and synthesize new wiki pages from staged sources.
recommendedModel: sonnet
---

# Qwiki-compile — Wiki 합성 엔진

## Role
`.qe/wiki/inbox/`의 미처리 소스를 읽어 wiki 페이지(source/entity/concept)를 합성하고,
라우터·인덱스·overview를 갱신한 뒤 Qcommit으로 커밋하는 핵심 처리 루프.

**중요: 이 스킬은 SIVS 스테이지가 아니다 (Claude-only).** SIVS stage 설정에 등재하지 않는다.
**raw `git commit` 호출 금지.** 커밋은 반드시 Qcommit → Ecommit-executor 경유.

## 실행 절차

### Step 0: conventions + 환경 로드
1. `.qe/wiki/conventions.md` 읽기 (없으면 `core/wiki-conventions.template.md`를 복사 후 사용).
2. `.qe/wiki/aliases.md` 읽기 → `wiki-router.mjs::parseAliasFile(text)`로 `Map`(별칭→정본명) 변환 (없으면 빈 Map).
3. `scripts/lib/wiki-router.mjs` 기능 참조 확인.
4. inbox 파일 목록 수집: `.qe/wiki/inbox/*.md` (ingested 날짜 오름차순).

inbox가 비어 있으면 "inbox 비어 있음" 보고 후 종료.

### Step 1: 소스 요약 합성 (source 페이지)
inbox 파일별:
1. 본문 읽기 + 기존 wiki(`pages/`)에서 관련 컨텍스트 참조.
2. `core/wiki-templates/source.md` 기반으로 source 페이지 초안 작성:
   - `summary`: 1-2문장 + 5-10 키워드 (indexes/sources.md 줄로 재사용됨).
   - `**TL;DR:**`, `## Key claims`, `## Entities & concepts`, `## How this updated the wiki`, `## Notable quotes` 섹션 채우기.
   - 빈 섹션은 `_(아직 없음)_` 유지.
3. provenance 표시: 직접 인용 = `extracted`, 추론 = `inferred (추론)`.
4. 저장 경로: `.qe/wiki/pages/{topic}/{slug}.md`

### Step 2: 엔티티·개념 추출 + 정본화 (canonicalize)
source 페이지 `## Entities & concepts` 기반:
1. 엔티티/개념 후보 목록 추출.
2. 각 후보에 대해:
   a. `aliases.md`를 통해 `normalizeAlias(term, aliasMap)` 호출 → 정본명 획득.
   b. 기존 `indexes/entities.md` / `indexes/concepts.md` 에서 중복 검사 (dedup-check before create).
   c. 전역 2회 이상 등장 → 독립 페이지 생성(`core/wiki-templates/entity.md` 또는 `concept.md` 사용).
   d. 1회 등장 → 해당 source 페이지에 plain-text seed만 남기고 나중에 승격 (lazy).
3. 새 정본명이 aliases.md에 없으면 추가.
4. **경로 안전 검사**: 외부 입력(slug, canonical명)으로 경로 구성 시 `path.resolve` +
   `.qe/wiki` 루트 prefix 검사 → 루트 밖이면 즉시 중단 (path traversal 차단).

### Step 3: 라우터 / 타입 인덱스 / overview 갱신
1. **루트 라우터** (`pages/index.md`): 주제 목록 + 페이지 수 업데이트.
2. **주제 라우터** (`pages/{topic}/index.md`): 의도→타입-인덱스 라우팅 테이블 + footer totals 갱신.
   - 라우터에 엔티티 직접 나열 금지 (conventions §7).
3. **타입 인덱스** (`indexes/{type}.md`):
   - 각 줄: `- [[entities/slug]] (tier:reviewed|auto) — {summary verbatim}`.
     **tier 토큰은 `—` 앞에만**(거버넌스 소비측이 본문 안 읽고 줄에서 가중). summary 안에 `(tier:..)`/`flag:` 금지.
   - 모순 보유 페이지(`⚠️ Contradiction` 삽입됨, **Step 4 태깅 후**)는 `(tier:auto,flag:contradiction)`로 표기 →
     wiki-retrieve가 hard-exclude.
   - **줄-tier == frontmatter tier 동기 필수.** tier 승격(auto→reviewed)·모순 해소 시 **해당 줄을 재기입/flag 제거**
     (Qwiki-lint CHECK 6이 줄↔frontmatter tier·flag 동기를 점검).
   - `shardCapExceeded(text)` 로 샤드 상한 검사 → 초과 시 `shardKey(canonical)` 로 샤드 분기.
   - 분기 키 테이블을 주제 라우터에 업데이트.
4. **overview** (`pages/{topic}/overview.md`): 주제 수준 요약 갱신.
   템플릿: `core/wiki-templates/overview.md` 기반(없으면 신규 생성).
5. **auto-generated 대장** (`pages/auto-generated.md`): 이번 compile에서 만든 `tier: auto`
   페이지(lazy/web-enriched)를 대장에 등재한다. 파일이 없으면 생성한다(헤더 + 표). 사람이
   검수해 `tier: reviewed`로 승격하면 대장에서 제거. **Qwiki-lint CHECK 6이 이 대장을 검증만
   하므로(부트스트랩 아님), 생성·유지는 compile의 책임이다.**

### Step 4: 원본 raw 이동
inbox 파일 → `.qe/wiki/raw/{원본파일명}` 이동 (파일명 유지).
- raw는 불변 — 이동 후 수정 금지.
- source 페이지 frontmatter `source_file` 필드를 raw 경로로 업데이트.
- **경로 안전 검사**: raw 대상 경로도 `.qe/wiki` 루트 prefix 검사.

### Step 5: 소크라테스 게이트 (Socratic gate)
컴파일 중 발견된 항목 목록화:
- `provenance: inferred` 또는 `ambiguous` 클레임.
- 기존 wiki 내용과의 모순 (`⚠️ Contradiction: ...` 태그 삽입된 항목).
- 미해결 질문 (`## Open questions` 섹션).

**Self-seed 규칙 (`seed_origin: framework-self`):** 소스 frontmatter에 `seed_origin: framework-self`가
있으면(wiki-seed가 적재한 프레임워크 자기-아티팩트), 합성 페이지는 **반드시 `provenance: inferred`**
(=`(추론)` 마킹 + 소크라테스 게이트 대상)로 만들고, **이 소스에는 `--batch`를 적용하지 않는다**(게이트 우회
금지 — AI가 쓴 지식을 AI가 사실로 되읽는 자기참조 세탁 차단, D-WIKI-03). `extracted`로 승격 금지.

**--batch 모드**: 게이트 생략, 모든 항목 `tier: auto` 유지. **단 `seed_origin: framework-self` 소스는
--batch에서도 게이트를 건너뛰지 않는다**(위 규칙 우선).
**인터랙티브 모드** (기본): 목록을 사용자에게 제시하고 확인 요청.
- 사용자 확인 후 → `tier: reviewed` 로 승격.
- 미확인 → `tier: auto` + `(추론)` / `(확인 필요)` 표기 유지.

### Step 6: Qcommit 핸드오프 (종결 단계)
**Qcommit 핸드오프는 이 워크플로우의 마지막 단계다.**
bypass TTL(120초) 이내에 커밋이 완료되어야 하므로 핸드오프와 커밋 사이에
장시간 작업을 끼워 넣지 않는다.

Qcommit에 전달할 정보:
- 변경 파일 목록 (pages/**, indexes/**, raw/**, aliases.md, pages/index.md)
- 커밋 메시지 힌트: `wiki: compile {N} source(s) → {K} pages, {M} entities`

**금지**: 직접 `git commit` 호출. hooks/scripts/pre-tool-use.mjs가 하드블록함.

## 트리거 경계

### 트리거해야 할 때
- "위키로 정리해줘", "컴파일해줘"
- "inbox 처리해줘", "수집한 거 위키에 넣어줘"
- "wiki 업데이트해줘"

### 트리거하면 안 될 때
- "저장해줘" / "수집해줘" → `Qwiki-ingest`
- "wiki에서 찾아줘" → `Qwiki-query`
- "wiki 점검해줘" → `Qwiki-lint`
- "원본 파일 고쳐줘" → raw 불변; 수정 불가

## 불변식
- raw 파일 불변: `raw/`에 이동된 파일은 수정하지 않는다.
- Qcommit 경유 커밋: raw `git commit` 절대 금지.
- 경로 traversal 차단: 외부 입력 기반 경로는 반드시 `path.resolve` + `.qe/wiki` prefix 검사.
- SIVS 비대상: Claude-only 스킬. stage 설정 미등재.

## 참고
- `core/wiki-conventions.template.md` — frontmatter·라우터·샤딩·provenance 규약
- `core/wiki-templates/` — source/entity/concept 페이지 템플릿
- `scripts/lib/wiki-router.mjs` — 정본화·샤딩 실행 권위 (`parseAliasFile`, `normalizeAlias`, `shardKey`, `shardCapExceeded`)
- `skills/Qcommit/SKILL.md` — 커밋 위임 대상
- `agents/Ecommit-executor.md` — 실제 git 작업 수행자 (bypass TTL 관리)
