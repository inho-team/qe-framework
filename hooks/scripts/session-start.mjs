#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import { execSync, spawn } from 'child_process';
import { loadConfig } from './lib/config.mjs';
import { readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { getLatestCodexJobStatus, reapStaleCodexJobs } from '../../scripts/lib/codex_bridge.mjs';
import { pruneExpired, formatMemoryContext } from './lib/project-memory.mjs';
import { topLearnings } from './lib/learnings.mjs';
import { analyze as sweepAnalyze, formatSummary as sweepFormatSummary } from './lib/sweep-analyzer.mjs';
import {
  shortenSid,
  getSessionContextDir,
  readSessionName,
  readSessionPlan,
  summarizeSessionState,
  formatSessionStateSummary,
} from './lib/session-resolver.mjs';
import { cleanupStaleSessions, upsertSession, filterActiveSessions } from './lib/session-registry.mjs';
import { runAutoMigrations, summarizeReport } from './lib/legacy-migrator.mjs';
import { calculateSkillBudget, checkBudgetOverflow } from './lib/skill-budget.mjs';
import { maybeSpawnRefresh, ensurePeriodicRefresh } from './lib/auto-refresh.mjs';
import { invalidateCachedRatio, readDetectedLimit, writeCachedLimit } from './lib/context-meter.mjs';
import { collectExpiredSkillHints, formatExpiredSkillHint } from './lib/skill-expiry-hint.mjs';

// Read stdin (Claude Code provides JSON with cwd, session_id, etc.)
// Read fd 0 directly. `/dev/stdin` re-opens the pipe and can read empty on Linux CI
// (a known gotcha — same pattern as pre-tool-use.mjs); reading the fd is portable
// across macOS and Linux runners.
// Based on the re-injection pattern from superpowers/using-superpowers (MIT).
let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  // If no valid input, pass through
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// R008: Parse source field from payload.
// Known values: 'startup' | 'resume' | 'clear' | 'compact'
// - 'clear' / 'compact' → minimal bootstrap additionalContext only
// - 'startup' / 'resume' → full startup injection (startup-equivalent)
// - missing / unknown → fail-open: full startup injection (existing behavior)
// NOTE [UNVERIFIED]: The presence of the `source` field in real Claude Code
// SessionStart payloads has not been confirmed via live observation. This
// implementation follows the spec contract and fails open (full injection)
// when the field is absent or unknown.
const sessionSource = (typeof data.source === 'string' ? data.source.toLowerCase() : '');
const isCompactionSource = (sessionSource === 'clear' || sessionSource === 'compact');

const cwd = data.cwd || data.directory || process.cwd();
const cfg = loadConfig(cwd);
const messages = [];
const COMMAND_PREFIX = process.env.QE_COMMAND_PREFIX || '/';
const skillCommand = (name) => `${COMMAND_PREFIX}${name}`;

const startupModelId = data.model?.id || data.model || '';
const startupCacheScope = {
  client: data.client || process.env.QE_CLIENT || 'claude',
  sessionId: sessionIdFromPayload(data) || '',
  modelId: startupModelId,
};

// Drop any stale context-usage ratio before this
// session began. The cache is scoped by client/session/model; after a `/clear`
// (or resume/startup) it can still hold the previous conversation's high
// percentage, which would make context-guard / context-monitor raise false
// context-pressure on the fresh, near-empty session. Removing it forces those
// hooks to fall back to transcript-based estimation (the real state). The
// window limit (200k vs 1M) is preserved — it's model-constant across /clear.
try {
  invalidateCachedRatio(cwd, startupCacheScope);
} catch {
  // Fault tolerance — never block session start on cache housekeeping.
}

// Seed the volatile window limit from the DURABLE, model-keyed detection (if any)
// recorded in a prior session. This closes the cold-start window: after a
// state-folder wipe the cache has no limit, so a 1M run would momentarily score against
// the 200k default and could raise false context-pressure on the very first
// tool calls. Seeding from .qe/config.json (which survives the wipe) prevents it.
try {
  const detected = readDetectedLimit(cwd, startupModelId);
  if (detected) writeCachedLimit(cwd, detected, startupCacheScope);
} catch {
  // Fault tolerance — seeding is best-effort.
}

function sessionIdFromPayload(payload) {
  let sessionId = payload.session_id || payload.sessionId || null;
  if (!sessionId && typeof payload.transcript_path === 'string') {
    const base = payload.transcript_path.split('/').pop() || '';
    const candidate = base.replace(/\.jsonl$/, '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
      sessionId = candidate;
    }
  }
  return sessionId;
}

// Compute this Claude session's short sid up front so per-session paths
// (snapshot, handoff, decisions) and the additionalContext announcement all
// agree. Falls back to '_unknown' bucket downstream if sid is missing.
const currentSessionId = sessionIdFromPayload(data);
const currentSid = shortenSid(currentSessionId);

// Run every auto-eligible legacy migration (context flat, handoffs flat,
// future entries from lib/legacy-migrator.mjs) before any downstream reader
// touches the new layout. Idempotent — re-running on a clean tree is a no-op.
let migrationSummary = null;
try {
  const report = runAutoMigrations(cwd);
  migrationSummary = summarizeReport(report);
} catch {
  // Fault tolerance — migration is one-shot housekeeping, never block start.
}

// --- ALWAYS TIER ---
// These items are injected every session start regardless of context_loaded state.

// Announce this session's short sid so skills (Qcompact / Qresume) can
// address per-session paths without re-reading state files. Skills look for
// the `[Session] sid:XXXXXXXX` marker in additionalContext. If the user set a
// session name, include it without changing the legacy no-name marker shape.
if (currentSid) {
  const sessionName = readSessionName(cwd, currentSessionId || currentSid);
  messages.push(sessionName ? `[Session] name:${sessionName} sid:${currentSid}` : `[Session] sid:${currentSid}`);
}

// Maintain a best-effort active-session registry for multi-terminal awareness.
// This does not replace .qe/state/current-session.json, which remains a
// project-global last-write-wins pointer for legacy skill lookup.
try {
  const activeAfterCleanup = cleanupStaleSessions(cwd);
  let activeSessions = activeAfterCleanup;
  if (currentSid) {
    activeSessions = upsertSession(cwd, {
      sid: currentSid,
      name: readSessionName(cwd, currentSessionId || currentSid),
      plan: readSessionPlan(cwd, currentSessionId || currentSid),
      lastSeen: new Date().toISOString(),
      pid: process.pid,
    });
  }

  const others = filterActiveSessions(activeSessions)
    .filter((entry) => entry.sid !== currentSid);
  if (others.length > 0) {
    const line = others
      .map((entry) => {
        const name = entry.name || '(unnamed)';
        const plan = entry.plan || '(none)';
        return `name:${name} sid:${entry.sid} plan:${plan} lastSeen:${entry.lastSeen}`;
      })
      .join('; ');
    messages.push(`[Sessions] other active sessions: ${line}`);
  }
} catch {
  // Fault tolerance — session awareness must never block SessionStart.
}

// Surface a one-line summary when auto-migration moved anything, so the
// user sees what changed and can run the active-client migration skill for the full report.
if (migrationSummary) {
  messages.push(`${migrationSummary} Run ${skillCommand('Qmigrate-legacy')} for details.`);
}

// Check 1: project instruction artifact existence (Qinit check)
const instructionCandidates = [
  join(cwd, 'CLAUDE.md'),
  join(cwd, 'AGENTS.md')
];
const hasInstructionArtifact = instructionCandidates.some(filePath => existsSync(filePath));
if (!hasInstructionArtifact) {
  messages.push(`QE framework not initialized. Run \`${skillCommand('Qinit')}\` first.`);
}

// --- STALE-CHECK TIER ---
// Freshness / snapshot checks that are cheap to run and always relevant.

// Check 2: .qe/analysis/ freshness
const analysisDir = join(cwd, '.qe', 'analysis');
if (existsSync(analysisDir)) {
  const analysisFiles = ['project-structure.md', 'tech-stack.md', 'entry-points.md', 'architecture.md'];
  const staleThreshold = cfg.analysis_freshness_ms;
  const now = Date.now();

  let staleCount = 0;
  for (const file of analysisFiles) {
    const filePath = join(analysisDir, file);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > staleThreshold) {
        staleCount++;
      }
    } else {
      staleCount++;
    }
  }

  if (staleCount >= 1) {
    // Self-heal: spawn a detached Haiku refresh (one-shot, lock-guarded) and start a
    // periodic refresh job. Never block session start if any of this fails.
    let launched = false;
    try {
      launched = maybeSpawnRefresh(cwd, cfg);
      ensurePeriodicRefresh(cwd, cfg, process.env.CLAUDE_PLUGIN_ROOT);
    } catch { /* auto-refresh is best-effort housekeeping */ }

    if (launched) {
      messages.push('[QE] 분석이 오래됨 — Haiku로 백그라운드 갱신 시작 (.qe/analysis/). 완료 후 자동 반영.');
    } else {
      messages.push(`[QE] Project analysis looks stale — ${skillCommand('Qrefresh')} would give you fresher context to work from.`);
    }
  }
}

// Check 3: per-session snapshot.md existence (resume hint).
// Each terminal has its own .qe/context/sessions/{sid}/snapshot.md, so we
// only surface a "restore" hint when *this* session's snapshot exists.
if (currentSid) {
  const snapshotPath = join(getSessionContextDir(cwd, currentSid), 'snapshot.md');
  if (existsSync(snapshotPath)) {
    const stat = statSync(snapshotPath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 24) {
      messages.push(`Previous session context saved. Restore with \`${skillCommand('Qresume')}\`.`);
    }
  }
}

// Check 4: collected local skill expiry hint. Read-only and fail-open: this
// inspects only .claude/skills/*/SKILL.md scalar frontmatter, never tech-stack.md,
// and does not spawn, write, or perform network I/O.
try {
  const hint = formatExpiredSkillHint(collectExpiredSkillHints(cwd, cfg), COMMAND_PREFIX);
  if (hint) messages.push(hint);
} catch {
  // Fault tolerance — local skill expiry hints must never block SessionStart.
}

// --- ALWAYS TIER (continued) ---

// Inject the Override Map as a COMPACT POINTER (ADR-025 R1). Previously this
// sliced the entire "## Preferred Skill Map" section out of QE_CONVENTIONS.md
// and injected it verbatim every session — hundreds of tokens. The enforcement
// is the PreToolUse hard-block; the injection only needs to (a) name the routing
// cues so Claude reaches for the skill first, and (b) point at the full doc. The
// required cues are kept INLINE so they survive even when QE_CONVENTIONS.md is
// missing/moved (the silent-drop case): we gate on `.qe/` presence, not the doc.
const conventionsPath = join(cwd, 'QE_CONVENTIONS.md');
const qeDir = join(cwd, '.qe');
if (existsSync(conventionsPath) || existsSync(qeDir)) {
  const fullMapPointer = existsSync(conventionsPath) ? ' Full map: QE_CONVENTIONS.md.' : '';
  messages.push(
    '[QE OVERRIDE MAP] Use the QE skill, not the manual action — PreToolUse HARD-BLOCKS ' +
    `direct git commit / version edits. manual commit → ${skillCommand('Qcommit')} · version/release → /Qrelease · ` +
    `show version → ${skillCommand('Qversion')} · context save → ${skillCommand('Qcompact')} · restore → ${skillCommand('Qresume')} · ` +
    `archive tasks → ${skillCommand('Qgc')} archive · refresh analysis → ${skillCommand('Qrefresh')}.` + fullMapPointer
  );
}

// Inject the OUTPUT_STYLE contract as a COMPACT POINTER (ADR-025 R1). The full
// digest was ~10 lines every session; the rules live in core/OUTPUT_STYLE.md.
// Fallback: if that doc is missing/moved but this is a QE project (.qe/ present),
// still inject the minimal contract so the style rule is never silently dropped.
const stylePath = join(cwd, 'core', 'OUTPUT_STYLE.md');
if (existsSync(stylePath) || existsSync(qeDir)) {
  const styleSrc = existsSync(stylePath) ? 'core/OUTPUT_STYLE.md' : 'the QE output style';
  messages.push(
    `[QE OUTPUT STYLE] Follow ${styleSrc}: conclusion-first (결론→근거), separate 사실/추정, ` +
    'name the recommended option, cite 참고 문서. NO 의식의 흐름·추임새("잠깐 —","맞다 —","음,")·과장/' +
    '드라마 — 정리된 결론만, 도달 경로는 쓰지 않는다. Tables for comparisons, ★ evidence-level for ' +
    'verdicts, 3–5 line summary when long. Skip these forms for short/single-point answers. ' +
    '(A Stop-hook style gate blocks drama-style turns and forces a rewrite.)'
  );
}

// Inject the Codex Runtime Policy as a COMPACT POINTER — but ONLY when Codex is
// actually in the SIVS routing. A pure-Claude session (no codex stage/profile)
// doesn't need the Codex foreground/background operating rules, saving ~115
// tokens. Fail-safe: if .qe/sivs-config.json is missing or unreadable, KEEP
// injecting so behavior never regresses. Full rule lives in QE_CONVENTIONS.md.
if (existsSync(conventionsPath) || existsSync(qeDir)) {
  let injectCodexRuntime = true; // fail-safe default
  try {
    const sivsPath = join(cwd, '.qe', 'sivs-config.json');
    if (existsSync(sivsPath)) {
      const sivs = JSON.parse(readFileSync(sivsPath, 'utf8'));
      const profileHasCodex = typeof sivs.profile === 'string' && sivs.profile.includes('codex');
      const stageHasCodex = ['spec', 'implement', 'verify', 'supervise'].some(
        (s) => sivs[s] && sivs[s].engine === 'codex'
      );
      injectCodexRuntime = profileHasCodex || stageHasCodex;
    }
    // sivs-config absent → injectCodexRuntime stays true (fail-safe, no regression)
  } catch {
    injectCodexRuntime = true; // read/parse error → fail-safe inject, never throw
  }
  if (injectCodexRuntime) {
    messages.push(
      '[QE CODEX RUNTIME] Prefer Codex for SIVS Implement/Verify and bounded repo search when available; ' +
      'keep Spec/Supervise Claude-led unless explicitly routed otherwise. Use foreground for short Codex tasks. ' +
      'For long Codex jobs, --background is allowed only if you retrieve results with /codex:status and ' +
      '/codex:result <job-id> before final reporting. Keep Codex output concise: files, lines, summary, next action. ' +
      'Full rule: QE_CONVENTIONS.md → Codex Runtime Policy.'
    );
  }
}

// Codex asset auto-sync (drift detection). Claude has no "plugin updated" hook
// event, so we detect drift at session start instead: when the loaded plugin
// version (CLAUDE_PLUGIN_ROOT/package.json) is ahead of the version stamped into
// ~/.codex/.qe-codex-version by the last installCodexAssets() run, the Codex-side
// QE skills/agents are stale. Kick off a fully detached background re-sync so the
// Codex target follows the plugin without a manual /Qupdate. Best-effort: never
// delays or blocks session start; ~/.codex absent → no-op (not a Codex user).
try {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const codexDir = join(homedir(), '.codex');
  if (pluginRoot && existsSync(codexDir)) {
    let pluginVer = null;
    try { pluginVer = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version; } catch {}
    let codexVer = null;
    try { codexVer = JSON.parse(readFileSync(join(codexDir, '.qe-codex-version'), 'utf8')).version; } catch {}
    if (pluginVer && pluginVer !== codexVer) {
      const installer = join(pluginRoot, 'scripts', 'lib', 'client_installers.mjs');
      if (existsSync(installer)) {
        const code = `import(${JSON.stringify(pathToFileURL(installer).href)})`
          + `.then(m=>m.installCodexAssets()).catch(()=>{})`;
        const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
        child.unref();
        messages.push(`[QE] Codex 자산을 v${pluginVer}로 백그라운드 동기화 중 (이전: v${codexVer || 'none'}).`);
      }
    }
  }
} catch {
  // Fault tolerance — never block session start on Codex sync housekeeping.
}

const aiTeamConfigPath = join(cwd, '.qe', 'ai-team', 'config', 'team-config.json');
if (existsSync(aiTeamConfigPath)) {
  messages.push('[AI Team] Multi-model role config detected. Respect role boundaries: planner owns spec artifacts, implementer owns code changes, reviewer performs independent review, supervisor makes the final gate decision.');
}

// Check 4: User language context (language.md)
const languagePath = join(cwd, '.qe', 'profile', 'language.md');
if (existsSync(languagePath)) {
  const langContent = readFileSync(languagePath, 'utf8');
  const langMatch = langContent.match(/Primary language:\s*(\w+)\s*(?:\(([^)]+)\))?/);
  const userLang = langMatch ? langMatch[1] : null;
  const langName = langMatch && langMatch[2] ? langMatch[2] : userLang;
  if (userLang && userLang !== 'en') {
    messages.push(`[Language] Respond in ${langName} (the user's language), using only that language plus English/Latin where natural. English is fine for technical terms, code, and identifiers. Do NOT mix in other scripts — no Chinese (中文) or Japanese (かな/漢字) characters unless ${langName} is that language.`);
  }
}

// Check 5: Git branch and uncommitted changes
try {
  const gitParts = [];

  try {
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (branch) gitParts.push(`Branch: ${branch}`);
  } catch {}

  try {
    const diffStat = execSync('git diff --stat', { cwd, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (diffStat) {
      const changedFiles = diffStat.split('\n').length - 1; // last line is summary
      if (changedFiles > 0) gitParts.push(`${changedFiles} uncommitted change${changedFiles > 1 ? 's' : ''}`);
    }
  } catch {}

  if (gitParts.length > 0) {
    messages.push(`[Git] ${gitParts.join(', ')}`);
  }
} catch {
  // Fault tolerance — ignore git detection errors
}

// --- Project Memory: prune expired and inject active memories ---
try {
  const pruned = pruneExpired(cwd);
  if (pruned > 0) {
    messages.push(`[Memory] Pruned ${pruned} expired project memor${pruned === 1 ? 'y' : 'ies'}.`);
  }
  const memoryCtx = formatMemoryContext(cwd);
  if (memoryCtx) {
    messages.push(memoryCtx);
  }
} catch {
  // Fault tolerance — ignore project memory errors
}

// --- .qe Sweep dry-run summary ---
try {
  const plan = sweepAnalyze(cwd);
  const line = sweepFormatSummary(plan);
  if (line) messages.push(line);
} catch {
  // Fault tolerance — sweep is advisory, never block session start
}

// --- GC (Garbage Collection) Freshness Check ---
try {
  const gcHistoryPath = join(cwd, '.qe', 'gc', 'gc-history.jsonl');
  if (existsSync(gcHistoryPath)) {
    const lines = readFileSync(gcHistoryPath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      const lastDate = new Date(lastEntry.timestamp);
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 14) {
      messages.push(`[GC] Last garbage collection was ${daysSince} days ago. Run ${skillCommand('Qgc')} to scan for code quality issues.`);
    }
    }
  } else {
    // Only suggest if project has source files (not a fresh init)
    const hasSources = existsSync(join(cwd, 'package.json')) || existsSync(join(cwd, 'go.mod')) || existsSync(join(cwd, 'Cargo.toml')) || existsSync(join(cwd, 'pyproject.toml'));
  if (hasSources) {
    messages.push(`[GC] No garbage collection history found. Run ${skillCommand('Qgc')} to scan for code quality debt.`);
  }
  }
} catch {
  // Fault tolerance
}

// --- Skill Budget Check ---
try {
  const skillsDir = join(cwd, 'skills');
  const budget = calculateSkillBudget(skillsDir);
  const check = checkBudgetOverflow(budget.estimatedTokens);
  if (check.overflow) {
    messages.push(`[QE] Skill budget overflow: ${budget.count} skills (~${budget.estimatedTokens} tokens estimated, ${check.pct}% of context). Consider merging low-use skills.`);
  }
} catch {
  // Fault tolerance — skill budget check is advisory, never block session start
}

// --- Mistake Registry: inject recorded mistakes so they are not repeated ---
try {
  const mistakePath = join(cwd, '.qe', 'MISTAKE.md');
  if (existsSync(mistakePath)) {
    const content = readFileSync(mistakePath, 'utf8');
    // Count entries and categorize by severity
    const entries = content.match(/^### M\d+:/gm) || [];
    const resolved = (content.match(/\[RESOLVED\]/g) || []).length;
    const active = entries.length - resolved;
    const critical = (content.match(/\*\*Severity\*\*:\s*critical/gi) || []).length;
    const important = (content.match(/\*\*Severity\*\*:\s*important/gi) || []).length;

    if (active > 0) {
      // Extract unresolved "Wrong" lines for quick injection
      const wrongLines = [];
      const lines = content.split('\n');
      let inResolved = false;
      for (const line of lines) {
        if (line.startsWith('### M') && line.includes('[RESOLVED]')) { inResolved = true; continue; }
        if (line.startsWith('### M') && !line.includes('[RESOLVED]')) { inResolved = false; }
        if (!inResolved && line.startsWith('- **Wrong**:')) {
          wrongLines.push(line.replace('- **Wrong**:', '').trim());
        }
      }
      // Truncate each entry — full text lives in .qe/MISTAKE.md (pointer below).
      // The injection only needs enough to recognize the pattern, not the full
      // postmortem; the long verbatim "Wrong" lines were a large per-session cost.
      const clip = (m) => (m.length > 140 ? m.slice(0, 139) + '…' : m);
      const topMistakes = wrongLines.slice(0, 5).map((m, i) => `  ${i + 1}. ${clip(m)}`).join('\n');
      messages.push(
        `[MISTAKES] ${active} active mistake(s) recorded (critical: ${critical}, important: ${important}). ` +
        `DO NOT repeat these:\n${topMistakes}\n  Full list: .qe/MISTAKE.md`
      );
    }
  }
} catch {
  // Fault tolerance — ignore mistake registry errors
}

// --- Learning Registry: inject the decay-ranked top-N learnings (Qlearn) ---
try {
  const learningsPath = join(cwd, '.qe', 'learnings.md');
  if (existsSync(learningsPath)) {
    const top = topLearnings(readFileSync(learningsPath, 'utf8'), 5);
    if (top.length > 0) {
      const clip = (s) => (s && s.length > 140 ? s.slice(0, 139) + '…' : s || '');
      const lines = top.map((l, i) => `  ${i + 1}. [${l.type}/${l.severity}] ${clip(l.learning)}`).join('\n');
      messages.push(
        `[LEARNINGS] Top ${top.length} by relevance (decay-ranked). Apply these:\n${lines}\n  Full list: .qe/learnings.md (manage via /Qlearn)`,
      );
    }
  }
} catch {
  // Fault tolerance — ignore learning registry errors
}

// Cleanup: Remove stale intent-route.json for clean session start
try {
  const intentRoutePath = join(cwd, '.qe', 'state', 'intent-route.json');
  if (existsSync(intentRoutePath)) {
    unlinkSync(intentRoutePath);
  }
} catch {
  // Fault tolerance — ignore cleanup errors
}

// Cleanup: Reap confirmed-zombie Codex jobs left by crashed background runs —
// status still "running" but the worker process is gone. Only process-dead jobs
// are auto-cancelled; weak (log-silent) signals are left for the user to judge.
try {
  const latestCodexJob = getLatestCodexJobStatus(cwd);
  const reap = reapStaleCodexJobs(cwd);
  if (reap.reaped.length) {
    messages.push(`[Codex] Auto-reaped ${reap.reaped.length} stale job(s) from crashed background runs`);
  }
  if (
    latestCodexJob.found &&
    latestCodexJob.stale &&
    latestCodexJob.staleKind === 'process-dead'
  ) {
    const state = readUnifiedState(cwd);
    if (state.codex_materialization?.status === 'running') {
      const now = new Date().toISOString();
      state.codex_materialization = {
        ...state.codex_materialization,
        status: 'crashed',
        checkedAt: now,
        crashedAt: now,
        source: 'session-start-reaper',
        pid: latestCodexJob.pid ?? state.codex_materialization.pid ?? null,
        jobId: latestCodexJob.jobId,
        stale: true,
        staleKind: latestCodexJob.staleKind,
        staleReason: latestCodexJob.staleReason || null,
        reaped: {
          jobId: latestCodexJob.jobId,
          reaped: reap.reaped.some((x) => x.id === latestCodexJob.jobId),
          reason: reap.reaped.find((x) => x.id === latestCodexJob.jobId)?.reason || null,
          errors: reap.errors.filter((x) => x.id === latestCodexJob.jobId),
        },
      };
      writeUnifiedState(cwd, state);
    }
  }
} catch {
  // Best-effort — never block session start on Codex reap.
}

try {
  const sessionSummary = summarizeSessionState(cwd, {
    sessionId: currentSessionId,
    sid: currentSid,
    codexJob: getLatestCodexJobStatus(cwd),
  });
  const line = formatSessionStateSummary(sessionSummary);
  if (line) messages.push(line);
} catch {
  // Best-effort — session state hints must never block SessionStart.
}

// Persist session_id so model-side skills (Qplan, Qgs, …) can bind their
// work to the Named Plan layout under .qe/planning/plans/{slug}/. Skills
// have no direct access to session_id; reading this file is the bridge.
// Last-write-wins per project — parallel Claude sessions overwrite each
// other's pointer, but each plan's own data lives under its slug dir.
//
// Claude Code's SessionStart payload does not always surface session_id
// directly; when missing we derive it from transcript_path, whose basename
// is always `{session_id}.jsonl`. Accept the value only when it parses as
// a UUID so a malformed path can't poison the pointer.
try {
  if (currentSessionId) {
    const stateDir = join(cwd, '.qe', 'state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'current-session.json'),
      JSON.stringify({ session_id: currentSessionId, startedAt: new Date().toISOString() }, null, 2)
    );
  }
} catch {
  // Fault tolerance — session-id persistence is best-effort
}

// Reset or initialize unified-state for fresh session tracking
try {
  const state = readUnifiedState(cwd);
  if (!state.session_stats) {
    state.session_stats = {
      tool_calls: 0,
      session_start: Date.now(),
      last_warning_at: 0,
      warning_severity: 'none',
      context_loaded: [],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 }
    };
  } else {
    // Session persistent stats - keep usage, but reset session-specific flags if needed
    state.session_stats.session_start = Date.now();
  }
  // Clear ContextMemo on session start so a fresh session's first read of any file
  // is never MEMO-blocked by another session's leftover cache. Correctness is
  // already guarded by mtime validation in isMemoValid; this reset is about
  // per-session freshness (a new session may run against externally-changed files).
  // Trade-off: in a shared unified-state.json, this wipes concurrent sessions'
  // cache — a lost re-read optimization, never a correctness issue (see DIAG C11).
  state.memo = { files: {}, meta: {}, total_size: 0, blocked_reads: 0 };
  writeUnifiedState(cwd, state);
} catch {
  // Fault tolerance — ignore reset errors
}

// --- SIVS loop-guard staleness sweep (Phase 3 / R005-R006) ---
// Drop loop counters idle beyond the max age so an abandoned run's stale counter
// never false-blocks a later legitimate run of a re-used UUID. Keyed on
// last-activity (updated_at), so an active at-limit run is preserved — never
// swept out from under itself (that would reopen the runaway). Own atomic
// read-modify-write; best-effort, once per session start.
try {
  const { sweepStale } = await import('./lib/loop-guard.mjs');
  const swept = sweepStale(cwd);
  if (swept > 0) messages.push(`[loop-guard] swept ${swept} stale SIVS loop counter(s).`);
} catch {
  // Fault tolerance — a sweep error must never block session start.
}

// --- R008: Minimal Bootstrap for clear/compact re-injection ---
// When source is 'clear' or 'compact', replace the full additionalContext with a
// compact bootstrap that covers the three essential constants. All state side effects
// (registry upsert, current-session.json, memo reset, invalidateCachedRatio, codex
// reaper) have already run above — they are unaffected by this output-only branch.
//
// Bootstrap content (3 items, total ≤ 2048 UTF-8 bytes):
//   1. OVERRIDE MAP summary — routing cues so Claude reaches for the skill first
//   2. Output style — 1-line reminder
//   3. MISTAKE notification — only when .qe/MISTAKE.md exists and is non-empty
//
// Re-injection pattern adapted from superpowers/using-superpowers (MIT).
function buildMinimalBootstrap(cwdPath, cmdPrefix) {
  const skillCmd = (name) => `${cmdPrefix}${name}`;
  const parts = [];

  // 1. OVERRIDE MAP summary
  parts.push(
    '[QE OVERRIDE MAP] Use the QE skill — PreToolUse HARD-BLOCKS direct git commit / version edits. ' +
    `manual commit → ${skillCmd('Qcommit')} · version/release → /Qrelease · ` +
    `context save → ${skillCmd('Qcompact')} · restore → ${skillCmd('Qresume')} · ` +
    `refresh → ${skillCmd('Qrefresh')} · show version → ${skillCmd('Qversion')} · ` +
    `archive tasks → ${skillCmd('Qgc')} archive. Full map: QE_CONVENTIONS.md.`
  );

  // 2. Output style (1 line)
  parts.push(
    '[QE OUTPUT STYLE] conclusion-first (결론→근거), separate 사실/추정, name the recommended option. ' +
    'NO 의식의 흐름·추임새·과장 — 정리된 결론만. See core/OUTPUT_STYLE.md.'
  );

  // 3. MISTAKE notification — only when file exists and is non-empty
  try {
    const mistakePath = join(cwdPath, '.qe', 'MISTAKE.md');
    if (existsSync(mistakePath)) {
      const mistakeContent = readFileSync(mistakePath, 'utf8').trim();
      if (mistakeContent.length > 0) {
        parts.push('[MISTAKES] Active mistakes recorded — read .qe/MISTAKE.md before acting.');
      }
    }
  } catch {
    // Fault tolerance — MISTAKE check is best-effort
  }

  return `[QE Framework] ${parts.join(' | ')}`;
}

if (isCompactionSource) {
  // clear/compact: emit minimal bootstrap only; all side effects already ran above.
  const bootstrap = buildMinimalBootstrap(cwd, COMMAND_PREFIX);
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: bootstrap
    }
  }) + '\n');
} else if (messages.length > 0) {
  // startup / resume / unknown: full injection (existing behavior, fail-open).
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `[QE Framework] ${messages.join(' | ')}`
    }
  }) + '\n');
} else {
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
}
