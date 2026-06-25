#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { countInbox as countWikiInbox } from './lib/wiki-status.mjs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from './lib/config.mjs';
import { atomicWriteJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { pruneExpired, formatMemoryContext } from './lib/project-memory.mjs';
import { analyze as sweepAnalyze, formatSummary as sweepFormatSummary } from './lib/sweep-analyzer.mjs';
import { shortenSid, getSessionContextDir } from './lib/session-resolver.mjs';
import { runAutoMigrations, summarizeReport } from './lib/legacy-migrator.mjs';
import { calculateSkillBudget, checkBudgetOverflow } from './lib/skill-budget.mjs';
import { invalidateCachedRatio, readDetectedLimit, writeCachedLimit } from './lib/context-meter.mjs';

// Read stdin (Claude Code provides JSON with cwd, session_id, etc.)
let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
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

const cwd = data.cwd || data.directory || process.cwd();
const cfg = loadConfig(cwd);
const messages = [];

// Drop any stale context-usage ratio cached by the statusline before this
// session began. The cache is project-global with a 60s TTL; after a `/clear`
// (or resume/startup) it can still hold the previous conversation's high
// percentage, which would make context-guard / context-monitor raise false
// context-pressure on the fresh, near-empty session. Removing it forces those
// hooks to fall back to transcript-based estimation (the real state). The
// window limit (200k vs 1M) is preserved — it's model-constant across /clear.
try {
  invalidateCachedRatio(cwd);
} catch {
  // Fault tolerance — never block session start on cache housekeeping.
}

// Seed the volatile window limit from the DURABLE, model-keyed detection (if any)
// recorded in a prior session. This closes the cold-start window: after a
// state-folder wipe the cache has no limit, and before the first statusline
// render nothing has re-derived it, so a 1M run would momentarily score against
// the 200k default and could raise false context-pressure on the very first
// tool calls. Seeding from .qe/config.json (which survives the wipe) prevents it.
try {
  const detected = readDetectedLimit(cwd, data.model?.id || data.model);
  if (detected) writeCachedLimit(cwd, detected);
} catch {
  // Fault tolerance — seeding is best-effort.
}

// Compute this Claude session's short sid up front so per-session paths
// (snapshot, handoff, decisions) and the additionalContext announcement all
// agree. Falls back to '_unknown' bucket downstream if sid is missing.
const currentSid = shortenSid(data.session_id || data.sessionId);

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
// the `[Session] sid:XXXXXXXX` marker in additionalContext.
if (currentSid) {
  messages.push(`[Session] sid:${currentSid}`);
}

// Surface a one-line summary when auto-migration moved anything, so the
// user sees what changed and can run /Qmigrate-legacy for the full report.
if (migrationSummary) {
  messages.push(migrationSummary + ' Run /Qmigrate-legacy for details.');
}

// Check 1: project instruction artifact existence (Qinit check)
const instructionCandidates = [
  join(cwd, 'CLAUDE.md'),
  join(cwd, 'AGENTS.md')
];
const hasInstructionArtifact = instructionCandidates.some(filePath => existsSync(filePath));
if (!hasInstructionArtifact) {
  messages.push('QE framework not initialized. Run `/Qinit` first.');
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
    messages.push('[QE] Project analysis looks stale — /Qrefresh would give you fresher context to work from.');
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
      messages.push('Previous session context saved. Restore with `/Qresume`.');
    }
  }
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
    'direct git commit / version edits. manual commit → /Qcommit · version bump → /Mbump · ' +
    'show version → /Qversion · context save → /Qcompact · restore → /Qresume · ' +
    'archive tasks → /Qarchive · refresh analysis → /Qrefresh.' + fullMapPointer
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
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
    if (branch) gitParts.push(`Branch: ${branch}`);
  } catch {}

  try {
    const diffStat = execSync('git diff --stat', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
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

// --- Qwiki inbox queue (only when .qe/wiki exists with uncompiled sources) ---
try {
  const uncompiled = countWikiInbox(cwd); // shallow readdir, no recursion, 0 when absent
  if (uncompiled > 0) {
    messages.push(`[Wiki] ${uncompiled} uncompiled source${uncompiled > 1 ? 's' : ''} in .qe/wiki/inbox — run /Qwiki-compile.`);
  }
} catch {
  // Fault tolerance — wiki status is advisory, never block session start
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
      if (daysSince >= 7) {
        messages.push(`[GC] Last garbage collection was ${daysSince} days ago. Run /Qgc to scan for code quality issues.`);
      }
    }
  } else {
    // Only suggest if project has source files (not a fresh init)
    const hasSources = existsSync(join(cwd, 'package.json')) || existsSync(join(cwd, 'go.mod')) || existsSync(join(cwd, 'Cargo.toml')) || existsSync(join(cwd, 'pyproject.toml'));
    if (hasSources) {
      messages.push('[GC] No garbage collection history found. Run /Qgc to scan for code quality debt.');
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

// Cleanup: Remove stale intent-route.json for clean session start
try {
  const intentRoutePath = join(cwd, '.qe', 'state', 'intent-route.json');
  if (existsSync(intentRoutePath)) {
    unlinkSync(intentRoutePath);
  }
} catch {
  // Fault tolerance — ignore cleanup errors
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
  let sessionId = data.session_id || data.sessionId || null;
  if (!sessionId && typeof data.transcript_path === 'string') {
    const base = data.transcript_path.split('/').pop() || '';
    const candidate = base.replace(/\.jsonl$/, '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
      sessionId = candidate;
    }
  }
  if (sessionId) {
    const stateDir = join(cwd, '.qe', 'state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'current-session.json'),
      JSON.stringify({ session_id: sessionId, startedAt: new Date().toISOString() }, null, 2)
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
  writeUnifiedState(cwd, state);
} catch {
  // Fault tolerance — ignore reset errors
}

if (messages.length > 0) {
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
