# Wiki Conventions (seed template)
<!-- This file is the framework-level seed. Qwiki-compile copies it to
     .qe/wiki/conventions.md on first run for per-project evolution.
     The executable authority for canonicalization and sharding is
     scripts/lib/wiki-router.mjs — this document describes what it implements. -->

## 개요

이 conventions는 llm-wiki §2/§7/§8/§13/§14를 QE `.qe/wiki/` 레이어에 이식한
프로젝트별 규약서다. Qwiki-ingest/compile/query/lint가 이 파일을 소비하고,
`scripts/lib/wiki-router.mjs`(샤딩·정본화 실행 권위)와 **항상 일치** 상태를 유지해야 한다.
Qwiki-lint가 두 파일 간 불일치를 주기적으로 검사한다.

---

## §2 Frontmatter 스펙

### source 페이지
```yaml
---
type: source
title: "원문 제목"
source_file: ".qe/wiki/raw/YYYY-MM-DD-slug.md"   # compile 후 raw 이동된 경로
topic: "주제 폴더명 (pages/{topic}/)"
summary: "1-2문장 요약. 5-10개 키워드 포함. ★ indexes/sources.md 줄 설명으로 재사용됨."
ingested: "YYYY-MM-DD"
author: ""          # 알 수 없으면 빈 문자열
url: ""             # 원본 URL (있을 경우)
tags: []
provenance: extracted   # extracted | inferred | ambiguous | web-enriched
---
```

### entity 페이지
```yaml
---
type: entity
canonical: "정본명 (라우팅 키 — 첫 글자가 샤드키 결정)"
aka: []             # 별칭 목록 (aliases.md로 동기화)
topic: "주제 폴더명"
summary: "★ indexes/{type}.md 줄 설명으로 verbatim 재사용. 1-2문장."
tags: []
sources: []         # ["[[sources/slug]]", ...]
tier: auto          # reviewed | auto
provenance: extracted   # extracted | inferred | ambiguous | web-enriched
status: active      # active | stub | deprecated
updated: "YYYY-MM-DD"
---
```

### concept 페이지
```yaml
---
type: concept
canonical: "정본명"
aka: []
topic: "주제 폴더명"
summary: "★ indexes/concepts.md 줄 설명으로 verbatim 재사용."
tags: []
sources: []
tier: auto
provenance: extracted
status: active
updated: "YYYY-MM-DD"
---
```

### frontmatter 불변식
- `summary`는 인덱스 줄 설명 원천 — 변경 시 해당 index 파일도 동기화 필요.
- `canonical`의 첫 글자가 `wiki-router.mjs::shardKey()`의 샤드 결정 입력이다.
- `tier: reviewed`는 소크라테스 게이트를 통과한 사람 확인 완료 상태만 사용.
- `provenance`는 4등급(§13): `extracted`(문서 직접 인용) / `inferred`(추론) /
  `ambiguous`(출처 불분명) / `web-enriched`(외부 보강).

---

## §7 라우터 (MOC — Map of Contents)

라우터는 **의도→타입/샤드 안내자**이며 엔티티 카탈로그가 아니다.
엔티티 목록은 `indexes/{type}.md`에만 존재한다.

### 루트 라우터 — `pages/index.md`
- 주제 목록 + 주제별 페이지 수 (`pages/{topic}/` 기준 집계).
- 새 주제 생성 시 Qwiki-compile이 자동 갱신.
- 동명충돌(homonym) 주석: 같은 canonical이 여러 주제에 걸쳐 있을 때 명시.
- 저장된 쿼리 링크(`queries/`).

### 주제 라우터 — `pages/{topic}/index.md`
- 의도→타입-인덱스 라우팅 테이블: `"X를 찾으면" → indexes/entities.md#X`.
- 동명 충돌 주석.
- 바닥 총계(footer totals): 해당 주제의 entity/concept/source 수.

### 라우터 불변식
- 라우터에 엔티티 직접 나열 금지 (Qwiki-lint 검사 대상).
- Qwiki-query Phase A는 라우터+aliases.md만 읽고, 샤드는 Phase B에서만 접근.

---

## §8 샤딩 (≤50K 토큰)

`indexes/{type}.md`는 엔티티 카탈로그 파일이다.
각 줄 형식: `- [[entities/slug]] (tier:reviewed|auto[,flag:contradiction]) — {summary verbatim}`
- **tier/flag 토큰은 `—` 앞 앵커**(거버넌스 소비측 wiki-retrieve가 본문 안 읽고 줄에서 가중·제외). summary 안에 금지.
- 줄-tier는 페이지 frontmatter tier와 동기(Qwiki-lint CHECK 6). 승격/모순해소 시 줄 재기입.

### 샤드 분기 기준
- 타입 인덱스가 토큰 상한(50K)에 근접하면 분기.
- 분기 키: canonical 첫 글자.
  - 라틴 소문자 `a–z` → `indexes/{type}-a-m.md` / `indexes/{type}-n-z.md` (편의 분기점, 조정 가능).
  - 한글 (U+AC00–U+D7A3 또는 자모) → 별도 namespace 샤드 `indexes/{type}-ko.md`.
  - 기타(숫자·기호 등) → `indexes/{type}-misc.md`.
- 분기 키 테이블은 주제 라우터(`pages/{topic}/index.md`)에 유지된다.
- 샤드 추정 실행 권위: `wiki-router.mjs::shardCapExceeded()` (휴리스틱, 보수적 60–70%).

### 샤드 불변식
- Qwiki-lint가 각 샤드 토큰 추정치를 검사하고 상한 초과 시 경고.
- 라우터 split-key 테이블과 실제 샤드 파일 목록이 일치해야 한다(Qwiki-lint 검사).

---

## §13 Provenance (출처 등급)

모든 사실 주장에 `[[sources/slug]]` 역링크 필수.

| 등급 | 의미 | 마킹 |
|------|------|------|
| `extracted` | 원문에서 직접 인용 | 별도 마킹 없음 |
| `inferred` | 원문 맥락에서 추론 | `(추론)` 표기 |
| `ambiguous` | 출처 불분명 | `(확인 필요)` 표기 |
| `web-enriched` | 외부 소스로 보강 | `(web-enriched)` + 소스 링크 |

- `inferred`/`ambiguous` 주장은 소크라테스 게이트 대상 — 사람 확인 전까지 사실로 단정 금지.
- QE OUTPUT_STYLE(사실/추정 분리)과 정합: 추론은 "추정" 레이블로 명시.

---

## §14 소크라테스 게이트

LLM은 수동 수용자가 아닌 비판자로 동작한다.

### 게이트 트리거 조건
- `provenance: inferred` 또는 `ambiguous` 클레임
- 기존 wiki 내용과의 모순 (`⚠️ Contradiction` 태그)
- compile 중 발견된 미해결 질문

### 게이트 동작
1. 해당 클레임을 compile 요약 마지막에 모아서 사람에게 제시.
2. 사람 확인 후 `tier: reviewed`로 승격 가능.
3. 배치 모드(Qwiki-compile --batch)는 게이트를 생략하고 auto 상태 유지.

### 모순 태그
본문에 `⚠️ Contradiction: {설명}` 형태로 인라인 삽입.
Qwiki-lint가 `grep -rn "⚠️ Contradiction"` 으로 목록화하고 리포트.

---

## 고정 본문 섹션

### source 페이지 고정 섹션
```
**TL;DR:** {1-3줄 핵심 요약}

## Key claims
{핵심 주장 목록}

## Entities & concepts
{언급된 엔티티/개념 → [[link]] 형태}

## How this updated the wiki
{컴파일 시 추가/수정된 페이지 목록}

## Notable quotes
{주목할 인용문}
```

### entity/concept 페이지 고정 섹션
```
**정의:** {BLUF — 한 줄 정의}

## 요약
{2-5줄 요약}

## Key facts
{사실 목록, 각 항목에 [[sources/...]] 역링크}

## 관계
{연결된 엔티티/개념 [[links]]}

## Open questions / 모순
{미해결 질문, ⚠️ Contradiction 포함}

## Sources
{[[sources/...]] 목록}
```

빈 섹션은 삭제하지 않고 `_(아직 없음)_` 으로 유지 (greppability).

---

## 링크 규약

- 내부 링크: `[[entities/slug]]`, `[[sources/slug]]`, `[[concepts/slug]]`
- 페이지 분리 기준: 단일 페이지 ~1500 토큰 상한. 초과 시 `[[links]]`로 분기.
- 인덱스 페이지(`indexes/{type}.md`)는 summary 줄만 — 상세 내용은 각 페이지.

---

## aliases.md

`.qe/wiki/aliases.md` 형식 (둘 다 허용):
```
별칭1 → canonical_정본명          # 화살표(→ 또는 ->) 구분, # 주석/빈줄 무시
별칭2 -> canonical_정본명
```
마크다운 표 형식도 허용:
```
| 별칭 | 정본명 |
| --- | --- |
| Parasite | 기생충 |
```
- **`wiki-router.mjs::parseAliasFile(text)`** 가 이 파일을 `Map<별칭,정본명>`으로 파싱(단일 권위 파서),
  `normalizeAlias(term, map)`가 그 Map을 소비. 각 Qwiki 스킬은 이 두 함수를 사용한다(인라인 파서 작성 금지).
- Qwiki-compile이 새 별칭 추가 시 이 파일을 갱신.
- Qwiki-query Phase A가 엔티티 해석 시 참조.

---

## wiki-router.mjs 정합 의무

이 conventions와 `scripts/lib/wiki-router.mjs`는 항상 일치해야 한다:
- 샤드 분기 기준(한글 namespace, 첫 글자 라틴 분기)
- 토큰 추정 상한(50K, 보수 60–70% 예산)
- NFC 정규화 우선 적용
- `normalizeAlias` lookup 방향 (별칭 → 정본명)

Qwiki-lint가 이 파일과 wiki-router.mjs 간 핵심 상수/정책 불일치를 검사한다.
불일치 발견 시 wiki-router.mjs를 실행 권위로 우선시하고 이 파일을 수정한다.

---

## Cross-layer links (기존 QE 지식 레이어와의 경계 — D-WIKI-02)

wiki는 QE의 다른 지식 레이어를 **대체하지 않고 잇는다**. 책임 경계:

| 레이어 | 책임 | wiki와의 관계 |
|--------|------|---------------|
| `Qmemory` (`.qe/project-memory.json`) | 휘발성 사실 카드 (TTL 만료, 단문) | wiki가 같은 사실을 다루면 **wiki가 정본**, 메모리는 포인터/단기 캐시 |
| `Qcontext` (`.qe/context/`) | 작업 디렉터리별 CLAUDE.md 조각 로딩 | 직교 — 컨텍스트 로딩 ≠ 지식 축적. wiki는 참조만 |
| `.qe/analysis/` (Qrefresh) | 코드 구조 스냅샷 (자동 파생, 덮어씀) | **코드는 raw 소스가 아니다** — analysis를 wiki `sources/`로 승격하지 않는다. wiki 페이지가 필요 시 `[[link]] 아닌 경로 참조`로 가리킨다 |

**불변식 (NFR2 — 중복 금지):**
- 같은 사실이 wiki와 다른 레이어 양쪽에 **물리적으로 복제되면 안 된다.** wiki가 정본이면
  나머지는 가리키기만 한다.
- analysis(자동 파생)는 provenance `extracted` 소스가 아니다 — wiki sources로 올리지 않는다.
- `understand-knowledge`(그래프 시각화)는 **보완 도구**다. wiki를 입력으로 그래프를 그릴 수
  있으나, 그래프는 wiki를 대체하지 않는다(시각화 vs 유지되는 정본).

---

## 플라이휠 적재 (self-seed — work → wiki, D-WIKI-03)

프레임워크 자신의 지식 산출물을 wiki로 적재해 복리로 키운다. `wiki-seed --seed-self`가 수행:

- **시드 대상**: `DECISION_LOG.md` · `MISTAKE.md` · `plans/<plan>/phases/<n>/RETROSPECTIVE.md` **뿐**.
- **제외(중요)**: `.qe/analysis/*`(자동 파생 코드 스냅샷 — D-WIKI-02), `.qe/wiki/` 내부(queries·pages 등
  wiki 파생 출력 — 자기수집 루프 차단).
- **자기참조 게이트**: 시드는 `seed_origin: framework-self` + `seed_provenance: inferred`로 적재되고,
  compile은 이를 `provenance: inferred`(=`(추론)` + 소크라테스 게이트)로 합성하며 **`--batch`로 게이트를
  우회하지 않는다**. AI가 쓴 지식을 AI가 사실로 되읽는 오류 복리를 차단한다.
- **멱등**: `.qe/wiki/.seed-state.json`(`파일→해시`)로 파일당 1 source를 supersede-in-place(중복 0).
- **트리거 정책**: 시드는 **수동(`wiki-seed --seed-self`) 또는 마일스톤 경계에서만** 실행한다.
  **자동 훅으로 매번 돌리지 않는다**(폭주·노이즈·stale 적재 방지). 적재 후 `/Qwiki-compile`로 합성한다.
