#!/usr/bin/env node
'use strict';

/**
 * Effort compatibility layer for Claude/Codex engine mapping.
 * Handles budget_tokens → effort migration and cross-engine effort translation.
 *
 * Claude effort levels: low, medium, high, max
 * Codex effort levels: low, medium, high, xhigh
 */

/**
 * Map legacy budget_tokens value to effort level.
 * @param {number} budgetTokens - The budget_tokens value
 * @returns {string} effort level: 'low' | 'medium' | 'high' | 'max'
 */
export function mapBudgetTokensToEffort(budgetTokens) {
  if (typeof budgetTokens !== 'number' || budgetTokens <= 0) return 'medium';
  if (budgetTokens <= 1024) return 'low';
  if (budgetTokens <= 4096) return 'medium';
  if (budgetTokens <= 16384) return 'high';
  return 'max';
}

/**
 * Map effort level between Claude and Codex engines.
 * Claude 'max' ↔ Codex 'xhigh' are equivalent.
 * @param {string} effort - Source effort level
 * @param {string} fromEngine - Source engine ('claude' | 'codex')
 * @param {string} toEngine - Target engine ('claude' | 'codex')
 * @returns {string} Mapped effort level for the target engine
 */
export function mapEffortBetweenEngines(effort, fromEngine, toEngine) {
  if (fromEngine === toEngine) return effort;

  if (fromEngine === 'claude' && toEngine === 'codex') {
    return effort === 'max' ? 'xhigh' : effort;
  }

  if (fromEngine === 'codex' && toEngine === 'claude') {
    return effort === 'xhigh' ? 'max' : effort;
  }

  return effort;
}

/**
 * Normalize a stage config by converting budget_tokens to effort.
 * If both budget_tokens and effort are present, effort takes precedence.
 * @param {object} stageConfig - Stage configuration object
 * @returns {object} Normalized config with effort (budget_tokens removed if converted)
 */
export function normalizeEffort(stageConfig) {
  if (!stageConfig || typeof stageConfig !== 'object') return stageConfig;

  const result = { ...stageConfig };

  if (result.budget_tokens !== undefined && result.effort === undefined) {
    result.effort = mapBudgetTokensToEffort(result.budget_tokens);
    delete result.budget_tokens;
  } else if (result.budget_tokens !== undefined && result.effort !== undefined) {
    // effort takes precedence, remove budget_tokens
    delete result.budget_tokens;
  }

  return result;
}
