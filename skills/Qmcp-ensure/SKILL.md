---
name: Qmcp-ensure
description: "Ensures the external QE MCP companion (@inho-team/qe-mcp) is installed, registered, and usable before QE skills rely on MCP expert lookup or runner tools."
allowed-tools: "Bash(command:*), Bash(npm:*), Bash(qe-mcp:*)"
invocation_trigger: When a QE skill needs the external qe-mcp companion, expert-library MCP tools, MCP registry sync, or cross-agent runner tools.
recommendedModel: haiku
---

# Qmcp-ensure - QE MCP Companion Preflight

## Role
Ensure the external `@inho-team/qe-mcp` companion is available before a QE skill
depends on MCP expert lookup, registry sync, or cross-agent runner tools.

This skill is intentionally small and idempotent. It centralizes the install and
registry preflight so other QE skills do not duplicate npm/MCP setup logic.

## When To Run

Run this preflight before QE workflows that need the MCP companion, especially:

- `Qupdate`
- `Qplan`
- `Qgs` / `Qgenerate-spec`
- `Qmcp-sync`
- any Q skill that intends to use `qe_search_experts`, `qe_read_expert`,
  `qe_run_codex_agent`, `qe_run_claude_agent`, or `qe_cross_agent_help`

Skip only when the current task is explicitly offline/no-install, or when the
skill only needs local files and will not use the MCP companion.

## Execution Procedure

### Step 1: Detect Installed Companion

```bash
command -v qe-mcp || true
npm list -g @inho-team/qe-mcp --depth=0 2>/dev/null || true
```

If `qe-mcp` is on `PATH`, continue to Step 3.

### Step 2: Install Missing Companion

Check package metadata first:

```bash
npm view @inho-team/qe-mcp version 2>/dev/null
```

If metadata is reachable and `qe-mcp` is missing, install:

```bash
npm install -g @inho-team/qe-mcp@latest
```

Rules:
- Do not install from GitHub or a local checkout unless the user explicitly asked for a
  development install.
- If npm metadata is unreachable, stop this preflight with `WARN` and tell the caller
  that MCP-backed expert lookup is unavailable until npm access recovers.
- If global npm installation fails because of permissions, report the exact failing
  command and suggest fixing npm prefix/permissions. Do not retry with `sudo`.

### Step 3: Initialize The QE MCP Registry

Run the idempotent registry initializer:

```bash
qe-mcp init-registry
```

This should create or update the QE-managed registry entry for `qeExpertLibrary`.

### Step 4: Sync Client MCP Configs And Verify Health

Run the idempotent client sync, then lightweight verification:

```bash
qe-mcp sync
qe-mcp doctor
qe-mcp sync --dry-run
```

If `qe-mcp sync` fails because a client is not installed, report `WARN` for that client
but continue when the current client was synced successfully. If `qe-mcp doctor` fails,
report `FAIL` and stop the caller from claiming MCP-backed features are available.

### Step 5: Report A Compact Result

Return one of:

```text
Qmcp-ensure: PASS
- Package: @inho-team/qe-mcp@{version}
- Registry: qeExpertLibrary initialized
- Client sync: OK | WARN ({reason})
- Sync preview: OK | WARN ({reason})
```

```text
Qmcp-ensure: WARN
- Package: missing or stale
- Reason: {npm metadata unavailable | sync preview unavailable | permission issue}
- Caller may continue only without MCP-backed expert lookup/runner tools.
```

```text
Qmcp-ensure: FAIL
- Reason: qe-mcp installed but doctor failed
- Caller must not claim MCP tools are usable.
```

## Consumer Skill Contract

Skills that call this preflight must:

1. Run it before the first MCP-dependent action.
2. Treat `PASS` as permission to use MCP-backed QE tools.
3. Treat `WARN` as a degraded path: continue only if MCP is optional.
4. Treat `FAIL` as a blocker for MCP-dependent claims.
5. Avoid duplicating install commands; update this skill when package name,
   registry behavior, or verification commands change.

## Will
- Install `@inho-team/qe-mcp` when missing and npm metadata is reachable
- Initialize the QE MCP registry idempotently
- Verify the companion with `qe-mcp doctor`
- Sync QE MCP registration into supported client configs

## Will Not
- Install unrelated MCP servers
- Use `sudo`
- Modify project source files
- Commit, tag, publish, or release packages
- Claim Claude, Codex, and Gemini expose identical MCP behavior
