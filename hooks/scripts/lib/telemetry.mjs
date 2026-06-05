#!/usr/bin/env node
'use strict';

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Get the telemetry directory path.
 * @param {string} cwd - Project root
 * @returns {string} Path to .qe/telemetry/
 */
export function getTelemetryPath(cwd) {
  return join(cwd, '.qe', 'telemetry');
}

/**
 * Get today's date string for file naming.
 * @returns {string} YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Append a telemetry event to the daily JSONL file.
 * Creates the directory and file if they don't exist.
 * @param {string} cwd - Project root
 * @param {Object} event - Event data: { eventType, sessionId, data }
 */
export function appendTelemetry(cwd, event) {
  const dir = getTelemetryPath(cwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${getDateString()}.jsonl`);
  const record = {
    timestamp: new Date().toISOString(),
    eventType: event.eventType || 'unknown',
    sessionId: event.sessionId || 'unknown',
    data: event.data || {}
  };

  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Read telemetry events for a specific date.
 * @param {string} cwd - Project root
 * @param {string} [date] - Date string (YYYY-MM-DD), defaults to today
 * @returns {Array<Object>} Array of parsed event objects
 */
export function readTelemetry(cwd, date) {
  const filePath = join(getTelemetryPath(cwd), `${date || getDateString()}.jsonl`);
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
