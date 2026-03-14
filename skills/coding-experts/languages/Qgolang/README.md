# Go Development Skill

A Claude Code skill that enforces strict Go development standards with zero-fabrication testing, idiomatic Go patterns, and rigorous quality gates.

## Purpose

This skill provides mandatory coding standards and architectural rules for Go projects. It ensures:

- **Zero-fabrication testing**: All tests hit real systems - no mocks, no fakes, no stubs
- **Co-located tests**: `_test.go` files beside every source file (Go convention)
- **Idiomatic Go**: Error values, small interfaces, composition over inheritance
- **Clean architecture**: Clear separation between reusable packages and entry points
- **Zero tolerance for warnings**: `go vet`, `golangci-lint`, and `gofmt` must be clean

## How to Use

Invoke the skill when working on Go projects:

```
/golang
```

The skill will guide Claude to follow strict Go development standards including:

- One concept per file with co-located `_test.go`
- Table-driven tests with the standard `testing` package
- Typed constants instead of raw iota enums
- Constructor functions with unexported fields
- Go doc comments on all exported symbols

## Examples

### Creating a New Service

When you ask Claude to create a service:

```
Create a UserService that handles user registration
```

Claude will generate code following the skill's patterns:
- `NewUserService()` constructor function with dependency injection
- Unexported fields, exposed through methods
- Error returns (not panics) for all fallible operations
- Co-located `_test.go` with table-driven tests

### Adding Typed Constants (Smart Enum)

When you need an enumeration:

```
Create a PaymentStatus type with Pending, Completed, and Failed states
```

Claude will create a typed constant pattern with:
- Unexported struct fields, exported variables
- `String()` method implementing `fmt.Stringer`
- Encapsulated behavior methods
- `AllStatuses()` function for iteration
- Full test coverage

### Writing Utility Functions

When you need reusable helpers:

```
Add a string truncation function to the text package
```

Claude will add to the appropriate package:
- Pure function with error return for invalid inputs
- Go doc comment explaining why the function exists
- Co-located table-driven tests covering edge cases

## Key Standards Enforced

| Rule | Description |
|------|-------------|
| Co-located Tests | `_test.go` beside every `.go` file |
| No Mocks | Tests must hit real systems |
| Error Values | Return `error`, never `panic` for expected conditions |
| Constructor Functions | `New[Type]()` with unexported fields |
| Small Interfaces | 1-2 methods, defined at the consumer |
| Table-Driven Tests | Standard `testing` package, subtests |
| Zero Warnings | `go vet` + `golangci-lint` + `gofmt` clean |
| No `init()` | Wire dependencies explicitly in `main` |

## Project Structure

The skill enforces this directory structure:

```
myproject/
├── run                # Shell script facade
├── .gitignore
├── src/               # Go module root (go.mod here)
│   ├── cmd/           # Entry points (WHAT) ~5%
│   │   └── myapp/
│   │       └── main.go
│   ├── pkg/           # Reusable packages (HOW) ~95%
│   │   └── text/
│   │       ├── truncate.go
│   │       └── truncate_test.go
│   └── internal/      # Private packages (optional)
├── output/            # Build artifacts (gitignored)
│   ├── bin/
│   └── testing/
└── local/             # Local-only files (gitignored)
```

## Quick Reference

### Test Naming
```
Test[Function][Scenario]
```
Example: `TestProcessOrderValidInputReturnsConfirmation`

### Constructor Pattern
```go
func NewService(logger Logger) *Service {
    return &Service{logger: logger}
}
```

### Test Helper Pattern
```go
func newTestService(t *testing.T) *Service {
    t.Helper()
    return NewService(discardLogger())
}
```

### Table-Driven Test Pattern
```go
func TestTruncate(t *testing.T) {
    tests := []struct {
        name string
        input string
        want  string
    }{
        {name: "ShortString", input: "Hi", want: "Hi"},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Truncate(tt.input)
            if got != tt.want {
                t.Errorf("got %q, want %q", got, tt.want)
            }
        })
    }
}
```

### Run Script Commands
```bash
./run build              # Build all binaries to output/bin/
./run test ./pkg/text/   # Run tests for a specific package
./run lint               # Run gofmt + go vet + golangci-lint
./run check              # Full quality gate (lint + all tests)
./run run                # Build and run the main binary
```
