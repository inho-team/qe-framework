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
const SESSION = join(ROOT, 'hooks/scripts/session-start.mjs');

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

// 2. Real WRITE (redirect) into plugin.json + version must block → qe-release-version.
{
  const cmd = 'echo \'{"version":"9.9.9"}\' > .claude-plugin/plugin.json';
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  expect(r.code === EXIT_BLOCK && /qe-release-version/.test(r.stderr), `[GUARD] version redirect write was NOT blocked (exit ${r.code})`);
}

// 2b. Pipe-to-tee write into plugin.json + version must block → qe-release-version (W1 gap).
{
  const cmd = 'echo \'{"version":"9.9.9"}\' | tee .claude-plugin/plugin.json';
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  expect(r.code === EXIT_BLOCK && /qe-release-version/.test(r.stderr), `[GUARD] tee write to plugin.json was NOT blocked (exit ${r.code})`);
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

// ── ADR-025 R2: region-aware block oracle matrix ──────────────────────────────
// Drives the REAL pre-tool-use hook. BLOCK = exit 2 + the expected skill in stderr;
// PASS = not exit 2. Same token in DATA (quote/heredoc/comment) vs EXECUTABLE must
// yield opposite verdicts — the only way to satisfy all rows is real region
// classification (lib/shell-scanner.mjs), not substring matching.
const EXEC_ORACLE = [
  // [command, 'block:<Skill>' | 'pass', label]
  ['git commit -m "x"', 'block:Qcommit', 'O001 top-level commit'],
  ['true && git commit -m x', 'block:Qcommit', 'O002 chained commit'],
  ['bash -lc "git commit -m x"', 'block:Qcommit', 'O003 bash -lc arg'],
  ['sh -c "git commit -m x"', 'block:Qcommit', 'O004 sh -c arg'],
  ['git commit-tree HEAD^{tree}', 'pass', 'O005 commit-tree plumbing'],
  ['git commit-graph write --reachable', 'pass', 'O006 commit-graph plumbing'],
  ['cat <<EOF\n# git commit -m x\nEOF', 'pass', 'O007 non-shell heredoc data'],
  ['bash <<EOF\ngit commit -m x\nEOF', 'block:Qcommit', 'O008 shell heredoc exec'],
  ['ssh host <<EOF\ngit commit -m x\nEOF', 'block:Qcommit', 'O009 remote shell heredoc'],
  ['echo "gh pr create"', 'pass', 'O010 quoted pr-create'],
  ['echo "edit .claude-plugin/plugin.json version"', 'pass', 'O012 quoted plugin.json mention'],
  ['echo \'{"version":"9.9.9"}\' > .claude-plugin/plugin.json', 'block:qe-release-version', 'O013 real version write'],
  ['', 'pass', 'O015 empty command (fail-open)'],
  // carried-forward (iter-2 WARN): substitution / continuation / ANSI-C are EXECUTABLE
  ['msg=$(git commit -m x)', 'block:Qcommit', 'O021 command substitution'],
  ['`git commit -m x`', 'block:Qcommit', 'O022 backtick substitution'],
  ['git \\\n commit -m x', 'block:Qcommit', 'O023 line-continuation split'],
  ["bash -c $'git commit -m x'", 'block:Qcommit', 'O024 ANSI-C -c arg'],
  ['codex exec "$(cat prompt.txt)"\ngit status', 'pass', 'O025 quoted subproc arg + benign'],
  ['echo hi # git commit', 'pass', 'O026 inline comment'],
];
for (const [cmd, expected, label] of EXEC_ORACLE) {
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: cmd } });
  if (expected === 'pass') {
    expect(r.code !== EXIT_BLOCK, `[ORACLE ${label}] expected PASS but was blocked (exit ${r.code}): ${r.stderr.trim()}`);
  } else {
    const skill = expected.split(':')[1];
    expect(r.code === EXIT_BLOCK && new RegExp(skill).test(r.stderr),
      `[ORACLE ${label}] expected BLOCK→${skill} but was not (exit ${r.code})`);
  }
}

// O027 (security regression): pathological deep `$(` nesting must NOT crash the
// scanner into fail-open. A real commit buried in ~8000 levels of substitution
// must still BLOCK (scanner fails closed via depth cap). Was a stack-overflow bypass.
{
  const deep = '$('.repeat(8000) + 'git commit -m x' + ')'.repeat(8000);
  const r = runHook(PRE, { cwd: ROOT, tool_name: 'Bash', tool_input: { command: deep } });
  expect(r.code === EXIT_BLOCK && /Qcommit/.test(r.stderr),
    `[ORACLE O027 deep-nesting bypass] expected BLOCK→Qcommit but was not (exit ${r.code})`);
}

// ── ADR-025 R1: SessionStart injection diet — fallback + grep oracle ───────────
// Run the real session-start hook against an isolated temp cwd and assert the
// enforcement mapping survives the pointer-form shrink (G002 grep oracle) and the
// OUTPUT_STYLE contract is not silently dropped when the doc is missing (fallback).
{
  const tmp = mkdtempSync(join(tmpdir(), 'qe-r1-'));
  try {
    mkdirSync(join(tmp, '.qe'), { recursive: true });      // marks this as a QE project
    writeFileSync(join(tmp, 'CLAUDE.md'), '# proj');         // avoid "not initialized" noise
    // NOTE: deliberately NO QE_CONVENTIONS.md and NO core/OUTPUT_STYLE.md → exercises fallback
    const r = runHook(SESSION, { cwd: tmp, session_id: '00000000-0000-0000-0000-000000000000' });
    let ctx = '';
    try { ctx = (JSON.parse(r.stdout).hookSpecificOutput || {}).additionalContext || ''; } catch {}
    expect(/Qcommit/.test(ctx), '[R1 O017] injected context lost the Qcommit routing cue');
    expect(/\/Qrelease/.test(ctx), '[R1 O018] injected context lost the Qrelease routing cue');
    expect(/→/.test(ctx), '[R1 O019] injected context lost the mapping verb');
    expect(/OUTPUT STYLE/.test(ctx), '[R1 O016] OUTPUT_STYLE contract dropped when doc missing (no fallback)');
    expect(/\[Session State\]/.test(ctx) === false, '[R1 O028] empty session summary should not add token noise');
    expect(/next action/i.test(ctx), '[R1 O029] injected style contract lost the next-action cue');
    expect(/current state/i.test(ctx), '[R1 O030] injected style contract lost the current-state cue');
    expect(/integer minutes/i.test(ctx), '[R1 O031] injected style contract lost the minute-estimate cue');
    expect(/5 items/i.test(ctx), '[R1 O032] injected style contract lost the list-cap cue');
    expect(/one concrete next step/i.test(ctx), '[R1 O033] injected style contract lost the concrete-next-step cue');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error('check-hook-falsepositive: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-hook-falsepositive: PASS (${8 + EXEC_ORACLE.length + 1 + 10} assertions: 2 false-positive, 5 guard-intact, 1 profile, ${EXEC_ORACLE.length + 1} region-oracle, 10 R1-injection)`);
