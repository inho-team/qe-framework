# Error Handling Rules -- Execution-Level Checklist

> Referenced by: Ecode-debugger

Complements PRINCIPLES.md "Code Quality Principles". This file provides error-handling patterns.

## Core Rules

1. **Never silently swallow errors** -- Every catch block must log, re-throw, or handle meaningfully.
2. **Log with context** -- Include what operation failed, where (file/function), and why (error message + relevant input).
3. **Use specific exception types** -- Catch specific errors, not generic `Error` or `Exception`. Throw domain-specific errors.
4. **Fail fast at boundaries** -- Validate inputs at function/module boundaries. Reject invalid data early.
5. **Graceful degradation** -- When a non-critical subsystem fails, continue with reduced functionality rather than crashing.

## Patterns

### Good: Contextual error logging
```
catch (err) {
  logger.error('Failed to fetch user profile', { userId, endpoint, cause: err.message });
  throw new UserServiceError('Profile fetch failed', { cause: err });
}
```

### Bad: Silent swallow
```
catch (err) {
  // ignore
}
```

### Bad: Generic catch-all
```
catch (err) {
  console.log('Error');
}
```

## Checklist

- [ ] No empty catch blocks
- [ ] Error messages include operation context
- [ ] Specific exception types used (not bare Error)
- [ ] Input validation at module boundaries
- [ ] External service failures have fallback or retry
- [ ] Async errors are awaited/caught (no unhandled promise rejections)
- [ ] Error responses do not leak internal details to end users
