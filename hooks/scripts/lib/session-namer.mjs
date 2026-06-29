#!/usr/bin/env node
'use strict';

/**
 * session-namer.mjs — detached background worker that names/renames the current
 * QE session from the actual work, using a Haiku call.
 *
 * The UserPromptSubmit hook (prompt-check.mjs) is a blocking, non-LLM process —
 * it cannot read the work or wait on an LLM without adding per-prompt latency.
 * So it spawns THIS file fully detached (spawn(..., {detached:true}); unref())
 * and returns immediately. This worker then:
 *   1. Reads recent user turns from the transcript (the "함축" context).
 *   2. Asks Haiku for a Korean 4–6 word name (or, in rename mode, KEEP unless the
 *      topic clearly shifted — conservative, to avoid flicker across terminals).
 *   3. Writes the result via writeSessionName, which the active-session registry
 *      surfaces so other terminals can recognize each other by name.
 *
 * Invocation (all positional, from prompt-check):
 *   node session-namer.mjs <cwd> <sessionRef> <mode> <transcriptPath> [currentName]
 *     mode = "name" | "rename"
 *
 * Fully fail-open: every failure path exits 0 and writes nothing. A lock file
 * (TTL-guarded) prevents overlapping spawns from racing on the same sid.
 */

import { readFileSync, existsSync, mkdirSync, statSync, unlinkSync, openSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { readClaudeOAuthToken } from './claude-token.mjs';
import { writeSessionName, readSessionName } from './session-resolver.mjs';

const MAX_TURNS = 8;            // recent user turns fed to Haiku
const MAX_TURN_CHARS = 240;     // per-turn clamp to bound tokens
const LOCK_TTL_MS = 60_000;     // a stuck/old lock is ignored after this
const HAIKU_TIMEOUT_MS = 6000;  // detached → can afford more than the inline 800ms

/**
 * Entry point. Reads positional argv, acquires the per-sid lock, derives a name
 * from recent transcript turns via Haiku, and persists it. Fail-open throughout:
 * any missing input, absent token, or error results in no write and exit 0.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const [, , cwd, sessionRef, mode, transcriptPath, currentNameArg] = process.argv;
  if (!cwd || !sessionRef || (mode !== 'name' && mode !== 'rename')) return;

  const lockPath = join(cwd, '.qe', 'planning', 'cache', `.session-namer-${shorten(sessionRef)}.lock`);
  if (!acquireLock(lockPath)) return;

  try {
    const turns = readRecentUserTurns(transcriptPath);
    if (turns.length === 0) return;

    const token = readClaudeOAuthToken();
    if (!token) return;

    const currentName = mode === 'rename'
      ? (currentNameArg || readSessionName(cwd, sessionRef))
      : '';

    const name = await askHaiku(token, mode, turns, currentName);
    if (!name) return;
    // Rename mode: the model returns KEEP when the topic is unchanged.
    if (mode === 'rename' && /^keep$/i.test(name)) return;
    // Never overwrite an identical name (avoids churning updatedAt across terminals).
    if (name === currentName) return;

    writeSessionName(cwd, name, sessionRef);
  } catch {
    // fail-open
  } finally {
    try { unlinkSync(lockPath); } catch {}
  }
}

/**
 * Atomic exclusive lock via O_EXCL create (`wx`) — only one of N same-tick
 * spawns can win, so there is no TOCTOU window. A lock older than LOCK_TTL_MS is
 * treated as stale (previous worker died mid-run) and reclaimed once.
 *
 * @param {string} lockPath
 * @returns {boolean} true if the caller holds the lock and may proceed
 */
function acquireLock(lockPath) {
  try { mkdirSync(dirname(lockPath), { recursive: true }); } catch {}
  try {
    closeSync(openSync(lockPath, 'wx')); // atomic create-if-absent
    return true;
  } catch {
    // Already locked → reclaim only if stale, again via atomic create.
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age < LOCK_TTL_MS) return false;
      unlinkSync(lockPath);
      closeSync(openSync(lockPath, 'wx'));
      return true;
    } catch {
      return false;
    }
  }
}

/** First 8 chars of a session ref, safe for a filename. */
function shorten(ref) {
  return String(ref).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'session';
}

/**
 * Pull the most recent user turns from a Claude Code transcript (JSONL, one
 * event per line, newest at the end). Returns plain text, newest last.
 */
function readRecentUserTurns(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw = '';
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n');
  const turns = [];
  // Walk from the end so we collect the MAX_TURNS most recent without parsing all.
  for (let i = lines.length - 1; i >= 0 && turns.length < MAX_TURNS; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const msg = evt?.message;
    if (!msg || msg.role !== 'user') continue;
    const text = extractText(msg.content);
    if (!text) continue;
    // Skip tool_result / hook-injected noise: keep only genuine user prose.
    if (text.startsWith('[') || text.startsWith('<')) continue;
    turns.push(text.slice(0, MAX_TURN_CHARS));
  }
  return turns.reverse();
}

/** Normalize a message `content` (string or content-block array) to text. */
function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

/** Call Haiku and return a trimmed single-line name (or '' on any failure). */
async function askHaiku(token, mode, turns, currentName) {
  const requests = turns.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = mode === 'name'
    ? `다음은 한 코딩 세션에서 사용자가 보낸 최근 요청들이다. 이 세션의 핵심 작업을 한국어 4~6단어로 함축한 짧은 이름을 만들어라. 따옴표·접두어·설명 없이 이름만 한 줄로 출력.\n\n요청들:\n${requests}\n\n이름:`
    : `현재 세션 이름은 직전까지의 작업을 가리킨다: "${currentName}"\n\n아래는 사용자의 최근 요청들이다. 최근 요청이 현재 이름과 다른 대상(다른 기능·파일·도메인·문제)을 다루면, 그 새 작업을 한국어 4~6단어로 함축한 새 이름만 한 줄로 출력하라. 같은 작업을 계속 이어가는 중이면 정확히 KEEP 한 단어만 출력하라. 표현만 다듬는 식의 사소한 변경은 하지 말 것.\n\n요청들:\n${requests}\n\n출력:`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 40,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(HAIKU_TIMEOUT_MS),
    });
    if (!resp.ok) return '';
    const body = await resp.json();
    let out = (body.content?.[0]?.text || '').trim();
    // First line only, strip wrapping quotes the model sometimes adds.
    out = out.split('\n')[0].trim().replace(/^["'`]|["'`]$/g, '').trim();
    return out.slice(0, 48);
  } catch {
    return '';
  }
}

await main();
