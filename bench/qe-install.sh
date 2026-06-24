#!/usr/bin/env bash
#
# Install QE into the clean-room container from the mounted repo, then verify it loads.
# Runs INSIDE the container (the repo is mounted read-only at $QE_REPO).
set -euo pipefail

QE_REPO="${QE_REPO:-/home/bench/qe-framework}"

if [ ! -d "$QE_REPO" ]; then
  echo "ERROR: QE repo not mounted at $QE_REPO" >&2
  exit 1
fi

echo "== installing QE from $QE_REPO =="
# install.js writes to the user's ~/.claude (writable home), not the read-only repo.
node "$QE_REPO/install.js"

echo "== verifying QE load =="
# A representative framework lib must import cleanly (proves ESM + lib integrity).
node -e "import('file://$QE_REPO/hooks/scripts/lib/context-meter.mjs')
  .then(() => console.log('QE lib load: OK'))
  .catch((e) => { console.error('QE lib load: FAIL —', e.message); process.exit(1); })"

# Skills must be present.
SKILLS_DIR="$QE_REPO/skills"
test -d "$SKILLS_DIR" || { echo "ERROR: skills dir missing" >&2; exit 1; }
echo "skills present: $(find "$SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"

echo "QE install + load: OK"
