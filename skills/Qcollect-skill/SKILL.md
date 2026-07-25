---
name: Qcollect-skill
user_invocable: false
description: Use when collecting verified project-local coding guidance into .claude/skills based on the project tech stack, with TTL and user-edit protection.
invocation_trigger: Use when the user explicitly asks to collect, refresh, or install project-local stack skills.
recommendedModel: sonnet
---

# Qcollect-skill — Local Stack Skill Collection

## Role
Foreground-only command that collects verified, project-specific coding guidance into `.claude/skills/<name>/SKILL.md`.

This skill never schedules background collection, never uses `--permission-mode dontAsk`, and never offers `--force`. User-edited generated skills can only be replaced with the explicit `--overwrite-user-edits` flag, which creates a timestamped `.bak` first.

## Workflow

1. Parse arguments:
   - No argument: read `.qe/analysis/tech-stack.md`, derive stack targets, then collect missing or expired generated local skills.
   - `<name>`: collect or refresh exactly `.claude/skills/<name>/SKILL.md`; this path does not require `tech-stack.md`.
   - `--overwrite-user-edits`: allow replacing a generated skill whose body hash no longer matches, after the writer creates a timestamped `.bak`.
2. For no-argument mode, if `.qe/analysis/tech-stack.md` is missing, stop and tell the user to run `/Qinit` or `/Qrefresh`. If it is stale, warn and continue.
3. Before collecting, check VCS boundary:
   - If the project is not a git repository, skip the `.gitignore` check.
   - If it is a git repository, `.gitignore` must contain `.claude/skills/`; otherwise stop and ask the user to add it.
4. Delegate research to `Edeep-researcher` using the Local Skill Collection prompt in that agent.
5. Require the research result to include:
   - official docs first
   - source URL and `published_at` for every source
   - conflicting claims comparison
   - Devil's Advocate verification result
6. Save through `scripts/lib/skill-collection-writer.mjs`. The writer validates frontmatter, blocks unsafe command content, computes `content_hash`, and writes atomically.

## Local Skill Contract

Collected skills must use this frontmatter shape:

```yaml
source: official docs and dated references summary
collected_at: 2026-07-17T12:00:00Z
ttl_days: 90
expires_at: 2026-10-15T12:00:00Z
generated_by: Qcollect-skill
content_hash: sha256:...
verification:
  devils_advocate_ran: true
  sources:
    - url: https://example.com/docs
      published_at: 2026-07-01
  conflicting_claims: []
```

## Will
- Collect project-local skills only after explicit user invocation
- Use `.qe/analysis/tech-stack.md` for no-argument stack discovery
- Support a single skill name argument without requiring `tech-stack.md`
- Delegate research to `Edeep-researcher`
- Protect manual skills and user edits
- Require `.claude/skills/` in `.gitignore` for git repositories

## Will Not
- Start background workers
- Use `--permission-mode dontAsk`
- Create `.qe/skill-collection/index.json`
- Provide `--force`
- Read `tech-stack.md` from SessionStart hooks
