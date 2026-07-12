# SIVS Measurement — sivs-gate-consolidation Phase 5

> Plan: `sivs-gate-consolidation` | Phase: 5 | Recorded: 2026-07-11
> Source authority: **집계치(16–17, 5+1)는 Phase 5에서 산출** — 구성요소(게이트 라운드 구성)는
> DIAG_d3a7ac6e.md의 라운드 기록에, 집계와 산출 규칙은 DIAG_f876457e.md §7에 있다.
> TASK_LOG row d3a7ac6e는 라운드 존재의 교차 확인용이며 합계 수치를 직접 담고 있지 않다.
> Plugin cache: 7.3.9 (hook code runs from cache, not dev source — caveat below)

---

## Measurement Summary

| Metric | Before | After | Source | Verdict |
|--------|--------|-------|--------|---------|
| Full SIVS cycle LLM sub-agent calls | 20–24 (baseline estimate) | 17회 (Phase 4 upper bound, F-findings remediation included) | 구성요소: DIAG_d3a7ac6e 게이트 라운드 · 집계: DIAG_f876457e §7 | **unknown** — 17 does NOT satisfy R009 DoD ≤ 15 |
| Supervise stage call count | 6–7 (budget: D-55a051bd-1) | 관찰 5 (+1 env 재판정) · budget 4–5 (≤4 no security; floor=5) | 관찰치: DIAG_f876457e §7 집계 (라운드 구성은 DIAG_d3a7ac6e) · budget: D-55a051bd-1 | — (no R-id target; Axis-3 evidence only) |
| ContextMemo blocked_reads | — | unmeasurable | unified-state.json, D-c0127487-1 | unmeasurable (liveness unproven this session) |
| Delegation Enforcer autoInjections | — | unmeasurable | unified-state.json, D-c0127487-1 | unmeasurable (liveness unproven this session) |

---

## Full SIVS Cycle — Breakdown

**Phase 4 live-run (d3a7ac6e), F-findings remediation rounds included (upper bound):**

| Stage | Sub-agent calls | Notes |
|-------|----------------|-------|
| Implement | 1 (+1 retry) | Etask-executor |
| Verify (G3) | 3 + 2 + security 2 | DA (Codex) + Security + Perf + findings rounds |
| Risk Proof (G4) | 1 | Erisk-proof-auditor |
| Supervise (G5) | 5 (+1 optional env) | 3 adversarial + 1 security + 1 aggregation (+1 환경 재판정: Codex 샌드박스 mkdtemp EPERM) |
| **Total** | **≈ 16–17** | Upper bound; F-findings 치유 3라운드 포함. 집계 산출: DIAG_f876457e §7 (구성 라운드는 DIAG_d3a7ac6e 기록) |

**Inclusion rule:** F-findings 치유 라운드(remediation rounds)를 포함한 상한값. 미발동 시 하한은 낮아질 수 있으나, 정직한 보고는 관찰된 상한을 사용한다.

**R009 DoD:** `풀사이클 LLM 서브에이전트 호출 ≤ 15회`
**Verdict:** `unknown` — measured 17회 does NOT satisfy ≤ 15. The ROADMAP Phase 2 target (20–24 → 15) is not yet achieved. This is an honest result; `met` was not forced.

**Follow-up (target miss):** 미달분(17→15) 해소는 이 플랜 범위 밖 — 차기 최적화 작업으로 이월.
후보 경로: findings 파이프라인 심화(Verify 라운드 감소), 치유 라운드 없는 클린런 재측정(17은
F-findings 3라운드 포함 상한), Supervise ≤4 경로(보안 미발동 시) 정착. 상세와 owner 기록:
plan `DECISION_LOG.md` D-f876457e-1 "R009 목표 미달 후속" 절.
**라벨 주의:** PHASE_5_REPORT의 `Overall achievement: PARTIAL_OR_COMPLETE`는 goal lifecycle 기반
기계 판정으로 목표 달성을 의미하지 않는다 — R009 verdict(`unknown`, NOT satisfy)가 진실이다.

---

## Supervise Call Budget — Detail

**Before (Phase 2 baseline):** 6–7 sub-agent spawns
- Ecode-reviewer (1) + Ecode-test-engineer (1) = domain audit 2
- Esecurity-officer (0–1) = optional security
- Qcritical-review supervise: Merge Blocker + Advocate + Judge (3)
- Orchestrator aggregation (1)

**After (findings pipeline, Phase 2 / R002):**
- Verify findings injected into Supervise → unchanged-file domain re-audits skipped
- Net: 4–5 (≤4 when security audit not warranted; floor = 5 when Esecurity-officer fires)
- **Reduction cause:** findings pipeline cross-stage de-duplication (R002), NOT SIVS routing changes
- SIVS routing changes contributed zero reduction ("no reduction achieved via routing")

**Note (NF1):** Qcritical-review gate subagents (DA/Blocker → Codex, others → Claude) are protocol-owned. SIVS enforceRouting only hard-blocks direct Agent spawns (Etask-executor, Esupervision-orchestrator). Mixed engine execution is by design; see DECISION_LOG D-f876457e-1.

---

## Savings Device Counters (ContextMemo / Delegation Enforcer)

**Status: unmeasurable this session.**

- Hook code executes from plugin cache 7.3.9, not dev source
- Dev source ContextMemo and Delegation Enforcer fixes (Phase 1) are not live in this session
- `unified-state.json`: memo.files={}, blocked_reads=0, autoInjections=0 — but liveness of recording path not proven in this session
- Deferred to post-reinstall verification per D-c0127487-1
- `0` is NOT recorded as a measured value here — recording path liveness is unproven

---

## Cache Boundary Caveat

Hook code runs from the installed plugin cache (`${CLAUDE_PLUGIN_ROOT}/.../7.3.9/`). Dev source edits to `qe-framework/` hooks are not live until after plugin reinstall/sync. This caveat applies to hook code only. Config files (`.qe/sivs-config.json`) are read fresh on every hook invocation and changes take effect immediately.

---

## 클린런 베이스라인 (파생) — DERIVED clean_floor_range=9-11

> 출처: TASK_REQUEST_6147e8af (2026-07-12) | 방법: 방법 A (기록 분해 파생) | 라벨: **interim hypothesis**
> 참조: ledger G021 이벤트 (2026-07-12, `DERIVED clean_floor_range=9-11`) · DECISION_LOG D-f876457e-1 "클린런 베이스라인 파생 소결" · DIAG_6147e8af.md

### Phase 5 원 측정값의 의미

Phase 5 최종 측정값은 **17회**(Phase 4 상한, F-findings 치유 3라운드 포함). R009 DoD ≤15회 대비
verdict `unknown`(미달)이며, 이 기록은 변경되지 않는다. 17은 FAIL로 유발된 재-라운드를 포함한
**상한값**이다 — clean-path(FAIL 없이 첫 pass PASS) 기준 실측값이 아니다.

### 17이 상한값인 이유 (FAIL-유발 재-라운드)

Phase 4 dogfooding에는 다음 FAIL-유발 재-라운드가 포함됐다:

| 재-라운드 | 유발 원인 | 제외 근거 |
|---------|---------|---------|
| verify R2 (2라운드) | verify R1 Overall FAIL → backward-routing | `verify-gate-protocol.md`: R1 PASS면 R2 미발생 |
| Esecurity R2 | verify R2(FAIL-라운드) 산물 — F13 발견 | R2 전체가 FAIL-라운드 산물 (F13은 실결함, 반대증거로 기록) |
| supervise Blocker FAIL 치유 라운드 | Blocker FAIL → F18/F19 치유 재판정 | clean-path는 no-Blocker-FAIL 기준 |
| implement +1 retry | retry 표기 | `+` 표기 = retry, clean-path에 없음 |
| supervise +1 env 재판정 | 환경 재판정 | `+` 표기 = 재판정, clean-path에 없음 |

**반대증거 (제외의 auditable 근거):** F13(Esecurity R2가 발견한 unit boundary NF4 결함),
F18(Blocker FAIL 치유 중 발견한 isolation guard 누락, HIGH), F19(같은 라운드 발견, MED)는
실제 결함이었다. 제외는 "clean-path에 해당 라운드가 없다"는 프로토콜 정의에 따른 것이며,
이 결함들이 clean-path에서 발견되지 않을 수도 있다는 사실을 숨기지 않는다. 상세: DIAG_6147e8af.md §4.

### 대칭 분해 규칙 요약

FAIL-유발 재-라운드 제외는 **verify·security·supervise에 대칭 적용**한다. 한 phase만
선택적으로 제외하는 비대칭은 리깅이므로 금지한다. 분해 규칙 4개:

- Rule-A: `+` 표기(retry/env 재판정) 제외
- Rule-B: FAIL-유발 backward-routing 재-라운드 대칭 제외 (근거: verify-gate-protocol.md)
- Rule-C: 필수 gate floor 포함 유지
- Rule-D: security 발동 여부를 명시 파라미터로 두어 두 케이스 산출

### DERIVED clean_floor_range=9-11 (두 케이스)

| Case | 구성 | 합계 |
|------|------|------|
| **no-security clean** (Esecurity 미발동) | implement 1 + verify R1 3 + risk-proof 1 + supervise 4 (adversarial 3 + aggregation 1) | **9** |
| **security-fires clean** (Esecurity 발동) | implement 1 + verify R1 3 + Esecurity R1(clean pass) 1 + risk-proof 1 + supervise 5 (adversarial 3 + security 1 + aggregation 1) | **11** |

`security-fires` 케이스의 +1 Esecurity는 **verify R1 clean-pass의 security 패스**에서 온다 —
제외한 FAIL-라운드(R2) security의 재수입이 아니다(DIAG_6147e8af.md §3 참조).

### 상호배타 결론

hi=11 ≤ 15 → **"R009 클린런 충족 가능성 높음(파생근거), 단 방법 B로 확정 필요"**

두 케이스 모두 ≤15를 충족한다. 단, 이는 방법 A(기록 분해 파생)의 interim hypothesis이며
Phase 5 실측 17회(verdict `unknown`)를 대체하지 않는다. 방법 A 결과를 R009 충족의 소급
근거로 사용하는 것은 NF4 위반이다.

### 방법 A vs 방법 B (필수 후속)

**방법 A(이번 태스크)는 interim hypothesis다.** 기록 분해 기반이므로 Phase 4 breakdown의
분리 가능성에 의존하며, 재현 가능한 fresh measurement가 아니다. durable baseline으로
굳으면 안 된다.

**방법 B(전향적 계측)는 필수 후속이다.** 실제 `measured` 클린런 확정은 방법 B 착수 시
새 TASK_REQUEST로 스펙화한다. 방법 B 계측 방법: 향후 clean SIVS 사이클(F-findings 치유
없이 첫 pass PASS)에서 implement→verify→risk-proof→supervise 각 게이트의 서브에이전트
spawn 카운트를 실시간으로 집계해 합산한다.

---

## Gate Engine Ownership (Phase 5 / D-f876457e-1)

Under `codex-head` profile:

| Gate | Subrole | Engine | Owner |
|------|---------|--------|-------|
| G3 Verify | Devil's Advocate | Codex (auto-upgrade) | Qcritical-review protocol |
| G3 Verify | Security Auditor | Claude | Qcritical-review protocol |
| G3 Verify | Performance Skeptic | Claude | Qcritical-review protocol |
| G4 Risk Proof | Erisk-proof-auditor | Claude | Protocol (SIVS STAGE_MAP 미포함) |
| G5 Supervise | Merge Blocker | Codex (auto-upgrade) | Qcritical-review protocol + SIVS |
| G5 Supervise | Merge Advocate | Claude | Qcritical-review protocol |
| G5 Supervise | Impartial Judge | Claude | Qcritical-review protocol |
| G5 Supervise | Security Audit (opt) | Claude | Esecurity-officer |
| G5 Supervise | Orchestrator | Codex | SIVS enforceRouting (hard-block) |

Decision: all gates document/mixed — no SIVS config routing changes made. See DECISION_LOG D-f876457e-1.
