# Architecture Rules

## 1. Project Structure

-   **`src/`**: Go module root. Contains `go.mod`, all source code.
-   **`output/`**: Build artifacts (`bin/`), test output (`testing/`). Configured in `run` script.
-   **`local/`**: Local-only files (ignored by git).

## 2. "HOW" vs "WHAT"

-   **`pkg/` ("HOW")**: ~95% of code.
    -   Generic, domain-agnostic utilities (text, net, data, io).
    -   Organized by subject as flat packages.
    -   Stateless functions preferred. Structs only when state is needed.
    -   *See `stringutil.go` example.*
-   **`cmd/` ("WHAT")**: ~5% of code.
    -   Entry points only. Each subdirectory is one binary.
    -   Thin: parse flags/config, wire dependencies, call `pkg/` code, handle errors.
    -   *Each `cmd/` directory contains exactly one `main.go`.*
-   **`internal/`** (optional): Private packages not importable by external modules.
    -   Use when you need shared code between `cmd/` binaries but do not want to export it.

## 3. Package Organization (Anti-Layering)

-   **Group by domain**: `pkg/text/`, `pkg/auth/`, `pkg/storage/`.
-   **Co-location**: Related types, functions, and their tests live together in the same package.
-   **Forbidden package names**: `utils/`, `helpers/`, `common/`, `misc/`, `models/`, `services/`, `controllers/` (horizontal layering is BANNED).
-   **One concept per package**: A package should do one thing. If it does two unrelated things, split it.

## 4. File Organization

-   **One concept per file**: Each file focuses on a single type or closely related group of functions.
-   **File name**: Lowercase, underscores for word separation, describes the concept (`truncate.go`, `http_client.go`).
-   **Test file**: Same name with `_test.go` suffix beside the source file.
-   **Package doc**: When a package needs overview documentation, add a `doc.go` with a package comment.
-   **Exceptions**: Small, tightly related types can share a file if they are always used together.

## 5. Dependency Rules

-   **`pkg/`**: Depends on standard library and external modules only. Packages within `pkg/` may depend on each other but avoid circular dependencies.
-   **`internal/`**: Depends on `pkg/` and standard library.
-   **`cmd/`**: Depends on `pkg/`, `internal/`, and standard library. This is where everything is wired together.
-   **No upward dependencies**: `pkg/` never imports from `cmd/` or `internal/`.

## 6. Module Management

-   **One `go.mod` per project**, inside `src/`.
-   **Module path**: Use a meaningful path (e.g., `github.com/user/project` or a short local name for internal tools).
-   **Minimal dependencies**: Prefer standard library. Add external modules only when they provide substantial value.
-   **Pin versions**: Always use specific versions in `go.mod`, never floating tags.
-   **Tidy regularly**: `go mod tidy` after adding/removing imports.
