#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from './lib/qe-fs.mjs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { readState, readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import {
  captureAbnormalWorkerExit,
  captureFailureQuietly,
  findAbnormalWorkerExit,
} from './lib/failure-capture.mjs';
import { isPersistentModeActiveFromState } from './lib/persistent-mode.mjs';
import {
  readRalphState,
  cleanupRalphState,
  checkRateLimit,
  formatProgressMessage,
  generateReport,
} from './lib/ralph-state.mjs';
import { parseChecklist } from './lib/checklist-parser.mjs';
import { analyze as sweepAnalyze } from './lib/sweep-analyzer.mjs';
import { execute as sweepExecute, executeVolatileOnly as sweepVolatileOnly } from './lib/sweep-executor.mjs';
import { extractLastAssistantText, scanStyleViolations, judgeStyle, loadStyleRubric } from './lib/style-gate.mjs';
import { readClaudeOAuthToken } from './lib/claude-token.mjs';
import { isCompletionClaim, evaluateEvidenceGate, parseSameTurnEvents } from './lib/verification-evidence-gate.mjs';
import { shortenSid } from './lib/session-resolver.mjs';
import { cleanupStaleSessions, removeSession } from './lib/session-registry.mjs';
import { openStore } from './lib/store.mjs';
import { deliverOnce } from './lib/delivery-ledger.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || getCwd(data);
const cfg = loadConfig(cwd);
const sessionId = data.session_id || null;
const currentSid = shortenSid(sessionId || data.sessionId || null);

try {
  cleanupStaleSessions(cwd);
} catch {
  // Fault tolerance — registry cleanup must never block Stop.
}

/**
 * Remove the current session from the registry when a stop is being allowed.
 * Falls back to a full stale-session sweep when no current session id is known.
 * Fault-tolerant: any error is silently swallowed so registry cleanup never blocks
 * an otherwise-clean shutdown.
 */
function cleanupRegistryForAllowedStop() {
  try {
    deliverOnce(cwd, {
      eventType: 'Stop', payload: data, effect: 'allowed-stop-registry-cleanup',
      run: () => {
        try {
          if (currentSid) removeSession(cwd, currentSid);
          else cleanupStaleSessions(cwd);
        } catch {}

        // Mirror the removal into the store (ADR-027 P2).
        try {
          if (currentSid) {
            const store = openStore(cwd, { sessionId: currentSid });
            try { store.endSession(currentSid); } finally { store.close(); }
          }
        } catch {}
      },
    });
  } catch {
    // Fault tolerance — registry cleanup is retryable on replay and never blocks shutdown.
  }
}

// --- .qe sweep (auto-apply when cfg.sweep_auto, else volatile-only) ---
// Archive moves use deterministic signals (completed/ folders, fully-checked pairs,
// filename-embedded dates). Files go to .archive/vX.Y.Z/ — recoverable, not deleted.
// Opt-out: .qe/config.json { "hooks": { "sweep_auto": false } }
let sweepAnnouncement = null;
try {
  const delivery = deliverOnce(cwd, {
    eventType: 'Stop', payload: data, effect: 'qe-sweep',
    run: () => {
      const plan = sweepAnalyze(cwd);
      if (cfg.sweep_auto && (plan.archive.length > 0 || plan.delete.length > 0)) {
        const res = sweepExecute(cwd, plan, { apply: true });
        const parts = [];
        if (res.moved.length > 0) parts.push(`archived ${res.moved.length} → .qe/.archive/${res.version}`);
        if (res.deleted.length > 0) parts.push(`purged ${res.deleted.length} volatile`);
        return parts.length > 0 ? `[QE Sweep] ${parts.join(', ')}` : null;
      }
      if (plan.delete.length > 0) sweepVolatileOnly(cwd, plan);
      return null;
    },
  });
  sweepAnnouncement = delivery.status === 'delivered' ? delivery.value : null;
} catch {
  // Fault tolerance — failed sweep delivery remains retryable on replay.
}

// --- Ralph Mode Check (highest priority) ---
// Ralph mode: auto-loops PSE Chain until VERIFY_CHECKLIST is fully complete.
// Uses checklist completion as the stop criterion, protected by rate limit + circuit breaker.
let ralphActive = false;
let ralphBlockReason = null;
try {
  const ralphState = readRalphState(cwd);
  if (ralphState && ralphState.enabled && ralphState.taskSource) {
    // Check all safety limits first
    const rateCheck = checkRateLimit(cwd);
    const cb = ralphState.circuitBreaker || {};
    const cbTripped = (cb.consecutiveFailures || 0) >= (cb.maxConsecutiveFailures || 3);
    if (!rateCheck.allowed) {
      // Rate limit hit → abort loop with warning
      process.stderr.write(`[Ralph] Rate limit exceeded (${rateCheck.remaining}/h). Loop aborted. Resets in ${Math.round(rateCheck.resetIn/60000)}min.\n`);
      generateReport(cwd);
      cleanupRalphState(cwd);
    } else if (cbTripped) {
      // Circuit breaker tripped → abort loop with error
      process.stderr.write(`[Ralph] Circuit breaker tripped (${cb.consecutiveFailures} consecutive failures). Aborting loop.\n`);
      generateReport(cwd);
      cleanupRalphState(cwd);
    } else {
      // Check VERIFY_CHECKLIST completion
      const parsed = parseChecklist(ralphState.taskSource);
      if (parsed.total > 0 && parsed.remaining === 0) {
        // All items complete → final report + cleanup + allow stop
        process.stderr.write(`[Ralph] Complete — ${parsed.completed}/${parsed.total} tasks done\n`);
        generateReport(cwd);
        cleanupRalphState(cwd);
      } else if (parsed.total === 0) {
        // Checklist file missing or empty → safety abort
        process.stderr.write(`[Ralph] Checklist not readable (${ralphState.taskSource}). Aborting loop.\n`);
        cleanupRalphState(cwd);
      } else {
        // Items still remaining → block stop and reinforce
        ralphActive = true;
        const progressMsg = formatProgressMessage(cwd);
        ralphBlockReason = `[QE Ralph] ${progressMsg} — Continue with next remaining item from ${ralphState.taskSource}. Do not stop.`;
      }
    }
  }
} catch {
  // Fault tolerance — never let Ralph check crash the stop handler
}

if (ralphActive && ralphBlockReason) {
  console.log(JSON.stringify({
    continue: false,
    decision: "block",
    reason: ralphBlockReason
  }));
  process.exit(0);
}

// Check QE modes in priority order (ultra modes first)
const modes = [
  { name: 'ultrawork', label: 'Ultra Work — autonomous parallel execution in progress' },
  { name: 'ultraqa', label: 'Ultra QA — autonomous quality verification in progress' },
  { name: 'qexecute', label: 'Qexecute executing' },
];

let activeMode = null;
for (const mode of modes) {
  const state = readState(cwd, mode.name, sessionId);
  if (state) {
    activeMode = mode;

    // Check reinforcement count to prevent infinite loops
    const maxReinforcements = state.max_reinforcements || cfg.max_reinforcements;
    const reinforcements = state.reinforcement_count || 0;

    if (reinforcements >= maxReinforcements) {
      // Max reached, allow stop
      activeMode = null;
    }
    break;
  }
}

// --- Persistent Mode Check (unified-state.json) ---
// Persistent mode is a separate mechanism from the mode-state files above.
// It protects multi-step pipelines (SIVS loops, Wave execution, Qexecute)
// from premature stopping even when no dedicated *-state.json file exists.
if (!activeMode) {
  try {
    const unifiedState = readUnifiedState(cwd);
    const pm = isPersistentModeActiveFromState(unifiedState);
    if (pm.active) {
      // Increment reinforcement counter
      if (unifiedState.persistentMode) {
        const reinforcements = (unifiedState.persistentMode.reinforcements || 0) + 1;
        const maxReinforcements = cfg.max_reinforcements || 5;

        if (reinforcements < maxReinforcements) {
          unifiedState.persistentMode.reinforcements = reinforcements;
          try { writeUnifiedState(cwd, unifiedState); } catch {}
          activeMode = {
            name: 'persistent-mode',
            label: `Persistent Mode (${pm.mode}) — ${pm.reason}`
          };
        } else {
          // Max reinforcements reached — auto-exit persistent mode to prevent infinite loops
          delete unifiedState.persistentMode;
          try { writeUnifiedState(cwd, unifiedState); } catch {}
        }
      }
    }
  } catch {
    // Fault tolerance — never let persistent mode check crash the stop handler
  }
}

// --- Abnormal Worker Exit Capture / Retry ---
// Worker OOM/SIGKILL exits are captured before the generic failure snapshot.
// The first occurrence blocks Stop with a retry instruction; repeated exits are
// left in agent-errors.json for the existing failure-capture/reporting path.
try {
  const workerExit = findAbnormalWorkerExit(data);
  if (workerExit) {
    const taskUuid = data.taskUuid || data.task_uuid || data.uuid || workerExit.taskUuid || workerExit.task_uuid || null;
    const workerId = data.workerId || data.worker_id || workerExit.workerId || workerExit.worker_id || null;
    const itemId = data.itemId || data.item_id || workerExit.itemId || workerExit.item_id || null;
    const captured = captureAbnormalWorkerExit(cwd, workerExit, { taskUuid, workerId, itemId });

    if (captured.shouldRetry) {
      const workerLabel = captured.entry.workerId || captured.entry.itemId || 'worker';
      console.log(JSON.stringify({
        continue: false,
        decision: 'block',
        reason: `[QE Worker Retry] ${workerLabel} exited with ${captured.entry.exitCode || captured.entry.signal}. Retry this worker once, then continue wave synthesis.`,
      }));
      process.exit(0);
    }
  }
} catch {
  // Fault tolerance — worker exit capture must never crash Stop.
}

// --- Codex Materialization Crash Capture / Retry ---
// A confirmed process-dead companion is terminal and should use the same
// one-retry counter as OOM/SIGKILL worker exits. PID-unknown timeout cases are
// intentionally excluded so the existing ask/fallback behavior remains intact.
try {
  let materialization = null;
  try {
    materialization = readUnifiedState(cwd).codex_materialization || null;
  } catch {}

  if (!materialization || materialization.status !== 'crashed') {
    const signalPath = join(cwd, '.qe', 'agent-results', 'codex-ready.signal');
    if (existsSync(signalPath)) {
      try {
        const signal = JSON.parse(readFileSync(signalPath, 'utf8'));
        if (signal?.crashed === true || signal?.status === 'crashed') {
          materialization = { ...signal, status: 'crashed', source: 'signal' };
        }
      } catch {}
    }
  }

  if (materialization?.status === 'crashed') {
    const taskUuid =
      data.taskUuid ||
      data.task_uuid ||
      data.uuid ||
      materialization.taskUuid ||
      materialization.task_uuid ||
      null;
    const workerId =
      data.workerId ||
      data.worker_id ||
      materialization.workerId ||
      materialization.worker_id ||
      'codex-rescue';
    const itemId =
      data.itemId ||
      data.item_id ||
      materialization.itemId ||
      materialization.item_id ||
      materialization.jobId ||
      'codex-materialization';
    const captured = captureAbnormalWorkerExit(cwd, materialization, {
      taskUuid,
      workerId,
      itemId,
      source: 'codex-materialization',
      message: materialization.error || materialization.message || 'Codex companion process died before materialization',
    });

    if (captured.shouldRetry) {
      console.log(JSON.stringify({
        continue: false,
        decision: 'block',
        reason: `[QE Codex Retry] Codex companion crashed before materialization${captured.entry.pid ? ` (pid ${captured.entry.pid})` : ''}. Retry Codex once through the existing SIVS/Codex route, then continue materialization check.`,
      }));
      process.exit(0);
    }

    if (captured.captured) {
      console.log(JSON.stringify({
        continue: false,
        decision: 'block',
        reason: '[QE Codex Fallback] Codex companion crashed before materialization and the one automatic retry for this task/worker/item has already been used. Keep the crash in .qe/state/agent-errors.json and fallback through the existing SIVS route.',
      }));
      process.exit(0);
    }
  }
} catch {
  // Fault tolerance — Codex crash capture must never crash Stop.
}

// --- Failure Capture ---
if (!activeMode) {
  try {
    captureFailureQuietly(cwd);
  } catch {
    // Fault tolerance — never let failure capture crash the stop handler
  }
}

// --- Satisfaction Signal (opt-in) ---
// Only prompts when satisfaction_enabled is true in .qe/config.json
// appendRating(cwd, score) is called by /Qrating skill to persist to ratings.jsonl
// Stop hook schema only allows systemMessage; hookSpecificOutput is rejected here.
if (!activeMode && cfg.satisfaction_enabled) {
  try {
    cleanupRegistryForAllowedStop();
    console.log(JSON.stringify({
      continue: true,
      systemMessage: [
        '[QE Satisfaction] 이번 세션은 어떠셨나요? 만족도를 알려주세요 (1-5).',
        '1=매우 불만족 2=불만족 3=보통 4=만족 5=매우 만족.',
        '"rating 4" 라고 입력하면 .qe/learning/signals/ratings.jsonl 에 기록됩니다.',
        'opt-out: .qe/config.json 에서 "satisfaction_enabled": false 설정',
      ].join(' '),
    }));
    process.exit(0);
  } catch {
    // Fault tolerance — never let rating prompt crash the stop handler
  }
}

// --- Shared last-assistant-text extraction (F2: shared text for all three gates) ---
// Claude and Codex provide the final assistant message directly. Use that hot-path
// field first and retain transcript extraction only as a compatibility fallback.
// (code-risk, style, evidence) consume `lastText` from this single call.
// The evidence gate additionally needs the raw same-turn events; those are parsed once
// from `data.transcript_path` inside the evidence gate block via parseSameTurnEvents.
// Total transcript reads per stop: at most 2 — extractLastAssistantText (fallback)
// and parseSameTurnEvents (full pass for event objects).  Unifying to a single pass is
// a deferred optimization; style-gate.mjs's extractLastAssistantText is path-based and
// not trivially composable with parseSameTurnEvents without a shared JSONL reader.
let lastText = null;
if (!activeMode && (cfg.code_risk_stop_gate !== false || cfg.style_gate !== false || cfg.verification_evidence_gate !== false)) {
  try {
    lastText = typeof data.last_assistant_message === 'string'
      ? data.last_assistant_message
      : extractLastAssistantText(data.transcript_path);
  } catch {
    // Fail-open — a read failure must never crash the stop handler.
  }
}

// --- OUTPUT_STYLE response gate (ADR-025 R3) ---
// 2-stage: Stage-1 structural/candidate scan (cost 0) → only on a trip, Stage-2
// Haiku judge against core/OUTPUT_STYLE.md. Blocks the stop with a rewrite
// instruction on a SEVERE verdict. Loop guard: never re-block identical text, and at
// most style_gate_max_blocks distinct blocks per rolling window. Fail-open throughout.
if (!activeMode && cfg.code_risk_stop_gate !== false) {
  try {
    const text = lastText;
    const gate = evaluateCodeRiskReportGate(cwd, text);
    if (gate.block) {
      const st = readUnifiedState(cwd);
      const rg = st.codeRiskReportGate || {};
      const hash = styleHash(text || '');
      if (rg.lastHash === hash) {
        delete st.codeRiskReportGate;
        try { writeUnifiedState(cwd, st); } catch {}
      } else {
        st.codeRiskReportGate = { lastHash: hash, missing: gate.missing, at: new Date().toISOString() };
        try { writeUnifiedState(cwd, st); } catch {}
        console.log(JSON.stringify({
          continue: false,
          decision: 'block',
          reason: `[QE Code Risk] Code completion report is missing: ${gate.missing.join(', ')}. Rewrite with Facts/사실, Verification/검증, Residual Risks/남은 리스크, and Assumptions/추정. If none, state none explicitly.`,
        }));
        process.exit(0);
      }
    }
  } catch {
    // Fault tolerance — the code-risk stop gate must never crash Stop.
  }
}

if (!activeMode && cfg.style_gate !== false) {
  try {
    const text = lastText;
    const scan = scanStyleViolations(text);
    if (scan.tripped && text) {
      const st = readUnifiedState(cwd);
      const sg = st.styleGate || {};
      const hash = styleHash(text);
      const now = Date.now();
      const windowMs = cfg.style_gate_window_ms || 10 * 60 * 1000;
      const maxBlocks = cfg.style_gate_max_blocks || 2;

      // Rolling window reset
      let count = sg.count || 0;
      let windowStart = sg.windowStart || now;
      if (now - windowStart > windowMs) { count = 0; windowStart = now; }

      const sameText = sg.lastHash === hash;
      if (sameText) {
        // Already blocked this exact text — model isn't fixing it (or judge erred).
        // Allow stop to avoid an infinite loop; clear the marker.
        delete st.styleGate;
        try { writeUnifiedState(cwd, st); } catch {}
      } else if (count >= maxBlocks) {
        // Hit the per-window cap — give up, allow stop, warn on stderr.
        process.stderr.write(`[QE Style] Gate gave up after ${count} blocks this window. Allowing stop.\n`);
        delete st.styleGate;
        try { writeUnifiedState(cwd, st); } catch {}
      } else {
        const rubric = loadStyleRubric(cwd);
        const verdict = await judgeStyle(text, { rubric, tokenProvider: readClaudeOAuthToken });
        if (verdict.severe) {
          st.styleGate = { lastHash: hash, count: count + 1, windowStart };
          try { writeUnifiedState(cwd, st); } catch {}
          console.log(JSON.stringify({
            continue: false,
            decision: 'block',
            reason: `[QE Style] ${verdict.reason || '응답 문체 위반'} — core/OUTPUT_STYLE.md 위반. 다음 행동으로 시작하고 현재 상태를 밝힌 뒤, 목록은 5개 이하로 유지하고 구체적인 다음 단계 하나로 끝내라. 서론·곁가지·반복 요약·형식적 맺음말은 제거하라.`,
          }));
          process.exit(0);
        } else if (sg.lastHash) {
          // Judged clean → clear any stale marker so a later clean turn starts fresh.
          delete st.styleGate;
          try { writeUnifiedState(cwd, st); } catch {}
        }
      }
    }
  } catch {
    // Fault tolerance — the style gate must never crash the stop handler.
  }
}

// --- Verification-Evidence Gate (R005) ---
// Placement rationale (F2 — read-count):
//   - `lastText` is extracted exactly once above, before the code-risk gate, and
//     shared by all three gates (code-risk, style, evidence).  No gate calls
//     extractLastAssistantText again.
//   - The raw same-turn events are parsed exactly once here (parseSameTurnEvents),
//     and passed into evaluateEvidenceGate via the `parsedEvents` parameter, so the
//     lib function does not perform an additional readFileSync internally.
//   - Total transcript reads per stop: 2 — one in extractLastAssistantText above,
//     one in parseSameTurnEvents below.  Unifying to 1 pass is a deferred optimization;
//     style-gate.mjs's API is path-based and cannot share a JSONL parse cheaply.
//   - Runs AFTER code-risk and style gates so all three share the single `lastText`.
//   - Runs BEFORE sweepAnnouncement early-exit so a sweep-only stop still triggers
//     WARN when evidence is missing.  In warn mode, sweepAnnouncement is merged into
//     the same systemMessage so the process.exit does not suppress sweep output (F4).
//   - The satisfaction_enabled path exits before this gate; those sessions skip checking.
//
// Repeat guard: uses a separate state slot keyed by reason id
// ('verification-evidence-missing'), distinct from styleGate.lastHash.
// One-pass-after-same-reason: if the same reason fired last stop, allow this stop
// and clear the marker (loop-prevention mirrors the style-gate pattern).
// WARN mode: the guard arms ONLY on block decisions (F4). Warn mode emits its
// systemMessage advisory every eligible stop without being suppressed by the guard.
if (!activeMode && cfg.verification_evidence_gate !== false) {
  try {
    // Parse same-turn events once; pass them to evaluateEvidenceGate to avoid a
    // second full readFileSync of the transcript inside the lib.
    const evSameTurnEvents = parseSameTurnEvents(data.transcript_path);

    // F3: compute changedCodeFiles once here, pass as a cached closure so the lib
    // does not spawn its own duplicate git processes.  The code-risk gate (above)
    // already calls changedCodeFiles() independently via evaluateCodeRiskReportGate;
    // this second call is unavoidable until both gates share a single computed value.
    // The closure ensures the lib never re-spawns beyond this one call.
    const cachedFiles = changedCodeFiles(cwd);
    const cachedFilesFn = () => cachedFiles;

    const eg = evaluateEvidenceGate(cwd, lastText, data.transcript_path, cachedFilesFn, evSameTurnEvents);
    if (eg.fire) {
      if (cfg.verification_evidence_gate === 'block') {
        // Block mode: repeat guard prevents infinite loops — if the same reason fired
        // last stop, let this stop through and clear the marker (guard arms on block only).
        const st = readUnifiedState(cwd);
        const evGate = st.verificationEvidenceGate || {};
        const sameReason = evGate.lastReason === eg.reason;

        if (sameReason) {
          // Same reason already blocked once — allow stop (loop guard), clear marker.
          delete st.verificationEvidenceGate;
          try { writeUnifiedState(cwd, st); } catch {}
        } else {
          // Record the reason so the next identical stop is let through.
          st.verificationEvidenceGate = { lastReason: eg.reason, at: new Date().toISOString() };
          try { writeUnifiedState(cwd, st); } catch {}
          console.log(JSON.stringify({
            continue: false,
            decision: 'block',
            reason: '[QE Evidence] 현재 턴에 검증 명령 실행 증거가 없습니다. npm run qe:validate, node scripts/check-all.mjs, 또는 node --test <path>를 실행하고 결과를 확인한 뒤 다시 완료를 보고하세요.',
          }));
          process.exit(0);
        }
      } else {
        // Warn mode: the repeat guard is NOT armed — advisory fires every eligible stop.
        // F4: merge sweepAnnouncement here so the process.exit does not suppress it.
        // If sweep ran this stop, both messages are emitted in a single systemMessage.
        const warnMsg = '[QE Evidence] 현재 턴에 검증 명령(npm run qe:validate / node scripts/check-all.mjs / node --test) 실행 증거를 찾지 못했습니다. 코드 변경이 있을 때는 허용 명령을 실행하고 결과를 확인하세요.';
        const combinedMsg = sweepAnnouncement ? `${sweepAnnouncement} | ${warnMsg}` : warnMsg;
        cleanupRegistryForAllowedStop();
        console.log(JSON.stringify({
          continue: true,
          systemMessage: combinedMsg,
        }));
        process.exit(0);
      }
    }
  } catch {
    // Fault tolerance — the evidence gate must never crash Stop.
  }
}

if (!activeMode && sweepAnnouncement) {
  cleanupRegistryForAllowedStop();
  console.log(JSON.stringify({ continue: true, systemMessage: sweepAnnouncement }));
  process.exit(0);
}

if (activeMode) {
  // Block stop and force continuation
  console.log(JSON.stringify({
    continue: false,
    decision: "block",
    reason: `[QE Framework] ${activeMode.label}. Continuing work.`
  }));
} else {
  // No active mode, allow stop
  cleanupRegistryForAllowedStop();
  console.log(JSON.stringify({ continue: true }));
}

/**
 * Stable, dependency-free string hash (djb2) for the style-gate loop guard.
 * Identifies "the same blocked text" across consecutive stops without pulling in crypto.
 */
function styleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Decide whether the final assistant report for changed code needs risk labels.
 * The gate is intentionally narrow: it only trips on completion-like text and a
 * local code diff, so ordinary non-code stops and mid-task pauses remain free.
 *
 * completionLike detection is delegated to {@link isCompletionClaim} from
 * verification-evidence-gate.mjs (shared lib, no parallel matcher).
 * That function applies word-boundary / Korean clause-boundary matching and strips
 * code-fence / quote embedding — fixing the former unbounded-substring defect that
 * would false-match "incomplete" or "not completed".
 *
 * @param {string} cwd  - Working directory for git diff.
 * @param {string} text - Last assistant text (already extracted by caller).
 * @returns {{ block: boolean, missing: string[] }}
 */
function evaluateCodeRiskReportGate(cwd, text) {
  if (!text || typeof text !== 'string') return { block: false, missing: [] };

  // Use shared isCompletionClaim — word-boundary aware, negation-safe, strips fences.
  // This replaces the former inline unbounded regex that would false-match "incomplete".
  if (!isCompletionClaim(text)) return { block: false, missing: [] };

  const files = changedCodeFiles(cwd);
  if (files.length === 0) return { block: false, missing: [] };

  const required = [
    { label: 'Facts/사실', re: /(^|\n)\s*(#{1,6}\s*)?(Facts?|사실)\s*[:：]?\s*(\n|$)/i },
    { label: 'Verification/검증', re: /(^|\n)\s*(#{1,6}\s*)?(Verification|Verified|Tests?|검증|테스트)\s*[:：]?\s*(\n|$)/i },
    { label: 'Residual Risks/남은 리스크', re: /(^|\n)\s*(#{1,6}\s*)?(Residual Risks?|Remaining Risks?|Risks?|남은\s*리스크|잔여\s*리스크|리스크)\s*[:：]?\s*(\n|$)/i },
    { label: 'Assumptions/추정', re: /(^|\n)\s*(#{1,6}\s*)?(Assumptions?|Unverified Assumptions?|추정|미검증\s*추정)\s*[:：]?\s*(\n|$)/i },
  ];
  const missing = required.filter(item => !item.re.test(text)).map(item => item.label);
  return { block: missing.length > 0, missing };
}

/**
 * Return the list of code-like files that are currently changed in the working
 * directory (unstaged, staged, or untracked). Used as a gate precondition: when
 * the list is empty the completion gates are skipped so doc-only and empty-diff
 * turns are never incorrectly blocked.
 *
 * @param {string} cwd - Working directory passed to git commands.
 * @returns {string[]} Relative file paths whose extension matches a code pattern.
 */
function changedCodeFiles(cwd) {
  const commands = [
    ['git', ['diff', '--name-only']],
    ['git', ['diff', '--name-only', '--cached']],
    ['git', ['ls-files', '--others', '--exclude-standard']],
  ];
  const names = new Set();
  for (const [cmd, args] of commands) {
    try {
      const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 3000 });
      const out = result.stdout || '';
      for (const line of out.split('\n')) {
        const name = line.trim();
        if (name) names.add(name);
      }
    } catch {}
  }
  const codeLike = /\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte)$/i;
  return [...names].filter(name => codeLike.test(name));
}
