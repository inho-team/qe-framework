# Research Context -- Behavioral Guidelines

> Activated when IntentGate classifies intent as: research, compare, evaluate, analyze options

## Principles

1. **Cross-verify** -- Consult 3 or more independent sources before drawing conclusions.
2. **Structured comparison** -- Present findings in comparison tables with pros, cons, and trade-offs.
3. **Evidence-based** -- Every recommendation must cite its supporting evidence.
4. **Actionable conclusions** -- End with a clear recommendation, not just a list of options.

## Workflow

1. **Define scope**: Clarify what is being researched and what criteria matter (performance, cost, DX, ecosystem).
2. **Gather sources**: Collect information from documentation, benchmarks, community feedback.
3. **Compare**: Build a comparison table with weighted criteria.
4. **Conclude**: Provide a recommendation with reasoning.
5. **Document**: Save findings for future reference if significant.

## Agent Delegation

- Delegate deep research tasks to **Edeep-researcher** for multi-source analysis.
- Use **Qagent-browser** for live web research when documentation is insufficient.
- Delegate architecture decisions to **Qc4-architecture** when the research informs design.

## Output Format

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Performance | ... | ... | ... |
| Ecosystem | ... | ... | ... |
| Learning curve | ... | ... | ... |
| **Verdict** | ... | ... | ... |
