---
name: Qlesson-learned
description: "Analyzes recent code changes via git history and extracts software engineering lessons. Use when the user asks what can we learn, 회고, 배운 점, 교훈, key takeaway from an engineering perspective, or let's look back at this code."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


# Lesson Learned

Extracts concrete, evidence-based software engineering lessons from actual code changes. This is a mirror, not a lecture — it simply reflects what the user's own code already shows.

## Before You Begin

**First, load the reference materials.**

1. Read `references/se-principles.md` to understand the list of principles
2. If the changes appear to have room for improvement, optionally read `references/anti-patterns.md`
3. Determine the analysis scope (see Phase 1)

**Do not proceed until `se-principles.md` is loaded.**

## Phase 1: Determine Scope

Ask the user or infer from context to identify what to analyze.

| Scope | Git Command | When to Use |
|-------|-------------|-------------|
| Feature branch | `git log main..HEAD --oneline` + `git diff main...HEAD` | When on a non-main branch (default) |
| Last N commits | `git log --oneline -N` + `git diff HEAD~N..HEAD` | When a range is specified or when on main (default N=5) |
| Specific commit | `git show <sha>` | When a specific commit is mentioned |
| Working changes | `git diff` + `git diff --cached` | When the user asks "what about these changes?" before committing |

**Default behavior:**
- On a feature branch: analyze branch commits relative to main
- On main: analyze the last 5 commits
- If the user specifies a different scope: follow that

## Phase 2: Collect Changes

1. Run `git log` for the determined scope to get the commit list and messages
2. Get the full diff for that scope with `git diff`
3. If the diff is large (500+ lines), first check `git diff --stat` for an overview, then selectively read the top 3–5 files with the most changes
4. **Read commit messages carefully** — they contain intent that a raw diff cannot capture
5. Read only changed files. Do not read the entire repository.

## Phase 3: Analysis

Identify the **key pattern** — the single thing in these changes that teaches the most.

Things to look for:
- **Structural decisions** — How is the code organized? Why were those boundaries drawn that way?
- **Trade-offs** — What was gained and what was sacrificed? (readability vs. performance, DRY vs. clarity, speed vs. accuracy)
- **Problems solved** — How does before differ from after? What makes "after" better?
- **Missed opportunities** — How could the code have been improved? (Frame gently as "next time, try...")

Connect findings to the principles in `references/se-principles.md`. Be specific — quote actual code, reference actual filenames and changed lines.

## Phase 4: Present the Lesson

Use the template below:

```markdown
## Lesson: [Principle Name]

**What happened in the code:**
[2–3 sentences describing the specific change, referencing the file and commit]

**The principle at work:**
[1–2 sentences explaining the software engineering principle]

**Why it matters:**
[1–2 sentences on what goes wrong without it, or what works well because of it]

**Application point for next time:**
[One specific, actionable sentence the user can apply to future work]
```

For any additional lessons worth mentioning (up to 2):

```markdown
---

### Also Worth Noting: [Principle Name]

**In the code:** [One sentence]
**Principle:** [One sentence]
**Application point:** [One sentence]
```

## What Not to Do

| Avoid | Why | Do Instead |
|-------|-----|------------|
| Listing all vaguely related principles | Overwhelming and abstract | Pick only the 1–2 most relevant |
| Analyzing files that were not changed | Out of scope | Cover only what appears in the diff |
| Ignoring commit messages | They contain intent | Treat commit messages as primary context |
| Abstract advice disconnected from the code | Not actionable | Always reference a specific file/line |
| Giving only negative feedback | Discouraging | Lead with what went well, then suggest improvements |
| Presenting 3+ lessons | Dilutes insight | One well-grounded lesson beats seven vague ones |

## Conversation Style

- **Reflect together, don't prescribe.** Use the user's own code as the primary evidence.
- **Never say "you should have..."** — instead say "looking at the approach taken here..." or "next time you encounter this situation..."
- **If the code is good, say so.** Not every lesson comes from something wrong. Acknowledging good patterns reinforces them.
- **When changes are trivial** (a one-line config fix, a typo correction), be honest rather than forcing a lesson. "These changes are straightforward — no deep lessons here, just good housekeeping."
- **Be specific.** Generic advice has no value. Every claim must point to a concrete code change.
