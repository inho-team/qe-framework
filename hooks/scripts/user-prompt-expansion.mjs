#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Shortcut macro mappings
const MACROS = [
  { pattern: /^rt\s+(.+)$/i, expand: (m) => `/Qrun-task ${m[1]}` },
  { pattern: /^gs$/i, expand: () => `/Qgenerate-spec` },
  { pattern: /^gs\s+(.+)$/i, expand: (m) => `/Qgenerate-spec ${m[1]}` },
  { pattern: /^ar\s+(.+)$/i, expand: (m) => `/Qatomic-run ${m[1]}` },
];

try {
  const prompt = data.prompt || '';
  const trimmed = prompt.trim();

  for (const macro of MACROS) {
    const match = trimmed.match(macro.pattern);
    if (match) {
      console.log(JSON.stringify({ expandedPrompt: macro.expand(match) }));
      process.exit(0);
    }
  }
} catch {
  // Fault tolerance
}

console.log(JSON.stringify({ continue: true }));
