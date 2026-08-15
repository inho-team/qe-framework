# Plan Initialization Contract

Qplan creates and binds named Plans only through the DB-authoritative
`scripts/qe-plan.mjs` writer. Raw filesystem writes to canonical planning paths
are not an initialization protocol.

## Initialize

```bash
node scripts/qe-plan.mjs init \
  --slug {slug} \
  --session {full-session-uuid} \
  --input {plan-input.json}
```

The input is exact JSON:

```json
{
  "schema": 1,
  "roadmap": "# Roadmap\n...",
  "requirements": "# Requirements\n...",
  "state": "# State\n\n## Phase Progress\n",
  "goals": [
    {
      "title": "One outcome",
      "objective": "One observable objective",
      "phase": "Phase 1",
      "wave": "Wave 1"
    }
  ]
}
```

One `BEGIN IMMEDIATE` transaction creates `ROADMAP.md`, `REQUIREMENTS.md`,
`STATE.md`, stable Goal IDs in `goals.json`, the append-only creation events in
`ledger.jsonl`, `.qe/planning/ACTIVE_PLAN`, and the full-session binding. A
failure leaves none of those writes committed.

Exact re-execution is idempotent. Partial Plans, divergent content, malformed
canonical hashes, and disk-only paths without migrated DB rows fail closed.
Initialization never overwrites an existing Plan.

## Bind an Existing Plan

```bash
node scripts/qe-plan.mjs bind \
  --slug {slug} \
  --session {full-session-uuid}
```

Binding verifies all five canonical Plan rows, then atomically updates the
project pointer and merges `activePlanSlug` into the session binding without
discarding its other metadata. Rebinding is idempotent.

Binding does not transfer an active Goal. After confirming that its prior
execution session has ended, perform an explicit compare-and-swap takeover:

```bash
node scripts/qe-plan.mjs takeover \
  --slug {slug} \
  --session {new-full-session-uuid} \
  --previous-session {prior-full-session-uuid} \
  --reason "prior process terminated before handoff"
```

The writer requires the exact current owner, rejects same-session or stale-owner
guesses, marks the previous owner `abandoned`, records a reason hash and an
inspectable ledger event, and updates Goal ownership plus Plan/session bindings
in one transaction. Exact retry is idempotent. This is an explicit local
operator decision; it is not automatic liveness detection or identity proof.
