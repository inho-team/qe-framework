---
name: Qutopia
description: "Utopia mode — fully autonomous execution. Skips all confirmations and auto-allows tool permissions. Use when the user wants fully autonomous, no-confirmation execution with keywords like 'utopia', 'autonomous', or 'no questions'. Supports --work (spec pipeline) and --qa (spec + quality loop). Korean: '자율 실행', '자동 모드', '확인 없이'. Chinese: '自主执行', '全自动'. Japanese: '自律実行', '自動モード'. Arabic: 'تنفيذ تلقائي'. Hindi: 'स्वायत्त निष्पादन'. Spanish: 'ejecución autónoma'. Portuguese: 'execução autônoma'. French: 'exécution autonome'. German: 'autonome Ausführung'. Russian: 'автономное выполнение'. Indonesian: 'eksekusi otonom'."
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
---

# Qutopia — Fully Autonomous Execution

## Modes

| Command | Behavior |
|---------|----------|
| `/Qutopia` | Auto mode — classify simple/complex, auto-select work or qa |
| `/Qutopia --work` | Force work mode (spec pipeline, no quality loop) |
| `/Qutopia --qa` | Force qa mode (spec pipeline + quality loop) |
| `/Qutopia off` | Disable autonomous mode |
| `/Qutopia status` | Show current state |

## What It Does

### 1. Skip Confirmations
Creates `.qe/state/utopia-state.json`:
```json
{
  "enabled": true,
  "mode": "auto|work|qa",
  "activatedAt": "2026-03-20T00:00:00Z"
}
```

When `enabled: true`, ALL skills/agents:
- Skip `AskUserQuestion` — auto-select first (recommended) option
- Auto-approve in Qrun-task, auto-generate in Qgenerate-spec
- Auto-commit via Qcommit after task completion

### 2. Auto-allow Tool Permissions
Merge into `.claude/settings.json`:
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "Bash(*)", "Agent(*)", "WebFetch", "WebSearch", "NotebookEdit"
    ]
  }
}
```

### 3. Request Routing

#### Default mode (`/Qutopia`, no flag)

```
Request → Classify complexity → SIMPLE → Execute directly
                              → COMPLEX → Auto-select mode → Spec pipeline
```

**SIMPLE** (ALL true): target files ≤ 3 AND single action AND no architecture decisions AND checklist items < 3 → execute directly, no spec
**COMPLEX** (ANY true): target files > 3, new feature, architecture decisions, checklist items ≥ 3 → enter spec pipeline

**Auto mode selection for COMPLEX requests:**

| Signal | Mode | Reason |
|--------|------|--------|
| `type: code` + has tests (test files exist in project) | **qa** | 테스트 인프라가 있으면 품질 루프 활용 |
| `type: code` + auth/crypto/payment keywords | **qa** | 보안 민감 코드는 품질 검증 필수 |
| `type: code` + no tests | **work** | 품질 루프 돌려봐야 테스트가 없어서 의미 없음 |
| `type: docs` / `type: analysis` / `type: other` | **work** | 품질 루프 불필요 |

Output: `[Utopia] COMPLEX → {mode} mode (reason)`

#### `--work` mode

```
Request → Gate → Qgenerate-spec → Qrun-task → Verify ─┐
                                                        ├→ Pass → Done
                                                        └→ Fail → Diagnose → Re-execute → Verify (retry loop)
```

- State file: `"mode": "work"`, max reinforcements: 50
- Multiple tasks: spawn `Etask-executor` agents in parallel
- Single task: invoke `/Qrun-task {UUID}` in autonomous mode

#### `--qa` mode

```
Request → Gate → Qgenerate-spec → Qrun-task → Qcode-run-task → Verify ─┐
                                                                         ├→ Pass → Done
                                                                         └→ Fail → Diagnose → Re-execute → Verify (retry loop)
```

- State file: `"mode": "qa"`, max reinforcements: 80
- After each task completes:
  - Code tasks: `/Qcode-run-task` (test → review → fix → retest, max 3 cycles)
  - **All tasks: VERIFY_CHECKLIST item-by-item verification is MANDATORY** — each item must be verified with a concrete action (file check, grep, build, test). "Build passed" alone does NOT satisfy verification. This step CANNOT be skipped in --qa mode.
  - Code + security keywords (auth/crypto/payment/JWT/password/secret/token/credential/bcrypt): auto-invoke `Esecurity-officer` before marking verification complete
- Cross-task audit (after ALL tasks complete): see below
- Output QA report (per-task results, overall score)

### Retry Loop (both work and qa)

검증 실패 시 자동으로 원인 분석 → 재실행하는 루프. 성공할 때까지 반복하되 안전 제한 있음.

```
Verify failed
  → Step 1: Diagnose — 실패 항목 분석, 원인 분류
  → Step 2: Strategy — 원인별 대응 결정
  → Step 3: Re-execute — 실패 항목만 재실행
  → Step 4: Re-verify — 다시 검증
  → Pass? → Done
  → Fail? → retry_count < max? → Step 1로 복귀
                                → max 도달 → Escalate
```

#### Diagnosis (Step 1)

실패한 VERIFY_CHECKLIST 항목을 분석하고 원인을 분류:

| 원인 | 대응 | 예시 |
|------|------|------|
| **구현 누락** | 해당 체크리스트 항목 재실행 | 파일 생성 안 됨, 함수 미구현 |
| **구현 오류** | Ecode-debugger로 원인 파악 후 수정 | 테스트 실패, 런타임 에러 |
| **스펙 모순** | 체크리스트 항목 수정 후 재실행 | 상충하는 요구사항 |
| **환경 문제** | 환경 수정 후 재실행 | 의존성 누락, 권한 부족 |

#### Retry Limits

| Mode | Max Retries | Max Total Time | Escalation |
|------|-------------|----------------|------------|
| work | 3 | — | 사용자에게 실패 보고 + 선택지 (Retry/Abort/Override) |
| qa | 5 | — | 사용자에게 실패 보고 + QA report |

#### Retry State Tracking

`.qe/state/utopia-state.json`에 retry 상태 기록:
```json
{
  "retry": {
    "count": 2,
    "failed_items": ["VERIFY item 3", "VERIFY item 5"],
    "last_diagnosis": "구현 오류 — test assertion mismatch",
    "history": [
      {"attempt": 1, "failed": 3, "fixed": 1},
      {"attempt": 2, "failed": 2, "fixed": 1}
    ]
  }
}
```

#### Approach Escalation

같은 항목이 2회 연속 실패하면 접근법을 변경:
- 1회차: 동일 방식으로 재시도
- 2회차: Ecode-debugger로 근본 원인 분석 후 다른 방식 시도
- 3회차(work) / 5회차(qa): 사용자에게 에스컬레이션

Output per retry:
```
[Utopia] Retry #{n} — {failed_count} items failed → diagnosis: {cause}
[Utopia] Re-executing: {item list}
```

### Pre-execution Gate

Before entering spec pipeline (--work/--qa or COMPLEX routing), check prompt specificity:

| Signal | Example |
|--------|---------|
| File path | `.ts`, `src/` |
| Function/class name | camelCase, PascalCase |
| Issue/PR number | `#N`, `PR N` |
| Error reference | `TypeError` |
| Code block | Triple backticks |
| Numbered steps | `1. ... 2. ...` |

**Decision:**
- Anchor found or word count > 20 → proceed
- No anchor + ≤ 20 words → redirect to Qgenerate-spec Step 1 for scoping
- `force:` or `!` prefix → bypass gate

### Cross-task Audit (--qa only)

After ALL tasks in a session complete, run cross-task consistency check:

1. Read all completed VERIFY_CHECKLISTs from current session
2. Check for:
   - **File conflicts**: multiple tasks modified the same file — verify final state is consistent
   - **Translation gaps**: if any task added UI strings, verify ko.ts/en.ts coverage
   - **Style drift**: if any task modified CSS/styles, verify design token consistency
3. Report findings in QA report. FAIL items → fix before final completion.

## Common Rules (all modes)
- **Skill priority**: Even in autonomous mode, if a registered skill covers the action (e.g., Mcreate-skill for skill creation, Qcommit for git commit, Mcreate-agent for agent creation), invoke the skill instead of raw tool calls. QE_CONVENTIONS.md override map always applies.
- **State management**: create before execution, clear after completion
- **Reinforcement**: stop signals blocked up to max_reinforcements
- **Parallel execution**: multiple Etask-executor agents concurrently
- **Error handling**: log failure, skip to next task, report all at end
- **No intermediate user prompts** after activation
- **Progress output**: periodic reports (e.g., "3/7 tasks complete")

## Execution Procedure

### Enable
1. Create `.qe/state/utopia-state.json` with mode
2. Read `.claude/settings.json` (create if not exists)
3. Merge `permissions.allow` (preserve existing)
4. Report: `Utopia mode ON ({mode}) — autonomous pipeline active`

### Disable (`/Qutopia off`)
1. Update state file: `enabled: false`
2. Remove `permissions.allow` from settings
3. Report: `Utopia mode OFF — confirmations restored`

## Safety
- Does NOT skip destructive git operations (force push, reset --hard)
- Does NOT skip file deletion outside .qe/
- Spec pipeline creates audit trail even in autonomous mode
- User can always `/Qutopia off`

## How Skills Check Utopia Mode
```
Read .qe/state/utopia-state.json
If enabled: true → skip AskUserQuestion, auto-select first option
If enabled: false or missing → normal behavior
```
