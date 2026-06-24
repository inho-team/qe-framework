# QE bench clean-room

Isolated Docker environment for bench-testing the QE framework: a clean Node base
with Claude Code installed, used to install QE and exercise its skills one by one.

Part of plan `qe-docker-bench` (Phase 1). Host stays clean — everything runs in the
container.

## Prerequisites
- Docker running on the host.
- `ANTHROPIC_API_KEY` exported in your shell (only needed for `--smoke` / `--shell`).

## Usage
```bash
# Build only (no key needed — proves Claude Code installs and `claude --version` works)
./run.sh --build

# Build + headless version/auth smoke (needs ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-ant-...
./run.sh --smoke

# Build + interactive shell inside the clean-room (QE repo mounted read-only)
./run.sh --shell

# Full bench: install QE in the container, then bench skills one by one
./run.sh --bench              # functional checks run if ANTHROPIC_API_KEY is set
./run.sh --bench --smoke-only # force no-API mode (load/route checks only)
```

## Bench harness (Phase 2)
`--bench` installs QE in the container (`qe-install.sh`) then runs `bench-runner.mjs`,
which exercises each skill in `scenarios.json` at two depths:

- **smoke** — loads `skills/<skill>/SKILL.md` and validates its frontmatter (no API).
  A one-time `npm run check:routing` baseline is recorded too.
- **functional** — runs headless `claude -p "<invocation>"` and asserts the `expect`
  substring (needs `ANTHROPIC_API_KEY`; skipped as `na` without a key).

### Results
- `bench/RESULTS.md` — human-readable table + a Failures section (committed summary).
- `bench/bench-results/<date>.jsonl` — one row per skill:
  `{skill, tier, smoke, functional, durationMs, notes, repro}` (key-redacted).
  This dir is generated output and is gitignored; `RESULTS.md` is the kept summary.

### Add a skill to the bench
Append an entry to `bench/scenarios.json`:
```json
{ "skill": "Qfoo", "tier": "backbone", "mode": "smoke", "invocation": "/Qfoo", "expect": "" }
```
Use `"mode": "functional"` + a non-empty `"expect"` to actually run it via `claude -p`.

Run a single skill: `node bench/bench-runner.mjs --skills Qfoo`.

## API key hygiene (NFR1 — non-negotiable)
- The key is passed **only** at runtime via `docker run -e ANTHROPIC_API_KEY`.
- It is **never** written to the `Dockerfile`, baked into the image, or committed.
  There is no `ARG`/`ENV` for any key in the Dockerfile by design.
- Verify the image is clean: `docker history --no-trunc qe-bench:latest` shows no key.
- Runtime logs (`.last-smoke.log`, `.key-hygiene.log`) are gitignored.

## What's inside the image
- `node:lts-slim` base, non-root `bench` user.
- `git`, `curl`, `ca-certificates`, `ripgrep`.
- `@anthropic-ai/claude-code@2` (global), verified at build via `claude --version`.

## Next (plan qe-docker-bench)
- Phase 2: install QE in the container + wire the per-skill bench runner & result schema.
- Phase 3: bench the core PSE chain + backbone skills, record every result.
