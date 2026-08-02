# QE Skill Routing

QE exposes a small public command surface and keeps Plan/Spec/Execute choreography inside the framework.

## Public commands

| Skill | Responsibility |
|---|---|
| `Qgoal` | Classify a goal as direct work or a Plan-owned workflow |
| `Qplan` | Bootstrap, plan, and control the complete Goal loop |
| `Qcritical-review` | Adversarial, debate, or risk-focused review |
| `Qcommit` | Review, stage, and commit scoped changes |
| `Qcompact` | Save resumable context |
| `Qresume` | Restore saved context |
| `Qupdate` | Update installed framework assets |
| `Qversion` | Show installed/source version information |

Claude uses `/Q...`; Codex uses `$Q...`.

## Internal stages

`Qgenerate-spec` and `Qexecute` remain shipped because `Qplan` uses their contracts internally. They have `user_invocable: false` and must never appear as a copied next command, intent-route target, or user decision.

```text
Qgoal or Qplan
  └─ Qplan controller
      ├─ knowledge preflight
      ├─ Qgenerate-spec (internal)
      ├─ Qexecute (internal)
      └─ verification/supervision (internal)
```

State-aware hook hints always route back to `Qplan`. A pending spec UUID, dirty worktree, or completed phase changes the controller context, not the public command.

## Priority

1. Explicit invocation of a public skill
2. Active Goal/Plan state
3. Deterministic intent route
4. Direct specialist agent for bounded research, debugging, review, tests, docs, or PM work
5. `Qplan` for new or continuing workflow work

Safety hooks may hard-block raw commits and direct version edits. Use `Qcommit` for commits and `npm run qe:release -- bump <semver>` for release metadata.
