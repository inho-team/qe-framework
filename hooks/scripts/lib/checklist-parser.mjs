#!/usr/bin/env node
'use strict';

/**
 * Checklist Parser — Parses VERIFY_CHECKLIST markdown files to extract task status.
 *
 * ## How it works
 *
 * Reads VERIFY_CHECKLIST markdown files and extracts checkbox items with their status:
 *   - `- [x]` or `- [X]` → completed
 *   - `- [~]` → skipped
 *   - `- [ ]` with `<!-- skip -->` → skipped (otherwise remaining)
 *   - All other `- [ ]` → remaining
 *
 * Tracks section headings (`##` or `###`) and ignores code blocks.
 *
 * ## Usage example
 *
 *   import { parseChecklist, isAllComplete, findNextRemaining } from './checklist-parser.mjs';
 *
 *   const result = parseChecklist('/path/to/VERIFY_CHECKLIST.md');
 *   console.log(`Progress: ${result.completed}/${result.total}`);
 *
 *   if (isAllComplete('/path/to/VERIFY_CHECKLIST.md')) {
 *     console.log('All items complete!');
 *   }
 *
 *   const next = findNextRemaining('/path/to/VERIFY_CHECKLIST.md');
 *   if (next) {
 *     console.log(`Next item: ${next.text} (line ${next.line})`);
 *   }
 *
 * @module checklist-parser
 */

import { readFileSync, existsSync } from './qe-fs.mjs';

/**
 * Parse a VERIFY_CHECKLIST markdown file and extract task items.
 * Reads the file, extracts checkbox items, and categorizes them by status.
 * Returns empty result if file is missing or unreadable (never throws).
 * @param {string} filePath - Absolute path to the checklist markdown file
 * @returns {Object} Parsed checklist with { total, completed, remaining, skipped, items }
 * @example
 * const result = parseChecklist('/path/to/VERIFY_CHECKLIST.md');
 * console.log(`Progress: ${result.completed}/${result.total}`);
 */
export function parseChecklist(filePath) {
  try {
    if (!existsSync(filePath)) {
      return { total: 0, completed: 0, remaining: 0, skipped: 0, items: [] };
    }

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const result = {
      total: 0,
      completed: 0,
      remaining: 0,
      skipped: 0,
      items: [],
    };

    let currentSection = '';
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track code blocks (``` fenced regions)
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // Skip if inside a code block
      if (inCodeBlock) {
        continue;
      }

      // Track section headings
      if (line.match(/^##\s+/)) {
        currentSection = line.replace(/^##\s+/, '').trim();
        continue;
      }

      if (line.match(/^###\s+/)) {
        currentSection = line.replace(/^###\s+/, '').trim();
        continue;
      }

      // Match checkbox items: `- [ ]`, `- [x]`, `- [X]`, `- [~]`
      const match = line.match(/^\s*-\s*\[([ xX~])\]\s*(.*)$/);
      if (!match) {
        continue;
      }

      const checkbox = match[1];
      let text = match[2];
      const fullLine = line;

      // Strip trailing HTML comments from text but keep for skip detection
      text = text.replace(/<!--.*?-->\s*$/, '').trim();

      // Determine status
      let status;
      if (checkbox === 'x' || checkbox === 'X') {
        status = 'completed';
        result.completed++;
      } else if (checkbox === '~') {
        status = 'skipped';
        result.skipped++;
      } else if (checkbox === ' ') {
        // Check for <!-- skip --> anywhere on the line
        if (fullLine.includes('<!-- skip -->')) {
          status = 'skipped';
          result.skipped++;
        } else {
          status = 'remaining';
          result.remaining++;
        }
      } else {
        // Fallback (should not happen with regex above)
        status = 'remaining';
        result.remaining++;
      }

      result.total++;
      result.items.push({
        status,
        text,
        line: lineNum,
        section: currentSection,
      });
    }

    return result;
  } catch (err) {
    // Fault-tolerant: return empty result on any error
    return { total: 0, completed: 0, remaining: 0, skipped: 0, items: [] };
  }
}

/**
 * Check whether all items in the checklist are complete.
 *
 * @param {string} filePath - Absolute path to the checklist markdown file
 * @returns {boolean} True if remaining === 0 && total > 0; otherwise false
 */
export function isAllComplete(filePath) {
  const result = parseChecklist(filePath);
  return result.remaining === 0 && result.total > 0;
}

/**
 * Find the first remaining (incomplete) item in the checklist.
 *
 * @param {string} filePath - Absolute path to the checklist markdown file
 * @returns {null | {
 *   status: 'remaining',
 *   text: string,
 *   line: number,
 *   section: string
 * }} The first remaining item, or null if none exist
 */
export function findNextRemaining(filePath) {
  const result = parseChecklist(filePath);
  const nextItem = result.items.find((item) => item.status === 'remaining');
  return nextItem || null;
}
