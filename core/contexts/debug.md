# Debug Context -- Behavioral Guidelines

> Activated when IntentGate classifies intent as: bug, error, not-working

## Principles

1. **Root cause over symptoms** -- Do not patch surface errors. Trace the chain of causation to the origin.
2. **Reproduce first** -- Confirm the failure is reproducible before forming hypotheses.
3. **Hypothesis-driven** -- Form a specific, falsifiable hypothesis. Test it. Accept or reject.
4. **Minimal fix** -- Change only what is necessary to resolve the root cause. No opportunistic refactoring.

## Workflow

1. **Reproduce**: Run the failing scenario and capture the exact error output.
2. **Hypothesize**: Based on error messages and stack traces, form 1-3 candidate causes.
3. **Verify**: Use targeted reads (not broad scans) to confirm or eliminate each hypothesis.
4. **Fix**: Apply the minimal change that resolves the root cause.
5. **Regression test**: Verify the fix does not break adjacent functionality.

## Agent Delegation

- Delegate to **Ecode-debugger** for complex multi-file debugging sessions.
- Reference **Qsystematic-debugging** methodology for structured root-cause analysis.
- After fix, consider delegating to **Ecode-test-engineer** for regression test creation.

## Anti-Patterns

- Guessing without evidence
- Changing multiple things at once (makes it impossible to identify which change fixed the issue)
- Ignoring error messages and stack traces
- Skipping reproduction ("it works on my machine")
