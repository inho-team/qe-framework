#!/usr/bin/env node
'use strict';

/**
 * Sweep Analyzer — scans .qe/ folders and builds a cleanup plan.
 *
 * Strategy (by signal reliability, not mtime-first):
 *   - tasks/completed, checklists/completed   → archive immediately (already marked done)
 *   - tasks/pending w/ matching all-complete checklist → archive both
 *   - tasks/pending incomplete, mtime > archiveDays (60) → archive pair (recoverable)
 *   - tasks/pending incomplete, archiveDays >= mtime > staleDays (30) → staleReports (warn, grace window)
 *   - handoffs/HANDOFF_YYYYMMDD_*             → archive if filename date > N days
 *   - security-reports/SECURITY_REPORT_YYYYMMDD_* → archive if > N days
 *   - learning/failures/YYYY-MM/              → archive whole month dir if > N days
 *   - agent-results/*                         → DELETE (volatile) if mtime > N days
 *
 * Active folders NEVER touched: state, planning, contracts, context, profile, ai-team.
 *
 * Returns a plan object — pure, no filesystem mutations here.
 *
 * @module sweep-analyzer
 */

import { readdirSync, readFileSync, statSync, existsSync } from './qe-fs.mjs';
import { join, relative } from 'path';
import { isAllComplete } from './checklist-parser.mjs';

const DEFAULTS = {
  handoffsDays: 30,
  securityReportsDays: 14,
  learningFailuresDays: 30,
  agentResultsDays: 7,
  tasksPendingStaleDays: 30,    // incomplete pending older than this → warn (staleReports)
  tasksPendingArchiveDays: 60,  // incomplete pending older than this → archive (recoverable)
};

/**
 * Build a sweep plan for the given project root.
 * @param {string} cwd - Project root (contains .qe/)
 * @param {object} [opts] - Override retention thresholds
 * @returns {{archive: Array, delete: Array, staleReports: Array, stats: object}}
 */
export function analyze(cwd, opts = {}) {
  const config = { ...DEFAULTS, ...opts };
  const qeDir = join(cwd, '.qe');
  const plan = { archive: [], delete: [], staleReports: [], stats: {} };

  if (!existsSync(qeDir)) return plan;

  sweepCompletedFolder(qeDir, 'tasks', plan);
  sweepCompletedFolder(qeDir, 'checklists', plan);
  sweepPendingCompletedPairs(qeDir, plan, config);
  sweepByFilenameDate(qeDir, 'handoffs', /HANDOFF_(\d{8})_/, config.handoffsDays, plan);
  sweepByFilenameDate(qeDir, 'security-reports', /SECURITY_REPORT_(\d{8})_/, config.securityReportsDays, plan);
  sweepLearningFailures(qeDir, plan, config);
  sweepVolatile(qeDir, 'agent-results', config.agentResultsDays, plan);

  applyIgnore(cwd, plan);
  plan.stats = computeStats(plan);
  return plan;
}

function applyIgnore(cwd, plan) {
  const patterns = loadIgnorePatterns(cwd);
  if (patterns.length === 0) return;
  const keep = (item) => !patterns.some((re) => re.test(relative(cwd, item.src)));
  plan.archive = plan.archive.filter(keep);
  plan.delete = plan.delete.filter(keep);
  plan.staleReports = plan.staleReports.filter((item) => !patterns.some((re) => re.test(relative(cwd, item.path))));
}

function loadIgnorePatterns(cwd) {
  const file = join(cwd, '.qesweep-ignore');
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      out.push(globToRegex(line));
    }
    return out;
  } catch { return []; }
}

function globToRegex(glob) {
  // Minimal glob: ** = any path, * = any non-slash, others literal (regex-escaped)
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else if (/[.+?^${}()|[\]\\]/.test(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

function sweepCompletedFolder(qeDir, category, plan) {
  const src = join(qeDir, category, 'completed');
  if (!existsSync(src)) return;
  for (const f of safeReaddir(src)) {
    if (!f.endsWith('.md')) continue;
    plan.archive.push({
      src: join(src, f),
      category,
      reason: 'already-completed',
    });
  }
}

function sweepPendingCompletedPairs(qeDir, plan, config) {
  const tasksPending = join(qeDir, 'tasks', 'pending');
  const checklistsPending = join(qeDir, 'checklists', 'pending');
  if (!existsSync(tasksPending)) return;
  const now = Date.now();
  const staleMs = config.tasksPendingStaleDays * 24 * 60 * 60 * 1000;
  const archiveMs = config.tasksPendingArchiveDays * 24 * 60 * 60 * 1000;

  for (const f of safeReaddir(tasksPending)) {
    const m = f.match(/^TASK_REQUEST_([a-f0-9]+)\.md$/i);
    if (!m) continue;
    const uuid = m[1];
    const taskPath = join(tasksPending, f);
    const checklistPath = join(checklistsPending, `VERIFY_CHECKLIST_${uuid}.md`);

    if (existsSync(checklistPath) && isAllComplete(checklistPath)) {
      plan.archive.push({ src: taskPath, category: 'tasks', reason: 'checklist-complete' });
      plan.archive.push({ src: checklistPath, category: 'checklists', reason: 'checklist-complete' });
      continue;
    }

    // Not complete — two-tier age policy:
    //   age > archiveMs           → archive the pair (recoverable; clears stale accumulation)
    //   archiveMs >= age > staleMs → warn only (grace window before archival)
    try {
      const age = now - statSync(taskPath).mtimeMs;
      const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
      if (age > archiveMs) {
        plan.archive.push({ src: taskPath, category: 'tasks', reason: 'pending-stale-archive' });
        if (existsSync(checklistPath)) {
          plan.archive.push({ src: checklistPath, category: 'checklists', reason: 'pending-stale-archive' });
        }
      } else if (age > staleMs) {
        plan.staleReports.push({
          path: taskPath,
          ageDays,
          reason: 'pending-stale',
        });
      }
    } catch { /* ignore */ }
  }
}

function parseFilenameDate(filename, regex) {
  const m = filename.match(regex);
  if (!m) return null;
  const s = m[1];
  const yyyy = parseInt(s.slice(0, 4), 10);
  const mm = parseInt(s.slice(4, 6), 10) - 1;
  const dd = parseInt(s.slice(6, 8), 10);
  const d = new Date(yyyy, mm, dd);
  return isNaN(d.getTime()) ? null : d;
}

function sweepByFilenameDate(qeDir, folder, regex, days, plan) {
  const dir = join(qeDir, folder);
  if (!existsSync(dir)) return;
  const now = Date.now();
  const thresholdMs = days * 24 * 60 * 60 * 1000;

  for (const f of safeReaddir(dir)) {
    const filePath = join(dir, f);
    let isFile = false;
    try { isFile = statSync(filePath).isFile(); } catch { continue; }
    if (!isFile) continue;

    const d = parseFilenameDate(f, regex);
    if (!d) continue;
    if (now - d.getTime() > thresholdMs) {
      plan.archive.push({
        src: filePath,
        category: folder,
        reason: `filename-date>${days}d`,
      });
    }
  }
}

function sweepLearningFailures(qeDir, plan, config) {
  const base = join(qeDir, 'learning', 'failures');
  if (!existsSync(base)) return;
  const now = Date.now();
  const thresholdMs = config.learningFailuresDays * 24 * 60 * 60 * 1000;

  for (const monthDir of safeReaddir(base)) {
    const m = monthDir.match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    // Use end-of-month as reference so a month isn't swept mid-month
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const endOfMonth = new Date(y, mo, 0).getTime();
    if (now - endOfMonth > thresholdMs) {
      plan.archive.push({
        src: join(base, monthDir),
        category: 'learning/failures',
        reason: `month>${config.learningFailuresDays}d`,
        isDirectory: true,
      });
    }
  }
}

function sweepVolatile(qeDir, folder, days, plan) {
  const dir = join(qeDir, folder);
  if (!existsSync(dir)) return;
  const now = Date.now();
  const thresholdMs = days * 24 * 60 * 60 * 1000;

  walk(dir, (file) => {
    try {
      const st = statSync(file);
      if (st.isFile() && now - st.mtimeMs > thresholdMs) {
        plan.delete.push({ src: file, category: folder, reason: `mtime>${days}d` });
      }
    } catch { /* ignore */ }
  });
}

function walk(dir, cb) {
  if (!existsSync(dir)) return;
  for (const entry of safeReaddir(dir)) {
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) walk(full, cb);
      else cb(full);
    } catch { /* ignore */ }
  }
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function computeStats(plan) {
  const byCategory = {};
  for (const item of plan.archive) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }
  return {
    byCategory,
    archiveCount: plan.archive.length,
    deleteCount: plan.delete.length,
    staleCount: plan.staleReports.length,
  };
}

/**
 * Build a short single-line summary for hook injection.
 * @param {object} plan - Output of analyze()
 * @returns {string|null} One-line human-readable summary, or null if nothing to do
 */
export function formatSummary(plan) {
  const parts = [];
  if (plan.stats.archiveCount > 0) parts.push(`${plan.stats.archiveCount} to archive`);
  if (plan.stats.deleteCount > 0) parts.push(`${plan.stats.deleteCount} volatile to purge`);
  if (plan.stats.staleCount > 0) parts.push(`${plan.stats.staleCount} stale pending`);
  if (parts.length === 0) return null;
  return `[QE Sweep] .qe cleanup available: ${parts.join(', ')}. The Stop hook applies recoverable archive moves when sweep_auto is enabled.`;
}
