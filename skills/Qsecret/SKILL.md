---
name: Qsecret
user_invocable: false
description: 'Manage API keys and tokens through OS-backed secret storage so QE can use them without storing plaintext in the project. Supports metadata-only project/global registries plus secure execution with env injection.'
invocation_trigger: When the user wants to store, rotate, list, delete, or safely use API keys, tokens, or other credentials in QE Framework.
recommendedModel: haiku
---

# Qsecret

## Role
Manage secrets for QE Framework without committing plaintext values into the repository.

## Core Policy
- Store secret values in an OS-backed backend when possible.
- Store only metadata in registry files.
- Never print raw secret values in normal QE output.
- Do not ask the user to paste secrets into repository files.
- Direct reveal is intentionally unsupported by the QE CLI.

## Registry Files
- Project metadata: `.qe/secrets/registry.json`
- Global metadata: `~/.qe/secrets/registry.json`

These files contain metadata only:
- secret name
- scope
- env var name
- backend
- timestamps

They do **not** contain the secret value.

## Backends
- Windows: `dpapi-file`
- macOS: `keychain`
- Linux: `libsecret`

### Important Limitation
Windows uses a DPAPI-protected user store by default. This protects the value at rest, but Windows may not force a second password prompt on every read. Explain this clearly if the user asks for Chrome-like re-auth behavior.

## Commands

### Check backend availability
```bash
node scripts/qe_secret.mjs doctor
```

### Store a secret
```bash
node scripts/qe_secret.mjs set openai_api_key --scope global --env OPENAI_API_KEY
```

For non-interactive input:
```bash
printf 'sk-example' | node scripts/qe_secret.mjs set openai_api_key --scope global --env OPENAI_API_KEY --stdin
```

### List metadata
```bash
node scripts/qe_secret.mjs list
node scripts/qe_secret.mjs list --scope project
node scripts/qe_secret.mjs list --scope global
```

### Delete a secret
```bash
node scripts/qe_secret.mjs delete openai_api_key --scope global
```

### Execute a command with secret injection
```bash
node scripts/qe_secret.mjs exec --env-secret OPENAI_API_KEY=openai_api_key -- node app.js
```

This injects the secret into the child process environment without printing the value.

## Expected Behavior
- If the user says "store this API key safely", use `Qsecret`.
- If the user wants project-only metadata, use `--scope project`.
- If the user wants reuse across projects, use `--scope global`.
- If the user wants QE to run a command with a secret, prefer `exec` instead of printing or exporting the raw value.

## Will
- Set, list, delete, and safely use secrets
- Keep plaintext values out of QE metadata files
- Explain platform-specific limitations honestly

## Will Not
- Print secrets to the console in normal flows
- Write secrets into `.env`, `.qe`, or tracked source files unless the user explicitly asks for that insecure behavior
- Pretend that every OS provides the same re-auth prompt behavior
