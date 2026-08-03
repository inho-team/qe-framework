/**
 * @fileoverview SIVS engine routing enforcement module.
 * Pure functions only — no side effects on import.
 *
 * Scope: this module enforces the single-AI session boundary and audits routing
 * decisions. `.qe/sivs-config.json` configures roles, not engines. It is complementary to —
 * and distinct from — the **stage verification gates** (the self-reference
 * defense), which are skill-driven (`skills/Qcritical-review/reference/*-gate-protocol.md`),
 * record their verdicts via `gate-audit.mjs`, and fold agent verdicts via
 * `gate-verdict.mjs`. Routing enforcement decides *who runs a stage*; the gates
 * decide *whether the stage's output is trustworthy*.
 *
 * @module hooks/scripts/lib/sivs-enforcer
 */

import { appendFileSync, mkdirSync } from './qe-fs.mjs';
import { join } from 'path';

// subagent_type → SIVS stage mapping
const STAGE_MAP = {
  'Etask-executor': 'implement',
  'qe-framework:Etask-executor': 'implement',
  'Esupervision-orchestrator': 'supervise',
  'qe-framework:Esupervision-orchestrator': 'supervise',
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
 * @returns {{ stage: string|null, requestedClient: string|null }} Resolved stage and explicit client request
 */
function resolveStageAndClient(toolInput) {
  const subagentType = (toolInput && (toolInput.subagent_type || toolInput.subagentType)) || '';
  const prompt = (toolInput && (toolInput.prompt || toolInput.description)) || '';

  // Codex subagent patterns
  if (subagentType.startsWith('codex:') || subagentType.includes('codex-rescue') || subagentType.includes('codex-result-handling')) {
    const stage = inferStageFromText(prompt);
    return { stage, requestedClient: 'codex' };
  }

  // Known Claude subagent types
  const stage = STAGE_MAP[subagentType] || null;
  const requestedClient = toolInput?.client || toolInput?.engine || toolInput?.provider || null;
  return { stage, requestedClient };
}

function findLegacyRoutingField(config) {
  if (!config || typeof config !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(config, 'profile')) return 'profile';
  for (const [stage, entry] of Object.entries(config)) {
    if (!entry || typeof entry !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(entry, 'engine')) return `${stage}.engine`;
    if (Object.prototype.hasOwnProperty.call(entry, 'background')) return `${stage}.background`;
  }
  return null;
}

/** Enforces SIVS engine routing policy for an Agent tool call.
 * @param {object} toolInput - Agent tool input (data.tool_input); must include subagent_type
 * @param {object} sivsConfig - Parsed sivs-config.json, or empty object when not configured
 * @param {object} [session] - { activeClient?: 'claude'|'codex' }; legacy reachability objects are ignored
 * @returns {object} Decision: { action: 'allow'|'block', stage, activeClient, requestedClient, reason } */
export function enforceRouting(toolInput, sivsConfig, session = {}) {
  const { stage, requestedClient } = resolveStageAndClient(toolInput);
  const activeClient = session?.activeClient || toolInput?.active_client || toolInput?.activeClient || null;
  const legacyField = findLegacyRoutingField(sivsConfig);

  if (legacyField) {
    return {
      action: 'block', stage, activeClient, requestedClient,
      configuredEngine: null, actualEngine: requestedClient,
      reason: `legacy_cross_client_config:${legacyField}`,
    };
  }

  if (activeClient && requestedClient && requestedClient !== activeClient) {
    return {
      action: 'block', stage, activeClient, requestedClient,
      configuredEngine: activeClient, actualEngine: requestedClient,
      reason: 'cross_client_delegation_disabled',
    };
  }

  if (!activeClient && requestedClient) {
    return {
      action: 'block', stage, activeClient, requestedClient,
      configuredEngine: null, actualEngine: requestedClient,
      reason: 'active_client_required',
    };
  }

  return {
    action: 'allow', stage, activeClient, requestedClient,
    configuredEngine: activeClient, actualEngine: requestedClient,
    reason: stage ? 'active_client_owns_stage' : 'client_neutral_agent',
  };
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

/**
 * Compatibility export for callers that previously checked provider pools.
 * Single-AI verification independence is role/fresh-context based.
 * @param {object} sivsConfig - parsed .qe/sivs-config.json
 * @returns {{ ok: boolean, reason: string, implement: string, verify: string }}
 */
export function checkSivsPoolDisjoint(sivsConfig) {
  const legacyField = findLegacyRoutingField(sivsConfig);
  return {
    ok: !legacyField,
    reason: legacyField ? `legacy_cross_client_config:${legacyField}` : 'role_separated_fresh_context',
    implement: 'active-client',
    verify: 'active-client',
  };
}
