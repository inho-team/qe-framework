# QE Document Conventions

## Scope

This convention applies to newly generated QE execution-layer documents. D-WIKI-02 keeps execution documents on this convention only; it does not migrate them into the wiki. Under D034, Phase 3 adds infrastructure and new-generation paths, while Phase 4 owns bulk migration of legacy documents.

`core/DOC_CONVENTIONS.md` and `.qe/index.md` are excluded from frontmatter application and from self-listing.

## Title-first frontmatter

The first line remains the document H1. The only recognized metadata position is the line immediately after it:

```md
# TASK_REQUEST_deadbeef — Example
<!-- qe-doc-frontmatter
kind: spec
uuid: deadbeef
plan: example-plan
phase: "Phase 3 — Example"
created: "2026-07-25"
status: pending
links:
  - "[[.qe/checklists/pending/VERIFY_CHECKLIST_deadbeef.md]]"
-->
```

This is not a top-of-file `---` YAML block. The extractor recognizes one block only: it starts with this opening marker immediately after the title, consumes through the nearest (non-greedy) `-->`, and ignores marker-looking strings inside fenced code blocks. An opening marker at the recognized position without a closing `-->` is a FAIL, never a grandfathered skip. A marker outside the recognized position is invalid rather than frontmatter.

The YAML body between the markers is parsed with `parseYamlSubset()` from `scripts/lib/skill-frontmatter.mjs`; no line-splitting YAML reader is permitted.

## Fields and generation rules

| Field | Required value | Generation rule |
|---|---|---|
| `kind` | `spec`, `verify`, `audit`, `execution`, `handoff`, or `report` | Fixed generator mapping below. |
| `uuid` | 8 lowercase hexadecimal characters or a legacy identifier | Reuse the task UUID when one exists. |
| `plan` | Plan slug | Use the active plan slug. |
| `phase` | Human-readable phase name | Use the requested/current phase name. |
| `created` | `YYYY-MM-DD` | Use the creation date. |
| `status` | `pending`, `in-progress`, `completed`, or `archived` | Use the document lifecycle state at generation. |
| `links` | List of `[[path]]` values | Paths are repo-relative files only. `#anchor` fragments are not validated. |

Generator mapping: `TASK_REQUEST` → `spec`; `VERIFY_CHECKLIST` → `verify`; `SECURITY_REPORT` and risk-proof → `audit`; task execution output → `execution`; `HANDOFF` → `handoff`; `REMEDIATION` and other reports → `report`. If an output could be both handoff and report, `handoff` wins.

`kind` is disjoint from the code-gate axis. The latter is extracted only from the `<!-- type: ... -->` comment form; it neither reads nor interprets this document `kind` field.

## Derived index and link safety

`.qe/index.md` is derived from current active document directories and is always rebuilt, never appended. It excludes `.qe/.archive/**`. Links must be normalized repo-relative paths: absolute paths, external URLs, parent traversal, and shell interpolation are rejected. Fragments are retained for display but existence validation checks only the file path.

## Legacy boundary

Documents without a `qe-doc-frontmatter` block are opt-in grandfathered until Phase 4. The known wiki convention reference to a missing `wiki-router.mjs` is an [ASSUMED] documentation drift, not an execution authority for this layer.
