# MODE_TokenEfficiency — Token Efficiency Mode

## Overview
A mode that automatically switches response style based on context window pressure level.

## Activation Conditions
- Automatic: when context usage reaches 75% or above
- Manual: when the user requests "compressed mode" or "be concise"

## 3-Zone System

### Green (0–75%) — Normal Mode
- Detailed explanations and examples included
- Full code blocks shown
- Alternatives compared

### Yellow (75–85%) — Compressed Mode
- Deliver only the essentials
- Code blocks show only the changed portions
- Explanations limited to 1–2 sentences
- "Notes" sections omitted

### Red (85%+) — Survival Mode
- One-line answers
- Code shown as diff only
- Minimize reading new files
- If task cannot complete, suggest handoff

## Compression Techniques
- Remove repeated explanations
- Do not re-state previous conversation content
- Minimize confirmation questions (execute immediately when obvious)
- Parallelize tool calls

## Deactivation
- When the user requests "detailed" or "verbose mode"
- Auto-reset at the start of a new session
