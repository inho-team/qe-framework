---
name: Qdoctor
user_invocable: false
description: "Diagnoses and repairs QE installation health across qe-framework, MCP client config, and the project .qe directory. Use for 'doctor', 'check QE health', dependency verification, corrupted .qe state, or repair guidance. Distinct from Qupdate, which updates installed assets."
invocation_trigger: When QE dependencies or project state need health checks, repair recommendations, or safe automatic fixes.
recommendedModel: haiku
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

# Qdoctor - QE Health Check And Repair

## Role
Diagnose QE runtime health and define safe repair actions for:

1. QE Framework installation and version alignment.
2. MCP client configuration health.
3. The current project's `.qe/` state, planning, profile, and config structure.

Qdoctor is a diagnostic and repair workflow. It may run safe idempotent fixes, but it must
not upgrade packages, release versions, or rewrite project source code. Use `Qupdate` for
updates and `Qmcp sync` for MCP client config sync.

## Execution Procedure

### Step 0: Scope And Safety
Detect the current directory:

```bash
pwd
git rev-parse --show-toplevel 2>/dev/null || true
```

Rules:
- Work from the current project root when possible.
- Never delete `.qe/` data automatically.
- Do not run `git commit`, version bumps, or package releases.
- Record destructive or uncertain repairs as recommendations, not actions.

### Step 1: Dependency Health
Check QE Framework and local MCP config health.

Framework:
```bash
command -v qe-framework-install || true
node -e "try{console.log(require('@inho-team/qe-framework/package.json').version)}catch(e){process.exit(1)}" 2>/dev/null || true
```

MCP client config:
```bash
test -f ~/.claude.json && node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude.json','utf8')); console.log('claude config: json ok')" || true
test -f ~/.codex/config.toml && sed -n '/^\\[mcp_servers\\./,/^\\[/p' ~/.codex/config.toml || true
test -f ~/.gemini/settings.json && node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.gemini/settings.json','utf8')); console.log('gemini config: json ok')" || true
```

If local checkouts exist, prefer their native checks:

```bash
npm run qe:validate   # qe-framework checkout only
node scripts/check-all.mjs
npm run selftest
```

#### Enforced-but-silent device guard (`scripts/check-enforced-devices.mjs`)

`check-all.mjs` auto-discovers a **warning-only** guard that flags savings devices
which are declared "Enforced" but whose activity counters are still zero. It is a
soft health signal, never a build gate (always exits 0).

- **Source of truth**: the device→counter mapping is a **code constant** inside
  `scripts/check-enforced-devices.mjs` (the `DEVICES` array). It does NOT parse
  `QE_CONVENTIONS.md` prose or count declarations.
- **Reads only** `{cwd}/.qe/state/unified-state.json`. Missing / corrupt /
  unparseable state, non-numeric `session_stats.tool_calls`, or a fresh session
  (`tool_calls < 50`) → NOTICE or grace-skip. A warning fires only when
  `tool_calls ≥ 50` (inclusive) and a device's counters are still zero.

| Device | Counters checked | Warns when |
|--------|------------------|------------|
| ContextMemo (Minimal I/O) | `memo.files`, `memo.blocked_reads`, `session_stats.blocked_reads` | all zero at `tool_calls ≥ 50` |
| Delegation Enforcer | `delegationStats.autoInjections + warnings + overrides` | absent or sum zero at `tool_calls ≥ 50` |

A warning here means: re-check hook wiring (PostToolUse matcher includes `Read`;
the delegation gate fires on the `Task` tool and reads `subagent_type`).

#### SIVS loop budget (Phase 3 / R005-R006)

Qdoctor surfaces the per-UUID SIVS loop-safety counters so a loop budget is
visible **before** it is exhausted. It reads `sivs_loops` from
`{cwd}/.qe/state/unified-state.json` (via `hooks/scripts/lib/loop-guard.mjs`
`checkLimits`) and reports, per active UUID:

- **reentry**: backward-routing hops used / limit (default 5, `QE_SIVS_DEPTH_LIMIT`).
- **remediation**: remediation rounds used / limit (3).

A UUID at or near a limit is flagged as a NOTICE (budget nearly exhausted); an
entry reported `corrupt` (present but malformed counters) is flagged for repair —
its next remediation is fail-closed until reset. Absent/fresh state is normal and
silent. This is read-only visibility; the actual enforcement lives in the
PreToolUse hook (remediation) and the gate protocols (depth). The Verify handoff
likewise shows the remaining loop budget so exhaustion is never a surprise.

### Step 2: Version And Boundary Checks
Verify:
- `qe-framework` version is readable from the installed package or checkout.
- Framework package does not depend on bundled `skills-optional` or framework-side MCP scripts.
- `Qmcp ensure` and `Qmcp sync` describe generic MCP configuration workflows.
- Existing client MCP config does not contain stale server entries whose commands no longer exist.

Recommended install repairs:

```bash
npm install -g @inho-team/qe-framework
```

Use this only when the user explicitly wants package installation. For MCP config
health, prefer `{adapter.commandPrefix}Qmcp ensure`.

### Step 2.5: Stale MCP Registration Check
Detect stale entries left by prior installs:

```bash
test -f ~/.claude.json && node -e "const fs=require('fs');const p=process.env.HOME+'/.claude.json';try{const s=JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8'))); if (s.includes('qeExpertLibrary')) console.log(p + ': stale qeExpertLibrary entry present')}catch(e){console.log(p + ': unreadable or malformed — inspect manually')}" || true
test -f ~/.codex/config.toml && grep -n 'qeExpertLibrary' ~/.codex/config.toml || true
```

If found, report `WARN` and instruct the user to remove only that stale server
entry:

- In `~/.claude.json`, remove the `qeExpertLibrary` object from the MCP servers
  section and leave unrelated servers intact.
- In `~/.codex/config.toml`, remove the `[mcp_servers.qeExpertLibrary]` block.
- Restart the affected client after editing.

Do not remove those entries automatically unless the user explicitly asks for
that exact edit.

### Step 3: Project `.qe/` Consistency
Check expected project state:

```bash
test -d .qe && find .qe -maxdepth 2 -type d | sort
test -f .qe/config.json && node -e "JSON.parse(require('fs').readFileSync('.qe/config.json','utf8'))"
test -f .qe/project-memory.json && node -e "JSON.parse(require('fs').readFileSync('.qe/project-memory.json','utf8'))"
```

Expected directories:
- `.qe/analysis`
- `.qe/checklists`
- `.qe/tasks`
- `.qe/planning`
- `.qe/state`
- `.qe/profile`
- `.qe/agent-results`

Safe repairs:
- Create missing directories with `mkdir -p`.
- Create missing empty JSON files only when the expected schema is known.
- Re-run `Qinit` when the project lacks the base `.qe/` structure.
- Run `Qrefresh` after structure repair to rebuild analysis snapshots.

### Step 4: Stale Or Conflicting State
Look for common state problems:

```bash
find .qe/state -maxdepth 1 -type f -name '*bypass*.json' -o -name '*lock*.json' 2>/dev/null
find .qe/tasks .qe/checklists -maxdepth 2 -type f 2>/dev/null | sort
```

Rules:
- Expired `skill-bypass.json` may be removed only if older than 2 minutes and no gated action is running.
- Active plans must not be archived automatically.
- Pending task/checklist mismatches should be reported with file names and suggested next skill.

### Step 5: Report
Return a concise report:

```text
Qdoctor: PASS | WARN | FAIL

Facts:
- Framework: ...
- MCP config: ...
- .qe: ...

Fixes applied:
- ...

Recommended next action:
- Qupdate | Qmcp ensure | Qmcp sync | Qinit | Qrefresh | manual package install
```

## Validation
- PASS: dependencies are readable, required checks pass, and `.qe/` has required structure.
- WARN: usable but missing optional MCP config, stale MCP registration, stale state, or non-blocking drift.
- FAIL: framework install is missing, required MCP config is invalid, `.qe/` JSON is invalid, or a required check exits non-zero.

## Test Prompts
| Prompt | Expected |
|--------|----------|
| "Run Qdoctor and fix QE dependency drift" | Diagnose framework/MCP config and apply only safe repairs |
| "Check whether my .qe folder is corrupted" | Validate `.qe/` structure and JSON, recommend repairs |
| "Update QE to latest" | Use Qupdate instead |
| "Sync MCP clients" | Use Qmcp sync instead |

## Will
- Diagnose framework, MCP config, and project `.qe/` health
- Apply safe idempotent repairs to `.qe/` structure
- Recommend the correct follow-up skill for updates or MCP sync

## Will Not
- Release packages or create tags
- Commit changes
- Delete `.qe/` data automatically
- Replace Qupdate or Qmcp sync
