#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync } from './qe-fs.mjs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { atomicWriteJson } from './state.mjs';

const MEMORY_FILE = 'project-memory.json';
const LEGACY_MEMORY_FILE = join('memory', 'project-memory.json');
const MAX_CONTEXT_BYTES = 2048;

const TTL_MAP = {
  permanent: null,
  high: 30 * 24 * 60 * 60,   // 30 days
  normal: 7 * 24 * 60 * 60,  // 7 days
  low: 1 * 24 * 60 * 60,     // 1 day
};

const PRIORITY_ORDER = ['permanent', 'high', 'normal', 'low'];

function getMemoryPath(cwd) {
  return join(cwd, '.qe', MEMORY_FILE);
}

function legacyEntries(cwd) {
  const legacyPath = join(cwd, '.qe', LEGACY_MEMORY_FILE);
  if (!existsSync(legacyPath)) return [];
  try {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
    const rows = [
      ...(Array.isArray(legacy.directives) ? legacy.directives.map((item) => ({
        type: 'directive', content: item.directive, priority: 'permanent', createdAt: item.added_at,
      })) : []),
      ...(Array.isArray(legacy.notes) ? legacy.notes.map((item) => ({
        type: item.category || 'note', content: item.note, priority: 'normal', createdAt: item.added_at,
      })) : []),
    ];
    return rows.filter((item) => typeof item.content === 'string' && item.content.trim()).map((item) => ({
      id: `legacy_${createHash('sha256').update(`${item.type}\0${item.content}`).digest('hex').slice(0, 8)}`,
      type: item.type,
      content: item.content,
      priority: item.priority,
      createdAt: item.createdAt || new Date(0).toISOString(),
      ttl: item.priority === 'permanent' ? null : TTL_MAP.normal,
      expiresAt: null,
      source: 'legacy-memory-compat',
      tags: ['legacy'],
    }));
  } catch {
    return [];
  }
}

/** Load project memory from disk. */
export function loadMemory(cwd) {
  const filePath = getMemoryPath(cwd);
  let memory = { version: 1, entries: [] };
  try {
    if (existsSync(filePath)) memory = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    memory = { version: 1, entries: [] };
  }
  if (!Array.isArray(memory.entries)) memory.entries = [];
  const seen = new Set(memory.entries.map((entry) => `${entry.type}\0${entry.content}`));
  for (const entry of legacyEntries(cwd)) {
    const key = `${entry.type}\0${entry.content}`;
    if (!seen.has(key)) { memory.entries.push(entry); seen.add(key); }
  }
  return memory;
}

/** Save project memory to disk (atomic write). */
export function saveMemory(cwd, memory) {
  atomicWriteJson(getMemoryPath(cwd), memory);
}

/**
 * Add a memory entry.
 * @param {string} cwd
 * @param {string} content
 * @param {string} type - convention | gotcha | decision | pattern
 * @param {{ priority?: string, source?: string, tags?: string[] }} [options]
 */
export function addMemory(cwd, content, type, options = {}) {
  const memory = loadMemory(cwd);
  const priority = options.priority || 'normal';
  // Use key presence, not `??`: TTL_MAP.permanent is intentionally null (no-expiry
  // sentinel), and `??` would treat that null as "missing" and fall back to normal,
  // silently giving permanent memories a 7-day TTL.
  const ttl = priority in TTL_MAP ? TTL_MAP[priority] : TTL_MAP.normal;
  const now = new Date().toISOString();
  const entry = {
    id: `mem_${randomBytes(4).toString('hex')}`,
    type, content, priority,
    createdAt: now,
    ttl,
    expiresAt: ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null,
    source: options.source || 'agent',
    tags: options.tags || [],
  };
  memory.entries.push(entry);
  saveMemory(cwd, memory);
  return entry;
}

/** Get all non-expired entries, sorted by priority (permanent first). */
export function getActiveMemories(cwd) {
  const now = Date.now();
  return loadMemory(cwd).entries
    .filter(e => !e.expiresAt || new Date(e.expiresAt).getTime() > now)
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
}

/** Filter active memories by type. */
export function getMemoriesByType(cwd, type) {
  return getActiveMemories(cwd).filter(e => e.type === type);
}

/** Filter active memories by tag. */
export function getMemoriesByTag(cwd, tag) {
  return getActiveMemories(cwd).filter(e => e.tags.includes(tag));
}

/** Remove expired entries. Returns count pruned. */
export function pruneExpired(cwd) {
  const memory = loadMemory(cwd);
  const now = Date.now();
  const before = memory.entries.length;
  memory.entries = memory.entries.filter(
    e => !e.expiresAt || new Date(e.expiresAt).getTime() > now
  );
  const pruned = before - memory.entries.length;
  if (pruned > 0) saveMemory(cwd, memory);
  return pruned;
}

/** Clear all entries. */
export function clearAll(cwd) {
  saveMemory(cwd, { version: 1, entries: [] });
}

/**
 * Format active memories as compact string for context injection.
 * Stays within MAX_CONTEXT_BYTES (2KB).
 */
export function formatMemoryContext(cwd) {
  const entries = getActiveMemories(cwd);
  if (entries.length === 0) return '';

  const lines = ['[Project Memory]'];
  let size = lines[0].length;

  for (const e of entries) {
    const prefix = e.priority === 'permanent' ? '!' : e.priority === 'high' ? '*' : '-';
    const tagStr = e.tags.length > 0 ? ` [${e.tags.join(',')}]` : '';
    const line = `${prefix} (${e.type}) ${e.content}${tagStr}`;
    if (size + line.length + 1 > MAX_CONTEXT_BYTES) break;
    lines.push(line);
    size += line.length + 1;
  }

  return lines.join('\n');
}
