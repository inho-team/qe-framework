#!/usr/bin/env node
'use strict';

/**
 * QE Framework deep hook behavior test.
 * Tests actual logic of all 9 hooks, not just crash safety.
 * Output: accuracy: <float> (0.0 ~ 1.0)
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = __dirname;
const SCRIPTS = join(CWD, 'hooks', 'scripts');

let correct = 0;
let total = 0;
let errors = [];

function pass(t) { total++; correct++; }
function fail(t, r) { total++; errors.push(`${t}: ${r}`); }

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function cleanState() {
  const stateDir = join(CWD, '.qe', 'state');
  ensureDir(stateDir);
  for (const f of ['intent-route.json', 'session-stats.json', 'tool-errors.json']) {
    try { unlinkSync(join(stateDir, f)); } catch {}
  }
}

function writeStats(toolCalls) {
  const stateDir = join(CWD, '.qe', 'state');
  ensureDir(stateDir);
  writeFileSync(join(stateDir, 'session-stats.json'), JSON.stringify({
    tool_calls: toolCalls, session_start: Date.now()
  }));
}

function writeIntentRoute(routedTo, intent) {
  const stateDir = join(CWD, '.qe', 'state');
  ensureDir(stateDir);
  writeFileSync(join(stateDir, 'intent-route.json'), JSON.stringify({
    routed_to: routedTo, intent, confidence: 10, classified_at: new Date().toISOString()
  }));
}

function runHook(script, payload) {
  try {
    const escaped = JSON.stringify(payload).replace(/'/g, "'\\''");
    return execSync(`echo '${escaped}' | node "${join(SCRIPTS, script)}"`, {
      encoding: 'utf8', timeout: 10000, cwd: CWD
    }).trim();
  } catch (e) {
    return e.stdout?.trim() || `ERROR:${e.status}:${(e.stderr || '').slice(0, 100)}`;
  }
}

function getCtx(result) {
  try {
    const o = JSON.parse(result);
    return o?.hookSpecificOutput?.additionalContext || '';
  } catch { return ''; }
}

// ============ 1. session-start.mjs ============

// 1a. Qtranslate injection (no language.md)
cleanState();
const langPath = join(CWD, '.qe', 'profile', 'language.md');
try { unlinkSync(langPath); } catch {}

const ss1 = getCtx(runHook('session-start.mjs', { cwd: CWD }));
if (ss1.includes('Qtranslate') && ss1.includes('Detect')) {
  pass('session-start:qtranslate-detect');
} else {
  fail('session-start:qtranslate-detect', `Expected Qtranslate detect, got: ${ss1.slice(0, 80)}`);
}

// 1b. Qtranslate injection (with language.md)
ensureDir(join(CWD, '.qe', 'profile'));
writeFileSync(langPath, '# Language Profile\n\n## Settings\n- Primary language: ko\n');
const ss2 = getCtx(runHook('session-start.mjs', { cwd: CWD }));
if (ss2.includes('Qtranslate') && ss2.includes('ko')) {
  pass('session-start:qtranslate-ko');
} else {
  fail('session-start:qtranslate-ko', `Expected ko, got: ${ss2.slice(0, 80)}`);
}
try { unlinkSync(langPath); } catch {}

// 1c. Git branch detection
const ss3 = getCtx(runHook('session-start.mjs', { cwd: CWD }));
if (ss3.includes('[Git]') && ss3.includes('Branch:')) {
  pass('session-start:git-branch');
} else {
  fail('session-start:git-branch', `Expected git branch info, got: ${ss3.slice(0, 80)}`);
}

// 1d. Resets session-stats.json
const statsPath = join(CWD, '.qe', 'state', 'session-stats.json');
runHook('session-start.mjs', { cwd: CWD });
if (existsSync(statsPath)) {
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
  if (stats.tool_calls === 0) {
    pass('session-start:reset-stats');
  } else {
    fail('session-start:reset-stats', `tool_calls not reset: ${stats.tool_calls}`);
  }
} else {
  fail('session-start:reset-stats', 'session-stats.json not created');
}

// 1e. Cleans up intent-route.json
const irPath = join(CWD, '.qe', 'state', 'intent-route.json');
writeFileSync(irPath, '{}');
runHook('session-start.mjs', { cwd: CWD });
if (!existsSync(irPath)) {
  pass('session-start:cleanup-intent');
} else {
  fail('session-start:cleanup-intent', 'intent-route.json not cleaned up');
}

// ============ 2. pre-tool-use.mjs ============

// 2a. First call → INTENT GATE hint
cleanState();
writeStats(0);
const pt1 = getCtx(runHook('pre-tool-use.mjs', { cwd: CWD, tool_name: 'Read' }));
if (pt1.includes('INTENT GATE') || pt1.includes('INTENT')) {
  pass('pre-tool-use:first-call-gate');
} else {
  fail('pre-tool-use:first-call-gate', `Expected INTENT GATE, got: ${pt1.slice(0, 80)}`);
}

// 2b. Route exists → shows routing info
cleanState();
writeStats(5);
writeIntentRoute('Qcommit', 'commit/push');
const pt2 = getCtx(runHook('pre-tool-use.mjs', { cwd: CWD, tool_name: 'Bash' }));
if (pt2.includes('Routed to:') && pt2.includes('Qcommit')) {
  pass('pre-tool-use:shows-route');
} else {
  fail('pre-tool-use:shows-route', `Expected route info, got: ${pt2.slice(0, 80)}`);
}

// 2c. Secret detection — AWS key in Write
cleanState();
writeStats(5);
const pt3 = getCtx(runHook('pre-tool-use.mjs', {
  cwd: CWD, tool_name: 'Write',
  tool_input: { content: 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"' }
}));
if (pt3.includes('SECRET WARNING')) {
  pass('pre-tool-use:secret-aws');
} else {
  fail('pre-tool-use:secret-aws', `Expected SECRET WARNING, got: ${pt3.slice(0, 80)}`);
}

// 2d. Secret detection — GitHub token in Edit
const pt4 = getCtx(runHook('pre-tool-use.mjs', {
  cwd: CWD, tool_name: 'Edit',
  tool_input: { new_string: 'token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz12"' }
}));
if (pt4.includes('SECRET WARNING')) {
  pass('pre-tool-use:secret-github');
} else {
  fail('pre-tool-use:secret-github', `Expected SECRET WARNING, got: ${pt4.slice(0, 80)}`);
}

// 2e. No secret warning for normal content
const pt5 = getCtx(runHook('pre-tool-use.mjs', {
  cwd: CWD, tool_name: 'Write',
  tool_input: { content: 'const x = 42;' }
}));
if (!pt5.includes('SECRET WARNING')) {
  pass('pre-tool-use:no-false-secret');
} else {
  fail('pre-tool-use:no-false-secret', 'False positive secret detection');
}

// 2f. .qe/ auto-permission hint
const pt6 = getCtx(runHook('pre-tool-use.mjs', {
  cwd: CWD, tool_name: 'Write',
  tool_input: { file_path: '/project/.qe/state/test.json', content: '{}' }
}));
if (pt6.includes('.qe/') && pt6.includes('auto-executed')) {
  pass('pre-tool-use:qe-auto-permission');
} else {
  fail('pre-tool-use:qe-auto-permission', `Expected .qe auto hint, got: ${pt6.slice(0, 80)}`);
}

// 2g. Context pressure warning at 200+ tool calls
cleanState();
writeStats(200);
const pt7 = getCtx(runHook('pre-tool-use.mjs', { cwd: CWD, tool_name: 'Read' }));
if (pt7.includes('Context pressure') || pt7.includes('Qcompact') || pt7.includes('context usage')) {
  pass('pre-tool-use:context-pressure-high');
} else {
  fail('pre-tool-use:context-pressure-high', `Expected pressure warning at 200, got: ${pt7.slice(0, 80)}`);
}

// 2h. Critical context pressure at 250+
cleanState();
writeStats(251);
const pt8 = getCtx(runHook('pre-tool-use.mjs', { cwd: CWD, tool_name: 'Read' }));
if (pt8.includes('critical') || pt8.includes('250')) {
  pass('pre-tool-use:context-pressure-critical');
} else {
  fail('pre-tool-use:context-pressure-critical', `Expected critical at 250, got: ${pt8.slice(0, 80)}`);
}

// 2i. Analysis hint for broad Glob
cleanState();
writeStats(5);
const pt9 = getCtx(runHook('pre-tool-use.mjs', {
  cwd: CWD, tool_name: 'Glob',
  tool_input: { pattern: '**/*.ts' }
}));
if (pt9.includes('.qe/analysis/')) {
  pass('pre-tool-use:analysis-hint-glob');
} else {
  fail('pre-tool-use:analysis-hint-glob', `Expected analysis hint, got: ${pt9.slice(0, 80)}`);
}

// ============ 3. post-tool-use.mjs ============

// 3a. Increments tool call count
cleanState();
writeStats(5);
runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Read' });
const stats3a = JSON.parse(readFileSync(statsPath, 'utf8'));
if (stats3a.tool_calls === 6) {
  pass('post-tool-use:increment-count');
} else {
  fail('post-tool-use:increment-count', `Expected 6, got: ${stats3a.tool_calls}`);
}

// 3b. Error tracking on error response
cleanState();
writeStats(5);
runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Bash', tool_response: 'Error: command not found', exit_code: 1 });
const errFile = join(CWD, '.qe', 'state', 'tool-errors.json');
if (existsSync(errFile)) {
  const errState = JSON.parse(readFileSync(errFile, 'utf8'));
  if (errState.errors && errState.errors.length > 0 && errState.errors[0].tool === 'Bash') {
    pass('post-tool-use:error-tracking');
  } else {
    fail('post-tool-use:error-tracking', 'Error not recorded correctly');
  }
} else {
  fail('post-tool-use:error-tracking', 'tool-errors.json not created');
}

// 3c. Error escalation hint after 3 errors
cleanState();
writeStats(5);
const errState3c = { errors: [
  { tool: 'Bash', timestamp: Date.now(), preview: 'err1' },
  { tool: 'Bash', timestamp: Date.now(), preview: 'err2' },
], window_start: Date.now() };
ensureDir(join(CWD, '.qe', 'state'));
writeFileSync(errFile, JSON.stringify(errState3c));
const pu3c = getCtx(runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Bash', tool_response: 'Error again', exit_code: 1 }));
if (pu3c.includes('systematic-debugging') || pu3c.includes('failed 3')) {
  pass('post-tool-use:error-escalate-3');
} else {
  fail('post-tool-use:error-escalate-3', `Expected escalation at 3, got: ${pu3c.slice(0, 80)}`);
}

// 3d. Error delegate hint after 5 errors
cleanState();
writeStats(5);
const errState3d = { errors: [
  { tool: 'Bash', timestamp: Date.now(), preview: 'e1' },
  { tool: 'Bash', timestamp: Date.now(), preview: 'e2' },
  { tool: 'Bash', timestamp: Date.now(), preview: 'e3' },
  { tool: 'Bash', timestamp: Date.now(), preview: 'e4' },
], window_start: Date.now() };
writeFileSync(errFile, JSON.stringify(errState3d));
const pu3d = getCtx(runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Bash', tool_response: 'Error 5', exit_code: 1 }));
if (pu3d.includes('Ecode-debugger') || pu3d.includes('5+')) {
  pass('post-tool-use:error-delegate-5');
} else {
  fail('post-tool-use:error-delegate-5', `Expected delegation at 5, got: ${pu3d.slice(0, 80)}`);
}

// 3e. Success clears error tracking
cleanState();
writeStats(5);
writeFileSync(errFile, JSON.stringify({ errors: [{ tool: 'Bash', timestamp: Date.now(), preview: 'err' }], window_start: Date.now() }));
runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Bash', tool_response: 'Success' });
const errAfter = JSON.parse(readFileSync(errFile, 'utf8'));
const bashErrors = errAfter.errors.filter(e => e.tool === 'Bash');
if (bashErrors.length === 0) {
  pass('post-tool-use:success-clears-errors');
} else {
  fail('post-tool-use:success-clears-errors', `Bash errors not cleared: ${bashErrors.length}`);
}

// 3f. Profile collection trigger at interval
cleanState();
writeStats(19); // Will become 20 after increment
const pu3f = getCtx(runHook('post-tool-use.mjs', { cwd: CWD, tool_name: 'Read' }));
if (pu3f.includes('Eprofile-collector')) {
  pass('post-tool-use:profile-trigger');
} else {
  fail('post-tool-use:profile-trigger', `Expected profile trigger at 20, got: ${pu3f.slice(0, 80)}`);
}

// 3g. TypeScript hint for .ts file edit
cleanState();
writeStats(5);
const pu3g = getCtx(runHook('post-tool-use.mjs', {
  cwd: CWD, tool_name: 'Edit',
  tool_input: { file_path: '/src/app.tsx' }
}));
if (pu3g.includes('type check') || pu3g.includes('TypeScript')) {
  pass('post-tool-use:ts-hint');
} else {
  fail('post-tool-use:ts-hint', `Expected TS hint, got: ${pu3g.slice(0, 80)}`);
}

// ============ 4. notification.mjs ============

// 4a-4d. Agent chaining for key agents
const chainingTests = [
  ['Etask-executor completed', 'Earchive-executor', 'notification:chain-task-executor'],
  ['Erefresh-executor finished', 'Analysis updated', 'notification:chain-refresh'],
  ['Ecompact-executor saved', 'Context saved', 'notification:chain-compact'],
  ['Ecode-debugger analysis done', 'Review findings', 'notification:chain-debugger'],
  ['Ecommit-executor created commit', 'commit hash', 'notification:chain-commit'],
  ['Ecode-reviewer finished review', 'Code review completed', 'notification:chain-reviewer'],
  ['Edeep-researcher completed', 'Research completed', 'notification:chain-researcher'],
];

for (const [message, expectedHint, testName] of chainingTests) {
  const nr = getCtx(runHook('notification.mjs', { cwd: CWD, message }));
  if (nr.toLowerCase().includes(expectedHint.toLowerCase())) {
    pass(testName);
  } else {
    fail(testName, `Expected "${expectedHint}", got: ${nr.slice(0, 80)}`);
  }
}

// 4e. Unknown notification → no chain
const nr_unknown = getCtx(runHook('notification.mjs', { cwd: CWD, message: 'something random happened' }));
if (nr_unknown === '') {
  pass('notification:no-chain-unknown');
} else {
  fail('notification:no-chain-unknown', `Unexpected chain: ${nr_unknown.slice(0, 60)}`);
}

// ============ 5. pre-compact.mjs ============

// 5a. Creates compact-trigger.json
cleanState();
const triggerPath = join(CWD, '.qe', 'context', 'compact-trigger.json');
try { unlinkSync(triggerPath); } catch {}
runHook('pre-compact.mjs', { cwd: CWD, session_id: 'test-session' });
if (existsSync(triggerPath)) {
  const trigger = JSON.parse(readFileSync(triggerPath, 'utf8'));
  if (trigger.reason === 'pre-compact') {
    pass('pre-compact:trigger-file');
  } else {
    fail('pre-compact:trigger-file', `Wrong reason: ${trigger.reason}`);
  }
} else {
  fail('pre-compact:trigger-file', 'compact-trigger.json not created');
}

// 5b. Injects post-compact rules with intent routing
const pc2 = getCtx(runHook('pre-compact.mjs', { cwd: CWD }));
if (pc2.includes('POST-COMPACT RULES') && pc2.includes('Intent routing')) {
  pass('pre-compact:post-rules');
} else {
  fail('pre-compact:post-rules', `Expected post-compact rules, got: ${pc2.slice(0, 80)}`);
}

// 5c. Includes agent tiers
if (pc2.includes('Agent tiers') || pc2.includes('haiku') || pc2.includes('sonnet')) {
  pass('pre-compact:agent-tiers');
} else {
  fail('pre-compact:agent-tiers', `Expected agent tiers, got: ${pc2.slice(0, 80)}`);
}

// ============ 6. stop-handler.mjs ============

// 6a. No active mode → allows stop (continue: true)
cleanState();
const sh1 = runHook('stop-handler.mjs', { cwd: CWD });
try {
  const parsed = JSON.parse(sh1);
  if (parsed.continue === true) {
    pass('stop-handler:allows-stop');
  } else {
    fail('stop-handler:allows-stop', `Expected continue:true, got: ${sh1.slice(0, 60)}`);
  }
} catch {
  fail('stop-handler:allows-stop', `Invalid JSON: ${sh1.slice(0, 60)}`);
}

// 6b. Active ultrawork mode → blocks stop
cleanState();
const ultraworkState = join(CWD, '.qe', 'state', 'ultrawork-state.json');
ensureDir(join(CWD, '.qe', 'state'));
writeFileSync(ultraworkState, JSON.stringify({
  active: true, started_at: new Date().toISOString(), reinforcement_count: 0
}));
const sh2 = runHook('stop-handler.mjs', { cwd: CWD });
try {
  const parsed = JSON.parse(sh2);
  if (parsed.continue === false && parsed.decision === 'block') {
    pass('stop-handler:blocks-ultrawork');
  } else {
    fail('stop-handler:blocks-ultrawork', `Expected block, got: ${sh2.slice(0, 60)}`);
  }
} catch {
  fail('stop-handler:blocks-ultrawork', `Invalid JSON: ${sh2.slice(0, 60)}`);
}
try { unlinkSync(ultraworkState); } catch {}

// ============ 7. task-completed.mjs ============

// 7a. No task_id → passes through
const tc1 = runHook('task-completed.mjs', { cwd: CWD });
try {
  const parsed = JSON.parse(tc1);
  if (parsed.continue === true) {
    pass('task-completed:no-task-pass');
  } else {
    fail('task-completed:no-task-pass', `Expected continue:true`);
  }
} catch {
  fail('task-completed:no-task-pass', `Invalid JSON: ${tc1.slice(0, 60)}`);
}

// ============ 8. teammate-idle.mjs ============

// 8a. With pending tasks → hint
const ti1 = runHook('teammate-idle.mjs', { cwd: CWD, teammate_name: 'worker-1', pending_tasks: 3 });
const ti1ctx = getCtx(ti1);
if (ti1ctx.includes('worker-1') && ti1ctx.includes('3')) {
  pass('teammate-idle:pending-hint');
} else {
  fail('teammate-idle:pending-hint', `Expected pending hint, got: ${ti1ctx.slice(0, 60)}`);
}

// 8b. No pending tasks → pass through
const ti2 = runHook('teammate-idle.mjs', { cwd: CWD, teammate_name: 'worker-1', pending_tasks: 0 });
try {
  const parsed = JSON.parse(ti2);
  if (parsed.continue === true) {
    pass('teammate-idle:no-pending-pass');
  } else {
    fail('teammate-idle:no-pending-pass', `Expected pass through`);
  }
} catch {
  fail('teammate-idle:no-pending-pass', `Invalid JSON: ${ti2.slice(0, 60)}`);
}

// ============ 9. prompt-check.mjs (additional behavioral tests) ============

// 9a. Ambiguity detection — "fix it"
cleanState();
const pc9a = getCtx(runHook('prompt-check.mjs', { cwd: CWD, user_message: 'fix it' }));
if (pc9a.includes('Ambiguous')) {
  pass('prompt-check:ambiguity-fix-it');
} else {
  fail('prompt-check:ambiguity-fix-it', `Expected ambiguous, got: ${pc9a.slice(0, 60)}`);
}

// 9b. Ambiguity detection — "do something"
cleanState();
const pc9b = getCtx(runHook('prompt-check.mjs', { cwd: CWD, user_message: 'do something' }));
if (pc9b.includes('Ambiguous')) {
  pass('prompt-check:ambiguity-do-something');
} else {
  fail('prompt-check:ambiguity-do-something', `Expected ambiguous, got: ${pc9b.slice(0, 60)}`);
}

// 9c. Normal message → NOT ambiguous
cleanState();
const pc9c = getCtx(runHook('prompt-check.mjs', { cwd: CWD, user_message: 'review this code and check for bugs' }));
if (!pc9c.includes('Ambiguous')) {
  pass('prompt-check:not-ambiguous-normal');
} else {
  fail('prompt-check:not-ambiguous-normal', 'False positive ambiguity');
}

// ============ Cleanup ============
cleanState();
try { unlinkSync(triggerPath); } catch {}

// ============ Output ============
const accuracy = total > 0 ? correct / total : 0;
console.log(`accuracy: ${accuracy.toFixed(6)}`);
console.log(`correct: ${correct}/${total}`);
console.log(`errors: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n--- Errors ---');
  for (const err of errors) {
    console.log(err);
  }
}
