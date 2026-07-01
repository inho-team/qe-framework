# QE Skill Routing Contract

This document defines how QE selects a user-facing skill, when internal agents
must stay behind a Q wrapper, and how routing changes are validated and rolled
back.

## Routing Precedence

Apply these layers in order:

| Order | Layer | Rule |
| --- | --- | --- |
| 1 | Explicit invocation | A direct command such as `/Qplan`, `$Qgs`, `/Qrt`, or `/Mbump` wins over inferred intent. Aliases resolve to their canonical skill first. |
| 2 | QE override and hard safety routes | If the user is attempting a guarded manual action, route to the required QE skill instead of the raw action. Examples: `git commit` -> `Qcommit`; direct version-file write -> `Mbump` or maintainer release flow; uninitialized project -> `Qinit` before other skills. |
| 3 | PSE state | When work is already inside Plan/Spec/Execute/Verify, prefer the next stage that matches the active state, plan binding, task type, and checklist shape. |
| 4 | Intent-routes table | If there is no explicit command and no safety override, score against `hooks/scripts/lib/intent-routes.json`. This is the primary keyword router. |
| 5 | Skill metadata | Use `description`, `invocation_trigger`, alias notes, and branch-point text in `SKILL.md` to break ties or reject a bad keyword match. |
| 6 | Fallback | If nothing matches cleanly, choose the safest general path: `Qinit` for uninitialized repos, `Qplan` for new work, `Qrun-task` for existing spec execution, `Qcode-run-task` only for already-modified code, and Claude/default-engine execution when SIVS routing is absent. |

Notes:

- Explicit skill choice wins among skills, but it does not bypass hard safety
  guards on raw tool actions.
- Missing `.qe/sivs-config.json` falls back to the all-Claude/default path.
- Legacy aliases are routing sugar only: `Qgs` -> `Qgenerate-spec`, `Qrt` ->
  `Qrun-task`.

## PSE State Routing

Use the active PSE state before generic intent inference:

| Current state | Route |
| --- | --- |
| No QE project instruction artifact | `Qinit` |
| Need roadmap, phases, or a new scoped plan | `Qplan` |
| Plan exists and spec artifacts are missing or stale | `Qgs` |
| Spec exists and checklist is highly atomic, independent, and parallelizable | `Qatomic-run` |
| Spec exists but items are ordered, long-form, or remediation-driven | `Qrun-task` |
| Code is already on disk and needs test-review-fix verification | `Qcode-run-task` |
| All implementation work is done and the user wants a saved commit | `Qcommit` |

Plan resolution for PSE-aware skills follows the same pattern:

1. Explicit slug argument.
2. Session binding in `.qe/state/current-session.json` and
   `.qe/planning/.sessions/`.
3. `.qe/planning/ACTIVE_PLAN`.
4. Legacy flat `.qe/planning/ROADMAP.md` fallback.

### State-Aware Soft Hints

`hooks/scripts/prompt-check.mjs` may add a `[PSE]` hint to the hook
`additionalContext` when local QE state strongly suggests the next workflow
step. This is advisory only; it must never use `SKILL REQUIRED`.

State hint precedence:

| State | Soft hint |
| --- | --- |
| `.qe/` absent | No hint. |
| `.qe/` exists but no active plan resolves | Suggest `Qplan`. |
| Active plan resolves and no current pending spec pair exists | Suggest `Qgs`. |
| Exactly one pending TASK_REQUEST/VERIFY_CHECKLIST pair belongs to the active plan | Suggest `Qrun-task {uuid}` or `Qatomic-run {uuid}`. |
| Multiple pending pairs belong to the active plan | No automatic target; ask for an explicit UUID. |
| Uncommitted non-`.qe/` changes exist | Suggest `Qcode-run-task` for verification. |
| Active phase is completed or verified | No execute/verify hint is repeated. |

Guardrails:

- Explicit `$Q...`, `/Q...`, `$M...`, and `/M...` invocations win.
- Existing `[INTENT] SKILL REQUIRED` hints win.
- Commit, push, version bump, context-save, and handoff safety routes win.
- General informational questions are not nudged into PSE routing.
- Pending task membership is determined only by the exact task line
  `관련 계획: .qe/planning/plans/{slug}/ROADMAP.md`.
- Malformed `ACTIVE_PLAN`, stale session bindings, deleted plan directories,
  and absent `.qe` state fail open to fallback/no-hint behavior.
- Dirty tree handling is read-only. The state router never cleans, stages,
  rewrites, or reverts files.

## PSE Core Decision Table

| Skill | Route when | Do not route when | Default next step |
| --- | --- | --- | --- |
| `Qinit` | Repo is not initialized or QE setup/migration is requested. | A project instruction artifact already exists and the task is normal execution work. | `Qplan` or `Qsivs-config` depending on setup state. |
| `Qplan` | The user needs roadmap, phasing, or task scoping. | Code should be written immediately from an existing spec. | `Qgs` |
| `Qgs` | A plan or freeform task needs `TASK_REQUEST` and `VERIFY_CHECKLIST`. | Implementation is already underway and spec generation would be redundant. | `Qatomic-run` or `Qrun-task` |
| `Qatomic-run` | Checklist has many independent atomic items with low overlap and low complexity. | Items are order-dependent, non-atomic, or mostly verification work. | `Qcode-run-task` for `type: code`; otherwise direct completion/supervision path. |
| `Qrun-task` | A spec exists but execution is sequential, long-form, or remediation-oriented. | The checklist can be safely wave-partitioned, or only verification remains. | `Qcode-run-task` for code tasks. |
| `Qcode-run-task` | Code changes already exist and need test-review-fix-retest. | No code changed yet, or the task is docs/analysis only. | Complete or route backward per SIVS findings. |
| `Qcommit` | The user wants to commit or push changes. | No commit intent exists, or the caller is inside a maintainer version-bump flow that already owns commit routing. | End of task, or push if explicitly requested. |
| `Qversion` | The user asks for current QE version only. | The user intends to change version files. | End of task. |
| `Mbump` | Maintainer version bump is requested for QE framework internals. | Ordinary project work, or the recommended batched release path should be `Mrelease` instead. | Version-bump commit, then optional release flow. |
| `Qcompact` | The user wants a handoff/save, or context pressure requires preservation. | Fresh context restore is needed instead of save. | `Qresume` later, or continue current task. |
| `Qresume` | The user wants to restore prior context or list session buckets. | The need is to save current state, not restore it. | Resume the recovered task. |
| `Qrefresh` | `.qe/analysis/` is stale or the user asks to refresh/sync analysis. | The user needs task execution rather than repo analysis refresh. | Continue work using fresh analysis. |

## Intent-Routes Table Contract

`hooks/scripts/lib/intent-routes.json` is the default keyword router, not the
source of truth for skill semantics.

Rules:

- Add a table entry only for stable, user-meaningful intents.
- Prefer Q skills for user-facing routing when a Q wrapper exists.
- Direct E-agent routing is a legacy or specialist escape hatch, not the
  default shape for new capabilities.
- The router may nominate a candidate, but `SKILL.md` metadata can still reject
  it if the branch conditions do not fit.
- Keep route terms specific. Multi-word terms must match as phrases or all
  words; a single broad fragment inside a multi-word term must not dominate
  PSE routes. For example, `command` alone must not outrank `Qplan` just
  because a prompt asks for the "next QE command".
- Include high-value Korean trigger phrases directly when they are part of the
  supported routing contract. The deterministic benchmark does not call an LLM
  translator.

## Skill Metadata Contract

When keyword routing produces multiple candidates, prefer the skill whose
metadata most tightly matches the task:

- `description` defines the public contract and branch points.
- Core auto-routed PSE descriptions start with `Use when`.
- Crowded PSE descriptions include sibling-boundary text, for example
  `Use Qplan... Use Qgs... Use Qatomic-run...`.
- `invocation_trigger` is the short intent summary.
- Alias notes define canonical names (`Qgs`, `Qrt`).
- `recommendedModel` and tier guide execution cost, not user-visible naming.
- If the `SKILL.md` says a capability is guide-only or wrapper-only, do not
  expose its delegate directly.

## Skill vs Agent Exposure Rules

Use these rules for public exposure:

| Case | Exposure rule |
| --- | --- |
| User-facing command with side effects, safety hooks, or handoff semantics | Must be a Q or M wrapper. |
| Internal worker that performs one bounded delegated role | Keep it as an E agent behind a wrapper. |
| Capability must appear in intent routing, handoff text, stop-hook guidance, or override-map docs | Give it a stable Q or M wrapper. |
| Capability is maintainer-only QE framework administration | Prefer M wrapper or maintainer workflow, not a raw E agent. |

E agents need a Q wrapper when any of the following is true:

- The action is blocked or redirected by PreToolUse safety guards.
- The action owns state transitions in PSE or session context.
- The action needs a stable user command across Claude and Codex.
- The action may swap implementations while keeping the same public contract.

Common examples:

- `Qcommit` wraps `Ecommit-executor`.
- `Qrefresh` wraps `Erefresh-executor`.
- `Qcompact` wraps `Ecompact-executor` and `Ehandoff-executor`.
- `Qcode-run-task` wraps `Eqa-orchestrator`.

Direct E-agent exposure is acceptable only when there is no public wrapper yet
and the capability is intentionally expert-only. New user-facing features should
not add fresh E-agent entries to `intent-routes.json` unless there is a strong
reason to avoid a wrapper.

## Catalog Pressure Controls

Routing quality depends on keeping the auto-routed surface small enough that
metadata and keyword collisions stay explainable. The catalog is classified into
four reportable surfaces:

| Class | Meaning | Routing policy |
| --- | --- | --- |
| `core-auto` | PSE and lifecycle wrappers that are safe to suggest from state or strong intent. | Keep small, benchmarked, and installed by default. |
| `explicit-only` | Useful commands that should not be broad auto-routes. | Invoke directly or route only from narrow keywords. |
| `delegated-agent` | Internal E-agent role files. | Prefer Q/M wrappers for public commands; direct routing is expert-only fallback. |
| `optional` | Long-tail domain skills and personal utilities. | Keep out of hard routing unless benchmark evidence justifies it. |

Use `node scripts/catalog-pressure-report.mjs` to measure repo skills,
installed Codex skills, agents, route counts, description lengths, keyword
pressure, and likely collision clusters. The report is observational; it does
not delete, move, demote, or install anything.

Users may slim an installed personal catalog without losing QE core behavior by
preserving the `core-auto` PSE/lifecycle wrappers, maintainer safety surfaces
such as `Mbump`, and the E-agents required by wrapper delegation. Optional
domain skills should be the first candidates for removal or hiding. If a direct
E-agent route is retained, document whether it is an expert-only fallback or a
temporary gap waiting for a thin Q wrapper.

### Wrapper Policy for High-Value E-Agents

High-value E-agents such as `Edeep-researcher` should get a Q wrapper only when
at least one of these conditions is true:

- Users need a stable public command across Claude, Codex, and future clients.
- The workflow owns state transitions, safety hooks, or handoff semantics.
- Benchmark prompts show repeated confusion between direct E-agent routing and
  neighboring Q skills.
- The wrapper can remain thin: route, preconditions, outputs, and handoff only.
  It must not copy the E-agent's full role instructions.

If these conditions are not met, keep the direct E-agent route as an
expert-only fallback and benchmark it explicitly. Phase 3 keeps
`research/compare/investigate/deep-research` routed to `Edeep-researcher` and
does not create `Qdeepresearch`.

## Benchmark Guidance

Do not ship routing claims without dated evidence.

Minimum benchmark set:

| Area | Measure |
| --- | --- |
| Router accuracy | Run the skill-routing checks and confirm no new false positives or broken aliases. |
| Safety behavior | Re-run hook regression coverage for override guards after changing precedence or guarded routes. |
| Context benefit | Use `docs/BENCHMARK.md` methodology; report per-repo, per-directory token savings only. |
| Hook cost | Measure median and p95 added latency when hook behavior changes materially. |

Rules:

- Publish methodology and dated results together.
- Report ranges, not universal percentages.
- If a routing tweak cannot beat the previous behavior reliably, revert it.

## Rollback Guidance

Rollback from highest leverage to lowest:

1. Revert the routing-table or `SKILL.md` change that introduced the mismatch.
2. If a guard is misfiring, use `hook_profile: minimal` only as a temporary
   escape hatch; fix the rule rather than normalizing the bypass.
3. Prefer one-off bypass files or role overrides for recovery, not permanent
   weakening of the default contract.
4. Preserve explicit invocation stability even when inference changes.
5. Keep PSE fallback intact: `Qatomic-run` -> `Qrun-task` -> `Qcode-run-task`,
   and Codex-specific routes must retain a documented default-engine fallback.

The routing contract is successful when explicit commands stay stable, guarded
manual actions are redirected to the correct wrapper, PSE stage transitions are
predictable, and fallback behavior is safe rather than clever.
