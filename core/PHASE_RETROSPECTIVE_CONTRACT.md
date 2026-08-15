# Phase Retrospective Contract

Qplan cannot activate the first Goal of a new Phase until the prior Phase has a
ledger-issued retrospective proof. The `advance next` transition returns
`PHASE_RETROSPECTIVE_REQUIRED` when this boundary evidence is absent and
`PHASE_RETROSPECTIVE_INVALID` when it has drifted or been tampered with.

## Input

Run the official Plan CLI with the full current session UUID:

```bash
node scripts/qe-plan.mjs retrospective \
  --slug {slug} \
  --session {full-session-uuid} \
  --input {retrospective-input.json}
```

The input is exact JSON:

```json
{
  "schema": 1,
  "phase": "Phase 1",
  "nextPhase": "Phase 2",
  "regressionCommand": "node --test test/phase-1.test.mjs",
  "verifier": "phase-reviewer",
  "summary": "What the completed Phase delivered.",
  "gaps": [],
  "lessons": ["What should be retained or changed."],
  "actions": ["A constraint or action carried into the next Phase."]
}
```

The regression command must be a recognized behavioral test runner. QE runs it
directly; caller-supplied PASS claims are not accepted.
Keep the transient input outside the Git worktree or under ignored QE state so
it cannot expand a completed bounded-micro Goal's sealed change scope.

## Sealed Evidence

After the prior Phase Goals are complete, the writer:

1. Generates the canonical Phase satisfaction report.
2. Runs and hashes the fresh regression command.
3. Binds every completed Goal's immutable proof digest.
4. Writes `phases/{N}/RETROSPECTIVE.md` and
   `phases/{N}/retrospective.json` in one DB transaction.

The Markdown projection follows `core/RETROSPECTIVE_TEMPLATE.md`; the JSON proof,
not a hand-edited checkbox, is transition authority.

The proof binds the current `goals.json` hash, report hash, retrospective hash,
Goal proof set, command output hash, session, and verifier. Exact replay is
idempotent. Failed regression writes no retrospective proof. Later report,
Goal, proof, or retrospective drift blocks the next Phase.
