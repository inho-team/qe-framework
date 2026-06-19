#!/usr/bin/env node
/**
 * check-utopia-guard.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Pins the Qutopia safety-rail contract (trust-hardening Phase 4):
 *   - the pure classifiers flag the right risky commands / paths,
 *   - and end-to-end, the PreToolUse hook HARD-BLOCKS them only when Utopia is active
 *     (a normal session, or allowUnsafe override, is completely unaffected).
 * Everything runs against temp dirs; the real repo state is untouched.
 */

import {
  classifyBashRisk, isSensitivePath, currentBranch, isProtectedBranch, evaluateUtopiaAction,
} from '../hooks/scripts/lib/utopia-guard.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRE = join(ROOT, 'hooks/scripts/pre-tool-use.mjs');

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const cleanup = [];

// --- Pure classifier assertions ---
for (const cmd of ['git push origin main', 'git push origin +main', 'git push --force', 'git push --delete origin x',
  'git reset --hard HEAD~1', 'git clean -fd', 'git branch -D feat', 'rm -rf /tmp/x', 'rm -r build',
  'git checkout -- .', 'git checkout HEAD -- .', 'find . -delete', 'truncate -s 0 data', 'dd of=disk.img',
  'echo hello > out.txt']) {
  expect(classifyBashRisk(cmd) !== null, `[classify] should flag risky: ${cmd}`);
}
for (const cmd of ['ls -la', 'git status', 'git commit -m x', 'npm test', 'rm file.txt',
  'echo x >> log.txt', 'cat f > /dev/null', 'grep foo bar']) {
  expect(classifyBashRisk(cmd) === null, `[classify] should NOT flag benign: ${cmd}`);
}
for (const p of ['db/migrations/001_init.sql', 'infra/main.tf', '.env', 'config/.env.production',
  'prod.env', 'config.env', 'Dockerfile', 'secrets/key.json', 'certs/server.pem', 'app/server.crt',
  '.ssh/id_rsa', '.aws/credentials', '.npmrc', 'k8s/deploy.yaml']) {
  expect(isSensitivePath(p) !== null, `[sensitive] should flag: ${p}`);
}
for (const p of ['src/app.ts', 'README.md', 'package.json', 'docs/guide.md']) {
  expect(isSensitivePath(p) === null, `[sensitive] should NOT flag: ${p}`);
}

// --- currentBranch / protected-branch via temp .git/HEAD ---
{
  const d = mkdtempSync(join(tmpdir(), 'qe-branch-')); cleanup.push(d);
  mkdirSync(join(d, '.git'), { recursive: true });
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  expect(currentBranch(d) === 'main' && isProtectedBranch('main'), 'currentBranch should read main');
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
  expect(currentBranch(d) === 'feature/x' && !isProtectedBranch('feature/x'), 'currentBranch should read feature branch');
  writeFileSync(join(d, '.git', 'HEAD'), 'a1b2c3d4e5f6\n'); // detached
  expect(currentBranch(d) === null, 'detached HEAD should be null');
}

// --- evaluateUtopiaAction: protected branch blocks non-.qe writes, allows .qe writes ---
{
  const d = mkdtempSync(join(tmpdir(), 'qe-eval-')); cleanup.push(d);
  mkdirSync(join(d, '.git'), { recursive: true });
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  expect(evaluateUtopiaAction({ toolName: 'Write', toolInput: { file_path: join(d, 'src/x.ts') }, cwd: d }).block,
    'protected branch should block non-.qe write');
  expect(!evaluateUtopiaAction({ toolName: 'Write', toolInput: { file_path: join(d, '.qe/state/x.json') }, cwd: d }).block,
    'protected branch should allow .qe write');
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/feature\n');
  expect(!evaluateUtopiaAction({ toolName: 'Write', toolInput: { file_path: join(d, 'src/x.ts') }, cwd: d }).block,
    'feature branch should allow normal write');
  expect(evaluateUtopiaAction({ toolName: 'Write', toolInput: { file_path: join(d, 'infra/main.tf') }, cwd: d }).block,
    'sensitive path should block on any branch');
}

// --- Integration via the real PreToolUse hook ---
/** Run the real PreToolUse hook with a payload; return {code, stderr}. */
function runPre(cwd, payload) {
  const r = spawnSync('node', [PRE], { input: JSON.stringify({ cwd, ...payload }), encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr || '' };
}
/** Build a temp git repo (feature branch) with optional unified-state utopia_state. */
function tempRepo(utopiaState) {
  const d = mkdtempSync(join(tmpdir(), 'qe-utopia-')); cleanup.push(d);
  mkdirSync(join(d, '.git'), { recursive: true });
  writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/feature\n');
  if (utopiaState) {
    mkdirSync(join(d, '.qe', 'state'), { recursive: true });
    writeFileSync(join(d, '.qe', 'state', 'unified-state.json'), JSON.stringify({ utopia_state: utopiaState }));
  }
  return d;
}
const pushCall = { tool_name: 'Bash', tool_input: { command: 'git push origin feature' } };

// active utopia → git push HARD-BLOCKED (exit 2, Utopia rail)
{
  const r = runPre(tempRepo({ enabled: true }), pushCall);
  expect(r.code === 2 && /Utopia rail/.test(r.stderr), `[integration] active utopia should block git push (exit ${r.code})`);
}
// inactive utopia → git push NOT blocked by the rail (normal session unaffected)
{
  const r = runPre(tempRepo(null), pushCall);
  expect(r.code !== 2, `[integration] inactive utopia must NOT block git push (exit ${r.code})`);
}
// active utopia + sensitive Write → blocked (exercises the Write/Edit hook wiring, not just Bash)
{
  const r = runPre(tempRepo({ enabled: true }), { tool_name: 'Write', tool_input: { file_path: 'infra/main.tf', content: 'x' } });
  expect(r.code === 2 && /Utopia rail/.test(r.stderr), `[integration] active utopia should block sensitive Write (exit ${r.code})`);
}
// allowUnsafe override → rail off
{
  const r = runPre(tempRepo({ enabled: true, allowUnsafe: true }), pushCall);
  expect(r.code !== 2, `[integration] allowUnsafe should disable the rail (exit ${r.code})`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('check-utopia-guard: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('check-utopia-guard: PASS (classifiers + branch + 4 integration: push/sensitive-write/inactive/allowUnsafe)');
