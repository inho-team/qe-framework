# Contract Layer

QE contracts are reviewed Markdown specifications under `.qe/contracts/`. Pending contracts are editable; active contracts are protected by a canonical content hash in `.qe/contracts/.lock`.

## Approve a pending contract

```bash
npm run qe:contract -- approve <name> --reason "reviewed against product requirements"
```

The command validates the name, requires a pending file, moves it to `active/`, computes the canonical SHA-256 hash, and records the approval reason. It refuses to overwrite an existing active contract.

## Retire an active contract

```bash
node scripts/qe-contract.mjs retire <name> --reason "implementation removed"
```

Retirement is recoverable: the reviewed Markdown moves from `active/` to
`archived/`, and an adjacent `.retirement.json` preserves the retirement reason
and prior approval entry. The command removes only that contract's active lock
entry. Malformed locks and archive collisions fail closed without moving the
active contract.

## Verification

Execution and supervision use deterministic contract libraries and verification evidence. The pre-commit contract hook verifies staged active contracts against the lock and blocks unapproved drift. Semantic disputes are handled by the retained critical-review workflow rather than a dedicated contract agent. Revisions must return to pending review and be approved again through the CLI.

Because `.qe` is DB-backed, inspect contracts with:

```bash
node scripts/qe-query.mjs contracts
node scripts/qe-cat.mjs .qe/contracts/active/<name>.md
```

Bypassing the pre-commit hook with `--no-verify` removes this protection and is not recommended.
