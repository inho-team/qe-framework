---
name: Qdoctor
description: "Diagnoses and repairs QE installation health across qe-framework, qe-mcp, and the project .qe directory. Use for 'doctor', 'check QE health', dependency verification, corrupted .qe state, or repair guidance. Distinct from Qupdate, which updates installed assets."
invocation_trigger: When QE dependencies or project state need health checks, repair recommendations, or safe automatic fixes.
recommendedModel: haiku
---

# Qdoctor - QE Health Check And Repair

## Role
Diagnose QE runtime health and define safe repair actions for:

1. QE Framework installation and version alignment.
2. QE MCP companion installation and expert-library availability.
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
Check both QE dependencies.

Framework:
```bash
command -v qe-framework-install || true
node -e "try{console.log(require('@inho-team/qe-framework/package.json').version)}catch(e){process.exit(1)}" 2>/dev/null || true
```

MCP companion:
```bash
command -v qe-mcp || true
qe-mcp doctor 2>/dev/null || true
qe-mcp sync --dry-run 2>/dev/null || true
```

If local checkouts exist, prefer their native checks:

```bash
npm run qe:validate   # qe-framework checkout only
node scripts/check-all.mjs
npm run check         # qe-mcp checkout only
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

### Step 2: Version And Boundary Checks
Verify:
- `qe-framework` version is readable from the installed package or checkout.
- `qe-mcp` is installed or a clear install command is available.
- Framework package does not depend on bundled `skills-optional` or framework-side MCP scripts.
- `Qmcp sync` points to external `@inho-team/qe-mcp`.

Recommended install repairs:

```bash
npm install -g @inho-team/qe-framework
npm install -g @inho-team/qe-mcp
```

Use these only when the user explicitly wants package installation. For the MCP companion,
prefer `{adapter.commandPrefix}Qmcp ensure` so detection, install, registry initialization,
and verification stay centralized.

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
- MCP: ...
- .qe: ...

Fixes applied:
- ...

Recommended next action:
- Qupdate | Qmcp sync | Qinit | Qrefresh | manual package install
```

## Validation
- PASS: dependencies are readable, required checks pass, and `.qe/` has required structure.
- WARN: usable but missing optional MCP sync, stale state, or non-blocking drift.
- FAIL: framework install is missing, MCP server cannot self-test when required, `.qe/` JSON is invalid, or a required check exits non-zero.

## Test Prompts
| Prompt | Expected |
|--------|----------|
| "Run Qdoctor and fix QE dependency drift" | Diagnose framework/MCP and apply only safe repairs |
| "Check whether my .qe folder is corrupted" | Validate `.qe/` structure and JSON, recommend repairs |
| "Update QE to latest" | Use Qupdate instead |
| "Sync MCP clients" | Use Qmcp sync instead |

## Will
- Diagnose framework, MCP, and project `.qe/` health
- Apply safe idempotent repairs to `.qe/` structure
- Recommend the correct follow-up skill for updates or MCP sync

## Will Not
- Release packages or create tags
- Commit changes
- Delete `.qe/` data automatically
- Replace Qupdate or Qmcp sync
