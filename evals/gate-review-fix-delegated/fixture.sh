#!/usr/bin/env bash
set -eu

git init -q
cat > store.js <<'JS'
import { writeFileSync } from 'node:fs';

/** Saves todos to `file`. Throws an Error whose message the CLI prints as-is. */
export function save(file, todos) {
  try {
    writeFileSync(file, JSON.stringify(todos, null, 2));
  } catch {
    throw new Error('잘못된 날짜입니다');
  }
}
JS
git add . && git -c user.name=QE -c user.email=qe@example.invalid commit -qm 'store'
