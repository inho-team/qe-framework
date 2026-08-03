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

`Qgenerate-spec` and `Qexecute` are installed internal contracts used by `Qplan`; they are not public entry points.

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
