---
name: Qupdate
description: 'Updates everything QE: the QE Framework body, the qe-mcp companion package, and the codex-plugin-cc bridge using the correct path for the current install. Use for "update plugin", "upgrade", "update qe", "update codex", "update qe mcp", or "codex plugin".'
allowed-tools: "Bash(claude plugin:*), Bash(npm:*), Bash(node:*), Bash(git fetch:*), Bash(git show:*), Bash(git pull:*)"
invocation_trigger: When the framework, its Codex assets, or the codex-plugin-cc bridge need updating.
recommendedModel: haiku
---

# Qupdate - One-Command Update (Framework + MCP + Codex bridge)

## Role
Single entry point that brings every QE update target to latest:

| # | Target | What it covers |
|---|--------|----------------|
| A | QE Framework body → Claude (`~/.claude`) | skills, agents, hooks, scripts |
| B | QE Framework body → Codex (`~/.codex`) | QE Codex asset/hook fences via `install.js` |
| C | QE MCP companion (`@inho-team/qe-mcp`) | expert-library MCP server, registry, sync tooling |
| D | codex-plugin-cc bridge plugin | Codex engine routing bridge (separate plugin) |

A+B come from the framework installer. C is the standalone MCP companion package.
D is the Codex bridge plugin managed through `claude plugin`. This skill runs A/B first,
then C, then D.

## Execution Procedure

### Step 0: Pre-flight — is the latest release reachable on `origin`?
The tarball path runs `git pull`, which only helps if the newest release was pushed to
`origin`. The `qe-admin-mcp` release workflow makes the push step **optional**, so a freshly cut release can live
only in the local checkout (commit + tag present, `origin` behind).

```bash
git fetch origin --tags --quiet
LOCAL=$(node -p "require('./package.json').version" 2>/dev/null)
REMOTE=$(git show origin/main:package.json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0)).version" 2>/dev/null)
echo "local=$LOCAL  origin=$REMOTE"
```

- `local` **ahead of** `origin` (unpushed release) → `git pull` brings nothing. Skip the
  tarball path and use the repository-local install (path 3) to sync already-released local
  assets. Remind the user that `git push origin main --tags` is still needed to publish.
- `origin` ahead or equal → tarball/native paths are safe.

### Step 1: Update the QE Framework body (targets A + B)
Choose exactly one path:

1. **Native plugin update** — preferred when QE is installed as a Claude marketplace plugin
   and the latest release is reachable on `origin` (Step 0). Updates the plugin cache (A).

   ```bash
   claude plugin update qe-framework
   ```

   Note: native update refreshes the plugin cache only. It does **not** mirror the
   absolute-path `~/.claude/scripts` copy or sync Codex assets (B). When the user relies on
   Codex or on `$HOME/.claude/scripts/` references, also run `node install.js` from a QE
   checkout, or use path 2/3 below instead.

2. **Checked-out release tarball install** — covers A + B in one shot when the release is on
   `origin`. The tarball filename is derived from `package.json` — never hardcode a version.

   ```bash
   git pull
   VER=$(node -p "require('./package.json').version")
   npm pack --cache /tmp/qe-npm-cache
   npm install -g "./inho-team-qe-framework-${VER}.tgz"
   qe-framework-install
   ```

3. **Repository-local direct install** — covers A + B without rebuilding the global tarball.
   The correct fallback when Step 0 shows an unpushed local release, or when the user is
   already inside a QE checkout and only needs asset sync.

   ```bash
   node install.js
   ```

**Selection rule:**
- Local checkout **ahead of** `origin` (unpushed release) → path 3 (`node install.js`).
- Already inside a QE checkout, asset sync only → path 3.
- Plugin-mode install, no Codex/abs-script dependency → path 1 (native).
- Otherwise → path 2 (tarball, covers A + B).
- Do not recommend `npm update -g @inho-team/qe-framework` unless the package is published to npm.

### Step 2: Ensure/update the QE MCP companion (target C)
Invoke `{adapter.commandPrefix}Qmcp-ensure` to centralize the MCP companion preflight.
That skill owns detection, missing-package install, registry initialization, and health
verification for `@inho-team/qe-mcp`.

After `Qmcp-ensure` returns `PASS`, update the companion to latest as part of this update
workflow:

```bash
npm install -g @inho-team/qe-mcp@latest
qe-mcp doctor
qe-mcp sync --dry-run
```

Selection rule:
- If the user is inside a `qe-mcp` checkout and asks for local asset sync only, run its
  documented local checks instead of global install.
- If `Qmcp-ensure` returns `WARN`, continue only with MCP-dependent features marked
  degraded.
- If `Qmcp-ensure` returns `FAIL`, do not claim MCP tools are usable.
- Do not copy the expert corpus into `qe-framework`.

### Step 3: Update the codex-plugin-cc bridge (target D)
The Codex bridge is a **separate** plugin (`codex@openai-codex`), not part of the QE body.

1. Read current status with `getCodexPluginInfo()` from `scripts/lib/codex_bridge.mjs` (reads
   `~/.claude/plugins/installed_plugins.json`). Display:

   ```
   Codex bridge (codex-plugin-cc)
     Installed: {yes / no}
     Version:   {version or n/a}
     Path:      {installPath or n/a}
     Commit:    {sha or n/a}
   ```

2. Check latest available via `claude plugin marketplace search codex` or the marketplace
   cache at `~/.claude/plugins/marketplaces/`. Compare installed vs latest.

3. Use `AskUserQuestion` to confirm before changing anything:
   - **Not installed** → Option: Install (`claude plugin install codex@openai-codex`) /
     Skip ("Codex is optional. All SIVS stages will use Claude.").
   - **Update available** → Option: Update (`claude plugin install codex@openai-codex`
     reinstalls to latest) / Skip ("Staying on v{current}.").
   - **Up to date** → "No action needed."

### Step 4: Verify
- If the Codex bridge changed, re-read `installed_plugins.json` to confirm the new version.
- If `qe-mcp` changed, run `qe-mcp doctor` or `qe-mcp sync --dry-run`.
- Optionally validate SIVS config from the plugin root (the `qe:validate` npm script lives
  only in the framework repo, not the target project):

  ```bash
  node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const fs=await import('fs');const home=process.env.HOME||process.env.USERPROFILE||'';const _cr=join(home,'.claude','plugins','cache','inho-team-qe-framework','qe-framework');const _cand=[process.env.CLAUDE_PLUGIN_ROOT,join(home,'.claude','plugins','marketplaces','inho-team-qe-framework')];if(fs.existsSync(_cr))for(const v of fs.readdirSync(_cr).sort().reverse())_cand.push(join(_cr,v));_cand.push(join(home,'.claude'));const base=_cand.find(b=>b&&fs.existsSync(join(b,'hooks','scripts','lib','session-resolver.mjs')))||join(home,'.claude');await import(pathToFileURL(join(base,'scripts','validate_svs_config.mjs')).href)})()"
  ```

### Step 5: Report result
Report per target:
- A — Claude framework assets: updated / unchanged (which path)
- B — Codex framework assets: updated / unchanged
- C — QE MCP companion: installed / updated / up-to-date / skipped
- D — codex-plugin-cc bridge: installed / updated / up-to-date / skipped
- whether Claude/Codex should be restarted

## Will
- Update the QE Framework body for both Claude and Codex via the correct installer path
- Update the external `@inho-team/qe-mcp` companion package in the same run
- Check, install, or update the codex-plugin-cc bridge on user confirmation
- Report per-target results and the next restart step

## Will Not
- Modify any project files
- Modify SIVS engine configuration (use `/Qinit` for that)
- Force-install the Codex bridge without user confirmation
- Restore the MCP expert corpus into the framework package
- Run without user invocation
