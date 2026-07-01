---
name: Qcatalog-diet
description: Researches QE skill/agent catalog bloat and produces a report-only hard-prune plan. Use when deciding which skills, agents, PM helpers, document parsers, or other broad helpers should stay core, be deleted, or be reintroduced later by explicit task.
invocation_trigger: "When auditing or reducing the QE skill/agent catalog, investigating too many skills, pruning PM/document/helper surfaces, or preparing a safe catalog diet before deletion."
recommendedModel: sonnet
tier: core
---

# Qcatalog-diet - Catalog Pruning Research

## Role

You are a catalog reduction researcher. Your job is to combine current internet research with local repository inventory and produce a report-only pruning recommendation for QE skills and agents.

This skill does not delete, move, rename, demote, commit, bump versions, or edit package metadata. It creates evidence and a proposed next action only.

## When to Use

Use this skill when the user wants to:
- Reduce the number of QE skills or agents.
- Remove broad helper families such as PM workflows, document parsing/conversion, academic writing, finance, contract, Jira, media, UI/design helpers, or other non-core helpers.
- Decide what belongs in the core catalog versus deletion with possible later reintroduction through an explicit task.
- Build a safe deletion plan before running a destructive catalog change.

Do not use this skill for normal code cleanup. Use the cleanup/refactor workflow for code-level simplification.

## Safety Contract

- First pass is always report-only.
- Do not delete, move, rename, or demote files.
- Do not edit `package.json`, `.claude-plugin/plugin.json`, README counts, or version fields.
- Do not weaken PSE, SIVS, safety hooks, commit/version guards, or recovery skills.
- Any destructive or published-surface change must become a separate `Qplan -> Qgs -> Qatomic-run -> Qcode-run-task` task with explicit user approval.

## Workflow

### Step 1 - Confirm Scope

Identify the catalog surface being evaluated:
- Repo-shipped skills: `skills/**/SKILL.md`
- Repo agents: `agents/E*.md`
- Installed Codex skills: `~/.codex/skills/**/SKILL.md`
- Plugin-provided skills if discoverable in the current environment

Keep source categories separate. Do not mix installed personal skills with repo-shipped framework assets.

### Step 2 - Internet Research

Research current official/public guidance before scoring. Prefer primary sources.

Required sources:
- Claude Code skills docs: `https://code.claude.com/docs/en/skills`
- Claude Code subagents docs: `https://code.claude.com/docs/en/sub-agents`
- OpenAI Codex skills docs: `https://developers.openai.com/codex/skills`
- CLI Guidelines: `https://clig.dev/`

Record for each source:
- URL
- Access date
- Finding
- How the finding affects pruning
- Evidence level: `★★★ official`, `★★ public guideline`, or `★ contextual`

Key claims to verify or cite:
- Skills should be reusable workflows, not a dumping ground for every domain helper.
- Skill descriptions affect automatic trigger quality and discoverability.
- Codex uses progressive disclosure but still has an initial skill-list budget; large catalogs can shorten or omit entries.
- Discoverable command surfaces should present common commands first and move exhaustive/rare material elsewhere.

### Step 3 - Local Inventory

Run read-only inventory commands. If a command fails, report the failure and continue with the remaining commands.

```bash
find skills -name SKILL.md | wc -l
find agents -maxdepth 1 -name 'E*.md' | wc -l
find "$HOME/.codex/skills" -name SKILL.md 2>/dev/null | wc -l
find skills -name SKILL.md 2>/dev/null | rg '/(Qpm-|Qdocx|Qpdf|Qpptx|Qxlsx|Qyoutube|Qgrad-|Qfinance|Qcontract|Qjira|Qdoc-converter|Qaudio|Qdata-analysis)/'
```

Also check existing QE evidence when present:
- `.qe/docs/audit-skills-agents.md`
- `.qe/planning/plans/qe-diet/`
- `.qe/profile/command-patterns.md`
- `.qe/state/session-stats.json`

Treat old counts as historical evidence only. Always remeasure current counts.

### Step 4 - Define Protected Core

Protect these categories from deletion unless the user explicitly opens a separate architectural plan:
- PSE chain: `Qplan`, `Qgs`/`Qgenerate-spec`, `Qatomic-run`, `Qrun-task`, `Qcode-run-task`
- SIVS and gates: `Qcritical-review`, `Qverify-contract`, `Qsivs-config`
- Safety and lifecycle: `Qcommit`, `Qversion`, `Qarchive`, `Qcompact`, `Qresume`, `Qrefresh`, `Qsweep`, `Qgc`, `Qmistake`; version/release admin workflows live in `qe-admin-mcp`
- Initialization and help: `Qinit`, `Qhelp`, `Qupdate`
- Project memory/context/wiki primitives when the project uses them

Mark protected items as `KEEP` unless strong evidence shows they are dead, duplicated, or unsafe.

### Step 5 - Score Candidates

Score each candidate from 0 to 10. Higher means stronger pruning pressure.

| Factor | Points | Rule |
| --- | ---: | --- |
| Non-core domain helper | 0-2 | Broadly useful but not QE-core, such as PM, coding expert, document conversion, academic, finance, contract, Jira, media |
| Low or absent usage evidence | 0-2 | No recent local/profile/session evidence |
| Duplicated by plugin/bundled tool/base model | 0-2 | Better served by an external plugin, bundled tool, or ordinary model capability |
| Trigger ambiguity/noise | 0-1 | Likely to misfire or crowd out common workflows |
| Large reference surface | 0-1 | High token/discoverability cost for rare use |
| Low published-surface risk | 0-2 | Safe to move behind optional install or deprecate |

Recommended classification:
- `0-2`: `KEEP`
- `3-5`: `NEEDS-REVIEW`
- `6-7`: `DELETE-REVIEW`
- `8-9`: `DEPRECATE`
- `10`: `DELETE-CANDIDATE`

Downgrade any candidate by at least 2 points when it is part of the protected core or has clear recent usage evidence.

## Output Format

Write the report to `.qe/planning/research/catalog-diet-{YYYY-MM-DD}.md` unless the user specifies another path.

Use this structure:

```markdown
# Catalog Diet Report - {date}

## Verdict

Recommended option: {thin-core / hard-prune / deprecate / no action}
Evidence level: {★/★★/★★★}

## Sources

| Source | Evidence | Finding | Impact |
| --- | --- | --- | --- |

## Inventory

| Surface | Count | Command | Notes |
| --- | ---: | --- | --- |

## Protected Core

| Item | Reason | Risk if removed |
| --- | --- | --- |

## Candidates

| Classification | Item/Pattern | Score | Evidence | Risk | Next Action |
| --- | --- | ---: | --- | --- | --- |

## Recommended Next Spec

- Scope:
- Files likely touched:
- Verification:
- Rollback:
```

## Will

- Research official/current sources before recommending catalog changes.
- Re-measure local catalog counts every run.
- Separate repo assets, optional assets, installed personal skills, and plugin skills.
- Produce a reversible, user-approval-ready pruning report.
- Prefer hard pruning broad helpers; reintroduce deleted capabilities only through explicit future tasks.

## Will Not

- Delete, move, rename, demote, commit, or bump versions.
- Treat old audit counts as current facts.
- Recommend removing PSE/SIVS/safety lifecycle skills without a separate architectural plan.
- Hide uncertainty; mark unverified claims explicitly.
