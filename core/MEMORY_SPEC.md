# QE Project Memory Specification

Project Memory is the single persistent, project-scoped context store injected
at SessionStart and available to the on-demand context loader.

## Canonical storage

- Path: `.qe/project-memory.json`
- Runtime: `hooks/scripts/lib/project-memory.mjs`
- Budget: 2KB of formatted context, as defined by `core/CONTEXT_BUDGET.md`

```json
{
  "version": 1,
  "entries": [{
    "id": "mem_12ab34cd",
    "type": "convention",
    "content": "Use the Gradle Wrapper",
    "priority": "permanent",
    "createdAt": "2026-03-14T10:30:00.000Z",
    "ttl": null,
    "expiresAt": null,
    "source": "agent",
    "tags": ["build"]
  }]
}
```

Priorities are `permanent`, `high`, `normal`, and `low`; finite priorities use
30-day, 7-day, and 1-day TTLs respectively. Expired entries are pruned at
SessionStart. Both SessionStart and the on-demand loader use
`formatMemoryContext()` from the same runtime module.

## Legacy compatibility

The former `.qe/memory/project-memory.json` notes/directives shape is read-only
compatibility input. Legacy directives map to permanent entries and notes map to
normal entries. The runtime never deletes the legacy file; the next canonical
write persists the merged entries to `.qe/project-memory.json`.

## API

```javascript
import { addMemory, getActiveMemories } from './hooks/scripts/lib/project-memory.mjs';

addMemory(cwd, 'Use the Gradle Wrapper', 'convention', {
  priority: 'permanent',
  source: 'maintainer'
});
getActiveMemories(cwd);
```
