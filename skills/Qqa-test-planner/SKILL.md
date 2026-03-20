---
name: Qqa-test-planner
description: "Generates test plans, manual test cases, regression suites, and bug reports for QA workflows. Use when creating a test plan, generating test cases, building a regression suite, drafting bug report templates, or producing QA documentation."
user_invocable: true
---


# QA Test Planner

Generates test plans, manual test cases, regression suites, Figma design verifications, and bug reports.

> **Activation:** Explicitly invoked (e.g., `/qa-test-planner`).

---

## Quick Start

```
"Create a test plan for the user authentication feature"
"Generate manual test cases for the checkout flow"
"Build a regression test suite for the payment module"
"Write a bug report for the form validation issue"
```

---

## Quick Reference

| Task | Output | Time |
|------|--------|------|
| Test plan | Strategy, scope, schedule, risks | 10-15 min |
| Test cases | Step-by-step instructions, expected results | 5-10 min each |
| Regression suite | Smoke tests, critical paths, execution order | 15-20 min |
| Figma verification | Design-implementation comparison, discrepancy list | 10-15 min |
| Bug report | Repro steps, environment, evidence | 5 min |

---

## Workflow

```
1. Analyze → Parse requirements, identify test types, determine scope
2. Generate → Write structured outputs, apply templates, include edge cases
3. Validate → Check completeness, verify traceability, ensure actionable steps
```

---

## Core Outputs

### 1. Test Plan
- Scope/objectives, approach/strategy, environment requirements
- Entry/exit criteria, risk assessment, timeline

### 2. Manual Test Cases
- Step-by-step instructions with expected results
- Preconditions, test data, priority/severity

### 3. Regression Test Suite

| Suite Type | Time | Frequency | Coverage |
|------------|------|-----------|----------|
| Smoke | 15-30 min | Daily | Critical paths only |
| Targeted | 30-60 min | Per change | Affected areas |
| Full | 2-4 hours | Weekly/release | Comprehensive |
| Sanity | 10-15 min | After hotfix | Quick validation |

### 4. Figma Design Verification
- Component-by-component comparison, spacing/typography/color checks

### 5. Bug Report
- Reproduction steps, environment, evidence, severity/priority

---

## Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Vague test steps | Specific actions + expected results |
| Missing preconditions | Document all setup requirements |
| No test data | Provide sample data or generation method |
| Generic bug titles | Specific: "[Feature] issue when [action]" |
| Skipping edge cases | Include boundary values, nulls |

---

## Validation Checklist

**Test Plan:**
- [ ] Scope clearly defined (in/out)
- [ ] Entry/exit criteria stated
- [ ] Risks and mitigations identified

**Test Cases:**
- [ ] Each step includes expected result
- [ ] Preconditions documented
- [ ] Priority assigned

**Bug Report:**
- [ ] Steps are reproducible
- [ ] Environment documented
- [ ] Severity/priority set

---

## Test Case Format

```markdown
## TC-001: [Title]

**Priority:** High | Medium | Low
**Type:** Functional | UI | Integration | Regression

### Preconditions
- [Setup requirements]

### Test Steps
1. [Action] → **Expected:** [Result]
2. [Action] → **Expected:** [Result]

### Test Data
- Input: [values] | User: [account] | Config: [settings]
```

| Test Type | Focus | Example |
|-----------|-------|---------|
| Functional | Business logic | Login with valid credentials |
| UI/Visual | Appearance, layout | Button matches Figma design |
| Integration | Component interaction | API returns data to frontend |
| Regression | Existing functionality | Previous features still work |
| Performance | Speed, load handling | Page loads within 3 seconds |
| Security | Vulnerabilities | SQL injection prevention |

---

## Bug Report Template

```markdown
# BUG-[ID]: [Clear, specific title]

**Severity:** Critical | High | Medium | Low
**Priority:** P0 | P1 | P2 | P3

## Environment
- OS / Browser / Device / Build / URL

## Steps to Reproduce
1. [Step] → 2. [Step] → 3. [Step]

## Expected vs Actual Behavior
## Visual Evidence
## Impact (user count, frequency, workaround)
```

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical (P0)** | System failure, data loss | Payment fails, cannot log in |
| **High (P1)** | Major feature broken | Search does not work |
| **Medium (P2)** | Partial failure, workaround exists | One filter missing |
| **Low (P3)** | Cosmetic, rare edge case | Typo, minor alignment |

---

## Pass/Fail Criteria

**Pass:** All P0 tests pass, 90%+ P1 pass, no critical bugs.
**Fail (blocks release):** Any P0 failure, critical bug, security vulnerability, data loss.
