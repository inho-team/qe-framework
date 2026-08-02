# Benchmarking QE Framework

This document is **methodology, not results.** QE makes no published numeric performance
claim until it is measured by the procedure below on a real repository. If you see a
specific percentage anywhere in the docs without a dated measurement behind it, treat it
as unverified and open an issue.

## Why no number is baked in

The headline benefit of folder-aware context memory is *loading only the context that
matches your working directory instead of one monolithic `CLAUDE.md`*. The savings are
real but **project-dependent**: they scale with how large your domain rules are and how
cleanly they partition across folders. A flat repo with one tiny `CLAUDE.md` saves
little; a large repo with heavy per-domain rules saves a lot. A single global percentage
would be misleading.

## Metric 1 — Context token savings (the "~60%" claim, measured honestly)

**Goal:** quantify tokens loaded as project context, vanilla vs. folder-aware, for the
*same* working directory.

1. Pick a representative working directory in your repo (e.g. `src/frontend/...`).
2. **Vanilla baseline:** count the tokens of the full `CLAUDE.md` that a vanilla setup
   would load. Use a tokenizer (e.g. `tiktoken` / the Anthropic token-count endpoint),
   not character count.
3. **QE:** count the tokens of `root.md` + every `.qe/context/*.md` whose glob matches
   that directory (the set reported by the context index).
4. **Savings** = `1 - (QE_tokens / vanilla_tokens)`, reported **per working directory**
   with the directory named. Repeat across 3–5 representative directories and report the
   range, not a single rounded figure.

Record results in a dated table here (`date`, `repo`, `directory`, `vanilla_tokens`,
`qe_tokens`, `savings%`). Until that table exists, the docs say only "fewer tokens,
varies by project."

## Metric 2 — Hook overhead

Per-tool-call latency added by the PreToolUse hook. Measure with the hook present vs.
absent (`hook_profile: minimal` reduces but does not remove it) over N tool calls;
report median + p95 ms.

## Metric 3 — Guard suite cost

`time npm run check:all` — the CI gate's wall-clock. Track it so the guard suite stays
fast as guards are added.

## Reporting rules

- Every number carries a **date** and the **environment** it was measured in.
- No extrapolation from one repo to "the framework saves X%."
- Prefer ranges over point estimates.
- A claim with no measurement behind it must be removed or qualified ("varies by project").

> Results tables go below this line as they are produced. (none yet)
