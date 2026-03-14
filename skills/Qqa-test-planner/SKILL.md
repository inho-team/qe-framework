---
name: Qqa-test-planner
description: Comprehensive tool for QA engineers to generate test plans, manual test cases, regression test suites, and bug reports. Includes design verification via Figma MCP integration.
trigger: explicit
---
> Shared principles: see core/PRINCIPLES.md


# QA Test Planner

A comprehensive skill for QA engineers to efficiently write test plans, generate manual test cases, build regression test suites, verify Figma designs, and document bugs.

> **Activation:** This skill runs only when explicitly invoked (e.g., `/qa-test-planner`, `qa-test-planner`, or `use qa-test-planner skill`).

---

## Quick Start

```
"Create a test plan for the user authentication feature"
"Generate manual test cases for the checkout flow"
"Build a regression test suite for the payment module"
"Compare the login page against the Figma design at [URL]"
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

## How It Works

```
Request Input
    |
    v
+----------------------------------------------+
| 1. Analyze                                    |
|    * Parse feature/requirements               |
|    * Identify required test types             |
|    * Determine scope and priorities           |
+----------------------------------------------+
    |
    v
+----------------------------------------------+
| 2. Generate                                   |
|    * Write structured outputs                 |
|    * Apply templates and best practices       |
|    * Include edge cases and variations        |
+----------------------------------------------+
    |
    v
+----------------------------------------------+
| 3. Validate                                   |
|    * Check completeness                       |
|    * Verify traceability                      |
|    * Ensure actionable steps                  |
+----------------------------------------------+
    |
    v
QA Output Ready
```

---

## Core Outputs

### 1. Test Plan
- Test scope and objectives
- Test approach and strategy
- Environment requirements
- Entry/exit criteria
- Risk assessment
- Timeline and milestones

### 2. Manual Test Cases
- Step-by-step instructions
- Expected vs. actual results
- Preconditions and setup
- Test data requirements
- Priority and severity

### 3. Regression Test Suite
- Smoke tests (15-30 min)
- Full regression (2-4 hours)
- Targeted regression (30-60 min)
- Execution order and dependencies

### 4. Figma Design Verification
- Component-by-component comparison
- Spacing and typography checks
- Color and visual consistency
- Interactive state validation

### 5. Bug Report
- Clear reproduction steps
- Environment details
- Evidence (screenshots, logs)
- Severity and priority

---

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| Vague test steps | Cannot be reproduced | Specific actions + expected results |
| Missing preconditions | Unexpected test failures | Document all setup requirements |
| No test data | Blocks testers | Provide sample data or generation method |
| Generic bug titles | Hard to track | Specific: "[Feature] issue when [action]" |
| Skipping edge cases | Misses critical bugs | Include boundary values, nulls |

---

## Validation Checklist

**Test Plan:**
- [ ] Scope clearly defined (in/out)
- [ ] Entry/exit criteria stated
- [ ] Risks and mitigations identified
- [ ] Timeline is realistic

**Test Cases:**
- [ ] Each step includes expected result
- [ ] Preconditions documented
- [ ] Test data prepared
- [ ] Priority assigned

**Bug Report:**
- [ ] Steps are reproducible
- [ ] Environment documented
- [ ] Screenshots/evidence attached
- [ ] Severity/priority set

---

<details>
<summary><strong>Deep Dive: Test Case Structure</strong></summary>

### Standard Test Case Format

```markdown
## TC-001: [Test Case Title]

**Priority:** High | Medium | Low
**Type:** Functional | UI | Integration | Regression
**Status:** Not Run | Pass | Fail | Blocked

### Purpose
[What is being tested and why]

### Preconditions
- [Setup requirement 1]
- [Setup requirement 2]
- [Required test data]

### Test Steps
1. [Action to perform]
   **Expected:** [What should happen]

2. [Action to perform]
   **Expected:** [What should happen]

### Test Data
- Input: [test data values]
- User: [test account info]
- Config: [environment settings]

### Postconditions
- [System state after test]
- [Cleanup tasks required]
```

### Test Types

| Type | Focus | Example |
|------|-------|---------|
| Functional | Business logic | Login with valid credentials |
| UI/Visual | Appearance, layout | Button matches Figma design |
| Integration | Component interaction | API returns data to frontend |
| Regression | Existing functionality | Previous features still work |
| Performance | Speed, load handling | Page loads within 3 seconds |
| Security | Vulnerabilities | SQL injection prevention |

</details>

<details>
<summary><strong>Deep Dive: Bug Report Template</strong></summary>

```markdown
# BUG-[ID]: [Clear, specific title]

**Severity:** Critical | High | Medium | Low
**Priority:** P0 | P1 | P2 | P3
**Type:** Functional | UI | Performance | Security
**Status:** Open | In Progress | Fixed | Closed

## Environment
- **OS:** [Windows 11, macOS 14, etc.]
- **Browser:** [Chrome 120, Firefox 121, etc.]
- **Device:** [Desktop, iPhone 15, etc.]
- **Build:** [version/commit]
- **URL:** [page where bug occurs]

## Description
[Clear, concise description of the issue]

## Steps to Reproduce
1. [Specific step]
2. [Specific step]
3. [Specific step]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Visual Evidence
- Screenshot: [attached]
- Video: [link if applicable]
- Console error: [paste error]

## Impact
- **User impact:** [how many users affected]
- **Frequency:** [always, sometimes, rarely]
- **Workaround:** [if one exists]
```

### Severity Definitions

| Level | Criteria | Example |
|-------|----------|---------|
| **Critical (P0)** | System failure, data loss, security | Payment fails, cannot log in |
| **High (P1)** | Major feature broken, no workaround | Search does not work |
| **Medium (P2)** | Partial feature failure, workaround exists | One filter option missing |
| **Low (P3)** | Cosmetic, rare edge case | Typo, minor alignment issue |

</details>

<details>
<summary><strong>Deep Dive: Regression Testing</strong></summary>

### Suite Structure

| Suite Type | Time | Frequency | Coverage |
|------------|------|-----------|----------|
| Smoke | 15-30 min | Daily | Critical paths only |
| Targeted | 30-60 min | Per change | Affected areas |
| Full | 2-4 hours | Weekly/release | Comprehensive |
| Sanity | 10-15 min | After hotfix | Quick validation |

### Pass/Fail Criteria

**Pass:**
- All P0 tests pass
- 90%+ of P1 tests pass
- No critical bugs

**Fail (blocks release):**
- Any P0 test fails
- Critical bug found
- Security vulnerability
- Data loss scenario

</details>

---

**"Testing shows the presence of bugs, not their absence." — Edsger Dijkstra**
