# SIVS Assurance Model

## Decision

SIVS is operated as two non-duplicating quality gates:

- **Verify** proves implementation and specification compliance with executable
  evidence.
- **Supervise** consumes that evidence and makes a risk-based release decision.

## Required evidence

Verify records the checklist result, commands run, outcomes, changed files, and
open findings. Supervise records the release decision, security/business-rule
coverage, residual-risk owner, and any release-blocking gap.

## Risk-based Supervise depth

| Trigger | Required Supervise action |
|---|---|
| Auth, permission, secret, payment, crypto, external exposure | `Esecurity-officer` and trust-boundary review |
| Named business invariant, pricing, entitlement, lifecycle/state transition | Business-rule review against the spec |
| Migration, compatibility, deployment, rollback, operational change | Change-impact and rollback review |
| No trigger and no post-Verify file change | Reuse Verify findings; do not repeat line-by-line review |

## Effectiveness and efficiency metrics

- **completion integrity**: completed tasks with a fully checked active checklist;
- **evidence freshness**: Verify evidence from the current changed-file set;
- **finding closure**: open Verify findings remaining at Supervise (target: 0);
- **rework signal**: Verify/Supervise failures that route back upstream;
- **review duplication**: unchanged files re-reviewed after Verify (target: 0);
- **release-risk coverage**: security/business/rollback triggers with a recorded
  Supervise decision (target: 100%).

Metrics are diagnostic, not automatic success criteria. A lower agent-call count
never overrides missing evidence or an unresolved HIGH/CRITICAL risk.

## External basis

- [NIST DevSecOps reference model](https://pages.nist.gov/nccoe-devsecops/notational-reference-model.html)
  separates test/security-policy verification from release readiness and feedback.
- [GitHub required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
  requires current-commit check success; [required reviews](https://docs.github.com/en/pull-requests/reference/pull-request-reviews)
  are a distinct approval control.
- [OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html)
  recommends diff-based, impact-focused review for routine changes and broader
  review for major/high-risk releases.
- [OWASP Secure by Design](https://owasp.org/www-project-secure-by-design-framework/)
  uses evidence-backed checklists, residual-risk documentation, and escalation
  for high/critical risk.
