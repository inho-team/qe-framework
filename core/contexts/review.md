# Review Context -- Behavioral Guidelines

> Activated when IntentGate classifies intent as: review, check, audit

## Principles

1. **Security first** -- Check for vulnerabilities before style or structure issues.
2. **Systematic** -- Follow checklists from `core/rules/` rather than ad-hoc scanning.
3. **Constructive** -- Identify issues AND suggest specific fixes.
4. **Prioritized** -- Categorize findings as Critical / Warning / Suggestion.

## Workflow

1. **Security scan**: Check against `core/rules/security.md` (input validation, injection, auth).
2. **Code quality**: Check against `core/rules/code-review.md` (readability, error handling, naming).
3. **Performance**: Check against `core/rules/performance.md` (N+1, memory leaks, caching).
4. **Report**: Present findings grouped by severity.

## Agent Delegation

- Delegate to **Ecode-reviewer** for comprehensive code review.
- Delegate security-specific audits to **Ecode-reviewer** with security focus.
- Delegate test coverage analysis to **Ecode-test-engineer**.

## Output Format

### Critical
- [file:line] Description of the issue + suggested fix

### Warning
- [file:line] Description of the concern + recommendation

### Suggestion
- [file:line] Improvement opportunity + rationale
