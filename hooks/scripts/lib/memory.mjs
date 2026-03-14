#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const MEMORY_FILE = 'project-memory.json';

/**
 * Get memory file path
 */
export function getMemoryPath(cwd) {
  return join(cwd, '.qe', 'memory', MEMORY_FILE);
}

/**
 * Read all project memory
 */
export function readMemory(cwd) {
  const filePath = getMemoryPath(cwd);
  if (!existsSync(filePath)) return { notes: [], directives: [] };

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return { notes: [], directives: [] };
  }
}

/**
 * Add a note to project memory
 * @param {string} category - e.g., "architecture", "conventions", "gotchas"
 * @param {string} note - the knowledge to persist
 */
export function addNote(cwd, category, note) {
  const memory = readMemory(cwd);

  // Deduplicate
  const exists = memory.notes.some(n => n.note === note && n.category === category);
  if (exists) return memory;

  memory.notes.push({
    category,
    note,
    added_at: new Date().toISOString()
  });

  saveMemory(cwd, memory);
  return memory;
}

/**
 * Add a directive (stronger than note - always injected)
 * @param {string} directive - rule to always follow
 */
export function addDirective(cwd, directive) {
  const memory = readMemory(cwd);

  const exists = memory.directives.some(d => d.directive === directive);
  if (exists) return memory;

  memory.directives.push({
    directive,
    added_at: new Date().toISOString()
  });

  saveMemory(cwd, memory);
  return memory;
}

/**
 * Get formatted memory for injection
 */
export function formatMemoryForInjection(cwd) {
  const memory = readMemory(cwd);
  const parts = [];

  if (memory.directives.length > 0) {
    parts.push('Project directives: ' + memory.directives.map(d => d.directive).join('; '));
  }

  if (memory.notes.length > 0) {
    const grouped = {};
    for (const n of memory.notes) {
      if (!grouped[n.category]) grouped[n.category] = [];
      grouped[n.category].push(n.note);
    }
    const summary = Object.entries(grouped)
      .map(([cat, notes]) => `[${cat}] ${notes.join(', ')}`)
      .join(' | ');
    parts.push('Project notes: ' + summary);
  }

  return parts.join(' | ');
}

function saveMemory(cwd, memory) {
  const filePath = getMemoryPath(cwd);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf8');
}
