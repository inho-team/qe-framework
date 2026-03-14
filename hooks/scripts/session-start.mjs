#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { formatMemoryForInjection } from './lib/memory.mjs';

// Read stdin (Claude Code provides JSON with cwd, session_id, etc.)
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
  // If no valid input, pass through
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || process.cwd();
const messages = [];

// Check 1: CLAUDE.md existence (Qinit check)
const claudeMdPath = join(cwd, 'CLAUDE.md');
if (!existsSync(claudeMdPath)) {
  messages.push('QE framework not initialized. Run `/Qinit` first.');
}

// Check 2: .qe/analysis/ freshness
const analysisDir = join(cwd, '.qe', 'analysis');
if (existsSync(analysisDir)) {
  const analysisFiles = ['project-structure.md', 'tech-stack.md', 'entry-points.md', 'architecture.md'];
  const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();

  let staleCount = 0;
  for (const file of analysisFiles) {
    const filePath = join(analysisDir, file);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > staleThreshold) {
        staleCount++;
      }
    } else {
      staleCount++;
    }
  }

  if (staleCount >= 1) {
    messages.push('[ACTION REQUIRED] Project analysis is stale. Run Erefresh-executor in background NOW.');
  }
}

// Check 3: .qe/context/snapshot.md existence (resume hint)
const snapshotPath = join(cwd, '.qe', 'context', 'snapshot.md');
if (existsSync(snapshotPath)) {
  const stat = statSync(snapshotPath);
  const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  if (ageHours < 24) {
    messages.push('Previous session context saved. Restore with `/Qresume`.');
  }
}

// Check 4: Qtranslate — Internal English processing
const languagePath = join(cwd, '.qe', 'profile', 'language.md');
if (existsSync(languagePath)) {
  const langContent = readFileSync(languagePath, 'utf8');
  const langMatch = langContent.match(/Primary language:\s*(\w+)/);
  const userLang = langMatch ? langMatch[1] : 'auto-detect';
  messages.push(`[Qtranslate] Active. User language: ${userLang}. Think and reason internally in English. Translate final responses to the user's language.`);
} else {
  messages.push('[Qtranslate] Active. Detect user language from first message, save to .qe/profile/language.md. Think and reason internally in English. Translate final responses to the user\'s language.');
}

// Check 5: Project memory
const memoryContext = formatMemoryForInjection(cwd);
if (memoryContext) {
  messages.push(memoryContext);
}

// Cleanup: Remove stale intent-route.json for clean session start
try {
  const intentRoutePath = join(cwd, '.qe', 'state', 'intent-route.json');
  if (existsSync(intentRoutePath)) {
    unlinkSync(intentRoutePath);
  }
} catch {
  // Fault tolerance — ignore cleanup errors
}

// Reset session-stats.json for fresh session tracking
try {
  const stateDir = join(cwd, '.qe', 'state');
  mkdirSync(stateDir, { recursive: true });
  const sessionStatsPath = join(stateDir, 'session-stats.json');
  writeFileSync(sessionStatsPath, JSON.stringify({ tool_calls: 0, session_start: Date.now() }));
} catch {
  // Fault tolerance — ignore reset errors
}

if (messages.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `[QE Framework] ${messages.join(' | ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
