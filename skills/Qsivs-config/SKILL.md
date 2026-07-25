---
name: Qsivs-config
user_invocable: false
description: View and modify the single-AI SIVS role configuration. Use when the user wants to set active-client model or reasoning effort for a SIVS stage.
invocation_trigger: When the user wants to view or change SIVS role configuration, model assignment, or effort level.
recommendedModel: haiku
tier: core
---

# Qsivs-config — SIVS Single-AI Role Configuration

## Role

Each session uses one active AI client. Claude and Codex are separate supported
clients, but SIVS never routes a stage between them. This skill configures only
the active client's model and reasoning effort in `.qe/sivs-config.json`.
See `core/SIVS_SINGLE_AI_MODEL.md`.

## Commands

```text
{adapter.commandPrefix}Qsivs-config show
{adapter.commandPrefix}Qsivs-config set <spec|implement|verify|supervise> --model <name>
{adapter.commandPrefix}Qsivs-config set <spec|implement|verify|supervise> --effort <low|medium|high|max|xhigh>
{adapter.commandPrefix}Qsivs-config reset [stage|--all]
```

## Rules

- Initialize new files with `{ "schemaVersion": 2 }`.
- `verify` and `supervise` default to `effort: high`; lowering either requires
  an explicit degraded-QA note in the task report.
- `engine`, `background`, profiles, and bridge fallback are invalid. On finding
  legacy fields, instruct the user to remove them and retain only `model`,
  `effort`, or `compaction`.
- Validate every change with `npm run qe:validate`.
- Do not install, invoke, or configure another AI client.
