---
name: Qgolang
description: Go development standards and practices for zero-fabrication, test-driven development with strict quality gates. Use when working on Go projects that require rigorous testing, real integrations only, and idiomatic Go patterns.
---

# Go Development Skill

**Zero-Fabrication | Test-Driven | Zero-Tolerance**

Mandatory standards for Go development — non-negotiable.

## The Golden Rules

1. **Real Tests Only**: No mocks, no fakes. Tests hit actual systems (DB, File, API).
2. **Co-located Tests**: Every `.go` file has a `_test.go` beside it.
3. **Immutability Preferred**: Unexported fields, constructor functions, value semantics.
4. **One Responsibility Per File**: Small, focused files. Name describes the concept.
5. **Zero Warnings**: `go vet`, `golangci-lint`, `gofmt` must be clean.
6. **"HOW" vs "WHAT"**: 95% in `pkg/` (reusable), 5% in `cmd/` (entry points).
7. **Document Everything**: Go doc comments on ALL exported symbols.

## Documentation References

- **[CODE_RULES.md](skills/CODE_RULES.md)**: Coding standards, naming, style
- **[ARCH_RULES.md](skills/ARCH_RULES.md)**: Project structure, package layout
- **[TEST_RULES.md](skills/TEST_RULES.md)**: Testing philosophy and practices
- **[SETUP.md](skills/SETUP.md)**: Project initialization, templates
- **[EXAMPLES.md](skills/EXAMPLES.md)**: Reference examples
- **[GIO_UI.md](skills/GIO_UI.md)**: Gio GUI framework guide

## Repository Layout

```
README.md
.gitignore
run                  # Shell script facade (executable)
src/                 # Go module root (go.mod lives here)
  go.mod / go.sum
  cmd/               # Entry points (WHAT) ~5%
  pkg/               # Reusable packages (HOW) ~95%
  internal/          # Private packages
output/              # Gitignored runtime outputs (bin/, testing/)
local/               # Gitignored large downloads
```

**Directory constraints:** Shallow structure; max 20 files/dir; `go.mod` in `src/`; `output/` and `local/` accessed relative to project root.

## Run Facade

The `run` shell script orchestrates Go toolchain commands. No business logic in it.

- Callers never cd into `src/` — `run` navigates internally
- Create `~/bin/projectname` wrapper: `exec ~/src/myproject/run "$@"`
- See [SETUP.md](skills/SETUP.md) for template

## Coding Standards

| Category | Rule |
|----------|------|
| Exported | `PascalCase` for types, functions, methods, constants |
| Unexported | `camelCase` for fields, locals, helpers |
| Acronyms | All caps: `HTTP`, `URL`, `ID` |
| Packages | Lowercase, single word, no underscores, no plural |
| Interfaces | Single-method: method + "er" (`Reader`, `Writer`) |
| Documentation | Go doc on all exported symbols; start with the name; explain WHY |

See [CODE_RULES.md](skills/CODE_RULES.md) for complete standards.

## Error Handling

- Return errors explicitly; check immediately; never discard with `_`
- Wrap with context: `fmt.Errorf("operation: %w", err)`
- No panic except truly unrecoverable situations
- Sentinel errors: `var ErrNotFound = errors.New("not found")`
- Entry-point pattern: `if err := run(); err != nil { fmt.Fprintf(os.Stderr, "error: %v\n", err); os.Exit(1) }`
- Batch pattern: collect errors with `errors.Join(errs...)`

## Secrets & Configuration

- Secrets from **keyring** or **environment variables** only
- The word `keyring` must never appear in tests
- Config via single `config` package; env vars for environment-specific values

## Testing Policy

- Each `x.go` has `x_test.go` beside it (same package, white-box)
- Standard `testing` package only — no third-party frameworks
- All tests are real integration tests; no smoke checks
- Run only specific tests during dev: `go test ./pkg/text/ -run TestTruncate -count=1`
- Table-driven tests default; use `t.Helper()`, `t.Cleanup()`, `t.Run()`
- Write test artifacts to `output/testing/`

See [TEST_RULES.md](skills/TEST_RULES.md) for complete standards.

## Quality Gates

- `gofmt` must produce no changes
- `go vet ./...` must be clean
- `golangci-lint run` must be clean
- `go test ./...` must pass with zero failures
- Run `./run check` at task completion — no commits without full pass

## Prohibited Patterns

**Forbidden words:** `simulate`, `mock`, `fake`, `pretend`, `placeholder`, `stub`, `dummy`, `sleep` (in tests), `todo`

**Forbidden patterns:** `interface{}`/`any` when specific type works; `init()` functions; global mutable state; `panic()` for expected errors; naked returns; `_ := something()`; `time.Sleep` in tests.

**Consequence:** Any violation = task failure. If dependency unavailable, stop and report blocker.

## Architecture Heuristics

- Business rules are thin adapters over generic `pkg/` utilities
- Prefer pure functions; use structs with unexported fields when state needed
- File >200-300 lines or function >25 lines = refactor signal
- Define interfaces at consumer, not implementer; keep small (1-2 methods)

See [ARCH_RULES.md](skills/ARCH_RULES.md) for complete standards.

## Development Workflow

**Per file:** 1) Write/modify code → 2) `gofmt -w .` → 3) `go vet ./pkg/...` → 4) `go test ./pkg/... -run TestX -count=1 -v` → 5) Fix and repeat

**At task completion:** `./run check` (full suite) → all green → commit
