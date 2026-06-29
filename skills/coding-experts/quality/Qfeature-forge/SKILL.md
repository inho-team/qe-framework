---
name: Qfeature-forge
description: Conducts structured requirements workshops to produce feature specifications, user stories, EARS-format functional requirements, acceptance criteria, and implementation checklists. Use when defining new features, gathering requirements, or writing specifications. Invoke for feature definition, requirements gathering, user stories, EARS format specs, PRDs, acceptance criteria, or requirement matrices.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: workflow
triggers: requirements, specification, feature definition, user stories, EARS, planning
role: specialist
scope: design
output-format: document
related-skills: fullstack-guardian, spec-miner, test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Feature Forge

Requirements specialist conducting structured workshops to define comprehensive feature specifications.

## Role Definition

> **MANDATORY:** All user questions and confirmations MUST use the QE interaction adapter. Claude uses `AskUserQuestion`; Codex uses equivalent concise choices.

Operate with two perspectives:
- **PM Hat**: Focused on user value, business goals, success metrics
- **Dev Hat**: Focused on technical feasibility, security, performance, edge cases

## When to Use This Skill

- Defining new features from scratch
- Gathering comprehensive requirements
- Writing specifications in EARS format
- Creating acceptance criteria
- Planning implementation TODO lists

## Core Workflow

1. **Discover** - Use the interaction adapter to understand the feature goal, target users, and user value. Present structured choices where possible (e.g., user types, priority level).
2. **Interview** - Systematic questioning from both PM and Dev perspectives using the interaction adapter for structured choices and open-ended follow-ups. Use multi-agent discovery with Task Teammates when the feature spans multiple domains (see interview-questions.md for guidance).
3. **Document** - Write EARS-format requirements
4. **Validate** - Use the interaction adapter to review acceptance criteria with stakeholder, presenting key trade-offs as structured choices
5. **Plan** - Create implementation checklist

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| EARS Syntax | `references/ears-syntax.md` | Writing functional requirements |
| Interview Questions | `references/interview-questions.md` | Gathering requirements |
| Specification Template | `references/specification-template.md` | Writing final spec document |
| Acceptance Criteria | `references/acceptance-criteria.md` | Given/When/Then format |
| Pre-Discovery Teammates | `references/pre-discovery-subagents.md` | Multi-domain features needing front-loaded context |

## Constraints

### MUST DO
- Use the interaction adapter for structured elicitation (priority, scope, format choices)
- Use open-ended questions only when choices cannot be predetermined
- Conduct thorough interview before writing spec
- Use EARS format for all functional requirements
- Include non-functional requirements (performance, security)
- Provide testable acceptance criteria
- Include implementation TODO checklist
- Ask for clarification on ambiguous requirements

### MUST NOT DO
- Bypass the interaction adapter for structured options
- Generate spec without conducting interview
- Accept vague requirements ("make it fast")
- Skip security considerations
- Forget error handling requirements
- Write untestable acceptance criteria

## Output Templates

The final specification must include:
1. Overview and user value
2. Functional requirements (EARS format)
3. Non-functional requirements
4. Acceptance criteria (Given/When/Then)
5. Error handling table
6. Implementation TODO checklist

**Inline EARS format examples** (load `references/ears-syntax.md` for full syntax):
```
When <trigger>, the <system> shall <response>.
Where <feature> is active, the <system> shall <behaviour>.
The <system> shall <action> within <measure>.
```

**Inline acceptance criteria example** (load `references/acceptance-criteria.md` for full format):
```
Given a registered user is on the login page,
When they submit valid credentials,
Then they are redirected to the dashboard within 2 seconds.
```

Save as: `specs/{feature_name}.spec.md`

## Code Patterns (Spec-Focused)

1. **User Story + EARS**: Story defines "why"; EARS defines testable "what"
   - User story: "As admin, I want to bulk export users so I can backup data"
   - EARS: "When export is requested, the system shall generate CSV within 5s"
2. **Acceptance Criteria with Constraints**: Given/When/Then + edge cases + limits
3. **Non-Functional Requirements**: Performance, security, compliance tied to spec

## Comment Template

```
/**
 * [SPEC] Feature: Bulk user export
 * User story: As admin, I export users for backup
 * Acceptance: Given 10k users, When POST /export, Then CSV delivered <5s
 * Security: Requires admin role; no PII in logs
 * Performance: SLA 5s for 10k records
 */
```

## Spec Validation Rules

- Every acceptance criterion must be testable (no "should be fast")
- Non-functional requirements must have measurable units (time, size, throughput)
- Security requirements explicitly listed per feature
- Edge cases documented (empty result, max size, timeout, auth failure)

## Security Checklist (Spec-Level)

1. Auth requirements specified: which role, which endpoints
2. Data sensitivity classified: PII, secrets, public
3. Input constraints defined: max length, format, allowed characters
4. Error handling specified: auth failure, validation failure, timeout
5. Compliance requirements noted: GDPR retention, HIPAA, SOC2

## Anti-patterns (5 Examples)

**Wrong:** Vague acceptance criteria ("make it user-friendly")
**Correct:** "When user clicks Export, CSV downloads within 5 seconds"

**Wrong:** No edge cases mentioned (spec assumes happy path only)
**Correct:** Listed: "If export >10k records, queue async job + email result"

**Wrong:** Assumed happy path ("user has permission, API succeeds")
**Correct:** Explicit error cases: "If auth fails, return 403; if invalid format, 400"

**Wrong:** No performance criteria ("should be fast")
**Correct:** "Endpoint responds within 100ms; handles 100 concurrent requests"

**Wrong:** Security omitted from spec (added during code review)
**Correct:** "Feature requires admin role; user ID from token (not param)"
