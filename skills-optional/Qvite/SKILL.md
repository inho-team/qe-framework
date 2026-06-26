---
name: Qvite
description: Vite build tool configuration, plugin API, SSR, and Vite 8 Rolldown migration. Use when working with Vite projects, vite.config.ts, Vite plugins, or building libraries/SSR apps with Vite.
metadata: 
author: Anthony Fu
version: 2026.1.31
source: "Generated from https://github.com/vitejs/vite, scripts at https://github.com/antfu/skills"
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Vite

> Based on Vite 8 beta (Rolldown-powered). Vite 8 uses Rolldown bundler and Oxc transformer.

Vite is a next-generation frontend build tool with fast dev server (native ESM + HMR) and optimized production builds.

## Preferences

- Use TypeScript: prefer `vite.config.ts`
- Always use ESM, avoid CommonJS

## Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Configuration | `vite.config.ts`, `defineConfig`, conditional configs, `loadEnv` | [core-config](references/core-config.md) |
| Features | `import.meta.glob`, asset queries (`?raw`, `?url`), `import.meta.env`, HMR API | [core-features](references/core-features.md) |
| Plugin API | Vite-specific hooks, virtual modules, plugin ordering | [core-plugin-api](references/core-plugin-api.md) |

## Build & SSR

| Topic | Description | Reference |
|-------|-------------|-----------|
| Build & SSR | Library mode, SSR middleware mode, `ssrLoadModule`, JavaScript API | [build-and-ssr](references/build-and-ssr.md) |

## Advanced

| Topic | Description | Reference |
|-------|-------------|-----------|
| Environment API | Vite 6+ multi-environment support, custom runtimes | [environment-api](references/environment-api.md) |
| Rolldown Migration | Vite 8 changes: Rolldown bundler, Oxc transformer, config migration | [rolldown-migration](references/rolldown-migration.md) |

## Code Patterns

### Basic Config with Plugins
```ts
/**
 * @description Standard Vite config with Vue + common plugins
 * @param env - Environment variables from loadEnv
 * @returns {import('vite').UserConfig} Vite configuration object
 */
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    resolve: { alias: { '@': '/src' } },
    server: { port: 3000 },
    build: { target: 'esnext', outDir: 'dist' },
  }
})
```

### Custom Plugin with Error Handling
```ts
/**
 * @description Virtual module plugin with error boundary
 */
function virtualModulePlugin() {
  const moduleId = 'virtual-module'
  const resolvedId = '\0' + moduleId
  
  return {
    name: 'virtual-module',
    resolveId(id) { return id === moduleId ? resolvedId : null },
    load(id) { 
      try {
        if (id === resolvedId) return `export const value = 'data'`
      } catch (e) { this.error(`Failed to load virtual module: ${e.message}`) }
    },
    handleHotUpdate({ file }) { if (file.includes('virtual')) console.log(`Updated: ${file}`) },
  }
}
```

### Advanced SSR Config
```ts
export default defineConfig({
  ssr: { 
    target: 'node',
    noExternal: ['vue-router'],
  },
  build: { 
    ssr: 'src/entry-server.ts',
    ssrManifest: true,
  },
  define: {
    __SSR__: true,
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
  },
})
```

## Comment Template

Use JSDoc for all Vite config exports and plugin functions:
```ts
/**
 * @description What this config/plugin does
 * @param {Object} options - Configuration options
 * @param {string} options.name - Plugin name
 * @returns {import('vite').Plugin | import('vite').UserConfig}
 */
```

## Lint Rules

**Required checks** (run in CI/pre-commit):
- `eslint --ext .ts,.tsx,.js,.jsx src/`
- `tsc --noEmit` (TypeScript verification)
- `prettier --check .`

Vite-specific rules:
- No `require()` or `module.exports` (ESM only)
- No glob patterns in dynamic imports without query (use `import.meta.glob`)
- Environment variables must be accessed via `import.meta.env`

## Security Checklist

1. **Environment Variables**: Only expose `VITE_*` prefix; others require explicit `envPrefix` in config
2. **Dependency Supply Chain**: Audit `package-lock.json`; use `npm audit` regularly
3. **CSP Headers**: Set in `vite.config.ts` via server middleware or SSR template
4. **Source Maps**: Disable in production build (`sourcemap: false` in build config)
5. **CORS Config**: Strict `server.cors` and `server.proxy` rules; avoid `{ origin: '*' }`
6. **API URLs**: Use `import.meta.env.VITE_API_URL`, never hardcode in code

## Anti-patterns

| Wrong ❌ | Correct ✅ | Why |
|---------|-----------|-----|
| `import * as _ from 'lodash'` | `import { debounce } from 'lodash-es'` | Enable tree-shaking |
| All code in single bundle | Use `rollupOptions.output.manualChunks` | Smaller chunks = faster load |
| `devDependencies` in prod | Conditional imports: `if (process.env.NODE_ENV === 'development')` | Reduce bundle size |
| `const API = 'https://api.prod.com'` | `const API = import.meta.env.VITE_API_URL` | Env config, not code |
| Magic strings in config | `define: { '__VERSION__': JSON.stringify(pkg.version) }` | Single source of truth |
