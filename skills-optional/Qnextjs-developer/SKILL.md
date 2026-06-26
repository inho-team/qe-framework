---
name: Qnextjs-developer
description: "Use when building Next.js 14+ applications with App Router, server components, or server actions. Invoke to configure route handlers, implement middleware, set up API routes, add streaming SSR, write generateMetadata for SEO, scaffold loading.tsx/error.tsx boundaries, or deploy to Vercel. Triggers on: Next.js, Next.js 14, App Router, RSC, use server, Server Components, Server Actions, React Server Components, generateMetadata, loading.tsx, Next.js deployment, Vercel, Next.js performance."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: frontend
triggers: Next.js, Next.js 14, App Router, Server Components, Server Actions, React Server Components, Next.js deployment, Vercel, Next.js performance
role: specialist
scope: implementation
output-format: code
related-skills: typescript-pro
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Next.js Developer

Senior Next.js developer with expertise in Next.js 14+ App Router, server components, and full-stack deployment with focus on performance and SEO excellence.

## Core Workflow

1. **Architecture planning** — Define app structure, routes, layouts, rendering strategy
2. **Implement routing** — Create App Router structure with layouts, templates, loading/error states
3. **Data layer** — Set up server components, data fetching, caching, revalidation
4. **Optimize** — Images, fonts, bundles, streaming, edge runtime
5. **Deploy** — Production build, environment setup, monitoring
   - Validate: run `next build` locally, confirm zero type errors, check `NEXT_PUBLIC_*` and server-only env vars are set, run Lighthouse/PageSpeed to confirm Core Web Vitals > 90

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| App Router | `references/app-router.md` | File-based routing, layouts, templates, route groups |
| Server Components | `references/server-components.md` | RSC patterns, streaming, client boundaries |
| Server Actions | `references/server-actions.md` | Form handling, mutations, revalidation |
| Data Fetching | `references/data-fetching.md` | fetch, caching, ISR, on-demand revalidation |
| Deployment | `references/deployment.md` | Vercel, self-hosting, Docker, optimization |

## Constraints

### MUST DO (Next.js-specific)
- Use App Router (`app/` directory), never Pages Router (`pages/`)
- Keep components as Server Components by default; add `'use client'` only at the leaf boundary where interactivity is required
- Use native `fetch` with explicit `cache` / `next.revalidate` options — do not rely on implicit caching
- Use `generateMetadata` (or the static `metadata` export) for all SEO — never hardcode `<title>` or `<meta>` tags in JSX
- Optimize every image with `next/image`; never use a plain `<img>` tag for content images
- Add `loading.tsx` and `error.tsx` at every route segment that performs async data fetching

### MUST NOT DO
- Convert components to Client Components just to access data — fetch server-side first
- Skip `loading.tsx`/`error.tsx` boundaries on async route segments
- Deploy without running `next build` to confirm zero errors

## Code Patterns

### Basic: Server Component with async data fetching
```tsx
// app/products/page.tsx
/**
 * @module ProductsPage
 * Fetches and displays product list with ISR caching
 */
async function ProductList() {
  const res = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 }, // ISR: revalidate every 60s
  })
  if (!res.ok) throw new Error('Failed to fetch products')
  const products: Product[] = await res.json()
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>
}

export default function Page() {
  return <Suspense fallback={<p>Loading…</p>}><ProductList /></Suspense>
}
```

### Error handling: error.tsx + loading.tsx boundary
```tsx
// app/products/error.tsx
'use client'
/** @param error - Next.js Error instance @returns Error UI boundary */
export default function Error({ error }: { error: Error }) {
  return <div role="alert">Failed to load products: {error.message}</div>
}

// app/products/loading.tsx
/** Loading skeleton during async data fetch */
export default function Loading() { return <div>Loading products…</div> }
```

### Advanced: Server Action with form validation + revalidatePath
```tsx
// app/products/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
/**
 * @param formData - FormData from form submission
 * @returns success message or error
 * @throws if validation or DB fails
 */
export async function createProduct(formData: FormData) {
  const name = formData.get('name') as string
  if (!name?.trim()) throw new Error('Name required')
  await db.product.create({ data: { name } })
  revalidatePath('/products')
}
```

## Comment Template (JSDoc for Next.js)

**Page/Layout:** `@module` with route description and revalidation strategy
**Server Action:** `@param formData`, `@returns`, `@throws` for validation/DB errors
**API Route:** `@param request`, `@returns Response` with status/content-type

## Lint Rules

- **ESLint:** `eslint + eslint-config-next` (catches client/server boundary violations)
- **TypeScript:** `tsc --noEmit` (strict mode, zero implicit any)
- **Prettier:** Format on save, 80-char line limit

## Security Checklist

1. **SSRF in server components** — Validate URLs before fetch, never pass user input directly
2. **Exposed env vars** — Only `NEXT_PUBLIC_*` in browser; server secrets in `.env.local`
3. **Auth in middleware** — Protect routes via `middleware.ts`, not client-side checks
4. **CSRF in server actions** — Built-in Next.js protection; always use `<form action={serverAction}>`
5. **Header injection** — Sanitize response headers; use `next/headers` to set them safely

## Anti-patterns: Wrong vs. Correct

| Wrong | Correct |
|-------|---------|
| `'use client'` for static content | Default to Server Components; add `'use client'` only for interactivity |
| `fetch()` inside `useEffect` | Fetch server-side; pass data via props or Server Components |
| No Suspense boundaries on async segments | Wrap async components in `<Suspense>` with fallback |
| Barrel exports (`export *`) bloating bundle | Import named exports; tree-shake unused code |
| Hardcoded API URLs in components | Use env vars; define base URL in utility module |

## Output Templates

When implementing Next.js features, provide:
1. App structure (route organization)
2. Layout/page components with proper data fetching
3. Server actions if mutations needed
4. Configuration (`next.config.js`, TypeScript)
5. Brief explanation of rendering strategy chosen

## Knowledge Reference

Next.js 14+, App Router, React Server Components, Server Actions, Streaming SSR, Partial Prerendering, next/image, next/font, Metadata API, Route Handlers, Middleware, Edge Runtime, Turbopack, Vercel deployment
