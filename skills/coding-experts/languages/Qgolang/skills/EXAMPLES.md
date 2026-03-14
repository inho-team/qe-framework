# Code Examples

These files demonstrate the strict standards in practice. **Read them.**

## 1. Stateless Utility (`stringutil.go`)
-   **Demonstrates**: Pure functions, error returns, Go doc comments, co-located tests.
-   **File**: `skills/examples/stringutil.go`

## 2. Stateful Service (`service.go`)
-   **Demonstrates**: Constructor function, unexported fields, dependency injection via interfaces, method receivers, co-located tests with test helpers.
-   **File**: `skills/examples/service.go`

## 3. Typed Constants / Smart Enum (`status.go`)
-   **Demonstrates**: Go's equivalent of smart enums using unexported struct fields, exported variables, encapsulated behavior, `String()` method, co-located tests.
-   **File**: `skills/examples/status.go`

## 4. Interface Definition (`sender.go`)
-   **Demonstrates**: Small interface, two real implementations (no mocks), same test suite for both.
-   **File**: `skills/examples/sender.go`
