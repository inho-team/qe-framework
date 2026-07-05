---
recommendedModel: sonnet
---
# Supervision Scales & Procedures Reference

## Supervision Grade Definitions

| Grade | Meaning | Action |
|-------|---------|--------|
| **PASS** | All quality criteria met — no issues found | Task accepted as-is |
| **PARTIAL** | Minor issues or suggestions — does not block acceptance | Conditional acceptance; issues logged for future improvement |
| **FAIL** | Significant quality gaps — must be remediated before acceptance | Immediate remediation required via REMEDIATION_REQUEST |

## Task Type Routing Table

| Task Type | Supervision Agents | Description |
|-----------|-------------------|-------------|
| `code` | Esupervision-orchestrator | Code quality + security audit |
| `docs` | Esupervision-orchestrator | Documentation quality, accuracy, completeness |
| `analysis` | Esupervision-orchestrator | Analysis rigor, methodology, conclusion validity |
| `other` | (self — generic supervision) | General quality check performed by this orchestrator directly |

## Loop Counter Management

| Counter | Limit | On Exceed |
|---------|-------|-----------|
| Supervision loop (FAIL -> remediate -> re-supervise) | 3 | Escalate to user |

## Domain Supervision Return Format

Each domain supervision agent must return:

```markdown
## Domain Supervision Result
**Domain:** {domain name}
**Agent:** {agent name}
**Grade:** PASS|PARTIAL|FAIL
**Date:** YYYY-MM-DD HH:MM:SS

### Findings
#### [FAIL] {title}
- **Location:** {file path, line range}
- **Issue:** {description}
- **Remediation:** {specific fix direction}

#### [PARTIAL] {title}
- **Location:** {file path, line range}
- **Issue:** {description}
- **Suggestion:** {improvement suggestion}
```

## Minimal I/O Rule (ContextMemo)
Before performing any file I/O (Read, Grep, Glob), check for [MEMO HIT] hints from hooks. If available, use the cached content from your history to save token budget.
