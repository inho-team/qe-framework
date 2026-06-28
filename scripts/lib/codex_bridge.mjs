#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';

// Per-artifact prompt injection cap. Large artifacts are trimmed before they are
// added to Codex input so delegation stays bounded and predictable.
export const DELEGATION_ARTIFACT_BYTE_CAP = 64 * 1024;
export const DELEGATION_TRUNCATION_MARKER = `[TRUNCATED: artifact exceeded ${DELEGATION_ARTIFACT_BYTE_CAP} bytes]`;

const DELEGATION_ARTIFACTS = [
  ['taskPath', 'TASK_REQUEST'],
  ['checklistPath', 'VERIFY_CHECKLIST'],
  ['planPath', 'PLAN'],
];

const CONTEXT_AUDIT_LOG_NAME = 'codex-context-audit.log';

function utf8SafePrefix(buffer, maxBytes) {
  if (buffer.length <= maxBytes) return buffer;

  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }

  const lead = buffer[end - 1];
  if (lead >= 0xc0) {
    end -= 1;
  }

  return buffer.subarray(0, Math.max(0, end));
}

function appendContextAuditLog(cwd, stage, artifacts, warnings) {
  if (!artifacts.length) return;

  const dir = join(cwd, '.qe', 'agent-results');
  const logPath = join(dir, CONTEXT_AUDIT_LOG_NAME);
  const entry = {
    timestamp: new Date().toISOString(),
    stage,
    artifacts: artifacts.map(({ kind, path, bytes, truncated }) => ({ kind, path, bytes, truncated })),
    warningCount: warnings.length,
  };

  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Audit logging is metadata-only and non-critical; never break delegation.
  }
}

/**
 * Build delimited artifact context for Codex delegation.
 *
 * Missing or unreadable artifact paths are skipped and reported as warnings.
 * Each artifact body is capped at DELEGATION_ARTIFACT_BYTE_CAP bytes and trimmed
 * on UTF-8 character boundaries before a truncation marker is appended.
 *
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - { taskPath?: string, checklistPath?: string, planPath?: string, cwd?: string, audit?: boolean }
 * @returns {{ context: string, warnings: string[], artifacts: Array<{ kind: string, path: string, bytes: number, truncated: boolean }> }}
 */
export function buildDelegationContext(stage, options = {}) {
  const cwd = options.cwd || process.cwd();
  const warnings = [];
  const artifacts = [];
  const sections = [];

  for (const [optionKey, kind] of DELEGATION_ARTIFACTS) {
    const artifactPath = options[optionKey];
    if (!artifactPath) continue;

    const resolvedPath = resolve(cwd, artifactPath);
    try {
      const buffer = readFileSync(resolvedPath);
      const bytes = buffer.length;
      const truncated = bytes > DELEGATION_ARTIFACT_BYTE_CAP;
      let content = utf8SafePrefix(buffer, DELEGATION_ARTIFACT_BYTE_CAP).toString('utf8');
      if (truncated) {
        content += `${content.endsWith('\n') ? '' : '\n'}${DELEGATION_TRUNCATION_MARKER}`;
      }

      sections.push(`=== ${kind} (${artifactPath}) ===\n${content}`);
      artifacts.push({ kind, path: artifactPath, bytes, truncated });
    } catch (err) {
      warnings.push(`Skipped ${kind} artifact ${artifactPath}: ${err?.code || err?.message || 'unreadable'}`);
    }
  }

  const context = sections.join('\n\n');
  if (options.audit !== false) {
    appendContextAuditLog(cwd, stage, artifacts, warnings);
  }

  return { context, warnings, artifacts };
}

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
 * Get codex command for a given SIVS stage
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} options - { model?: string, effort?: string, background?: boolean }
 * @returns {object} { command: string, description: string }
 */
export function getCodexCommand(stage, options = {}) {
  let command = '';
  let description = '';

  switch (stage) {
    case 'spec':
      command = '/codex:rescue';
      description = 'Delegate spec generation to Codex';
      break;
    case 'implement':
      command = '/codex:rescue --write';
      description = 'Delegate implementation to Codex';
      break;
    case 'verify':
      command = '/codex:rescue --verify';
      description = 'Delegate verification to Codex';
      break;
    case 'supervise':
      command = '/codex:review';
      description = 'Delegate code review to Codex';
      break;
    default:
      throw new Error(`Unknown stage: ${stage}`);
  }

  // Add optional flags
  if (options.model) {
    command += ` --model ${options.model}`;
  }
  if (options.effort) {
    command += ` --effort ${options.effort}`;
  }
  if (options.background) {
    command += ' --background';
  }

  return { command, description };
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
  const command = getCodexCommand(stage, options);
  const { context, warnings, artifacts } = buildDelegationContext(stage, options);
  return { command, context, warnings, artifacts };
}

/**
 * Resolve which engine to use for a given SIVS stage
 * @param {string} stage - "spec" | "implement" | "verify" | "supervise"
 * @param {object} config - parsed sivs-config.json object (or empty for defaults)
 * @returns {object} { engine: string, warning?: string, command?: object }
 */
export function resolveEngine(stage, config = {}) {
  const stageConfig = config[stage] || { engine: 'claude' };
  const engine = stageConfig.engine || 'claude';

  if (engine === 'claude') {
    return { engine: 'claude' };
  }

  if (engine === 'codex') {
    if (isCodexPluginAvailable()) {
      return {
        engine: 'codex',
        command: getCodexCommand(stage, stageConfig)
      };
    } else {
      return {
        engine: 'claude',
        warning: 'codex-plugin-cc not installed. Falling back to Claude. Install: /plugin install codex@openai-codex'
      };
    }
  }

  return { engine: 'claude' };
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
 * Load .qe/sivs-config.json from current working directory
 * Falls back to legacy .qe/svs-config.json for backward compatibility
 * @returns {object} parsed config or empty object if file doesn't exist
 */
export function loadSivsConfig() {
  const configPath = join(process.cwd(), '.qe', 'sivs-config.json');
  const legacyPath = join(process.cwd(), '.qe', 'svs-config.json');

  const pathToLoad = existsSync(configPath) ? configPath : (existsSync(legacyPath) ? legacyPath : null);

  if (!pathToLoad) {
    return {};
  }

  try {
    const content = readFileSync(pathToLoad, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// Backward compatibility alias
export const loadSvsConfig = loadSivsConfig;

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
 * Resolve Codex companion state directory for the given workspace.
 * The companion stores job state in:
 *   $CLAUDE_PLUGIN_DATA/state/{slug}-{hash}/  (primary)
 *   $TMPDIR/codex-companion/{slug}-{hash}/    (fallback)
 *
 * @param {string} cwd - Project root directory
 * @returns {string|null} Absolute path to state dir, or null if not found
 */
export function resolveCodexStateDir(cwd) {
  const basename = cwd.split('/').filter(Boolean).pop() || 'workspace';
  const slug = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  const dirName = `${slug}-${hash}`;

  // Primary: CLAUDE_PLUGIN_DATA
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    const primary = join(pluginData, 'state', dirName);
    if (existsSync(primary)) return primary;
  }

  // Fallback: tmpdir
  const fallback = join(tmpdir(), 'codex-companion', dirName);
  if (existsSync(fallback)) return fallback;

  return null;
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
 * Staleness threshold (ms): an active job whose log has been silent at least
 * this long, with no live worker process recorded, is treated as a soft
 * staleness signal. Override with CODEX_STALE_LOG_SILENCE_MS.
 */
const DEFAULT_STALE_LOG_SILENCE_MS = 5 * 60 * 1000;

function staleLogSilenceThresholdMs() {
  const raw = Number(process.env.CODEX_STALE_LOG_SILENCE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_LOG_SILENCE_MS;
}

/**
 * Liveness probe for a recorded worker pid. Uses signal 0, which performs the
 * existence/permission check without delivering a signal.
 * @param {number} pid
 * @returns {boolean|null} true=alive, false=gone, null=unknown (no/invalid pid)
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: alive but owned by another user.
    return err?.code === 'EPERM';
  }
}

/**
 * Milliseconds since a log file was last modified, or null if unreadable.
 * @param {string|null} logFile
 * @returns {number|null}
 */
function logSilenceMs(logFile) {
  if (!logFile) return null;
  try {
    return Date.now() - statSync(logFile).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Detect "zombie" Codex jobs: the persisted status still says running, but the
 * worker process is gone (or, when no pid is recorded, the log has been silent
 * far longer than expected). Codex's own status command only reads the stored
 * status field, so a crashed background job reports "running" forever. Doing the
 * check here lets the qe consumer surface the truth without patching the codex
 * plugin (which would be lost on every plugin update).
 *
 * Conservative by design: a confirmed-alive pid is always trusted (long log
 * gaps are normal while Codex writes a large file or runs a slow command), so
 * only crashed or pid-less-and-silent jobs are flagged.
 *
 * `staleKind` distinguishes confidence: `process-dead` is a strong, near-certain
 * signal (the recorded worker pid is gone) and is safe to auto-reap;
 * `log-silent` is a weak heuristic (no pid + quiet log) that a slow job can
 * trigger, so callers should surface it but NOT auto-cancel on it.
 *
 * @param {object} [job] - state.json job entry ({ status, pid, logFile })
 * @returns {{ stale: boolean, staleReason: string|null, staleKind: 'process-dead'|'log-silent'|null }}
 */
export function detectJobStaleness(job = {}) {
  if (job.status !== 'running') return { stale: false, staleReason: null, staleKind: null };

  const alive = isProcessAlive(job.pid);
  // Strong signal: recorded worker process is gone but status says running.
  if (alive === false) {
    return { stale: true, staleReason: `recorded process ${job.pid} is not running`, staleKind: 'process-dead' };
  }
  // Confirmed alive — trust it.
  if (alive === true) return { stale: false, staleReason: null, staleKind: null };

  // pid unknown — fall back to the log-silence heuristic only.
  const silenceMs = logSilenceMs(job.logFile);
  if (silenceMs != null && silenceMs > staleLogSilenceThresholdMs()) {
    return {
      stale: true,
      staleReason: `no log activity for ${Math.round(silenceMs / 60000)}m and no live process recorded`,
      staleKind: 'log-silent',
    };
  }
  return { stale: false, staleReason: null, staleKind: null };
}

/**
 * Get the latest Codex companion job status for the given workspace.
 * @param {string} cwd - Project root directory
 * @returns {{ found: boolean, jobId?: string, status?: string, phase?: string, pid?: number|null, completedAt?: string, error?: string, stale?: boolean, staleReason?: string|null }}
 */
export function getLatestCodexJobStatus(cwd) {
  const stateDir = resolveCodexStateDir(cwd);
  if (!stateDir) return { found: false };

  const stateFile = join(stateDir, 'state.json');
  if (!existsSync(stateFile)) return { found: false };

  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    const jobs = state?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return { found: false };

    // Most recent job (sorted by updatedAt desc)
    const latest = jobs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const { stale, staleReason, staleKind } = detectJobStaleness(latest);
    return {
      found: true,
      jobId: latest.id,
      status: latest.status,
      phase: latest.phase,
      pid: Number.isInteger(latest.pid) && latest.pid > 0 ? latest.pid : null,
      logFile: latest.logFile || null,
      updatedAt: latest.updatedAt || null,
      completedAt: latest.completedAt || null,
      error: latest.errorMessage || null,
      stale,
      staleReason,
      staleKind,
    };
  } catch {
    return { found: false };
  }
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
 * @returns {{ reaped: Array<{id:string,reason:string}>, skipped: Array<{id:string,reason:string}>, errors: Array<{id:string,reason:string}> }}
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
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: options.timeoutMs ?? 10000,
      });
      result.reaped.push({ id: job.id, reason: staleReason });
    } catch (err) {
      result.errors.push({ id: job.id, reason: err?.message || 'codex cancel failed' });
    }
  }

  return result;
}
