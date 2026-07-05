# QE Usage Guide

## 1. Install

Run in your terminal:

```bash
git clone https://github.com/inho-team/qe-framework.git
cd qe-framework
git checkout v<version>
npm pack --cache /tmp/qe-npm-cache
npm install -g ./inho-team-qe-framework-<version>.tgz
qe-framework-install
```

Update later with:

```bash
git pull
npm pack --cache /tmp/qe-npm-cache
npm install -g ./inho-team-qe-framework-<version>.tgz
qe-framework-install
```

Uninstall with:

```bash
qe-framework-uninstall
```

The install is **dual-target** — it installs into both Claude and Codex:

- **Claude**: QE skills, agents, core, hooks, and scripts under `~/.claude` (as a plugin, or standalone).
- **Codex** (when `~/.codex` exists): QE skills → `~/.codex/skills`, agents → `~/.codex/agents/*.toml`,
  a managed agent fence + a `[[hooks.PreToolUse]]` safety-hook fence in `~/.codex/config.toml`.
  Skipped silently if you are not a Codex user (`~/.codex` absent).

After a Codex install, run `/hooks` inside Codex once to **review and approve** the QE
safety hook (Codex requires you to trust hook definitions; the installer never auto-bypasses).

**Parity ceiling (honest):**
- ✅ Supported: skill/agent install and safety guards are implemented on Codex. The
  Codex `PreToolUse` guard blocks raw `git commit`, `gh pr create`, in-place
  `sed -i`, and direct `plugin.json` version writes after the hook bundle is trusted.
- ✅ Supported: runtime guidance is delivered inside the session through SessionStart
  context and hook messages.
- ⚠️ Degrades: skills that delegate to E-agents run **inline** on Codex — Codex only spawns
  sub-agents on explicit request (`/agent`), not via automatic skill delegation. The agents are
  installed and available for manual `/agent` invocation.
- See `.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md` for the measured
  Claude/Codex parity matrix.
- You can still route individual SIVS stages to Codex as an **engine** via `codex-plugin-cc` + the active-client `Qsivs-config` command.

> `qe-framework-uninstall` removes the Claude assets and (with `--purge-codex`) the Codex
> assets too — skills matched by a name manifest, agents + hook fence by their managed fences.
> A plain uninstall reports Codex orphans (dry-run) and never deletes non-QE content.

## 2. Initialize a Project

Use the active client command:

```text
Claude: /Qinit
Codex:  $Qinit
```

This creates:
- default project instruction artifact (Claude adapter: `CLAUDE.md`; Codex-capable projects may use `AGENTS.md`)
- `.qe/`
- project analysis files
- optional `.qe/ai-team/` scaffolding when the user opts into role-based orchestration

## 3. Standard Workflow

Claude uses slash commands. Codex uses the same QE skill names with the `$`
prefix.

### Plan

```text
Claude: /Qplan
Codex:  $Qplan
```

Creates or updates planning artifacts in `.qe/planning/`.

### Spec

```text
/Qgs
$Qgs
```

Generates task specs from the active plan.

### Execute

```text
/Qatomic-run
$Qatomic-run
```

- `single-model`: Claude/Haiku atomic swarm path
- `hybrid` / `multi-model`: configured implementer runner path
- `tiered-model`: high-tier planning/judgment with cheaper lower-tier execution

Use `/Qrun-task` (`$Qrun-task` on Codex) instead when the work is not meaningfully atomic.

### Verify

```text
/Qcode-run-task
$Qcode-run-task
```

Runs the review/verification loop.

When a workflow relies on agent delegation, QE normalizes the behavior through
the client adapter. Claude uses the Agent tool; Codex uses generated native
subagents and falls back to role-separated inline execution only when a runtime
lacks the required primitive.

## 4. Writing Shared Skills And Agents Step By Step

Write QE instructions as a small executable recipe. The same skill or agent
should read naturally in Claude and Codex without assuming one client's command
prefix, hook names, or delegation primitive.

### Step 1. Start with a generic rule

Describe the intent without naming a client-specific primitive:

```text
1. Resolve the active client adapter.
2. Render user-facing QE commands with {adapter.commandPrefix}.
3. Delegate through the agent adapter when the runtime exposes a subagent primitive.
4. Fall back to role-separated inline execution when delegation is unavailable.
5. Report which path was used.
```

### Step 2. Add the Claude adapter behavior

Use Claude-specific terms only inside a labeled Claude adapter section:

```text
Claude adapter:
- commandPrefix = /
- interaction prompts use the Claude question surface
- delegated execution may use the Claude Agent tool
- status guidance uses session context and hook messages
```

### Step 3. Add the Codex adapter behavior

Use Codex-specific terms only inside a labeled Codex adapter section:

```text
Codex adapter:
- commandPrefix = $
- installed skills live under ~/.codex/skills
- generated native agents live under ~/.codex/agents
- lifecycle safety uses the Codex hook fence and wrapper scripts
- status guidance uses session context and hook messages
```

### Step 4. Write user commands as paired or adapter-neutral examples

Prefer paired examples when documentation is user-facing:

```text
Claude: /Qplan
Codex:  $Qplan
```

Prefer adapter-neutral templates inside reusable skill text:

```text
Next: {adapter.commandPrefix}Qgs Phase 2: Runtime Parity
```

### Step 5. State degraded behavior explicitly

Do not silently pretend parity exists when the clients expose different
primitives:

```text
If native subagents are unavailable, run the same role instructions inline,
label the result degraded-inline, and include the missing primitive in the
final report.
```

### Step 6. Verify the shared surface

Run the client-neutrality guard after changing public docs, skills, agents, or
lifecycle text:

```bash
node scripts/check-client-neutrality.mjs
node scripts/check-client-neutrality.mjs --docs
node --test scripts/lib/__tests__/client-neutrality.test.mjs
```

Reference docs:
- `core/INTERACTION_ADAPTER.md`
- `core/LIFECYCLE_ADAPTER.md`
- `.qe/planning/plans/claude-codex-generalization/phases/1/ADAPTER_CONTRACT.md`

When a workflow needs something the model cannot do directly, use
`/Quser-action` (`$Quser-action` on Codex). It writes a durable
`.qe/user-actions/pending/*.md` request with the exact user action, expected
result, and unblock instructions instead of losing the request in chat.

## 5. Mode Selection

### `single-model`

Use this when the user only has Claude or wants the legacy path.

- no role split required
- the active-client `Qatomic-run` command uses the Haiku swarm path
- simplest setup

### `hybrid`

Use this when only some roles should move to external runners.

Examples:
- Claude + Codex
- Claude + Gemini

### `multi-model`

Use this when all four roles should be explicitly assigned by role.

Example:
- planner = Claude
- implementer = Codex
- reviewer = Gemini
- supervisor = Claude

### `tiered-model`

Use this when you want to reduce total token cost without losing strong planning and validation.

Typical Claude setup:
- planner = Opus
- implementer = Sonnet
- reviewer = Sonnet
- supervisor = Opus
- low-complexity helper runner = Haiku

Typical Codex setup:
- planner = GPT-5.4
- implementer = GPT-5-Codex
- reviewer = GPT-5-Codex
- supervisor = GPT-5.4
- low-complexity helper runner = GPT-5-Codex-Mini

Current runtime behavior:
- planner and supervisor stay on the configured higher-tier runners
- reviewer stays on the configured review runner
- implementer can be auto-routed by `task-bundle.json` complexity in `tiered-model`

## 6. Recommended Subscription Presets

| Available tools | Suggested mode | Suggested default mapping |
|-----------------|----------------|---------------------------|
| Claude single-engine | `single-model` | Claude owns all roles |
| Tiered Claude | `tiered-model` | planner/supervisor = Opus, implementer/reviewer = Sonnet, low-tier helper = Haiku |
| Tiered Codex | `tiered-model` | planner/supervisor = GPT-5.4, implementer/reviewer = GPT-5-Codex, low-tier helper = GPT-5-Codex-Mini |
| Claude + Codex | `hybrid` | implementer = Codex, others = Claude |
| Claude + Gemini | `hybrid` | reviewer = Gemini, others = Claude |
| Claude + Codex + Gemini | `multi-model` | planner/supervisor = Claude, implementer = Codex, reviewer = Gemini |

## 7. Role-Orchestration Files

When `hybrid`, `multi-model`, or `tiered-model` is enabled, QE uses:

- `.qe/ai-team/config/team-config.json`
- `.qe/ai-team/artifacts/role-spec.md`
- `.qe/ai-team/artifacts/task-bundle.json`
- `.qe/ai-team/artifacts/implementation-report.md`
- `.qe/ai-team/artifacts/review-report.md`
- `.qe/ai-team/artifacts/verification-report.md`

See [MULTI_MODEL_SETUP.md](MULTI_MODEL_SETUP.md) for details.

## 8. Quota-Blocked Runner Fallback

If Codex or Gemini is temporarily blocked by quota or subscription limits:

1. the workflow reports `blocked_quota`
2. fallback runners are suggested
3. the active-client `Qatomic-run` or `Qcode-run-task` command should ask the user whether to borrow another runner for this run only
4. retry happens with `--role-override`

Example:

```bash
node scripts/run_team_workflow.mjs --config .qe/ai-team/config/team-config.json --from-role implementer --execute --role-override implementer=claude_implementer
```

This does not rewrite `team-config.json`.

## 9. Useful Commands

```text
Claude: /Qcommit
Codex:  $Qcommit
Claude: /Qrefresh
Codex:  $Qrefresh
Claude: /Qcompact
Codex:  $Qcompact
Claude: /Qresume
Codex:  $Qresume
Claude: /Qhelp
Codex:  $Qhelp
Claude: /Qsecret
Codex:  $Qsecret
Claude: /Qmcp sync
Codex:  $Qmcp sync
Claude: /Qutopia status   # check autonomous mode (read section 11 first!)
Codex:  $Qutopia status
```

Optional expert-library MCP guidance is distributed separately from this
framework package at `https://github.com/inho-team/qe-mcp`. Install or sync that
package when you need `qe_search_experts`, `qe_read_expert`, or
`qe_expert_prompt` without increasing the default QE Framework install size.

## 10. Secret Management

Use `Qsecret` when you want QE to manage an API key or token without storing plaintext in the project.

Capabilities:
- metadata-only registries in `.qe/secrets/registry.json` or `~/.qe/secrets/registry.json`
- OS-backed secret storage
- one-run env injection into child processes

See [SECRETS.md](SECRETS.md) for commands and backend behavior.

## 11. Autonomous Mode (`/Qutopia` / `$Qutopia`) — ⚠️ Read Before Enabling

`Qutopia` turns on a session-level flag that tells **every** QE skill to stop asking questions and drive itself. It is the single fastest way to finish a well-scoped task, and also the single fastest way to commit the wrong files, push to `main`, or chain into destructive operations you didn't approve.

### What it actually does

When `.qe/state/utopia-state.json` is `enabled: true`:

- Interaction prompts auto-select the **first (recommended)** option.
- `Qgenerate-spec` skips the "Generate & Execute / Generate Only / Needs Revision" prompt and proceeds to Atomic-Run.
- `Qrun-task` skips Step 2 approval and moves files straight to `in-progress`.
- `Qcommit` runs automatically after task completion.
- `--ralph` loops the PSE Chain until `VERIFY_CHECKLIST` is fully green, without human gate between rounds.
- Claude: `.claude/settings.json` gains broad tool permissions: `Bash(*)`, `Agent(*)`, `WebFetch`, `WebSearch`, `NotebookEdit`.
- Codex: `.claude/settings.json` is not modified; autonomy is controlled by QE state plus the active Codex session policy and QE hook rails.

### Commands

| Claude | Codex | Behavior |
|--------|-------|----------|
| `/Qutopia status` | `$Qutopia status` | Show current state — run this **before** toggling |
| `/Qutopia` | `$Qutopia` | Auto-classify SIMPLE vs COMPLEX, pick work/qa mode |
| `/Qutopia --work` | `$Qutopia --work` | Spec -> Run -> Verify (no quality loop) |
| `/Qutopia --qa` | `$Qutopia --qa` | Spec -> Run -> Verify + full code-quality loop |
| `/Qutopia --ralph` | `$Qutopia --ralph` | Loop until VERIFY_CHECKLIST is fully checked (no human gate between rounds) |
| `/Qutopia --ralph off` | `$Qutopia --ralph off` | Stop Ralph loop |
| `/Qutopia off` | `$Qutopia off` | Disable — **always run this before ending the session** |

### ⚠️ Pre-flight Checklist (ALL must be true)

Do not enable Qutopia unless you can honestly say yes to every one of these:

1. **Requirements are explicit.** You have a concrete `TASK_REQUEST` with atomic checklist items, not a vague goal. Ambiguity + autonomy = wrong answer fast.
2. **Every planned step is reversible.** No `push --force`, no schema migrations against prod, no `rm -rf`, no operations that mutate external systems (Slack, Jira, deploys). If something goes sideways you can `git reset`, revert the PR, and move on.
3. **Commit scope is narrow.** The working tree only contains changes related to this task. Stray edits from other work will end up in the auto-commit.
4. **You're not on a shared branch.** Never enable Qutopia while sitting on `main`/`master` on a team repo. Create a feature branch first.
5. **You accept auto-commit and (with `--ralph`) auto-iteration** without re-confirmation per round.

If any of these is false, keep Qutopia OFF and accept the prompts — the 10 extra minutes of interaction wait is cheaper than one wrong push.

### Safe patterns

- ✅ **Batch patch across files** on a feature branch (e.g., applying a known rename across 30 files).
- ✅ **Re-run a known-good PSE chain** after a minor spec tweak.
- ✅ **Overnight `--ralph` loop** on an isolated branch with CI gating the PR.

### Unsafe patterns (leave Qutopia OFF)

- New project kick-off, active-client `Qinit` bootstrapping, ambiguous requirements.
- ❌ First time using a skill or agent — you don't yet know what its "recommended" option is.
- ❌ Any task that touches production configs, secrets, or external services.
- ❌ Working on `main` directly, or with uncommitted unrelated changes in the tree.
- ❌ Using a new/untrusted MCP server (auto-allowed tool permissions widen the blast radius).

### Recommended lifecycle

```
git checkout -b feat/<scope>       # isolate blast radius
<prefix>Qutopia status             # confirm it's OFF; prefix is / on Claude, $ on Codex
<prefix>Qplan "do X"               # interactive planning (still wants you in the loop here)
<prefix>Qgs Phase 1: ...           # generates TASK_REQUEST + VERIFY_CHECKLIST
# Review the generated spec manually — this is your last chance to catch wrong defaults
<prefix>Qutopia --work             # NOW flip the switch, for this bounded run only
# ... skills execute without prompting ...
<prefix>Qutopia off                # ALWAYS disable when the bounded run ends
git log && git diff origin/main    # audit what Qutopia committed before pushing
```

Leaving Qutopia on across sessions is the single most common way to get surprise commits.

## 12. When To Read Which Doc

- Philosophy and design intent: [PHILOSOPHY.md](PHILOSOPHY.md)
- Detailed role routing and config: [MULTI_MODEL_SETUP.md](MULTI_MODEL_SETUP.md)
- Shared interaction adapter: [../core/INTERACTION_ADAPTER.md](../core/INTERACTION_ADAPTER.md)
- Shared lifecycle adapter: [../core/LIFECYCLE_ADAPTER.md](../core/LIFECYCLE_ADAPTER.md)
- Shared MCP registry and client sync: [MCP_GLOBAL_SETUP.md](MCP_GLOBAL_SETUP.md)
- Secret storage and injection: [SECRETS.md](SECRETS.md)
- System components and hook architecture: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
- Full doc index: [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md)
