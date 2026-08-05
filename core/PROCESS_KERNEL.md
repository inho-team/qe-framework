# QE Process Kernel

The process kernel is QE's deterministic policy boundary for Plan, Goal, PSE,
and SIVS transitions. It evaluates an immutable snapshot and returns an
eligibility decision plus a canonical next snapshot. It does not authenticate a
caller, persist state, or declare workflow completion.

## Trust and concurrency boundary

`evaluateTransition(request)` is an internal API for a trusted adapter. The
adapter authenticates the caller and injects the canonical authority. The
kernel compares that authority byte-for-byte; this comparison is not a
substitute for authentication.

Every decision is bound to `decision.baseRevision`. A persistence adapter may
apply an allowed decision only with:

```text
currentRevision === decision.baseRevision
```

The replacement is `decision.nextSnapshot`. A CAS mismatch discards the
decision and requires a fresh read and evaluation. The next snapshot's revision
is never the comparison value.

## Canonical layers

Only `layer`, `snapshot.state`, `to`, and a blocked snapshot's `resumeState` are
trimmed and converted from ASCII uppercase to lowercase. Aliases are not
accepted. Authorities and attestation fields are not normalized.

| Layer | States in normative order | Authority |
| --- | --- | --- |
| plan | planned, active, blocked, complete | plan-controller |
| goal | pending, active, blocked, failed, complete | goal-controller |
| pse | plan, knowledge, spec, execute, verify, blocked, complete | pse-controller |
| sivs | spec, implement, verify, supervise, remediate, blocked, complete | sivs-controller |

## Transition policy

Every valid same-state request is `IDEMPOTENT`. `complete` is terminal. Every
state-changing edge not listed below is `TRANSITION_DENIED`.

| Layer | State-changing edges |
| --- | --- |
| plan | planned→active; active→blocked/complete; blocked→active |
| goal | pending→active; active→blocked/failed/complete; blocked→active/failed; failed→active |
| pse | plan→knowledge; knowledge→spec; spec→execute; execute→verify/spec; verify→complete/execute/spec; every nonterminal stage→blocked; blocked→resumeState |
| sivs | spec→implement; implement→verify; verify→supervise/remediate; supervise→complete/remediate; remediate→spec/implement/verify; every nonterminal stage→blocked; blocked→resumeState |

A blocked snapshot must contain a known resumable `resumeState`. A same-state
blocked request is idempotent only after that invariant passes. Entering blocked
records the source state; leaving blocked removes it. Goal additionally permits
the explicit `blocked→failed` exit.

Snapshots contain canonical `state`, `revision`, optional `resumeState`, and
optional non-negative safe-integer `attempt`. Unknown snapshot fields are not
copied. Each field is captured once before validation, so accessor-backed input
cannot change revision or state between checks. Revisions from zero through
`Number.MAX_SAFE_INTEGER` are valid.
State-changing requests at the maximum return `REVISION_EXHAUSTED`; idempotent
requests remain valid.

## Completion evidence

A state-changing completion consumes validated attestation references, never
raw booleans. Every attestation has `status=valid`, the exact layer subject and
snapshot revision, plus nonblank `proofRef`, `issuedBy`, `sessionId`, and
`digest` fields.

| Layer | Required keys in order |
| --- | --- |
| plan | goalsVerified, independentVerification, goalAlignment |
| goal | acceptance, implementation, machineVerification, independentVerification, goalAlignment |
| pse | specification, implementation, machineVerification, independentVerification, goalAlignment |
| sivs | specification, implementation, verification, supervision |

Goal and PSE implementation and independent-verification sessions must differ.
Their goal-alignment issuer must equal the independent verifier. Evidence maps,
entries, and human acceptance are plain objects whose prototype is
`Object.prototype` or `null`. Required attestation keys and every field inside
an attestation must be own properties. Human `required` and `status` fields, and
`proofRef` whenever passed status is used, must also be own properties. This
prevents inherited values and prototype pollution from manufacturing evidence.

Evidence validation is deterministic:

1. A missing or empty map returns `EVIDENCE_MISSING` with every required key.
2. A malformed map returns `EVIDENCE_INVALID` with every required key.
3. Invalid present entries take precedence over absent keys and return only the
   invalid keys in contract order.
4. Otherwise absent keys return `EVIDENCE_MISSING` in contract order.
5. Relational violations return their implicated-key union in contract order.

Accessor and Proxy failures are contained in this evidence stage and return
`EVIDENCE_INVALID`; human-acceptance access failures return
`HUMAN_ACCEPTANCE_MISSING`. They do not collapse into a base-shape error after
the snapshot has already been validated.

Human acceptance supports `{required:false,status:"not-required"}` or a passed
status with a nonblank proof. When required, passed status and proof are both
mandatory. Invalid combinations return `HUMAN_ACCEPTANCE_MISSING`.
Non-completion and `complete→complete` requests do not evaluate completion data.

## Decision schema and precedence

Every result contains fresh `allowedNextStates` and `missingEvidence` arrays and
these fields:

```text
allowed, code, reason, layer, from, to, baseRevision,
allowedNextStates, missingEvidence, nextSnapshot
```

Codes are `ALLOWED`, `IDEMPOTENT`, `INVALID_REQUEST`, `UNKNOWN_LAYER`,
`UNKNOWN_STATE`, `STALE_SNAPSHOT`, `AUTHORITY_DENIED`, `TRANSITION_DENIED`,
`REVISION_EXHAUSTED`, `EVIDENCE_MISSING`, `EVIDENCE_INVALID`, and
`HUMAN_ACCEPTANCE_MISSING`.

Validation order is base shape; layer/source/target vocabulary; non-blocked
resume invariant; blocked resume vocabulary/invariant; revision equality;
authority; transition edge; revision capacity; completion attestations; human
acceptance; allow.

`allowedNextStates` contains unique structural targets in normative state order,
including the current state. It is empty before snapshot validation succeeds.
With a valid snapshot it remains structural even when revision, authority, or
evidence checks fail. Complete returns `[complete]`; goal blocked with active
resume returns `[active, blocked, failed]`.

## Progressive Assurance scope

The process kernel governs a process only after an execution adapter elects to
use the Runtime Controller. It does not decide whether a prompt enters Full
SIVS, choose `solo`/`subagent`/`wave`/`durable`/`isolated` execution, or promote
ordinary prose into a Plan.

Workflow assurance and execution mechanics are separate inputs. Full SIVS is
activated only by explicit `Qplan` or `Qgoal`; controller-backed persistence is
activated only for durable, long-running, or high-risk runtime needs. The
kernel's transition and completion-evidence rules remain strict whenever the
controller is selected.
