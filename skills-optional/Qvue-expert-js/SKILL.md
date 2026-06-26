---
name: Qvue-expert-js
description: Creates Vue 3 components, builds vanilla JS composables, configures Vite projects, and sets up routing and state management using JavaScript only — no TypeScript. Generates JSDoc-typed code with @typedef, @param, and @returns annotations for full type coverage without a TS compiler. Use when building Vue 3 applications with JavaScript only (no TypeScript), when projects require JSDoc-based type hints, when migrating from Vue 2 Options API to Composition API in JS, or when teams prefer vanilla JavaScript, .mjs modules, or need quick prototypes without TypeScript setup.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: frontend
triggers: Vue JavaScript, Vue without TypeScript, Vue JSDoc, Vue JS only, Vue vanilla JavaScript, .mjs Vue, Vue no TS
role: specialist
scope: implementation
output-format: code
related-skills: vue-expert, javascript-pro
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Vue Expert (JavaScript)

Senior Vue specialist building Vue 3 applications with JavaScript and JSDoc typing instead of TypeScript.

## Core Workflow

1. **Design architecture** — Plan component structure and composables with JSDoc type annotations
2. **Implement** — Build with `<script setup>` (no `lang="ts"`), `.mjs` modules where needed
3. **Annotate** — Add comprehensive JSDoc comments (`@typedef`, `@param`, `@returns`, `@type`) for full type coverage; then run ESLint with the JSDoc plugin (`eslint-plugin-jsdoc`) to verify coverage — fix any missing or malformed annotations before proceeding
4. **Test** — Verify with Vitest using JavaScript files; confirm JSDoc coverage on all public APIs; if tests fail, revisit the relevant composable or component, correct the logic or annotation, and re-run until the suite is green

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| JSDoc Typing | `references/jsdoc-typing.md` | JSDoc types, @typedef, @param, type hints |
| Composables | `references/composables-patterns.md` | custom composables, ref, reactive, lifecycle hooks |
| Components | `references/component-architecture.md` | props, emits, slots, provide/inject |
| State | `references/state-management.md` | Pinia, stores, reactive state |
| Testing | `references/testing-patterns.md` | Vitest, component testing, mocking |

**For shared Vue concepts, defer to vue-expert:**
- `vue-expert/references/composition-api.md` - Core reactivity patterns
- `vue-expert/references/components.md` - Props, emits, slots
- `vue-expert/references/state-management.md` - Pinia stores

## Code Patterns

**Basic: Component with JSDoc-typed props and emits**
```vue
<script setup>
/**
 * @typedef {Object} UserCardProps
 * @property {string} name - Display name
 * @property {number} age - User's age
 */
const props = defineProps({ name: { type: String, required: true }, age: { type: Number, required: true } })
const emit = defineEmits(['select'])

/** @param {string} id */
function handleSelect(id) { emit('select', id) }
</script>
<template><div @click="handleSelect(props.name)">{{ props.name }} ({{ props.age }})</div></template>
```

**Error Handling: Composable with error state**
```js
import { ref } from 'vue'
/**
 * @typedef {Object} AsyncState
 * @property {import('vue').Ref<?any>} data
 * @property {import('vue').Ref<?Error>} error
 * @property {() => Promise<void>} fetch
 */
export function useAsync(url) {
  const data = ref(null), error = ref(null)
  async function fetch() {
    try { data.value = await (await window.fetch(url)).json() } 
    catch (e) { error.value = e }
  }
  return { data, error, fetch }
}
```

**Advanced: Renderless component pattern**
```vue
<script setup>
const props = defineProps({ items: Array, onSelect: Function })
const selected = ref(null)
</script>
<template>
  <slot :items="items" :selected="selected" :select="(item) => { selected = item; props.onSelect?.(item) }" />
</template>
```

## Comment Template

All public functions must use JSDoc with `@type` annotations:
```js
/**
 * Brief description.
 * @param {string} name - Parameter description
 * @param {number} [count=1] - Optional parameter
 * @returns {Promise<Object>} Returns description
 * @throws {Error} When condition occurs
 */
export function myFunction(name, count = 1) { ... }
```

## Lint Rules

- **ESLint**: `eslint` with `parserOptions.ecmaVersion: 2022`
- **Vue plugin**: `eslint-plugin-vue` with `vue/multi-word-component-names`, `vue/no-unused-vars`
- **JSDoc plugin**: `eslint-plugin-jsdoc` with `requireParamType: true`, `requireReturnType: true`
- **Formatter**: `prettier` with `semi: false`, `singleQuote: true`
- **Check**: Run `eslint . && eslint-plugin-jsdoc --check` before commit

## Security Checklist

1. **Never use `v-html`** — Parse user input; use `v-text` or text content
2. **CSRF tokens** — Include in headers for POST/PUT/DELETE; store in memory, not localStorage
3. **Dependency audit** — Run `npm audit` weekly; pin versions in lockfile
4. **Environment variables** — Use `.env.local` for secrets; never commit API keys
5. **Auth token handling** — Store tokens in httpOnly cookies or memory; clear on logout
6. **XSS prevention** — Sanitize external URLs before `href`; use `DOMPurify` if rendering HTML

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `const userData = {}`; no JSDoc | `/** @type {import('./types').User} */ const userData = {}` |
| Options API with `data()`, `methods` | `<script setup>` + `ref()`, functions |
| `el.addEventListener('click', ...)` in Vue | `@click="handler"` binding |
| Global event bus for state | Pinia store or provide/inject |
| `props.name = 'new'` mutation | `emit('update:name', 'new')` |

## Constraints

### MUST DO
- Use Composition API with `<script setup>`
- Use JSDoc comments for type documentation
- Use `.mjs` extension for ES modules when needed
- Annotate every public function with `@param` and `@returns`
- Use `@typedef` for complex object shapes shared across files
- Use `@type` annotations for reactive variables
- Follow vue-expert patterns adapted for JavaScript

### MUST NOT DO
- Use TypeScript syntax (no `<script setup lang="ts">`)
- Use `.ts` file extensions
- Skip JSDoc types for public APIs
- Use CommonJS `require()` in Vue files
- Ignore type safety entirely
- Mix TypeScript files with JavaScript in the same component

## Output Templates

When implementing Vue features in JavaScript:
1. Component file with `<script setup>` (no lang attribute) and JSDoc-typed props/emits
2. `@typedef` definitions for complex prop or state shapes
3. Composable with `@param` and `@returns` annotations
4. Brief note on type coverage

## Knowledge Reference

Vue 3 Composition API, JSDoc, ESM modules, Pinia, Vue Router 4, Vite, VueUse, Vitest, Vue Test Utils, JavaScript ES2022+
