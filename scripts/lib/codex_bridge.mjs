#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from '../../hooks/scripts/lib/qe-fs.mjs';
import { homedir } from 'os';
import { join } from 'path';
import { isProcessAlive } from './process-liveness.mjs';
import {
  detectJobStaleness,
  getLatestDurableJobStatus as getLatestCodexJobStatus,
  isRuntimeLossMessage as isCodexRuntimeLossMessage,
  resolveDurableJobStateDir as resolveCodexStateDir,
} from './job-status.mjs';
import {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
  SIVS_STAGES,
  buildDelegationContext,
  loadSivsConfig,
  loadSvsConfig,
} from './delegation-context.mjs';

export { isProcessAlive } from './process-liveness.mjs';
export {
  detectJobStaleness,
  getLatestDurableJobStatus as getLatestCodexJobStatus,
  isRuntimeLossMessage as isCodexRuntimeLossMessage,
  resolveDurableJobStateDir as resolveCodexStateDir,
} from './job-status.mjs';
export {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
  SIVS_STAGES,
  buildDelegationContext,
  loadSivsConfig,
  loadSvsConfig,
};

/**
 * Check if codex-plugin-cc is installed
 * @returns {boolean} true if plugin directory exists, false otherwise
 */
export function isCodexPluginAvailable() {
  const pluginDir = join(homedir(), '.claude', 'plugins');

  // 1. Check installed_plugins.json registry (authoritative source)
  const registryPath = join(pluginDir, 'installed_plugins.json');
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const codexEntries = registry?.plugins?.['codex@openai-codex'];
      if (Array.isArray(codexEntries) && codexEntries.length > 0) {
        const installPath = codexEntries[0].installPath;
        if (installPath && existsSync(installPath)) {
          return true;
        }
      }
    } catch {
      // Fall through to directory checks
    }
  }

  // 2. Check for exact codex directory
  const codexPath = join(pluginDir, 'codex');
  if (existsSync(codexPath)) {
    return true;
  }

  // 3. Check top-level subdirectories for codex
  if (existsSync(pluginDir)) {
    try {
      const entries = readdirSync(pluginDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().includes('codex')) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Retired compatibility entrypoint for legacy cross-client Codex commands.
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - { model?: string, effort?: string, background?: boolean }
 * @returns {object} { command: string, description: string }
 */
export function getCodexCommand() {
  throw new Error('Cross-client Codex delegation is retired; the active client owns every SIVS stage.');
}

/**
 * Resolve client-neutral SIVS role defaults.
 *
 * @param {object} [options] - { codexAvailable?: boolean }
 * @returns {object} default SIVS config
 */
export function getDefaultSivsConfig(options = {}) {
  return {
    spec: {}, implement: {}, verify: { effort: 'high' }, supervise: { effort: 'high' },
  };
}

/**
 * Build a Codex delegation payload with the existing command object plus
 * artifact context that callers can append to the Codex prompt/input.
 *
 * This is intentionally separate from getCodexCommand() so existing callers keep
 * the original return shape unchanged.
 *
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - getCodexCommand options plus taskPath/checklistPath/planPath/cwd
 * @returns {{ command: { command: string, description: string }, context: string, warnings: string[], artifacts: Array<{ kind: string, path: string, bytes: number, truncated: boolean }> }}
 */
export function buildDelegationPayload(stage, options = {}) {
  void stage; void options;
  throw new Error('Cross-client Codex delegation is retired; use a host-native subagent.');
}

/**
 * The four SIVS stages, in canonical order.
 * @type {string[]}
 */
/**
 * Legacy profile registry retained as an empty compatibility export.
 * @type {Record<string, { spec: string, implement: string, verify: string, supervise: string }>}
 */
export const SIVS_PROFILES = Object.freeze({});

/**
 * Expand a named profile into an explicit sivs-config object.
 * The returned object carries a `profile` metadata field plus one engine entry
 * per stage. The enforcer and resolveEngine() read the stage entries and ignore
 * the metadata field, so routing behaviour is unchanged.
 * @param {string} name - one of SIVS_PROFILES keys
 * @returns {object} { profile, spec, implement, verify, supervise }
 * @throws {Error} when the profile name is unknown
 */
export function expandProfile(name) {
  throw new Error(`SIVS profile "${name}" is retired; configure model, effort, and compaction per stage.`);
}

/**
 * Compatibility label for the current single-AI policy.
 * @param {object} [config] - parsed sivs-config.json (may include a profile field)
 * @param {object} [options] - { codexAvailable?: boolean } to fill unset stages
 * @returns {string} profile name or 'custom'
 */
export function resolveProfileName(config = {}, options = {}) {
  void config; void options;
  return 'single-ai';
}

/**
 * Resolve the host's active client for a given SIVS stage without fallback.
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} config - parsed sivs-config.json object (or empty for defaults)
 * @param {object} [options] - { codexAvailable?: boolean, base?: 'claude'|'codex', claudeReachable?: boolean }
 * @returns {object} { engine: string, warning?: string, command?: object }
 */
export function resolveEngine(stage, config = {}, options = {}) {
  if (!SIVS_STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  if (config?.profile !== undefined || config?.[stage]?.engine !== undefined || config?.[stage]?.background !== undefined) {
    throw new Error('Legacy cross-client SIVS routing is unsupported. Remove profile, engine, and background.');
  }
  const activeClient = options.activeClient || options.base || 'codex';
  return { engine: activeClient, reason: 'active_client_owns_stage' };
}

/**
 * Detect if legacy v3.x team-config.json or v4.x svs-config.json exists
 * @returns {string | null} warning message or null if not found
 */
export function detectLegacyConfig() {
  const legacyTeamConfigPath = join(process.cwd(), '.qe', 'ai-team', 'config', 'team-config.json');
  const legacySvsConfigPath = join(process.cwd(), '.qe', 'svs-config.json');

  if (existsSync(legacyTeamConfigPath)) {
    return `\u26a0\ufe0f Legacy v3.x team-config.json detected.
Migration to .qe/sivs-config.json is recommended.
Mapping: planner \u2192 spec, implementer \u2192 implement, reviewer \u2192 verify, supervisor \u2192 supervise`;
  }

  if (existsSync(legacySvsConfigPath)) {
    return `\u26a0\ufe0f Legacy v4.x svs-config.json detected.
Migration to .qe/sivs-config.json is recommended.
The "verify" stage has been split into "implement" (coding) and "verify" (validation).`;
  }

  return null;
}

/**
 * Load .qe/sivs-config.json from a project directory.
 * Legacy .qe/svs-config.json and engine-routing fields are rejected.
 * @param {string} [cwd] - project root to read from; defaults to process.cwd().
 *   Hook callers should pass their resolved session cwd so config loading stays
 *   consistent with the rest of the hook (audit log, routing, context injection).
 * @returns {object} parsed config or empty object if file doesn't exist
 */
/**
 * Get codex-plugin-cc version info from installed_plugins.json
 * @returns {{ installed: boolean, version?: string, installPath?: string, installedAt?: string, gitCommitSha?: string } }
 */
export function getCodexPluginInfo() {
  const registryPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  if (!existsSync(registryPath)) {
    return { installed: false };
  }

  try {
    const content = readFileSync(registryPath, 'utf-8');
    const registry = JSON.parse(content);
    const codexEntries = registry?.plugins?.['codex@openai-codex'];

    if (!codexEntries || codexEntries.length === 0) {
      return { installed: false };
    }

    // Use the first (most recent) entry
    const entry = codexEntries[0];
    return {
      installed: true,
      version: entry.version || 'unknown',
      installPath: entry.installPath || null,
      installedAt: entry.installedAt || null,
      gitCommitSha: entry.gitCommitSha || null,
    };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if Codex is reachable (plugin available + no recent *relevant* errors).
 *
 * Refinement (Phase 2.1): the 5-minute error TTL is scoped to the current stage.
 * A recent error recorded for a different stage no longer hard-blocks codex for
 * all gates — instead it returns reachable:true with `degraded:true` so callers
 * (and the gate audit) can surface the reduced confidence rather than silently
 * suppressing the cross-model upgrade across unrelated work. A true live ping is
 * intentionally not attempted: codex is an async companion with no cheap
 * synchronous liveness probe, so pinging every gate would add latency.
 *
 * Backward compatible: still returns `{ reachable, reason }`; callers that pass a
 * single arg behave as before (the new `degraded` field is additive).
 *
 * @param {object} [state] - Unified state object containing codex_last_error field
 * @param {object} [options] - { stage } current SIVS stage for error scoping
 * @returns {{ reachable: boolean, reason?: string, degraded?: boolean }}
 */
export function isCodexReachable(state = {}, options = {}) {
  return evaluateCodexReachability(state, options, isCodexPluginAvailable());
}

/**
 * Pure reachability decision — separated from environment probing so every branch
 * is deterministically testable (the install state is injected, not read).
 * @param {object} state - { codex_last_error?: { timestamp, type?, stage? } }
 * @param {object} options - { stage? } current SIVS stage for error scoping
 * @param {boolean} pluginAvailable - result of isCodexPluginAvailable()
 * @returns {{ reachable: boolean, reason?: string, degraded: boolean }}
 */
export function evaluateCodexReachability(state = {}, options = {}, pluginAvailable = false) {
  if (!pluginAvailable) {
    return { reachable: false, reason: 'plugin_missing', degraded: false };
  }
  const lastError = state.codex_last_error;
  if (lastError) {
    // An error record exists. Fail-closed on a missing/empty/unparseable
    // timestamp (NaN age) — treat it as recent rather than silently ignoring it.
    const ageMs = lastError.timestamp ? Date.now() - new Date(lastError.timestamp).getTime() : NaN;
    const isRecent = !Number.isFinite(ageMs) || ageMs < 300000; // 5 minutes TTL
    if (isRecent) {
      const errStage = lastError.stage;
      const curStage = options.stage;
      // Scope the suppression: block only when the recent error is for this stage
      // (or when no stage context is available on either side — safe default).
      if (!errStage || !curStage || errStage === curStage) {
        return { reachable: false, reason: `recent_error:${lastError.type || 'unknown'}`, degraded: false };
      }
      // Recent error for a different stage → still reachable, but flag degraded.
      return { reachable: true, reason: `recent_error_other_stage:${lastError.type || 'unknown'}`, degraded: true };
    }
  }
  return { reachable: true, degraded: false };
}

/**
 * Redact sensitive or environment-specific details before surfacing companion
 * diagnostics through QE status/reporting paths.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeCodexDiagnosticMessage(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, '<redacted-token>')
    .replace(/(?:\/Users|\/home|\/var\/folders|\/tmp)\/[^\s'"`<>)]*/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

/**
 * Build a useful, bounded failure message from execFileSync errors.
 * @param {unknown} err
 * @returns {string}
 */
function execFailureMessage(err) {
  const parts = execFailureParts(err);
  const message = parts.join('\n').trim();
  return message.length > 2000 ? `${message.slice(0, 2000)}…` : message;
}

/**
 * Extract raw child-process failure streams. Classification uses these raw parts
 * before display truncation so late runtime-loss markers are not dropped.
 * @param {unknown} err
 * @returns {string[]}
 */
function execFailureParts(err) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (err?.stderr) parts.push(Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr));
  if (err?.stdout) parts.push(Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : String(err.stdout));
  return parts;
}

/**
 * Resolve the Codex companion script path from the plugin registry, so qe can
 * drive `codex-companion.mjs cancel` without hardcoding a version directory.
 * @returns {string|null} absolute path to codex-companion.mjs, or null
 */
export function resolveCodexCompanionScript() {
  const registryPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(registryPath)) return null;
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const entries = registry?.plugins?.['codex@openai-codex'];
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const installPath = entries[0].installPath;
    if (!installPath) return null;
    const script = join(installPath, 'scripts', 'codex-companion.mjs');
    return existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

/**
 * Reap zombie Codex jobs for a workspace — jobs whose persisted status is still
 * `running` but whose worker process is confirmed gone (`staleKind === 'process-dead'`).
 *
 * Reaping goes through the Codex `cancel` command rather than editing state.json
 * directly, so Codex stays the single writer of its own job state (both the
 * state.json summary and the per-job file are kept consistent). Weak `log-silent`
 * signals are deliberately NOT auto-reaped — they are reported in `skipped` so a
 * slow-but-alive job is never killed by a false positive.
 *
 * Never throws: a missing companion, unreadable state, or a failed cancel is
 * captured in the result so this is safe to call from hooks.
 *
 * @param {string} cwd - workspace root
 * @param {object} [options] - { timeoutMs?: number, companionScript?: string }
 *   companionScript overrides the auto-resolved codex-companion path (tests).
 * @returns {{ reaped: Array<{id:string,reason:string}>, skipped: Array<{id:string,reason:string}>, errors: Array<{id:string,reason:string,runtimeLost?:boolean,kind?:string}> }}
 */
export function reapStaleCodexJobs(cwd, options = {}) {
  const result = { reaped: [], skipped: [], errors: [] };

  const stateDir = resolveCodexStateDir(cwd);
  if (!stateDir) return result;
  const stateFile = join(stateDir, 'state.json');
  if (!existsSync(stateFile)) return result;

  let jobs;
  try {
    jobs = JSON.parse(readFileSync(stateFile, 'utf-8'))?.jobs;
  } catch {
    return result;
  }
  if (!Array.isArray(jobs)) return result;

  const runningStale = jobs
    .filter((job) => job.status === 'running')
    .map((job) => ({ job, ...detectJobStaleness(job) }))
    .filter((entry) => entry.stale);

  if (runningStale.length === 0) return result;

  // Weak signals are surfaced but never auto-cancelled.
  for (const { job, staleReason } of runningStale.filter((e) => e.staleKind !== 'process-dead')) {
    result.skipped.push({ id: job.id, reason: `weak signal (${staleReason}); not auto-reaped` });
  }

  const confirmed = runningStale.filter((e) => e.staleKind === 'process-dead');
  if (confirmed.length === 0) return result;

  const companion = options.companionScript || resolveCodexCompanionScript();
  if (!companion) {
    for (const { job, staleReason } of confirmed) {
      result.errors.push({ id: job.id, reason: `codex companion script not found; cannot reap (${staleReason})` });
    }
    return result;
  }

  for (const { job, staleReason } of confirmed) {
    try {
      execFileSync('node', [companion, 'cancel', job.id, '--cwd', cwd], {
        encoding: 'utf8',
        input: '',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeoutMs ?? 10000,
      });
      result.reaped.push({ id: job.id, reason: staleReason });
    } catch (err) {
      const rawParts = execFailureParts(err);
      const detail = execFailureMessage(err) || 'codex cancel failed';
      const runtimeLost = rawParts.some(isCodexRuntimeLossMessage);
      const safeDetail = sanitizeCodexDiagnosticMessage(detail) || 'codex cancel failed';
      result.errors.push({
        id: job.id,
        reason: runtimeLost
          ? `codex runtime lost while cancelling stale job (${staleReason}): ${safeDetail}`
          : safeDetail,
        ...(runtimeLost ? { runtimeLost: true, kind: 'runtime-lost' } : {}),
      });
    }
  }

  return result;
}
