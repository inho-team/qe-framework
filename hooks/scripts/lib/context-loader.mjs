#!/usr/bin/env node
'use strict';

/**
 * Context On-Demand Loader
 *
 * Provides lazy loading functions for the three On-Demand context tiers:
 *   - profile: corrections.md + command-patterns.md
 *   - memory: project-memory.json (notes + directives)
 *   - failures: .qe/learning/failures/ recent session summaries
 *   - docs: .qe/docs/ domain knowledge documents
 *
 * Each function returns a non-empty string message on success, or null if
 * nothing is available to inject. Callers are responsible for tracking which
 * items have been loaded (via context_loaded in session-stats.json).
 *
 * Design notes:
 * - All functions are fault-tolerant — they never throw.
 * - Character/line budgets are kept intentionally small (matching the original
 *   session-start.mjs limits) to minimise token cost even on first call.
 * - Functions are self-contained: no shared state, no side effects.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { formatMemoryForInjection } from './memory.mjs';
import { readRecentFailures } from './failure-capture.mjs';

// --- On-Demand loader keys (must match context_loaded entries) ---
export const LOADER_KEYS = {
  PROFILE: 'profile',
  MEMORY: 'memory',
  FAILURES: 'failures',
  DOCS: 'docs',
};

/**
 * Load user profile corrections + command patterns.
 * Mirrors the original Check 4.5 logic from session-start.mjs.
 *
 * @param {string} cwd - Project root
 * @returns {string|null} Injection message or null
 */
export function loadProfile(cwd) {
  try {
    const profileDir = join(cwd, '.qe', 'profile');
    if (!existsSync(profileDir)) return null;

    const profileParts = [];

    // Load corrections to prevent repeated misunderstandings
    const correctionsPath = join(profileDir, 'corrections.md');
    if (existsSync(correctionsPath)) {
      const content = readFileSync(correctionsPath, 'utf8');
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

    if (profileParts.length === 0) return null;
    return `[User Profile] ${profileParts.join(' | ')}`;
  } catch {
    // Fault tolerance — ignore profile loading errors
    return null;
  }
}

/**
 * Load project memory (notes + directives).
 * Mirrors the original Check 5 logic from session-start.mjs.
 *
 * @param {string} cwd - Project root
 * @returns {string|null} Injection message or null
 */
export function loadMemory(cwd) {
  try {
    const memoryContext = formatMemoryForInjection(cwd);
    return memoryContext || null;
  } catch {
    // Fault tolerance — ignore memory loading errors
    return null;
  }
}

/**
 * Load recent failure summaries.
 * Mirrors the original Check 5.5 logic from session-start.mjs.
 *
 * @param {string} cwd - Project root
 * @param {number} [limit=3] - Max number of failure entries to include
 * @returns {string|null} Injection message or null
 */
export function loadFailures(cwd, limit = 3) {
  try {
    const failureSummary = readRecentFailures(cwd, limit);
    return failureSummary || null;
  } catch {
    // Fault tolerance — ignore failure summary errors
    return null;
  }
}

/**
 * Load domain knowledge documents from .qe/docs/.
 * Mirrors the original Check 6 logic from session-start.mjs.
 *
 * @param {string} cwd - Project root
 * @returns {string|null} Injection message or null
 */
export function loadDocs(cwd) {
  try {
    const docsDir = join(cwd, '.qe', 'docs');
    if (!existsSync(docsDir)) return null;

    const docFiles = readdirSync(docsDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    if (docFiles.length === 0) return null;

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

    if (summaries.length === 0) return null;
    return `[Domain Knowledge] ${docFiles.length} doc${docFiles.length > 1 ? 's' : ''} loaded from .qe/docs/:\n${summaries.join('\n---\n')}`;
  } catch {
    // Fault tolerance — ignore docs loading errors
    return null;
  }
}

/**
 * Run all On-Demand loaders that have not yet been injected this session.
 * Returns an array of { key, message } pairs for items that produced content.
 * Skips any key already present in the alreadyLoaded set.
 *
 * @param {string} cwd - Project root
 * @param {string[]} alreadyLoaded - Keys from context_loaded in session-stats.json
 * @returns {{ key: string, message: string }[]}
 */
export function loadPendingContext(cwd, alreadyLoaded) {
  const pending = [];

  if (!alreadyLoaded.includes(LOADER_KEYS.PROFILE)) {
    const msg = loadProfile(cwd);
    if (msg) pending.push({ key: LOADER_KEYS.PROFILE, message: msg });
  }

  if (!alreadyLoaded.includes(LOADER_KEYS.MEMORY)) {
    const msg = loadMemory(cwd);
    if (msg) pending.push({ key: LOADER_KEYS.MEMORY, message: msg });
  }

  if (!alreadyLoaded.includes(LOADER_KEYS.FAILURES)) {
    const msg = loadFailures(cwd);
    if (msg) pending.push({ key: LOADER_KEYS.FAILURES, message: msg });
  }

  if (!alreadyLoaded.includes(LOADER_KEYS.DOCS)) {
    const msg = loadDocs(cwd);
    if (msg) pending.push({ key: LOADER_KEYS.DOCS, message: msg });
  }

  return pending;
}
