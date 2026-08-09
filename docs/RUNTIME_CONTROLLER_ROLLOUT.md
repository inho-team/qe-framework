# Runtime Controller rollout readiness

This contract governs local adoption of the Runtime Controller. It does not
authorize a release, deployment, migration, installation change, version bump,
or remote multi-host rollout. Every promotion is fail-closed: missing evidence
has the same effect as failing evidence.

## Stage contract

| Stage | Entry evidence | Observe | Promote | Abort | Local rollback | Retained evidence |
|---|---|---|---|---|---|---|
| Shadow | `node scripts/check-runtime-controller.mjs` passes; Controller audit and lease heads validate | Run the existing path and Controller path against isolated local fixtures; compare terminal action, audit continuity, replay result, cap result, and `processMetrics()` digest | All comparisons agree, no integrity error occurs, and `node scripts/check-all.mjs` passes | Any checker failure, audit/hash/revision gap, lease mismatch, unexpected mutation, or metrics corruption | Stop invoking the Controller path for new local fixtures; keep the old path authoritative; do not delete Controller rows | Command, exit status, output hash, fixture cardinality, Controller audit/lease head, metrics digest, operator, timestamp |
| Canary | Completed shadow evidence; a named local fixture cohort and observation window; rollback owner | For every canary fixture record completion/rejection code, replay behavior, remediation counters, lease terminal, audit head, and metrics digest | Zero unexplained divergence; no bypass success; checker and full guards pass at the end of the window; scale qualification below is recorded | Any unauthorized success, integrity failure, repeated non-determinism, checker regression, or missing rollback owner | Stop adding canary fixtures and route new work through the previous authoritative path; preserve canary DB and evidence read-only for diagnosis | Shadow bundle plus cohort definition, per-fixture results, divergence log, start/end time, rollback decision |
| Canary → broad scale gate | Completed canary evidence and reproducible 0/100/1,000/10,000 logical-task fixtures | Measure cold/warm read-query count, p50/p95 latency, cardinality growth, report digest, and observation status | All four rows are complete and PASS against a reviewed threshold with named owner and review date | Any missing row/counter/owner/reviewer, unknown fixture provenance, or threshold breach | Keep adoption at canary; preserve fixtures and measurements; revise the qualification plan without rewriting prior results | Four scale rows, fixture digest, machine/runtime facts, reviewer, threshold, owner, review date |
| Broad local adoption | Completed canary evidence; reviewed scale threshold and owner; all scale rows PASS; explicit local decision record | Continue checker and audit-integrity sampling; track query-count and latency against the reviewed threshold | N/A: this is the highest local stage and is not deployment approval | Any threshold breach, integrity failure, unauthorized success, or unavailable evidence | Return to canary scope for new local work; retain completed audit and metrics evidence; never purge or rewrite history as rollback | Canary bundle, reviewed threshold/owner, scale report, adoption decision, subsequent samples and rollback record |

The exact validation entry points are:

```sh
node scripts/check-runtime-controller.mjs
node scripts/check-all.mjs
```

Both commands must exit successfully. The Runtime Controller checker proves the
bounded local SIVS chain; `check-all` proves repository-wide guard compatibility.
Neither command qualifies a remote host or deployment environment.

## Metrics scale qualification

`processMetrics()` now reads the seven Controller/SIVS metrics tables once each
inside one transaction. A fingerprint-bound recorder combines SQLite authorizer
table fingerprints with actual statement execution events; reader-emitted
semantic tokens are not accepted as query-count evidence.

Use production-compatible, isolated local stores containing exactly 0, 100,
1,000, and 10,000 unique bound logical tasks. For each cardinality run one cold read in
a new process/store connection, then enough warm reads in the same process to
report stable percentiles. Every row must record:

- fixture generator version or digest and logical-task cardinality;
- cold total read-query count and elapsed latency;
- warm sample count, total read-query count per sample, and p50/p95 latency;
- report digest and whether all rows were fully observed or explicitly unknown;
- query-count and p95 growth versus the preceding cardinality;
- machine/runtime facts, operator, timestamp, reviewer, threshold, and owner.

Do not infer query count from latency. A missing row, execution fingerprint,
oracle, owner, or review date is `NOT_QUALIFIED`; a threshold breach is `FAIL`.

### Measured qualification — 2026-08-08

Command: `node scripts/benchmark-process-metrics.mjs`

Runtime: Node v26.7.0, darwin arm64, Apple M3 Pro (12 CPUs), 38,654,705,664
bytes total memory. Every cardinality used one cold sample, two unmeasured
warmups, and 20 measured warm samples in one persistent child. Percentiles use
nearest rank. RSS is sampled in bytes from the post-open baseline.

| Logical tasks | Executed reads | Cold ms | Warm p50 ms | Warm p95 ms | RSS delta bytes | Result |
|---:|---:|---:|---:|---:|---:|---|
| 0 | 7 | 0.572 | 0.093 | 0.125 | 1,835,008 | PASS |
| 100 | 7 | 4.842 | 2.071 | 2.258 | 16,220,160 | PASS |
| 1,000 | 7 | 32.167 | 21.721 | 25.047 | 133,726,208 | PASS |
| 10,000 | 7 | 276.417 | 241.331 | 247.042 | 384,401,408 | PASS |

The exact fingerprint at every size is one executed SELECT for each of state,
audit, binding, verification, supervision, remediation-current, and
remediation-event. Independent per-table/process counts and logical-task
`COUNT(DISTINCT ...)` matched the reports. The qualification digest is
`5e356012da6f3af74fa0ef8708edeccd3fbf52aa8c8252802d8178f4c2ed9d39`.
The recorded p95 growth factors versus the preceding row are 18.0110,
11.0920, and 9.8631; executed-read growth is exactly 1.0 at every step.

Predeclared budgets: exactly 7 executions, 10,000-task warm p95 no greater than
30,000 ms, and RSS delta no greater than 536,870,912 bytes. Owner: QE Runtime
Controller maintainers. Review date: 2026-11-08. Result: `QUALIFIED` for broad
local adoption; this is not deployment or release authorization.

## Abort and evidence handling

An abort changes only which path receives new local work. It must not delete,
rewrite, backfill, or migrate Controller, SIVS, lease, audit, proof, or metrics
history. Record the trigger, affected stage, last valid audit/lease heads, checker
outputs, metrics report, decision owner, and next diagnostic action. Preserve the
evidence bundle until the owning project retention policy expires it.

Remote multi-host coordination, production traffic, deployment permissions,
release packaging, alert routing, and service-level thresholds belong to the
deployment owner. They require a separate environment-specific plan and cannot
inherit PASS from this local contract.

## Broad local adoption decision — 2026-08-08

Command: `node scripts/qualify-runtime-controller-adoption.mjs`

Decision: `ADOPTED_ELIGIBLE_LANES`. This authorizes local Runtime Controller use
only for explicitly durable, long-running, or high-risk lanes. Ordinary solo,
subagent, wave, and isolated execution remain on the existing task router.

The executed bundle recorded:

- focused adoption unit suite: 8/8 PASS;
- checker roster: 98/98 PASS;
- locked shadow lifecycle suite: 11/11 PASS;
- isolated canary cohort: three independent 98/98 PASS runs with identical
  normalized summaries;
- scale coverage: exact 0/100/1,000/10,000 cardinalities and 7 executed reads
  per row, status `QUALIFIED`;
- regression: exact 41/41 guards with pinned manifest digest
  `a9591c526059341f6b6878fa04104a25b46cc4ffb8b0b2bbee8554daab399ac3`;
- 10,000-task warm p95 248.288 ms and RSS delta 375,193,600 bytes.

Evidence digest:
`f8066f47af750823f844c4eeeb2f22928a1da30111c43030a58f2abd4a5761ef`.
Decision digest:
`a811a175f851a3d7f7f5bb24df74dcae77daa4d055cccc5c0121f7d18dbd8ad5`.
Owner: QE Runtime Controller maintainers. Review date: 2026-11-08.

This decision remains local and single-host. It grants no deployment, release,
installation, migration, production-traffic, or remote multi-host authority.
