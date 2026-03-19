---
name: Qautoresearch
description: "Autonomous experiment loop inspired by Karpathy's autoresearch. Repeatedly modifies target files, runs an experiment, evaluates a single metric, and keeps or discards the change — looping indefinitely until manually stopped. Use when optimizing code through iterative experimentation: ML training, algorithm benchmarks, build optimization, performance tuning, multi-file refactoring. Distinct from Edeep-researcher (web research) and Qutopia (task confirmation skip) — this skill runs a code-modify-evaluate loop."
metadata:
  source: https://github.com/karpathy/autoresearch
  author: Andrej Karpathy (pattern), inho-team (QE adaptation)
  version: "2.0.0"
  domain: experimentation
  triggers: autoresearch, experiment loop, autonomous experiment, iterate code, optimize training, hyperparameter sweep, multi-file experiment
  role: specialist
  scope: implementation
  output-format: results.tsv + git branch
  related-skills: Qutopia, Edeep-researcher, Ecode-debugger, Ecode-reviewer, Ecompact-executor, Qdata-analysis, Qlesson-learned
keywords: autoresearch, experiment, autonomous, loop, metric, optimize, iterate, keep, discard, git branch, results.tsv, multi-file
---

# Autoresearch — Autonomous Experiment Loop

Karpathy's autoresearch pattern generalized. Repeatedly modify target files → run → evaluate metric → keep/discard, looping until manually stopped.

## When to Use
- **This skill**: iteratively optimize code against a single metric (ML training, benchmarks, build speed, perf tuning, multi-file refactoring)
- **Edeep-researcher**: web-based research and comparative analysis
- **Qutopia**: skip confirmation steps on existing tasks

## Phase 1: Setup (one-time user conversation)

Collect the following (skip items already provided):

| Item | Description | Required |
|------|-------------|----------|
| **tag** | Session name (used as branch name) | Yes |
| **target_files** | Files agent may modify (1+). `target_file` singular also accepted | Yes |
| **fixed_files** | Files that must never be modified | Yes |
| **run_command** | Experiment execution command | Yes |
| **metric_grep** | Grep pattern to extract metric | Yes |
| **metric_direction** | `lower_is_better` or `higher_is_better` | Yes |
| **time_budget** | Seconds per experiment (default: 300) | No |
| **timeout_multiplier** | Timeout multiplier (default: 2) | No |
| **context_files** | Reference files for agent to read | No |

### Setup Sequence
1. Collect required items from user
2. Read all target_files, fixed_files, context_files for full context
3. Create branch: `git checkout -b autoresearch/<tag>`
4. Initialize results.tsv: `commit\tmetric\tmemory_gb\tstatus\tdescription`
5. Baseline measurement: run without modifications, record first metric
6. Start `Ecompact-executor` in background (context window pressure monitoring)
7. Output "Setup complete. Starting autonomous experiment loop." → enter Phase 2

## Phase 2: Experiment Loop (infinite)

**After setup, this loop NEVER stops until the user manually interrupts.**

```
[Background: Ecompact-executor — context pressure monitoring]

LOOP FOREVER:
  1. Assess current state
  2. Form hypothesis
  3. Modify code
  3.5. [Ecode-reviewer] Code review — fix Critical issues
  4. git commit
  5. Run experiment
  6. Extract results
  7. Handle crash (if any) — [Ecode-debugger]
  8. Record in results.tsv
  8.5. [Every 5th run] Trend analysis
  9. Verdict: keep or discard
  10. Next idea → back to 1
```

### Step 1: Assess Current State
- Read all target_files
- Analyze results.tsv: effective changes, failures, current best metric

### Step 2: Form Hypothesis
**Priority order:** (1) variations on near-miss experiments, (2) optimization opportunities in code, (3) hyperparameter exploration, (4) architecture changes, (5) radical alternatives

Report: `Experiment #{N}: {hypothesis summary}`

### Step 3: Modify Code
- **Only modify files in target_files.** No exceptions.
- Use Edit tool. Multiple files may change per experiment if cohesive.
- Minimize changes to what the hypothesis requires.

### Step 3.5: Code Review (Ecode-reviewer)
Delegate to `Ecode-reviewer` (foreground, 10s timeout).
- **Critical issue** → fix and re-edit (max 1 retry)
- **Warning/Suggestion only** → skip, proceed to Step 4
- **Timeout** → skip, proceed to Step 4

### Step 4: git commit
```bash
git add {modified target files}
git commit -m "experiment #{N}: {hypothesis}"
```
Do NOT use `/Qcommit` (no skill nesting in autonomous loop).

### Step 5: Run
```bash
timeout {time_budget * timeout_multiplier} bash -c '{run_command} > run.log 2>&1'
```
Always redirect to `run.log` (prevent context window pollution).

### Step 6: Extract Results
Run `{metric_grep}`. Parse number from output. No number → crash → Step 7.

### Step 7: Crash Handling (Ecode-debugger)
1. `tail -n 50 run.log` for error content
2. Delegate to `Ecode-debugger`: pass error trace + target_files code → get root cause + fix suggestion
3. **Simple errors** (typo, import, syntax): apply fix, retry Step 5 (max 2 retries)
4. **Fundamental problems** (OOM, logic errors): record as crash
5. `git reset --hard` to restore state

### Step 8: Record in results.tsv
```
{commit_hash_7char}\t{metric_value}\t{memory_gb}\t{status}\t{description}
```
Status: `keep`, `discard`, or `crash`. results.tsv stays untracked (never git commit).

### Step 8.5: Trend Analysis (every 5th experiment)
Analyze results.tsv:
- **Success rate**: keep/total — below 10% → pivot approach
- **Metric trend**: stagnation → try radical changes
- **Crash patterns**: repeated error types → avoid that direction
- **Best performers**: extract effective change patterns

Use analysis to dynamically re-weight hypothesis priorities in Step 2.

### Step 9: Verdict — keep or discard

| Condition | Verdict |
|-----------|---------|
| Metric improved (vs best) | **keep** |
| Metric same or worse | **discard** (`git reset --hard HEAD~1`) |
| Marginal improvement (<0.1%) + code complexity increase (20+ lines) | **discard** |
| Same metric but simpler code (fewer lines) | **keep** |
| Code deleted, metric same or better | **keep** |

Report: `Experiment #{N}: KEEP/DISCARD/CRASH — metric {old} → {new} ({delta})`

### Step 10: Next Idea
- Analyze previous results for next hypothesis
- **Never stop for lack of ideas:** re-read target_files, re-check context_files/fixed_files, combine near-misses, try radical changes, try opposite direction
- Return to Step 1

## Phase 3: Wrap-up (on manual stop)

### 1. Final Summary
```
Autoresearch Session: {tag}
  Total: {N} | Keep: {k} | Discard: {d} | Crash: {c}
  Best metric: {value} (experiment #{best_n})
  Branch: autoresearch/{tag}
```

### 2. Lesson Extraction (Qlesson-learned pattern)
Analyze `autoresearch/<tag>` branch git history: effective change types, repeated failure directions, discovered optimization patterns. Save to `autoresearch-lessons-{tag}.md`.

### 3. Branch Guidance
```
To merge: git checkout main && git merge autoresearch/{tag}
```

## Dependencies

| Dependency | Type | Connection | Required |
|-----------|------|-----------|----------|
| **Ecompact-executor** | Agent | Phase 1 → Phase 2 (background) | Recommended |
| **Ecode-reviewer** | Agent | Step 3.5 (10s timeout) | Recommended |
| **Ecode-debugger** | Agent | Step 7 (crash only) | Recommended |
| **Qlesson-learned** | Skill pattern | Phase 3 | Optional |

**On dependency failure:** skip the step and continue the loop. Dependencies improve quality but must never stop the loop.

## Rules

### MUST DO
- **NEVER STOP**: no "shall I continue?" prompts after Phase 2 entry
- Only modify files in target_files
- Redirect all output to `run.log`
- Record every experiment in results.tsv
- Git commit before every run (enables rollback)
- Enforce timeout: time_budget x timeout_multiplier

### MUST NOT DO
- Modify fixed_files
- Dump full run.log content (context pollution)
- Ask user questions during Phase 2
- Git commit results.tsv
- Install new packages/dependencies
- Call `/Qcommit` skill

## Example: ML Training (single file)
```
/Qautoresearch
tag: mar15
target_files: train.py
fixed_files: prepare.py
run_command: uv run train.py
metric_grep: grep "^val_bpb:" run.log
metric_direction: lower_is_better
```
