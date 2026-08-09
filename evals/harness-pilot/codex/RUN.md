# Codex Progressive Assurance Pilot — BLOCKED

## Conclusion

The 20-cell pilot did not start because its preregistered Full-durable smoke
cell failed the shared 600-second operability gate. The corrected runner
rejected the cell before hidden scoring and did not write a balanced dataset.

## Facts

- Model: `gpt-5.6-sol`
- Reasoning effort: `medium`
- Shared revision: `96ce6dea08ef72a050d39eba23f296fe48e303fd`
- Concurrency: `1`
- Smoke cell: `email-normalization / full-sivs-durable`
- Wall-time ceiling: `600s`
- Observed wall time: `600.042s`
- Process timeout: `true`
- Completed usage event: `false`
- Source patch bytes: `0`
- Runner result: `PILOT_INVALID_ACTOR_RUN`
- Runtime Controller: admitted; initialize/active/terminal transitions passed;
  audit digest `2f5b791708d8fedc8747b9ff876757834c071eedc667b9ec90dfc23292ce3f0f`
- Hidden acceptance: not executed
- Valid cells: `0/20`
- Codex dollar cost: unavailable from the CLI usage event contract

The actor's last message stated that its isolated spec reviewer was still
running and that no source edits had been made.

## Harness correction history

Two earlier attempts are excluded from QE interpretation. The old async
`execFile` adapter left Codex stdin open, causing it to wait for additional
input until the wall-time ceiling. The runner now uses a bounded spawn with
stdin explicitly closed, and a regression test proves EOF delivery. The final
smoke result above was collected only after that correction.

## Interpretation

The smoke proves neither that Full SIVS improves quality nor that it reduces
quality. It does show that the current Full SIVS path did not satisfy this
pilot's ten-minute operability gate on a bounded micro-fix. The actor message
supports, but does not independently prove, that the isolated specification
review stage dominated the delay. Do not start the 20-cell pilot or 240-run
main study until this smoke passes reliably.

## Recommended next design

Keep ordinary requests on the native path and keep explicit `Qplan`/`Qgoal` as
the high-assurance entry. Optimize the internal Qplan execution path before
rerunning. The recommended option is a bounded micro-Goal lane that preserves a
predeclared acceptance contract and independent verification but applies a
strict orchestration/time budget to specification and review for one-file,
low-risk work. This is a recommendation from the operability failure, not an
implemented or effectiveness-proven change.
