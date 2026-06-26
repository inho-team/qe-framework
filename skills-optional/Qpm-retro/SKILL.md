---
name: Qpm-retro
description: Facilitates retrospectives (Start/Stop/Continue, 4Ls, Sailboat), pre-mortem analysis, and release notes generation. Use for 'retrospective', 'retro', 'pre-mortem', 'release notes', 'sprint review', 'postmortem', 'retrospective', 'release notes'. Distinct from Qlesson-learned (git history analysis) — this runs structured team reflection sessions.
invocation_trigger: When product discovery, requirements, or roadmap planning is required.
recommendedModel: sonnet
---

## Scope Boundary
**Distinct from:** Qlesson-learned (git history analysis). This skill facilitates real-time team reflection sessions using structured formats (Start/Stop/Continue, 4Ls, Sailboat) and conducts pre-mortem risk analysis. It does not analyze historical git commits or extract lessons from code changes (see /Qlesson-learned). Retros are forward-looking; lessons-learned extracts insights from what was built.

## Purpose
Run structured retrospectives, conduct pre-mortem risk analysis, and generate release notes. Provides multiple facilitation formats so teams can rotate approaches and avoid retro fatigue.

## Retrospective Facilitation

### Available Formats

| Format | Best For |
|--------|----------|
| Start / Stop / Continue | Teams new to retros or short timebox (30 min) |
| 4Ls (Liked, Learned, Lacked, Longed for) | Reflective teams that want deeper insight |
| Mad / Sad / Glad | Surfacing emotional undercurrents the team avoids |
| Sailboat (Wind, Anchor, Rock, Island) | Visual thinkers and metaphor-driven discussion |

See references/retro-format-templates.md for all format templates and facilitation tips.

## Pre-mortem Analysis

"Imagine it is [deadline]. The project has failed. What went wrong?"

### Workflow

**Step 1: Failure Brainstorm (10 min)**
Each participant silently writes failure scenarios — the more specific, the better.

**Step 2: Risk Categorization (10 min)**
Group failures into categories: Technical, People, Process, External, Scope.

**Step 3: Probability/Impact Assessment (10 min)**

| Risk | Category | Probability (1-5) | Impact (1-5) | Score | Mitigation |
|------|----------|--------------------|---------------|-------|------------|
| | | | | P x I | |

**Step 4: Mitigation Planning (15 min)**
For risks with score >= 9, define concrete mitigation actions.

### Pre-mortem Template

```markdown
## Pre-mortem: [Project Name]
**Date:** [date] | **Target deadline:** [date]

### Project Context
- Goal: [one-line summary]
- Team: [names/roles]
- Timeline: [start] to [deadline]

### Failure Scenarios
1. [specific failure scenario]
2. [specific failure scenario]
3. ...

### Risk Matrix
| # | Risk | Category | P (1-5) | I (1-5) | Score | Mitigation |
|---|------|----------|---------|---------|-------|------------|
| 1 | | | | | | |
| 2 | | | | | | |

### Top Risks & Mitigations (Score >= 9)
| Risk | Mitigation | Owner | Checkpoint |
|------|------------|-------|------------|
| | | | |

### Assumptions to Validate
- [ ] [assumption that, if wrong, changes the plan]
```

## Release Notes Generation

### External Release Notes (user-facing)

```markdown
# [Product Name] v[X.Y.Z] Release Notes
**Release date:** [date]

## New Features
- **[Feature name]** — [one-line user benefit]. [Optional: brief how-to]

## Improvements
- **[Area]** — [what changed and why it matters to users]

## Bug Fixes
- Fixed [symptom users experienced] ([issue ref])

## Breaking Changes
- **[What changed]** — [what users need to do]. See [migration guide link].

## Deprecations
- [Feature] will be removed in v[X+1]. Use [alternative] instead.
```

### Internal Release Notes (team-facing)

```markdown
# [Product Name] v[X.Y.Z] — Internal Release Summary
**Release date:** [date] | **Release manager:** [name]

## Changes Included
| Type | Description | PR | Author |
|------|-------------|----|--------|
| feat | | | |
| fix | | | |
| refactor | | | |

## Deployment Notes
- [ ] Database migrations: [yes/no, details]
- [ ] Config changes: [env vars, feature flags]
- [ ] Rollback plan: [steps]

## Known Issues
- [issue description] — [workaround if any]

## Metrics to Watch
- [metric to monitor post-deploy]
```

## WWAS (Post-Project Review)

**W**hat went as planned, **W**hat didn't, **A**ctions, **S**houtouts.

Best for: end-of-project or end-of-quarter wrap-ups (longer than a sprint retro).

```markdown
## Post-Project Review: [Project Name]
**Date:** [date] | **Duration:** [project duration]

### What Went As-planned
- [thing that worked according to plan and why]

### What Didn't Go As-planned
- [thing that diverged from plan]
  - **Root cause:** [why]
  - **Impact:** [what it cost in time/scope/quality]

### Actions for Next Time
| Action | Category | Priority |
|--------|----------|----------|
| | Process / Technical / People | High / Med / Low |

### Shoutouts
- [person] — [specific contribution worth recognizing]

### Key Metrics
| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Timeline | | | |
| Scope | | | |
| Quality (bugs found post-launch) | | | |
```

## Anti-Patterns

- **No action items** — Retros without actions are venting sessions. Always leave with 1-3 owned actions.
- **Same format every time** — Format fatigue kills engagement. Rotate formats.
- **Blame-focused discussion** — Focus on systems and processes, not individuals.
- **Skipping retro when things went well** — Good sprints have lessons too. "Continue" items matter.
- **Action items with no owner** — Unowned actions never happen. Every action needs a name and date.
- **Never reviewing past actions** — Start each retro by checking last retro's action items.

## Usage Examples
```
User: Run a retrospective for our last sprint
User: Run a retrospective for this sprint
User: Do a pre-mortem for this project
User: Write release notes for this version
User: Help me write release notes from these PRs
User: Help me with a post-mortem for this project
```

Credits: Frameworks adapted from phuryn/pm-skills (MIT)
