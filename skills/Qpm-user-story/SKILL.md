---
name: Qpm-user-story
description: Writes user stories in Mike Cohn format with Gherkin acceptance criteria. Use when converting user needs into development-ready tasks. Triggered by "write user stories", "create a story", "acceptance criteria", "As a user", etc.
---
> Shared principles: see core/PRINCIPLES.md


## Purpose
Generate clear, concise user stories by combining Mike Cohn's user story format with Gherkin acceptance criteria. Converts user needs into outcome-focused development tasks and provides testable success criteria.

## Core Formats

### Use Case (Mike Cohn Format)
```
As a [user persona/role]
I want to [action to achieve outcome]
so that [desired outcome]
```

### Acceptance Criteria (Gherkin Format)
```
Scenario: [brief scenario description]
Given: [initial context or precondition]
and Given: [additional precondition]
When: [event that triggers the action]
Then: [expected result]
```

## Workflow

### Step 1: Gather Context
- Identify the user persona
- Understand the problem being solved
- Define the desired outcome
- Identify constraints

### Step 2: Write the Use Case
```markdown
### User Story [ID]:
- **Summary:** [concise, value-focused title]

#### Use Case:
- **As a** [user's name if available, otherwise persona]
- **I want to** [action the user takes to reach the outcome]
- **so that** [desired outcome]
```

**Quality check:**
- Is "As a" specific? (e.g., "trial user" vs "user")
- Is "I want to" a user action, not a feature?
- Does "So that" explain the motivation?

### Step 3: Write Acceptance Criteria
```markdown
#### Acceptance Criteria:
- **Scenario:** [scenario description]
- **Given:** [precondition]
- **and Given:** [additional precondition]
- **When:** [trigger event]
- **Then:** [expected result]
```

**Rules:**
- Only one When (multiple = split the story)
- Only one Then (multiple = split the story)
- Then must be measurable

### Step 4: Write the Summary
```markdown
- **Summary:** short, memorable, value-focused title
```
✅ "Enable Google login for trial users to reduce friction"
❌ "Add login button"

### Step 5: Validate and Refine
- Read aloud to the team
- Confirm QA can write test cases from it
- Split if too large

## Good Example
```markdown
### User Story 042:
- **Summary:** Enable Google login for trial users to reduce friction

#### Use Case:
- **As a** trial user visiting the app for the first time
- **I want to** log in with my Google account
- **so that** I can access the app without creating and remembering a new password

#### Acceptance Criteria:
- **Scenario:** First-time trial user logs in with Google OAuth
- **Given:** I am on the login page
- **and Given:** I have a Google account
- **When:** I click "Sign in with Google" and approve the app
- **Then:** I am logged into the app and redirected to the onboarding flow
```

## Anti-Patterns
- "As a developer, I want to..." → technical task, not a user story
- "As a user" (too generic) → use a specific persona
- "so that I can save" (repeating the action) → write the real motivation
- Multiple When/Then → split the story
- "Then the experience improves" (not measurable) → be specific

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
