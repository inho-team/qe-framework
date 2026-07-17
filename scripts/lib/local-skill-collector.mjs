import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeSkillContentHash, parseSkillFrontmatter } from './skill-frontmatter.mjs';

export const DEFAULT_TTL_DAYS_BY_STACK = Object.freeze({
  javascript: 90,
  typescript: 90,
  react: 90,
  vue: 90,
  angular: 90,
  next: 90,
  nextjs: 90,
  python: 180,
  java: 180,
  spring: 180,
  go: 180,
  rust: 180,
  sql: 365,
  postgresql: 365,
  terraform: 120,
  kubernetes: 120,
  security: 60,
});

export function getLocalSkillRoot(cwd) {
  return join(cwd, '.claude', 'skills');
}

export function listLocalSkillFiles(cwd) {
  const root = getLocalSkillRoot(cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'SKILL.md'))
    .filter((filePath) => existsSync(filePath));
}

export function collectLocalSkillStates(cwd, options = {}) {
  const files = options.files || listLocalSkillFiles(cwd);
  return files.map((filePath) => readSkillState(filePath, options)).filter(Boolean);
}

export function collectDueLocalSkills(cwd, options = {}) {
  return collectLocalSkillStates(cwd, options).filter((state) => state.status === 'missing' || state.expired);
}

export function readSkillState(filePath, options = {}) {
  const clock = options.clock || (() => Date.now());
  try {
    const markdown = readFileSync(filePath, 'utf8');
    const parsed = parseSkillFrontmatter(markdown);
    if (!parsed.ok) {
      return {
        filePath,
        name: skillNameFromPath(filePath),
        status: 'invalid-frontmatter',
        skipped: true,
        reason: parsed.error,
      };
    }
    return evaluateSkillMetadata({
      name: skillNameFromPath(filePath),
      filePath,
      metadata: parsed.metadata,
      markdown,
      nowMs: clock(),
    });
  } catch (error) {
    return {
      filePath,
      name: skillNameFromPath(filePath),
      status: 'read-error',
      skipped: true,
      reason: error.message || String(error),
    };
  }
}

export function evaluateSkillMetadata({ name, filePath = null, metadata, markdown = '', nowMs = Date.now() }) {
  if (!metadata || typeof metadata !== 'object') {
    return { name, filePath, status: 'invalid-frontmatter', skipped: true, reason: 'frontmatter is not a map' };
  }
  if (!metadata.generated_by) {
    return { name, filePath, status: 'manual', manual: true, skipped: true };
  }

  const validation = validateCollectedSkillFrontmatter(metadata);
  if (!validation.ok) {
    return { name, filePath, status: 'invalid-frontmatter', skipped: true, reason: validation.errors.join('; ') };
  }

  const collectedAtMs = Date.parse(metadata.collected_at);
  const ttlDays = Number(metadata.ttl_days);
  const canonicalExpiresAtMs = collectedAtMs + ttlDays * 24 * 60 * 60 * 1000;
  const actualHash = markdown ? computeSkillContentHash(markdown) : null;
  const hashMatches = actualHash ? actualHash === metadata.content_hash : null;

  return {
    name,
    filePath,
    status: nowMs >= canonicalExpiresAtMs ? 'expired' : 'valid',
    manual: false,
    expired: nowMs >= canonicalExpiresAtMs,
    collectedAt: new Date(collectedAtMs).toISOString(),
    ttlDays,
    canonicalExpiresAt: new Date(canonicalExpiresAtMs).toISOString(),
    displayedExpiresAt: metadata.expires_at,
    generatedBy: metadata.generated_by,
    contentHash: metadata.content_hash,
    actualHash,
    hashMatches,
    verification: metadata.verification,
  };
}

export function validateCollectedSkillFrontmatter(metadata) {
  const errors = [];
  for (const field of ['source', 'collected_at', 'ttl_days', 'expires_at', 'generated_by', 'content_hash', 'verification']) {
    if (metadata[field] === undefined || metadata[field] === null || metadata[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }
  if (metadata.collected_at && Number.isNaN(Date.parse(metadata.collected_at))) {
    errors.push('collected_at must be an ISO date');
  }
  if (metadata.expires_at && Number.isNaN(Date.parse(metadata.expires_at))) {
    errors.push('expires_at must be an ISO date');
  }
  if (!Number.isInteger(Number(metadata.ttl_days)) || Number(metadata.ttl_days) <= 0) {
    errors.push('ttl_days must be a positive integer');
  }
  if (metadata.content_hash && !/^sha256:[a-f0-9]{64}$/.test(String(metadata.content_hash))) {
    errors.push('content_hash must be sha256:<64 hex chars>');
  }

  const verification = metadata.verification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    errors.push('verification must be a map');
  } else {
    if (typeof verification.devils_advocate_ran !== 'boolean') {
      errors.push('verification.devils_advocate_ran must be boolean');
    }
    if (!Array.isArray(verification.sources) || verification.sources.length === 0) {
      errors.push('verification.sources must be a non-empty list');
    } else {
      verification.sources.forEach((source, index) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          errors.push(`verification.sources[${index}] must be a map`);
          return;
        }
        if (!source.url || typeof source.url !== 'string') {
          errors.push(`verification.sources[${index}].url is required`);
        }
        if (!source.published_at || typeof source.published_at !== 'string') {
          errors.push(`verification.sources[${index}].published_at is required`);
        }
      });
    }
    if (!Array.isArray(verification.conflicting_claims)) {
      errors.push('verification.conflicting_claims must be a list');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function ttlDaysForStack(stackName, fallback = 90) {
  const key = String(stackName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return DEFAULT_TTL_DAYS_BY_STACK[key] || fallback;
}

function skillNameFromPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}
