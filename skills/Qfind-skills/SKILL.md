---
name: Qfind-skills
description: Finds and installs skills from skills.sh. Use when you want to find a skill, install a skill, browse available skills, or search skills.sh. Fetches skill content and creates SKILL.md files directly.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---


# Qfind-skills: Skill Search and Installation

Searches the skills.sh ecosystem for skills, analyzes the original SKILL.md, and directly creates them as QE skills for the active client.

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

**MUST use the QE interaction adapter**:
- Claude adapter: `AskUserQuestion`
- Codex interactive adapter: concise plain-text choices with the same labels

- **Claude global**: `~/.claude/skills/<skill-name>/SKILL.md` — available in Claude projects
- **Claude local**: `.claude/skills/<skill-name>/SKILL.md` — available in the current Claude project
- **Codex global**: `~/.codex/skills/<skill-name>/SKILL.md` — available in Codex when the Codex skill loader is active
- **Codex local/project**: use the repository `skills/<skill-name>/SKILL.md` source layout and let the installer sync to Codex assets

### Step 4: Create SKILL.md

Analyze the original content and convert it into a QE-compatible SKILL.md file. Use adapter-specific installation paths only in the installation section.

**Conversion Rules:**
1. Keep name and description from frontmatter (`---`)
2. Add `Q` prefix to the skill name (to distinguish user custom skills)
3. Replace `npx skills add` commands with direct file creation
4. Preserve the original's core instructions and workflow as-is
5. Remove unnecessary CLI installation guidance

```bash
# Claude global installation
mkdir -p ~/.claude/skills/Q<skill-name>
# Create SKILL.md using the Write tool

# Claude local installation
mkdir -p .claude/skills/Q<skill-name>
# Create SKILL.md using the Write tool

# Codex source installation
mkdir -p skills/Q<skill-name>
# Create SKILL.md in repo source, then use the QE installer/sync path for ~/.codex
```

### Step 5: Verify Installation

```bash
# Verify file exists
ls -la ~/.claude/skills/Q<skill-name>/SKILL.md   # Claude global
ls -la .claude/skills/Q<skill-name>/SKILL.md      # Claude local
ls -la skills/Q<skill-name>/SKILL.md              # QE source / Codex-syncable
```

After installation, inform the user of:
- Skill name and purpose
- Installation path
- Available as `{adapter.commandPrefix}Q<skill-name>` from the next session after the active client loads or syncs skills

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
3. If needed, suggest creating a custom skill through the maintenance skill creation workflow.
