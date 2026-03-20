---
name: Qpm-retro
description: "Facilitates retrospectives (Start/Stop/Continue, 4Ls, Sailboat), pre-mortem analysis, and release notes generation. Use for 'retrospective', 'retro', 'pre-mortem', 'release notes', 'sprint review', 'postmortem', '회고', '릴리즈 노트'. Distinct from Qlesson-learned (git history analysis) — this runs structured team reflection sessions."
---


## Purpose
Run structured retrospectives, conduct pre-mortem risk analysis, and generate release notes. Provides multiple facilitation formats so teams can rotate approaches and avoid retro fatigue.

## Retrospective Facilitation

### Format 1: Start / Stop / Continue

Best for: teams new to retros or short timebox (30 min).

```markdown
## Sprint [N] Retrospective — Start/Stop/Continue
**Date:** [date] | **Facilitator:** [name]

### Start (things we should begin doing)
-

### Stop (things that hurt us)
-

### Continue (things that are working)
-

### Action Items
| Action | Owner | Due |
|--------|-------|-----|
| | | |
```

### Format 2: 4Ls (Liked, Learned, Lacked, Longed for)

Best for: reflective teams that want deeper insight.

```markdown
## Sprint [N] Retrospective — 4Ls
**Date:** [date] | **Facilitator:** [name]

### Liked (what went well)
-

### Learned (new insights or skills)
-

### Lacked (what was missing)
-

### Longed for (what we wished we had)
-

### Action Items
| Action | Owner | Due |
|--------|-------|-----|
| | | |
```

### Format 3: Mad / Sad / Glad

Best for: surfacing emotional undercurrents the team avoids.

```markdown
## Sprint [N] Retrospective — Mad/Sad/Glad
**Date:** [date] | **Facilitator:** [name]

### Mad (frustrated about)
-

### Sad (disappointed by)
-

### Glad (grateful for)
-

### Action Items
| Action | Owner | Due |
|--------|-------|-----|
| | | |
```

### Format 4: Sailboat (Wind, Anchor, Rock, Island)

Best for: visual thinkers and teams that want a metaphor-driven discussion.

```markdown
## Sprint [N] Retrospective — Sailboat
**Date:** [date] | **Facilitator:** [name]

### Wind (what propelled us forward)
-

### Anchor (what slowed us down)
-

### Rock (risks or obstacles ahead)
-

### Island (our goal / destination)
-

### Action Items
| Action | Owner | Due |
|--------|-------|-----|
| | | |
```

### Facilitation Tips
- Rotate formats every 2-3 sprints to prevent staleness
- Silent brainstorm first (5 min), then group discussion
- Limit to 3 action items — more than that rarely get done
- Each action item needs an owner and a due date
- Review previous retro actions at the start of the next retro

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
User: 스프린트 회고 진행해줘
User: Do a pre-mortem for this project
User: 릴리즈 노트 작성해줘
User: Help me write release notes from these PRs
User: 프로젝트 포스트모템 도와줘
```

Credits: Frameworks adapted from phuryn/pm-skills (MIT)
