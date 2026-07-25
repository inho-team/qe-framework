# ADR-028: Separate Verify Evidence from Supervise Release Decisions

## Status

Accepted

## Context

Verify and Supervise were both described as high-reasoning QA passes. That
invited duplicate line-by-line review while leaving security, business-rule, and
operational release decisions insufficiently explicit.

## Decision

Verify is the executable evidence gate: it proves spec/checklist compliance,
runs tests and static checks, reproduces failures, and records findings.
Supervise is the evidence-consuming release gate: it checks security and
permission boundaries, explicit business invariants and state transitions,
change/rollback/operational impact, and residual-risk ownership. It reopens a
file only if it changed after Verify or a HIGH/CRITICAL risk requires it.

## Alternatives Considered

- Merge the stages: simpler, but mixes objective evidence collection with
  release-risk acceptance and weakens auditability.
- Repeat full code review in Supervise: broader coverage, but wastes expensive
  high-reasoning capacity and duplicates Verify.

## Consequences

- Supervise must consume the Verify findings ledger.
- Security-sensitive work requires `Esecurity-officer` at Supervise.
- Missing evidence for a named business invariant is release-blocking.
- A degraded inline Supervise run cannot report PASS without later delegated
  evidence.
