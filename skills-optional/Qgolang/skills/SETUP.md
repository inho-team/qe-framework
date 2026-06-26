# Project Setup Guide

## 1. Initialize Project

```bash
mkdir myproject && cd myproject
mkdir -p src/cmd/myapp src/pkg output/bin output/testing local
```

## 2. Initialize Go Module

```bash
cd src
go mod init github.com/user/myproject
```

For internal tools where the module path does not matter:

```bash
go mod init myproject
```

## 3. Create Entry Point

Create `src/cmd/myapp/main.go`:

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	fmt.Println("myapp running")
	return nil
}
```

## 4. Create Run Script

Create `run` at the project root (executable):

```bash
#!/bin/bash
set -euo pipefail

# Resolve project root relative to this script, not cwd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
OUTPUT_DIR="$SCRIPT_DIR/output"
BIN_DIR="$OUTPUT_DIR/bin"
TEST_DIR="$OUTPUT_DIR/testing"

mkdir -p "$BIN_DIR" "$TEST_DIR"

usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  build              Build all binaries to output/bin/"
    echo "  test [pkg] [args]  Run tests for a specific package"
    echo "  lint               Run gofmt, go vet, and golangci-lint"
    echo "  check              Full quality gate (lint + all tests)"
    echo "  run [args]         Build and run the main binary"
    exit 1
}

cmd_build() {
    echo "==> Building..."
    cd "$SRC_DIR"
    for dir in cmd/*/; do
        name=$(basename "$dir")
        go build -o "$BIN_DIR/$name" "./$dir"
        echo "    Built $name -> output/bin/$name"
    done
    echo "==> Build complete."
}

cmd_test() {
    local pkg="${1:-./...}"
    shift 2>/dev/null || true
    cd "$SRC_DIR"
    echo "==> Testing $pkg"
    go test "$pkg" -count=1 -v "$@" 2>&1 | tee "$TEST_DIR/test.log"
    echo "==> Test output written to output/testing/test.log"
}

cmd_lint() {
    cd "$SRC_DIR"
    local failed=0

    echo "==> Checking formatting..."
    if [ -n "$(gofmt -l .)" ]; then
        echo "FAIL: gofmt found unformatted files:"
        gofmt -l .
        failed=1
    else
        echo "    gofmt: clean"
    fi

    echo "==> Running go vet..."
    if ! go vet ./...; then
        failed=1
    else
        echo "    go vet: clean"
    fi

    echo "==> Running golangci-lint..."
    if command -v golangci-lint &>/dev/null; then
        if ! golangci-lint run ./...; then
            failed=1
        else
            echo "    golangci-lint: clean"
        fi
    else
        echo "    golangci-lint: not installed, skipping (install: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)"
    fi

    if [ "$failed" -ne 0 ]; then
        echo "==> Lint FAILED"
        return 1
    fi
    echo "==> Lint passed."
}

cmd_check() {
    echo "==> Running full quality gate..."
    cmd_lint
    echo ""
    cd "$SRC_DIR"
    echo "==> Running all tests..."
    go test ./... -count=1 -v 2>&1 | tee "$TEST_DIR/check.log"
    echo "==> Quality gate PASSED. Safe to commit."
}

cmd_run() {
    cmd_build
    echo "==> Running..."
    # Find the first (or only) binary
    local binary
    binary=$(ls "$BIN_DIR"/ 2>/dev/null | head -1)
    if [ -z "$binary" ]; then
        echo "No binary found in output/bin/"
        return 1
    fi
    "$BIN_DIR/$binary" "$@"
}

case "${1:-}" in
    build) shift; cmd_build "$@" ;;
    test)  shift; cmd_test "$@" ;;
    lint)  shift; cmd_lint "$@" ;;
    check) shift; cmd_check "$@" ;;
    run)   shift; cmd_run "$@" ;;
    *)     usage ;;
esac
```

Make it executable:

```bash
chmod +x run
```

## 5. Create ~/bin Wrapper

```bash
cat > ~/bin/myproject << 'EOF'
#!/bin/bash
exec ~/src/myproject/run "$@"
EOF
chmod +x ~/bin/myproject
```

## 6. Standard .gitignore

Create `.gitignore` at the project root:

```
output/
local/
*.exe
*.test
*.out
.DS_Store
```

## 7. Install Quality Tools

```bash
# golangci-lint (comprehensive linter)
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

## 8. Verify Setup

```bash
./run build    # Should compile with no errors
./run lint     # Should pass with no warnings
./run check    # Full quality gate
```

## 9. Optional: golangci-lint Configuration

Create `src/.golangci.yml` for project-specific lint rules:

```yaml
run:
  timeout: 5m

linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - unused
    - gosimple
    - ineffassign
    - typecheck

linters-settings:
  errcheck:
    check-type-assertions: true
    check-blank: true
```
