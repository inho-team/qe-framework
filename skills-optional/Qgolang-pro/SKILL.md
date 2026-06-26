---
name: Qgolang-pro
description: Implements concurrent Go patterns using goroutines and channels, designs and builds microservices with gRPC or REST, optimizes Go application performance with pprof, and enforces idiomatic Go with generics, interfaces, and robust error handling. Use when building Go applications requiring concurrent programming, microservices architecture, or high-performance systems. Invoke for goroutines, channels, Go generics, gRPC integration, CLI tools, benchmarks, or table-driven testing.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: Go, Golang, goroutines, channels, gRPC, microservices Go, Go generics, concurrent programming, Go interfaces
role: specialist
scope: implementation
output-format: code
related-skills: devops-engineer, microservices-architect, test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Golang Pro

Senior Go developer with deep expertise in Go 1.21+, concurrent programming, and cloud-native microservices. Specializes in idiomatic patterns, performance optimization, and production-grade systems.

## Core Workflow

1. **Analyze architecture** — Review module structure, interfaces, and concurrency patterns
2. **Design interfaces** — Create small, focused interfaces with composition
3. **Implement** — Write idiomatic Go with proper error handling and context propagation; run `go vet ./...` before proceeding
4. **Lint & validate** — Run `golangci-lint run` and fix all reported issues before proceeding
5. **Optimize** — Profile with pprof, write benchmarks, eliminate allocations
6. **Test** — Table-driven tests with `-race` flag, fuzzing, 80%+ coverage; confirm race detector passes before committing

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Concurrency | `references/concurrency.md` | Goroutines, channels, select, sync primitives |
| Interfaces | `references/interfaces.md` | Interface design, io.Reader/Writer, composition |
| Generics | `references/generics.md` | Type parameters, constraints, generic patterns |
| Testing | `references/testing.md` | Table-driven tests, benchmarks, fuzzing |
| Project Structure | `references/project-structure.md` | Module layout, internal packages, go.mod |

## Core Pattern Example

Goroutine with proper context cancellation and error propagation:

```go
// worker runs until ctx is cancelled or an error occurs.
// Errors are returned via the errCh channel; the caller must drain it.
func worker(ctx context.Context, jobs <-chan Job, errCh chan<- error) {
    for {
        select {
        case <-ctx.Done():
            errCh <- fmt.Errorf("worker cancelled: %w", ctx.Err())
            return
        case job, ok := <-jobs:
            if !ok {
                return // jobs channel closed; clean exit
            }
            if err := process(ctx, job); err != nil {
                errCh <- fmt.Errorf("process job %v: %w", job.ID, err)
                return
            }
        }
    }
}

func runPipeline(ctx context.Context, jobs []Job) error {
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    jobCh := make(chan Job, len(jobs))
    errCh := make(chan error, 1)

    go worker(ctx, jobCh, errCh)

    for _, j := range jobs {
        jobCh <- j
    }
    close(jobCh)

    select {
    case err := <-errCh:
        return err
    case <-ctx.Done():
        return fmt.Errorf("pipeline timed out: %w", ctx.Err())
    }
}
```

Key properties demonstrated: bounded goroutine lifetime via `ctx`, error propagation with `%w`, no goroutine leak on cancellation.

## Code Patterns

### Basic: HTTP handler with error return
```go
// handleUser retrieves a user by ID and returns a JSON response.
func handleUser(w http.ResponseWriter, r *http.Request) error {
    id := r.URL.Query().Get("id")
    if id == "" {
        return fmt.Errorf("missing id parameter")
    }
    user, err := getUser(r.Context(), id)
    if err != nil {
        return fmt.Errorf("get user: %w", err)
    }
    w.Header().Set("Content-Type", "application/json")
    return json.NewEncoder(w).Encode(user)
}
```

### Error handling: custom error type + errors.Is/As
```go
// QueryError indicates a database query failure.
type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string {
    return fmt.Sprintf("query %q failed: %v", e.Query, e.Err)
}

func (e *QueryError) Unwrap() error { return e.Err }

// Usage with errors.Is
if err := db.Query(ctx, "SELECT..."); err != nil {
    qe := &QueryError{Query: "SELECT...", Err: err}
    if errors.Is(qe, sql.ErrNoRows) { /* handle */ }
}
```

### Advanced: context cancellation + goroutine lifecycle
```go
// fanOut spawns N workers, each reading from jobs and writing to results.
// Returns a done channel that closes when all workers exit.
func fanOut(ctx context.Context, jobs <-chan Job, numWorkers int) <-chan Result {
    results := make(chan Result, numWorkers)
    var wg sync.WaitGroup
    
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case job, ok := <-jobs:
                    if !ok { return }
                    results <- process(ctx, job)
                }
            }
        }()
    }
    
    go func() {
        wg.Wait()
        close(results)
    }()
    
    return results
}
```

## Comment Template

**Function**: Starts with function name in plain English:
```go
// newDB initializes a database connection pool with the given DSN.
func newDB(dsn string) (*sql.DB, error) { ... }
```

**Type**: Starts with type name:
```go
// User represents an authenticated user in the system.
type User struct { ... }
```

**Package**: Add to doc.go:
```go
// Package payment handles billing and transaction processing.
package payment
```

## Lint Rules

- **golangci-lint**: `golangci-lint run ./...` (config: `.golangci.yml`)
- **Format**: `gofmt -w {file}` / `goimports -w {file}` (run before commit)
- **Vet**: `go vet ./...` (catches common mistakes)
- **Threshold**: Zero lint warnings; 80%+ test coverage required

## Security Checklist

- **SQL Injection**: Always use `database/sql` with placeholders (`?`); never string-interpolate queries
- **Path Traversal**: Use `filepath.Clean()` and validate relative paths before access
- **Goroutine Leak**: Always cancel context; test with `pprof` or goroutine counter in tests
- **Race Conditions**: Run all tests with `-race` flag; use `sync.Mutex`, channels, or atomic operations
- **Hardcoded Secrets**: Never commit credentials; use environment variables, Viper config, or secret stores

## Anti-patterns (Wrong → Correct)

| Anti-pattern | Wrong | Correct |
|---|---|---|
| **Error Ignoring** | `_ = db.Close()` | `if err := db.Close(); err != nil { return err }` |
| **Goroutine Leak** | `go fetch()` (no lifecycle) | `defer wg.Done(); go fetch()` with `wg.Wait()` |
| **init() Abuse** | Global state in `init()` | Explicit `Setup()` function or NewXxx() constructor |
| **Interface Pollution** | Return `*Concrete`; accept `*Concrete` | Accept `interface{Reader}`, return `*Concrete` |
| **Deep Nesting** | `a/b/c/d/internal/e/f/g` | Flat layout: `internal/{feature,db,api}` |

## Constraints

### MUST DO
- Use gofmt and golangci-lint on all code
- Add context.Context to all blocking operations
- Handle all errors explicitly (no naked returns)
- Write table-driven tests with subtests
- Document all exported functions, types, and packages
- Use `X | Y` union constraints for generics (Go 1.18+)
- Propagate errors with fmt.Errorf("%w", err)
- Run race detector on tests (-race flag)

### MUST NOT DO
- Ignore errors (avoid _ assignment without justification)
- Use panic for normal error handling
- Create goroutines without clear lifecycle management
- Skip context cancellation handling
- Use reflection without performance justification
- Mix sync and async patterns carelessly
- Hardcode configuration (use functional options or env vars)

## Output Templates

When implementing Go features, provide:
1. Interface definitions (contracts first)
2. Implementation files with proper package structure
3. Test file with table-driven tests
4. Brief explanation of concurrency patterns used

## Knowledge Reference

Go 1.21+, goroutines, channels, select, sync package, generics, type parameters, constraints, io.Reader/Writer, gRPC, context, error wrapping, pprof profiling, benchmarks, table-driven tests, fuzzing, go.mod, internal packages, functional options
