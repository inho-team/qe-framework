# QE Project Memory Specification

## Overview
A persistent knowledge store per project. Survives across sessions and prevents repeated rediscovery.

## Storage Location
`.qe/memory/project-memory.json`

## Data Structure

```json
{
  "notes": [
    {
      "category": "conventions",
      "note": "This project uses Gradle Wrapper",
      "added_at": "2026-03-14T10:30:00Z"
    }
  ],
  "directives": [
    {
      "directive": "Always use testcontainers when running tests",
      "added_at": "2026-03-14T10:30:00Z"
    }
  ]
}
```

## Categories

| Category | Description |
|----------|-------------|
| `conventions` | Project conventions (code style, naming, etc.) |
| `architecture` | Architecture decisions |
| `gotchas` | Warnings, pitfalls |
| `tools` | Build tools, dependency notes |
| `people` | Team members, roles |

## notes vs directives

| Type | Strength | Injection Method |
|------|----------|-----------------|
| **notes** | Informational | Injected as summary at SessionStart |
| **directives** | Must follow | Always injected at SessionStart |

## API

```javascript
import { addNote, addDirective, readMemory } from './lib/memory.mjs';

addNote(cwd, 'conventions', 'Write commit messages in English');
addDirective(cwd, 'Never push directly to the main branch');
```
