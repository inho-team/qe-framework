---
name: Qgenerate-spec
description: Generates 3 project spec documents (CLAUDE.md, TASK_REQUEST, VERIFY_CHECKLIST) from a project description. Use when the user wants to start a new project, define task specifications, or create a task.
invocation_trigger: When a new project, task, or bug fix spec needs to be defined.
user_invocable: true
recommendedModel: haiku
---

# Project Spec Document Generation (Qplan Component)

## Role
You are a specialist document writer acting as a **sub-component of the `/Qplan` ecosystem**. Your primary goal is to transform a high-level roadmap Phase into **Haiku-Ready Atomic Tasks**.

## Role Constraints (Absolute Rules)
- When this skill is invoked, focus exclusively on writing the 3 spec documents.
- Do not perform any actions outside of document writing, such as writing code, fixing bugs, or answering general questions.
- **User confirmation MUST use `AskUserQuestion` tool — NEVER print options as plain text.** This applies to Step 3 and any other point requiring user input. Printing "Generate & Execute / Generate Only / Needs Revision" as text is strictly prohibited.

## Documents to Generate

| # | Filename | Path | Description |
|---|----------|------|-------------|
| 1 | `CLAUDE.md` | Project root | Project context — goals, constraints, decisions. Must reference `QE_CONVENTIONS.md` for QE rules. Task history is in `.qe/TASK_LOG.md`. |
| 2 | `TASK_REQUEST_{UUID}.md` | `.qe/tasks/pending/` | Task request — what, how, checklist, notes |
| 3 | `VERIFY_CHECKLIST_{UUID}.md` | `.qe/checklists/pending/` | Verification checklist — validation criteria, additional notes |

- A single task shares the same UUID across both documents.
- Multiple tasks get separate TASK_REQUEST / VERIFY_CHECKLIST pairs.
- Newly generated documents always go in `pending/`.

## SIVS Engine Routing

Before executing the spec generation workflow, check if SIVS engine configuration exists:

1. Read `.qe/sivs-config.json` from the project root (via `scripts/lib/codex_bridge.mjs` → `loadSivsConfig()`).
2. Check `spec.engine` value:
   - **`"claude"` (default)**: Proceed with the standard workflow below. No changes.
   - **`"codex"`**: Delegate spec generation to Codex via codex-plugin-cc:
     1. Call `resolveEngine("spec", config)` to check availability.
     2. If codex-plugin-cc is available: invoke `/codex:rescue` with the project context and task description as input. Parse the returned spec into TASK_REQUEST and VERIFY_CHECKLIST format.
     3. If codex-plugin-cc is NOT available: show warning message and fallback to Claude (standard workflow).
3. Check for legacy config: call `detectLegacyConfig()`. If non-null, display the migration warning to the user before proceeding.

**Codex Spec Delegation Format:**
When delegating to Codex, pass the following prompt structure:
```
Generate a TASK_REQUEST and VERIFY_CHECKLIST for: {user's task description}
Project context: {from CLAUDE.md}
Phase context: {from ROADMAP.md active phase}
Format: Markdown with checklist items
```

**Fallback guarantee**: If `.qe/sivs-config.json` does not exist, all stages default to Claude. This ensures zero impact on existing Claude-only workflows.

## Workflow

### Step 1: Context Acquisition (Mandatory)
Before collecting user info, identify the strategic context:
1. **Resolve active plan** (slug-based Named Plan layout):
   - If the first CLI token matches `{slug}:` (where slug is `[a-z0-9][a-z0-9-]{0,63}`), use that as the plan slug and strip it from the argument string.
   - Else read `.qe/state/current-session.json` → extract `session_id` → read `.qe/planning/.sessions/{session_id}.json` → extract `activePlanSlug`.
   - Else read `.qe/planning/ACTIVE_PLAN` (single-line slug pointer).
   - Else (no slug resolvable): fall back to legacy flat `.qe/planning/ROADMAP.md` + `STATE.md` and proceed as before.
2. **Check Roadmap**: When a slug is resolved, read `.qe/planning/plans/{slug}/ROADMAP.md` and `plans/{slug}/STATE.md`. When falling back, read the flat files.
3. **Identify Phase**: If an active Phase exists in the resolved STATE.md, use its **Success Criteria** and **Requirement IDs** as the primary source of truth for the spec.
4. **Missing Roadmap**: If no plan is resolvable and no flat roadmap exists either, **STOP** and suggest running `/Qplan` first to maintain the PSE Chain integrity.

### Step 2: Information Gathering
... (omitted) ...

Required information:
- **Project name**, **description** (one-paragraph summary)
- **Goals** (1-5 items), **Constraints** (tech stack, performance, security, etc.), **Decisions** (finalized)
- **Task list** — for each task: what, how, steps (checklist), expected output files (optional), notes, type (`code`|`analysis`|`docs`|`other`), validation criteria (checks), verification notes, and optional decision rationale (chosen approach, alternatives, consequences)

### Step 2: Draft Documents
Write drafts using templates from `templates/` directory (`TASK_REQUEST_TEMPLATE.md`, `VERIFY_CHECKLIST_TEMPLATE.md`). For CLAUDE.md, reference `QE_CONVENTIONS.md` (project root) for QE rules (file naming, task status, completion criteria) and include a reference line pointing to it. Replace `{{placeholder}}` with actual content.
- **Model Preference**: Use **Haiku** for drafting standardized templates to reduce latency.

### Step 2.4: Premise Verification (Mandatory for external dependencies)
Before drafting specs, verify that any external platform features, APIs, or tools referenced in the task actually exist and work as claimed.

**When to run:** Any task that depends on features outside the project's own codebase — Claude Code CLI features, npm packages, OS commands, API endpoints, plugin.json fields, hook events, etc.

**Procedure:**

1. **CLI feature claims** → Run `command --help` or `command --version` via Bash and check the output
2. **Plugin.json fields** → Compare against a known working plugin.json (the one before changes)
3. **Hook events** → Check against the project's existing working `hooks.json` events
4. **API features** → Fetch official documentation URL or run a minimal test call
5. **npm packages** → Run `npm info {package} version` to confirm existence

**Outcome:**
- Verified → proceed normally
- Unverified → tag the item with `[UNVERIFIED]` in TASK_REQUEST and alert the user via additionalContext: "This task depends on unverified external feature: {feature}. Confirm before proceeding."
- Disproved → remove the item from the spec and report to user

**Skip conditions:** Tasks with no external dependencies (pure local logic, documentation, analysis).

### Step 2.5: Spec Verification (Automatic)
After drafting, verify spec quality. **Skip conditions (fast path):** checklist ≤ 3 items OR `type: docs`/`analysis` → skip entirely, proceed to Step 3.

When verification runs, perform **both structural and executability checks in a single pass**:

**Structural criteria (S1-S5) — Use Haiku**:
1. Single responsibility per item
2. Specific and verifiable (yes/no)
3. TASK_REQUEST/VERIFY_CHECKLIST consistency
4. No constraint conflicts
5. No missing dependencies

**Executability criteria (E1-E4) — Use Sonnet**:

| # | Criterion | Fail Example |
|---|-----------|--------------|
| E1 | Single-action executability | `"Design API and implement routes"` — two distinct edits |
| E2 | Output path validity | `→ output: src/utils/helper` — missing extension |
| E3 | Logical ordering | Item 3 references file from Item 5 |
| E4 | Verifiable completion | `"Refactor code appropriately"` — subjective |

**For complex tasks (8+ items):** Spawn Plan agent (`subagent_type: "Plan"`, model: **Haiku**) for S1-S5 review while self-checking E1-E4 in parallel using **Sonnet**. Max 2 iterations.

**For simple tasks (4-7 items):** Self-check all 9 criteria without agent spawn. Use **Sonnet** for full-pass or **Haiku** for S1-S5 if splitting. Max 1 iteration.

Any fail → fix automatically. After max iterations, proceed with best version.

### Step 2.6: Spec Self-Reference Gate (MANDATORY — no skip)

Step 2.5 checks spec *quality* with the same model that drafted it — which cannot
catch errors rooted in that model's own blind spots (the **self-reference
problem**, acute when the SIVS engine is homogeneously all-Claude or all-Codex).
Step 2.6 closes that gap with an **independent adversarial gate**.

**This gate ALWAYS runs.** Unlike Step 2.5, it has **no skip conditions** — it
runs regardless of item count or task type (DECISION_LOG D011). Spec-stage errors
are independent of size, so size-based skipping would reopen the exact hole this
gate exists to close.

**Procedure:**

1. Invoke `/Qcritical-review --stage spec` against the just-drafted TASK_REQUEST
   (+ VERIFY_CHECKLIST). The gate spawns the Structural Reviewer + Critical
   Reviewer + Edge Case Finder in parallel and returns a PASS/WARN/FAIL verdict.
   Engine routing is automatic: same-engine baseline always, with the Critical
   Reviewer auto-upgraded to codex when reachable — no config required. Full
   protocol: `skills/Qcritical-review/reference/spec-gate-protocol.md`.
2. **On FAIL:** the spec contains CRITICAL/HIGH problems. Revise the TASK_REQUEST
   / VERIFY_CHECKLIST to address them and re-run the gate (max 2 iterations).
   Then enter Step 3 in **blocked mode** (see below) if still FAIL.
3. **On WARN/PASS:** proceed to Step 3 normally, carrying any WARN notes forward.

**Skip conditions:** none. (Autonomous mode still runs the gate; on FAIL it
auto-revises up to the iteration cap, then proceeds Generate-Only.)

### Step 3: Review, Create, and Execute (The High-Performance Path)
- **GATE-BLOCKED (Step 2.6 FAIL):** If the Spec self-reference gate returned FAIL
  after its iteration cap, this is a **hard gate** — do **NOT** offer
  "Generate & Execute" or "Generate & Atomic-Run". Present only **"Generate Only"**
  (so the draft is saved) and **"Fix spec & re-run gate"**, and list the
  CRITICAL/HIGH findings as required fixes. Execution options unlock only after the
  gate reaches WARN/PASS, or the user explicitly overrides with full awareness of
  the findings.
- **MANDATORY**: Use `AskUserQuestion` to present these options.
- **Recommend Atomic-Run**: If the checklist has 4+ independent items, clearly label **"Generate & Atomic-Run (Wave)"** as the **[Recommended]** path. Explain that it uses multiple parallel Haiku agents for maximum speed.
- **Auto-Chain**: Once the user selects an execution option, immediately invoke the corresponding skill (`/Qrun-task` or `/Qatomic-run`) with the generated UUIDs.

On "Generate & Atomic-Run":
- Auto-create directories and files
- Invoke `/Qatomic-run {UUID}` immediately. (Sets `<!-- chained-from: Qgenerate-spec -->` flag so Qatomic-run skips approval)


On "Generate & Execute" or "Generate Only":
- Auto-create directories (`mkdir -p`)
- Create all spec files
- If existing `TASK_REQUEST_*.md` / `VERIFY_CHECKLIST_*.md` found in project root, suggest migrating to `.qe/tasks/pending/` and `.qe/checklists/pending/`
- **On initial setup**, if `.claude/settings.json` and `.mcp.json` don't exist, suggest creating with defaults
- **Automatic `.gitignore` management:** Add missing entries under `# Claude Code` section:
  ```gitignore
  # Claude Code
  .claude/settings-local.json
  .qe/tasks/
  .qe/checklists/
  TASK_REQUEST_*.md
  VERIFY_CHECKLIST_*.md
  ANALYSIS_*.md
  ```

Output status summary after file creation:
```
✅ Generation complete (spec documents only):
- CLAUDE.md
- .qe/tasks/pending/TASK_REQUEST_{UUID}.md
- .qe/checklists/pending/VERIFY_CHECKLIST_{UUID}.md

❌ Not yet created (actual deliverables):
- {expected output files from TASK_REQUEST checklist}
```

On "Generate & Execute":
- **Single task** → invoke `/Qrun-task {UUID}` immediately.
- **Multiple tasks** → invoke `/Qrun-task {UUID1} {UUID2} ... {UUIDn}` with all generated UUIDs space-separated in a single call. Qrun-task handles parallel execution.

## Autonomous Mode Support

When called from Qutopia (autonomous mode), Qgenerate-spec:
- Skips all `AskUserQuestion` calls — auto-selects first option
- Auto-proceeds through Steps 1-3 without user confirmation
- Sets `<!-- chained-from: Qgenerate-spec -->` on generated TASK_REQUEST files

See `Qutopia` for autonomous execution modes (`--work`, `--qa`).

## Document Writing Rules

### Language Matching (Required)
TASK_REQUEST and VERIFY_CHECKLIST must match the user's language.
- Korean user → Korean documents; English user → English documents; mixed/unclear → English
- **Scope:** TASK_REQUEST and VERIFY_CHECKLIST only. Internal framework files stay English. CLAUDE.md follows user language when specified.

### CLAUDE.md
- Single Source of Truth; read by AI every session
- **Do NOT write task lists in CLAUDE.md.** Task history lives in `.qe/TASK_LOG.md`. CLAUDE.md only contains a reference pointer: `## Task Log` → see `.qe/TASK_LOG.md`

### TASK_REQUEST
- **What vs How**: Clearly separate the business goal from the technical implementation logic (from QE planning patterns).
- **Atomic Items**: Every checklist item must be **independent** and **verifiable**.
- **Dependency Mapping**: If an item depends on another, mark it: `- [ ] {desc} <!-- depends_on: [UUID/Item#] -->`.
- **Haiku-Ready**: Ensure items are small enough to be implemented without Sonnet-level reasoning.
- **Output files**: Always append `→ output: {file-path}` for direct accountability.
- **Role ownership**: In role-separated or tiered orchestration, identify the expected implementer-owned files or modules so the reviewer can later judge boundary violations.

### VERIFY_CHECKLIST
- Each criterion answerable as yes/no
- Task complete when all items checked
- Include note to update `.qe/TASK_LOG.md` task list to ✅
- **Auto-include by type:**
  - `type: code` → add: "No security vulnerabilities (OWASP Top 10) in changed code", "All existing tests pass"
  - `type: code` + auth/crypto/payment → add: "Authentication/encryption implementation is secure (Esecurity-officer or manual review)"
  - `type: docs` → add: "All links in documentation are valid", "Terminology and formatting are consistent"

## UUID Generation Rules
- 8-character hex (e.g., `a1b2c3d4`), generated randomly
- Same UUID shared between TASK_REQUEST and VERIFY_CHECKLIST for same task
- **Collision check**: Before using a UUID, verify no file matching `TASK_REQUEST_{UUID}.md` already exists in `.qe/tasks/pending/` or `.qe/tasks/completed/`. If it exists, generate a new random UUID and check again.
- Generate UUIDs via bash: `openssl rand -hex 4` (produces 8-char hex)

## Self-Evolving
- After completing tasks, if recurring patterns found, suggest template improvements
- On user approval, reflect patterns in future generation

## Contract Candidate Extraction (Optional)

After draft creation (Step 2) and before handing off, check whether the TASK_REQUEST opts into **contract candidate extraction**.

**Opt-in marker**: If the TASK_REQUEST body contains the exact HTML-comment marker `<!-- contract-candidates: auto -->`, enter this flow. If absent, skip entirely.

**Flow**:
1. Read the newly drafted TASK_REQUEST text.
2. Call `extractCandidates(taskRequestText)` from `hooks/scripts/lib/contract-candidate-extractor.mjs`.
3. For each candidate `{name, targetPath, suggestedSignature}`:
   - Read `.qe/contracts/TEMPLATE.md` as the base.
   - Fill in a draft:
     - Replace the example `Signature` body with a code block containing `suggestedSignature` (empty string initially — user fills in later).
     - Replace the example `Purpose` with a single line: `Business-logic contract for \`${targetPath}\``
     - Leave `Constraints`, `Invariants`, `Error Modes` as lightly pre-filled placeholders (e.g., `- TBD (candidate draft)`).
     - Omit `Flow` (optional section) unless the user fills it.
   - Write to `.qe/contracts/pending/${name}.md`.
4. **Do not write to `.qe/contracts/active/`** — user must review and promote manually. This preserves the opt-in, user-in-the-loop principle (D011).
5. Report to the user: a bulleted list of newly created pending drafts with their paths, and a note that they can be promoted via `/Qcontract approve` after review.

**Skip conditions**:
- Marker absent → skip silently.
- `extractCandidates` returns `[]` → skip with a short note ("Marker present but no `.mjs` output items found in checklist.").
- A pending draft with the same name already exists → skip that one, warn the user ("Draft already pending: {name}.md").

**Reference**: See `.qe/contracts/README.md` and D011 in `.qe/planning/DECISION_LOG.md` (DECISION_LOG stays global across all plans).

## Handoff
After generating spec files (on "Generate Only"), display using the standard handoff format from `QE_CONVENTIONS.md`:

```
Phase {X}: {PhaseName} — Spec complete

PSE: [x] Plan [x] Spec [>] Execute [ ] Verify

{TaskDescription — 다음 작업 내용 한 줄 요약}
Next: /Qatomic-run {UUID}
```

Note: "Generate & Execute" and "Generate & Atomic-Run" options auto-chain, so the handoff is only needed for "Generate Only".

## Output Format
- Wrap document content in markdown code blocks when displaying
- Pure markdown only, no JSON
