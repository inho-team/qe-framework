#!/usr/bin/env bash
#
# QE bench clean-room runner.
# Builds the Claude Code image and runs it in an isolated container.
#
# SECURITY: the API key is passed ONLY at runtime via `-e ANTHROPIC_API_KEY`.
# It is never written to the Dockerfile, the image, or any committed file.
#
# Usage:
#   ./run.sh --build     build the image only
#   ./run.sh --smoke     build + headless version/auth smoke (needs ANTHROPIC_API_KEY)
#   ./run.sh --shell     build + interactive shell in the clean-room (default)
set -euo pipefail

IMAGE="qe-bench:latest"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

require_key() {
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is not set. Export it first (runtime env only):" >&2
    echo "  export ANTHROPIC_API_KEY=sk-ant-..." >&2
    exit 1
  fi
}

build() {
  docker build -t "$IMAGE" "$HERE"
}

# Interactive shell; mounts the QE repo read-only so later phases can install/bench it.
shell() {
  require_key
  docker run --rm -it \
    -e ANTHROPIC_API_KEY \
    -v "$REPO_ROOT":/home/bench/qe-framework:ro \
    "$IMAGE" bash
}

# Headless version + auth smoke. Proves the clean-room can actually reach the API.
smoke() {
  require_key
  local log="$HERE/.last-smoke.log"
  {
    echo "== claude --version =="
    docker run --rm -e ANTHROPIC_API_KEY "$IMAGE" claude --version
    echo "== headless auth =="
    docker run --rm -e ANTHROPIC_API_KEY "$IMAGE" \
      claude -p "reply with exactly: ok" --dangerously-skip-permissions
  } 2>&1 | sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-REDACTED/g' | tee "$log"
  chmod 600 "$log"
  if grep -qiw 'ok' "$log"; then
    echo "SMOKE: PASS"
  else
    echo "SMOKE: FAIL (no 'ok' in response)" >&2
    exit 1
  fi
}

case "${1:-}" in
  --build|build) build ;;
  --smoke|smoke) build; smoke ;;
  --shell|shell|"") build; shell ;;
  *) echo "usage: run.sh [--build|--smoke|--shell]" >&2; exit 2 ;;
esac
