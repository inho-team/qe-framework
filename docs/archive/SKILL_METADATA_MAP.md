# Skill Metadata Mapping

This map defines the standardized `invocation_trigger` and `recommendedModel` for skills identified as non-compliant in the audit.

## Category Mapping

| Category | Path Pattern | Invocation Trigger | Recommended Model |
|----------|--------------|-------------------|-------------------|
| **Core** | `skills/Q*` (Core) | *See specific triggers already implemented* | haiku (structural) / sonnet (logic) |
| **Framework Management** | `skills/[QM]*` | "When framework initialization, maintenance, or audit is required." | haiku |
| **Coding Experts** | `skills/coding-experts/**/*` | "When specialized [language/framework] best practices or standard code patterns are needed." | haiku |
| **Project Management** | `skills/Qpm-*` | "When product discovery, requirements analysis, or strategic planning is required." | sonnet |
| **Writing & Docs** | `skills/Qwriting-*`, `skills/Qdoc-*` | "When drafting, refining, or converting technical documentation." | haiku |
| **Academic** | `skills/Qgrad-*` | "When drafting or reviewing academic papers and research materials." | sonnet |
| **Design & Frontend** | `skills/Qfrontend-*`, `skills/Qvisual-*` | "When designing UI/UX components or performing visual quality assurance." | sonnet |

## Priority One-Offs (High-Usage)

| Skill | Invocation Trigger | Recommended Model |
|-------|-------------------|-------------------|
| `Qgenerate-spec` | "When a new project, task, or bug fix spec needs to be defined." | haiku (draft) / sonnet (logic) |
| `Qexecute` | "When a TASK_REQUEST or checklist needs implementation or verification." | sonnet |
| `Qexecute -verify` | "When code has been modified and needs a quality loop (test-review-fix)." | sonnet |
| `Qcommit` | "When changes are ready to be staged and committed to git." | haiku |
| `Qcompact` | "When the context window is full or under pressure (Orange/Red zone)." | haiku |
| `Qrefresh` | "When project analysis files need to be re-synchronized with current code." | haiku |
| `Qarchive` | "When a task is completed and needs to be moved to permanent storage." | haiku |

## Model Selection Logic
- **Haiku**: Structural validation, text transformation, archiving, metadata updates.
- **Sonnet**: Code implementation, complex reasoning, strategic planning, quality review.
- **Opus**: Final architectural judgment, high-stakes research synthesis.
