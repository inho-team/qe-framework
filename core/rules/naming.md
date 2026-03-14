# Naming Rules -- Execution-Level Checklist

> Referenced by: all agents

Complements PRINCIPLES.md "Code Quality Principles" (KISS). This file provides naming conventions.

## Variables

- Use descriptive nouns: `userProfile`, `orderTotal`, `connectionPool`
- Avoid single-letter names except in short lambdas or loop indices
- Avoid generic names: `data`, `info`, `temp`, `result` (add context: `userData`, `orderInfo`)

## Functions / Methods

- Use verb + noun: `fetchUser`, `calculateTotal`, `validateInput`
- Event handlers: `onSubmit`, `handleClick`, `onUserLogin`
- Converters: `toJSON`, `fromString`, `parseConfig`

## Booleans

- Prefix with: `is`, `has`, `can`, `should`, `was`
- Examples: `isActive`, `hasPermission`, `canEdit`, `shouldRetry`
- Avoid negated names: use `isEnabled` not `isNotDisabled`

## Constants

- `UPPER_SNAKE_CASE`: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS`, `API_BASE_URL`
- Group related constants in an enum or object

## Files

- Match the primary export: `UserService.ts` exports `UserService`
- Use kebab-case for non-class files: `user-utils.ts`, `api-client.ts`
- Test files: `{source-file}.test.ts` or `{source-file}.spec.ts`

## QE-Specific Naming

- Skills: `Q` prefix + PascalCase action: `Qinit`, `Qcommit`, `Qrun-task`
- Agents: `E` prefix + PascalCase role: `Ecommit-executor`, `Ecode-reviewer`
- Core files: descriptive UPPER_SNAKE_CASE: `PRINCIPLES.md`, `INTENT_GATE.md`
- Hook scripts: kebab-case: `pre-tool-use.mjs`, `session-start.mjs`
