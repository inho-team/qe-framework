---
name: Qupdate
description: Updates the QE Framework plugin to the latest version. Use for "update plugin", "upgrade", "update qe".
allowed-tools: Bash(claude plugin:*)
---

# Qupdate — Plugin Self-Update

## Role
Updates the QE Framework plugin to the latest version in a single command.

## Execution Procedure

### Step 1: Update plugin
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

### Step 2: Report result
Show the updated version and inform the user that a restart is required to apply changes.

## Will
- Update the QE Framework plugin to the latest version
- Report the updated version

## Will Not
- Modify any project files
- Run without user invocation
