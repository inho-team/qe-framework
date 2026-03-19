---
name: Qprofile
description: "Analyzes command patterns, writing style, and common expressions to build a user profile. Use for profile update, 프로필 업데이트, learn my style, improve intent recognition, or update preferences."
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qprofile — User Profile Analysis

## Role
A skill that analyzes the user's command patterns and writing style, then saves the results to `.qe/profile/`.
The accumulated profile allows more accurate understanding of user intent and reduces misunderstandings.

## Storage Location
Manages the following files in the `.qe/profile/` directory:

| File | Contents |
|------|----------|
| `command-patterns.md` | Frequently used command patterns, frequency, and last-used date |
| `writing-style.md` | Writing style characteristics (abbreviations, formal/informal tone, frequently used words) |
| `language.md` | User language settings (primary language, response language, internal processing language) |
| `preferences.md` | Preferred response style and code style |
| `corrections.md` | History of user corrections (learning misunderstanding patterns) |

## Analysis Targets

### Command Patterns
- Rankings of frequently invoked skills/agents
- Command abbreviation patterns (e.g., "commit this" → `/Qcommit`, "make a spec" → `/Qgenerate-spec`)
- Usage patterns by time of day

### Writing Style Analysis
- Formal vs. informal tone
- Abbreviation/shorthand dictionary (e.g., slang → standard form)
- Frequently used instruction expressions (e.g., "please do", "let's do", shorthand)
- Negation patterns (e.g., "no", "not that", "again")

### Correction History
- Records cases where the user corrects with "No, that's not what I meant"
- Identifies which commands caused misunderstandings and turns them into patterns
- Prevents repeated misunderstandings

## How It Works

### Automatic Collection (Background)
- On every skill/agent execution, Eprofile-collector briefly records the user's command
- When a correction occurs, it is automatically added to `corrections.md`

### Manual Execution (`/Qprofile`)
- Displays a summary of the profile accumulated so far
- Users can directly add or modify preferences
- Delegates to Eprofile-collector to reflect the latest collected data
- Qalias integration: automatically suggests alias candidates from frequently used expressions

## Qalias Integration
- Detects when the user repeatedly refers to a specific path/command with similar expressions
- Suggests registering an alias in Qalias
- Example: "analysis-folder" used 3+ times → suggest alias `analysis-folder → .qe/analysis/`

## Will
- Analyze and record user command patterns
- Learn writing style and abbreviations
- Accumulate correction history
- Suggest alias candidates for Qalias
- Manage files in .qe/profile/

## Will Not
- Store sensitive personal information
- Transmit the profile externally without user consent
- Make arbitrary judgments based on the profile (use only as reference material)
