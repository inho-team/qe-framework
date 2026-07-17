# Local Skill Collection

`Qcollect-skill` stores verified project-local guidance in `.claude/skills/<skill-name>/SKILL.md`.
These files are local artifacts, not qe-framework distribution payload. They are intentionally
outside `package.json` shipped assets and should not be committed to team repositories.

## VCS Boundary

Generated local skills can change how future sessions behave, so a git project must ignore:

```gitignore
.claude/skills/
```

`Qcollect-skill` checks this before collection. Non-git projects skip the check because there is
no gitignore surface and no team-commit risk to mitigate.

## Execution Model

Collection is manual and foreground-only. SessionStart performs expiry detection only: it reads
scalar frontmatter from `.claude/skills/*/SKILL.md` and pushes a hint when generated skills are
expired. It does not spawn workers, write files, perform network I/O, or read
`.qe/analysis/tech-stack.md`.

Automatic collection is deliberately excluded. Earlier designs made the system repeatedly decide
and execute without user action; this version keeps automatic detection but leaves collection to
an explicit `/Qcollect-skill` call.

No lock is used. Foreground collection is low frequency, and atomic `tmp` plus `rename` writes are
enough for normal replacement. The special overwrite path preserves generations by writing
timestamped backups such as `SKILL.md.2026-07-17T12-00-00Z.bak`.

## TTL Policy

TTL defaults are exported from `scripts/lib/local-skill-collector.mjs`:

- JavaScript, TypeScript, React, Vue, Angular, Next: 90 days
- Python, Java, Spring, Go, Rust: 180 days
- SQL, PostgreSQL: 365 days
- Terraform, Kubernetes: 120 days
- Security: 60 days

`collected_at + ttl_days` is the source of truth. `expires_at` is a display cache and is ignored
when it disagrees with the canonical calculation.

Disable hints with:

```json
{
  "hooks": {
    "skill_expiry_hint_enabled": false
  }
}
```

## Frontmatter Contract

Collected skills require:

```yaml
source: official docs summary
collected_at: 2026-07-17T12:00:00Z
ttl_days: 90
expires_at: 2026-10-15T12:00:00Z
generated_by: Qcollect-skill
content_hash: sha256:...
verification:
  devils_advocate_ran: true
  sources:
    - url: https://example.com/docs
      published_at: 2026-07-01
  conflicting_claims: []
```

`verification.devils_advocate_ran` is still an agent self-declaration, not a hard external proof.
It is not the only gate: `sources` must be non-empty and every source must include `published_at`.

`content_hash` is computed from the body after the non-greedy boundary
`/^---\n([\s\S]*?)\n---\n?/`. This is safe when the body contains `---`. The hash only covers the
body, so frontmatter-only user edits such as changing `ttl_days` are not detected.

Manual skills have no `generated_by` field. They are excluded from expiry hints and collection
overwrites.

## User Edit Protection

For generated skills, a body hash mismatch means the user edited the file. The writer aborts and
tells the user to rerun with `--overwrite-user-edits`, which first creates a timestamped `.bak`.
There is no broad `--force` flag.

Malformed generated skills may be skipped by the read-only hint path. This is the fail-open cost:
SessionStart must not fail because one local skill has broken frontmatter.

## Command Classification

The writer blocks collected content containing install/delete/credential commands and network
pipes such as `curl ... | sh`. Remaining shell commands are annotated with source and risk.
This classification is an LLM-side mitigation and documentation guard, not a sandbox or runtime
permission boundary. Users still approve tools normally when acting on collected guidance.

## Codex Exposure

Codex may not load `.claude/skills` directly. Any Codex adapter sync is a separate future task;
local collection remains Claude-project-local until that adapter exists.
