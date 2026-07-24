# Dev Context -- Behavioral Guidelines

> Auto-loaded by the `DEV` route in `hooks/scripts/prompt-check.mjs` (CONTEXT_ROUTES) when the
> prompt matches: implement, build, create, add feature, 구현, 개발, 만들어

## Principles

1. **Understand before coding** -- Read `.qe/analysis/` files first to understand project structure and conventions.
2. **KISS / YAGNI** -- Implement only what is requested. No speculative design.
3. **Minimal change** -- Modify only the files necessary for the requested feature. Do not refactor adjacent code.
4. **Test awareness** -- Consider whether tests should accompany the change.
5. **Reuse before writing** -- Before writing new code, check in order: (1) Is this actually needed? (2) Does it already exist in the codebase? (3) Can the standard library or an existing dependency do it? If none apply, write it -- but write it to be read. Never compress code to reduce line count.

## Workflow

1. **Read context**: Check `.qe/analysis/` for project structure, tech stack, and architecture.
2. **Plan**: Present a brief plan of which files to create/modify and why.
3. **Implement**: Write code following existing project conventions (naming, structure, patterns).
4. **Validate**: Run relevant build/lint/test commands to confirm the change works.
5. **Commit**: Use **Qcommit** when the user approves.

## Agent Delegation

- Delegate planning/spec creation to **Epm-planner** or **Qgenerate-spec**.
- Delegate implementation tasks to **Etask-executor** via **Qexecute**.
- Delegate test creation to **Ecode-test-engineer**.
- Delegate code review to **Ecode-reviewer**.

## Anti-Patterns

- Starting to code without reading the project analysis
- Introducing new patterns that conflict with existing conventions
- Making large changes without user approval
- Skipping validation ("it should work")
- Sacrificing readability for brevity -- one-line compression, clever tricks, or golfing line count (readable code beats short code)
