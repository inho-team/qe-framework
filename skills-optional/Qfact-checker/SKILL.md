---
name: Qfact-checker
description: Extracts factual claims from documents and verifies them through evidence-based research. Use when asked to fact-check this, verify these claims, is this true, check accuracy, or when reviewing reports for factual correctness. Distinct from Qsource-verifier (which checks source credibility/authenticity) — this skill verifies specific factual claims. Produces claim-by-claim ratings with evidence.
metadata: 
source: "https://github.com/jamditis/claude-skills-journalism"
author: jamditis
version: 1.0.0
domain: writing
triggers: fact check, verify claims, is this true, check accuracy, verify statement, fact-check, truth check, claim verification
role: specialist
scope: analysis
output-format: report
related-skills: Qsource-verifier, Qcontent-research-writer, Qwriting-clearly
keywords: fact-check, verification, claims, evidence, accuracy, truth
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

# Fact-Checker — Claim Verification Workflow

Extract factual claims from documents, reports, and articles and systematically verify them.

## Verification Process

```
1. Claim extraction → 2. Prioritization → 3. Evidence collection → 4. Source verification → 5. Verdict → 6. Report writing
```

## Step 1: Claim Extraction

### Verification Targets

| Target | Example |
|--------|---------|
| Factual claims | "X happened", "Y is true" |
| Statistics/numbers | "40% increase", "1 million people" |
| Dates/times | "Started in January 2024" |
| Citations/attribution | "A said..." |
| Causal claims | "X caused Y to happen" |

### Exclusions from Verification

- Opinions: "This policy is good/bad"
- Predictions: "In the future, X will happen"
- Preferences: "B is better than A"

### Claim Extraction Template

```markdown
## Claim Log

**Document:** [Source]
**Date:** [Write date]

### Claim 1
- **Statement:** [Exact quote or summary]
- **Speaker:** [Who said it]
- **Context:** [Surrounding context]
- **Type:** Statistic / Historical fact / Citation / Causal
- **Priority:** High / Medium / Low
- **Status:** Unverified / Verified / False / Unverifiable
```

### Priority Criteria

| Priority | Criteria |
|----------|----------|
| **High** | Core thesis of document, easily verifiable, high impact if wrong |
| **Medium** | Supporting evidence, requires effort to verify |
| **Low** | Peripheral details, commonly accepted, minimal impact |

## Step 2: Evidence Collection

### Source Priority

| Claim Type | Primary Source |
|-----------|------------------|
| Statistics | Original research, government data, methodology |
| Citations | Audio/video recordings, transcripts, direct verification |
| History | Contemporary news reports, official records |
| Science | Peer-reviewed papers, expert consensus |
| Legal | Court documents, official filings |
| Financial | Audit reports, regulatory disclosures |

### Evidence Strength

| Evidence Type | Strength |
|-----------|------|
| Official documents (court records, government reports) | Strong |
| Original data (directly analyzable) | Strong |
| Expert consensus (multiple independent experts) | Strong |
| Named sources (direct knowledge) | Medium |
| Contemporary reporting (same-era news) | Medium |
| Anonymous sources | Weak |
| Social media posts | Weak |

## Step 3: Verdict

### Verdict Grades

| Grade | Criteria |
|------|------|
| **True** | Accurate and complete, no important omissions |
| **Mostly True** | Accurate but needs context or minor clarification |
| **Half True** | Partially accurate, key context missing |
| **Mostly False** | Some factual content but overall misleading |
| **False** | Contradicts evidence |
| **Unverifiable** | Insufficient evidence |

### Verdict Template

```markdown
## Verdict: [Claim Summary]

**Claim:** [Exact statement]
**Speaker:** [Who]
**Verdict:** [Grade]

### Supporting Evidence
- [Evidence 1 + Source]
- [Evidence 2 + Source]

### Contradicting Evidence
- [Evidence 1 + Source]

### Missing Context
- [Context 1]

### Verdict Reasoning
[Why this grade]

### Confidence
High / Medium / Low + Reason
```

## Step 4: Report Writing

### Fact-Check Report Format

```markdown
# Fact-Check Report

**Target Document:** [Title/URL]
**Verification Date:** [Date]
**Verifier:** [Name]

## Summary
- Total claims: N
- True: N | Mostly true: N | False: N | Unverifiable: N

## Key Findings

### [Claim 1] — Verdict: [Grade]
- **Original:** "[Quote]"
- **Evidence:** [Summary of basis]
- **Correction suggestion:** [If needed]

### [Claim 2] — Verdict: [Grade]
...

## Corrections Needed
| Location | Original | Correction | Reason |
|----------|----------|------------|--------|
| [Section/Line] | [Original] | [Correction] | [Basis] |

## Sources
1. [Source 1]
2. [Source 2]
```

## Execution Rules

### MUST DO
- Use WebSearch tool to verify factual claims
- Prioritize primary sources (official documents, original data)
- Actively search for contradicting evidence
- Always include reasoning in verdicts
- Honestly mark unverifiable claims as "Unverifiable"

### MUST NOT DO
- Do not verdict "True" without evidence
- Do not classify opinions as factual claims
- Do not verdict "True" based on single source alone (prefer multiple sources)
- Do not skip verification and rely on intuition
