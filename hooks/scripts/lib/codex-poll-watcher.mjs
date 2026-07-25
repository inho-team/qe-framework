#!/usr/bin/env node
'use strict';

/**
 * Codex Poll Watcher — Background script that polls for Codex companion
 * file changes via `git diff --stat`. When changes are detected, writes
 * a signal file that Claude can check with a simple Glob/Read.
 *
 * Spawned by notification.mjs when codex-rescue returns Done.
 * Runs detached from the parent process.
 *
 * Usage:
 *   node codex-poll-watcher.mjs <cwd> [--interval 30] [--timeout 3600] [--pid <n>]
 *
 * Signal file: <cwd>/.qe/agent-results/codex-ready.signal
 * Contains: JSON with { detected: true, timestamp, diffStat, elapsedSec }
 */

import { mkdirSync, writeFileSync } from './qe-fs.mjs';
import { join } from 'path';
import { execSync } from 'child_process';
import { isProcessAlive } from '../../../scripts/lib/codex_bridge.mjs';

const args = process.argv.slice(2);
const cwd = args[0] || process.cwd();

// Parse flags
let interval = 30; // seconds
let timeout = 3600; // seconds (1 hour)
let companionPid = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--interval' && args[i + 1]) {
    const parsed = Number(args[i + 1]);
    if (Number.isFinite(parsed) && parsed > 0) interval = parsed;
  }
  if (args[i] === '--timeout' && args[i + 1]) {
    const parsed = Number(args[i + 1]);
    if (Number.isFinite(parsed) && parsed > 0) timeout = parsed;
  }
  if (args[i] === '--pid' && args[i + 1]) {
    const parsed = Number(args[i + 1]);
    companionPid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
}

const SIGNAL_DIR = join(cwd, '.qe', 'agent-results');
const SIGNAL_FILE = join(SIGNAL_DIR, 'codex-ready.signal');
const LOG_FILE = join(SIGNAL_DIR, 'codex-poll.log');

function ensureDir() {
  try { mkdirSync(SIGNAL_DIR, { recursive: true }); } catch {}
}

function log(msg) {
  ensureDir();
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: 'a' }); } catch {}
}

function getGitDiff() {
  try {
    return execSync('git diff --stat', { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function getGitDiffStaged() {
  try {
    return execSync('git diff --cached --stat', { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function getUntrackedFiles() {
  try {
    return execSync('git ls-files --others --exclude-standard', { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function writeSignal(diffStat, elapsedSec) {
  mkdirSync(SIGNAL_DIR, { recursive: true });
  const signal = {
    detected: true,
    timestamp: new Date().toISOString(),
    diffStat,
    elapsedSec,
    pollInterval: interval,
  };
  writeFileSync(SIGNAL_FILE, JSON.stringify(signal, null, 2) + '\n', 'utf-8');
  log(`SIGNAL written — changes detected after ${elapsedSec}s`);
}

function writeTimeoutSignal(elapsedSec) {
  mkdirSync(SIGNAL_DIR, { recursive: true });
  const signal = {
    detected: false,
    timeout: true,
    timestamp: new Date().toISOString(),
    elapsedSec,
    message: `No changes detected after ${Math.round(elapsedSec / 60)} minutes. Use the QE interaction adapter to ask: (a) Extend +1h (b) Retry Codex (c) Fallback to Claude (d) Check process`,
  };
  writeFileSync(SIGNAL_FILE, JSON.stringify(signal, null, 2) + '\n', 'utf-8');
  log(`TIMEOUT signal written after ${elapsedSec}s`);
}

function writeCrashSignal(pid, elapsedSec) {
  mkdirSync(SIGNAL_DIR, { recursive: true });
  const signal = {
    detected: false,
    crashed: true,
    status: 'crashed',
    pid,
    timestamp: new Date().toISOString(),
    elapsedSec,
    pollInterval: interval,
    message: `Codex companion process ${pid} died before file changes materialized. Retry Codex once or fallback to Claude.`,
  };
  writeFileSync(SIGNAL_FILE, JSON.stringify(signal, null, 2) + '\n', 'utf-8');
  log(`CRASH signal written — pid ${pid} dead after ${elapsedSec}s`);
}

// Take baseline snapshot
const baselineDiff = getGitDiff();
const baselineStaged = getGitDiffStaged();
const baselineUntracked = getUntrackedFiles();

log(`Watcher started — interval=${interval}s, timeout=${timeout}s${companionPid ? `, pid=${companionPid}` : ''}`);
log(`Baseline: diff=${baselineDiff.length} chars, staged=${baselineStaged.length} chars, untracked=${baselineUntracked.split('\n').filter(Boolean).length} files`);

// Immediate check
const immediateDiff = getGitDiff();
const immediateUntracked = getUntrackedFiles();
if (immediateDiff !== baselineDiff || immediateUntracked !== baselineUntracked) {
  writeSignal(immediateDiff || immediateUntracked, 0);
  log('Immediate change detected, exiting.');
  process.exit(0);
}

// Polling loop
const startTime = Date.now();
let pollCount = 0;

const timer = setInterval(() => {
  pollCount++;
  const elapsed = (Date.now() - startTime) / 1000;

  // Check timeout
  if (elapsed >= timeout) {
    clearInterval(timer);
    writeTimeoutSignal(elapsed);
    process.exit(0);
  }

  // Check for changes
  const currentDiff = getGitDiff();
  const currentStaged = getGitDiffStaged();
  const currentUntracked = getUntrackedFiles();

  const hasChanges =
    currentDiff !== baselineDiff ||
    currentStaged !== baselineStaged ||
    currentUntracked !== baselineUntracked;

  if (hasChanges) {
    clearInterval(timer);
    const combinedDiff = [currentDiff, currentStaged, currentUntracked].filter(Boolean).join('\n');
    writeSignal(combinedDiff, Math.round(elapsed));
    process.exit(0);
  }

  const alive = companionPid ? isProcessAlive(companionPid) : null;
  if (alive === false) {
    clearInterval(timer);
    writeCrashSignal(companionPid, Math.round(elapsed));
    process.exit(0);
  }

  // Log every 10th poll (~5 min)
  if (pollCount % 10 === 0) {
    log(`Poll ${pollCount} — no changes yet (${Math.round(elapsed / 60)}m elapsed)`);
  }
}, interval * 1000);

// Ensure clean exit on signals
process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
