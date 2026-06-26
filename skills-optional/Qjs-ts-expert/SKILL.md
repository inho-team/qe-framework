---
name: Qjs-ts-expert
description: Writes, debugs, and refactors JavaScript and TypeScript code using modern ES2023+ features, advanced type systems, and Node.js/Browser APIs. Use when building JS/TS applications, implementing complex generics, or ensuring end-to-end type safety.
license: MIT
domain: language
triggers: JavaScript, TypeScript, ES2023, async/await, generics, type safety, type guards, discriminated unions, tsconfig, ESM, Node.js, Browser APIs
invocation_trigger: When specialized JavaScript or TypeScript best practices are needed.
recommendedModel: haiku
---

# JS/TS Expert

## When to Use
- Building modern web applications (Frontend/Backend)
- Implementing advanced type systems (generics, mapped types, branded types)
- Optimizing JS/TS performance and memory usage
- Configuring `tsconfig.json` or build systems (Vite, tRPC)

## Core Workflow
1. **Analyze Requirements**: Review `package.json` and `tsconfig.json` for module system and strictness levels.
2. **Design Type Architecture**: (TS only) Plan branded types, generics, and discriminated unions before implementation.
3. **Implement**: Write ES2023+ code with proper async/await patterns and ESM structure.
4. **Validate**: Run `tsc --noEmit` and `eslint --fix`. Resolve all errors before proceeding.
5. **Test**: Ensure 85%+ coverage. Confirm no unhandled Promise rejections.

## Standard Constraints

### MUST DO
- **Strict Mode**: Always enable `strict: true` in TS.
- **Modern Syntax**: Use ES2023+ features (Optional chaining `?.`, Nullish coalescing `??`).
- **ESM**: Prefer `import`/`export` over CommonJS.
- **Type-First**: (TS only) Design types before implementation logic.
- **Explicit Returns**: Always define return types for public APIs.
- **Async Safety**: Always handle async errors explicitly with try/catch.

### MUST NOT DO
- Use `var` (always use `const` or `let`).
- Use `any` without extreme justification.
- Mix CommonJS and ESM in the same module.
- Use `as` assertions without necessity (prefer type guards).
- Use enums (prefer const objects with `as const`).

## Key Patterns

### Branded Types (TS)
```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, "UserId">;
```

### Discriminated Unions & Exhaustive Checks (TS)
```typescript
type State = { status: "success"; data: any } | { status: "error"; err: Error };
function handle(s: State) {
  switch (s.status) {
    case "success": return s.data;
    case "error": return s.err;
    default: const _: never = s; throw new Error(_);
  }
}
```

### Async/Await with Error Handling (JS/TS)
```javascript
async function fetchSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    return null;
  }
}
```

## Code Patterns

### Basic: Typed Function with JSDoc
```typescript
/**
 * Multiplies two numbers and returns the result.
 * @param {number} a - First operand
 * @param {number} b - Second operand
 * @returns {number} The product of a and b
 * @example multiply(3, 4) // => 12
 */
export function multiply(a: number, b: number): number {
  return a * b;
}
```

### Error Handling: Custom Error Class + Type Guard
```typescript
/**
 * Custom error for API failures with status code and retry flag.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public readonly retryable: boolean,
    message?: string
  ) {
    super(message || `API Error: ${status}`);
    this.name = "ApiError";
  }
}

/**
 * Type guard to check if error is ApiError.
 * @param {unknown} err - Error to check
 * @returns {boolean} True if err is ApiError
 */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
```

### Advanced: Generic Utility Type + Branded Types
```typescript
/**
 * Result type for operations that may fail.
 * @template T - Success type
 * @template E - Error type
 */
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Creates a branded string type for validated identifiers.
 * @template B - Brand literal
 */
export type UserId = string & { readonly __brand: "UserId" };
export const userId = (raw: string): UserId => raw as UserId;
```

## Comment Template

### Function JSDoc
```typescript
/**
 * Brief description of what the function does.
 * @param {Type} paramName - Description of parameter
 * @param {number} [optional=default] - Optional parameter with default
 * @returns {ReturnType} Description of return value
 * @throws {ErrorType} Description of when this error occurs
 * @example
 * myFunc("test", 42);
 * // => "result"
 */
```

### Class JSDoc
```typescript
/**
 * @class MyClass
 * @description Detailed description of class purpose
 * @extends ParentClass
 * @example
 * const instance = new MyClass();
 * instance.method();
 */
```

### Module JSDoc
```typescript
/**
 * @module utils
 * @description Provides utility functions for data transformation
 */
```

## Lint Rules

### ESLint & TypeScript
- Run: `npx eslint {file}` or `npx eslint --fix {file}` to auto-fix
- Type check: `npx tsc --noEmit` (no emit, error reporting only)
- Format: `npx prettier --write {file}`

### Configuration Files
- `.eslintrc.json` or `.eslintrc.cjs` — ESLint rules
- `tsconfig.json` — TypeScript compiler options (must have `strict: true`)
- `.prettierrc` or `.prettierrc.json` — Prettier formatting

### Threshold
- **No `any` types** unless documented with `@ts-expect-error`
- **Zero ESLint warnings** on production code
- **Strict TypeScript**: `strict: true`, no implicit types

## Security Checklist

- **XSS Protection**: Never use `innerHTML` with user input; use `textContent`, `innerText`, or DOM APIs
- **Prototype Pollution**: Use `Object.freeze()` on shared objects; never `Object.assign()` from untrusted user data
- **Code Injection**: Never use `eval()` or `Function()` constructor on user input
- **ReDoS (Regular Expression Denial of Service)**: Avoid complex or nested quantifiers in regex applied to user-provided strings
- **npm Supply Chain**: Lock all versions in `package-lock.json`; run `npm audit` regularly; review `package.json` before bumping dependencies
- **Sensitive Data**: Never store auth tokens or PII in localStorage; use httpOnly cookies for session tokens only

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| `let x: any = value` | `let x: string \| number = value` with proper type guards |
| Nested callbacks (callback hell) | Use `async/await` or `.then()` chains |
| `if (a == b)` | Always use `===` for equality checks |
| Shared mutable state across modules | Use immutable patterns: `const` by default, pass copies or use `Object.freeze()` |
| `await promise` without try/catch at module top-level | Always handle Promise rejection with `.catch()` or try/catch block |
