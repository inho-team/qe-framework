---
name: Qtranslate
description: Internally converts user input to English for processing, then translates results back to the user's language. Supports multilingual input/output and also performs grammar correction for English input.
---
> Shared principles: see core/PRINCIPLES.md

# Qtranslate — Multilingual Internal English Processing

## Role
A skill that processes user queries internally in English regardless of the input language, improving quality, and then translates the results back to the user's language.

## Why It Is Needed
- LLMs produce higher accuracy and reasoning quality when processing in English
- Users prefer communicating in their native language
- This skill satisfies both requirements simultaneously

## Processing Flow

```
User input (any language)
    ↓
1. Language detection → reference/update .qe/profile/language.md
    ↓
2. Rewrite to English (non-English) or grammar check (English)
    ↓
3. Internal processing (English)
   - Intermediate progress displayed in the user's language
    ↓
4. Translate results to the user's language and respond
```

## Language Detection Rules

### Automatic Detection
- Detects the language from the user's first message via `prompt-check.mjs` hook
- Records it in `.qe/profile/language.md`
- In subsequent sessions, the saved language setting takes priority

### Language Switch Detection
- If the user starts writing in a different language mid-session, update `language.md`
- Detection signal: 3+ consecutive messages in a different language
- Single foreign-language words in otherwise same-language text are NOT a language switch (code-switching is normal)

### language.md Format
```markdown
# Language Profile

## Settings
- Primary language: ko (Korean)
- Response language: ko (same as user's language)
- Internal processing language: en (always English)

## Detection History
- 2026-03-14: Korean detected
```

## English Rewriting Rules

### For Non-English Input
- Rewrites the user's message in natural English
- Technical terms and proper nouns are kept in their original form
- The rewritten English is not shown to the user (internal processing only)

### For English Input (Grammar Mode)
When a user explicitly invokes `/Qtranslate` with English text:
- Points out grammar errors and suggests improvements
- Rewrites in more natural expressions
- Shows corrections inline: ~~wrong~~ → **correct**
- Does NOT auto-correct silently — show the user what changed and why

When English is the detected primary language (automatic):
- No grammar correction is applied automatically
- session-start.mjs skips Qtranslate context injection for English users (saves tokens)

### Intermediate Status Display
Progress shown to the user during internal processing is in the user's language:
```
[Qtranslate] Analyzing code...
[Qtranslate] Review complete, translating results...
```

## Integration with Other Skills
- When Qtranslate is active, it applies to all skill input/output
- Skill internal logic is processed in English
- Only the final user-facing response is translated

## Supported Languages
- Not limited to specific languages
- Automatically detects and handles the language the user writes in
- Detection supports: Korean, Japanese, Chinese, Russian, Arabic, Thai, Hindi, Vietnamese, French, German, Spanish, Portuguese, Italian, English (default for Latin)

## Qprofile Integration
- Records the user's language in `.qe/profile/language.md`
- Eprofile-collector automatically detects language changes
- Automatically updates when the user switches languages

## Will
- Automatically detect user language
- Non-English input → rewrite to English (internally)
- English input → grammar correction + improvement suggestions (manual invocation only)
- Translate results to the user's language
- Display intermediate progress in the user's language
- Manage .qe/profile/language.md

## Will Not
- Force-expose the rewritten English to the user (only on request)
- Support only specific languages (handles all languages)
- Translate technical terms or proper nouns (keep original form)
- Translate variable names or comments inside code (keep code as-is)
- Auto-correct grammar for English users in normal flow (only on explicit `/Qtranslate` invocation)
