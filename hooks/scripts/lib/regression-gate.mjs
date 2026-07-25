#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, readdirSync } from './qe-fs.mjs';
import { join, basename } from 'path';

/**
 * Cross-Phase Regression Gate
 *
 * Before declaring a phase complete, re-verifies that prior phases'
 * key verification items still pass. Prevents regression across the
 * phase boundary.
 */

/**
 * Parse ROADMAP.md to identify completed phases and build a regression plan.
 *
 * @param {number} currentPhase - The phase number currently being completed (e.g. 2)
 * @param {string} roadmapPath  - Absolute path to ROADMAP.md
 * @returns {{ priorPhases: Array<{ phase: number, title: string }>, currentPhase: number }}
 */
export function buildRegressionPlan(currentPhase, roadmapPath) {
  if (currentPhase <= 1) {
    return { priorPhases: [], currentPhase };
  }

  if (!existsSync(roadmapPath)) {
    return { priorPhases: [], currentPhase, error: 'ROADMAP.md not found' };
  }

  const content = readFileSync(roadmapPath, 'utf8');
  const phasePattern = /^## Phase (\d+):\s*(.+)$/gm;
  const priorPhases = [];
  let match;

  while ((match = phasePattern.exec(content)) !== null) {
    const phaseNum = parseInt(match[1], 10);
    if (phaseNum < currentPhase) {
      priorPhases.push({ phase: phaseNum, title: match[2].trim() });
    }
  }

  return { priorPhases, currentPhase };
}

/**
 * For each completed phase, locate its VERIFY_CHECKLIST in the completed
 * directory and run basic regression checks (file existence, checklist
 * item status).
 *
 * @param {Array<{ phase: number, title: string }>} completedPhases
 * @param {string} cwd - Project root
 * @returns {{ passed: boolean, failures: Array<{ phase: number, item: string, reason: string }> }}
 */
export function checkPriorPhaseTests(completedPhases, cwd) {
  const completedDir = join(cwd, '.qe', 'checklists', 'completed');
  const failures = [];

  if (!existsSync(completedDir)) {
    // No completed checklists directory means nothing to regress against
    return { passed: true, failures: [] };
  }

  const files = readdirSync(completedDir).filter(f => f.startsWith('VERIFY_CHECKLIST'));

  for (const phase of completedPhases) {
    // Find checklist files that belong to this phase.
    // Convention: checklist content contains a phase reference, or
    // we check all completed checklists for items that reference the phase.
    const phaseChecklists = findChecklistsForPhase(files, completedDir, phase.phase);

    for (const checklistPath of phaseChecklists) {
      const content = readFileSync(checklistPath, 'utf8');
      const items = parseChecklistItems(content);

      for (const item of items) {
        // Verify file-existence items
        if (item.type === 'file_exists') {
          const targetPath = join(cwd, item.target);
          if (!existsSync(targetPath)) {
            failures.push({
              phase: phase.phase,
              item: item.text,
              reason: `File no longer exists: ${item.target}`,
            });
          }
        }

        // Verify that previously-passed items are still marked as passed
        if (item.type === 'checked' && !item.checked) {
          failures.push({
            phase: phase.phase,
            item: item.text,
            reason: 'Previously completed item is no longer checked',
          });
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Format regression results into a human-readable report.
 *
 * @param {{ passed: boolean, failures: Array<{ phase: number, item: string, reason: string }> }} results
 * @returns {string}
 */
export function formatRegressionReport(results) {
  if (results.passed) {
    return [
      '## Cross-Phase Regression Gate: PASSED',
      '',
      'All prior phase verification items remain valid.',
    ].join('\n');
  }

  const lines = [
    '## Cross-Phase Regression Gate: FAILED',
    '',
    `Found ${results.failures.length} regression(s):`,
    '',
  ];

  for (const f of results.failures) {
    lines.push(`- **Phase ${f.phase}** | ${f.item}`);
    lines.push(`  Reason: ${f.reason}`);
  }

  lines.push('');
  lines.push('Completion is blocked until regressions are resolved.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find completed checklist files that belong to a given phase.
 * Heuristic: scan file content for "Phase N" references or phase-tagged metadata.
 */
function findChecklistsForPhase(fileNames, dir, phaseNum) {
  const matched = [];
  const phaseTag = new RegExp(`Phase\\s*${phaseNum}\\b`, 'i');

  for (const name of fileNames) {
    const fullPath = join(dir, name);
    try {
      const content = readFileSync(fullPath, 'utf8');
      if (phaseTag.test(content)) {
        matched.push(fullPath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return matched;
}

/**
 * Parse checklist items from a VERIFY_CHECKLIST markdown file.
 * Returns structured items with type hints for regression checking.
 */
function parseChecklistItems(content) {
  const items = [];
  const checkboxPattern = /^- \[([ x])\]\s+(.+)$/gm;
  let match;

  while ((match = checkboxPattern.exec(content)) !== null) {
    const checked = match[1] === 'x';
    const text = match[2].trim();

    // Detect file-existence items by common patterns
    const fileMatch = text.match(/(?:file|path|exists?)\s*[:\-]\s*[`"]?([^\s`"]+)[`"]?/i)
      || text.match(/`([^`]+\.\w{1,5})`\s+exists/i);

    if (fileMatch) {
      items.push({ type: 'file_exists', target: fileMatch[1], text, checked });
    } else {
      items.push({ type: 'checked', text, checked });
    }
  }

  return items;
}
