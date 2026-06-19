#!/usr/bin/env node
/**
 * check-hook-falsepositive.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Locks in the Phase 2 (trust-hardening) hook-safety contract by driving the real
 * hook scripts with crafted stdin and asserting their behavior:
 *
 *   - Read-only commands that merely MENTION plugin.json + version must PASS
 *     (the false positive that blocked grep/echo this session).
 *   - Markdown/docs containing words like "secret"/"token" must NOT trigger the
 *     mandatory security review.
 *   - The guard is NOT weakened: real risks (raw `git commit`, a redirect WRITE into
 *     plugin.json, a security keyword in a CODE file) must still be caught.
 *
 * Hooks only inspect the payload string; they never execute the command, so the
 * "write" fixtures below touch nothing on disk.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRE = join(ROOT, 'hooks/scripts/pre-tool-use.mjs');
const POST = join(ROOT, 'hooks/scripts/post-tool-use.mjs');

/** Run a hook script with `payload` piped to its stdin; return {code, stdout, stderr}. */
function runHook(hookPath, payload) {
  const r = spawnSync('node', [hookPath], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const EXIT_BLOCK = 2; // emitBlock() convention

// 1. Read-only Bash mentioning plugin.json + version must NOT block.
{
  const cmd = 'echo "=== version in plugin.json ===" ; grep \'"version"\' .claude-plugin/plugin.json';
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  expect(r.code !== EXIT_BLOCK, `[FP] read-only plugin.json+version command was blocked (exit ${r.code}): ${r.stderr}`);
}

// 2. Real WRITE (redirect) into plugin.json + version must block → Mbump.
{
  const cmd = 'echo \'{"version":"9.9.9"}\' > .claude-plugin/plugin.json';
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  expect(r.code === EXIT_BLOCK && /Mbump/.test(r.stderr), `[GUARD] version redirect write was NOT blocked (exit ${r.code})`);
}

// 2b. Pipe-to-tee write into plugin.json + version must block → Mbump (W1 gap).
{
  const cmd = 'echo \'{"version":"9.9.9"}\' | tee .claude-plugin/plugin.json';
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  expect(r.code === EXIT_BLOCK && /Mbump/.test(r.stderr), `[GUARD] tee write to plugin.json was NOT blocked (exit ${r.code})`);
}

// 3. Raw git commit must block → Qcommit.
{
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } });
  expect(r.code === EXIT_BLOCK && /Qcommit/.test(r.stderr), `[GUARD] raw git commit was NOT blocked (exit ${r.code})`);
}

// 4. Markdown with security words must NOT trigger the security review.
{
  const r = runHook(POST, { cwd: ROOT, tool_name: 'Write', tool_input: { file_path: join(ROOT, 'NOTE.md'), content: 'this plan discusses secret and token handling' } });
  expect(!/MANDATORY SECURITY REVIEW/.test(r.stdout), '[FP] markdown with security words wrongly triggered security review');
}

// 5. Security keyword in a CODE file must STILL hint (guard not weakened).
{
  const r = runHook(POST, { cwd: ROOT, tool_name: 'Write', tool_input: { file_path: join(ROOT, 'scripts/sync-metadata.mjs'), content: 'const password = readSecretToken();' } });
  expect(/MANDATORY SECURITY REVIEW/.test(r.stdout), '[GUARD] code file with security keyword no longer triggers security review');
}

// 5b. Security keyword in a shell/IaC file must still hint (S1: don't lose .sh coverage).
{
  const r = runHook(POST, { cwd: ROOT, tool_name: 'Write', tool_input: { file_path: join(ROOT, 'deploy.sh'), content: '#!/bin/sh\nexport TOKEN=$(read_secret)' } });
  expect(/MANDATORY SECURITY REVIEW/.test(r.stdout), '[GUARD] shell script with security keyword lost its security hint');
}

// 6. hook_profile=minimal downgrades the git-commit hard-block to a soft hint.
{
  const tmp = mkdtempSync(join(tmpdir(), 'qe-hookprofile-'));
  try {
    mkdirSync(join(tmp, '.qe'), { recursive: true });
    writeFileSync(join(tmp, '.qe', 'config.json'), '{"hooks":{"hook_profile":"minimal"}}');
    const r = runHook(PRE, { cwd: tmp, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
    expect(r.code !== EXIT_BLOCK, `[PROFILE] minimal profile still hard-blocked git commit (exit ${r.code})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error('check-hook-falsepositive: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('check-hook-falsepositive: PASS (8 assertions: 2 false-positive, 5 guard-intact, 1 profile)');
