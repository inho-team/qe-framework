import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from '../../hooks/scripts/lib/qe-fs.mjs';
import { join, resolve } from 'node:path';

export const SIVS_STAGES = Object.freeze(['spec', 'implement', 'verify', 'supervise']);
export const DELEGATION_ARTIFACT_BYTE_CAP = 64 * 1024;
export const DELEGATION_TRUNCATION_MARKER =
  `[TRUNCATED: artifact exceeded ${DELEGATION_ARTIFACT_BYTE_CAP} bytes]`;

const DELEGATION_ARTIFACTS = Object.freeze([
  ['taskPath', 'TASK_REQUEST'],
  ['checklistPath', 'VERIFY_CHECKLIST'],
  ['planPath', 'PLAN'],
]);
const CONTEXT_AUDIT_LOG_NAME = 'bridge-context-audit.log';

function utf8SafePrefix(buffer, maxBytes) {
  if (buffer.length <= maxBytes) return buffer;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  if (buffer[end - 1] >= 0xc0) end -= 1;
  return buffer.subarray(0, Math.max(0, end));
}

function appendContextAuditLog(cwd, stage, artifacts, warnings) {
  if (!artifacts.length) return;
  const directory = join(cwd, '.qe', 'agent-results');
  const entry = {
    timestamp: new Date().toISOString(),
    stage,
    artifacts: artifacts.map(({ kind, path, bytes, truncated }) => ({
      kind, path, bytes, truncated,
    })),
    warningCount: warnings.length,
  };
  try {
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, CONTEXT_AUDIT_LOG_NAME), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Audit metadata must not break context construction.
  }
}

export function buildDelegationContext(stage, options = {}) {
  if (!SIVS_STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  const cwd = options.cwd || process.cwd();
  const warnings = [];
  const artifacts = [];
  const sections = [];

  for (const [optionKey, kind] of DELEGATION_ARTIFACTS) {
    const artifactPath = options[optionKey];
    if (!artifactPath) continue;
    try {
      const buffer = readFileSync(resolve(cwd, artifactPath));
      const bytes = buffer.length;
      const truncated = bytes > DELEGATION_ARTIFACT_BYTE_CAP;
      let content = utf8SafePrefix(buffer, DELEGATION_ARTIFACT_BYTE_CAP).toString('utf8');
      if (truncated) content += `${content.endsWith('\n') ? '' : '\n'}${DELEGATION_TRUNCATION_MARKER}`;
      sections.push(`=== ${kind} (${artifactPath}) ===\n${content}`);
      artifacts.push({ kind, path: artifactPath, bytes, truncated });
    } catch (error) {
      warnings.push(`Skipped ${kind} artifact ${artifactPath}: ${error?.code || error?.message || 'unreadable'}`);
    }
  }

  if (options.audit !== false) appendContextAuditLog(cwd, stage, artifacts, warnings);
  return { context: sections.join('\n\n'), warnings, artifacts };
}

export function loadSivsConfig(cwd = process.cwd()) {
  const configPath = join(cwd, '.qe', 'sivs-config.json');
  const legacyPath = join(cwd, '.qe', 'svs-config.json');
  if (!existsSync(configPath) && existsSync(legacyPath)) {
    throw new Error('Legacy .qe/svs-config.json is unsupported; migrate to .qe/sivs-config.json schemaVersion 2.');
  }
  if (!existsSync(configPath)) return {};

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (
      config?.profile !== undefined ||
      SIVS_STAGES.some((stage) =>
        config?.[stage]?.engine !== undefined || config?.[stage]?.background !== undefined)
    ) {
      throw new Error('legacy routing field');
    }
    return config;
  } catch {
    throw new Error(`Invalid single-AI SIVS config: ${configPath}`);
  }
}

export const loadSvsConfig = loadSivsConfig;
