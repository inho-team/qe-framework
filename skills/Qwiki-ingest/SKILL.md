---
name: Qwiki-ingest
description: Saves a URL, file, or raw text to .qe/wiki/inbox/ as a dated markdown stub — no wiki-ization. Binary files (docx/pptx/xlsx/pdf) are converted via markitdown if available; graceful stub saved when markitdown is absent. Use when the user says "넣어줘", "수집해줘", "이 URL 가져와", "wiki에 추가해줘". NOT triggered by compile/query/lint, or "원본 고쳐줘" (raw is immutable).
invocation_trigger: When the user wants to add a URL, file, or text to the wiki queue without processing it yet.
recommendedModel: haiku
---

# Qwiki-ingest — Wiki Inbox 수집기

## Role
외부 소스(URL / 파일 / 텍스트)를 `.qe/wiki/inbox/`에 **저장만** 하는 최경량 수집기.
위키화(페이지 합성·엔티티 추출·라우터 갱신)는 수행하지 않는다.
위키화를 원하면 `Qwiki-compile`을 사용한다.

## 저장 형식
파일명: `.qe/wiki/inbox/YYYY-MM-DD-{slug}.md`
- `slug`: 제목·파일명·URL을 소문자 kebab-case로 변환, 최대 60자.
- 날짜: 수집 시점 ISO 날짜 (오늘).

## 실행 절차

### Step 0: 경로 안전 검사
외부 입력(파일명, slug, URL에서 파생된 이름)으로 경로를 구성할 때:
1. `path.resolve(wikiRoot, 'inbox', filename)` 으로 절대 경로 계산.
2. 결과 경로가 `.qe/wiki/` 루트 아래에 있는지 prefix 검사.
3. 벗어나면 즉시 중단하고 오류 보고 (path traversal 차단).

### Step 1: 소스 유형 판별
| 소스 | 처리 |
|------|------|
| URL | HTTP GET 또는 사용자 클립보드 텍스트 |
| 텍스트 파일 (`.md`, `.txt`) | 그대로 읽기 |
| 바이너리 파일 (`.docx`, `.pptx`, `.xlsx`, `.pdf`) | markitdown 변환 시도 → 실패 시 stub |
| 인라인 텍스트 | 그대로 저장 |

### Step 2: 바이너리 변환 (markitdown opt-in)
```
markitdown {file} → {slug}.md 변환 시도
```
- markitdown 설치 여부 확인: `markitdown --version` (또는 `which markitdown`).
- **markitdown 부재 시 graceful degrade**:
  - 원본 파일은 `.qe/wiki/raw/assets/{filename}` 에 복사 (불변 보관).
  - inbox에 stub `.md` 저장: 제목·원본 경로·미변환 사유 기재.
  - 파이프라인 비차단(non-blocking) — 수집 성공으로 처리.
  - 키(LlamaParse 등 클라우드 변환)는 Qsecret 경유로만 주입; 평문 저장 금지.
- markitdown 성공 시: 변환된 `.md`를 inbox에 저장, 원본은 `raw/assets/`에 보관.

### Step 3: inbox 파일 작성
```markdown
---
type: inbox
title: "{제목}"
source: "{URL 또는 원본 파일 경로}"
ingested: "{YYYY-MM-DD}"
status: uncompiled
---

{본문 — 원문 내용 또는 markitdown 변환 결과}
```
- `status: uncompiled` 고정 (compile 전 상태 표시).
- 경로 안전 검사(Step 0)를 통과한 경로에만 쓴다.

### Step 4: 결과 보고
- 저장된 파일 경로 출력.
- markitdown 미설치 stub이면 그 사실과 `raw/assets/` 원본 경로를 명시.
- 대기 중인 inbox 파일 수 출력 ("inbox에 N개 대기 중 — `Qwiki-compile`로 처리 가능").

## 트리거 경계

### 트리거해야 할 때
- "이 URL wiki에 넣어줘", "수집해줘", "저장해줘"
- "이 파일 inbox에 추가해"
- "나중에 처리할 거니까 일단 저장만 해줘"

### 트리거하면 안 될 때
- "위키로 정리해줘" / "컴파일해줘" → `Qwiki-compile`
- "wiki에서 찾아줘" / "검색해줘" → `Qwiki-query`
- "wiki 점검해줘" → `Qwiki-lint`
- "원본 파일 수정해줘" → raw는 불변; 수정 불가
- "git commit" → 이 스킬은 커밋하지 않음

## 불변식
- raw 파일 불변: 한 번 `raw/` 또는 `raw/assets/`에 들어간 원본은 수정하지 않는다.
- 이 스킬은 SIVS 스테이지가 아니다 (Claude-only). SIVS stage 설정에 등재하지 않는다.
- 외부 입력 기반 경로는 항상 `path.resolve` + `.qe/wiki` 루트 prefix 검사를 거친다.

## 참고
- `core/wiki-conventions.template.md` — frontmatter 스펙
- `scripts/lib/wiki-router.mjs` — 정본화·샤딩 실행 권위 (ingest 단계에서는 사용 안 함)
- `skills/Qwiki-compile/SKILL.md` — inbox 처리 후속 단계
