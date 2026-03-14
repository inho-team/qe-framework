---
name: Qupdate
description: Updates the QE Framework plugin to the latest version. Use for "update plugin", "upgrade", "update qe", "최신 버전".
allowed-tools: Bash(claude plugin:*)
---
> Shared principles: see core/PRINCIPLES.md

# Qupdate — Plugin Self-Update

## Role
Updates the QE Framework plugin to the latest version in a single command.

## Execution Procedure

### Step 1: Remove current plugin
```bash
claude plugin remove qe-framework
```

### Step 2: Install latest version
```bash
claude plugin add github:inho-team/qe-framework
```

### Step 3: Report result
Show the installed version and confirm success.

## Will
- Remove and reinstall the QE Framework plugin
- Report the updated version

## Will Not
- Modify any project files
- Run without user invocation
