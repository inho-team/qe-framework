#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// TODO: Implement PermissionDenied handler
// Event: PermissionDenied
// Category: Permission

console.log(JSON.stringify({ continue: true }));
