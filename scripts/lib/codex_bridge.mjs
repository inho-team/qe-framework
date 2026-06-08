#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

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
 * Get the latest Codex companion job status for the given workspace.
 * @param {string} cwd - Project root directory
 * @returns {{ found: boolean, jobId?: string, status?: string, phase?: string, completedAt?: string, error?: string }}
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
    return {
      found: true,
      jobId: latest.id,
      status: latest.status,
      phase: latest.phase,
      completedAt: latest.completedAt || null,
      error: latest.errorMessage || null,
    };
  } catch {
    return { found: false };
  }
}
