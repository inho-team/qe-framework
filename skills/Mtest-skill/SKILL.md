---
name: Mtest-skill
description: Automated skill/agent routing tester. Generates virtual user prompts, simulates intent classification, and verifies correct routing. Use when auditing skill descriptions, validating routing accuracy, or after adding/modifying skills. Distinct from Mcreate-skill (which creates/modifies skills) — this skill tests and benchmarks them.
metadata: 
version: 1.0.0
domain: quality
triggers: test skills, skill test, routing test, verify skills, audit routing, skill tester, skill routing audit
role: specialist
scope: analysis
output-format: report
related-skills: Mcreate-skill, Qfind-skills
keywords: skill test, intent routing, trigger verification, self-improvement, quality assurance
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

# Skill Tester — Routing + Behavior Verification

Verifies skills across **three dimensions**: (1) **routing** — triggers route correctly
(Steps 1-6 below); (2) **structural** — deterministic eval gate over all skills and eval
cases (`scripts/check-skill-evals.mjs`); (3) **behavioral** — opt-in LLM-judge regression
over `evals/cases/*.eval.md`. Identifies misroutes/regressions and suggests fixes.

The structural + behavioral layers are the **skill eval harness** (see `evals/README.md`,
`D020`). Routing is verified here; it is **not** duplicated in the harness scripts.

## Workflow (routing dimension)

```
1. Collect skills → 2. Generate test cases → 3. Simulate routing → 4. Verdict → 5. Suggest fixes → 6. Re-verify
```

## Step 1: Collect Skills

```bash
find skills/ -name "SKILL.md" | sort    # Skill list
find agents/ -name "*.md" | sort        # Agent list
cat hooks/scripts/lib/intent-routes.json # Route config
```

Extract per skill: `name`, `description`, `triggers`, `keywords`.

## Step 2: Generate Test Cases

Generate **3 types** of virtual prompts per skill:

| Type | Purpose | Example |
|------|---------|---------|
| **A. Normal** | Should trigger this skill | "Create a React component" -> Qreact-expert |
| **B. Boundary** | Distinguish similar skills | "Find root cause of bug" -> Ecode-debugger |
| **C. Unregistered** | No route defined | "Create a jira issue" -> Qjira-cli |

## Step 3: Simulate Routing

Use the same matching algorithm as `prompt-check.mjs`:

```javascript
function simulateRouting(userMessage, routes) {
  const msgLower = userMessage.toLowerCase();
  const msgWords = msgLower.split(/\s+/);
  let bestMatch = null, bestScore = 0;

  for (const [keywords, target] of Object.entries(routes)) {
    const parts = keywords.split('/');
    let matchedParts = 0, totalWeight = 0;
    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);
      const hasExactWord = termWords.some(tw => msgWords.includes(tw));
      const hasSubstring = msgLower.includes(term);
      if (hasExactWord) { matchedParts++; totalWeight += term.length * 2; }
      else if (hasSubstring) { matchedParts++; totalWeight += term.length; }
    }
    const score = matchedParts > 0 ? matchedParts * 3 + totalWeight : 0;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { intent: keywords, routed_to: target, score };
    }
  }
  return bestMatch;
}
```

## Step 4: Verdict

| Verdict | Meaning |
|---------|---------|
| **PASS** | Correctly routed to expected skill |
| **MISROUTE** | Routed to wrong skill |
| **UNREACHABLE** | Not in intent-routes.json |
| **CONFLICT** | Two+ skills tie with same score |
| **WEAK** | Routes but low score — unstable |

Criteria: `score >= threshold*2` = PASS (strong); `score >= threshold` = PASS + WEAK warning; `score < threshold` = UNREACHABLE; `expected != actual` = MISROUTE.

## Step 5: Write Report

```markdown
# Skill Routing Test Report
**Run Date:** [date] | **Total:** N | **PASS:** N | **MISROUTE:** N | **UNREACHABLE:** N | **CONFLICT:** N

## MISROUTE (fix required)
| Prompt | Expected | Actual | Score | Root Cause |

## UNREACHABLE (route needed)
| Skill | Suggested Route Keywords |

## CONFLICT (priority adjustment)
| Prompt | Competing Skills | Score |

## WEAK (unstable)
| Prompt | Skill | Score | Risk |

## Coverage
| Category | Registered | Unregistered | Coverage % |
```

## Step 6: Suggest Fixes

**MISROUTE fix:** Modify skill description to add differentiating keywords, or update intent-routes.json with more specific routes.

**UNREACHABLE fix:** Add missing routes to intent-routes.json.

**Re-verify:** After applying fixes, re-run the same tests to confirm PASS.

## Behavior Eval Layers (D020)

Beyond routing, run the skill eval harness. See `evals/README.md` for the case format.

### Structural layer (deterministic, all skills)

```bash
node scripts/check-skill-evals.mjs   # also auto-run by scripts/check-all.mjs
```

Checks every `evals/cases/*.eval.md` against the schema (required fields, `skill` exists)
and flags dangling repo-path cross-references inside each `SKILL.md` (WARN). Exit non-zero
on any schema FAIL. This layer is **mandatory for all skills** and CI-safe (no model calls).

### Behavioral layer (opt-in, LLM-judged)

1. Build the run manifest (deterministic, no model calls):
   ```bash
   npm run eval:skills        # → node scripts/eval-skills-behavioral.mjs → evals/.manifest.json
   ```
2. For each case in `evals/.manifest.json`, this skill (as the LLM):
   - Executes the case `prompt` against the target `skill`.
   - **Deterministic gate**: response MUST contain every `must_include` string and NONE
     of the `must_not_include` strings. Any violation → `FAIL` immediately.
   - **LLM judgment**: if the substring gate passes, judge the response against `rubric`
     and emit PASS / FAIL with a one-line reason.
3. Write a behavioral report:
   ```markdown
   # Skill Behavior Eval Report
   **Cases:** N | **PASS:** N | **FAIL:** N
   | Skill | Case | Substring Gate | Rubric Verdict | Reason |
   ```

Behavioral evals are opt-in: only skills with an `evals/cases/{Skill}.eval.md` are judged.
Seed cases currently cover the PSE core (Qplan, Qgs, Qatomic-run); extend coverage by
adding more case files.

## Execution Modes

| Mode | Command | Scope |
|------|---------|-------|
| Quick (default) | `/Mtest-skill` | Registered skills only, 2 prompts each |
| Full | `/Mtest-skill --full` | All skills/agents, 5 prompts each, full report + fixes |
| Specific | `/Mtest-skill Qfoo` | Single skill by name |
| Batch | `/Mtest-skill --batch 'skills/Q*'` | All SKILL.md files matching a glob, cache-aware |
| Structural eval | `node scripts/check-skill-evals.mjs` | Deterministic schema + cross-ref gate, all skills |
| Behavioral eval | `npm run eval:skills` then judge manifest | opt-in LLM-judge over `evals/cases/*.eval.md` |

### Batch mode — `--batch <glob>`

`--batch` feeds a filesystem glob (relative to repo root) into `scripts/run_mtest_skill.mjs`.
The runner collects every `SKILL.md` below each matched directory, replays the
workflow above (virtual prompts → routing sim → verdict), and prints a markdown
results table to stdout. Optional `--out <file>` mirrors the table to disk.

```bash
# test every Q-prefixed skill
/Mtest-skill --batch 'skills/Q*'

# test M-prefixed skills and save to report.md
/Mtest-skill --batch 'skills/M*' --out .qe/mtest-cache/last-batch.md
```

Output columns: `Skill | Hash | Verdict | Accuracy | Cache | Timestamp`.
One row per SKILL.md, sorted alphabetically.

### Cache policy

Batch runs are memoised through `hooks/scripts/lib/mtest-cache.mjs`:

- **Key**: sha256 of canonicalised SKILL.md content (CRLF→LF, trim trailing
  whitespace, single trailing newline). Identical content ⇒ identical key.
- **Store**: `.qe/mtest-cache/{hash}.json` (gitignored). One file per distinct
  SKILL.md revision ever tested.
- **Hit** (unchanged SKILL.md): runner reuses `{verdict, accuracy, timestamp}`
  and logs `Cache: HIT` — no virtual-prompt regeneration, no routing sim.
- **Miss** (new content or first run): runner re-executes the workflow, writes
  a fresh entry, and logs `Cache: MISS`.
- **Invalidation**: purely content-driven. Edit the SKILL.md and the previous
  entry is orphaned (the new hash creates a new file). To force a rerun
  without edits, delete the relevant file under `.qe/mtest-cache/`.

The single-skill mode (`/Mtest-skill Qfoo`) bypasses the cache so interactive
audits always re-evaluate. Only `--batch` consults the cache.

## Constraints

**MUST DO:** Cross-verify intent-routes.json vs actual skill list; test boundary cases between similar skills; confirm no regressions before fixes; get user confirmation before applying.

**MUST NOT DO:** Modify descriptions without testing; change intent-routes.json without confirmation; use real user data.
