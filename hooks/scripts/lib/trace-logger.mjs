#!/usr/bin/env node
'use strict';

import { appendFileSync, readFileSync, existsSync, mkdirSync } from './qe-fs.mjs';
import { join } from 'path';

/**
 * Get the traces directory path.
 * @param {string} cwd - Project root
 * @returns {string} Path to .qe/traces/
 */
function getTracesPath(cwd) {
  return join(cwd, '.qe', 'traces');
}

/**
 * Get today's date string.
 * @returns {string} YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Append a trace record to the daily JSONL file.
 * @param {string} cwd - Project root
 * @param {Object} record - Trace record to append
 */
function appendTrace(cwd, record) {
  const dir = getTracesPath(cwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, `${getDateString()}.jsonl`);
  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Log an agent decision for traceability.
 * @param {string} cwd - Project root
 * @param {string} agentName - Name of the agent making the decision
 * @param {string} decision - What was decided
 * @param {string} rationale - Why it was decided
 */
export function logDecision(cwd, agentName, decision, rationale) {
  appendTrace(cwd, {
    timestamp: new Date().toISOString(),
    agent: agentName,
    type: 'decision',
    decision,
    rationale
  });
}

/**
 * Log a tool choice for traceability.
 * @param {string} cwd - Project root
 * @param {string} agentName - Name of the agent choosing the tool
 * @param {string} toolName - Tool that was chosen
 * @param {string} reason - Why this tool was chosen
 */
export function logToolChoice(cwd, agentName, toolName, reason) {
  appendTrace(cwd, {
    timestamp: new Date().toISOString(),
    agent: agentName,
    type: 'tool_choice',
    tool: toolName,
    reason
  });
}

/**
 * Read trace records for a specific date.
 * @param {string} cwd - Project root
 * @param {string} [date] - Date string (YYYY-MM-DD), defaults to today
 * @returns {Array<Object>} Array of parsed trace records
 */
export function readTraces(cwd, date) {
  const filePath = join(getTracesPath(cwd), `${date || getDateString()}.jsonl`);
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
