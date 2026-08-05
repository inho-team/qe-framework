# Runtime Process Controller

The Runtime Controller is the authoritative persistence boundary around
`process-kernel.mjs`. The kernel remains a pure eligibility function; the
controller supplies the canonical snapshot and trusted adapter authority, then
commits the decision with compare-and-swap semantics.

## G001 boundary

`createProcessController({ cwd, layer, authority })` binds one controller
instance to one process layer and its exact kernel authority. Public transition
requests cannot supply `layer`, `authority`, `principal`, or `snapshot`.
Authentication and lifecycle-entrypoint capability issuance are G002 concerns;
G001 establishes and tests the structural trust boundary they consume.

The public operations are:

- `initialize({ processId, requestId })`
- `transition({ processId, requestId, to, expectedRevision, attestations?, humanAcceptance? })`
- `read(processId)`

Unknown fields, accessors, non-plain envelopes, invalid identifiers, non-JSON
evidence, and oversized inputs fail closed. Unroutable input is recorded only as
a sanitized controller-level rejection; hostile raw values are never persisted.

## Persistence invariants

Each process has an immutable layer binding, a canonical snapshot, and an
append-only hash-linked audit. `audit_seq` is independent of state revision, so
denied and idempotent decisions remain auditable without consuming a revision.
The state row's audit anchor advances in the same `BEGIN IMMEDIATE` transaction
as every new event. Audit UPDATE and DELETE operations are blocked by triggers.

Exactly-once replay has no secondary mutable cache. The first process event for
a request owns `UNIQUE(process_id, request_key)` and hashes the controller
identity, operation, request digest, canonical result, and resulting snapshot.
An identical retry derives its result from that validated event. Reusing the ID
with different semantics appends `REQUEST_ID_CONFLICT` with a null request key.

## Controller rejection audit

Unroutable and corrupt-process rejections use one global domain,
`qe-runtime-controller-rejections-v1`. It has a zero-hash genesis and a singleton
durable head. Every append validates the contiguous chain, the head, and the
physical maximum sequence, then commits the event and new head atomically.
Missing genesis/head, gaps, forged or stale heads, tail loss, and orphan suffixes
return `CONTROLLER_AUDIT_CORRUPT`; database-open failures return
`STORE_UNAVAILABLE`. Neither result claims that an audit was written.

## Recovery semantics

Reads validate process events from genesis and stop at the first invalid row.
They never repair or truncate data.

| Condition | Result |
|---|---|
| Missing or corrupt genesis | `CONTROLLER_CORRUPT`, `lastGoodSnapshot: null` |
| Valid genesis followed by a gap, bad hash, unknown field, or revision discontinuity | Last snapshot in the contiguous validated prefix |
| Missing/malformed state or forged/stale state anchor with a fully valid audit | Last snapshot in the full audit |
| Valid prefix followed by corrupt suffix | Last snapshot in the valid prefix |
| Full valid audit and matching state anchor | Canonical snapshot |

SQLite rollback protects the pre-write, state/audit cut, and pre-commit crash
points. A crash immediately after commit is observed as committed on reopen, and
retrying the same request returns the audit-derived result without duplication.

## Deferred wiring

G001 does not modify ledger, PSE, SIVS, persistent-mode, or remediation
entrypoints. G002 must issue authenticated adapter capabilities and route all
real lifecycle mutation through this controller before the runtime can claim
end-to-end enforcement.

## Composite lifecycle operation journal

The `runtime-controller-lifecycle-2` successor adds a journal substrate without
changing the controller's state or audit schema. Before any controller call,
`createLifecycleOperation` commits one bounded canonical intent and its complete
ordered child roster to `lifecycle_operations` and
`lifecycle_operation_children`. `UNIQUE(slug, semantic_key)` makes a semantically
identical retry return the first operation even when the caller proposes a new
operation UUID; a changed intent fails with `PAYLOAD_CONFLICT`.

The intent digest covers the versioned domain, slug, semantic key, kind, parent
payload, and every ordered child semantic field. It deliberately excludes the
operation UUID, derived request IDs, claims, leases, attempts, timestamps, and
statuses. Each materialized controller request is independently limited to the
controller's 64 KiB/depth-12 envelope, and the complete create envelope is
limited to 1 MiB before a write transaction starts.

### Journal API and state

- `createLifecycleOperation(cwd, slug, input)` creates or replays an intent.
- `getLifecycleOperation(cwd, slug, operationId)` returns the closed journal.
- `claimLifecycleChild(cwd, slug, input)` claims only the current ordinal.
- `settleLifecycleChild(cwd, slug, input)` settles a claim from controller audit.
- `reconcileLifecycleOperation(cwd, slug, input)` repairs response loss without
  issuing a controller call.

Child execution is ordered. A bounded lease and opaque fencing token prevent a
late worker from settling after ownership changes. The request ID is
deterministic for the first operation UUID and child ordinal, so a replacement
worker can safely replay the same controller call. An allowed audit event commits
the child and opens the next ordinal. A denied event terminalizes the parent and
atomically cancels every later pending child. Unmatched global rejection or
store failure has no request-bound per-process evidence, so it remains
`unavailable` and never becomes a fabricated terminal fact.

### Audit reconciliation invariant

Reconciliation captures raw candidate rows first, then validates the process
audit and state head through `createProcessControllerStore.read`. A candidate is
accepted only when its request ID and complete canonical request match the
stored child and its sequence is within the validated head. Historical rows
remain authoritative after later head advances because the validated append-only
chain includes them. Corrupt chains, forged requests, and state/head mismatches
fail closed as `CONTROLLER_AUDIT_INVALID`.

This journal does not project `goals.json`, Plan `ledger.jsonl`, or `STATE.md` and
does not define business recovery after denial. Outcome-specific durable recipes,
atomic projection, bounded rebase, and semantic-lineage release belong to the
next successor Goal.

## Plan evidence generations

Plan machine-evidence execution is now generation-based rather than overwrite-only.
`runGoalEvidence` keeps the current binding at `evidence/<G>.<role>-run.json`,
adds a fresh `runId` per invocation, and archives the previous current bytes to
`evidence/runs/<G>.<role>.<runId>.json` before replacing the current file. This
means reruns are intentional new generations, not response-loss replays.

## Progressive Assurance reuse boundary

The Runtime Controller is an opt-in durability mechanism, not the default task
router. Reuse its compare-and-swap, append-only audit, and recovery semantics
only when at least one runtime need is present:

- the selected execution mode is `durable`;
- the operation is explicitly classified as long-running; or
- the operation is explicitly classified as high-risk.

`solo`, `subagent`, `wave`, and `isolated` execution do not require the
controller by themselves. Assurance selection is orthogonal: an explicit Full
SIVS Plan may run without the controller, while an ordinary native request may
use a durable controller lane. Neither choice weakens the Safety Kernel or QE
response style.

The controller remains outside the ordinary admission path. In particular,
the unfinished projection recipe and debt state machine are not prerequisites
for native execution or for completing an explicit Plan.
