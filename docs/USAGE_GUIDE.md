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

The release CLI updates `package.json`, `.claude-plugin/plugin.json`, and the marketplace entry together. It does not commit, tag, publish, or push; review the diff and use `Qcommit` separately.

## State and recovery

QE state is DB-backed. Use `node scripts/qe-cat.mjs <.qe/path>` for document reads and `node scripts/qe-query.mjs ...` for structured queries. Use `Qcompact` before ending a long session and `Qresume` to restore it.

Completed task pairs move to `completed/`; the deterministic Stop sweep archives them. No follow-up archive command is required.

See `QE_CONVENTIONS.md` for workflow invariants and `docs/INSTALL.md` for installation details.
