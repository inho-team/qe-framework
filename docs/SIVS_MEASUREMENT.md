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
