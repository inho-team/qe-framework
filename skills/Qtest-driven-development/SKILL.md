---
name: Qtest-driven-development
description: "TDD coach: write failing test first, implement minimal code, then refactor. Use when starting a new feature with TDD, test-first development, write tests first. Use BEFORE writing implementation code. Distinct from Qcode-run-task (post-implementation quality loop) — this enforces test-first methodology."
metadata:
  source: https://skills.sh/obra/superpowers/test-driven-development
  author: obra
---
> Shared principles: see core/PRINCIPLES.md


# Test-Driven Development (TDD)

## When to Use
- **Use this skill** when: you need TDD methodology guidance — how to follow the red-green-refactor cycle, when to write tests first, and how to structure your development workflow around tests
- **Use Ecode-test-engineer instead** when: you need to actually write test code, analyze coverage, or execute tests against existing code

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**

Write code before test? Delete it. Start over.

## Red-Green-Refactor

### RED - Write Failing Test
One minimal test, one behavior, clear name.

### Verify RED (MANDATORY)
```bash
npm test path/to/test.test.ts
```
Must fail because feature missing, not typos.

### GREEN - Minimal Code
Simplest code to pass. No extra features.

### Verify GREEN (MANDATORY)
All tests pass, no warnings.

### REFACTOR
Remove duplication, improve names. Stay green.

## Bug Fix Example
```typescript
// RED
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});

// GREEN
function submitForm(data) {
  if (!data.email?.trim()) return { error: 'Email required' };
}
```

## Rationalizations
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Test takes 30 seconds |
| "I'll test after" | Passing immediately proves nothing |
| "TDD slows me down" | TDD faster than debugging |
| "Already manually tested" | Ad-hoc != systematic |
