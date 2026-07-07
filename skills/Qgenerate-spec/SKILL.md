---
name: Qgenerate-spec
description: "Use when a plan or task needs spec documents: TASK_REQUEST and VERIFY_CHECKLIST. Use Qplan for roadmap/phases; use Qexecute after the spec exists."
invocation_trigger: When a new project, task, or bug fix spec needs to be defined.
user_invocable: true
recommendedModel: haiku
---

# Project Spec Document Generation (Qplan Component)

## Role
You are a specialist document writer acting as a **sub-component of the `Qplan` ecosystem**. Your primary goal is to transform a high-level roadmap Phase into **Haiku-Ready Atomic Tasks**.

## Role Constraints (Absolute Rules)
- When this skill is invoked, focus exclusively on writing the 3 spec documents.
- Do not perform any actions outside of document writing, such as writing code, fixing bugs, or answering general questions.
- **User confirmation MUST go through the interaction adapter.** Claude MUST use `AskUserQuestion` and MUST NOT print options as plain text. Codex interactive may print concise plain-text choices because `AskUserQuestion` is not a Codex primitive. Codex non-interactive MUST select the deterministic recommended default and report it.

## Client Adapter Compatibility

Interaction rules:
- **Claude**: use `AskUserQuestion` for Step 3 and any other structured choice.
- **Codex interactive**: ask concise plain-text choices with the same option labels.
- **Codex non-interactive**: choose **Generate Only** unless the task is already chained or the user explicitly requested execution.

Command rendering rules:
- Render handoff commands through `adapter.commandPrefix`.
- Claude examples use `/Q...`, for example `/Qexecute {UUID}`.
- Codex examples use `$Q...`, for example `$Qexecute {UUID}`.

## Documents to Generate

| # | Filename | Path | Description |
|---|----------|------|-------------|
| 1 | Project instruction artifact | Project root | Client-specific project context when needed. Claude adapter writes `CLAUDE.md`; Codex-capable projects may use `AGENTS.md` or an existing instruction artifact. Must reference `QE_CONVENTIONS.md` for QE rules. Task history is in `.qe/TASK_LOG.md`. |
| 2 | `TASK_REQUEST_{UUID}.md` | `.qe/tasks/pending/` | Task request — what, how, checklist, notes |
| 3 | `VERIFY_CHECKLIST_{UUID}.md` | `.qe/checklists/pending/` | Verification checklist — validation criteria, additional notes |

- A single task shares the same UUID across both documents.
- Multiple tasks get separate TASK_REQUEST / VERIFY_CHECKLIST pairs.
- Newly generated documents always go in `pending/`.

## SIVS Engine Routing

Before executing the spec generation workflow, resolve SIVS engine routing:

1. Read `.qe/sivs-config.json` from the project root (via `scripts/lib/codex_bridge.mjs` → `loadSivsConfig()`).
2. Call `resolveEngine("spec", config)`.
   - **Base client = Claude, stage engine = `claude` (default)**: Proceed with the standard workflow below. Claude owns the spec, but may delegate bounded repo search/context gathering to Codex when useful.
   - **Base client = Claude, stage engine = `codex`**: Delegate spec generation through `codex_bridge.mjs` / codex-plugin-cc. If the bridge is unavailable, warn and fall back to Claude.
   - **Base client = Codex, stage engine = `codex`**: Use the native Codex execution path. If native subagent delegation is unavailable, keep the work in the lead session as a role-separated inline pass and mark the route `degraded-inline`.
   - **Base client = Codex, stage engine = `claude`**: Delegate through `Qclaude-rescue` / `claude_bridge.mjs` when available. If the bridge is unavailable, warn and run the spec stage on Codex with `crossmodel=false`.
3. Check for legacy config: call `detectLegacyConfig()`. If non-null, display the migration warning to the user before proceeding.

**Codex Spec Delegation Format:**
When delegating to Codex, pass the following prompt structure:
```
Generate a TASK_REQUEST and VERIFY_CHECKLIST for: {user's task description}
Project context: {from active project instruction artifact, e.g. CLAUDE.md or AGENTS.md}
Phase context: {from ROADMAP.md active phase}
Format: Markdown with checklist items
```

**Fallback guarantee**: If `.qe/sivs-config.json` does not exist, all stages default to Claude. This preserves existing single-engine workflows while Codex routing remains available through SIVS config.

## QE MCP Companion Preflight

Before spec generation uses MCP-backed expert lookup, MCP runner tools, or cross-agent
help, invoke `{adapter.commandPrefix}Qmcp ensure`.

- `PASS` → expert-library and runner MCP tooling may be used.
- `WARN` → continue with local-only spec generation and record that MCP assistance was
  unavailable.
- `FAIL` → stop only when the requested spec explicitly depends on MCP-backed tools;
  otherwise continue without claiming MCP coverage.

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
4. **Missing Roadmap**: If no plan is resolvable and no flat roadmap exists either, **STOP** and suggest running `{adapter.commandPrefix}Qplan` first to maintain the PSE Chain integrity.

### Step 1.5: Brainstorming Gate (conditional, scale-aware)

Before gathering spec details, run a lightweight ambiguity check. If the incoming requirement is **ambiguous AND the task scale is Small or larger**, perform a concise Socratic clarification pass before drafting. (Source: adapted from Superpowers' brainstorming stage — but **scale-aware, not mandatory**; see `D019` in `.qe/planning/DECISION_LOG.md`.)

**This is our deliberate differentiator from Superpowers' blanket-mandatory brainstorming**: a one-line bug fix must never be forced through a clarification round.

**Gate condition** = `ambiguous(requirement) AND scale ≥ Small`.

- **Scale** is judged with the same heuristic as `Qplan` Step 0.7 (Micro / Small / Full / Workflow). **Micro tasks always skip this gate.**
- **Ambiguity** is true when **any 2 of these 3 objective signals** hold:
  1. **Core verb/noun unspecified** — the action or the target object is vague ("개선해", "정리해", "make it better") with no concrete subject.
  2. **No acceptance criteria** — nothing in the request or the resolved Phase Success Criteria states how "done" is verified.
  3. **Alternatives unconsidered** — the request fixes a solution without stating the problem, so no design choice was weighed.

**On gate trigger:** produce one of:
- `PASS` → ambiguity resolved (or never present); continue to Step 2 with the sharpened requirement.
- `CLARIFY` → unresolved gaps remain; surface its questions to the user before drafting. Do **not** draft specs from an unclarified `CLARIFY` requirement.

**Skip the gate entirely** when: scale is Micro, the requirement already cites specific file paths / functions / reproduction steps, or the task `type` is `docs`/`analysis` with a clear target. The gate is a **clarification prompt, not a hard block** — a `PASS` proceeds immediately with no added friction.

### Step 2: Information Gathering
... (omitted) ...

Required information:
- **Project name**, **description** (one-paragraph summary)
- **Goals** (1-5 items), **Constraints** (tech stack, performance, security, etc.), **Decisions** (finalized)
- **Task list** — for each task: what, how, steps (checklist), expected output files (optional), notes, type (`code`|`analysis`|`docs`|`other`), validation criteria (checks), verification notes, and optional decision rationale (chosen approach, alternatives, consequences)
- **Code Risk Register** — for every `type: code` task, include a mandatory risk section that names worst-case failure, data loss/corruption risk, security/permission risk, concurrency/race risk, rollback strategy, and unverified assumptions. If a category is not applicable, write `N/A` with the reason; do not omit it.

### Step 2: Draft Documents
Write drafts using templates from `templates/` directory (`TASK_REQUEST_TEMPLATE.md`, `VERIFY_CHECKLIST_TEMPLATE.md`). For any generated project instruction artifact, reference `QE_CONVENTIONS.md` (project root) for QE rules (file naming, task status, completion criteria) and include a reference line pointing to it. Replace `{{placeholder}}` with actual content.
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

1. Invoke `{adapter.commandPrefix}Qcritical-review --stage spec` against the just-drafted TASK_REQUEST
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
  "Generate & Execute". Present only **"Generate Only"**
  (so the draft is saved) and **"Fix spec & re-run gate"**, and list the
  CRITICAL/HIGH findings as required fixes. Execution options unlock only after the
  gate reaches WARN/PASS, or the user explicitly overrides with full awareness of
  the findings.
- **MANDATORY**: Use the interaction adapter to present these options.
  - Claude: `AskUserQuestion`.
  - Codex interactive: concise plain-text choices.
  - Codex non-interactive: Generate Only by default and report `selected_default=Generate Only`.
- **Recommend Wave**: If the checklist has 4+ independent items, clearly label **"Generate & Execute (Wave)"** as the **[Recommended]** path. Explain that Qexecute auto-selects parallel wave execution for maximum speed.
- **Auto-Chain**: Once the user selects an execution option, immediately invoke `{adapter.commandPrefix}Qexecute` with the generated UUIDs.

On "Generate & Execute":
- Auto-create directories and files
- Invoke `{adapter.commandPrefix}Qexecute {UUID}` immediately. (Sets `<!-- chained-from: Qgenerate-spec -->` flag so Qexecute skips approval)

On "Generate Only":
- Auto-create directories (`mkdir -p`)
- Create all spec files
- If existing `TASK_REQUEST_*.md` / `VERIFY_CHECKLIST_*.md` found in project root, suggest migrating to `.qe/tasks/pending/` and `.qe/checklists/pending/`
- **On initial setup**, scope client-specific files to the active adapter:
  - Claude adapter: if `.claude/settings.json` and project `.mcp.json` are expected but missing, suggest creating them with defaults.
  - Codex adapter: do not ask for Claude-only settings; verify Codex hook trust/readiness through the Codex installer and `/hooks` workflow when needed.
- **Automatic `.gitignore` management:** Add missing shared entries under `# QE Framework` section:
  ```gitignore
  # QE Framework
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
- Project instruction artifact when this invocation created or migrated one
- .qe/tasks/pending/TASK_REQUEST_{UUID}.md
- .qe/checklists/pending/VERIFY_CHECKLIST_{UUID}.md

❌ Not yet created (actual deliverables):
- {expected output files from TASK_REQUEST checklist}
```

On "Generate & Execute" with multiple tasks:
- **Multiple tasks** → invoke `{adapter.commandPrefix}Qexecute {UUID1} {UUID2} ... {UUIDn}` with all generated UUIDs space-separated in a single call. Qexecute handles parallel execution.

## Autonomous Mode Support

When called from Qexecute -utopia (autonomous mode), Qgenerate-spec:
- Skips all interaction prompts — auto-selects the documented default
- Auto-proceeds through Steps 1-3 without user confirmation
- Sets `<!-- chained-from: Qgenerate-spec -->` on generated TASK_REQUEST files

See `Qexecute -utopia` for autonomous execution modes (`-utopia`, `-utopia -verify`).

## Document Writing Rules

### Language Matching (Required)
TASK_REQUEST and VERIFY_CHECKLIST must match the user's language.
- Korean user → Korean documents; English user → English documents; mixed/unclear → English
- **Scope:** TASK_REQUEST and VERIFY_CHECKLIST only. Internal framework files stay English. CLAUDE.md follows user language when specified.

### Project Instruction Artifact
- Single Source of Truth for client-specific project context; Claude adapter uses `CLAUDE.md`, Codex-capable projects may use `AGENTS.md` or an equivalent QE-managed instruction file.
- **Do NOT write task lists in the instruction artifact.** Task history lives in `.qe/TASK_LOG.md`. The instruction artifact only contains a reference pointer: `## Task Log` → see `.qe/TASK_LOG.md`

### TASK_REQUEST
- **What vs How**: Clearly separate the business goal from the technical implementation logic (from QE planning patterns).
- **Atomic Items**: Every checklist item must be **independent** and **verifiable**.
- **Dependency Mapping**: If an item depends on another, mark it: `- [ ] {desc} <!-- depends_on: [UUID/Item#] -->`.
- **Haiku-Ready**: Ensure items are small enough to be implemented without Sonnet-level reasoning.
- **Output files**: Always append `→ output: {file-path}` for direct accountability.
- **Role ownership**: In role-separated or tiered orchestration, identify the expected implementer-owned files or modules so the reviewer can later judge boundary violations.
- **Code Risk Register (mandatory for `type: code`)**: Add this section before the checklist and fill every field:
  ```markdown
  ## Risk Register
  - Worst-case failure:
  - Data loss / corruption risk:
  - Security / permission risk:
  - Concurrency / race risk:
  - Rollback strategy:
  - Unverified assumptions:
  ```
  The register is a hard SIVS contract. Empty fields, placeholder text, or omitted categories block execution until fixed.

### VERIFY_CHECKLIST
- Each criterion answerable as yes/no
- Task complete when all items checked
- Include note to update `.qe/TASK_LOG.md` task list to ✅
- **Auto-include by type:**
  - `type: code` → add: "No security vulnerabilities (OWASP Top 10) in changed code", "All existing tests pass", "Worst-case failure path is identified", "Data loss/corruption, security/permission, and concurrency/race risks are explicitly evaluated or marked N/A with reason", "Unverified assumptions and residual risks are reported in the final handoff", "High-risk findings are mitigated by tests, defensive code, or an explicit defer rationale"
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
5. Report to the user: a bulleted list of newly created pending drafts with their paths, and a note that they can be promoted via `{adapter.commandPrefix}Qcontract approve` after review.

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
Next: {adapter.commandPrefix}Qexecute {UUID}
```

Note: "Generate & Execute" auto-chains, so the handoff is only needed for "Generate Only".

## Output Format
- Wrap document content in markdown code blocks when displaying
- Pure markdown only, no JSON
