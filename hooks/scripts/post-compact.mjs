#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// TODO: Implement PostCompact handler
// Event: PostCompact
// Category: Context

console.log(JSON.stringify({ continue: true }));
