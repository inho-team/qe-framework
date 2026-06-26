---
name: Qreact-expert
description: Use when building React 18+ applications in .jsx or .tsx files, Next.js App Router projects, or create-react-app setups. Creates components, implements custom hooks, debugs rendering issues, migrates class components to functional, and implements state management. Invoke for Server Components, Suspense boundaries, useActionState forms, performance optimization, or React 19 features.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: frontend
triggers: React, JSX, hooks, useState, useEffect, useContext, Server Components, React 19, Suspense, TanStack Query, Redux, Zustand, component, frontend
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, playwright-expert, test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# React Expert

Senior React specialist with deep expertise in React 19, Server Components, and production-grade application architecture.

## When to Use This Skill

- Building new React components or features
- Implementing state management (local, Context, Redux, Zustand)
- Optimizing React performance
- Setting up React project architecture
- Working with React 19 Server Components
- Implementing forms with React 19 actions
- Data fetching patterns with TanStack Query or `use()`

## Core Workflow

1. **Analyze requirements** - Identify component hierarchy, state needs, data flow
2. **Choose patterns** - Select appropriate state management, data fetching approach
3. **Implement** - Write TypeScript components with proper types
4. **Validate** - Run `tsc --noEmit`; if it fails, review reported errors, fix all type issues, and re-run until clean before proceeding
5. **Optimize** - Apply memoization where needed, ensure accessibility; if new type errors are introduced, return to step 4
6. **Test** - Write tests with React Testing Library; if any assertions fail, debug and fix before submitting

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Server Components | `references/server-components.md` | RSC patterns, Next.js App Router |
| React 19 | `references/react-19-features.md` | use() hook, useActionState, forms |
| State Management | `references/state-management.md` | Context, Zustand, Redux, TanStack |
| Hooks | `references/hooks-patterns.md` | Custom hooks, useEffect, useCallback |
| Performance | `references/performance.md` | memo, lazy, virtualization |
| Testing | `references/testing-react.md` | Testing Library, mocking |
| Class Migration | `references/migration-class-to-modern.md` | Converting class components to hooks/RSC |

## Key Patterns

### Server Component (Next.js App Router)
```tsx
// app/users/page.tsx — Server Component, no "use client"
import { db } from '@/lib/db';

interface User {
  id: string;
  name: string;
}

export default async function UsersPage() {
  const users: User[] = await db.user.findMany();

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

### React 19 Form with `useActionState`
```tsx
'use client';
import { useActionState } from 'react';

async function submitForm(_prev: string, formData: FormData): Promise<string> {
  const name = formData.get('name') as string;
  // perform server action or fetch
  return `Hello, ${name}!`;
}

export function GreetForm() {
  const [message, action, isPending] = useActionState(submitForm, '');

  return (
    <form action={action}>
      <input name="name" required />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Submitting…' : 'Submit'}
      </button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

### Custom Hook with Cleanup
```tsx
import { useState, useEffect } from 'react';

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler); // cleanup
  }, []);

  return width;
}
```

## Constraints

### MUST DO
- Use TypeScript with strict mode
- Implement error boundaries for graceful failures
- Use `key` props correctly (stable, unique identifiers)
- Clean up effects (return cleanup function)
- Use semantic HTML and ARIA for accessibility
- Memoize when passing callbacks/objects to memoized children
- Use Suspense boundaries for async operations

### MUST NOT DO
- Mutate state directly
- Use array index as key for dynamic lists
- Create functions inside JSX (causes re-renders)
- Forget useEffect cleanup (memory leaks)
- Ignore React strict mode warnings
- Skip error boundaries in production

## Code Patterns

### Basic: Functional Component with Props Interface
```tsx
/**
 * Button component with custom styling and click handler.
 * @param props - Button component props
 * @param props.label - Button text
 * @param props.onClick - Click event handler
 * @param props.disabled - Optional disabled state
 * @returns JSX.Element - Rendered button
 * @example
 * <ActionButton label="Click me" onClick={() => alert('clicked')} />
 */
interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ActionButton({ label, onClick, disabled = false }: ActionButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
```

### Error Handling: ErrorBoundary & useErrorBoundary Hook
```tsx
import { Component, ReactNode } from 'react';

/**
 * ErrorBoundary class component for catching rendering errors.
 * @param children - Child components to wrap
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return <p>Error occurred</p>;
    return this.props.children;
  }
}

// React 19: useErrorBoundary hook (client component)
import { useErrorBoundary } from 'react';
export function SafeComponent() {
  const { resetBoundary } = useErrorBoundary();
  return <button onClick={resetBoundary}>Reset</button>;
}
```

### Advanced: Custom Hook with Generics & Memoization
```tsx
import { useState, useCallback, useMemo } from 'react';

/**
 * Custom hook for managing form state with validation.
 * @template T - Form data type
 * @param initialValue - Initial form state
 * @param onSubmit - Form submission callback
 * @returns [formState, handlers, isValid]
 * @example
 * const [form, { setValue }, isValid] = useForm({ name: '' }, handleSubmit);
 */
function useForm<T extends Record<string, any>>(
  initialValue: T,
  onSubmit: (data: T) => Promise<void>
) {
  const [formState, setFormState] = useState(initialValue);
  const [errors, setErrors] = useState<Partial<T>>({});

  const setValue = useCallback((key: keyof T, value: T[keyof T]) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  return [formState, { setValue, setErrors }, isValid] as const;
}
```

## Comment Template (JSDoc/TSDoc)

### Component
```tsx
/**
 * Displays a list of items with optional filtering.
 * @param props - Component props
 * @param props.items - Array of items to display
 * @param props.onSelect - Callback when item is selected
 * @returns JSX.Element - Rendered list component
 * @example
 * <ItemList items={data} onSelect={handleSelect} />
 */
```

### Hook
```tsx
/**
 * Custom hook for managing toggle state.
 * @param initialValue - Initial toggle state
 * @returns [state, toggle, reset] - Current state, toggle function, and reset function
 * @example
 * const [isOpen, toggle] = useToggle(false);
 */
```

### Utility
```tsx
/**
 * Validates email format.
 * @param email - Email string to validate
 * @returns boolean - True if valid email format
 * @throws Error if email is null/undefined
 * @example
 * const valid = isValidEmail('user@example.com');
 */
```

## Lint Rules

Run before commit:
- `npx eslint {file} --ext .ts,.tsx` — Check react-hooks/rules-of-hooks (error), react-hooks/exhaustive-deps (warn)
- `npx tsc --noEmit` — Type check all files
- `npx prettier --write {file}` — Format code

Config files: `.eslintrc.json`, `tsconfig.json`, `.prettierrc`

Critical rules:
- `react-hooks/rules-of-hooks`: Error — hooks must be in function body
- `react-hooks/exhaustive-deps`: Warn — useEffect dependencies must be complete

## Security Checklist

- **XSS via dangerouslySetInnerHTML**: Never with user input; use DOMPurify if HTML unavoidable
- **Prototype Pollution**: Validate API responses before spreading; never `{...userInput}`
- **npm Supply Chain**: Run `npm audit`, use lock files, review dependencies
- **Client-Side Token Storage**: Never store auth tokens in Redux/Context; use HTTP-only cookies
- **Open Redirect**: Validate URLs; block `javascript:` and `data:` schemes; use URL() constructor

## Anti-patterns (Wrong → Correct)

**1. Prop Drilling** → Use Context or state management library
```tsx
// WRONG: Drilling through many components
<ComponentA user={user}><ComponentB user={user}>...</ComponentB></ComponentA>

// CORRECT: Use Context
const UserContext = createContext<User | null>(null);
<UserContext.Provider value={user}><ComponentB /></UserContext.Provider>
```

**2. useEffect for Derived State** → Use useMemo
```tsx
// WRONG: Recalculate on every render
const [fullName, setFullName] = useState('');
useEffect(() => setFullName(`${first} ${last}`), [first, last]);

// CORRECT: Memoize derived value
const fullName = useMemo(() => `${first} ${last}`, [first, last]);
```

**3. Inline Components** → Extract to named functions
```tsx
// WRONG: Defined inside render, recreated each render
function Parent() { return <div><Child /></div>; }
const Child = () => <span>test</span>;

// CORRECT: Named component outside parent
const Child = () => <span>test</span>;
function Parent() { return <div><Child /></div>; }
```

**4. Index as Key** → Use stable unique IDs
```tsx
// WRONG: Index changes with reordering
{items.map((item, idx) => <Item key={idx} />)}

// CORRECT: Use unique identifier
{items.map((item) => <Item key={item.id} />)}
```

**5. Direct State Mutation** → Use immutable updates
```tsx
// WRONG: Mutates state directly
const copy = state;
copy.name = 'new';
setState(copy);

// CORRECT: Create new object
setState({ ...state, name: 'new' });
```

## Output Templates

When implementing React features, provide:
1. Component file with TypeScript types
2. Test file if non-trivial logic
3. Brief explanation of key decisions

## Knowledge Reference

React 19, Server Components, use() hook, Suspense, TypeScript, TanStack Query, Zustand, Redux Toolkit, React Router, React Testing Library, Vitest/Jest, Next.js App Router, accessibility (WCAG)
