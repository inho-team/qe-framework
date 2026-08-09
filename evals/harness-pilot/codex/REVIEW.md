# Independent Integrity Review

## Verdict

**FAIL — operability gate not met.** Do not run the 20-cell pilot or the
240-run main study yet.

## Resolved integrity findings

- **Hidden scorer isolation: PASS.** Actor baselines are sanitized archives
  without git history, the hidden fixture, or prior evaluation outputs. The
  hidden scorer remains outside the actor prompt and workspace.
- **Durable treatment: PASS.** Durable arms require Runtime Controller
  admission, initialize, active, terminal, and audit-digest evidence.
  Ephemeral arms require `controller: null`.
- **Native/Full isolation: PASS.** Native disables QE control surfaces and
  project instructions; Full retains them and invokes `$Qplan`. Model, effort,
  sandbox, source revision, task text, and ceilings remain shared.
- **Invalid-run handling: PASS.** A missing completed usage event is rejected
  before hidden scoring or balanced dataset generation.
- **Stdin regression: PASS.** The actor process closes stdin explicitly, and a
  regression test proves EOF delivery.

## Blocking evidence

The preregistered `email-normalization / full-sivs-durable` smoke reached the
600-second wall-time ceiling with `timedOut=true`, no completed usage event,
zero recorded model tokens, no source patch, and valid Controller lifecycle
evidence. The actor's last message said its isolated specification reviewer was
still running. That message supports but does not prove the reviewer was the
dominant bottleneck.

## Interpretation limits

The Controller is measured as a persistent execution envelope; it does not
schedule or recover the actor's internal model steps. The smoke contains no
quality score, so it cannot establish a positive or negative QE quality effect.

## Recommendation

Keep native execution for ordinary requests and explicit `Qplan`/`Qgoal` for
high assurance. Before rerunning, implement and independently verify a bounded
micro-Goal lane for low-risk, one-file work, then require this same Full-durable
smoke to pass reliably under the shared ceiling.

Independent reviewer: `critical_review` (fresh review, no code edits).
