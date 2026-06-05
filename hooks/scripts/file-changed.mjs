#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState, markMemoModified } from './lib/state.mjs';

try {
  // Read JSON from stdin
  const data = readStdinJson();

  if (!data) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // Extract file path from data
  const filePath = data.file_path || data.path || '';

  // Ignore .qe/ subdirectory changes (early return)
  if (!filePath || filePath.includes('.qe/') || filePath.includes('.qe\\')) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // File path is valid — mark memo as modified
  const cwd = getCwd();
  const state = readUnifiedState(cwd);

  markMemoModified(state, filePath);

  writeUnifiedState(cwd, state);

  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
} catch {
  // Error handling: return continue: true (silent failure)
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
