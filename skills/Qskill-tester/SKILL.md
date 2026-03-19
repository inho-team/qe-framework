> Core philosophy: see core/PHILOSOPHY.md
---
name: Qskill-tester
description: "Automated skill/agent routing tester. Generates virtual user prompts, simulates intent classification, and verifies correct routing. Use when auditing skill descriptions, validating routing accuracy, or after adding/modifying skills. Distinct from Qskill-creator (which creates/modifies skills) — this skill tests and benchmarks them."
metadata:
  version: "1.0.0"
  domain: quality
  triggers: test skills, skill test, routing test, verify skills, audit routing, skill tester, skill routing audit
  role: specialist
  scope: analysis
  output-format: report
  related-skills: Qskill-creator, Qfind-skills
keywords: skill test, intent routing, trigger verification, self-improvement, quality assurance
---

# Skill Tester — Automated Routing Verification

Automatically verifies that all skill/agent triggers work correctly, and identifies and fixes misroutes.

## Workflow

```
1. Collect skills → 2. Generate test cases → 3. Simulate routing → 4. Verdict → 5. Suggest fixes → 6. Re-verify
```

## Step 1: Collect Skills

Collect all skills and agents in the project.

```bash
# Skill list
find skills/ -name "SKILL.md" | sort

# Agent list
find agents/ -name "*.md" | sort

# Intent route config
cat hooks/scripts/lib/intent-routes.json
```

Information to extract from each skill:
- `name`: Skill name
- `description`: Description (including trigger conditions)
- `triggers`: Trigger keywords from metadata
- `keywords`: Additional keywords

## Step 2: Generate Test Cases

Generate **3 types** of virtual prompts per skill:

### A. Normal Invocation (this skill should be triggered)
```markdown
| Skill | Test Prompt | Expected Result |
|-------|-------------|-----------------|
| Qreact-expert | "Create a React component" | Qreact-expert |
| Qfact-checker | "Fact-check this report" | Qfact-checker |
| Qdoc-converter | "Convert this markdown to Word" | Qdoc-converter |
```

### B. Boundary Cases (distinguishing between similar skills)
```markdown
| Test Prompt | Expected Result | Misroute Risk |
|-------------|-----------------|---------------|
| "Create UI design" | Qfrontend-design | Qweb-design-guidelines |
| "Find root cause of bug" | Qsystematic-debugging | Ecode-debugger |
| "Write tests first" | Qtest-driven-development | Ecode-test-engineer |
```

### C. Unregistered Prompts (no route defined)
```markdown
| Test Prompt | Expected Result |
|-------------|-----------------|
| "Create a jira issue" | Qjira-cli (or Qatlassian-mcp) |
| "Verify the source" | Qsource-verifier |
| "Help me write something" | Qcontent-research-writer |
```

## Step 3: Simulate Routing

Simulate the routing logic of `intent-routes.json`.

### Matching Algorithm (same as prompt-check.mjs)

```javascript
function simulateRouting(userMessage, routes) {
  const msgLower = userMessage.toLowerCase();
  const msgWords = msgLower.split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const [keywords, target] of Object.entries(routes)) {
    const parts = keywords.split('/');
    let matchedParts = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);

      const hasExactWord = termWords.some(tw => msgWords.includes(tw));
      const hasSubstring = msgLower.includes(term);

      if (hasExactWord) {
        matchedParts++;
        totalWeight += term.length * 2;
      } else if (hasSubstring) {
        matchedParts++;
        totalWeight += term.length;
      }
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

### Execution Method

For each test prompt:
1. Run `simulateRouting(prompt, routes)`
2. Compare result against expected value
3. Record any mismatches

## Step 4: Verdict

### Result Classification

| Verdict | Meaning |
|---------|---------|
| **PASS** | Correctly routed to expected skill |
| **MISROUTE** | Incorrectly routed to a different skill |
| **UNREACHABLE** | Not registered in intent-routes.json, cannot be routed |
| **CONFLICT** | Two or more skills tie with the same score |
| **WEAK** | Routes but with a low score, making routing unstable |

### Verdict Criteria

```
score >= threshold × 2  → PASS (strong match)
score >= threshold      → PASS (weak match) — mark with WEAK warning
score < threshold       → UNREACHABLE
expected ≠ actual       → MISROUTE
```

## Step 5: Write Report

### Test Results Report

```markdown
# Skill Routing Test Report

**Run Date:** [date]
**Total Tests:** N
**PASS:** N | **MISROUTE:** N | **UNREACHABLE:** N | **CONFLICT:** N

## MISROUTE (immediate fix required)

| Prompt | Expected | Actual | Score | Root Cause |
|--------|----------|--------|-------|------------|
| "..." | Qfrontend-design | Qweb-design-guidelines | 12 | Keyword "UI" conflicts in triggers |

## UNREACHABLE (route registration needed)

| Skill | Registered | Suggested Route Keywords |
|-------|-----------|--------------------------|
| Qjira-cli | Not registered | "jira/issue/ticket/sprint" |

## CONFLICT (priority adjustment needed)

| Prompt | Competing Skills | Score |
|--------|-----------------|-------|
| "..." | SkillA (12) vs SkillB (12) | Tied |

## WEAK (unstable match)

| Prompt | Skill | Score | Risk |
|--------|-------|-------|------|
| "..." | Qfact-checker | 4 | Slight prompt variation may cause misroute |

## Coverage

| Category | Registered Skills | Unregistered Skills | Coverage |
|----------|------------------|---------------------|----------|
| General skills | 28/32 | 4 | 87.5% |
| Coding experts | N/A | N/A | Separate trigger |
| Agents | 5/16 | 11 | 31.3% |
```

## Step 6: Suggest Automatic Fixes

### MISROUTE Fix

```markdown
### Fix Suggestion: [Skill Name]

**Problem:** "[prompt]" is being routed to [wrong skill]
**Cause:** "[keyword]" is missing from description, or keyword conflict in intent-routes.json

**Fix A — Modify description:**
Before: "..."
After: "... Use when [specific trigger]..."

**Fix B — Modify intent-routes.json:**
Before: "keyword1/keyword2" → "SkillA"
After: "keyword1/keyword2/keyword3" → "SkillA"  (add differentiating keyword)
```

### UNREACHABLE Fix

```markdown
### Fix Suggestion: Add to intent-routes.json

Routes to add:
  "jira/issue/ticket/sprint": "Qjira-cli",
  "fact-check/verify-claims/accuracy": "Qfact-checker",
  "source/credibility/SIFT": "Qsource-verifier",
  "convert/md-to-docx/format": "Qdoc-converter",
  "content-writing/article/draft": "Qcontent-research-writer"
```

### Re-verify

After applying fixes, re-run the same tests to confirm PASS.

## Execution Modes

### Quick Verification (default)

```
/Qskill-tester
```

- Verifies only skills registered in intent-routes.json
- Auto-generates 2 test prompts per skill
- Reports only MISROUTE/UNREACHABLE

### Full Verification

```
/Qskill-tester --full
```

- Verifies all skills/agents (including coding-experts)
- 5 test prompts per skill (3 normal + 2 boundary)
- Full report + fix suggestions + confirm whether to auto-fix

### Specific Skill Verification

```
/Qskill-tester Qfact-checker Qsource-verifier
```

- Focuses on the specified skills only

## Execution Rules

### MUST DO
- Cross-verify intent-routes.json against the actual skill list
- Always test boundary cases between similar skills
- Confirm no regressions to existing routing before applying fixes
- Get user confirmation before applying fixes

### MUST NOT DO
- Do not modify descriptions without testing
- Do not change intent-routes.json without user confirmation
- Do not change descriptions of coding-experts skills (they use a different trigger mechanism)
- Do not use real user data in test cases
