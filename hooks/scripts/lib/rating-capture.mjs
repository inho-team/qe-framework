#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// Path: .qe/learning/signals/ratings.jsonl
export function getRatingsPath(cwd) {
  return join(cwd, '.qe', 'learning', 'signals', 'ratings.jsonl');
}

/**
 * JSONL schema per entry:
 * {
 *   timestamp:    string  — ISO 8601
 *   rating:       number  — 1-5 (integer)
 *   task_uuids:   string[] — UUIDs of TASK_REQUEST files present at session end
 *   tool_calls:   number  — total tool calls in session
 *   duration_ms:  number  — session duration in milliseconds
 *   tags:         string[] — skill/agent names referenced during session
 * }
 */

/**
 * Collect task UUIDs from TASK_REQUEST files.
 * Scans .qe/tasks/{pending,in-progress,completed}/ first, then cwd as fallback.
 */
function collectTaskUuids(cwd) {
  const uuids = new Set();
  const searchDirs = [
    join(cwd, '.qe', 'tasks', 'in-progress'),
    join(cwd, '.qe', 'tasks', 'pending'),
    join(cwd, '.qe', 'tasks', 'completed'),
    cwd, // backward-compat fallback
  ];
  for (const dir of searchDirs) {
    try {
      if (!existsSync(dir)) continue;
      readdirSync(dir)
        .filter(f => f.startsWith('TASK_REQUEST_') && f.endsWith('.md'))
        .forEach(f => {
          const m = f.match(/TASK_REQUEST_([^.]+)\.md/);
          if (m) uuids.add(m[1]);
        });
    } catch {}
  }
  return Array.from(uuids);
}

/**
 * Collect session stats (tool_calls, duration_ms) from session-stats.json.
 */
function collectSessionStats(cwd) {
  try {
    const statsPath = join(cwd, '.qe', 'state', 'session-stats.json');
    if (!existsSync(statsPath)) return { toolCalls: 0, durationMs: 0 };
    const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
    const toolCalls = stats.tool_calls || 0;
    const sessionStart = stats.session_start || Date.now();
    const durationMs = Date.now() - sessionStart;
    return { toolCalls, durationMs };
  } catch {
    return { toolCalls: 0, durationMs: 0 };
  }
}

/**
 * Collect tags from skill/agent names found in TASK_REQUEST files.
 * Scans .qe/tasks/ subdirectories, then cwd as fallback.
 */
function collectTags(cwd) {
  const tags = new Set();
  const searchDirs = [
    join(cwd, '.qe', 'tasks', 'in-progress'),
    join(cwd, '.qe', 'tasks', 'pending'),
    join(cwd, '.qe', 'tasks', 'completed'),
    cwd,
  ];
  for (const dir of searchDirs) {
    try {
      if (!existsSync(dir)) continue;
      const taskFiles = readdirSync(dir)
        .filter(f => f.startsWith('TASK_REQUEST_') && f.endsWith('.md'));
      for (const file of taskFiles) {
        try {
          const content = readFileSync(join(dir, file), 'utf8');
          const skillMatches = content.match(/\/Q[a-z][a-zA-Z0-9-]*/g) || [];
          skillMatches.forEach(s => tags.add(s.slice(1)));
          const agentMatches = content.match(/\bE[a-z][a-zA-Z0-9-]*/g) || [];
          agentMatches.forEach(a => tags.add(a));
        } catch {}
      }
    } catch {}
  }
  return Array.from(tags).slice(0, 20);
}

/**
 * Append a single rating entry to ratings.jsonl (append-only).
 * Returns true on success, false on failure.
 *
 * @param {string} cwd - project root
 * @param {number} rating - integer 1-5
 */
export function appendRating(cwd, rating) {
  if (!cwd || typeof rating !== 'number' || rating < 1 || rating > 5) return false;

  try {
    const ratingsPath = getRatingsPath(cwd);
    mkdirSync(join(cwd, '.qe', 'learning', 'signals'), { recursive: true });

    const { toolCalls, durationMs } = collectSessionStats(cwd);
    const taskUuids = collectTaskUuids(cwd);
    const tags = collectTags(cwd);

    const entry = {
      timestamp: new Date().toISOString(),
      rating: Math.round(rating),
      task_uuids: taskUuids,
      tool_calls: toolCalls,
      duration_ms: durationMs,
      tags,
    };

    // Append-only: add newline-delimited JSON line
    const line = JSON.stringify(entry) + '\n';
    writeFileSync(ratingsPath, line, { flag: 'a', encoding: 'utf8' });
    return true;
  } catch {
    // Fault tolerance — never crash the stop handler
    return false;
  }
}

/**
 * Read all ratings from ratings.jsonl.
 * Returns array of parsed entries (skips malformed lines).
 */
export function readRatings(cwd) {
  const ratingsPath = getRatingsPath(cwd);
  if (!existsSync(ratingsPath)) return [];

  try {
    const lines = readFileSync(ratingsPath, 'utf8')
      .split('\n')
      .filter(l => l.trim().length > 0);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Compute trend summary from ratings array.
 * Returns { count, average, trend } or null if fewer than 10 entries.
 */
export function computeRatingTrend(ratings) {
  if (!Array.isArray(ratings) || ratings.length < 10) return null;

  const values = ratings.map(r => r.rating).filter(v => typeof v === 'number');
  if (values.length < 10) return null;

  const average = values.reduce((a, b) => a + b, 0) / values.length;

  // Compare recent 5 vs previous 5 for trend direction
  const recent = values.slice(-5);
  const previous = values.slice(-10, -5);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

  let trend = 'stable';
  if (recentAvg - prevAvg >= 0.5) trend = 'improving';
  else if (prevAvg - recentAvg >= 0.5) trend = 'declining';

  return { count: values.length, average: Math.round(average * 10) / 10, trend };
}
