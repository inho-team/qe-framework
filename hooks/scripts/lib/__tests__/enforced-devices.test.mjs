#!/usr/bin/env node
/**
 * enforced-devices.test.mjs
 *
 * Proves the two "Enforced" savings devices actually fire end-to-end, by running
 * the REAL PreToolUse / PostToolUse hooks against synthetic payloads. Everything
 * happens in per-case temp-dir cwd sandboxes; the real workspace
 * `.qe/state/unified-state.json` is never read or written (asserted).
 *
 * Coverage (VERIFY_CHECKLIST c0127487):
 *   V05  sandbox isolation — hooks only ever touch temp cwds
 *   V06  hooks.json matcher dispatch — PostToolUse regex catches Read/Write/Edit/Bash
 *   V07  ContextMemo record→block across string/object/empty/>10KB tool_response
 *   V08  fresh session first Read is NOT blocked
 *   V09  external edit (mtime bump) invalidates cache — NOT blocked
 *   V11  Task/subagent_type delegation increments delegationStats
 *
 * Run: node hooks/scripts/lib/__tests__/enforced-devices.test.mjs
 * (Repo has no `npm test`; this file is its own runner — exit 1 on any failure.)
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, '..', '..');          // hooks/scripts
const ROOT = join(HOOKS, '..', '..');          // qe-framework root
const PRE = join(HOOKS, 'pre-tool-use.mjs');
const POST = join(HOOKS, 'post-tool-use.mjs');
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json');

const failures = [];
const cleanup = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

// V05 baseline: snapshot the REAL qe-framework state file (if any) BEFORE running
// any hook, so we can prove at the end that no sandbox run leaked a write to it.
const STRAY_STATE = join(ROOT, '.qe', 'state', 'unified-state.json');
const strayBefore = existsSync(STRAY_STATE)
  ? { existed: true, mtimeMs: statSync(STRAY_STATE).mtimeMs }
  : { existed: false, mtimeMs: 0 };

/** Fresh temp cwd sandbox with a .qe/state dir. Registered for cleanup. */
function sandbox() {
  const d = mkdtempSync(join(tmpdir(), 'qe-enforced-'));
  cleanup.push(d);
  mkdirSync(join(d, '.qe', 'state'), { recursive: true });
  return d;
}
/** Run a hook with a payload; return {code, stderr, stdout}. */
function runHook(script, cwd, payload) {
  const r = spawnSync('node', [script], {
    input: JSON.stringify({ cwd, ...payload }),
    encoding: 'utf8',
    cwd,
  });
  return { code: r.status, stderr: r.stderr || '', stdout: r.stdout || '' };
}
/**
 * Read the sandbox's store-backed memo rows, or null when there is no store.
 *
 * Returns null (rather than []) so the caller can tell "no sqlite store, look
 * in the blob" apart from "store exists and is empty".
 *
 * @param {string} cwd - Sandbox project root
 * @returns {Array<{path: string, content: string|null}>|null}
 */
function readMemoRows(cwd) {
  const db = join(cwd, '.qe', 'qe.db');
  if (!existsSync(db)) return null;
  let sqlite;
  try {
    sqlite = process.getBuiltinModule?.('node:sqlite');
  } catch {
    return null;
  }
  if (!sqlite?.DatabaseSync) return null;
  let handle;
  try {
    handle = new sqlite.DatabaseSync(db, { readOnly: true });
    return handle.prepare('SELECT path, content FROM memo').all();
  } catch {
    return null;
  } finally {
    try { handle?.close(); } catch { /* nothing recoverable */ }
  }
}

/** Read the sandbox unified-state.json (or {} if absent). */
function readState(cwd) {
  const p = join(cwd, '.qe', 'state', 'unified-state.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// V06 — hooks.json matcher dispatch: PostToolUse regex catches Read/Write/Edit/Bash
// ---------------------------------------------------------------------------
{
  const cfg = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const postMatcher = cfg.hooks?.PostToolUse?.[0]?.matcher || '';
  const re = new RegExp(`^(?:${postMatcher})$`);
  for (const tool of ['Read', 'Write', 'Edit', 'Bash']) {
    expect(re.test(tool), `[V06] PostToolUse matcher "${postMatcher}" must catch ${tool}`);
  }
  const preMatcher = cfg.hooks?.PreToolUse?.[0]?.matcher || '';
  // PreToolUse uses '*' (match-all) so Task/Read/etc. all dispatch.
  expect(preMatcher === '*', `[V06] PreToolUse matcher must be '*' (was "${preMatcher}")`);
}

// ---------------------------------------------------------------------------
// V07 — ContextMemo record → block, across four tool_response shapes
// ---------------------------------------------------------------------------
/**
 * Cache a file via the real PostToolUse hook, then attempt a duplicate Read via
 * the real PreToolUse hook. Returns { cached, blocked, files, blockedReads }.
 */
function recordThenReread(toolResponse, { filename = 'f.txt', onDiskContent = 'x' } = {}) {
  const cwd = sandbox();
  const file = join(cwd, filename);
  writeFileSync(file, onDiskContent, 'utf8');

  const post = runHook(POST, cwd, {
    tool_name: 'Read',
    tool_input: { file_path: file },
    tool_response: toolResponse,
  });
  expect(post.code === 0, `[V07] post-hook should exit 0 (got ${post.code})`);

  const afterPost = readState(cwd);
  // ContextMemo moved out of unified-state.json into .qe/qe.db (ADR-027 P2),
  // so counting the blob alone would report 0 on any runtime with node:sqlite.
  // Count whichever store actually holds it; the behavioural assertions below
  // (blocked / blockedReads) are unchanged and remain the real contract.
  const fromStore = readMemoRows(cwd);
  const files = fromStore
    ? fromStore.length
    : (afterPost.memo?.files ? Object.keys(afterPost.memo.files).length : 0);
  const cached = fromStore
    ? fromStore.some(r => r.path === file && r.content)
    : !!(afterPost.memo?.files && file in afterPost.memo.files);

  const pre = runHook(PRE, cwd, {
    tool_name: 'Read',
    tool_input: { file_path: file },
  });
  const blocked = pre.code === 2 && /MEMO HIT/.test(pre.stderr);
  const afterPre = readState(cwd);
  const blockedReads = afterPre.memo?.blocked_reads || 0;
  return { cwd, file, cached, blocked, files, blockedReads };
}

// string (small) → cached + blocked, memo.files ≥ 1, blocked_reads ≥ 1
{
  const r = recordThenReread('hello world cached body');
  expect(r.files >= 1, `[V07:string] memo.files should be ≥1 (got ${r.files})`);
  expect(r.blocked, '[V07:string] duplicate Read should be MEMO-blocked');
  expect(r.blockedReads >= 1, `[V07:string] blocked_reads should be ≥1 (got ${r.blockedReads})`);
}
// structured object → cached + blocked (the V07 object-shape case)
{
  const r = recordThenReread({ text: 'structured body', lines: [1, 2, 3] });
  expect(r.files >= 1, `[V07:object] memo.files should be ≥1 (got ${r.files})`);
  expect(r.blocked, '[V07:object] object-shape tool_response should cache and block');
  expect(r.blockedReads >= 1, `[V07:object] blocked_reads should be ≥1 (got ${r.blockedReads})`);
}
// empty string → not effectively cached (falsy body) → NOT blocked (documented edge)
{
  const r = recordThenReread('');
  expect(!r.blocked, '[V07:empty] empty tool_response must NOT block a re-read');
}
// >10KB → over MEMO_FILE_LIMIT → not cached → NOT blocked
{
  const big = 'A'.repeat(11 * 1024);
  const r = recordThenReread(big);
  expect(!r.cached, '[V07:>10KB] over-limit tool_response must NOT be cached');
  expect(!r.blocked, '[V07:>10KB] over-limit read must NOT be blocked');
}

// ---------------------------------------------------------------------------
// V08 — fresh session first Read is NOT blocked
// ---------------------------------------------------------------------------
{
  const cwd = sandbox();
  const file = join(cwd, 'fresh.txt');
  writeFileSync(file, 'fresh content', 'utf8');
  const pre = runHook(PRE, cwd, { tool_name: 'Read', tool_input: { file_path: file } });
  expect(pre.code !== 2, `[V08] fresh-session first Read must NOT be blocked (exit ${pre.code})`);
}

// ---------------------------------------------------------------------------
// V09 — external edit (mtime bump) invalidates cache → NOT blocked
// ---------------------------------------------------------------------------
{
  const cwd = sandbox();
  const file = join(cwd, 'ext.txt');
  writeFileSync(file, 'original', 'utf8');
  // cache it
  const post = runHook(POST, cwd, {
    tool_name: 'Read', tool_input: { file_path: file }, tool_response: 'original',
  });
  expect(post.code === 0, `[V09] cache post-hook exit 0 (got ${post.code})`);
  // sanity: cached and would block if unchanged
  const preSame = runHook(PRE, cwd, { tool_name: 'Read', tool_input: { file_path: file } });
  expect(preSame.code === 2, `[V09] unchanged file should still block (exit ${preSame.code})`);
  // external edit: change content AND bump mtime deterministically into the future
  writeFileSync(file, 'externally changed by bash/git', 'utf8');
  const future = statSync(file).mtimeMs / 1000 + 60;
  utimesSync(file, future, future);
  const preChanged = runHook(PRE, cwd, { tool_name: 'Read', tool_input: { file_path: file } });
  expect(preChanged.code !== 2, `[V09] externally-edited file must NOT be blocked (exit ${preChanged.code})`);
}

// ---------------------------------------------------------------------------
// V11 — Task/subagent_type delegation increments delegationStats
// ---------------------------------------------------------------------------
{
  const cwd = sandbox();
  // sandbox agent fixture with recommendedModel frontmatter → drives inject path
  mkdirSync(join(cwd, 'agents'), { recursive: true });
  writeFileSync(
    join(cwd, 'agents', 'Etask-executor.md'),
    '---\nname: Etask-executor\nrecommendedModel: sonnet\n---\n\nTest agent fixture.\n',
    'utf8',
  );
  // Task call with NO model specified → checkDelegation returns 'inject'
  const pre = runHook(PRE, cwd, {
    tool_name: 'Task',
    tool_input: { subagent_type: 'Etask-executor', prompt: 'do work' },
  });
  expect(pre.code !== 2, `[V11] Task delegation must not be hard-blocked here (exit ${pre.code})`);
  const st = readState(cwd);
  const d = st.delegationStats || {};
  const sum = (d.autoInjections || 0) + (d.warnings || 0) + (d.overrides || 0);
  expect(sum >= 1, `[V11] delegationStats sum should be ≥1 after Task inject (got ${sum}, ${JSON.stringify(d)})`);
  expect((d.autoInjections || 0) >= 1, `[V11] autoInjections should be ≥1 (got ${d.autoInjections})`);
}

// ---------------------------------------------------------------------------
// V05 — sandbox isolation: every cwd used was a tmpdir sandbox
// ---------------------------------------------------------------------------
{
  for (const d of cleanup) {
    expect(d.startsWith(tmpdir()), `[V05] sandbox ${d} must live under the OS temp dir`);
  }
  // Real before/after diff: the qe-framework state file must be byte-for-byte
  // untouched (same existence + mtime) — no sandbox run may have leaked a write.
  const strayAfter = existsSync(STRAY_STATE)
    ? { existed: true, mtimeMs: statSync(STRAY_STATE).mtimeMs }
    : { existed: false, mtimeMs: 0 };
  expect(
    strayAfter.existed === strayBefore.existed && strayAfter.mtimeMs === strayBefore.mtimeMs,
    `[V05] real qe-framework/.qe/state/unified-state.json must be untouched ` +
      `(before=${JSON.stringify(strayBefore)} after=${JSON.stringify(strayAfter)})`,
  );
}

// ---------------------------------------------------------------------------
for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('enforced-devices.test: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('enforced-devices.test: PASS (V05 isolation, V06 matcher, V07 string/object/empty/>10KB, V08 fresh, V09 external-edit, V11 delegation)');
process.exit(0);
