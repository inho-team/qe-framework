#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Skill budget calculation module for monitoring skill set token usage.
 * Analyzes SKILL.md files in the skills directory and estimates token consumption
 * against a context window budget.
 * @module skill-budget
 */

import { readdirSync, readFileSync, existsSync } from './qe-fs.mjs';
import { join } from 'path';
import { CONTEXT_POLICY_DEFAULTS } from './context-policy.mjs';

const AVG_DESCRIPTION_TOKENS = 50;
const DEFAULT_CONTEXT_WINDOW = CONTEXT_POLICY_DEFAULTS.extended_window_tokens;

/**
 * Calculate skill budget by counting SKILL.md files and estimating token usage.
 * @param {string} skillsDir - Path to the skills/ directory
 * @returns {{ count: number, estimatedTokens: number, details: Array<{name: string, descLength: number}> }}
 */
export function calculateSkillBudget(skillsDir) {
  if (!existsSync(skillsDir)) {
    return { count: 0, estimatedTokens: 0, details: [] };
  }

  const details = [];

  /**
   * Recursively scans a directory for SKILL.md files and extracts description lengths.
   * @param {string} dir - The directory path to scan
   * @inner
   */
  function scanDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Check for SKILL.md in subdirectory
          const skillFile = join(fullPath, 'SKILL.md');
          if (existsSync(skillFile)) {
            try {
              const content = readFileSync(skillFile, 'utf8');
              const descMatch = content.match(/^description:\s*['"](.+?)['"]/m);
              const descLength = descMatch ? descMatch[1].length : 0;
              details.push({ name: entry.name, descLength });
            } catch {
              details.push({ name: entry.name, descLength: 0 });
            }
          }
          // Recurse into subdirectories (e.g., coding-experts/)
          scanDir(fullPath);
        }
      }
    } catch {}
  }

  scanDir(skillsDir);

  const count = details.length;
  const estimatedTokens = count * AVG_DESCRIPTION_TOKENS;

  return { count, estimatedTokens, details };
}

/**
 * Check if skill budget overflows the context window percentage.
 * @param {number} totalTokens - Estimated total tokens used by skills
 * @param {number} [contextWindowPct=0.01] - Max percentage of context window (default 1%)
 * @param {number} [contextWindow] - Context window size in tokens; defaults to the policy extended window.
 * @returns {{ overflow: boolean, budget: number, used: number, pct: number }}
 */
export function checkBudgetOverflow(totalTokens, contextWindowPct = 0.01, contextWindow = DEFAULT_CONTEXT_WINDOW) {
  const budget = Math.floor(contextWindow * contextWindowPct);
  const pct = totalTokens / contextWindow;
  return {
    overflow: totalTokens > budget,
    budget,
    used: totalTokens,
    pct: Math.round(pct * 10000) / 100  // e.g., 0.915 → 0.92%
  };
}

/**
 * Get skills with longest descriptions (candidates for compression).
 * @param {string} skillsDir - Path to the skills/ directory
 * @param {number} [limit=20] - Max number of skills to return
 * @returns {Array<{name: string, descLength: number}>}
 */
export function getCompressibleSkills(skillsDir, limit = 20) {
  const { details } = calculateSkillBudget(skillsDir);
  return details
    .sort((a, b) => b.descLength - a.descLength)
    .slice(0, limit);
}
