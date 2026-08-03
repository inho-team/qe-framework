import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from '../../hooks/scripts/lib/qe-fs.mjs';
import { isProcessAlive } from './process-liveness.mjs';

const DEFAULT_STALE_LOG_SILENCE_MS = 5 * 60 * 1000;

function staleLogSilenceThresholdMs() {
  const raw = Number(process.env.CODEX_STALE_LOG_SILENCE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_LOG_SILENCE_MS;
}

export function resolveDurableJobStateDir(cwd) {
  const basename = cwd.split('/').filter(Boolean).pop() || 'workspace';
  const slug = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  const dirName = `${slug}-${hash}`;

  if (process.env.CLAUDE_PLUGIN_DATA) {
    const primary = join(process.env.CLAUDE_PLUGIN_DATA, 'state', dirName);
    if (existsSync(primary)) return primary;
  }
  const fallback = join(tmpdir(), 'codex-companion', dirName);
  return existsSync(fallback) ? fallback : null;
}

function runtimeLossCandidates(value) {
  const out = [];
  const seen = new WeakSet();
  const stack = [{ value, depth: 0 }];
  while (stack.length > 0 && out.length < 50) {
    const item = stack.pop();
    const current = item?.value;
    const depth = item?.depth ?? 0;
    if (typeof current === 'string') {
      out.push(current);
      continue;
    }
    if (!current || typeof current !== 'object' || depth > 3 || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) stack.push({ value: entry, depth: depth + 1 });
      continue;
    }
    if (current.runtimeLost === true || current.runtime_lost === true) out.push('runtime_lost');
    for (const key of [
      'code', 'errorCode', 'error_code', 'reasonCode', 'reason_code', 'kind',
      'type', 'name', 'status', 'reason', 'error', 'errors', 'errorMessage',
      'message', 'cause', 'details', 'metadata',
    ]) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        stack.push({ value: current[key], depth: depth + 1 });
      }
    }
  }
  return out;
}

export function isRuntimeLossMessage(value) {
  return runtimeLossCandidates(value).some((candidate) =>
    /thread[\s_-]+not[\s_-]+found|runtime[\s_-]+lost|codex[\s_-]+turn[\s_-]+interrupt[\s_-]+failed|codex\b[^\n\r]{0,120}\binterrupt\s+failed|turn\s+interrupt\s+failed/i.test(candidate));
}

function logSilenceMs(logFile) {
  if (!logFile) return null;
  try {
    return Date.now() - statSync(logFile).mtimeMs;
  } catch {
    return null;
  }
}

export function detectJobStaleness(job = {}) {
  if (job.status !== 'running') return { stale: false, staleReason: null, staleKind: null };

  const alive = isProcessAlive(job.pid);
  if (alive === false) {
    return { stale: true, staleReason: `recorded process ${job.pid} is not running`, staleKind: 'process-dead' };
  }
  if (alive === true) return { stale: false, staleReason: null, staleKind: null };

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

export function getLatestDurableJobStatus(cwd) {
  const stateDir = resolveDurableJobStateDir(cwd);
  if (!stateDir) return { found: false };
  const stateFile = join(stateDir, 'state.json');
  if (!existsSync(stateFile)) return { found: false };

  try {
    const jobs = JSON.parse(readFileSync(stateFile, 'utf8'))?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return { found: false };
    const latest = [...jobs].sort((left, right) =>
      (right.updatedAt || '').localeCompare(left.updatedAt || ''))[0];
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
      runtimeLost: isRuntimeLossMessage(latest),
      stale,
      staleReason,
      staleKind,
    };
  } catch {
    return { found: false };
  }
}
