# Goal Acceptance Contract

Use this contract before a Goal starts. It makes the expected user outcome
testable before implementation, rather than treating a passing implementation
as proof that the outcome was correct.

## Acceptance contract

Save this JSON as `.qe/planning/plans/{slug}/evidence/{goalId}.acceptance.json`.

```json
{
  "schema": 1,
  "goalId": "G001",
  "requirements": [
    { "id": "R001", "criterion": "The user can complete the requested action.", "command": "node --test test/user-flow.test.mjs" }
  ],
  "scenarios": [
    { "id": "S001", "scenario": "A user follows the primary flow.", "expected": "The requested result is observable.", "command": "node --test test/user-flow.test.mjs" }
  ],
  "regression": { "scope": "Affected existing behavior", "command": "npm test" },
  "humanAcceptance": { "required": false }
}
```

## Completion evidence

Save this JSON as `.qe/planning/plans/{slug}/evidence/{goalId}.completion.json`.
Every declared requirement and scenario must have a passing entry. If human
acceptance is required, record a completed UAR or equivalent inspectable proof.

```json
{
  "schema": 1,
  "goalId": "G001",
  "requirements": [{ "id": "R001", "outcome": "pass", "evidence": "Command/output or inspectable artifact" }],
  "scenarios": [{ "id": "S001", "outcome": "pass", "evidence": "Executed user-flow evidence" }],
  "regression": { "outcome": "pass", "evidence": "Fresh regression command and result" },
  "independentVerification": { "verifier": "fresh reviewer", "mode": "machine-reexecution", "outcome": "pass", "evidence": "Separate machine re-execution record" },
  "humanAcceptance": { "status": "not-required" },
  "limitations": []
}
```

Every requirement and scenario must declare a closed-world runnable command:
`npm run qe:validate`, `node scripts/check-all.mjs`, or `node --test <path>`.
Run `ledger.mjs run-evidence` once with `--role implementation`, then again
from a different QE session with `--role verification --verifier {fresh reviewer
identity}`. The ledger captures the session ID, exit status, and an output hash;
both runs must pass before it accepts completion evidence. `machine-reexecution`
is the required independent mode. This establishes distinct session evidence,
but reviewer identity remains an operational trust boundary rather than a
cryptographic identity proof.
