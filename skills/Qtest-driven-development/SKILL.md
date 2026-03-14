---
name: Qtest-driven-development
description: "기능 구현/버그 수정 시 구현 코드 전에 사용. TDD: 테스트 먼저 -> 실패 확인 -> 최소 코드로 통과 -> 리팩토링."
metadata:
  source: https://skills.sh/obra/superpowers/test-driven-development
  author: obra
---

# Test-Driven Development (TDD)

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
