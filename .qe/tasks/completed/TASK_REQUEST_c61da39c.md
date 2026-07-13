# TASK_REQUEST_c61da39c.md — qe-mcp high-risk expert refresh

<!-- qgs-plan: qe-mcp-expert-refresh -->
<!-- qgs-phase: Phase 2 - High-Risk Expert Refresh -->
<!-- task-type: other -->

## 무엇을 원하는가?

Phase 2의 high-risk expert 10개를 최신 major/version 기준으로 갱신하고, 각 expert의 review metadata를 Phase 1 schema에 맞춰 source-backed evidence로 남긴다. 목표는 stale expert를 삭제하지 않고, 현재 기준으로 믿을 수 있는 expert는 `trusted-current`, 불확실하거나 provider 변동성이 큰 expert는 `use-with-caution` 또는 `legacy`로 명확히 분류하는 것이다.

이 작업은 application code 변경은 아니지만, authoritative expert source와 recommendation metadata를 바꾸는 content/config 변경이다. 따라서 TDD/OWASP code gate 대신 source ownership, dirty repo, generated index integrity, recommendation lifecycle, rollback을 검증 대상으로 삼는다.

## 어떻게 만들 것인가?

Phase 1 산출물을 source of truth로 사용한다. core expert는 `../qe-mcp`, extra expert는 `../qe-experts-extra`의 authoritative source를 수정한다. 각 expert는 공식 문서 또는 registry 명령으로 current major/version을 재검증하고, source URL/명령/source date를 review evidence에 기록한 뒤 `SKILL.md` 본문과 pack index metadata를 갱신한다. Installed/global copy는 runtime evidence일 뿐 authoritative source가 아니므로 직접 편집하지 않는다.

## 사전 확인된 전제

- Qmcp ensure: PASS.
- Phase 1 inventory: 86 experts, core 25, extra 61, divergence `in-sync`, cross-pack collision 0.
- Phase 1 default lifecycle: missing metadata defaults to `use-with-caution`.
- Authoritative source ownership:
  - core: `../qe-mcp/expert-library/packs/core-experts/skills/*/SKILL.md`
  - extra: `../qe-experts-extra/experts/*/SKILL.md`
- Registry/API spot checks on 2026-07-13. 아래 값은 실행 전제 확인용 예시이며 authoritative current version이 아니다. 실행자는 execution date 기준으로 registry/API와 official docs를 fresh reverify해야 한다.
  - `npm view next version` -> `16.2.10`
  - `npm view @angular/core version` -> `22.0.6`
  - `npm view vite version` -> `8.1.4`
  - `npm view vitest version` -> `4.1.10`
  - `npm view @nestjs/core version` -> `11.1.28`
  - `python3 -m pip index versions Django` -> latest `6.0.7`
  - `composer` is not installed locally; Laravel current major must be verified through Packagist API plus official Laravel docs or an available Composer environment during execution.
- Official docs discovered during premise verification:
  - Next.js 16/16.2: `https://nextjs.org/blog/next-16`, `https://nextjs.org/blog/next-16-2`
  - Angular v22: `https://angular.dev/events/v22`, release policy: `https://angular.dev/reference/releases`
  - Django 6.0: `https://docs.djangoproject.com/en/6.0/releases/6.0/`
  - Rails 8.1: `https://guides.rubyonrails.org/8_1_release_notes.html`
  - Laravel 13 release notes search result exists at `https://laravel.com/docs/13.x/releases`; execution must confirm current stable framework major before editing. `trusted-current` is allowed only when Packagist `laravel/framework` major and official Laravel stable docs branch agree.
  - Vite 8: `https://vite.dev/blog/announcing-vite8`
  - Vitest 4 migration: `https://vitest.dev/guide/migration.html`
  - NestJS 11 migration: `https://docs.nestjs.com/migration-guide`
  - OpenAI SFT/retrieval/embeddings docs: `https://developers.openai.com/api/docs/guides/supervised-fine-tuning`, `https://developers.openai.com/api/docs/guides/retrieval`, `https://developers.openai.com/api/docs/guides/embeddings`

## 실행 원칙

- 각 expert별로 `sourceDate`, `sourceUrls`, `sourceCommands`, `currentMajor`, `verifiedMajor`, `lifecycle`, `notes`를 evidence file과 index metadata에 반영한다.
- 각 evidence file은 raw command output 또는 API response summary, `accessedAt`, 가능한 경우 `sourcePublishedAt`, official-doc provenance, registry provenance, `conflict` field를 분리해 기록한다.
- `trusted-current`는 `currentMajor`와 `verifiedMajor`가 일치하고 unresolved conflict가 없을 때만 허용한다. 공식 문서 또는 registry 명령이 충돌하면 registry 값만으로 `trusted-current` 처리하지 않는다.
- 공식 문서 또는 registry 명령이 충돌하면 conflict를 `use-with-caution`으로 남기고 `notes`에 이유를 적는다.
- provider/API 변동성이 큰 AI/Data expert는 source date를 반드시 명시하고, 모델명/엔드포인트/제품명이 temporal fact임을 본문에 표시한다. AI/Data expert는 exact docs surface, model/API names, source date, residual volatility, trusted rationale가 모두 기록되지 않으면 기본값을 `use-with-caution`으로 둔다.
- `../qe-mcp`에는 현재 unrelated/concurrent dirty change가 있다. 실행자는 pre-run `git status --short`를 `qe-framework`, `../qe-mcp`, `../qe-experts-extra` 각각 기록하고, 이번 task 소유 파일 외 변경을 되돌리거나 claim하지 않는다.
- Preflight에서 10개 expected `SKILL.md` source path가 Phase 1 inventory와 일치하고 읽을 수 있는지 확인한다. missing, renamed, duplicate, unreadable이면 편집 전에 중단한다.
- Preflight에서 dirty change가 task-owned source file, generated index/manifest, package files, build/test scripts에 닿아 있으면 baseline으로 흡수하지 말고 diff를 먼저 확인해 `task-owned`, `user-owned`, `shared`로 분류한다. `user-owned` 또는 `shared` same-file change는 자동 overwrite하지 않고 abort하거나 documented merge decision을 남긴 뒤에만 편집한다. dirty file이 task surface 밖일 때만 자동 진행한다.
- Preflight에서 모든 task-owned file의 baseline hash 또는 mtime을 기록한다. 각 worker/finalizer는 쓰기 직전에 같은 파일을 재확인하고, baseline 이후 변경된 경우 자동 overwrite하지 말고 abort하거나 explicit merge decision을 summary에 남긴다.
- Items 1-10은 각자의 `SKILL.md`와 deterministic evidence file을 생성/수정한다. pack index, manifest, summary, ledger, TASK_LOG는 수정하지 않는다.
- Item 11은 evidence를 새로 생성하지 않고 Items 1-10이 만든 evidence의 uniqueness, parity, schema completeness만 검증한다.
- Phase 2 finalizer(Item 12-14)만 shared artifacts를 수정한다.
- Finalizer 시작 전 Items 1-11이 정확히 한 번 완료됐는지 확인하고 atomic `mkdir .qe/planning/plans/qe-mcp-expert-refresh/phases/2/.finalizer-c61da39c.lock`으로 lock directory를 획득한다. 획득 후 owner/run id를 lock directory 안에 기록한다. lock 획득 실패 또는 finalizer output이 이미 있으면 명시적 resume 판단 없이 두 번째 finalizer를 실행하지 않는다.
- Finalizer는 shared artifact를 쓸 때마다 직전 hash/mtime을 재확인하고, baseline 이후 바뀐 파일은 자동 overwrite하지 않는다.
- Phase 2 완료 후 core는 `cd ../qe-mcp && npm run build:index`, extra는 `../qe-experts-extra/extra-index.json` generation/update 절차를 수행한다. extra generation 명령이 없으면 source-backed manual JSON edit와 parse validation을 명시한다.
- core review metadata가 index generation 중 유실될 수 있으므로 `build:index` 후 `core-index.json`과 manifest가 refreshed expert 전부에 대해 Phase 1 review schema field를 보존하는지 post-build로 검증한다. metadata가 유실되면 우선 generator/source-of-metadata를 수정해 다음 `build:index`에서도 보존되게 한다. post-build manual injection만으로 처리해야 하는 경우 non-durable exception으로 명시하고, subsequent `build:index`에서 다시 유실되면 fail/defer하는 follow-up gate를 `PHASE_2_SUMMARY.md`에 기록한다.
- extra index를 manual edit한 경우 refreshed extra entry마다 Phase 1 schema(`.qe/planning/plans/qe-mcp-expert-refresh/phases/1/REVIEW_SCHEMA.md`)의 exact review fields, valid lifecycle enum, caution/legacy notes, evidence-file parity를 검증하고 manual/generated 여부를 기록한다.
- Extra/core index schema validation은 `jq` 또는 `node`로 JSON parse, required field presence, lifecycle enum(`trusted-current`, `use-with-caution`, `legacy`), evidence-file parity를 확인하는 concrete command를 summary에 기록한다.
- Installed/global copy는 Phase 2에서 expected-stale일 수 있다. installed/global direct read는 참고 evidence로만 쓰고, refreshed 여부 판정은 authoritative source와 local generated index 기준으로 한다.
- `qe-mcp packs status --json` count check는 inventory sanity 확인 전용이다. refreshed content correctness는 authoritative source, deterministic evidence, generated local index direct read로 판정한다.

## Task-Owned Allowlist

- Core expert sources:
  - `../qe-mcp/expert-library/packs/core-experts/skills/Qnextjs-developer/SKILL.md`
  - `../qe-mcp/expert-library/packs/core-experts/skills/Qangular-architect/SKILL.md`
  - `../qe-mcp/expert-library/packs/core-experts/skills/Qvite/SKILL.md`
  - `../qe-mcp/expert-library/packs/core-experts/skills/Qdjango-expert/SKILL.md`
  - `../qe-mcp/expert-library/packs/core-experts/skills/Qnestjs-expert/SKILL.md`
- Extra expert sources:
  - `../qe-experts-extra/experts/Qvitest/SKILL.md`
  - `../qe-experts-extra/experts/Qrails-expert/SKILL.md`
  - `../qe-experts-extra/experts/Qlaravel-specialist/SKILL.md`
  - `../qe-experts-extra/experts/Qfine-tuning-expert/SKILL.md`
  - `../qe-experts-extra/experts/Qrag-architect/SKILL.md`
- Per-expert evidence:
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qnextjs-developer.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qangular-architect.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qvite.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qvitest.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qdjango-expert.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qrails-expert.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qlaravel-specialist.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qnestjs-expert.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qfine-tuning-expert.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qrag-architect.md`
- Evidence cleanup scope:
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/*` only for classifying and removing/renaming duplicate, stale, or colliding evidence files after they are proven task-generated or safe to move. If ownership is unclear, do not delete; record deferred cleanup in `PHASE_2_SUMMARY.md`.
- Finalizer/shared artifacts only after Items 1-11 pass:
  - `../qe-mcp/expert-library/indexes/core-index.json`
  - `../qe-mcp/expert-library/packs/core-experts/manifest.json`
  - `../qe-experts-extra/extra-index.json`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/PHASE_2_SUMMARY.md`
  - `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/.finalizer-c61da39c.lock/`
  - `.qe/planning/plans/qe-mcp-expert-refresh/goals.json`
  - `.qe/planning/plans/qe-mcp-expert-refresh/ledger.jsonl`
  - `.qe/planning/plans/qe-mcp-expert-refresh/STATE.md` only via `node hooks/scripts/lib/ledger.mjs render-state --slug qe-mcp-expert-refresh`
  - `.qe/TASK_LOG.md`

## Safety Register

- Worst case: stale or inaccurate expert guidance is marked `trusted-current`, which can misroute QE recommendations.
- Data-loss risk: concurrent edits in `../qe-mcp` or `../qe-experts-extra` may be overwritten if same-file ownership is not checked.
- Generated artifact risk: `build:index` may regenerate core index/manifest and remove manually added review metadata.
- Security/permission risk: no secrets are expected; external source use must stay on official docs and registries/API endpoints.
- Concurrency risk: dirty repos and Wave workers can conflict on shared index, summary, ledger, and task log files.
- Rollback: revert only task-owned diffs listed in the allowlist. Never revert unrelated preexisting dirty changes.
- Unverified assumptions: all version numbers listed above are temporal premises and must be refreshed at execution.

## 체크리스트

- [x] `Qnextjs-developer`를 Next.js 16.2/16.x 기준으로 갱신하고 RSC/security, App Router, Turbopack/caching, agent-debugging notes를 source-backed로 반영한다. → output: ../qe-mcp/expert-library/packs/core-experts/skills/Qnextjs-developer/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qnextjs-developer.md
- [x] `Qangular-architect`를 Angular 22 기준으로 갱신하고 signal/standalone/template/testing guidance와 supported-version policy를 반영한다. → output: ../qe-mcp/expert-library/packs/core-experts/skills/Qangular-architect/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qangular-architect.md
- [x] `Qvite`를 Vite 8 기준으로 갱신하고 Node/Vite prerequisites, migration caveats, config defaults를 반영한다. → output: ../qe-mcp/expert-library/packs/core-experts/skills/Qvite/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qvite.md
- [x] `Qvitest`를 Vitest 4 기준으로 갱신하고 Vite/Node prerequisite, browser mode, coverage/migration caveats를 반영한다. → output: ../qe-experts-extra/experts/Qvitest/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qvitest.md
- [x] `Qdjango-expert`를 Django 6.0 기준으로 갱신하고 Django 5.2 LTS/legacy notes, Python requirement, migration caveats를 반영한다. → output: ../qe-mcp/expert-library/packs/core-experts/skills/Qdjango-expert/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qdjango-expert.md
- [x] `Qrails-expert`를 Rails 8.1 기준으로 갱신하고 Rails 8/7 legacy distinction, upgrade/runtime defaults, deployment/security notes를 반영한다. → output: ../qe-experts-extra/experts/Qrails-expert/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qrails-expert.md
- [x] `Qlaravel-specialist`의 current major를 공식 Laravel docs/Packagist로 재확인한 뒤 Laravel 12/13 정책을 반영하고, 불확실하면 `use-with-caution`으로 분류한다. → output: ../qe-experts-extra/experts/Qlaravel-specialist/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qlaravel-specialist.md
- [x] `Qnestjs-expert`를 NestJS 11 기준으로 갱신하고 Express v5/migration caveats, package compatibility, testing defaults를 반영한다. → output: ../qe-mcp/expert-library/packs/core-experts/skills/Qnestjs-expert/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qnestjs-expert.md
- [x] `Qfine-tuning-expert`를 현재 OpenAI fine-tuning/model-optimization docs 기준으로 갱신하고 SFT/vision/DPO/RFT 구분, deprecation caveats, source date를 표시한다. → output: ../qe-experts-extra/experts/Qfine-tuning-expert/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qfine-tuning-expert.md
- [x] `Qrag-architect`를 현재 retrieval/embeddings/vector-store docs 기준으로 갱신하고 native retrieval vs custom RAG, embedding model caveats, source date를 표시한다. → output: ../qe-experts-extra/experts/Qrag-architect/SKILL.md, .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/Qrag-architect.md
- [x] Items 1-10이 생성/수정한 deterministic review evidence를 검증한다. 각 파일은 source URLs, source commands, raw/API summary, accessedAt, sourcePublishedAt when available, official/registry provenance, current/verified major, lifecycle decision, conflict, changed sections, residual risk를 포함한다. AI/Data expert의 volatile provider/model default audit과 G020 판단을 포함한다. refreshed expert마다 정확히 하나의 evidence file만 있어야 하며 duplicate/stale/colliding evidence file이 있으면 정리 또는 deferred로 기록한다. <!-- depends_on: [c61da39c/Item#1,c61da39c/Item#2,c61da39c/Item#3,c61da39c/Item#4,c61da39c/Item#5,c61da39c/Item#6,c61da39c/Item#7,c61da39c/Item#8,c61da39c/Item#9,c61da39c/Item#10] --> → output: .qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/
- [x] Atomic finalizer lock directory를 획득한 뒤 core/extra index metadata에 Phase 1 review schema를 반영하고 generated artifacts를 검증한다. core는 먼저 `cd ../qe-mcp && npm run build:index`를 실행한 후 `../qe-mcp/expert-library/indexes/core-index.json` 및 `../qe-mcp/expert-library/packs/core-experts/manifest.json`의 metadata 보존을 검증/보강한다. metadata가 generation 중 유실되면 generator/source-of-metadata를 durable하게 수정하거나, manual injection을 non-durable exception으로 기록하고 subsequent build gate를 fail/defer 조건으로 남긴다. extra는 `../qe-experts-extra/extra-index.json`을 대상으로 한다. Items 1-10은 index를 수정하지 않으며 이 item만 index writes를 소유한다. <!-- depends_on: [c61da39c/Item#1,c61da39c/Item#2,c61da39c/Item#3,c61da39c/Item#4,c61da39c/Item#5,c61da39c/Item#6,c61da39c/Item#7,c61da39c/Item#8,c61da39c/Item#9,c61da39c/Item#10,c61da39c/Item#11] --> → output: .qe/planning/plans/qe-mcp-expert-refresh/phases/2/.finalizer-c61da39c.lock/, ../qe-mcp/expert-library/indexes/core-index.json, ../qe-mcp/expert-library/packs/core-experts/manifest.json, ../qe-experts-extra/extra-index.json
- [x] Phase 2 baseline/summary를 작성하고 `npm test`, `npm run lint:size`, JSON parse checks, direct read checks, dirty-state classification을 기록한다. `npm run build:index`는 Item 12 이후 재실행하지 않는다. 재실행이 불가피하면 core index/manifest가 no-op인지 확인하고 변경 시 fail/defer 처리한다. <!-- depends_on: [c61da39c/Item#12] --> → output: .qe/planning/plans/qe-mcp-expert-refresh/phases/2/PHASE_2_SUMMARY.md
- [x] Phase 2 goals G011-G020을 `goals.json`/`ledger.jsonl`에 반영하고 `node hooks/scripts/lib/ledger.mjs render-state --slug qe-mcp-expert-refresh`로 `STATE.md`를 재생성한 뒤 TASK_LOG를 갱신한다. `STATE.md`를 직접 편집하지 않는다. <!-- depends_on: [c61da39c/Item#13] --> → output: .qe/planning/plans/qe-mcp-expert-refresh/goals.json, .qe/planning/plans/qe-mcp-expert-refresh/ledger.jsonl, .qe/planning/plans/qe-mcp-expert-refresh/STATE.md, .qe/TASK_LOG.md

## 의사결정 근거

### 선택한 방식

추천 방식은 “expert 본문 독립 갱신 + 고유 evidence 파일 + single finalizer metadata/index 반영”이다. expert worker는 자기 `SKILL.md`와 고유 evidence만 수정하고, Item 11은 evidence 품질을 검증하며, finalizer가 shared index/manifest, summary, ledger, TASK_LOG를 직렬로 처리한다.

### 고려한 대안

- **각 expert 작업에서 index까지 즉시 수정**: 파일 충돌이 많아 Wave 실행 효율이 떨어지고, stale metadata merge 위험이 커진다.
- **metadata만 갱신하고 본문은 나중에 수정**: stale expert 문제의 핵심인 실제 guidance 정확성을 해결하지 못한다.
- **AI/Data expert를 `trusted-current`로 강제**: provider API 변동성이 높아 source date 없는 신뢰 등급은 부정확하다.

### 후속 영향

Phase 3 staleness gate는 이번 Phase 2의 review metadata와 evidence files를 입력으로 삼아 stale major/version detection과 recommendation demotion rules를 구현해야 한다.

## How to Run

- Standard: `$Qexecute c61da39c`
- Atomic Wave: `$Qexecute c61da39c`를 사용하되 Items 1-10만 병렬화할 수 있다. Items 11-14는 모든 worker output validation 이후 serial finalizer로 실행한다.

## 참고사항

- 이 task는 content/config refresh이며 application code logic 변경이 아니다. TDD/OWASP code gate는 적용하지 않지만 Safety Register 검증은 필수다.
- official docs와 registry 값이 바뀔 수 있으므로 execution date를 evidence에 남긴다.
- `../qe-mcp`와 `../qe-experts-extra`는 별도 git repo다. 기존 dirty change는 소유권 확인 없이 되돌리지 않는다.
- QE 규칙은 `QE_CONVENTIONS.md`를 따른다. 작업 이력은 `.qe/TASK_LOG.md`에 기록한다.
