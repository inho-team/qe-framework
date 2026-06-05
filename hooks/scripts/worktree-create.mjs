#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// TODO: Implement WorktreeCreate handler
// Event: WorktreeCreate
// Category: System

console.log(JSON.stringify({ continue: true }));
