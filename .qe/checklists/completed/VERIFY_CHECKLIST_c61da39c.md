# VERIFY_CHECKLIST_c61da39c.md — qe-mcp high-risk expert refresh 검증

## 검증 기준

- [x] `Qnextjs-developer`, `Qangular-architect`, `Qvite`, `Qdjango-expert`, `Qnestjs-expert`가 `../qe-mcp` core source에서만 수정되었다.
- [x] `Qvitest`, `Qrails-expert`, `Qlaravel-specialist`, `Qfine-tuning-expert`, `Qrag-architect`가 `../qe-experts-extra` extra source에서만 수정되었다.
- [x] Preflight에서 10개 expected `SKILL.md` source path가 Phase 1 inventory와 일치하고 readable임을 확인했다.
- [x] Preflight에서 `qe-framework`, `../qe-mcp`, `../qe-experts-extra`의 dirty status를 기록했고, dirty change가 task-owned source/index/manifest/package/build/test script에 닿는 경우 baseline으로 흡수하지 않고 diff를 확인해 `task-owned`, `user-owned`, `shared`로 분류했다.
- [x] `user-owned` 또는 `shared` same-file dirty change는 자동 overwrite하지 않았고, abort 또는 documented merge decision 없이 편집하지 않았다.
- [x] 모든 task-owned file의 baseline hash 또는 mtime을 기록했고, worker/finalizer가 쓰기 직전 재확인했다. baseline 이후 같은 파일이 바뀐 경우 자동 overwrite하지 않고 abort 또는 explicit merge decision을 기록했다.
- [x] Task-owned allowlist 밖의 기존 dirty change는 revert, stage, claim하지 않았다.
- [x] Items 1-10이 각 expert의 deterministic evidence file을 `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/{ExpertName}.md`에 생성/수정했고, Item 11은 새 evidence 생성 없이 uniqueness/parity/schema completeness만 검증했다.
- [x] 각 expert의 deterministic evidence file이 정확히 하나씩 존재하고 duplicate/stale/colliding evidence file이 없다.
- [x] duplicate/stale/colliding evidence file cleanup이 필요했던 경우 `.qe/planning/plans/qe-mcp-expert-refresh/phases/2/reviews/` 안에서만 수행했고, task-generated 또는 safe-to-move ownership이 확인되지 않은 파일은 삭제하지 않고 `PHASE_2_SUMMARY.md`에 deferred cleanup으로 기록했다.
- [x] 각 evidence file이 `sourceUrls`, `sourceCommands`, raw command output 또는 API response summary, `accessedAt`, 가능한 경우 `sourcePublishedAt`, official-doc provenance, registry provenance, `sourceDate`, `currentMajor`, `verifiedMajor`, `lifecycle`, `conflict`, `changedSections`, `residualRisk`를 포함한다.
- [x] 공식 문서 URL 또는 registry command가 없는 expert는 `trusted-current`로 분류되지 않았다.
- [x] `trusted-current`로 분류된 expert는 `currentMajor == verifiedMajor`이고 unresolved conflict가 없다.
- [x] AI/Data expert(`Qfine-tuning-expert`, `Qrag-architect`)는 exact docs surface, 모델/API caveat, source date, residual volatility를 본문과 evidence에 명시한다. 이 정보가 불충분하면 `use-with-caution`으로 남겼다.
- [x] Laravel current major는 Packagist API의 `laravel/framework` package major와 official Laravel stable docs branch가 일치할 때만 `trusted-current`로 분류되었다. 불일치/불확실하면 `use-with-caution`으로 남겼다.
- [x] Items 1-10은 pack index, manifest, summary, ledger, TASK_LOG를 수정하지 않았고, shared artifact는 finalizer item에서만 수정되었다.
- [x] Finalizer는 Items 1-11이 정확히 한 번 완료된 뒤 atomic `mkdir .qe/planning/plans/qe-mcp-expert-refresh/phases/2/.finalizer-c61da39c.lock`으로 lock directory를 획득하고 owner/run id를 기록한 뒤 실행되었다. lock 획득 실패 또는 기존 finalizer output이 있었다면 명시적 resume 판단 없이 중복 실행하지 않았다.
- [x] Finalizer가 shared artifact를 쓰기 직전 hash/mtime을 재확인했고, baseline 이후 바뀐 shared artifact를 자동 overwrite하지 않았다.
- [x] core index metadata가 Phase 1 review schema 필드를 포함하고 JSON parse에 성공한다.
- [x] extra index metadata가 Phase 1 review schema 필드를 포함하고 JSON parse에 성공한다.
- [x] `cd ../qe-mcp && npm run build:index`는 Item 12 finalizer 안에서 먼저 실행되었고, 그 이후 generated core index/manifest metadata 보존 검증/보강이 수행되었다.
- [x] Item 13 이후 `npm run build:index`를 재실행하지 않았다. 재실행이 불가피했던 경우 core index/manifest no-op을 확인했거나 변경 시 fail/defer 처리했다.
- [x] `build:index` 이후 generated core index/manifest가 refreshed core expert 전부에 대해 Phase 1 review schema field를 보존한다. metadata가 generation 중 유실된 경우 generator/source-of-metadata를 durable하게 수정했거나, post-build manual injection을 non-durable exception으로 기록하고 subsequent `build:index` 유실 시 fail/defer하는 follow-up gate를 `PHASE_2_SUMMARY.md`에 남겼다.
- [x] extra index가 manual edit된 경우 `.qe/planning/plans/qe-mcp-expert-refresh/phases/1/REVIEW_SCHEMA.md` 기준으로 refreshed extra entry마다 exact review schema field, valid lifecycle enum, caution/legacy notes, evidence-file parity, manual/generated 여부가 검증되어 있다.
- [x] core/extra index schema validation은 `jq` 또는 `node` 기반 concrete command로 JSON parse, required field presence, lifecycle enum(`trusted-current`, `use-with-caution`, `legacy`), evidence-file parity를 확인했고 summary에 명령과 결과가 기록되어 있다.
- [x] `cd ../qe-mcp && npm test`가 성공했다.
- [x] `cd ../qe-mcp && npm run lint:size`가 성공했다.
- [x] `qe-mcp packs status --json` 또는 local CLI equivalent가 core/extra counts를 `25/61`로 보고한다. 이 항목은 inventory sanity check이며 refreshed content correctness 판정 근거로 사용하지 않았다.
- [x] representative direct read가 authoritative source와 local generated index 기준으로 갱신 대상 중 core 2개 이상, extra 2개 이상에서 성공한다.
- [x] installed/global direct read를 사용한 경우 expected-stale 가능성을 명시했고 Phase 2 refreshed 판정 근거로 사용하지 않았다.
- [x] dirty-state classification이 `qe-framework`, `../qe-mcp`, `../qe-experts-extra` 각각에 대해 pre/post로 기록되어 있다.
- [x] preexisting unrelated dirty changes in `../qe-mcp` are not reverted, staged, or claimed by this task.
- [x] `PHASE_2_SUMMARY.md`가 refreshed experts, lifecycle decisions, remaining `use-with-caution`/`legacy`, failed/deferred evidence를 요약한다.
- [x] Phase 2 goals G011-G020이 `goals.json`/`ledger.jsonl`에 반영되었고 `STATE.md`는 `node hooks/scripts/lib/ledger.mjs render-state --slug qe-mcp-expert-refresh`로 재생성되었다. `STATE.md`를 직접 편집하지 않았다.
- [x] G020의 AI/Data volatile provider/model default 판단이 evidence와 lifecycle decision에 반영되어 있다.
- [x] `.qe/TASK_LOG.md` 또는 관련 QE task artifact에 작업 이력이 갱신되어 있다.
- [x] Safety Register의 worst-case, data-loss, generated artifact, security/permission, concurrency, rollback, unverified assumptions가 summary 또는 verification notes에서 처리되었다.

## 프레임워크 무결성 체크 (Mandatory)

- [x] **No Stubs**: `TODO`, `FIXME`, `lorem ipsum` 등의 플레이스홀더가 산출물에 남아있지 않은가?
- [x] **Real Logic**: expert content와 metadata가 실제 official docs/registry evidence를 근거로 작성되었는가?
- [x] **Wiring**: 갱신된 expert content가 authoritative source와 generated source index에서 직접 읽을 수 있는가?

## 추가 메모

- `type: other` content/config 작업이므로 OWASP/code-risk 전용 검증은 적용하지 않는다. 대신 Safety Register와 recommendation metadata integrity를 검증한다.
- source-backed evidence가 부족한 expert는 완료 가능하지만 `trusted-current`가 아니라 `use-with-caution` 또는 `legacy`로 남겨야 한다.

---
> 모든 항목 체크 시 완료. 작업 상태는 `.qe/TASK_LOG.md`와 관련 task artifact에 반영하세요.
