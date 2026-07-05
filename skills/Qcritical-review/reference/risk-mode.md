# Risk Mode — Evidence-Backed Code Risk Gate

## Role

`Qcritical-review --risk {UUID}` preserves the `Qrisk-proof` gate inside
Qcritical-review. It turns a code task's Risk Register into a proof-oriented
gate. It does not ask whether the report sounds careful. It asks whether each
meaningful risk was challenged with a probe, evidence, and a clear status before
Supervise.

## Client Adapter Compatibility

- Claude: invoke `Erisk-proof-auditor` through the Agent tool.
- Codex native: prefer the native `Erisk-proof-auditor` subagent when available.
- Codex fallback: run a role-separated inline audit and mark the result
  `degraded-inline`.
- User-visible commands use `{adapter.commandPrefix}`.

## Inputs

Required for `type: code`:

- `TASK_REQUEST_{UUID}.md`
- `VERIFY_CHECKLIST_{UUID}.md`
- changed files or `git diff --name-only`
- relevant test/build output
- filled `## Risk Register` in TASK_REQUEST

Optional:

- prior `Qcritical-review --stage verify` findings
- existing `.qe/agent-results/risk-proof-{UUID}.md`
- contract/security reports linked from the verification loop

## Risk Proof Matrix

Every report MUST contain this table:

```markdown
| Risk | Severity | Failure Mode | Probe | Evidence | Status | Required Action |
|---|---|---|---|---|---|---|
```

Allowed `Status` values:

- `verified-safe`
- `mitigated`
- `deferred-with-owner`
- `unknown`

Allowed `Severity` values:

- `CRITICAL`
- `HIGH`
- `MEDIUM`
- `LOW`

Evidence must be concrete: repo-relative file path, test name, command output
path, report path, or specific `file:line` code-path evidence. Bare statements
such as "reviewed" or "looks safe" do not count.

## Workflow

### Step 1: Resolve Artifacts

1. Resolve `{UUID}` from the command argument or active pending task.
2. Read the paired TASK_REQUEST and VERIFY_CHECKLIST.
3. Confirm the task is `type: code`; for docs/analysis, report `SKIPPED`.
4. Confirm TASK_REQUEST contains a non-empty `## Risk Register`. Missing,
   placeholder-only, or materially empty Risk Register is an immediate FAIL for
   `type: code`, even when `Qrisk-proof` is invoked directly outside
   Qcode-run-task.
5. Collect changed files using `git diff --name-only`, `git diff --cached
   --name-only`, and untracked files when available.

### Step 2: Build Auditor Packet

Pass only the task-local evidence to `Erisk-proof-auditor`:

- TASK_REQUEST goals, checklist, and Risk Register
- VERIFY_CHECKLIST validation criteria
- changed files and relevant diffs
- test/build evidence already produced by Qcode-run-task
- prior Verify-gate findings, if any

The auditor prompt MUST say: "Your job is to break the risk proof. Find
low-probability high-impact failures. Do not confirm quality unless the evidence
supports it."

### Step 3: Run Auditor

Invoke `Erisk-proof-auditor` and collect its report. If the subagent cannot run:

- Interactive mode: ask whether to run a degraded inline audit or stop.
- Non-interactive mode: run degraded inline and mark `crosscontext=degraded`.

### Step 4: Aggregate Verdict

Use these hard rules:

| Condition | Verdict |
|---|---|
| Missing/placeholder `## Risk Register` for a `type: code` task | FAIL |
| Any `CRITICAL` or `HIGH` risk has `Status: unknown` | FAIL |
| Any `CRITICAL` or `HIGH` risk has missing/empty Evidence | FAIL |
| New unregistered `CRITICAL` or `HIGH` risk found by auditor | FAIL |
| `deferred-with-owner` lacks owner, rationale, or follow-up | FAIL |
| Only `MEDIUM` unknown or evidence gaps remain | WARN |
| All HIGH/CRITICAL risks are verified-safe, mitigated, or validly deferred | PASS |

Rule summary: HIGH/CRITICAL unknown = FAIL.

FAIL routes backward to Verify or Implement. If the auditor attributes the
failure to a missing or wrong requirement, route to Spec.

### Step 5: Persist Report

Write the report to:

```text
.qe/agent-results/risk-proof-{UUID}.md
```

The report must include:

```markdown
## Risk Proof Verdict
Verdict: PASS | WARN | FAIL

## Risk Matrix
| Risk | Severity | Failure Mode | Probe | Evidence | Status | Required Action |
|---|---|---|---|---|---|---|

## New Risks Found
- ...

## Unknowns
- ...

## Required Action
- ...

## Audit Metadata
- UUID:
- changed_files:
- auditor_route: native | agent | degraded-inline
```

## Handoff

Return a short verdict:

```text
Risk Proof: PASS | WARN | FAIL
Report: .qe/agent-results/risk-proof-{UUID}.md
Next: {adapter.commandPrefix}Qcritical-review --stage supervise
```

## Will

- Challenge code risks with evidence, probes, and explicit status.
- Invoke a fresh-context risk auditor for `type: code`.
- Persist a report that Supervise must read.

## Will Not

- Replace Qcritical-review or Supervise.
- Auto-fix code.
- Accept HIGH/CRITICAL unknown risks as complete.
- Treat final-report wording as proof.
