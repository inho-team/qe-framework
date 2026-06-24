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
```

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
