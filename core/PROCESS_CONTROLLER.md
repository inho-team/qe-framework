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
- `preparePseTransition({ processId, requestId, taskPath, checklistPath })`
- `guardedPseTransition({ processId, requestId, to, expectedRevision, receipt, taskPath, taskBytes, checklistPath, checklistBytes, resume, attestations, humanAcceptance })`
- `bindPseTask({ processId, requestId, taskPath, checklistPath })`
- `transitionPseStage({ processId, requestId, action, binding, expectedRevision, taskPath, checklistPath })`
- `read(processId)`

Unknown fields, accessors, non-plain envelopes, invalid identifiers, non-JSON
evidence, and oversized inputs fail closed. Unroutable input is recorded only as
a sanitized controller-level rejection; hostile raw values are never persisted.

The `runtime-controller-lifecycle-10` successor owns the bounded PSE artifact
capture projection. The capture helper accepts only the exact
`TASK_REQUEST`/`VERIFY_CHECKLIST` raw pair envelope, validates typed-array
carrier bounds, logical paths, and title-adjacent frontmatter, then returns a
frozen JSON-safe projection. Each same-realm `Uint8Array` is limited to 1 MiB;
Buffer, proxy, subclass, shared, detached, resizable, accessor, symbol, and
expando forms fail closed. Leading BOM remains `FRONTMATTER_INVALID`; CRLF and
LF canonicalize to the same captured text.

`runtime-controller-lifecycle-23/G001` composes that capture boundary with the
exact required-section scanner and domain-separated item, document, and pair
identity. Its public identity intentionally observes checkbox markers in the
document and pair digests while preserving marker-independent item digests.

`runtime-controller-lifecycle-25/G001` adds a pure generation comparator. It
recaptures both raw generations, neutralizes only capture-validated lifecycle
frontmatter spans and scanner-recorded required-item marker offsets, then
accepts only the declared adjacent lane transitions. Pending and active lanes
permit monotonic checkbox progress; held and completed lanes are frozen, and
every completed generation is all-checked. Held resume metadata is a bounded
consistency snapshot only. Every success states `authoritative: false` and the
comparator performs no controller or persistence mutation.

Neither identity nor consistency alone is provenance. The
`runtime-controller-lifecycle-28/G001` boundary adds a controller-owned
preparation row with a 256-bit bearer receipt. Preparation binds the current
Goal revision/audit head, both authoritative `qe_files` raw hashes, and the pair
identity without advancing the process audit. Guarded requests bind the receipt
hash and bounded metadata projection into the request digest; plaintext receipt
and artifact bytes are not persisted in the audit event.

The guarded transaction recaptures the current DB rows, applies the pure
comparator to current and proposed bytes, and requires the exact PSE-to-Goal
state mapping. Both artifact rows, preparation consumption, Goal snapshot, and
hash-linked audit event commit under one `BEGIN IMMEDIATE`. Pre-commit faults
roll back every component; response loss after commit is recovered from the
receipt-bound request event. The SQLite DB is authoritative. Filesystem mirror
atomicity and general-purpose `qe-fs` transactions remain outside this boundary.

`runtime-controller-lifecycle-31/G001` adds the PSE-native stage adapter. Its
pure immutable projection reuses the lifecycle comparator's exact normalization
and domain-separates a digest over capture identity, ordered item identities,
and normalized documents. The public identity and comparator results do not
change.

`bindPseTask` requires exactly one task/checklist pair for the UUID across the
four lifecycle lanes and stores one controller-bound 256-bit bearer token.
Original-request retries replay the sealed row even after a valid lane move;
fresh request IDs revalidate the unique current pair before replaying the same
binding. The binding row and its canonical payload/digest are protected from
update and delete. These are integrity controls for ordinary SQL, not
authentication against the database or OS owner. Direct DB writers and DB
readers are trusted; a reader can copy the bearer token.

`transitionPseStage` validates the binding lineage and current unique pair before
request replay, derives bounded evidence and request digests, and implements the
total forward/block/resume matrix. It never targets PSE `complete`. Duplicate,
foreign, or immutable-lineage drift remains a binding mismatch; mutable raw
evidence drift on an otherwise valid replay is evidence-stale. Request conflict
and old-head replay have separate deterministic results. Only the PSE snapshot
and hash-linked audit event commit under one `BEGIN IMMEDIATE`; task/checklist
rows and the binding remain unchanged. Pre-commit faults roll back both state
and audit, and an after-commit response loss is recovered from the durable event.

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

## Controller-owned SIVS proof adapter

`bindSivsTask` seals a SIVS process to one lifecycle-31 PSE bearer binding, its
exact `execute` revision and audit head, the active Plan Goal attempt and
acceptance hash, and the current task/checklist generation. The SIVS bearer is
stored only in its immutable binding row; audit records contain its digest.
Fresh proof and stage requests revalidate this lineage. Exact original binding
and committed stage retries remain response-loss safe.

`recordSivsVerification` and `recordSivsSupervision` append controller-owned,
domain-separated immutable proof rows with per-process contiguous sequences.
Verification binds the current implementation and verification run identities,
requires distinct sessions, and fixes the run result to the asserted verdict.
Supervision requires the latest current PASS verification proof and a third,
independent session. Raw findings and Risk Markdown are not controller
authority; the trusted structural adapter supplies their bounded digests.

`transitionSivsStage` derives a fixed evidence projection from the sealed rows.
It permits `spec -> implement`, passed implementation `implement -> verify`, and
PASS verification `verify -> supervise`; completion remains a later gate.
Block/resume and FAIL-only remediation preserve the selected proof in the
hash-linked process audit. Routed denials append only a sanitized global
rejection event and never reserve a process request or mutate SIVS state.

These controls protect integrity against ordinary callers while the SQLite
schema and triggers remain installed. The database/OS owner and the in-process
controller constructor are trusted; proof events are structural assertions, not
cryptographic signatures from an external principal.

Proof reads require canonical JSON bytes and exact schemas. Verification rows
contain the sealed lineage followed by implementation/verification run IDs and
sessions, verdict, reviewer, and findings digest. Supervision rows contain the
same lineage followed by the referenced verification digest/run/session,
verdict, supervisor/session, and risk digest. Attempts are positive safe
integers. Every authority-bearing lineage and verification field is re-derived
from the sealed binding and current canonical Plan runs whenever selected;
supervision additionally binds the latest semantically valid PASS verification.

An absent run is `*_PROOF_MISSING`, malformed or stale run/proof material is
`*_PROOF_CORRUPT`, and a valid failed implementation is
`SIVS_IMPLEMENTATION_FAILED`. Invalid fresh assertions retain their
`*_ASSERTION_MISMATCH` code. A corrupt proof cannot authorize forward,
remediate, or resume, but block remains safe and records `status=corrupt`.
`findingsDigest`, `riskDigest`, `supervisor`, and a structurally valid distinct
supervision session are trusted-adapter observations: their syntax and bytes are
sealed, but their external truth is not re-derived. A DB/OS owner that rewrites
these values and all dependent digests remains outside the threat model.

From `supervise`, a valid PASS/WARN supervision proof may authorize `complete`
only when the active Goal has producer-recorded completion evidence. The gate
mirrors `recordGoalEvidence`: it validates canonical pretty JSON, acceptance
coverage, regression, independent verification, Goal alignment, human
acceptance, current passing runs, and the Goal's `completionEvidence` binding.
Every source content SHA, run/proof/session identity, and human-acceptance state
is sealed into `qe-sivs-completion-evidence-v1`; raw evidence never enters the
process audit. Four controller-derived attestations are passed to the SIVS
kernel, and only its `ALLOWED` snapshot is committed. Exact response-loss replay
uses the historical completion projection and does not reread moved evidence.
The generic `transition` facade cannot request SIVS `complete`, even with
structurally valid caller-supplied attestations. It appends the deterministic
process denial `SIVS_COMPLETION_ADAPTER_REQUIRED` without consuming a revision;
only `transitionSivsStage` may construct completion authority.

## Persistent completion lease and Stop bridge

`acquirePersistentCompletionLease` and `renewPersistentCompletionLease` expose
the controller store's session-scoped SIVS completion lease without changing the
legacy persistent-mode API. A full UUID session and process have one mutable
current checkpoint. Its generation is backed by an append-only chain containing
one acquire, at most 32 renewals, and at most one terminal expiry or release.
Rollover validates the complete bounded predecessor generation before sealing
its terminal digest into generation `n+1`; routine current validation reads only
the current generation (at most 34 events) and that sealed checkpoint.

Each mutation captures one injected wall-clock value under `BEGIN IMMEDIATE` and
advances a singleton nondecreasing watermark. Lease tokens, generations, and
fences are all required by renewal. Request IDs and domain-separated request
digests provide exact replay; stale tokens, clock rollback, broken event links,
fabricated early expiry, and current/head disagreement fail closed. Replays are
resolved before reading the clock. A fresh rollback is reported exactly as
`PERSISTENT_CLOCK_ROLLBACK` and rolls back lease, Stop, and completion writes.
Acquire, renew, and Stop also revalidate the sealed SIVS binding and its current
process-audit prefix; a lost or stale unified-state locator has no authority.
The SQLite/OS owner and injected clock source remain trusted computing base
components.

The Stop hook evaluates Ralph and explicit execution modes first, then the
controller lease, then legacy persistent mode and the existing gates. Its exact
event projection binds the event key, cwd, transcript path, turn ID, full session
UUID, and hashes of user and assistant text. Immutable Stop decisions also seal
the current authority-generation digest. Matching replay skips the clock;
payload conflicts and generation drift are distinct failures. An active,
incomplete, unexpired process blocks. Authoritative expiry or audited completion
allows Stop and cleanup. Missing databases and sessions without a current row
retain legacy behavior, while an installed but unavailable/corrupt store blocks.
Allowed-stop cleanup is a separately delivered retryable effect: cleanup failure
does not revoke the immutable Stop decision, and exact Stop replay attempts the
cleanup again until delivery succeeds.

SIVS completion advances the same clock watermark and terminalizes an attached
lease inside the process state/audit transaction. Active leases release before
expiry and expire at or after their deadline; already expired or released leases
need no second terminal event. Thus completion versus Stop is serialized by the
same SQLite write lock. Pre-commit faults roll back process state, process audit,
lease event, current head, and Stop decision together. Post-commit response loss
is recovered from immutable request-bound rows. Rollback is code-only: retain
lease generations, decisions, and the clock watermark; schema/history removal
requires a separately approved maintenance procedure.

### Audit reconciliation invariant

Reconciliation captures raw candidate rows first, then validates the process
audit and state head through `createProcessControllerStore.read`. A candidate is
accepted only when its request ID and complete canonical request match the
stored child and its sequence is within the validated head. Historical rows
remain authoritative after later head advances because the validated append-only
chain includes them. Corrupt chains, forged requests, and state/head mismatches
fail closed as `CONTROLLER_AUDIT_INVALID`.

The journal itself remains separate from Plan state. A lifecycle operation with
kind `controller-projected` can opt into the compact projection protocol below;
other operation kinds retain journal-only behavior. Business recovery after a
projection conflict or denial remains a successor concern.

## Compact lifecycle outcome projection

`stageLifecycleProjection` accepts one compact child vector before the first
claim. The recipe contains only the target status/attempt materialization and an
event template for each roster ordinal; it contains no caller-selected outcome.
Stage validates a finalized pristine journal, exact Goal/process/ordinal
bindings, canonical `goals.json`, `ledger.jsonl`, and `STATE.md` hashes, then
reserves the slug head and deterministic event identities in one immediate
transaction. A `controller-projected` child cannot be claimed until this stage
succeeds.

`applyLifecycleOutcomeProjection` derives `committed` or `denied` exclusively
from the finalized parent and its request-bound controller audit rows. It applies
only the authoritative prefix. The allowed prefix mutates declared Goal fields;
the denied ordinal emits a checkpoint without a Goal mutation. Completion,
verification, acceptance, evidence binding, deletion, and undeclared fields are
outside the recipe grammar.

Goals, ordered ledger events, the derived Phase Progress block, consumed event
reservations, immutable receipt, recipe terminal state, and slug-head release
commit in one SQLite transaction. Retry verifies the receipt and all three
post-state hashes before returning `REPLAYED`; it never appends a second event.
Base, target, ledger-identity, or STATE drift returns a stable conflict without
changing the three canonical rows and retains the staged recipe/head for the G003
debt workflow. There is deliberately no rebase, repair, quarantine, or automatic
cleanup path in this phase.

Projection schema objects have a separate versioned seal. Recipe and receipt
identity/content are immutable, while the only guarded transitions are
`staged -> projected` and reservation `0 -> 1`; heads can only be inserted and
released. Partial schema or a missing/tampered index, trigger, or seal fails
closed. The private `qe.lifecycle-projection.fault-injector` seam covers staging,
each canonical write, receipt/head release, and pre/post-commit response-loss
cuts.

## Projection debt quarantine and recovery

`quarantineLifecycleProjection` converts a retained, unreceipted projection
conflict into a slug-scoped immutable debt. The caller supplies the observed
reason, but the runtime reproduces that reason from the staged recipe, matching
head and reservations, finalized journal/controller audit, and fresh canonical
Goal, ledger, and STATE rows in one `BEGIN IMMEDIATE` transaction. A successful
quarantine appends normalized target/event/result obligations, a hash-linked
`quarantined` audit event, advances the debt audit head, and releases only the
old projection head. The old recipe, reservations, journal, and controller audit
remain intact. Retry validates the stored bytes and returns `REPLAYED`.

`SUPERSEDED` is limited to a distinct same-slug finalized pristine operation.
Its exact `{compensatesDebtId, obligationDigest}` payload is bound before stage;
quarantine creates the immutable binding and `compensation-bound` audit event in
the same transaction that releases the old head. The managed claim path requires
both the staged recipe and its active slug head, so a quarantined operation
cannot resume execution.

Debt resolution is append-only and never rewrites Goals, ledger, or STATE.
Restricted equivalence is available only for terminal target/STATE conflicts
whose declared Goal fields already equal current canonical values and whose
current STATE is the exact shared-renderer projection. All other debts require a
bound replacement and a verified immutable projection receipt. Coverage records
bind every old target/event obligation to an exact effect or a strictly newer
same-process allowed controller lineage; missing events are represented by a
resolution-audit entry only in the restricted equivalence case.

`assertNoLifecycleProjectionDebt` validates the separate debt schema seal, every
debt/obligation/binding/resolution identity, and the full per-slug audit chain and
head. It also treats an unreceipted same-slug recipe, head, or reservation with no
validated debt as an outstanding liability. Completion evidence publication and
the private Goal completion primitive execute this assertion in the same
transaction as their canonical write. Public `append`, including
`allowComplete:true`, cannot write `complete`; corruption, unavailable authority,
or outstanding debt leaves completion artifacts, Goal status, and ledger bytes
unchanged.

The debt tables and audit are protected by connection-scoped UDF guards and a
versioned ordered-SQL seal. This is an integrity control while the trusted schema
objects remain installed, not authentication against the database/OS owner.
Rollback is non-destructive: revert runtime code, retain debt and projection
history, and rebuild/drop tables only through a separately approved maintenance
procedure. The runtime performs no automatic debt deletion or current-state
rebase. G004 adapters must reuse the slug-wide assertion immediately before
controller-bound Plan/Goal transitions and completion; PSE/SIVS evidence mapping
remains outside this debt layer.

## Controller-bound Plan and Goal adapter

Canonical Plan/Goal lifecycle mutation is routed through
`executePlanGoalTransition`. Its public envelope is closed to `next`, `block`,
`fail`, and `complete`; controller identity, revisions, operation IDs, proof
material, and receipt identities are framework-derived. At an installed
adapter boundary, direct lifecycle `append` and `recordEvent` calls fail closed,
while checkpoint/measurement publication may only preserve the current Goal
status and attempt. `renderState` becomes a verification-only operation after
adapter installation.

The adapter installs an additive, versioned schema over a healthy lifecycle,
projection, and debt store. Immutable intents, bootstrap manifests, proofs,
receipts, and hash-linked audit rows are protected by connection-scoped UDF
guards; the per-slug head is released only by a framework transaction that also
persists a rejection or terminal projection. A partial object set, changed SQL,
wrong seal, raw-SQL mutation, or unavailable canonical root fails closed without
automatic repair. As with the controller and debt layers, the database/OS owner
is outside this integrity boundary.

Before controller execution, the adapter validates the canonical Goal queue,
acceptance binding, repository evidence, and the slug-wide projection-debt
snapshot. It persists an immutable semantic intent and deterministic ledger
reservation, then runs an ordered lifecycle operation against the Plan and Goal
controllers. Allowed terminal results are revalidated in one `BEGIN IMMEDIATE`
projection that updates Goals, appends one receipt-bound ledger event, derives
STATE, inserts the immutable receipt/audit event, and releases the head.
Response loss is recovered by matching the request digest and current post
hashes; concurrent callers converge on the same receipt.

Controller denial is a durable terminal generation, not an abandoned partial
operation. The denied receipt binds the ordered allowed-prefix result refs and
full controller-head snapshots. A subsequent identical request verifies that
prefix against controller audit, derives a bounded carry generation, omits the
already allowed children, and binds the cumulative prefix into the v2 receipt
and ledger event identities. Intent, proof-ready, controller-terminal, and
projection phases are reconstructed from immutable rows after a process crash;
a fresh caller never rewrites an earlier intent.

Legacy controller catch-up binds each ordered bootstrap step to the canonical
Goal or Plan snapshot digest, repository artifact digest, deterministic request
ID, and controller result ref. Adapter reads verify bootstrap, intent, proof,
receipt, and per-slug audit bytes and references before selecting or replaying
an action. Stale or newly debt-bearing apply attempts become an atomic rejected
receipt plus head release while the authority remains trustworthy.

Completion proofs are derived from the immutable acceptance publication
identity, current-attempt implementation and verification runs, recorded
completion evidence, verifier/session separation, Goal alignment, and human
acceptance requirement. The last Goal reconstructs and revalidates the ordered
proof set for every completed Goal before requesting Plan completion. Caller
attestations are never accepted. Outstanding or corrupt projection debt,
evidence gaps, stale canonical bytes, and controller denial cannot change
canonical Goal, ledger, or STATE bytes.

Goal and Plan attestations reference the final immutable
`qe-plan-goal-proof:<proofId>` row. Proof digest calculation canonicalizes that
self-reference to the fixed `qe-plan-goal-proof:self` token before hashing,
which removes the otherwise circular `proofId → proofDigest → proofRef`
dependency while preserving a reproducible stored identity.

Rollback is non-destructive: retain adapter intents, controller audit, receipts,
proofs, and debt history, revert runtime code, and use a separately approved
maintenance procedure for any schema removal. Formal Goal completion maps the
Goal to its completed SIVS controller proof; remediation policy, runtime metrics,
release, and deployment remain explicit later-Goal responsibilities.

## Plan evidence generations

At the resolved QE root, Plan rows under `.qe/planning/**` are authoritative in
`qe_files`. Goal mutation, the corresponding ledger suffix, evidence binding,
and the framework-owned write identity commit in one `BEGIN IMMEDIATE`
transaction. Every replacement validates the stored metadata and prior content
hash; a stale writer cannot overwrite a newer row. Outside the resolved root,
compatibility fixtures retain the existing atomic disk behavior and do not gain
a cross-process CAS claim.

At a Phase boundary, the first pending Goal of the next Phase cannot transition
to active until a ledger-issued retrospective binds the prior Phase's complete
Goal proofs, canonical Phase report, human-readable retrospective projection,
and a freshly passing behavioral regression run. Hash drift in any bound source
fails closed before controller mutation.

Plan machine-evidence execution is generation-based rather than overwrite-only.
`runGoalEvidence` keeps the current binding at `evidence/<G>.<role>-run.json`,
adds a fresh invocation UUID and `runId` per execution, and archives the previous
current bytes unchanged to `evidence/runs/<G>.<role>.<runId>.json` before replacing
the current binding. Failed-to-passing reruns and fresh-verifier runs are new
generations. Acceptance and completion publication retries instead use the
framework identity table to recover the original committed event and never rely
on caller-controlled ledger fields.

## Manifest finalization and migration boundary

The lifecycle parent owns an ordered canonical child roster and its
domain-separated digest. Creation writes a `finalized=0` parent first, inserts
only children declared by that roster, and changes the parent to `finalized=1`
only after the database verifies exact membership and initial runtime fields.
Public read, claim, settle, and reconciliation paths reject staged parents; only
same-semantic creation recovery may fill missing declared children using the
stored operation UUID. Once finalized, parent identity/intent/roster and child
identity/request fields are immutable, while the existing guarded runtime status
fields remain mutable.

Bootstrap and legacy backfill run under one `BEGIN IMMEDIATE`. The installed
parent, child, and seal guards comprise nine named triggers. Their ordered SQL is
hashed into the version-1 `lifecycle-journal-immutability` seal; a partial trigger
set, wrong seal, or later trigger tamper fails the lifecycle store closed. The
roster digest is provided by a deterministic SQLite function on every framework
connection, so a raw external SQLite connection cannot create or finalize a
parent without explicitly registering the same function.

This is an integrity boundary for ordinary SQL while the guards remain present,
not a cryptographic defense against the database owner. Rollback is therefore
manual and non-destructive: take a backup, revert the runtime code, then use an
explicitly approved table rebuild to remove only the nine named triggers, the
target seal, and the manifest columns. The runtime contains no automatic drop,
delete, or journal-pruning path. Compact projection recipes, receipts,
supersession, quarantine, and completion-debt policy are defined above.

## Progressive Assurance reuse boundary

The Runtime Controller is an opt-in durability mechanism, not the default task
router. Reuse its compare-and-swap, append-only audit, and recovery semantics
only when at least one runtime need is present:

- the selected execution mode is `durable`;
- the operation is explicitly classified as long-running; or
- the operation is explicitly classified as high-risk.

The 2026-08-08 broad-local-adoption qualification adopts these three eligible
lanes for local use. The decision is evidence-bound by the locked shadow suite,
three-run canary cohort, exact four-cardinality scale gate, and 41-guard
regression manifest. It does not expand eligibility: ordinary solo, subagent,
wave, and isolated work remains on the existing router unless it independently
meets durable, long-running, or high-risk classification.

`solo`, `subagent`, `wave`, and `isolated` execution do not require the
controller by themselves. Assurance selection is orthogonal: an explicit Full
SIVS Plan may run without the controller, while an ordinary native request may
use a durable controller lane. Neither choice weakens the Safety Kernel or QE
response style.

The controller remains outside the ordinary admission path. Compact projection
and its debt state machine are opt-in for `controller-projected` operations and
are not prerequisites for native execution. Once a slug opts in, however, its
completion path must observe the debt assertion and cannot bypass outstanding
projection liability.

`createEligibleProcessController({ cwd, layer, authority, message, executionMode, longRunning, highRisk })`
adds a frozen admission wrapper around the existing controller facade. The
wrapper only admits when exactly one of the durable, long-running, or high-risk
signals is present; ordinary, ambiguous, or invalid input returns
`controller: null` and does not open the process store.

## Controller-owned bounded SIVS remediation

`remediateSivsStage` is the sole authority for leaving the SIVS `remediate`
state. It validates the current task binding, Goal attempt and acceptance hash,
task/checklist hashes, the current canonical FAIL proof, and one active
persistent completion lease in a single `BEGIN IMMEDIATE`. Verification FAIL
derives the nearest `implement` route at depth cost 2; supervision FAIL derives
`verify` at cost 1. Caller-supplied route selection is rejected.

Only a successfully committed controller event increments the persistent round
and depth counters. The second consecutive equal semantic failure halts before
incrementing; otherwise round 4 and depth above 5 halt in that order. A halt
atomically writes the blocked process snapshot, append-only remediation event,
and persistent-lease release. Stop then returns
`PERSISTENT_REMEDIATION_HALTED`. All SIVS state-moving entry points deny escape
from a halted process with `SIVS_REMEDIATION_HALTED`.

Verification failure semantics are re-derived from the current verification
run's ordered failing `{command, exitCode, signal, outputHash}` projection.
Supervision semantics use the structurally authorized supervisor's `riskDigest`.
That digest is an explicit trusted-producer boundary (TCB): the controller seals
and propagates it but does not claim to reproduce the supervisor's risk analysis.
Remediation filenames and the legacy loop-guard remain compatibility telemetry;
neither authorizes a round nor owns the hard caps.

## Head-aware process metrics

`processMetrics()` is a frozen, no-argument read on every Controller facade. A
single SQLite read transaction fixes the union of process state/audit and all
SIVS auxiliary tables before validation. Every candidate must match the public
process identifier grammar and pass the complete state/audit chain validator;
only then is its layer used. Valid non-SIVS processes count toward the Controller
population, while any SIVS auxiliary row attached to one is corruption.

A valid unbound SIVS process remains visible as a source, but makes Pass@1
history unprovable. Bound sources seal their immutable task identity and the
complete currently observable verification and supervision rows. Proof request
digests are reconstructed from the writer-exact assertion. Supervision must
reference a same-process PASS verification. Duplicate logical task identities
remain separate source anchors but count once and make Pass@1 ambiguous.

Remediation validation replays route, cost, counters, cap priority, semantic
failure, round digest, and stagnation digest from event zero. Each remediation
row is joined to the same-request Controller event and the immediately preceding
sealed remediate-entry audit. Its paired snapshot is validated at that historical
revision; a later valid stage or denied audit may advance the overall process
head, to which remediation current remains bound. Halt forbids only another
remediation event and does not erase later process-audit evidence.

The successful exact wire shape is
`{schema,domain,scope,counts,sources,metrics,digest}`. Sources are UTF-8 bytewise
sorted. The digest covers the domain, schema, scope, counts, sources, and metrics
without a wall clock. Raw proof, artifact, telemetry, and caller content are not
returned or accepted. Legacy unified-state metrics are not authoritative inputs.

## Closed-loop E2E checker

Run `node scripts/check-runtime-controller.mjs` to replay the bounded public SIVS
proof. The fixture starts at a production-compatible bound Spec, then exercises
Verify FAIL, lease-coupled remediation to Implement, controller restart, fresh
implementation and PASS verification, PASS supervision, completion, lease
release, and the resulting process-metrics anchors. Process state and proof
tables are changed only through existing Controller APIs.

The same suite separates byte-identical replay from changed request data,
foreign or unissued bindings, artifact drift, stale CAS, direct completion, and
post-terminal mutation. Stagnation, depth, and round caps are composed from the
locked writer-backed remediation tests. The checker runs a frozen test list in
one `node --test` child and never invokes `check-all`, so discovery by
`scripts/check-all.mjs` cannot recurse.

This is a local single-store proof. Remote multi-host operation, deployment,
rollout policy, and high-cardinality performance qualification remain outside
the E2E claim.
