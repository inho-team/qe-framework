---
name: Qcli-developer
description: Use when building CLI tools, implementing argument parsing, or adding interactive prompts. Invoke for parsing flags and subcommands, displaying progress bars and spinners, generating bash/zsh/fish completion scripts, CLI design, shell completions, and cross-platform terminal applications using commander, click, typer, or cobra.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: devops
triggers: CLI, command-line, terminal app, argument parsing, shell completion, interactive prompt, progress bar, commander, click, typer, cobra
role: specialist
scope: implementation
output-format: code
related-skills: devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# CLI Developer

## Core Workflow

1. **Analyze UX** — Identify user workflows, command hierarchy, common tasks. Validate by listing all commands and their expected `--help` output before writing code.
2. **Design commands** — Plan subcommands, flags, arguments, configuration. Confirm flag naming is consistent and no existing signatures are broken.
3. **Implement** — Build with the appropriate CLI framework for the language (see Reference Guide below). After wiring up commands, run `<cli> --help` to verify help text renders correctly and `<cli> --version` to confirm version output.
4. **Polish** — Add completions, help text, error messages, progress indicators. Verify TTY detection for color output and graceful SIGINT handling.
5. **Test** — Run cross-platform smoke tests; benchmark startup time (target: <50ms).

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Design Patterns | `references/design-patterns.md` | Subcommands, flags, config, architecture |
| Node.js CLIs | `references/node-cli.md` | commander, yargs, inquirer, chalk |
| Python CLIs | `references/python-cli.md` | click, typer, argparse, rich |
| Go CLIs | `references/go-cli.md` | cobra, viper, bubbletea |
| UX Patterns | `references/ux-patterns.md` | Progress bars, colors, help text |

## Quick-Start Example

### Node.js (commander)

```js
#!/usr/bin/env node
// npm install commander
const { program } = require('commander');

program
  .name('mytool')
  .description('Example CLI')
  .version('1.0.0');

program
  .command('greet <name>')
  .description('Greet a user')
  .option('-l, --loud', 'uppercase the greeting')
  .action((name, opts) => {
    const msg = `Hello, ${name}!`;
    console.log(opts.loud ? msg.toUpperCase() : msg);
  });

program.parse();
```

For Python (click/typer) and Go (cobra) quick-start examples, see `references/python-cli.md` and `references/go-cli.md`.

## Constraints

### MUST DO
- Keep startup time under 50ms
- Provide clear, actionable error messages
- Support `--help` and `--version` flags
- Use consistent flag naming conventions
- Handle SIGINT (Ctrl+C) gracefully
- Validate user input early
- Support both interactive and non-interactive modes
- Test on Windows, macOS, and Linux

### MUST NOT DO

- **Block on synchronous I/O unnecessarily** — use async reads or stream processing instead.
- **Print to stdout when output will be piped** — write logs/diagnostics to stderr.
- **Use colors when output is not a TTY** — detect before applying color:
  ```js
  // Node.js
  const useColor = process.stdout.isTTY;
  ```
  ```python
  # Python
  import sys
  use_color = sys.stdout.isatty()
  ```
  ```go
  // Go
  import "golang.org/x/term"
  useColor := term.IsTerminal(int(os.Stdout.Fd()))
  ```
- **Break existing command signatures** — treat flag/subcommand renames as breaking changes.
- **Require interactive input in CI/CD environments** — always provide non-interactive fallbacks via flags or env vars.
- **Hardcode paths or platform-specific logic** — use `os.homedir()` / `os.UserHomeDir()` / `Path.home()` instead.
- **Ship without shell completions** — all three frameworks above have built-in completion generation.

## Output Templates

When implementing CLI features, provide:
1. Command structure (main entry point, subcommands)
2. Configuration handling (files, env vars, flags)
3. Core implementation with error handling
4. Shell completion scripts if applicable
5. Brief explanation of UX decisions

## Code Patterns

### Argument Parser Setup
- Define program metadata first (name, version, description).
- Register all flags/options before parsing user input.
- Use consistent naming: `--flag-name` (kebab-case) across all languages.
- Group related options logically.

### Subcommand Pattern
- Each subcommand is a discrete entry point with its own options.
- Root program provides global flags; subcommands inherit them.
- Example: `mytool config get KEY` → root handles verbosity, `config` subcommand owns `get`, `set`, `list`.

### Interactive Prompt
- Detect TTY before prompting; provide fallback flags for CI/CD.
- Use libraries: Node.js (inquirer), Python (typer/rich), Go (bubbletea/survey).
- Always allow opt-out via `--non-interactive` or env var.

## Comment Template

**JavaScript/TypeScript (JSDoc)**
```js
/**
 * Validates and parses user input.
 * @param {string} input - Raw user input to validate
 * @returns {Object} Parsed config object
 * @throws {Error} If input is malformed
 */
```

**Python (Docstring)**
```python
def parse_config(input_str: str) -> dict:
    """Validate and parse user input.
    
    Args:
        input_str: Raw user input to validate
    
    Returns:
        Parsed config object
    
    Raises:
        ValueError: If input is malformed
    """
```

**Go (GoDoc)**
```go
// ParseConfig validates and parses user input.
// It returns a parsed config object or an error if input is malformed.
func ParseConfig(input string) (map[string]interface{}, error) {
```

## Lint Rules

- **JavaScript/TypeScript**: `eslint` with plugin:commander or plugin:yargs. Enforce consistent option definitions.
- **Python**: `flake8` + `black`. Verify 2 spaces for groups, consistent docstrings.
- **Go**: `golangci-lint` with rules for error handling and naming.
- **Shell scripts**: `shellcheck` (mandatory for completion scripts). Address SC2086 (quote expansion), SC2181 (check exit codes).

## Security Checklist

1. **Input Sanitization** — Validate and trim all user input; reject null bytes, path traversal sequences (`../`, `..\\`).
2. **No Eval on User Input** — Never pass flags/arguments to `eval()`, `exec()`, or `shell=True` interpreters without strict validation.
3. **Secure Credential Storage** — Store secrets in OS credential store (Keychain, pass, 1Password CLI) or encrypted config files; never log credentials.
4. **Path Traversal Prevention** — Resolve all file paths with `path.resolve()` or `os.path.abspath()`; compare against allowed directory prefix.
5. **Dependency Pinning** — Lock all transitive dependencies in `package-lock.json`, `poetry.lock`, or `go.sum`.

## Anti-patterns (Avoid)

1. **No Help Text** — Every command and flag must have a description. Users should understand usage from `--help` alone.
2. **Cryptic Error Messages** — Always explain what went wrong and suggest a fix. Bad: `Error: Invalid`. Good: `Error: Config file not found at ~/.myapp/config.yml. Create one with 'myapp init'.`
3. **Blocking on Input Without Timeout** — Interactive prompts must have a timeout in CI/CD or non-TTY contexts. Provide fallback flags.
4. **Hardcoded Paths** — Use `os.homedir()`, `Path.home()`, or env vars instead of `/home/user` or `C:\Users\User`.
5. **No Exit Codes** — Always exit with non-zero status on error. Define meaningful codes: 1 = generic, 2 = usage, 126 = permission denied.

## Knowledge Reference

CLI frameworks (commander, yargs, oclif, click, typer, argparse, cobra, viper), terminal UI (chalk, inquirer, rich, bubbletea), testing (snapshot testing, E2E), distribution (npm, pip, homebrew, releases), performance optimization
