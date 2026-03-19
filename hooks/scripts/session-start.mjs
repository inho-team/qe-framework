#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from './lib/config.mjs';

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
const cfg = loadConfig(cwd);
const messages = [];

// --- ALWAYS TIER ---
// These items are injected every session start regardless of context_loaded state.

// Check 1: CLAUDE.md existence (Qinit check)
const claudeMdPath = join(cwd, 'CLAUDE.md');
if (!existsSync(claudeMdPath)) {
  messages.push('QE framework not initialized. Run `/Qinit` first.');
}

// --- STALE-CHECK TIER ---
// Freshness / snapshot checks that are cheap to run and always relevant.

// Check 2: .qe/analysis/ freshness
const analysisDir = join(cwd, '.qe', 'analysis');
if (existsSync(analysisDir)) {
  const analysisFiles = ['project-structure.md', 'tech-stack.md', 'entry-points.md', 'architecture.md'];
  const staleThreshold = cfg.analysis_freshness_ms;
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

// --- ALWAYS TIER (continued) ---

// Check 4: User language context (language.md)
const languagePath = join(cwd, '.qe', 'profile', 'language.md');
if (existsSync(languagePath)) {
  const langContent = readFileSync(languagePath, 'utf8');
  const langMatch = langContent.match(/Primary language:\s*(\w+)/);
  const userLang = langMatch ? langMatch[1] : null;
  if (userLang && userLang !== 'en') {
    messages.push(`[Language] User language: ${userLang}. Respond in the user's language.`);
  }
}

// Check 5: Git branch and uncommitted changes
try {
  const gitParts = [];

  try {
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
    if (branch) gitParts.push(`Branch: ${branch}`);
  } catch {}

  try {
    const diffStat = execSync('git diff --stat', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
    if (diffStat) {
      const changedFiles = diffStat.split('\n').length - 1; // last line is summary
      if (changedFiles > 0) gitParts.push(`${changedFiles} uncommitted change${changedFiles > 1 ? 's' : ''}`);
    }
  } catch {}

  if (gitParts.length > 0) {
    messages.push(`[Git] ${gitParts.join(', ')}`);
  }
} catch {
  // Fault tolerance — ignore git detection errors
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
// context_loaded: [] tracks which On-Demand items have been injected this session.
// pre-tool-use.mjs reads this array to know what still needs lazy injection.
try {
  const stateDir = join(cwd, '.qe', 'state');
  mkdirSync(stateDir, { recursive: true });
  const sessionStatsPath = join(stateDir, 'session-stats.json');
  writeFileSync(sessionStatsPath, JSON.stringify({
    tool_calls: 0,
    session_start: Date.now(),
    last_warning_at: 0,
    warning_severity: 'none',
    debounce_counter: 0,
    context_loaded: [],
  }));
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
