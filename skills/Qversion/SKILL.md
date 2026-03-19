---
name: Qversion
description: "Shows the current QE Framework version. Use for version, 버전, what version, 현재 버전, qe version."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qversion — Version Info

## Role
Displays the current QE Framework plugin version.

## Execution Procedure

### Step 1: Read version
Read `.claude-plugin/plugin.json` from the QE Framework plugin directory and extract the `version` field.

### Step 2: Display
Print a single line:

```
QE Framework v{version}
```

## Will
- Read and display the current version from plugin.json

## Will Not
- Modify any files
- Execute any commands beyond reading the version
