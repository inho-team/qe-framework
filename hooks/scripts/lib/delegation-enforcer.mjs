#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Model tier hierarchy (lower index = lower cost/capability)
 */
const MODEL_TIERS = ['haiku', 'sonnet', 'opus'];

function getTierIndex(model) {
  if (!model) return -1;
  const normalized = model.toLowerCase().trim();
  return MODEL_TIERS.findIndex(t => normalized.includes(t));
}

/**
 * Parse YAML frontmatter from an agent .md file.
 * Returns the frontmatter key-value pairs as an object.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }
  return fm;
}

/**
 * Resolve the agent .md file path from an agent name.
 * Searches the agents/ directory relative to the project root.
 */
function resolveAgentPath(cwd, agentName) {
  // Normalize: strip leading slash, add .md if needed
  const name = agentName.replace(/^\//, '').replace(/\.md$/, '');
  const candidates = [
    join(cwd, 'agents', `${name}.md`),
    join(cwd, 'agents', `${name}`, 'AGENT.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Get the recommended model for a given agent name.
 * @param {string} cwd - Project root
 * @param {string} agentName - Agent name (e.g., "Etask-executor")
 * @returns {string|null} Recommended model string or null if not found
 */
export function getAgentRecommendedModel(cwd, agentName) {
  const agentPath = resolveAgentPath(cwd, agentName);
  if (!agentPath) return null;

  try {
    const content = readFileSync(agentPath, 'utf8');
    const fm = parseFrontmatter(content);
    return fm.recommendedModel || null;
  } catch {
    return null;
  }
}

/**
 * Check delegation and determine what action to take.
 *
 * @param {string} cwd - Project root
 * @param {object} toolInput - The tool_input from the Agent tool call
 * @returns {{ action: 'allow'|'inject'|'warn', model: string|null, message: string }}
 */
export function checkDelegation(cwd, toolInput) {
  // The real Claude Code delegation payload is the Task tool with
  // `tool_input.subagent_type`. Older/other runtimes may use `agent`/`agentName`/
  // `name`. Accept all so a schema mismatch never silently no-ops the enforcer.
  const agentName =
    toolInput.subagent_type || toolInput.subagentType ||
    toolInput.agent || toolInput.agentName || toolInput.name || '';
  if (!agentName) {
    return { action: 'allow', model: null, message: '' };
  }

  const recommended = getAgentRecommendedModel(cwd, agentName);
  if (!recommended) {
    return { action: 'allow', model: null, message: '' };
  }

  const specifiedModel = toolInput.model || toolInput.modelName || '';

  // Case 1: No model specified -> auto-inject the recommended model
  if (!specifiedModel) {
    return {
      action: 'inject',
      model: recommended,
      message: `[DELEGATION] Auto-injecting model "${recommended}" for agent ${agentName} (per agent frontmatter recommendedModel).`
    };
  }

  const specifiedTier = getTierIndex(specifiedModel);
  const recommendedTier = getTierIndex(recommended);

  // If we can't determine tiers, allow without intervention
  if (specifiedTier === -1 || recommendedTier === -1) {
    return { action: 'allow', model: specifiedModel, message: '' };
  }

  // Case 2: Specified is LOWER than recommended -> allow (cost saving is intentional)
  if (specifiedTier < recommendedTier) {
    return { action: 'allow', model: specifiedModel, message: '' };
  }

  // Case 3: Specified matches recommended -> allow
  if (specifiedTier === recommendedTier) {
    return { action: 'allow', model: specifiedModel, message: '' };
  }

  // Case 4: Specified is HIGHER than recommended -> warn (cost awareness)
  return {
    action: 'warn',
    model: specifiedModel,
    message: `[DELEGATION] ${agentName} recommends "${recommended}", but "${specifiedModel}" was requested. Allowing but flagging for cost awareness.`
  };
}

/**
 * Update delegation stats in the unified state object (mutates in place).
 * @param {object} state - The unified-state object
 * @param {'inject'|'warn'|'allow'} action - The delegation action taken
 */
export function updateDelegationStats(state, action) {
  if (!state.delegationStats) {
    state.delegationStats = { overrides: 0, autoInjections: 0, warnings: 0 };
  }
  const stats = state.delegationStats;

  switch (action) {
    case 'inject':
      stats.autoInjections = (stats.autoInjections || 0) + 1;
      break;
    case 'warn':
      stats.warnings = (stats.warnings || 0) + 1;
      stats.overrides = (stats.overrides || 0) + 1;
      break;
    // 'allow' does not increment any counter
  }
}
