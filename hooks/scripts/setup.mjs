#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// TODO: Implement Setup handler
// Event: Setup
// Category: Session

console.log(JSON.stringify({ continue: true }));
