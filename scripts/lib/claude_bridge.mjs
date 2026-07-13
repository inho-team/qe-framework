#!/usr/bin/env node

import { execFileSync } from 'child_process';

import { buildDelegationContext, loadSivsConfig } from './codex_bridge.mjs';

export { buildDelegationContext, loadSivsConfig };

// Reverse-path parity note: artifact context is shared via codex_bridge.mjs.
// Codex->Claude execution is owned here/Qclaude-rescue, not by qe-mcp runner
// tools. Use argv-style execution for prompts; command strings are display
// metadata only.

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
 * @returns {object} { command: string, argv: string[], description: string }
 */
export function getClaudeCommand(stage, options = {}) {
  const argv = ['claude', '-p'];
  let description = '';

  switch (stage) {
    case 'spec':
      description = 'Delegate spec generation to Claude';
      break;
    case 'implement':
      description = 'Delegate implementation to Claude';
      break;
    case 'verify':
      description = 'Delegate verification to Claude';
      break;
    case 'supervise':
      description = 'Delegate review to Claude';
      break;
    default:
      throw new Error('Unknown stage: ' + stage);
  }

  // Add optional flags
  if (options.model) {
    argv.push('--model', String(options.model));
  }
  if (options.background) {
    argv.push('--background');
  }

  return { command: argv.join(' '), argv, description };
}

/**
 * Build a Claude reverse-delegation payload with the existing command object
 * plus artifact context that callers can prepend to the Claude prompt.
 *
 * This is intentionally separate from getClaudeCommand() so existing callers
 * keep the original return shape unchanged.
 *
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - getClaudeCommand options plus taskPath/checklistPath/planPath/cwd
 * @returns {{ command: { command: string, description: string }, context: string, warnings: string[], artifacts: Array<{ kind: string, path: string, bytes: number, truncated: boolean }> }}
 */
export function buildReverseDelegationPayload(stage, options = {}) {
  const command = getClaudeCommand(stage, options);
  const { context, warnings, artifacts } = buildDelegationContext(stage, options);
  return { command, context, warnings, artifacts };
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
