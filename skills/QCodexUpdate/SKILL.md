---
name: QCodexUpdate
description: Check and update codex-plugin-cc (Codex bridge for SIVS engine routing). Use when checking Codex plugin status, updating Codex plugin, or troubleshooting Codex integration.
invocation_trigger: When checking or updating the Codex plugin, or when Codex integration needs diagnosis.
recommendedModel: haiku
---

# QCodexUpdate — Codex Plugin Version Check & Update

## Role
Checks the installed version of `codex-plugin-cc` and updates it if outdated or missing.

## Workflow

### Step 1: Check Current Status

Read the codex plugin info from `~/.claude/plugins/installed_plugins.json` via `getCodexPluginInfo()` from `scripts/lib/codex_bridge.mjs`.

Display status:
```
Codex Plugin Status
  Installed: {yes / no}
  Version:   {version or n/a}
  Path:      {installPath or n/a}
  Installed: {date or n/a}
  Commit:    {sha or n/a}
```

### Step 2: Check for Updates

If installed, check if a newer version is available:

1. Run `claude plugin marketplace search codex` or check the marketplace cache at `~/.claude/plugins/marketplaces/` for latest available version.
2. Compare installed version with latest available.
3. Report:
   - **Up to date**: "codex-plugin-cc v{version} is the latest."
   - **Update available**: "Update available: v{installed} -> v{latest}"
   - **Not installed**: "codex-plugin-cc is not installed."

### Step 3: Install or Update

Use `AskUserQuestion` to confirm before proceeding.

**If not installed:**
- Option 1: Install — run `/plugin install codex@openai-codex`
- Option 2: Skip — "Codex is optional. All SIVS stages will use Claude."

**If update available:**
- Option 1: Update — run `/plugin install codex@openai-codex` (reinstall updates to latest)
- Option 2: Skip — "Staying on v{current}."

**If already up to date:**
- Show "No action needed." and exit.

### Step 4: Verify

After install/update:
1. Re-read `installed_plugins.json` to confirm new version.
2. Verify SIVS config is valid by running the framework validator from the plugin root (the `qe:validate` npm script lives only in the framework repo, not the target project):
   ```bash
   node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const fs=await import('fs');const home=process.env.HOME||process.env.USERPROFILE||'';const _cr=join(home,'.claude','plugins','cache','inho-team-qe-framework','qe-framework');const _cand=[process.env.CLAUDE_PLUGIN_ROOT,join(home,'.claude','plugins','marketplaces','inho-team-qe-framework')];if(fs.existsSync(_cr))for(const v of fs.readdirSync(_cr).sort().reverse())_cand.push(join(_cr,v));_cand.push(join(home,'.claude'));const base=_cand.find(b=>b&&fs.existsSync(join(b,'hooks','scripts','lib','session-resolver.mjs')))||join(home,'.claude');await import(pathToFileURL(join(base,'scripts','validate_svs_config.mjs')).href)})()"
   ```
3. Report result.

## Will
- Check codex-plugin-cc installation and version
- Install or update codex-plugin-cc on user confirmation
- Verify installation after update

## Will Not
- Modify SIVS engine configuration (use `/Qinit` for that)
- Force install without user confirmation
- Update QE Framework itself (use `/Qupdate` for that)
