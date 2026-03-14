# Testing Rules

## 1. Core Philosophy

-   **Real Tests Only**: Hit actual systems (DB, File, API). No mocks, no fakes, no stubs.
-   **Zero Fabrication**: If it fails in the real world, the test should fail.
-   **Standard Library**: Use the built-in `testing` package. No third-party test frameworks (no testify, no gomega, no gocheck).

## 2. Test Organization

-   **Co-located Tests**: Every `x.go` has `x_test.go` beside it in the same directory.
-   **Same package**: Tests use the same package name (white-box testing), not `package foo_test`.
-   **One test file per source file**: Do not put all tests in a single file.

## 3. Test Naming

-   **Format**: `Test[Function][Scenario]` in PascalCase.
-   **Prefix**: MUST start with `Test` (Go convention).
-   **Descriptive**: The name should tell you what is being tested and under what conditions.
-   **Examples**:
    -   `TestTruncateShortStringUnchanged` (good)
    -   `TestTruncateLongStringAddsEllipsis` (good)
    -   `TestTruncateInvalidMaxLenReturnsError` (good)
    -   `TestTruncate` (bad - too vague)
    -   `Test_truncate_short` (bad - underscores)

## 4. Table-Driven Tests

Table-driven tests are the **default pattern** for testing multiple cases. Use them whenever a function has more than two meaningful test cases.

```go
func TestTruncate(t *testing.T) {
    tests := []struct {
        name   string
        input  string
        maxLen int
        want   string
    }{
        {name: "ShortStringUnchanged", input: "Hello", maxLen: 10, want: "Hello"},
        {name: "ExactLengthUnchanged", input: "Hello", maxLen: 5, want: "Hello"},
        {name: "LongStringTruncated", input: "Hello World", maxLen: 8, want: "Hello..."},
        {name: "EmptyStringUnchanged", input: "", maxLen: 10, want: ""},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Truncate(tt.input, tt.maxLen)
            if got != tt.want {
                t.Errorf("Truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
            }
        })
    }
}
```

## 5. Test Helpers

-   **`t.Helper()`**: Call `t.Helper()` at the start of every test helper function. This ensures failures report the caller's line, not the helper's.
-   **`t.Cleanup()`**: Use `t.Cleanup()` for teardown, not `defer` in tests. Cleanup functions run even if the test panics.
-   **Helper location**: Place test helpers in the `_test.go` file where they are used. If shared across packages, place in a `testhelper/` package under `internal/`.

```go
// newTestDB creates a real test database connection and registers cleanup.
func newTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
    if err != nil {
        t.Fatalf("connecting to test database: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    return db
}
```

## 6. Constructor Helpers for Tests

When a type has dependencies, provide a test constructor in the `_test.go` file:

```go
// newTestService creates a Service suitable for testing with real dependencies.
func newTestService(t *testing.T) *Service {
    t.Helper()
    logger := log.New(io.Discard, "", 0)
    return NewService(logger)
}
```

**Rules:**
-   Must be callable with only `*testing.T` as the required argument.
-   Wire real dependencies. If an external system is unavailable, skip the test with `t.Skip("requires database")`, not a fake.
-   Name: `newTest[Type]`.

## 7. Error Testing

Test that errors occur where expected:

```go
func TestTruncateInvalidMaxLenReturnsError(t *testing.T) {
    _, err := Truncate("Hello", 2)
    if err == nil {
        t.Fatal("expected error for maxLen < 4, got nil")
    }
}
```

For sentinel errors:

```go
func TestFetchUserNotFoundReturnsErrNotFound(t *testing.T) {
    _, err := FetchUser(ctx, "nonexistent-id")
    if !errors.Is(err, ErrNotFound) {
        t.Fatalf("got %v, want ErrNotFound", err)
    }
}
```

## 8. TestMain for Shared Setup

When a package's tests all need the same expensive setup (database, server), use `TestMain`:

```go
func TestMain(m *testing.M) {
    // Setup: start real test database
    pool, err := setupTestDB()
    if err != nil {
        fmt.Fprintf(os.Stderr, "test setup failed: %v\n", err)
        os.Exit(1)
    }

    code := m.Run()

    // Teardown: clean up
    pool.Close()
    os.Exit(code)
}
```

## 9. Plugin Pattern for Expensive Operations

When a function hits an expensive external system (printer, payment gateway), define an interface and provide at least two real implementations:

```go
// Sender delivers notifications through a real channel.
type Sender interface {
    Send(ctx context.Context, msg Message) error
}

// EmailSender sends via SMTP.
type EmailSender struct { /* real SMTP config */ }

// LogSender writes to a log file for environments without email.
type LogSender struct { /* writes to output/testing/ */ }
```

Run the same test suite against both implementations. In production, wire either. This is NOT mocking - both implementations are real and do real work.

## 10. LLM / Expensive Call Memoization

For LLM calls or costly API requests, use **memoization** keyed by full parameters. Identical calls hit cache, but single runs remain fully real.

```go
var embeddingCache sync.Map

// Embed returns the embedding for the given text, caching results to avoid
// repeated calls to the external API during test runs.
func Embed(model, text string) ([]float64, error) {
    key := model + "|" + text
    if v, ok := embeddingCache.Load(key); ok {
        return v.([]float64), nil
    }
    result, err := callEmbedAPI(model, text)
    if err != nil {
        return nil, err
    }
    embeddingCache.Store(key, result)
    return result, nil
}
```

## 11. Forbidden in Tests

-   `time.Sleep` for synchronization (use channels, `sync.WaitGroup`, or polling with deadline)
-   `mock`, `fake`, `stub`, `dummy` in any form
-   `t.Skip` to avoid fixing a broken test (only to skip when an external resource is genuinely unavailable)
-   Ignoring test output or swallowing errors
-   Tests that pass by doing nothing
