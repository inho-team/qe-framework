---
name: Qvue-best-practices
description: MUST be used for Vue.js tasks. Strongly recommends Composition API with `<script setup>` and TypeScript as the standard approach. Covers Vue 3, SSR, Volar, vue-tsc. Load for any Vue, .vue files, Vue Router, Pinia, or Vite with Vue work. ALWAYS use Composition API unless the project explicitly requires Options API.
license: MIT
metadata: 
author: github.com/vuejs-ai
version: 18.0.0
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Vue Best Practices Workflow

Use this skill as an instruction set. Follow the workflow in order unless the user explicitly asks for a different order.

## Core Principles
- **Keep state predictable:** one source of truth, derive everything else.
- **Make data flow explicit:** Props down, Events up for most cases.
- **Favor small, focused components:** easier to test, reuse, and maintain.
- **Avoid unnecessary re-renders:** use computed properties and watchers wisely.
- **Readability counts:** write clear, self-documenting code.

## 1) Confirm architecture before coding (required)

- Default stack: Vue 3 + Composition API + `<script setup lang="ts">`.
- If the project explicitly uses Options API, load `vue-options-api-best-practices` skill if available.
- If the project explicitly uses JSX, load `vue-jsx-best-practices` skill if available.

### 1.1 Must-read core references (required)

- Before implementing any Vue task, make sure to read and apply these core references:
  - `references/reactivity.md`
  - `references/sfc.md`
  - `references/component-data-flow.md`
  - `references/composables.md`
- Keep these references in active working context for the entire task, not only when a specific issue appears.

### 1.2 Plan component boundaries before coding (required)

Create a brief component map before implementation for any non-trivial feature.

- Define each component's single responsibility in one sentence.
- Keep entry/root and route-level view components as composition surfaces by default.
- Move feature UI and feature logic out of entry/root/view components unless the task is intentionally a tiny single-file demo.
- Define props/emits contracts for each child component in the map.
- Prefer a feature folder layout (`components/<feature>/...`, `composables/use<Feature>.ts`) when adding more than one component.

## 2) Apply essential Vue foundations (required)

These are essential, must-know foundations. Apply all of them in every Vue task using the core references already loaded in section `1.1`.

### Reactivity

- Must-read reference from `1.1`: [reactivity](references/reactivity.md)
- Keep source state minimal (`ref`/`reactive`), derive everything possible with `computed`.
- Use watchers for side effects if needed.
- Avoid recomputing expensive logic in templates.

### SFC structure and template safety

- Must-read reference from `1.1`: [sfc](references/sfc.md)
- Keep SFC sections in this order: `<script>` → `<template>` → `<style>`.
- Keep SFC responsibilities focused; split large components.
- Keep templates declarative; move branching/derivation to script.
- Apply Vue template safety rules (`v-html`, list rendering, conditional rendering choices).

### Keep components focused

Split a component when it has **more than one clear responsibility** (e.g. data orchestration + UI, or multiple independent UI sections).

- Prefer **smaller components + composables** over one “mega component”
- Move **UI sections** into child components (props in, events out).
- Move **state/side effects** into composables (`useXxx()`).

Apply objective split triggers. Split the component if **any** condition is true:

- It owns both orchestration/state and substantial presentational markup for multiple sections.
- It has 3+ distinct UI sections (for example: form, filters, list, footer/status).
- A template block is repeated or could become reusable (item rows, cards, list entries).

Entry/root and route view rule:

- Keep entry/root and route view components thin: app shell/layout, provider wiring, and feature composition.
- Do not place full feature implementations in entry/root/view components when those features contain independent parts.
- For CRUD/list features (todo, table, catalog, inbox), split at least into:
  - feature container component
  - input/form component
  - list (and/or item) component
  - footer/actions or filter/status component
- Allow a single-file implementation only for very small throwaway demos; if chosen, explicitly justify why splitting is unnecessary.

### Component data flow

- Must-read reference from `1.1`: [component-data-flow](references/component-data-flow.md)
- Use props down, events up as the primary model.
- Use `v-model` only for true two-way component contracts.
- Use provide/inject only for deep-tree dependencies or shared context.
- Keep contracts explicit and typed with `defineProps`, `defineEmits`, and `InjectionKey` as needed.

### Composables

- Must-read reference from `1.1`: [composables](references/composables.md)
- Extract logic into composables when it is reused, stateful, or side-effect heavy.
- Keep composable APIs small, typed, and predictable.
- Separate feature logic from presentational components.

## 3) Consider optional features only when requirements call for them

### 3.1 Standard optional features

Do not add these by default. Load the matching reference only when the requirement exists.

- Slots: parent needs to control child content/layout -> [component-slots](references/component-slots.md)
- Fallthrough attributes: wrapper/base components must forward attrs/events safely -> [component-fallthrough-attrs](references/component-fallthrough-attrs.md)
- Built-in component `<KeepAlive>` for stateful view caching -> [component-keep-alive](references/component-keep-alive.md)
- Built-in component `<Teleport>` for overlays/portals -> [component-teleport](references/component-teleport.md)
- Built-in component `<Suspense>` for async subtree fallback boundaries -> [component-suspense](references/component-suspense.md)
- Animation-related features: pick the simplest approach that matches the required motion behavior.
  - Built-in component `<Transition>` for enter/leave effects -> [transition](references/component-transition.md)
  - Built-in component `<TransitionGroup>` for animated list mutations -> [transition-group](references/component-transition-group.md)
  - Class-based animation for non-enter/leave effects -> [animation-class-based-technique](references/animation-class-based-technique.md)
  - State-driven animation for user-input-driven animation -> [animation-state-driven-technique](references/animation-state-driven-technique.md)

### 3.2 Less-common optional features

Use these only when there is explicit product or technical need.

- Directives: behavior is DOM-specific and not a good composable/component fit -> [directives](references/directives.md)
- Async components: heavy/rarely-used UI should be lazy loaded -> [component-async](references/component-async.md)
- Render functions only when templates cannot express the requirement -> [render-functions](references/render-functions.md)
- Plugins when behavior must be installed app-wide -> [plugins](references/plugins.md)
- State management patterns: app-wide shared state crosses feature boundaries -> [state-management](references/state-management.md)

## 4) Run performance optimization after behavior is correct

Performance work is a post-functionality pass. Do not optimize before core behavior is implemented and verified.

- Large list rendering bottlenecks -> [perf-virtualize-large-lists](references/perf-virtualize-large-lists.md)
- Static subtrees re-rendering unnecessarily -> [perf-v-once-v-memo-directives](references/perf-v-once-v-memo-directives.md)
- Over-abstraction in hot list paths -> [perf-avoid-component-abstraction-in-lists](references/perf-avoid-component-abstraction-in-lists.md)
- Expensive updates triggered too often -> [updated-hook-performance](references/updated-hook-performance.md)

## 5) Code Patterns — Vue Optimization with JSDoc

Reference: See `references/reactivity.md`, `references/perf-v-once-v-memo-directives.md`, `references/perf-virtualize-large-lists.md`

### Basic: Computed vs Watch Usage
```typescript
// PATTERN: Prefer computed for derivation; use watch for side effects only
const count = shallowRef(0)

// ✅ Computed: pure derivation, cached
const doubled = computed(() => count.value * 2)

// ✅ Watch: side effects triggered by change
watch(count, (val) => console.log('Count changed to:', val))

// ❌ WRONG: watch for derivation loses caching
const tripled = ref(0)
watch(count, (val) => { tripled.value = val * 3 })
```

### Error Handling: onErrorCaptured Composition
```typescript
// ✅ Wrap composables in error boundary
import { onErrorCaptured } from 'vue'

export function useApiCall() {
  const error = ref(null)
  
  onErrorCaptured((err) => {
    error.value = err.message
    return false // suppress further propagation
  })
  
  return { error }
}
```

### Advanced: v-memo + Virtual Scrolling
```vue
<!-- ✅ PATTERN: v-memo for selection changes + virtual scroll for 1000+ items -->
<template>
  <VirtualScroller :list="items" #default="{ item }">
    <div v-memo="[item.id === selectedId]" :class="{ selected: item.id === selectedId }">
      <ExpensiveComponent :data="item" />
    </div>
  </VirtualScroller>
</template>

<script setup>
// Reference: perf-virtualize-large-lists.md
const selectedId = ref(null)
const items = ref(/* 10000+ items */)
</script>
```

## 6) Comment Template — JSDoc for Vue Composables

```typescript
/**
 * useApiCall - Manage async data fetching with error handling
 * @param {string} url - API endpoint
 * @param {UseApiCallOptions} options - Configuration object
 * @returns {Object} { data, loading, error, refetch }
 * 
 * @example
 * const { data, loading, error } = useApiCall('/api/users', { immediate: true })
 * 
 * @see composables.md for composable organization patterns
 */
export function useApiCall(url, options = {}) {
  // implementation
}
```

## 7) Lint Rules — Quality Tooling

Apply these linters to Vue projects:
- **eslint-plugin-vue**: Essential Vue template/SFC rules. Must-enable: `vue/multi-word-component-names`, `vue/no-v-html-unsafe`, `vue/no-unused-vars`
- **vue-tsc**: Type-check SFCs in strict mode (`strictTemplates: true`)
- **Prettier**: Format .vue files consistently. Add `.vue` to parser config

Run before commit:
```bash
eslint src --ext .vue --fix && vue-tsc --noEmit && prettier --write src
```

## 8) Security Checklist (5+ Critical Items)

- [ ] **v-html XSS**: Never use `v-html` with user input. Sanitize via DOMPurify or server-side HTML escape
- [ ] **Template Injection**: Never use `v-bind` on computed templates. Use `<component :is="dynamicComponentRef" />`
- [ ] **CSRF Protection**: Add CSRF tokens to form submissions. Pinia stores must not expose auth tokens in state
- [ ] **Dependency Audit**: Run `npm audit` weekly. Lock vulnerable transitive deps in `package-lock.json`
- [ ] **Pinia Data Exposure**: Do not store session tokens or secrets in Pinia stores. Use httpOnly cookies instead

## 9) Anti-patterns — Reference & Wrong/Correct Pairs

See full details: `references/component-data-flow.md`, `references/reactivity.md`, `references/composables.md`

| Pattern | WRONG | CORRECT |
|---------|-------|---------|
| **Destructuring reactive()** | `const { count } = reactive({count: 0})` | `const { count } = toRefs(state)` |
| **Watch non-getter** | `watch(state.count, ...)` | `watch(() => state.count, ...)` |
| **Watcher derivation** | `const doubled = ref(0); watch(..., () => { doubled.value = ... })` | `const doubled = computed(...)` |
| **Direct Pinia mutation** | `store.items.push(...)` (no action) | Define action: `store.addItem(item)` |
| **v-html with user data** | `<div v-html="userComment" />` | Use DOMPurify: `v-html="sanitize(userComment)"` |

## 10) Final Self-Check Before Finishing

- Core behavior works and matches requirements.
- All must-read references were read and applied.
- Reactivity model is minimal and predictable.
- SFC structure and template rules are followed.
- Code patterns section applied (computed vs watch, error handling, v-memo + virtualization).
- Components are focused and well-factored, splitting when needed.
- Entry/root and route view components remain composition surfaces unless there is an explicit small-demo exception.
- Linting rules pass (eslint-plugin-vue, vue-tsc, prettier).
- Security checklist items verified (no v-html with user input, CSRF tokens, dependency audit).
- Optional features are used only when requirements demand them.
- Performance changes were applied only after functionality was complete.
