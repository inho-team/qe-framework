'use strict';

import { existsSync, readFileSync } from './qe-fs.mjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY_DOC = join(HERE, '..', '..', '..', 'core', 'CONTEXT_BUDGET.md');

export const CONTEXT_POLICY_DEFAULTS = Object.freeze({
  green_max_tokens: 100000,
  warning_tokens: 140000,
  critical_tokens: 170000,
  warning_ratio: 0.70,
  critical_ratio: 0.85,
  default_window_tokens: 200000,
  extended_window_tokens: 1000000,
  tier_split_tokens: 400000,
  debounce_tool_calls: 5,
});

export const CONTEXT_SEVERITY = Object.freeze({
  NONE: 'none',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

export const CONTEXT_SEVERITY_ORDER = Object.freeze({
  none: 0,
  warning: 1,
  critical: 2,
});

function coercePositiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function coerceRatio(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
    ? value
    : fallback;
}

function normalizePolicy(raw) {
  const defaults = CONTEXT_POLICY_DEFAULTS;
  const policy = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    green_max_tokens: coercePositiveInt(policy.green_max_tokens, defaults.green_max_tokens),
    warning_tokens: coercePositiveInt(policy.warning_tokens, defaults.warning_tokens),
    critical_tokens: coercePositiveInt(policy.critical_tokens, defaults.critical_tokens),
    warning_ratio: coerceRatio(policy.warning_ratio, defaults.warning_ratio),
    critical_ratio: coerceRatio(policy.critical_ratio, defaults.critical_ratio),
    default_window_tokens: coercePositiveInt(policy.default_window_tokens, defaults.default_window_tokens),
    extended_window_tokens: coercePositiveInt(policy.extended_window_tokens, defaults.extended_window_tokens),
    tier_split_tokens: coercePositiveInt(policy.tier_split_tokens, defaults.tier_split_tokens),
    debounce_tool_calls: coercePositiveInt(policy.debounce_tool_calls, defaults.debounce_tool_calls),
  });
}

function parsePolicyBlock(markdown) {
  if (typeof markdown !== 'string') return null;
  const match = markdown.match(/<!--\s*qe:context-policy\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function loadContextPolicy(docPath = DEFAULT_POLICY_DOC) {
  try {
    if (!docPath || !existsSync(docPath)) return CONTEXT_POLICY_DEFAULTS;
    return normalizePolicy(parsePolicyBlock(readFileSync(docPath, 'utf8')));
  } catch {
    return CONTEXT_POLICY_DEFAULTS;
  }
}

export function usedTokensFromRatio(ratio, limit) {
  const r = typeof ratio === 'number' ? Math.max(0, Math.min(1, ratio)) : 0;
  const l = typeof limit === 'number' && limit > 0
    ? limit
    : CONTEXT_POLICY_DEFAULTS.default_window_tokens;
  return Math.round(r * l);
}

export function estimateContextSeverity(usedTokens, policy = loadContextPolicy()) {
  const tokens = typeof usedTokens === 'number' && Number.isFinite(usedTokens)
    ? Math.max(0, usedTokens)
    : 0;
  const limit = policy.default_window_tokens;
  if (tokens >= policy.critical_ratio * limit) return CONTEXT_SEVERITY.CRITICAL;
  if (tokens >= policy.warning_ratio * limit) return CONTEXT_SEVERITY.WARNING;
  return CONTEXT_SEVERITY.NONE;
}

export function estimateContextSeverityFromRatio(ratio, limit, policy = loadContextPolicy()) {
  const r = typeof ratio === 'number' && Number.isFinite(ratio)
    ? Math.max(0, Math.min(1, ratio))
    : 0;
  if (r >= policy.critical_ratio) return CONTEXT_SEVERITY.CRITICAL;
  if (r >= policy.warning_ratio) return CONTEXT_SEVERITY.WARNING;
  return CONTEXT_SEVERITY.NONE;
}
