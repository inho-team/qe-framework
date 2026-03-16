#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { formatMemoryForInjection } from './lib/memory.mjs';
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

// Check 1: CLAUDE.md existence (Qinit check)
const claudeMdPath = join(cwd, 'CLAUDE.md');
if (!existsSync(claudeMdPath)) {
  messages.push('QE framework not initialized. Run `/Qinit` first.');
}

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

// Check 4.5: User profile data — corrections and command patterns
try {
  const profileDir = join(cwd, '.qe', 'profile');
  if (existsSync(profileDir)) {
    const profileParts = [];
    // Load corrections to prevent repeated misunderstandings
    const correctionsPath = join(profileDir, 'corrections.md');
    if (existsSync(correctionsPath)) {
      const content = readFileSync(correctionsPath, 'utf8');
      // Extract the corrections list (compact, max 500 chars)
      const correctionsMatch = content.match(/## Corrections\n([\s\S]*?)(?=\n## |\n---|\Z)/);
      if (correctionsMatch) {
        const corrections = correctionsMatch[1].trim().slice(0, 500);
        if (corrections) profileParts.push(`Corrections: ${corrections}`);
      }
    }
    // Load command patterns for intent disambiguation
    const patternsPath = join(profileDir, 'command-patterns.md');
    if (existsSync(patternsPath)) {
      const content = readFileSync(patternsPath, 'utf8');
      const patternsMatch = content.match(/## Top Commands\n([\s\S]*?)(?=\n## |\n---|\Z)/);
      if (patternsMatch) {
        const patterns = patternsMatch[1].trim().slice(0, 300);
        if (patterns) profileParts.push(`Frequent commands: ${patterns}`);
      }
    }
    if (profileParts.length > 0) {
      messages.push(`[User Profile] ${profileParts.join(' | ')}`);
    }
  }
} catch {
  // Fault tolerance — ignore profile loading errors
}

// Check 5: Project memory
const memoryContext = formatMemoryForInjection(cwd);
if (memoryContext) {
  messages.push(memoryContext);
}

// Check 6: Domain knowledge documents in .qe/docs/ — load content for context
try {
  const docsDir = join(cwd, '.qe', 'docs');
  if (existsSync(docsDir)) {
    const docFiles = readdirSync(docsDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    if (docFiles.length > 0) {
      const summaries = [];
      for (const file of docFiles.slice(0, 10)) {
        try {
          const content = readFileSync(join(docsDir, file), 'utf8');
          // Extract frontmatter fields and core rules section
          const topicMatch = content.match(/^topic:\s*(.+)$/m);
          const domainMatch = content.match(/^domain:\s*(.+)$/m);
          const confirmedMatch = content.match(/^confirmed:\s*(.+)$/m);
          const topic = topicMatch ? topicMatch[1].trim() : file.replace('.md', '');
          const domain = domainMatch ? domainMatch[1].trim() : 'unknown';
          const confirmed = confirmedMatch ? confirmedMatch[1].trim() : 'false';
          // Extract Core Rules section content (compact)
          const rulesMatch = content.match(/## Core Rules\n([\s\S]*?)(?=\n## |\n---|\Z)/);
          const rules = rulesMatch ? rulesMatch[1].trim().slice(0, 300) : '';
          summaries.push(`[${domain}/${topic}] (confirmed:${confirmed})\n${rules}`);
        } catch {}
      }
      if (summaries.length > 0) {
        messages.push(`[Domain Knowledge] ${docFiles.length} doc${docFiles.length > 1 ? 's' : ''} loaded from .qe/docs/:\n${summaries.join('\n---\n')}`);
      }
    }
  }
} catch {
  // Fault tolerance — ignore docs detection errors
}

// Check 7: Git branch and uncommitted changes
try {
  const { execSync } = await import('child_process');
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
