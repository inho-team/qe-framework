# Coding Rules & Standards

## 1. Naming & Style

-   **Exported**: `PascalCase` for types, functions, methods, constants, interfaces.
-   **Unexported**: `camelCase` for fields, local variables, helper functions.
-   **Acronyms**: All caps: `HTTP`, `URL`, `ID`, `JSON`, `SQL` (not `Http`, `Url`, `Id`).
-   **Packages**: Lowercase, single word, no underscores, no plural (`text` not `texts`, `auth` not `authentication`).
-   **Interfaces**: Single-method interfaces named method + "er" (`Reader`, `Writer`, `Stringer`). Multi-method interfaces use a descriptive noun.
-   **Receivers**: Short, 1-2 letter, consistent across all methods of a type (`s` for `Service`, `c` for `Client`).
-   **Test Functions**: `Test[Function][Scenario]` in PascalCase. Example: `TestTruncateShortStringUnchanged`.
-   **Constructors**: `New[Type]` for constructor functions. Example: `NewService(logger Logger) *Service`.

## 2. Immutability & Value Semantics

-   **Unexported fields**: Struct fields are unexported by default. Expose via methods, not public fields.
-   **Constructor functions**: Use `New[Type]()` factory functions instead of allowing direct struct literal construction for types with invariants.
-   **Value receivers**: Use value receivers for methods that do not mutate state. Pointer receivers only when mutation is needed or the struct is large.
-   **Copy safety**: When returning slices or maps from a struct, return a copy, not the internal reference.
-   **Constants**: Use `const` for values known at compile time. Group related constants in a `const` block.

## 3. Typed Constants (Smart Enum Equivalent)

Go has no class-based enum. Use this pattern instead:

```go
// Status represents the processing state of an order.
type Status struct {
    value string
    code  int
}

// String returns the human-readable name.
func (s Status) String() string { return s.value }

// Code returns the numeric identifier.
func (s Status) Code() int { return s.code }

// IsTerminal reports whether the status represents a final state.
func (s Status) IsTerminal() bool {
    return s == StatusCompleted || s == StatusFailed
}

var (
    StatusPending   = Status{value: "Pending", code: 1}
    StatusCompleted = Status{value: "Completed", code: 2}
    StatusFailed    = Status{value: "Failed", code: 3}
)

// AllStatuses returns every defined status value.
func AllStatuses() []Status {
    return []Status{StatusPending, StatusCompleted, StatusFailed}
}
```

*See `status.go` example.*

## 4. Error Handling

-   **Return errors**: Every function that can fail returns `error` as the last value.
-   **Check immediately**: Never discard errors with `_`. Handle or propagate every error.
-   **Wrap with context**: `fmt.Errorf("fetching user %s: %w", id, err)`.
-   **Sentinel errors**: `var ErrNotFound = errors.New("not found")` for specific conditions callers check.
-   **Error types**: Implement the `error` interface when callers need structured details.
-   **No panic**: Never `panic()` for expected error conditions. Reserve for truly unrecoverable corruption.
-   **No log-and-return**: Either log the error OR return it. Never both (causes duplicate noise).

## 5. Documentation

-   **Mandatory**: Go doc comments on ALL exported types, functions, methods, and constants.
-   **Format**: Start with the name being documented. `// Truncate shortens a string to maxLen.`
-   **Content**: Explain **WHY**, not WHAT. The code shows what; the comment explains the reason.
-   **Package docs**: Add `doc.go` with a package comment when a package needs an overview.
-   **No stutter**: Do not repeat the package name. `// text.Truncate` not `// text.TextTruncate`.

## 6. Function Design

-   **Small**: Functions should be short enough to read without scrolling. ~25 lines max.
-   **Single responsibility**: Each function does one thing.
-   **Parameters**: Accept the narrowest interface that works. Return concrete types.
-   **Named returns**: Only use for very short functions where it aids clarity. Never use naked returns in functions longer than ~5 lines.
-   **Context**: Functions that do I/O or may block should accept `context.Context` as the first parameter.
-   **Options pattern**: For functions with many optional parameters, use the functional options pattern:
    ```go
    type Option func(*Config)

    func WithTimeout(d time.Duration) Option {
        return func(c *Config) { c.timeout = d }
    }

    func NewClient(opts ...Option) *Client { ... }
    ```

## 7. Concurrency

-   **No premature goroutines**: Do not add concurrency until profiling shows it is needed.
-   **Structured concurrency**: Every goroutine must have a clear owner, shutdown path, and error propagation.
-   **`errgroup`**: Use `golang.org/x/sync/errgroup` for coordinating goroutine groups with error handling.
-   **Channels for communication, mutexes for state**: Use the right tool.
-   **Context cancellation**: All long-running goroutines must respect `context.Context` cancellation.

## 8. Prohibited Patterns (Zero Tolerance)

-   `interface{}` / `any` when a specific type or generic constraint works
-   `init()` functions (wire dependencies explicitly in `main`)
-   Global mutable state (package-level `var` that gets mutated at runtime)
-   `panic()` for expected error conditions
-   Naked returns in functions longer than ~5 lines
-   Discarding errors: `result, _ := something()`
-   `time.Sleep` in tests for synchronization
-   Horizontal-layer package names: `utils/`, `helpers/`, `common/`, `models/`, `services/`
-   `TODO` comments
-   Mutable exported fields on structs
-   `log.Fatal` or `os.Exit` outside of `main()`
