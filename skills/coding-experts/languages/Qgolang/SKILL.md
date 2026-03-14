---
name: golang
description: Go development standards and practices for zero-fabrication, test-driven development with strict quality gates. Use when working on Go projects that require rigorous testing, real integrations only, and idiomatic Go patterns.
---

# Go Development Skill

**Zero-Fabrication | Test-Driven | Zero-Tolerance**

This skill defines the mandatory standards for Go development. These rules are **non-negotiable** and enforced to ensure consistency, maintainability, and correctness.

## The Golden Rules

1.  **Real Tests Only**: No mocks, no fakes. Tests must hit actual systems (DB, File, API).
2.  **Co-located Tests**: Every `.go` file has a `_test.go` beside it.
3.  **Immutability Preferred**: Unexported fields, constructor functions, value semantics where practical.
4.  **One Responsibility Per File**: Files are small and focused. File name describes the single concept.
5.  **Zero Warnings**: `go vet`, `golangci-lint`, and `gofmt` must be clean. No exceptions.
6.  **"HOW" vs "WHAT"**: 95% of code in `pkg/` (reusable utilities), 5% in `cmd/` (entry points).
7.  **Document Everything**: Go doc comments on ALL exported types, functions, methods, and constants.

## Documentation & Standards

-   **[CODE_RULES.md](skills/CODE_RULES.md)**: Coding standards, naming, style, and prohibited patterns.
-   **[ARCH_RULES.md](skills/ARCH_RULES.md)**: Project structure, file organization, and package layout.
-   **[TEST_RULES.md](skills/TEST_RULES.md)**: Testing philosophy, patterns, and mandatory practices.
-   **[SETUP.md](skills/SETUP.md)**: Project initialization, configuration, and templates.
-   **[EXAMPLES.md](skills/EXAMPLES.md)**: Reference guide to the included example files.
-   **[GIO_UI.md](skills/GIO_UI.md)**: Gio GUI framework — library guide, critical gotchas, cross-platform CGO builds.

## Repository & Project Layout

**Required structure**
```
README.md
.gitignore
run                  # Shell script facade (executable)
src/                 # Go module root (go.mod lives here)
  go.mod
  go.sum
  cmd/               # Entry points (WHAT) ~5%
    myapp/
      main.go
  pkg/               # Reusable packages (HOW) ~95%
    text/
      truncate.go
      truncate_test.go
    net/
      client.go
      client_test.go
  internal/          # Private packages (not importable externally)
output/              # Gitignored runtime outputs
  bin/               # Compiled binaries
  testing/           # Test output/logs/artifacts
local/               # Gitignored large downloads/artifacts
```

**Directory constraints**
- Shallow structure preferred. Once you use subdirectories, place peer packages at the same nesting level.
- Max 20 files per directory. Split into sub-packages if larger.
- No experimental scripts or alt versions at root or anywhere else; use branches for iteration.
- **output/ and local/ must be accessed relative to the project root, not the current working directory.**
- `go.mod` lives inside `src/` so import paths stay clean (no `src/` prefix in imports).
- The `run` script handles all directory navigation internally.

---

## Run Facade (Shell Script)

The `run` tool is a **shell script** named `run` (no extension, executable). It orchestrates by invoking Go toolchain commands. It must not contain business logic.

**Callers never cd into src/** - they just call `./run` or `~/bin/projectname`. The `run` script navigates to `src/` internally.

**~/bin wrapper script** - when creating a `run` for a project, also create a wrapper script in `~/bin/` so the tool is globally accessible:

```bash
# ~/bin/myproject (2 lines, executable)
#!/bin/bash
exec ~/src/myproject/run "$@"
```

This means:
- `~/src/myproject/run` is the real implementation
- `~/bin/myproject` is the global entry point that delegates to it
- Users call `myproject check` from anywhere, never needing to cd

**See [SETUP.md](skills/SETUP.md) for the complete `run` script template.**

---

## Coding Standards (Summary)

**Naming policy**
- Exported: `PascalCase` for types, functions, methods, constants
- Unexported: `camelCase` for fields, local variables, helper functions
- Acronyms: all caps (`HTTP`, `URL`, `ID`, not `Http`, `Url`, `Id`)
- Packages: lowercase, single word, no underscores, no plural (`text` not `texts`)
- Interfaces: single-method interfaces named method + "er" (`Reader`, `Writer`, `Stringer`)

**Documentation policy**
- Go doc comments on ALL exported symbols
- Start with the name being documented: `// Truncate shortens a string to maxLen.`
- Package comments in a `doc.go` file when a package needs overview explanation
- Explain **WHY**, not WHAT

**See [CODE_RULES.md](skills/CODE_RULES.md) for complete standards.**

---

## Error Handling

Go uses error values, not exceptions. The rules:

- **Return errors explicitly.** Every function that can fail returns `error` as the last return value.
- **Check errors immediately.** Never discard an error with `_`.
- **Wrap with context.** Use `fmt.Errorf("operation context: %w", err)` to add meaning.
- **No panic** except truly unrecoverable situations (corrupted internal state).
- **Sentinel errors** for specific cases: `var ErrNotFound = errors.New("not found")`.
- **Error types** when callers need to inspect details: implement the `error` interface.

**Entry-point exception policy**
```go
func main() {
    if err := run(); err != nil {
        fmt.Fprintf(os.Stderr, "error: %v\n", err)
        os.Exit(1)
    }
}
```

**Processing-loop pattern**
```go
// processBatch ensures one bad item does not abort a long batch
// while logging context for triage.
func processBatch(items []string) error {
    var errs []error
    for _, item := range items {
        if err := processOne(item); err != nil {
            log.Printf("processOne failed item=%q err=%v", item, err)
            errs = append(errs, fmt.Errorf("item %q: %w", item, err))
            continue
        }
    }
    return errors.Join(errs...)
}
```

**Context enrichment**
```go
result, err := db.Query(ctx, query)
if err != nil {
    return fmt.Errorf("fetching user %s: %w", userID, err)
}
```

---

## Secrets & Configuration

**Secrets**
- Secrets come only from **keyring** (via `zalando/go-keyring` or similar) or **environment variables** for deployment.
- The literal word `keyring` must **never appear in tests**.
- If secret retrieval fails, return the error; do not stub or override.

**Configuration**
- Internal apps: encode base configuration in code as constants or package-level vars.
- Environment-specific values via environment variables only.
- Use a single `config` package to centralize env var reading.

---

## Testing Policy (Real, Integration-First, Per-File)

- Each `x.go` has `x_test.go` beside it. Same package (white-box testing).
- Use the **standard `testing` package**. No third-party test frameworks.
- All tests are real end-to-end or integration tests. No smoke checks.
- **Run only the specific tests for the file you are working on.**
  - Do **not** run the full suite during development. `./run check` runs everything at the end.
  - Example: `go test ./pkg/text/ -run TestTruncate -count=1`
- Write all test logs and artifacts to `output/testing/`.
- Table-driven tests are the default pattern for multiple cases.
- Use `t.Helper()` in test helpers so failures report the caller's line.
- Use `t.Cleanup()` for teardown, not `defer` in tests.
- Use subtests (`t.Run`) for table-driven tests and logical grouping.

**See [TEST_RULES.md](skills/TEST_RULES.md) for complete testing standards.**

---

## Linting, Warnings, and Quality Gates

- Treat all warnings as errors.
- `gofmt` must produce no changes (formatting is canonical).
- `go vet ./...` must be clean.
- `golangci-lint run` must be clean.
- `go test ./...` must pass with zero failures.
- Run linter after each file, then run only the tests for that file.
- At the end of the task, run `./run check` which runs the full quality gate suite.
- **No commits** without full `./run check` pass.

---

## Prohibited Patterns (Zero-Tolerance)

**Forbidden words in code/tests/comments:**
`simulate`, `mock`, `fake`, `pretend`, `placeholder`, `stub`, `dummy`, `sleep` (in tests), `todo`

**Forbidden patterns:**
- `interface{}` or `any` when a specific type works
- `init()` functions (surprising side effects; wire dependencies explicitly)
- Global mutable state (package-level `var` that gets mutated)
- `panic()` for expected error conditions
- Naked returns in functions longer than a few lines
- Underscore discarding errors: `result, _ := something()`
- `time.Sleep` in tests for synchronization

**Consequences:**
- Any appearance of the above indicates failure of the task.

**What to do instead:**
- If a dependency is missing or a system is unavailable, stop and report a blocker with exact requirements to proceed.

---

## Architecture Heuristics

**Separation of concerns**
- Business rules are thin adapters over generic utilities in `pkg/`.
- Cluster by domain (`pkg/text/`, `pkg/net/`, `pkg/io/`, `pkg/llm/`).

**Stateless first**
- Prefer pure functions that take parameters and return values.
- When state is needed, use structs with unexported fields and constructor functions.

**File and function size signals**
- If a file exceeds ~200-300 lines or a function exceeds ~25 lines, refactor.
- A function with a loop should primarily loop and call a named helper.
- A multi-step function should delegate each step to named helpers.

**Interfaces at the consumer**
- Define interfaces where they are used, not where they are implemented.
- Keep interfaces small: 1-2 methods. Go interfaces are satisfied implicitly.
- Accept interfaces, return concrete types.

**See [ARCH_RULES.md](skills/ARCH_RULES.md) for complete architecture standards.**

---

## Development Workflow

**For each file change:**
1. Write or modify code following the standards above
2. Run formatter: `gofmt -w .` (from `src/`)
3. Run vet: `go vet ./pkg/text/`
4. Run tests for that specific package: `go test ./pkg/text/ -run TestTruncate -count=1 -v`
5. Fix any issues and repeat steps 2-4

**At task completion:**
1. Run `./run check` (full quality gate suite)
2. Ensure all tests pass
3. Ensure no warnings, vet issues, or lint errors
4. Ensure `gofmt` produces no changes
5. Only then commit

**Key Principles:**
- Verify success through **real, individual tests** for the package being worked on
- Write test output to `output/testing/`
- Clean the repository and re-run checks until zero errors
- `./run check` must be green before any commit

**IF YOU VIOLATE THESE RULES, YOU WILL FAIL.**
