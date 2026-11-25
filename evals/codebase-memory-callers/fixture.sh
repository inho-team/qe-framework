#!/usr/bin/env bash
set -eu

git init -q
cat > totals.js <<'EOF'
export function normalizeAmount(value) {
  return Math.round(value * 100) / 100;
}

export function buildInvoice(amount) {
  return { total: normalizeAmount(amount) };
}

export function unrelatedLabel() {
  return 'invoice';
}
EOF
git add totals.js
git -c user.name=QE -c user.email=qe@example.invalid commit -qm 'Add invoice fixture'
