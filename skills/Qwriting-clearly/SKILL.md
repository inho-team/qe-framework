---
name: Qwriting-clearly
description: Use when writing text that humans will read. 글 다듬기, 문장 개선, make this clearer, edit this writing, improve prose. Applies to documentation, commit messages, error messages, reports, and UI text. Based on Strunk's principles.
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


# Writing Clearly and Concisely

## Overview

Write clearly and with force. This skill covers what to do (Strunk) and what to avoid (AI patterns).

## When to Use This Skill

Use this skill any time you are writing for a human:

- Documentation, README files, technical explanations
- Commit messages, pull request descriptions
- Error messages, UI copy, help text, comments
- Reports, summaries, or any form of explanation
- Proofreading to improve clarity

**If you are writing a sentence a human will read, use this skill.**

## Strategy When Context Is Tight

When context is limited:

1. Draft based on judgment
2. Hand the draft and relevant section files to a subagent
3. Have the subagent proofread and return a revised version

Loading a single section (~1,000–4,500 tokens) instead of full content saves significant context.

## Elements of Style

William Strunk Jr.'s *The Elements of Style* (1918) teaches how to write clearly and cut ruthlessly.

### Rules

**Elementary rules of usage (grammar/punctuation):**

1. Form the possessive singular by adding 's
2. Use a comma after each term in a series except the last
3. Enclose parenthetic expressions between commas
4. Place a comma before a conjunction introducing an independent clause
5. Do not join independent clauses with a comma
6. Do not break sentences in two
7. A participial phrase at the beginning of a sentence must refer to the grammatical subject

**Elementary principles of composition:**

8. Make the paragraph the unit of composition: one topic per paragraph
9. Begin each paragraph with a topic sentence
10. **Use the active voice**
11. **Put statements in positive form**
12. **Use definite, specific, concrete language**
13. **Omit needless words**
14. Avoid a succession of loose sentences
15. Express coordinate ideas in similar form
16. **Keep related words together**
17. In summaries, keep to one tense
18. **Place the emphatic words of a sentence at the end**

### Reference Files

| Section | File | ~Tokens |
|---------|------|---------|
| Grammar, punctuation, comma rules | `02-elementary-rules-of-usage.md` | 2,500 |
| Paragraph structure, active voice, concision | `03-elementary-principles-of-composition.md` | 4,500 |
| Titles, quotations, formatting | `04-a-few-matters-of-form.md` | 1,000 |
| Word choice, common errors | `05-words-and-expressions-commonly-misused.md` | 4,000 |

**For most tasks, `03-elementary-principles-of-composition.md` is sufficient.** It covers active voice, positive statements, specific language, and cutting needless words.

## AI Writing Patterns: What to Avoid

LLMs tend to regress toward statistical averages, producing cliched and bloated prose. Avoid:

- **Inflated words:** pivotal, crucial, vital, testament, enduring legacy
- **Empty "-ing" phrases:** ensuring reliability, showcasing features, highlighting capabilities
- **Promotional adjectives:** groundbreaking, seamless, robust, cutting-edge
- **AI clichés:** delve, leverage, multifaceted, foster, realm, tapestry
- **Formatting abuse:** excessive bullet points, emoji decoration, bold on every other sentence

Don't write grandly — describe concretely what is actually happening.

For deeper research on why these patterns occur, see `signs-of-ai-writing.md` — a guide developed by Wikipedia editors to detect AI-generated submissions, well-documented and field-validated.

## Summary

When writing for humans, load the relevant section from `elements-of-style/` and apply the rules. For most tasks, `03-elementary-principles-of-composition.md` contains the most important material.
