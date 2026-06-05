#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// TODO: Implement PostToolBatch handler
// Event: PostToolBatch
// Category: Tool

console.log(JSON.stringify({ continue: true }));
