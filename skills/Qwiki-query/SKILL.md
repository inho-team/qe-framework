---
name: Qwiki-query
description: Two-phase wiki search — Phase A routes via routers+aliases only (never opens shards), Phase B opens minimal shards and follows [[links]] 1 hop with provenance citation. Valuable answers are filed back to .qe/wiki/queries/. Use when the user says "X 뭐 알아", "wiki에서 찾아줘", "비교해줘". NOT triggered by ingest/compile/lint.
invocation_trigger: When the user wants to search, look up, or compare information stored in the wiki.
recommendedModel: haiku
---

# Qwiki-query — Wiki 검색 (2-Phase)

## Role
`.qe/wiki/` 레이어에서 정보를 검색하는 2단계 검색 스킬.
Phase A(라우팅)와 Phase B(검색)를 분리하여 불필요한 샤드 읽기를 최소화한다.

**이 스킬은 SIVS 스테이지가 아니다.** SIVS stage 설정에 등재하지 않는다.

## Phase A: ROUTE (라우터·aliases만, 샤드 읽기 금지)

**Phase A 불변식: 샤드 파일(`indexes/{type}-*.md`)을 열지 않는다.**
라우터와 aliases.md만으로 검색 대상 샤드 집합을 결정한다.

### A-1: 쿼리 파싱
사용자 쿼리에서 추출:
- 엔티티 목록 (고유명사, 제품명, 인물 등)
- 타입 의도 (entity / concept / source / all)
- 연산 유형 (lookup / compare / summarize / list)

### A-2: 별칭 정규화
`.qe/wiki/aliases.md` 로드 → `wiki-router.mjs::parseAliasFile(text)`로 `Map` 변환 →
`normalizeAlias(term, aliasMap)`로 각 엔티티를 정본명으로 변환.
- aliases.md 부재 시 NFC 정규화만 적용.

### A-3: 샤드 집합 결정
1. 루트 라우터(`pages/index.md`) 읽기 → 관련 주제 식별.
2. 주제 라우터(`pages/{topic}/index.md`) 읽기 → 타입-인덱스 라우팅 테이블 확인.
3. `shardKey(canonical)` 로 대상 샤드 키 계산 → 최소 샤드 집합 선택.
   - 예: canonical='Apple' → shardKey='a-m' → `indexes/entities-a-m.md` 대상.
4. 동명충돌(homonym) 주석이 있으면 복수 샤드 포함.

Phase A 결과: `{ shards: string[], topic: string, operation: string }`

---

## Phase B: SEARCH (지정 샤드만, tiered read, 1-hop [[link]])

Phase A 결과의 최소 샤드 집합만 읽는다.

### B-1: Tiered read
1. **Summary 스캔**: 각 샤드의 줄별 summary만 읽어 후보 필터링.
2. **페이지 열기**: 후보 페이지(`pages/{topic}/{slug}.md`)만 전체 읽기.
3. **1-hop 링크 추적**: 본문의 `[[link]]` 중 쿼리와 관련된 것 1홉만 추가로 읽기.
   - 2홉 이상은 읽지 않는다 (컨텍스트 폭발 방지).

### B-2: Widen ladder (miss 시)
1차 결과가 없으면 단계적 확장:
1. 형제 샤드 (`a-m` miss → `n-z` 또는 `ko` 시도).
2. `grep -r {term} .qe/wiki/pages/` (전체 텍스트 grep).
3. Lazy/none: 결과 없으면 "wiki에 해당 항목 없음, `Qwiki-ingest`로 추가 가능" 안내.

### B-3: Provenance 인용
답변의 각 사실 주장에 출처 명시:
- `[[sources/slug]]` 역링크.
- provenance 등급 표시: `extracted` / `inferred (추론)` / `ambiguous (확인 필요)` / `web-enriched`.
- `tier: auto` 페이지 내용은 미확인 상태임을 표시.

---

## 파일백 (Fileback)

가치 있는 답변(복합 쿼리·비교·요약)은 `.qe/wiki/queries/{slug}.md`에 저장.
- slug: 쿼리 내용을 kebab-case로, 최대 60자.
- **경로 안전 검사**: 슬러그가 외부 입력 기반인 경우 `path.resolve` +
  `.qe/wiki` 루트 prefix 검사 → 루트 밖이면 저장 거부 (path traversal 차단).
- 단순 fact-lookup은 파일백 생략 가능.

파일백 형식:
```markdown
---
type: query
query: "{원본 쿼리}"
created: "YYYY-MM-DD"
shards_read: []
---

{답변 내용 — provenance 인용 포함}
```

---

## 트리거 경계

### 트리거해야 할 때
- "X 뭐 알아?", "X에 대해 알려줘"
- "wiki에서 찾아줘", "wiki 검색해줘"
- "A와 B 비교해줘"
- "X 관련 소스 목록 보여줘"

### 트리거하면 안 될 때
- "저장해줘" / "수집해줘" → `Qwiki-ingest`
- "위키로 정리해줘" → `Qwiki-compile`
- "wiki 점검해줘" → `Qwiki-lint`

## 불변식
- Phase A에서 샤드 파일 읽기 금지 (라우터+aliases.md만).
- 1-hop 제한: 링크 추적 최대 1단계.
- 경로 traversal 차단: 파일백 slug 등 외부 입력은 `path.resolve` + `.qe/wiki` prefix 검사.
- SIVS 비대상 utility skill.

## 참고
- `core/wiki-conventions.template.md` — §7 라우터·§8 샤딩·§13 provenance 규약
- `scripts/lib/wiki-router.mjs` — `parseAliasFile`, `normalizeAlias`, `shardKey` (Phase A에서 참조)
- `skills/Qwiki-ingest/SKILL.md` — 소스 추가 (검색 miss 후 안내)
- `skills/Qwiki-compile/SKILL.md` — inbox 처리 후 위키 내용 보강
