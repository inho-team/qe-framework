---
name: Qvue-expert
description: Builds Vue 3 components with Composition API patterns, configures Nuxt 3 SSR/SSG projects, sets up Pinia stores, scaffolds Quasar/Capacitor mobile apps, implements PWA features, and optimises Vite builds. Use when creating Vue 3 applications with Composition API, writing reusable composables, managing state with Pinia, building hybrid mobile apps with Quasar or Capacitor, configuring service workers, or tuning Vite configuration and TypeScript integration.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: frontend
triggers: Vue 3, Composition API, Nuxt, Pinia, Vue composables, reactive, ref, Vue Router, Vite Vue, Quasar, Capacitor, PWA, service worker, Fastify SSR, sourcemap, Vite config, build optimization
role: specialist
scope: implementation
output-format: code
related-skills: typescript-pro, fullstack-guardian
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Vue Expert

Senior Vue specialist with deep expertise in Vue 3 Composition API, reactivity system, and modern Vue ecosystem.

## Core Workflow

1. **Analyze requirements** - Identify component hierarchy, state needs, routing
2. **Design architecture** - Plan composables, stores, component structure
3. **Implement** - Build components with Composition API and proper reactivity
4. **Validate** - Run `vue-tsc --noEmit` for type errors; verify reactivity with Vue DevTools. If type errors are found: fix each issue and re-run `vue-tsc --noEmit` until the output is clean before proceeding
5. **Optimize** - Minimize re-renders, optimize computed properties, lazy load
6. **Test** - Write component tests with Vue Test Utils and Vitest. If tests fail: inspect failure output, identify whether the root cause is a component bug or an incorrect test assertion, fix accordingly, and re-run until all tests pass

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Composition API | `references/composition-api.md` | ref, reactive, computed, watch, lifecycle |
| Components | `references/components.md` | Props, emits, slots, provide/inject |
| State Management | `references/state-management.md` | Pinia stores, actions, getters |
| Nuxt 3 | `references/nuxt.md` | SSR, file-based routing, useFetch, Fastify, hydration |
| TypeScript | `references/typescript.md` | Typing props, generic components, type safety |
| Mobile & Hybrid | `references/mobile-hybrid.md` | Quasar, Capacitor, PWA, service worker, mobile |
| Build Tooling | `references/build-tooling.md` | Vite config, sourcemaps, optimization, bundling |

## Quick Example

Minimal component demonstrating preferred patterns:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ initialCount?: number }>()

const count = ref(props.initialCount ?? 0)
const doubled = computed(() => count.value * 2)

function increment() {
  count.value++
}
</script>

<template>
  <button @click="increment">Count: {{ count }} (doubled: {{ doubled }})</button>
</template>
```

## Constraints

### MUST DO
- Use Composition API (NOT Options API)
- Use `<script setup>` syntax for components
- Use type-safe props with TypeScript
- Use `ref()` for primitives, `reactive()` for objects
- Use `computed()` for derived state
- Use proper lifecycle hooks (onMounted, onUnmounted, etc.)
- Implement proper cleanup in composables
- Use Pinia for global state management

### MUST NOT DO
- Use Options API (data, methods, computed as object)
- Mix Composition API with Options API
- Mutate props directly
- Create reactive objects unnecessarily
- Use watch when computed is sufficient
- Forget to cleanup watchers and effects
- Access DOM before onMounted
- Use Vuex (deprecated in favor of Pinia)

## Output Templates

When implementing Vue features, provide:
1. Component file with `<script setup>` and TypeScript
2. Composable if reusable logic exists
3. Pinia store if global state needed
4. Brief explanation of reactivity decisions

## Code Patterns

### Basic: Component with Props & Emits
```vue
<script setup lang="ts">
/**
 * @component UserCard
 * @prop {Object} user - User profile data
 * @prop {string} user.name - User's display name
 * @prop {string} user.email - User's email address
 * @emits update - Emitted when user data changes
 * @example
 * <UserCard :user="userData" @update="handleUpdate" />
 */
import { computed } from 'vue'

interface User { name: string; email: string }
const props = defineProps<{ user: User }>()
const emit = defineEmits<{ update: [user: User] }>()

const displayName = computed(() => props.user.name.toUpperCase())
</script>
```

### Error Handling: Error Boundary Component
```vue
<script setup lang="ts">
/**
 * @component ErrorBoundary
 * Catches child component errors and displays fallback UI
 * @emits error - Emitted when child component errors
 */
import { onErrorCaptured, ref } from 'vue'

const error = ref<Error | null>(null)

onErrorCaptured((err) => {
  error.value = err as Error
  return false // prevent propagation
})
</script>
```

### Advanced: Composable with TypeScript
```typescript
/**
 * @param {Ref<string>} query - Search query
 * @returns {Object} { results: Ref<Item[]>, loading: Ref<boolean>, error: Ref<string|null> }
 * @example
 * const { results, loading } = useSearch(queryRef)
 */
import { ref, computed, watch } from 'vue'

export function useSearch(query: Ref<string>) {
  const results = ref<Item[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  watch(query, async (val) => {
    if (!val) { results.value = []; return }
    loading.value = true
    try {
      const data = await fetch(`/api/search?q=${val}`).then(r => r.json())
      results.value = data
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  })

  return { results, loading, error }
}
```

## Comment Template

### Component JSDoc
```typescript
/**
 * @component MyComponent
 * @prop {string} title - Component title (required)
 * @prop {boolean} [disabled=false] - Disable interactions
 * @prop {Object} config - Configuration object
 * @emits submit - Emitted with form data on submit
 * @emits cancel - Emitted when user cancels
 * @example
 * <MyComponent title="Settings" @submit="save" />
 */
```

### Composable JSDoc
```typescript
/**
 * useFetch - Fetches data with caching and retry logic
 * @param {string} url - API endpoint
 * @param {FetchOptions} [options] - Fetch configuration
 * @returns {Object} { data, loading, error, refetch }
 * @example
 * const { data, loading } = useFetch('/api/users')
 */
```

### Store JSDoc
```typescript
/**
 * @module userStore - Pinia store for user authentication
 * @state {User|null} user - Current authenticated user
 * @getter {boolean} isLoggedIn - True if user is authenticated
 * @action login(credentials) - Authenticate with email/password
 */
```

## Lint Rules

**ESLint + eslint-plugin-vue:**
- Run: `eslint --fix 'src/**/*.{vue,ts,js}'`
- Config: `.eslintrc.cjs` with `plugin:vue/vue3-recommended`

**Vue Type Checking:**
- Run: `vue-tsc --noEmit` (must pass before commit)

**Formatting:**
- Run: `prettier --write 'src/**/*.vue'`
- Enforce: 2 spaces, single quotes, 80 char line length

## Security Checklist

1. **XSS Prevention**: Never use `v-html` with user input; sanitize with `DOMPurify` if necessary
2. **Template Injection**: Avoid dynamic templates; use components + slots instead
3. **CSRF Protection**: Include CSRF tokens in API POST/PUT/DELETE via interceptors
4. **Dependency Vulnerabilities**: Run `npm audit` weekly; keep Pinia, Vue, Vite updated
5. **Sensitive Data**: Never store auth tokens or passwords in Pinia; use secure httpOnly cookies

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `export default { data() { return { count: 0 } } }` | `const count = ref(0)` in `<script setup>` |
| `watch(() => a + b, () => {...})` for derived state | `const sum = computed(() => a.value + b.value)` |
| `props.user.name = "New"` (mutating props) | Emit event: `emit('update:user', newUser)` |
| `eventBus.emit('update', data)` | Use `provide/inject` or Pinia store |
| `<ul><li v-for="item in list">{{ item }}</li></ul>` on large lists | Add `v-memo="[item.id]"` to optimize re-renders |

## Knowledge Reference

Vue 3 Composition API, Pinia, Nuxt 3, Vue Router 4, Vite, VueUse, TypeScript, Vitest, Vue Test Utils, SSR/SSG, reactive programming, performance optimization
