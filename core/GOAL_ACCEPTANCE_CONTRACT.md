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
  "goalShape": {
    "primaryOutcome": "A user can complete one named primary flow.",
    "completionMetric": "The primary user-journey test exits successfully.",
    "allowedPaths": ["src/feature.mjs", "test/feature.test.mjs"],
    "nonGoals": ["No unrelated UI, migration, deployment, or documentation redesign."],
    "dependencies": []
  },
  "requirements": [
    { "id": "R001", "criterion": "The user can complete the requested action.", "command": "node --test test/user-flow.test.mjs" }
  ],
  "scenarios": [
    { "id": "S001", "kind": "user-journey", "scenario": "A user follows the primary flow.", "expected": "The requested result is observable.", "command": "node --test test/user-flow.test.mjs" }
  ],
  "regression": { "scope": "Affected existing behavior", "command": "npm run qe:validate" },
  "humanAcceptance": { "required": false },
  "goalAlignment": {
    "objective": "The exact, verbatim Goal objective from goals.json.",
    "rationale": "R001 and S001 together demonstrate that objective."
  },
  "riskAssessment": {
    "categories": ["none"],
    "rationale": "Why this Goal has no high-impact security, data, payment, deployment, or integration risk."
  }
}
```

`goalAlignment.objective` must exactly preserve the Goal objective; it prevents
an implementation from silently substituting a narrower success definition.
Every scenario is a `user-journey`, not merely a low-level test description.

The runner classifies `npm run qe:validate` and `node scripts/check-all.mjs` as
**structural evidence**. They establish configuration and repository invariants,
but do not by themselves prove changed runtime behavior. Any contract whose
`allowedPaths` includes a code file must also lock at least one focused
`node --test <path>` command as **behavioral evidence**.

## Goal size gate

A Goal represents **one user-visible outcome**, not a feature area or Phase.
The ledger rejects a contract unless it has a `goalShape` with 1–5 relative
`allowedPaths`, one primary outcome and completion metric, explicit `nonGoals`,
and declared dependencies. It also permits at most three requirements and two
user journeys. Split anything broader into ordered Goals before starting it.

`riskAssessment.categories` is one or more of `none`, `authentication`,
`authorization`, `payment`, `deployment`, `data-migration`,
`destructive-data-change`, `external-integration`, or `security`. A non-`none`
category requires `humanAcceptance.required: true`. The ledger also detects
these risk signals in the Goal objective and rejects a contract that omits them.

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
  "goalAlignment": { "objective": "The exact, verbatim Goal objective from goals.json.", "verifier": "fresh reviewer", "outcome": "pass", "evidence": "The independent verifier mapped every declared result to the unchanged Goal objective." },
  "humanAcceptance": { "status": "not-required" },
  "limitations": []
}
```

Every requirement and scenario must declare a closed-world runnable command:
`npm run qe:validate`, `node scripts/check-all.mjs`, or `node --test <path>`.
For code-changing Goals, the command set must contain `node --test <path>`;
structural checks remain regression evidence rather than behavioral proof.
Run `ledger.mjs run-evidence` once with `--role implementation`, then again
from a different QE session with `--role verification --verifier {fresh reviewer
identity}`. The ledger captures the session ID, exit status, and an output hash;
both runs must pass before it accepts completion evidence. `machine-reexecution`
is the required independent mode. This establishes distinct session evidence,
but reviewer identity remains an operational trust boundary rather than a
cryptographic identity proof.

Concurrent runners should pass their own full UUID with `--session {uuid}`.
This avoids attributing evidence through the project-global current-session
pointer, which another live session may update while commands are running.

The independent verifier must additionally issue the `goalAlignment` verdict.
Its verifier identity must match `independentVerification.verifier`, and it must
name the unchanged Goal objective. This makes a passing command insufficient on
its own: the reviewer must attest that the recorded evidence proves the intended
user outcome.
