# Code Review Rules -- Execution-Level Checklist

> Referenced by: Ecode-reviewer

Complements PRINCIPLES.md "Code Quality Principles". This file provides review-specific checks.

## Readability

- [ ] Functions are under 40 lines (split if longer)
- [ ] Nesting depth is 3 or fewer levels
- [ ] Comments explain "why", not "what"
- [ ] No commented-out code left in production files

## Error Handling

- [ ] All error paths are handled (no empty catch blocks)
- [ ] Errors include context: what operation failed, with what input
- [ ] External call failures have retry or graceful fallback logic
- [ ] User-facing errors are friendly; internal errors are detailed in logs

## Resource Cleanup

- [ ] File handles, DB connections, streams are closed/disposed
- [ ] Try-with-resources or finally blocks used for cleanup
- [ ] Event listeners are removed when components unmount

## Thread Safety

- [ ] Shared mutable state is protected (mutex, lock, atomic)
- [ ] Race conditions considered in async/concurrent code
- [ ] Database operations use appropriate isolation levels

## Naming Conventions

- [ ] Names match the conventions in `core/rules/naming.md`
- [ ] Abbreviations are avoided unless universally understood (URL, ID, HTTP)
- [ ] Boolean variables read as questions (isValid, hasPermission)

## Magic Number Elimination

- [ ] Numeric literals extracted to named constants
- [ ] String literals used as keys/types extracted to constants or enums
- [ ] Timeout/retry values are configurable, not hardcoded
