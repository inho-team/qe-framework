---
name: Mtest-skill
description: "Automated skill/agent routing tester. Generates virtual user prompts, simulates intent classification, and verifies correct routing. Use when auditing skill descriptions, validating routing accuracy, or after adding/modifying skills. Distinct from Mcreate-skill (which creates/modifies skills) — this skill tests and benchmarks them."
metadata:
  version: "1.0.0"
  domain: quality
  triggers: test skills, skill test, routing test, verify skills, audit routing, skill tester, skill routing audit
  role: specialist
  scope: analysis
  output-format: report
  related-skills: Mcreate-skill, Qfind-skills
keywords: skill test, intent routing, trigger verification, self-improvement, quality assurance
---

# Skill Tester — Automated Routing Verification

Verifies that all skill/agent triggers route correctly, identifies misroutes, and suggests fixes.

## Workflow

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
| **B. Boundary** | Distinguish similar skills | "Find root cause of bug" -> Qsystematic-debugging (not Ecode-debugger) |
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

## Execution Modes

| Mode | Command | Scope |
|------|---------|-------|
| Quick (default) | `/Mtest-skill` | Registered skills only, 2 prompts each |
| Full | `/Mtest-skill --full` | All skills/agents, 5 prompts each, full report + fixes |
| Specific | `/Mtest-skill Qfact-checker Qsource-verifier` | Named skills only |

## Constraints

**MUST DO:** Cross-verify intent-routes.json vs actual skill list; test boundary cases between similar skills; confirm no regressions before fixes; get user confirmation before applying.

**MUST NOT DO:** Modify descriptions without testing; change intent-routes.json without confirmation; change coding-experts descriptions (different trigger mechanism); use real user data.
