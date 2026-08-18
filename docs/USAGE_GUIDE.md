# QE Framework Usage Guide

## Start work

Use one public entry point:

```text
Claude: /Qplan "add account recovery"
Codex:  $Qplan "add account recovery"
```

For goal triage, use `/Qgoal` or `$Qgoal`. Small concrete goals can stay direct; larger goals enter the Plan-owned workflow. QE internally performs knowledge retrieval, spec generation, execution, verification, and supervision. Users do not invoke internal stage commands.

## Public skill catalog

| Task | Claude | Codex |
|---|---|---|
| Goal intake | `/Qgoal {goal}` | `$Qgoal {goal}` |
| Plan/start/continue | `/Qplan {intent}` | `$Qplan {intent}` |
| Critical review | `/Qcritical-review` | `$Qcritical-review` |
| Commit | `/Qcommit` | `$Qcommit` |
| Save context | `/Qcompact` | `$Qcompact` |
| Restore context | `/Qresume` | `$Qresume` |
| Update framework | `/Qupdate` | `$Qupdate` |
| Show version | `/Qversion` | `$Qversion` |
| Inspect local QE state | `/Qdashboard` | `$Qdashboard` |
| Set up shell shortcuts | `/Qcc-setup` | `$Qcc-setup` |

`Qgenerate-spec` and `Qexecute` are installed internal contracts used by `Qplan`; they are not public entry points.

`Qdashboard` regenerates `.qe/inspector.html` from the current project's
read-only QE store and opens it locally. Use `--status` for a terminal summary,
`--no-open` to generate only, or `--path` to print the report location. The
dashboard detects the browser language and supports Korean, English, Japanese,
and Simplified Chinese; the selected language and theme stay local to the browser.
It starts with a purpose-oriented work board, explains what each dataset means,
and keeps raw SQLite rows as supporting evidence.

Use `Qdashboard --assistant` only when you want local AI interpretation. It
starts an ephemeral server bound to `127.0.0.1` and lets you choose the locally
logged-in Claude or Codex. Only the question and a compact snapshot context are
sent to that CLI: Claude tools are disabled, Codex uses an ephemeral read-only
sandbox, credentials and conversations are not stored, and account usage may
apply. Stop the attached server with Ctrl+C.

`Qcc-setup` installs `cc`, `ccc`, and `cx` launch shortcuts after confirmation.
Permission-bypass aliases `ccd`, `cxd`, and `cxde` require a separate explicit
opt-in and are never included by default.

## Deterministic tacit-knowledge intake

Broad or ambiguous work starts with a bounded Qplan interview after QE has
looked for answers in the repository. Before asking, QE shows the actual base
question count, the maximum 12 follow-ups, and the batch size of 3. Progress is
stable and visible:

```text
Questions: 30 base, up to 12 follow-ups; 3 per batch. You can pause or stop.
[17/30] What observable outcome would make this complete?
[17-1/3] Which part of that outcome is irreversible?
```

`30` is the actual inventory total, not a promise to ask 30 questions. The
engine caps base questions at 30, active follow-ups at 3 per parent, allocated
follow-ups at 12 overall, and unique issued question versions at 42.

Controls and boundaries:

- `pause` stores the current state; `resume` returns the earliest unresolved
  label. Up to 10 successful resume cycles are allowed.
- After a client restart, a replacement session can use the explicit `claim`
  operation with the observed prior owner UUID and revision. Claim is a CAS
  handoff: stale or terminal state is never overwritten.
- `skip` records an assumption only for an explicitly reversible non-material
  question. Skipping a material or unknown question blocks the intake.
- Answers can be corrected up to 6 times. One re-baseline can replace the
  unresolved base inventory, and synthesis can be corrected twice.
- To opt out, use `stop`; it records a user block without inventing answers. A ceiling that requires decomposition returns
  `split-required`; accepted synthesis returns `confirmed`.

Qplan finalizes ROADMAP, REQUIREMENTS, Goals, and acceptance contracts only
after `confirmed`. In a non-interactive run, QE never invents a material answer:
it preserves the draft and reports the earliest unresolved label.

The resumable record lives at the DB-only logical path
`.qe/planning/plans/{slug}/INTAKE.json`. Mutations require the current revision
and owning session; stale revisions or another session fail without overwriting
the accepted history. A successful explicit ownership claim consumes one revision
and preserves the transfer history. Answers remain typed intake evidence (`source-fact`,
user decision, preference, constraint, assumption, or open question). They do
not become reviewed project-wiki knowledge until a Goal passes normal
verification and completion evidence.

## Administration

```bash
npm run qe:validate
npm run qe:contract -- approve <name> --reason "reviewed"
npm run qe:release -- bump <semver>
npm run check:all
```

Inspect optional local LSP and AST capabilities without installing or downloading anything:

```bash
node scripts/qe-doctor.mjs
node scripts/qe-doctor.mjs --json
```

Missing semantic tools are a supported configuration. The doctor reports why a capability is unavailable and selects an explicit bounded text-search fallback so the workflow can continue safely. See the [semantic tool adapter policy](../core/SEMANTIC_TOOL_ADAPTER.md) for the shared state model and health transitions.

Agent-team workflows may opt into the project-local durable runtime described in
[`core/AGENT_TEAMS.md`](../core/AGENT_TEAMS.md). It records dependency-aware task
claims and at-least-once mailbox delivery in `qe.db`; session resume reclaims
dead or expired-unknown reservations while preserving completed tasks and
unacknowledged messages. It does not recreate live agent processes.

The release CLI first requires the target framework version to be covered by
`core/store/schema-manifest.json`, then updates `package.json`,
`.claude-plugin/plugin.json`, and the marketplace entry together. An uncovered
version fails before any manifest is written. The CLI does not commit, tag,
publish, or push; review the diff and use `Qcommit` separately.

## State and recovery

QE state is DB-backed. Use `node scripts/qe-cat.mjs <.qe/path>` for document reads and `node scripts/qe-query.mjs ...` for structured queries. Use `Qcompact` before ending a long session and `Qresume` to restore it.

For experimental Agent Teams, durable local task claims and mailbox acknowledgements can survive a session restart. Resume reconciliation preserves completed work, requeues expired unacknowledged delivery, and reports members as live, dead, or unknown. It does not resurrect host teammate processes; see [Agent Teams](../core/AGENT_TEAMS.md#durable-coordination-state).

Completed task pairs move to `completed/`; the deterministic Stop sweep archives them. No follow-up archive command is required.

See `QE_CONVENTIONS.md` for workflow invariants and `docs/INSTALL.md` for installation details.
