#!/bin/sh
set -eu

node --version
npm ci --ignore-scripts --omit=optional

case "$1" in
    guards)
        node scripts/check-all.mjs
        ;;
    native)
        node --test scripts/lib/__tests__/npm-lifecycle.test.mjs scripts/lib/__tests__/package-lifecycle.test.mjs scripts/lib/__tests__/package-provenance.test.mjs
        ;;
    *)
        echo "Expected guards or native mode." >&2
        exit 2
        ;;
esac
