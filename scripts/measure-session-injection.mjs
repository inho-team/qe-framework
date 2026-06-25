#!/usr/bin/env node
/**
 * measure-session-injection.mjs — ADR-025 R1 / G006 token gate.
 *
 * Measures the SessionStart `additionalContext` footprint produced by
 * hooks/scripts/session-start.mjs, comparing the committed (HEAD) version
 * against the current working-tree version on IDENTICAL fixtures, in an
 * isolated temp cwd so the real repo's state files are never touched.
 *
 * Approx token model: Math.ceil(chars / 4) — a stable, dependency-free proxy
 * applied equally to before and after (the DELTA is what the gate cares about).
 *
 * Exit 0 always (measurement is reporting, not a blocking gate by itself);
 * prints a JSON report to stdout. Zero-state note: if HEAD is unavailable the
 * "before" fields are null and only the after footprint is reported.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const approxTokens = (s) => Math.ceil(s.length / 4);

/** Build a throwaway cwd seeded with the real content the injection reads. */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-measure-'));
  mkdirSync(join(dir, '.qe'), { recursive: true });
  mkdirSync(join(dir, 'core'), { recursive: true });
  for (const rel of ['QE_CONVENTIONS.md', 'CLAUDE.md', 'core/OUTPUT_STYLE.md', '.qe/MISTAKE.md']) {
    const src = join(ROOT, rel);
    if (existsSync(src)) copyFileSync(src, join(dir, rel));
  }
  return dir;
}

/** Run a session-start script with a fixture cwd; return its additionalContext. */
function runInjection(scriptPath, cwd) {
  const payload = JSON.stringify({ cwd, session_id: '00000000-0000-0000-0000-000000000000' });
  const r = spawnSync('node', [scriptPath], { input: payload, encoding: 'utf8' });
  try {
    return (JSON.parse(r.stdout).hookSpecificOutput || {}).additionalContext || '';
  } catch {
    return '';
  }
}

// --- after: current working-tree version ---
const cwdAfter = makeFixture();
const after = runInjection(join(ROOT, 'hooks/scripts/session-start.mjs'), cwdAfter);
rmSync(cwdAfter, { recursive: true, force: true });

// --- before: committed (HEAD) version, copied alongside lib/ so imports resolve ---
let before = null;
const beforePath = join(ROOT, 'hooks/scripts', '_session-start-before.mjs');
const gitShow = spawnSync('git', ['show', 'HEAD:hooks/scripts/session-start.mjs'], { cwd: ROOT, encoding: 'utf8' });
if (gitShow.status === 0 && gitShow.stdout) {
  try {
    writeFileSync(beforePath, gitShow.stdout);
    const cwdBefore = makeFixture();
    before = runInjection(beforePath, cwdBefore);
    rmSync(cwdBefore, { recursive: true, force: true });
  } finally {
    rmSync(beforePath, { force: true });
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  method: 'Math.ceil(chars/4) on SessionStart additionalContext, identical fixtures',
  before: before === null ? null : { chars: before.length, tokens: approxTokens(before) },
  after: { chars: after.length, tokens: approxTokens(after) },
};
if (before !== null) {
  report.reductionPct = Math.round((1 - after.length / before.length) * 1000) / 10;
  report.gate = after.length < before.length ? 'PASS (before > after)' : 'FAIL (no reduction)';
}
console.log(JSON.stringify(report, null, 2));
