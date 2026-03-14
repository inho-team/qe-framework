---
name: Qfind-skills
description: Searches for skills on skills.sh, analyzes their content, and directly creates SKILL.md files to install them. Instead of npx skills add, reads the source via WebFetch and converts to global/local skills.
---
> Shared principles: see core/PRINCIPLES.md


# Qfind-skills: Skill Search and Installation

Searches the skills.sh ecosystem for skills, analyzes the original SKILL.md, and directly creates them as Claude Code skills.

## Trigger Conditions

- "Find me a skill", "find a skill for X", "Is there a skill for X?"
- "Search skills.sh for me"
- When the user wants a skill for a specific domain (design, testing, deployment, etc.)

## Workflow

### Step 1: Search for Skills

Analyze the user's request and search skills.sh.

```bash
# Method 1: Search skills.sh via WebFetch
WebFetch https://skills.sh/ "Find skill listings related to the search term"

# Method 2: npx skills find (if CLI is available)
npx skills find [query]
```

### Step 2: Analyze the Original Skill

Fetch the original SKILL.md from GitHub for the found skill.

```bash
# Fetch SKILL.md content via GitHub raw URL
curl -s https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md
```

Or via WebFetch:
```
WebFetch https://github.com/<owner>/<repo>/blob/main/skills/<skill-name>/SKILL.md
```

### Step 3: Confirm Installation Location

Ask the user using the AskUserQuestion tool:

- **Global**: `~/.claude/skills/<skill-name>/SKILL.md` — available in all projects
- **Local**: `.claude/skills/<skill-name>/SKILL.md` — available in the current project only

### Step 4: Create SKILL.md

Analyze the original content and convert it into a Claude Code-compatible SKILL.md file.

**Conversion Rules:**
1. Keep name and description from frontmatter (`---`)
2. Add `Q` prefix to the skill name (to distinguish user custom skills)
3. Replace `npx skills add` commands with direct file creation
4. Preserve the original's core instructions and workflow as-is
5. Remove unnecessary CLI installation guidance

```bash
# Global installation
mkdir -p ~/.claude/skills/Q<skill-name>
# Create SKILL.md using the Write tool

# Local installation
mkdir -p .claude/skills/Q<skill-name>
# Create SKILL.md using the Write tool
```

### Step 5: Verify Installation

```bash
# Verify file exists
ls -la ~/.claude/skills/Q<skill-name>/SKILL.md   # global
ls -la .claude/skills/Q<skill-name>/SKILL.md      # local
```

After installation, inform the user of:
- Skill name and purpose
- Installation path
- Available as `/Q<skill-name>` from the next session

## Skill Category Reference

| Category | Search Keywords |
|----------|----------------|
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| Documentation | docs, readme, changelog, api-docs |
| Code Quality | review, lint, refactor, best-practices |
| Design | ui, ux, design-system, accessibility |
| Productivity | workflow, automation, git |

## Search Tips

- Use specific keywords: "react testing" > "testing"
- Try multiple terms: "deploy", "deployment", "ci-cd"
- Key sources: `vercel-labs/skills`, `ComposioHQ/awesome-claude-skills`
- Browse skills.sh: https://skills.sh/

## When No Skill Is Found

1. Inform the user that no results were found
2. Offer to help directly
3. If needed, suggest creating a custom skill (`/Qcommand-creator`)
