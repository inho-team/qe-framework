#!/usr/bin/env node
'use strict';

import { readFileSync } from 'fs';

let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const userMessage = data.user_message || data.message || '';

// Skip empty or long messages (long messages are unlikely to be ambiguous)
if (!userMessage || userMessage.length > 100) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const words = userMessage.trim().split(/\s+/);

// Only check short messages (5 words or fewer)
if (words.length > 5) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Ambiguous patterns — short phrases lacking specific nouns
const ambiguousPatterns = [
  /^help\s*me$/i,
  /^fix\s*it$/i,
  /^make\s*it\s*better$/i,
  /^do\s*something$/i,
  /^change\s*this$/i,
  /^update\s*it$/i,
  /^improve\s*this$/i,
  /^clean\s*it\s*up$/i,
  /^just\s*do\s*it$/i,
  /^handle\s*it$/i,
];

const isAmbiguous = ambiguousPatterns.some(pattern => pattern.test(userMessage.trim()));

if (isAmbiguous) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "[QE] Ambiguous request detected. Ask the user to clarify: what file, what behavior, what result?"
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
