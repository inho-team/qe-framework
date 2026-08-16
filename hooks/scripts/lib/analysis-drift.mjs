#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_COMMIT = /^[0-9a-f]{7,40}$/i;
const IGNORED_PREFIXES = [
  '.agents/', '.claude/', '.git/', '.qe/',
  'node_modules/', 'coverage/', 'dist/', 'build/',
];
const BARREL = /^(?:apps|packages)\/[^/]+\/src\/index\.(?:[cm]?[jt]sx?)$/;
const MIGRATIONS = [
  /^supabase\/migrations\/.+\.sql$/,
  /^prisma\/migrations\/.+/,
  /^drizzle\/(?:meta|migrations)\/.+/,
  /^(?:src\/|db\/)?migrations\/.+\.(?:sql|[cm]?[jt]s)$/,
];
const ROUTES = [
  /^(?:apps|packages)\/[^/]+\/src\/(?:routes|api)\/.+\.(?:[cm]?[jt]sx?)$/,
  /^src\/(?:routes|api)\/.+\.(?:[cm]?[jt]sx?)$/,
];
const PRIORITY = { new_directory: 0, barrel: 1, route: 2, migration: 3 };

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  });
}

function nulPaths(value) {
  return String(value || '').split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/'));
}

function ignored(path) {
  return IGNORED_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function baselineDirectories(paths) {
  const directories = new Set();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }
  return directories;
}

function firstNewDirectory(path, knownDirectories) {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(0, index).join('/');
    if (!knownDirectories.has(candidate)) return candidate;
  }
  return null;
}

export function classifyStructuralPath(path) {
  const normalized = typeof path === 'string' ? path.replaceAll('\\', '/') : '';
  if (!normalized || ignored(normalized)) return null;
  if (MIGRATIONS.some((pattern) => pattern.test(normalized))) return 'migration';
  if (ROUTES.some((pattern) => pattern.test(normalized))) return 'route';
  if (BARREL.test(normalized)) return 'barrel';
  return null;
}

function affectedPath(element) {
  if (element.category === 'new_directory') return element.path;
  const parts = element.path.split('/');
  if (element.category === 'barrel') return parts.slice(0, 2).join('/');
  const boundary = parts.findIndex((part) => part === 'routes' || part === 'api' || part === 'migrations');
  if (boundary >= 0) return parts.slice(0, boundary + 1).join('/');
  if (parts[0] === 'drizzle' && (parts[1] === 'meta' || parts[1] === 'migrations')) {
    return parts.slice(0, 2).join('/');
  }
  return parts.slice(0, Math.min(2, Math.max(1, parts.length - 1))).join('/');
}

export function detectAnalysisDrift({ addedPaths = [], baselinePaths = [], threshold = 3 } = {}) {
  const minimum = Number.isInteger(threshold) && threshold >= 1 ? threshold : 3;
  const knownDirectories = baselineDirectories(baselinePaths);
  const byIdentity = new Map();

  for (const rawPath of addedPaths) {
    const path = typeof rawPath === 'string' ? rawPath.replaceAll('\\', '/') : '';
    if (!path || ignored(path)) continue;
    const specific = classifyStructuralPath(path);
    const newDirectory = specific ? null : firstNewDirectory(path, knownDirectories);
    const category = specific || (newDirectory ? 'new_directory' : null);
    if (!category) continue;
    const elementPath = category === 'new_directory' ? newDirectory : path;
    const identity = `${category}:${elementPath}`;
    const prior = byIdentity.get(identity);
    if (!prior || PRIORITY[category] > PRIORITY[prior.category]) {
      byIdentity.set(identity, { category, path: elementPath });
    }
  }

  const elements = [...byIdentity.values()].sort((left, right) =>
    left.category.localeCompare(right.category) || left.path.localeCompare(right.path));
  const affectedPaths = [...new Set(elements.map(affectedPath))].sort();
  return {
    skipped: false,
    actionRequired: elements.length >= minimum,
    threshold: minimum,
    elements,
    affectedPaths,
  };
}

function readBaseline(cwd) {
  const candidates = [
    { path: join(cwd, '.qe', 'analysis', 'files.json'), key: 'git_commit' },
    { path: join(cwd, '.qe', 'analysis', 'file-ledger-snapshot.json'), key: 'head' },
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    try {
      const value = JSON.parse(readFileSync(candidate.path, 'utf8'))?.[candidate.key];
      if (typeof value === 'string' && SAFE_COMMIT.test(value)) return value;
    } catch {
      // A malformed candidate does not hide a valid fallback candidate.
    }
  }
  return null;
}

function skipped(reason, details = {}) {
  return {
    skipped: true,
    reason,
    actionRequired: false,
    threshold: details.threshold || 3,
    elements: [],
    affectedPaths: [],
    ...details,
  };
}

export function assessAnalysisDrift(cwd, { threshold = 3 } = {}) {
  const baseline = readBaseline(cwd);
  if (!baseline) return skipped('missing-analysis-baseline', { threshold });

  try {
    const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']).trim();
    if (inside !== 'true') return skipped('not-a-git-worktree', { threshold, baseline });
    git(cwd, ['cat-file', '-e', `${baseline}^{commit}`]);
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: 'ignore',
    });
    if (ancestor.status !== 0) return skipped('baseline-not-ancestor', { threshold, baseline });

    const baselinePaths = nulPaths(git(cwd, ['ls-tree', '-r', '--name-only', '-z', baseline]));
    const changed = nulPaths(git(cwd, [
      'diff', '--name-only', '--diff-filter=ACR', '-z', baseline, '--',
    ]));
    const untracked = nulPaths(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']));
    const result = detectAnalysisDrift({
      addedPaths: [...new Set([...changed, ...untracked])],
      baselinePaths,
      threshold,
    });
    return {
      ...result,
      baseline,
      head: git(cwd, ['rev-parse', 'HEAD']).trim(),
    };
  } catch (error) {
    return skipped('git-inspection-failed', {
      threshold,
      baseline,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function formatAnalysisDrift(result) {
  if (!result) return '';
  if (result.skipped) {
    if (result.reason !== 'baseline-not-ancestor') return '';
    return `[QE] Analysis baseline ${result.baseline.slice(0, 8)} is not an ancestor of HEAD. `
      + 'Treat all generated analysis as stale and read live sources before planning or verification.';
  }
  if (!result.actionRequired) return '';
  const paths = result.affectedPaths.join(', ');
  return `[QE] Analysis map drift: ${result.elements.length} structural element(s) since ${result.baseline.slice(0, 8)}. `
    + `Treat generated analysis as stale for: ${paths}. Read live sources before planning or verification.`;
}
