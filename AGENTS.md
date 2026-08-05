# AGENTS.md

## Project

- Name: `@inho-team/qe-framework`
- Purpose: spec-driven task execution framework for Claude Code (v4.0 Claude-first architecture)
- Version sync: `package.json` and `.claude-plugin/plugin.json` must stay aligned

## Structure

- `skills/`: user-facing QE skills; each skill lives in its own folder with `SKILL.md`
- `agents/`: background agents, usually `E*.md`
- `.claude-plugin/`: Claude plugin manifest and shipped assets
- `hooks/scripts/`: lifecycle hook implementations
- `scripts/`: operational CLIs and validators
- `core/`: shared schemas, rules, and runtime context definitions
- `docs/`: user-facing documentation and setup guides

## Key Files (v5.x)

- `scripts/validate_svs_config.mjs` — SIVS config (sivs-config.json) validator
- `scripts/lib/codex_bridge.mjs` — Optional Codex plugin bridge utility for extended agent support
- `core/schemas/svs-config.schema.json` — JSON schema for SIVS config validation
- `CLAUDE.md` — Project architecture and constraints (Claude-first, SIVS decisions)

## Working Rules

- Prefer minimal, surgical changes that preserve existing skill and agent naming patterns
- When changing workflow behavior, check whether `README.md`, `QE_CONVENTIONS.md`, or relevant docs under `docs/` also need updates
- When changing install or packaging behavior, verify both npm package assets and Claude plugin assets are still coherent
- When updating versions or release notes, change both `package.json` and `.claude-plugin/plugin.json`
- Do not rename published skills, agents, or CLI entrypoints unless explicitly requested

## Validation

- Use targeted validation first; this repo does not expose a single default test script in `package.json`
- For SIVS config validation, use `npm run qe:validate` (runs `scripts/validate_svs_config.mjs`)
- Direct script execution available under `scripts/`
- If a change touches installation flow, review `install.js`, `uninstall.js`, and `scripts/lib/client_installers.mjs`

## Documentation

- Start with `README.md` for install and usage entry points
- Use `QE_CONVENTIONS.md` for QE-specific workflow and naming conventions
- Use `docs/DOCUMENTATION_MAP.md` when changes affect discoverability across docs

## Response Style

- <!-- qe:response-language=latest-user-message -->
- Reply in the language of the user's most recent message. Use a stored language profile only when that message has no detectable natural language.
- Keep explanations concise and technical as needed
