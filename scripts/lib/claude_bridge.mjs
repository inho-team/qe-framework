#!/usr/bin/env node

import { buildDelegationContext, loadSivsConfig } from './delegation-context.mjs';

export { buildDelegationContext, loadSivsConfig };

// The module path and exports remain for compatibility, but cross-client
// execution is retired. Artifact context remains client-neutral and reusable.

/**
 * Retired cross-client CLI probe. Host-native Claude sessions do not need it.
 * @returns {boolean} true if claude binary is found, false otherwise
 */
export function isClaudeCliAvailable() {
  return false;
}

/**
 * Retired cross-client authentication probe.
 * @returns {boolean} true when `claude auth status` reports loggedIn:true
 */
export function isClaudeCliAuthenticated() {
  return false;
}

/**
 * Retired compatibility entrypoint for legacy cross-client Claude commands.
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - { model?: string, background?: boolean }
 * @returns {object} { command: string, argv: string[], description: string }
 */
export function getClaudeCommand(stage, options = {}) {
  void stage; void options;
  throw new Error('Cross-client Claude delegation is retired; the active client owns every SIVS stage.');
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
  void stage; void options;
  throw new Error('Cross-client Claude delegation is retired; use a host-native subagent.');
}

/**
 * Resolve which engine to use for a given SIVS stage from Codex
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} config - parsed sivs-config.json object (or empty for defaults)
 * @returns {object} { engine: string, warning?: string, command?: object }
 */
export function resolveReverseEngine(stage, config = {}) {
  if (config?.profile !== undefined || config?.[stage]?.engine !== undefined || config?.[stage]?.background !== undefined) {
    throw new Error('Legacy cross-client SIVS routing is unsupported. Remove profile, engine, and background.');
  }
  return { engine: 'codex', reason: 'active_client_owns_stage' };
}
