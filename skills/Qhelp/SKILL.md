---
name: Qhelp
description: Shows QE Framework usage overview. With no arg, prints the full catalog. With a skill name arg (e.g., /Qhelp Qcommit), reads that skill's SKILL.md and summarizes it in the user's language. Also supports find/search skills mode via reference/find-skills.md.
invocation_trigger: User asks for help, uses /Qhelp, or invokes any QE skill with --help / -h flag.
recommendedModel: haiku
---

# Qhelp — QE Framework Reference & Per-Skill Help

## Role
Three modes:
1. **No argument**: print the full QE Framework reference card (all skills).
2. **With skill argument**: read that skill's SKILL.md and generate a per-skill usage summary in the user's language.
3. **Find/search skills**: when the user asks to find, search, browse, or install skills from skills.sh, follow `reference/find-skills.md`.

## Workflow

### Mode A: No argument
Print the full reference card below directly to the user.

### Mode B: Skill argument (`/Qhelp {skillName}`)
1. Read `.qe/profile/language.md` to detect user language. Parse `Primary language: <code>`. Default to `en`.
2. Resolve target: `skills/{skillName}/SKILL.md`.
3. If not found: glob `skills/*/SKILL.md`, compute 3 closest matches by name similarity, output not-found message + suggestions in user's language. Stop.
4. Read the target SKILL.md. Extract:
   - frontmatter `description` → Section 1
   - frontmatter `invocation_trigger` (or fall back to description) → Section 2
   - `## Role` section + first workflow/behavior block → Section 3 (3–5 bullets)
   - code blocks containing `/{skillName}` → Section 4 (or default `/{skillName}` if none)
5. Output 4 sections with headings in the user's language:
   - ko: "한 줄 요약" / "언제 쓰나" / "주요 동작" / "사용 예시"
   - en: "Summary" / "When to use" / "What it does" / "Usage"
   - ja: "概要" / "使用タイミング" / "主な動作" / "使用例"
   - other: English
6. Keep total output ≤400 words.

### Mode C: Find/search skills
When the request is about finding a skill, searching skills.sh, browsing available skills, or installing a discovered skill, read and follow `reference/find-skills.md`.
This mode searches skills.sh, fetches original SKILL.md content, converts it to a QE-compatible `SKILL.md`, confirms the install location through the QE interaction adapter, writes the file, and verifies installation.

## Reference Card (Mode A output)

```
QE Framework (Query Executor) — Quick Reference
================================================

WORKFLOW
  /Qgenerate-spec          Create task spec documents
  /Qexecute [UUID]        Execute tasks with verification ($Qexecute on Codex)
  /Qcommit                 Commit & push (human-style, no AI traces)
  /Qupdate                 Update QE (Claude + Codex) and codex-plugin-cc bridge
  /Qexecute -utopia [on|off]        Toggle fully autonomous mode ($Qexecute -utopia on Codex)

DEVELOPMENT
  /Qexecute -verify          Quality loop: test → review → fix ($Qexecute -verify on Codex)
  /Qmcp setup              MCP server setup + building guide
  /Qmcp ensure             Install/verify QE MCP companion preflight

TASK MANAGEMENT
  /Qinit                   Initialize QE in a project
  /Qrefresh                Refresh project analysis
  /Qresume                 Restore previous session context
  /Qcompact                Save context / session handoff ($Qcompact on Codex)
  /Quser-action            Track external actions the user must perform
  /Qgc archive             Archive completed tasks

PLANNING
  /Qplan                   Plan a milestone/project
  /Qgs                     Generate executable task specs
  /Qqa-test-planner        QA test plans & bug reports

META
  /Qversion                Show current version
  /Qhelp find              Search skills.sh marketplace
  /Qalias                  Path & command aliases
  /Qhelp                   This help screen

ADMIN
  qe-admin-mcp             Maintainer-only workflows
                           (qe_admin_search_skills / qe_admin_read_skill)

AGENTS (auto-selected by complexity)
  HIGH   Edeep-researcher, Eqa-orchestrator
  MEDIUM Etask-executor, Ecode-debugger, Ecode-reviewer,
         Ecode-test-engineer, Edoc-writer,
         Egrad-writer, Epm-planner, Erefresh-executor,
         Ecompact-executor, Ehandoff-executor
  LOW    Earchive-executor, Ecommit-executor
```

## Will
- Display the quick reference card (Mode A)
- Read a specific skill's SKILL.md and generate a 4-section summary in the user's language (Mode B)
- Search skills.sh and install discovered QE-compatible skills by following `reference/find-skills.md` (Mode C)
- Provide skill-name suggestions when a requested skill is not found

## Will Not
- Execute any commands from the target skill
- Modify files in Modes A or B
- Translate the reference card itself (Mode A stays in its native mixed form)

## Skill Budget Status

When displaying help, include a budget summary line at the top:

```
Skills: {count} loaded | Budget: ~{tokens} tokens ({pct}% of 1M context)
```

This information is calculated by `hooks/scripts/lib/skill-budget.mjs`:
- `calculateSkillBudget(skillsDir)` — counts SKILL.md files and estimates token usage
- `checkBudgetOverflow(totalTokens)` — checks if budget exceeds 1% of context window
- `getCompressibleSkills(skillsDir)` — lists skills with longest descriptions for compression

If budget overflows (>1% of context), display a warning:
```
⚠ Budget overflow — consider running skill deduplication audit
```
