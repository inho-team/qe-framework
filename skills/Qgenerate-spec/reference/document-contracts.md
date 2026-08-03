# Qgenerate-spec Document Contracts

## Templates and frontmatter

Use the shipped TASK_REQUEST and VERIFY_CHECKLIST templates. Keep the H1 first,
then fill the `qe-doc-frontmatter` block with kind, active plan, phase, date, and
`pending` status. Task and checklist share one collision-checked eight-character
hex UUID. Match the user's language in those two artifacts.

## TASK_REQUEST

Separate business intent from implementation. Each checklist item is atomic,
independently verifiable, dependency-tagged where needed, and names an output
path. Record role ownership and AI assumptions. Every code task includes the
complete Code Risk Register and a rollback strategy.

## VERIFY_CHECKLIST

Every criterion is yes/no. Code checks cover existing tests, OWASP risk,
worst-case failure, data/security/concurrency assessment, unverified assumptions,
residual risk, and evidence or defer rationale for high-risk findings. Docs
checks cover links, terminology, and formatting. Completion includes TASK_LOG.

## Contract candidates

Only the exact `<!-- contract-candidates: auto -->` marker enables extraction.
Use `extractCandidates()` and write drafts under `.qe/contracts/pending/` from
the contract template. Never promote directly to `active/`; explicit human
review and `qe-contract approve` own promotion. Existing pending names are
preserved and reported.

## Handoff

Generate Only reports which spec documents exist and which deliverables do not.
Generate & Execute chains internally. User-visible handoff uses the active
adapter prefix and never asks the user to orchestrate internal Plan/Spec/Execute
stages manually.
