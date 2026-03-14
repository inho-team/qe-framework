# QE State Management Specification

## State Storage Structure

```
.qe/state/
├── {mode}-state.json              ← Legacy (when no session is specified)
└── sessions/
    └── {sessionId}/
        └── {mode}-state.json      ← Session-isolated
```

## State File Format

```json
{
  "active": true,
  "started_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "session_id": "session UUID",
  "reinforcement_count": 0,
  "max_reinforcements": 20,
  "original_prompt": "original user request"
}
```

## Core Rules

### Atomic Write
- Write to a temp file first, then replace via rename
- Prevents file corruption from partial writes

### Session Isolation
- If sessionId is present, store under `sessions/{sessionId}/`
- If no sessionId, use the legacy path
- On read, fall back in order: session path → legacy path

### Staleness Guard
- State older than 2 hours (7,200,000 ms) is treated as inactive
- Prevents zombie states from blocking new sessions

### Reinforcement Limit
- Each mode has a max_reinforcements setting (default 20)
- When reinforcement_count reaches max in the Stop hook, blocking is released
- Prevents infinite loops

## Available Modes

| Mode | Description | Stop Blocking |
|------|-------------|---------------|
| qrun-task | Task execution in progress | Yes |
| qrefresh | Analysis refresh in progress | Yes |
| qarchive | Archiving in progress | Yes |

## API

```javascript
import { readState, writeState, clearState, listActiveModes } from './lib/state.mjs';

// Read
const state = readState(cwd, 'qrun-task', sessionId);

// Write
writeState(cwd, 'qrun-task', { original_prompt: '...' }, sessionId);

// Delete
clearState(cwd, 'qrun-task', sessionId);

// List active modes
const modes = listActiveModes(cwd, sessionId);
```
