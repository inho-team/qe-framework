#!/usr/bin/env node
'use strict';

/**
 * Sweep Executor — consumes a plan from sweep-analyzer and performs file I/O.
 *
 * Modes:
 *   - dry-run (default): returns the would-be result without touching disk
 *   - apply: moves archive items into .qe/.archive/vX.Y.Z/<category>/,
 *            deletes volatile items (agent-results)
 *   - volatile-only: applies the delete list only (used by Stop hook for quiet cleanup)
 *
 * Archive version: deterministic sweep convention — inspects .qe/.archive/ for
 * existing vX.Y.Z dirs and bumps minor (v0.1.0 → v0.2.0 → ...).
 *
 * @module sweep-executor
 */

import { renameSync, unlinkSync, existsSync, mkdirSync, readdirSync } from './qe-fs.mjs';
import { join, basename } from 'path';

export function nextArchiveVersion(archiveDir) {
  if (!existsSync(archiveDir)) return 'v0.1.0';
  const versions = [];
  for (const name of safeReaddir(archiveDir)) {
    const m = name.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (m) versions.push([+m[1], +m[2], +m[3]]);
  }
  if (versions.length === 0) return 'v0.1.0';
  versions.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
  const [maj, min] = versions[versions.length - 1];
  return `v${maj}.${min + 1}.0`;
}

/**
 * Execute a plan. Defaults to dry-run; pass { apply: true } to mutate the filesystem.
 */
export function execute(cwd, plan, opts = {}) {
  const { apply = false } = opts;
  const archiveBase = join(cwd, '.qe', '.archive');
  const version = nextArchiveVersion(archiveBase);
  const versionDir = join(archiveBase, version);

  const result = {
    version,
    moved: [],
    deleted: [],
    errors: [],
    dryRun: !apply,
  };

  for (const item of plan.archive) {
    const dest = join(versionDir, item.category, basename(item.src));
    if (apply) {
      try {
        mkdirSync(join(versionDir, item.category), { recursive: true });
        renameSync(item.src, dest);
        result.moved.push({ from: item.src, to: dest, reason: item.reason });
      } catch (err) {
        result.errors.push({ path: item.src, error: err.message });
      }
    } else {
      result.moved.push({ from: item.src, to: dest, reason: item.reason });
    }
  }

  for (const item of plan.delete) {
    if (apply) {
      try {
        unlinkSync(item.src);
        result.deleted.push({ path: item.src, reason: item.reason });
      } catch (err) {
        result.errors.push({ path: item.src, error: err.message });
      }
    } else {
      result.deleted.push({ path: item.src, reason: item.reason });
    }
  }

  return result;
}

/**
 * Apply only the delete list (volatile cleanup). Used by Stop hook — silent, fault-tolerant.
 */
export function executeVolatileOnly(cwd, plan) {
  const result = { deleted: [], errors: [] };
  for (const item of plan.delete) {
    try {
      unlinkSync(item.src);
      result.deleted.push({ path: item.src });
    } catch (err) {
      result.errors.push({ path: item.src, error: err.message });
    }
  }
  return result;
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
