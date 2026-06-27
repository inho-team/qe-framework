#!/usr/bin/env node

import { execFileSync } from 'child_process';

import { loadSivsConfig } from './codex_bridge.mjs';

export { loadSivsConfig };

/**
 * Check if Claude CLI is available on PATH
 * @returns {boolean} true if claude binary is found, false otherwise
 */
export function isClaudeCliAvailable() {
  try {
    execFileSync('which', ['claude']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude CLI is authenticated enough for non-interactive `claude -p`.
 * @returns {boolean} true when `claude auth status` reports loggedIn:true
 */
export function isClaudeCliAuthenticated() {
  try {
    const output = execFileSync('claude', ['auth', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output)?.loggedIn === true;
  } catch (err) {
    try {
      const output = err?.stdout?.toString?.() || '';
      if (output) return JSON.parse(output)?.loggedIn === true;
    } catch {
      // Fall through to false.
    }
    return false;
  }
}

/**
 * Get claude command for a given SIVS stage
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - { model?: string, background?: boolean }
 * @returns {object} { command: string, description: string }
 */
export function getClaudeCommand(stage, options = {}) {
  let command = '';
  let description = '';

  switch (stage) {
    case 'spec':
      command = 'claude -p';
      description = 'Delegate spec generation to Claude';
      break;
    case 'implement':
      command = 'claude -p';
      description = 'Delegate implementation to Claude';
      break;
    case 'verify':
      command = 'claude -p';
      description = 'Delegate verification to Claude';
      break;
    case 'supervise':
      command = 'claude -p';
      description = 'Delegate review to Claude';
      break;
    default:
      throw new Error('Unknown stage: ' + stage);
  }

  // Add optional flags
  if (options.model) {
    command += ` --model ${options.model}`;
  }
  if (options.background) {
    command += ' --background';
  }

  return { command, description };
}

/**
 * Resolve which engine to use for a given SIVS stage from Codex
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} config - parsed sivs-config.json object (or empty for defaults)
 * @returns {object} { engine: string, warning?: string, command?: object }
 */
export function resolveReverseEngine(stage, config = {}) {
  config = config ?? {};
  const stageConfig = config[stage] || { engine: 'codex' };
  const engine = stageConfig.engine || 'codex';

  if (engine === 'codex') {
    return { engine: 'codex' };
  }

  if (engine === 'claude') {
    if (!isClaudeCliAvailable()) {
      return {
        engine: 'codex',
        warning: 'claude CLI not found on PATH. Falling back to Codex (solo). Install Claude Code CLI to enable reverse delegation.'
      };
    }

    if (isClaudeCliAuthenticated()) {
      return {
        engine: 'claude',
        command: getClaudeCommand(stage, stageConfig)
      };
    }

    return {
      engine: 'codex',
      warning: 'claude CLI is not authenticated. Falling back to Codex (solo). Run `claude auth login` or `/login` to enable reverse delegation.'
    };
  }

  return { engine: 'codex' };
}
