# QA Council — Project Guardrail Scenario Templates

These are **parametrized** templates. Do not hardcode any one project's tenants/roles — ask the user
for the values at scope time (Step 1). Originally distilled from a multitenant SaaS (moimeasy)
design, but kept generic so any project can reuse them.

## Why these are P1 for Explorer
Multitenancy, RBAC, and audit-logging are the failure modes that black-box exploration catches best
and that unit tests miss. Run them first.

## Template variables (fill at scope time)
- `{{TENANT_A}}`, `{{TENANT_B}}` — two isolated tenant accounts (synthetic).
- `{{ROLES}}` — the role tiers (e.g. operator / org-admin / member).
- `{{PROTECTED_RESOURCE}}` — a resource keyed by tenant id.
- `{{AUDITED_ACTION}}` — an action expected to produce an audit-log entry.

## Scenario 1 — Tenant isolation (P1)
```
GIVEN logged in as {{TENANT_A}}
WHEN attempting to read/modify {{PROTECTED_RESOURCE}} belonging to {{TENANT_B}}
     (direct URL, API id swap, exported link)
THEN access is denied (403/empty), no {{TENANT_B}} data leaks in any response
```
Probe vectors: URL id tampering, API `tenant_id` swap, IDOR on detail pages, search/filter leakage,
autocomplete suggestions, error messages echoing other-tenant data.

## Scenario 2 — RBAC per role (P1)
```
FOR each role in {{ROLES}}
  GIVEN logged in as that role
  WHEN accessing each restricted screen/action outside its tier
  THEN UI hides it AND the backend rejects the direct request
```
Probe vectors: hidden-but-reachable routes, disabled buttons bypassed via API, privilege escalation
through stale tokens, role downgrade not revoking active session.

## Scenario 3 — Audit log generation (P2)
```
GIVEN {{AUDITED_ACTION}} is performed
THEN an audit-log entry is created with actor, tenant, action, timestamp
AND the entry is visible only to authorized roles
```
Note: verifying log *contents* may need backend/log access — that crosses the black-box boundary.
Explorer verifies observable effects; deeper checks hand off to Planner/Generator (white-box).

## Hard data rule (FAIL if violated)
- **Never run guardrail scenarios against production or with real PII.** MCP transmits page content
  to the API. Synthetic test data only. This is a Step-1 safety gate, not a suggestion.

## Output
Each scenario yields a verdict: `PASS` / `FAIL` / `INCONCLUSIVE (needs white-box)`, with repro steps
and screenshot for any FAIL. Reporter aggregates these into the guardrail-verdicts section.
