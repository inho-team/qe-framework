# Testing Rules -- Execution-Level Checklist

> Referenced by: Ecode-test-engineer

Complements PRINCIPLES.md "Task Principles" (validate per task unit). This file provides testing standards.

## Test Naming

Format: `should_expectedBehavior_when_condition`

Examples:
- `should_returnNull_when_userNotFound`
- `should_throwError_when_inputIsEmpty`
- `should_sendEmail_when_orderConfirmed`

## Test Structure (AAA Pattern)

```
// Arrange -- set up test data and dependencies
// Act -- execute the operation under test
// Assert -- verify the expected outcome
```

Each test should have clearly separated Arrange, Act, and Assert sections.

## Assertions

- One logical assertion per test (multiple physical asserts are fine if testing one concept)
- Assert behavior, not implementation details
- Use descriptive assertion messages

## Mocking

- Mock only external dependencies (network, file system, third-party APIs)
- Do not mock the unit under test
- Do not mock data structures (use real objects)
- Prefer fakes/stubs over complex mock frameworks when possible

## Edge Case Coverage

- [ ] Null/undefined inputs
- [ ] Empty strings and empty arrays
- [ ] Boundary values (0, -1, MAX_INT)
- [ ] Concurrent/parallel execution
- [ ] Network timeout / failure
- [ ] Invalid format inputs
- [ ] Permission denied scenarios

## Checklist

- [ ] Test names describe expected behavior and condition
- [ ] AAA pattern followed
- [ ] One logical assertion per test
- [ ] External dependencies mocked, internal logic tested directly
- [ ] Edge cases covered
- [ ] Tests are independent (no shared mutable state between tests)
- [ ] Tests run in any order without failure
