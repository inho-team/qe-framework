/**
 * @fileoverview SIVS engine routing enforcement module.
 * Pure functions only — no side effects on import.
 *
 * Scope: this module enforces which ENGINE handles each SIVS stage (per
 * `.qe/sivs-config.json`) and audits routing decisions. It is complementary to —
 * and distinct from — the **stage verification gates** (the self-reference
 * defense), which are skill-driven (`skills/Qcritical-review/reference/*-gate-protocol.md`),
 * record their verdicts via `gate-audit.mjs`, and fold agent verdicts via
 * `gate-verdict.mjs`. Routing enforcement decides *who runs a stage*; the gates
 * decide *whether the stage's output is trustworthy*.
 *
 * @module hooks/scripts/lib/sivs-enforcer
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// subagent_type → SIVS stage mapping
const STAGE_MAP = {
  'Etask-executor': 'implement',
  'qe-framework:Etask-executor': 'implement',
  'Esupervision-orchestrator': 'supervise',
  'qe-framework:Esupervision-orchestrator': 'supervise',
  'Ecode-quality-supervisor': 'verify',
  'qe-framework:Ecode-quality-supervisor': 'verify',
  'Ecode-reviewer': 'verify',
  'qe-framework:Ecode-reviewer': 'verify',
};

/**
 * Infers SIVS stage from codex subagent prompt/description text.
 * @param {string} text - Prompt or description string to analyze
 * @returns {string} SIVS stage name: 'implement', 'verify', 'supervise', or 'spec'
 */
function inferStageFromText(text) {
  const t = text || '';
  if (/--write|implement/i.test(t)) return 'implement';
  if (/--verify|verify/i.test(t)) return 'verify';
  if (/review|supervise/i.test(t)) return 'supervise';
  return 'spec';
}

/**
 * Resolves the SIVS stage and actual engine from the Agent tool input.
 * @param {object} toolInput - Agent tool input object containing subagent_type and prompt
 * @returns {{ stage: string|null, actualEngine: string }} Resolved stage and engine identifier
 */
function resolveStageAndEngine(toolInput) {
  const subagentType = (toolInput && (toolInput.subagent_type || toolInput.subagentType)) || '';
  const prompt = (toolInput && (toolInput.prompt || toolInput.description)) || '';

  // Codex subagent patterns
  if (subagentType.startsWith('codex:') || subagentType.includes('codex-rescue') || subagentType.includes('codex-result-handling')) {
    const stage = inferStageFromText(prompt);
    return { stage, actualEngine: 'codex' };
  }

  // Known Claude subagent types
  const stage = STAGE_MAP[subagentType] || null;
  return { stage, actualEngine: 'claude-agent' };
}

/** Enforces SIVS engine routing policy for an Agent tool call.
 * @param {object} toolInput - Agent tool input (data.tool_input); must include subagent_type
 * @param {object} sivsConfig - Parsed sivs-config.json, or empty object when not configured
 * @param {object} [codexReachable] - isCodexReachable() result; defaults to { reachable: true }
 * @returns {object} Decision: { action: 'allow'|'block'|'fallback', stage, configuredEngine, actualEngine, reason } */
export function enforceRouting(toolInput, sivsConfig, codexReachable = { reachable: true }) {
  const { stage, actualEngine } = resolveStageAndEngine(toolInput);

  // No stage resolved or no sivs config → allow immediately (zero impact on unknown agents)
  if (!stage || !sivsConfig || Object.keys(sivsConfig).length === 0) {
    return { action: 'allow', stage, configuredEngine: 'claude', actualEngine, reason: 'no_sivs_config' };
  }

  const stageEntry = sivsConfig[stage];
  // Stage has no config entry → skip enforcement
  if (!stageEntry) {
    return { action: 'allow', stage, configuredEngine: 'claude', actualEngine, reason: 'no_stage_config' };
  }

  const configuredEngine = stageEntry.engine || 'claude';

  // Engines match → allow
  if (configuredEngine === actualEngine || (configuredEngine === 'claude' && actualEngine === 'claude-agent')) {
    return { action: 'allow', stage, configuredEngine, actualEngine, reason: 'match' };
  }

  // Config requires codex, actual is claude-agent
  if (configuredEngine === 'codex' && actualEngine === 'claude-agent') {
    if (codexReachable && codexReachable.reachable === false) {
      return { action: 'fallback', stage, configuredEngine, actualEngine, reason: codexReachable.reason || 'codex_unreachable' };
    }
    return { action: 'block', stage, configuredEngine, actualEngine, reason: 'sivs_config_requires_codex' };
  }

  // Config requires claude, actual is codex → soft allow (codex override is fine, just add hint)
  if (configuredEngine === 'claude' && actualEngine === 'codex') {
    return { action: 'allow', stage, configuredEngine, actualEngine, reason: 'codex_override_allowed' };
  }

  // Default: allow unknown combinations
  return { action: 'allow', stage, configuredEngine, actualEngine, reason: 'unknown_combination' };
}

/** Appends a SIVS routing audit log entry to .qe/agent-results/sivs-audit.log.
 * @param {string} cwd - Project root directory used to resolve the log path
 * @param {object} entry - Routing result from enforceRouting(); must include action field
 * @returns {void} */
export function appendAuditLog(cwd, entry) {
  const dir = join(cwd, '.qe', 'agent-results');
  try { mkdirSync(dir, { recursive: true }); } catch {}

  // Sanitize reason to prevent log injection via newlines or pipe characters
  const safeReason = (entry.reason || '').replace(/[\n\r|]/g, ' ');
  const line = `${new Date().toISOString()} | ${entry.stage || '-'} | config=${entry.configuredEngine || '-'} | actual=${entry.actualEngine || '-'} | ${entry.action || '-'} | ${safeReason}\n`;

  try { appendFileSync(join(dir, 'sivs-audit.log'), line); } catch {}
}
