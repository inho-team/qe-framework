/**
 * @fileoverview Robust changed-files detection for SIVS gates.
 * The Verify/Supervise gates' "empty-diff → PASS" fast-path must not be tricked
 * by changes that are staged or untracked. This helper reconciles working-tree +
 * staged + untracked so the gate only treats a task as a no-op when ALL three are
 * empty AND git data was actually obtained.
 *
 * Scope/limitation: this covers *uncommitted* changes (working tree, index,
 * untracked). It does NOT diff committed-since-task-start against a baseline ref —
 * that requires the caller to record a task-start SHA and is tracked separately.
 * When git is unavailable or the directory is not a repo, the result is reported
 * as **not empty** (`isEmpty=false`, `gitAvailable=false`) so a gate never grants
 * a free empty-diff PASS on indeterminate state (fail-closed).
 *
 * Pure helper — no side effects on import.
 * @module hooks/scripts/lib/changed-files
 */

import { execFileSync } from 'child_process';

/**
 * Run a git command (no shell) and return NUL-split paths.
 * Uses execFileSync (no `/bin/sh`) and `-z` so filenames with spaces, quotes, or
 * newlines are preserved losslessly.
 * @param {string[]} args - git arguments (must include `-z`)
 * @param {string} cwd - Working directory
 * @returns {{ ok: boolean, paths: string[] }} ok=false if git missing / not a repo / failed
 */
function gitZ(args, cwd) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    // -z output is NUL-separated with a trailing NUL; do not trim (paths are exact).
    return { ok: true, paths: out.split('\0').filter((p) => p.length > 0) };
  } catch {
    return { ok: false, paths: [] };
  }
}

/**
 * Collect changed files across working tree, staging area, and untracked set.
 * @param {string} cwd - Project root (a git working directory)
 * @returns {{ workingTree: string[], staged: string[], untracked: string[], all: string[], isEmpty: boolean, gitAvailable: boolean }}
 */
export function getChangedFiles(cwd) {
  const wt = gitZ(['diff', '-z', '--name-only'], cwd);
  const st = gitZ(['diff', '-z', '--cached', '--name-only'], cwd);
  const ut = gitZ(['ls-files', '-z', '--others', '--exclude-standard'], cwd);

  // If any probe failed (git missing / not a repo), we cannot prove emptiness.
  const gitAvailable = wt.ok && st.ok && ut.ok;
  const all = Array.from(new Set([...wt.paths, ...st.paths, ...ut.paths]));

  return {
    workingTree: wt.paths,
    staged: st.paths,
    untracked: ut.paths,
    all,
    // Fail-closed: only "empty" when git succeeded AND nothing changed.
    isEmpty: gitAvailable && all.length === 0,
    gitAvailable,
  };
}

// Domain taxonomy — kept in sync with core/review-routing.yaml (the human-readable
// source of truth). Precedence: security > test > analysis > docs > config > code.
// This JS mirror avoids a YAML parser dependency (the package is zero-dep).
export const REVIEW_ROUTING = {
  security: { reviewers: ['Esecurity-officer'] },
  test: { reviewers: ['Ecode-test-engineer'] },
  docs: { reviewers: ['Edocs-supervisor'] },
  config: { reviewers: ['Ecode-reviewer'] },
  analysis: { reviewers: ['Eanalysis-supervisor'] },
  code: { reviewers: ['Ecode-reviewer', 'Ecode-test-engineer'] },
  other: { reviewers: [] },
};

const SECURITY_HINTS = ['auth', 'crypto', 'secret', 'security', 'credential', 'password', 'token', 'jwt', 'oauth'];
const CODE_SUFFIXES = ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.cpp', '.c', '.kt', '.swift', '.vue'];
const DOC_SUFFIXES = ['.md', '.mdx', '.rst', '.txt'];
const CONFIG_SUFFIXES = ['.json', '.yaml', '.yml', '.toml', '.ini'];
const TEST_SUFFIXES = ['.test.mjs', '.test.js', '.test.ts', '.spec.ts', '.spec.js', '.spec.mjs'];

// Classify a single changed file path into a review domain (first match wins).
export function classifyDomain(filepath) {
  const p = String(filepath || '').toLowerCase();
  const base = p.split('/').pop() || '';
  if (base === '.env' || SECURITY_HINTS.some((h) => p.includes(h))) return 'security';
  if (p.includes('__tests__/') || p.includes('/test/') || p.includes('/tests/') || TEST_SUFFIXES.some((s) => p.endsWith(s))) return 'test';
  if (p.includes('.qe/analysis/') || base.startsWith('analysis_')) return 'analysis';
  if (p.includes('docs/') || DOC_SUFFIXES.some((s) => p.endsWith(s))) return 'docs';
  if (CONFIG_SUFFIXES.some((s) => p.endsWith(s))) return 'config';
  if (CODE_SUFFIXES.some((s) => p.endsWith(s))) return 'code';
  return 'other';
}

// Group changed files by review domain: { domain: [files] }.
export function classifyChanges(files) {
  const byDomain = {};
  for (const f of files || []) {
    const d = classifyDomain(f);
    (byDomain[d] ||= []).push(f);
  }
  return byDomain;
}

// Build a Review Readiness summary from a getChangedFiles() result (or a file list):
// which domains changed, how many files each, and the reviewers each routes to.
export function reviewReadiness(input) {
  const files = Array.isArray(input) ? input : (input && input.all) || [];
  const byDomain = classifyChanges(files);
  const rows = Object.keys(byDomain)
    .sort((a, b) => byDomain[b].length - byDomain[a].length || a.localeCompare(b))
    .map((domain) => ({
      domain,
      count: byDomain[domain].length,
      reviewers: (REVIEW_ROUTING[domain] || REVIEW_ROUTING.other).reviewers,
      files: byDomain[domain],
    }));
  const reviewers = [...new Set(rows.flatMap((r) => r.reviewers))];
  return { totalFiles: files.length, domains: rows, reviewers };
}
