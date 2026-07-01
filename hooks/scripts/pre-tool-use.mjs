#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadConfig } from './lib/config.mjs';
import { atomicWriteJson, readUnifiedState, writeUnifiedState, getContextMemo, isMemoValid, incrementBlockedReads, getBlockedReads } from './lib/state.mjs';
import { emitBlock } from './lib/block-emitter.mjs';
import { executableView, matchesExecutable } from './lib/shell-scanner.mjs';
import { BUILD_BLOCK_MESSAGE, checkBuildAdmission, isHeavyBuildCommand } from './lib/build-admission.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Fail-open safety net ---
// Any unexpected error in this hook must NOT block the user's tool call. Intentional
// hard-blocks go through emitBlock() → process.exit(2), which bypasses these handlers
// (process.exit is not a throw). Only genuine bugs land here, and they fail open (allow).
function failOpen() {
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  process.exit(0);
}
process.on('uncaughtException', failOpen);
process.on('unhandledRejection', failOpen);

let input = '';
try {
  // Read fd 0 directly. `/dev/stdin` re-opens the pipe and can read empty on Linux CI
  // (a known gotcha); reading the fd is portable across macOS and Linux runners.
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const rootToolInput = data.tool_input || data.toolInput || {};
const cwd = data.cwd || data.directory || rootToolInput.workdir || rootToolInput.cwd || process.cwd();
const cfg = loadConfig(cwd);
const toolName = data.tool_name || data.toolName || '';
const hints = [];
let mutatedInput = null;
const COMMAND_PREFIX = process.env.QE_COMMAND_PREFIX || '/';
const skillCommand = (name) => `${COMMAND_PREFIX}${name}`;
const ADMIN_VERSION_CAPABILITY = 'qe-admin-version';
const ADMIN_VERSION_ACTION = 'Use qe-admin-mcp release/bump admin workflow instead.';

// --- Load Unified State (Single I/O call) ---
const state = readUnifiedState(cwd);

function readStandaloneUtopiaState(root) {
  const filePath = join(root, '.qe', 'state', 'utopia-state.json');
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed && parsed.enabled === true) return parsed;
  } catch {
    return null;
  }
  return null;
}

function isShellTool(name) {
  return ['Bash', 'Shell', 'shell', 'exec_command'].includes(name);
}

// --- ContextMemo Enforcement (Hard Block on redundant reads) ---
if (toolName === 'Read') {
  const toolInput = data.tool_input || data.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (filePath && isMemoValid(state, filePath)) {
    // File was previously read and has NOT been modified since — block the redundant read
    const blockedCount = incrementBlockedReads(state);
    // Persist state before exiting so the counter is saved
    try { writeUnifiedState(cwd, state); } catch {}
    emitBlock({
      skill: '_memo',
      reason: `MEMO HIT: ${filePath} — cached content available`,
      action: `Use the content from your earlier read of this file. (${blockedCount} reads blocked this session)`,
    });
  }
}

if (!state.session_stats) {
  state.session_stats = {
    tool_calls: 0,
    session_start: Date.now(),
    context_loaded: [],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 }
  };
}
const stats = state.session_stats;
if (!stats.usage) {
  stats.usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
}

const toolCalls = stats.tool_calls || 0;

// --- Increment tool call counter ---
stats.tool_calls = toolCalls + 1;
stats.last_tool = toolName;
stats.last_call = Date.now();

// --- FAST PATH: skip expensive checks after initial calls ---
const isFirstCall = toolCalls <= 1;
const isEarlySession = toolCalls <= 5;

// --- Intent Gate Routing ---
if (isEarlySession) {
  if (isFirstCall) {
    hints.push('[INTENT GATE] User intent will be auto-classified by UserPromptSubmit hook.');
  }

  const route = state.intent_route;
  if (route && route.routed_to && route.intent) {
    if (route.confidence_level === 'HIGH') {
      hints.push(`SKILL REQUIRED: You MUST invoke /${route.routed_to} before responding. (intent: ${route.intent})`);
    } else {
      hints.push(`Skill suggested: /${route.routed_to} may be relevant. (intent: ${route.intent}, confidence: MEDIUM)`);
    }
  }
}

// --- Pending Feedback Follow-up ---
const fb = state.pending_feedback;
if (fb) {
  const ageMs = Date.now() - new Date(fb.detected_at).getTime();
  if (fb.acted || ageMs > 10 * 60 * 1000) {
    delete state.pending_feedback;
  } else {
    hints.push(`[FEEDBACK PENDING] Unresolved user feedback: "${fb.message.slice(0, 100)}". Save to auto-memory as feedback type. Then update .qe/state/pending-feedback.json with acted:true.`);
  }
}

// --- Skill Usage Tracking + SIVS Skill Entry Guard ---
if (toolName === 'Skill') {
  const skillInput = data.tool_input || data.toolInput || {};
  const skillName = skillInput.skill || '';
  if (skillName) {
    if (!Array.isArray(stats.skills_used)) stats.skills_used = [];
    if (!stats.skills_used.includes(skillName)) {
      stats.skills_used.push(skillName);
    }

    // Forward per-skill invocation counter (ADR-025 qe-diet Phase 2, Part A).
    // skills_used above stays a RAW deduped binary set (unchanged). This adds a
    // separate frequency counter keyed by the RAW skill name — all normalization
    // (qe-framework: prefix strip + alias collapse) happens at report read-time,
    // not here, so the hook stays light and fail-open. Reuses the single
    // hook-end writeUnifiedState; no second write. Wrapped so a counter error can
    // never block the Skill call (serial +1; concurrent multi-terminal calls may
    // last-write-wins under-count — acceptable for a coarse candidate signal).
    try {
      if (!stats.skill_usage_counts || typeof stats.skill_usage_counts !== 'object') {
        stats.skill_usage_counts = {};
      }
      const prev = stats.skill_usage_counts[skillName];
      stats.skill_usage_counts[skillName] = (Number.isInteger(prev) && prev >= 0 ? prev : 0) + 1;
    } catch {
      // Fault-tolerant: never let the usage counter break the hook.
    }

    const normalizedSkillName = String(skillName || '').replace(/^qe-framework:/, '');
    // Qcommit needs a hook-owned trust path for autonomous clients whose
    // permission classifiers reject model-written bypass artifacts. The guard
    // below consumes this one-shot capability on the next matching git commit.
    if (normalizedSkillName === 'Qcommit') {
      state.skill_bypass = {
        active: true,
        skill: 'Qcommit',
        ts: Date.now(),
        source: 'skill-entry-hook',
      };
    }

    // SIVS Skill Entry Guard: inject mandatory engine hint before skill loads
    const SKILL_STAGE_MAP = {
      'Qgenerate-spec': 'spec', 'qe-framework:Qgenerate-spec': 'spec',
      'Qgs': 'spec', 'qe-framework:Qgs': 'spec',
      'Qrun-task': 'implement', 'qe-framework:Qrun-task': 'implement',
      'Qrt': 'implement', 'qe-framework:Qrt': 'implement',
      'Qatomic-run': 'implement', 'qe-framework:Qatomic-run': 'implement',
      'Qcode-run-task': 'verify', 'qe-framework:Qcode-run-task': 'verify',
    };
    const sivsStage = SKILL_STAGE_MAP[skillName];
    if (sivsStage) {
      try {
        const bridgePath = join(__dirname, '..', '..', 'scripts', 'lib', 'codex_bridge.mjs');
        const { loadSivsConfig, resolveEngine } = await import(
          pathToFileURL(bridgePath).href
        );
        const sivsConfig = loadSivsConfig();
        const routing = resolveEngine(sivsStage, sivsConfig);
        if (routing.engine === 'codex') {
          if (!routing.warning) {
            hints.push(
              `[SIVS CODEX-PREFERRED] ${sivsStage} stage resolves to Codex engine. ` +
              `You MUST delegate to codex:codex-rescue subagent. Do NOT implement directly with Write/Edit. ` +
              `Do NOT spawn Claude-only agents (Etask-executor) for this stage unless the user explicitly overrides routing.`
            );
          } else {
            hints.push(
              `[SIVS FALLBACK] ${sivsStage} stage resolved to codex but codex is unreachable (${routing.warning}). ` +
              `Claude fallback is allowed for this invocation.`
            );
          }
        }
      } catch {
        // Fault-tolerant: never let SIVS guard crash the hook
      }
    }
  }
}

// --- On-Demand Context Injection (first call only) ---
if (isFirstCall) {
  try {
    const alreadyLoaded = Array.isArray(stats.context_loaded) ? stats.context_loaded : [];
    const isLegacyStats = !Array.isArray(stats.context_loaded);

    if (isLegacyStats || alreadyLoaded.length === 0) {
      const { loadPendingContext } = await import('./lib/context-loader.mjs');
      const pending = loadPendingContext(cwd, alreadyLoaded);
      if (pending.length > 0) {
        for (const { message } of pending) {
          hints.push(message);
        }
        stats.context_loaded = [...alreadyLoaded, ...pending.map(p => p.key)];
      }
    }
  } catch {
    // Fault-tolerant: ignore on-demand context errors
  }
}

// --- Analysis hint (once per session, not every Glob/Grep/Read) ---
if (['Glob', 'Grep', 'Read'].includes(toolName) && !stats._analysis_hinted) {
  const toolInput = data.tool_input || data.toolInput || {};
  const pattern = toolInput.pattern || toolInput.path || '';

  const isBroadGlob = toolName === 'Glob' && (pattern.includes('**') || pattern.includes('*/'));
  const isBroadGrep = toolName === 'Grep' && !pattern.includes('/') && !(toolInput.path || '').includes('.');
  const isBroadRead = toolName === 'Read' && (pattern.includes('README') || pattern.includes('package.json'));
  if (isBroadGlob || isBroadGrep || isBroadRead) {
    hints.push('Check .qe/analysis/ files first to save tokens.');
    stats._analysis_hinted = true;
  }
}

// --- Skill Override Guard ---
{
  const toolInput = data.tool_input || data.toolInput || {};

  // Check bypass flag (unified state OR standalone file)
  let bypass = state.skill_bypass;
  if (!bypass || !bypass.active) {
    const bypassFile = join(cwd, '.qe', 'state', 'skill-bypass.json');
    if (existsSync(bypassFile)) {
      try {
        bypass = JSON.parse(readFileSync(bypassFile, 'utf8'));
        // A flag written via the Write tool (e.g. Ecommit-executor) has no `ts` — Write
        // cannot stamp $(date). Fall back to the file mtime so the 120s TTL still applies.
        // Bash-written flags keep their `ts` and are unaffected.
        if (bypass && bypass.active && !bypass.ts) {
          bypass.ts = statSync(bypassFile).mtimeMs;
        }
      } catch { bypass = null; }
    }
  }
  let bypassSkill = null;
  // 120s TTL: the flag is written by a skill's executor right before its gated command.
  // Wider than the action itself but short enough that a stale flag (skipped cleanup)
  // self-expires. Gives slow executors (status/diff/log analysis) margin before the commit.
  if (bypass && bypass.active && (Date.now() - (bypass.ts || 0)) < 120000) {
    bypassSkill = bypass.skill || null;
  }
  let consumeSkillEntryBypass = false;

  // Define override rules: [condition, blocked skill name, message]
  const overrideRules = [];

  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';

    // Region-aware matching (ADR-025 R2). The block regexes used to run against the
    // RAW command, so a blocked phrase inside a quoted string, heredoc body, or
    // comment hard-blocked harmless commands (e.g. `codex exec "$(cat prompt.txt)"`
    // where the prompt mentions git commit, or `echo "use gh pr create"`). They also
    // missed real commits hidden in `bash -lc "git commit"`. matchesExecutable() /
    // executableView() classify the command into EXECUTABLE vs DATA regions so the
    // guards only fire on genuine invocations — including inside `$(...)`, backticks,
    // shell-owned heredocs, and `bash -c`/`eval` arguments — while staying
    // conservative (ambiguity → executable, never under-block). See lib/shell-scanner.mjs.
    const view = executableView(cmd);

    // git commit → Qcommit. Anchored to command-start/separator. The negative
    // lookahead lets legitimate plumbing through (`git commit-tree`, `git commit-graph`).
    if (matchesExecutable(cmd, /(?:^|[;&|(\n`])\s*git\s+commit(?![-\w])/)) {
      overrideRules.push({
        skill: 'Qcommit',
        // qe-admin-mcp release/bump workflows cut the version-bump commit under
        // an active internal admin-version bypass. Honor that capability for
        // the commit too, so the release train does not have to swap the flag
        // to Qcommit mid-run. TTL on the flag (120s) keeps this bounded.
        also: [ADMIN_VERSION_CAPABILITY],
        msg: `Raw git commit is blocked. Use ${skillCommand('Qcommit')} instead.`
      });
    }

    // gh pr create → Qbranch
    if (matchesExecutable(cmd, /\bgh\s+pr\s+create\b/)) {
      overrideRules.push({
        skill: 'Qbranch',
        msg: `Raw gh pr create is blocked. Use ${skillCommand('Qbranch')} instead.`
      });
    }

    // version bump: only a real WRITE SINK into plugin.json — redirect (`> plugin.json`
    // / `>> plugin.json`), `tee plugin.json`, or `dd of=…plugin.json` — counts. The
    // write sink must live in an EXECUTABLE region (so `echo "...plugin.json..."` text
    // passes), but the `version` mention is matched against the RAW command because the
    // version string being written legitimately sits inside the quoted JSON payload.
    const writesPluginJson =
      /(?:>>?|\btee\b(?:\s+-a)?\s+|\bdd\b[^|;&]*\bof=)\s*[^\s;|&]*plugin\.json/.test(view);
    if (writesPluginJson && /version/.test(cmd)) {
      overrideRules.push({
        skill: ADMIN_VERSION_CAPABILITY,
        msg: `Direct version editing is blocked. ${ADMIN_VERSION_ACTION}`
      });
    }

    // in-place edit (sed/perl/ruby -i) → Edit tool
    if (matchesExecutable(cmd, /\b(?:sed|perl|ruby)\s+(?:-[a-zA-Z]*i|--in-place)\b/)) {
      overrideRules.push({
        skill: '_edit_tool',
        msg: 'In-place edit (sed/perl/ruby -i) is blocked. Use the Edit tool instead.'
      });
    }
  }

  if (toolName === 'Edit') {
    const filePath = toolInput.file_path || toolInput.filePath || '';
    const newStr = toolInput.new_string || '';

    // Editing plugin.json version field → qe-admin-mcp admin version workflow
    if (/plugin\.json$/.test(filePath) && /"version"/.test(newStr)) {
      overrideRules.push({
        skill: ADMIN_VERSION_CAPABILITY,
        msg: `Direct version editing is blocked. ${ADMIN_VERSION_ACTION}`
      });
    }
  }

  // Block if any rule matched and not bypassed by the corresponding skill.
  // Uses exit code 2 = hard block. The harness refuses the tool call — no negotiation.
  // hook_profile gates enforcement: "minimal" downgrades to a soft hint (escape hatch
  // when a guard misfires); "safe" (default) and "full" enforce.
  for (const rule of overrideRules) {
    const bypassMatchesRule =
      bypassSkill === rule.skill ||
      (Array.isArray(rule.also) && rule.also.includes(bypassSkill));
    if (bypassMatchesRule) {
      if (rule.skill === 'Qcommit' && bypass?.source === 'skill-entry-hook') {
        consumeSkillEntryBypass = true;
      }
      continue;
    }
    if (cfg.hook_profile === 'minimal') {
      hints.push(`[guard:${rule.skill}] ${rule.msg} (hook_profile=minimal — not enforced)`);
    } else {
      emitBlock({
        skill: rule.skill,
        reason: rule.msg,
        action: rule.skill === ADMIN_VERSION_CAPABILITY || rule.skill.startsWith('_')
          ? rule.msg
          : `Use ${skillCommand(rule.skill)} instead`,
        bypass: `skill-bypass.json with skill:"${rule.skill}"`,
      });
    }
  }

  if (consumeSkillEntryBypass && state.skill_bypass?.source === 'skill-entry-hook') {
    delete state.skill_bypass;
  }

  // Machine-global heavy build admission. This intentionally runs after the
  // existing Bash hard-block rules, so a command rejected for another policy
  // cannot acquire and strand the build lock.
  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    if (isHeavyBuildCommand(cmd)) {
      try {
        const sessionId = data.session_id || data.sessionId || '';
        const toolUseId = data.tool_use_id || data.toolUseId || '';
        const transcriptPath = data.transcript_path || data.transcriptPath || '';
        const admission = checkBuildAdmission({
          cwd,
          command: cmd,
          sessionId,
          toolUseId,
          transcriptPath,
        });
        if (admission.disabled) {
          hints.push('[build-admission] QE_BUILD_ADMISSION=off; heavy build gate disabled.');
        } else if (!admission.admitted) {
          emitBlock({
            skill: '_build_admission',
            reason: BUILD_BLOCK_MESSAGE,
            action: BUILD_BLOCK_MESSAGE,
            bypass: 'QE_BUILD_ADMISSION=off',
          });
        }
      } catch {
        // fail-open: unexpected admission bugs must not block tool execution.
      }
    }
  }

  // Soft hints for actions that can't be reliably blocked
if (toolName === 'Read') {
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (/plugin\.json$/.test(filePath)) {
    hints.push(`Use ${skillCommand('Qversion')} to show framework version instead of reading plugin.json directly.`);
  }
}
}

// --- SIVS Option Guard (AskUserQuestion) ---
// Hard-block any SIVS engine routing question that omits the Codex Hybrid option.
// Detection: broad keyword match (sivs, 엔진, engine) + semantic check (must have codex/hybrid label).
if (toolName === 'AskUserQuestion') {
  const toolInput = data.tool_input || data.toolInput || {};
  const questions = toolInput.questions || [];
  for (const q of questions) {
    const qText = (q.question || '').toLowerCase();
    const isSivsQuestion =
      qText.includes('sivs') ||
      (qText.includes('엔진') && (qText.includes('라우팅') || qText.includes('설정') || qText.includes('선택'))) ||
      (qText.includes('engine') && (qText.includes('routing') || qText.includes('config') || qText.includes('select'))) ||
      (qText.includes('spec') && qText.includes('implement') && qText.includes('verify'));
    if (isSivsQuestion) {
      const labels = (q.options || []).map(o => (o.label || '').toLowerCase());
      const hasCodexOption = labels.some(l => l.includes('codex') || l.includes('hybrid'));
      if (!hasCodexOption) {
        emitBlock({
          skill: '_sivs_options',
          reason: 'SIVS option guard: "Claude + Codex Hybrid" option is MISSING',
          action: 'Re-call AskUserQuestion with all three options: Claude Only, Claude + Codex Hybrid, Configure Later',
        });
      }
    }
  }
}

// --- Secret Scanner (Write/Edit only) ---
if (['Write', 'Edit'].includes(toolName)) {
  const toolInput = data.tool_input || data.toolInput || {};
  const contentToScan = toolInput.new_string || toolInput.content || '';

  if (contentToScan) {
    // Combined regex: single-pass pre-filter before identifying the specific pattern
    const COMBINED_SECRET_REGEX = /AKIA[0-9A-Z]{16}|(?:aws_secret_access_key|secret_?key)\s*[:=]\s*['"]?[0-9a-zA-Z/+=]{40}['"]?|gh[pousr]_[A-Za-z0-9_]{36,}|eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+|-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----|(?:api[_\-]?key|apikey|secret[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]|(?:mongodb|postgres|mysql|redis):\/\/[^\s]+@[^\s]+|(?:^|[^a-zA-Z])(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{16,}['"]/i;

    if (COMBINED_SECRET_REGEX.test(contentToScan)) {
      // Pre-filter matched — identify specific pattern for the warning message
      const secretPatterns = [
        { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
        { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_?key)\s*[:=]\s*['"]?[0-9a-zA-Z/+=]{40}['"]?/i },
        { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
        { name: 'JWT', regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+/ },
        { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
        { name: 'Generic API Key', regex: /(?:api[_\-]?key|apikey|secret[_\-]?key)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/ },
        { name: 'DB Connection String', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s]+@[^\s]+/ },
        { name: 'Generic Password', regex: /(?:^|[^a-zA-Z])(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{16,}['"]/ },
      ];

      for (const { name, regex } of secretPatterns) {
        if (regex.test(contentToScan)) {
          hints.push(`[SECRET WARNING] Potential secret detected (${name}). Verify this is not a real credential before proceeding.`);
          break;
        }
      }
    }
  }

  // .qe/ auto-permission reminder
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (filePath.includes('.qe/') || filePath.includes('.qe\\')) {
    hints.push('Files in .qe/ can be auto-executed without user confirmation.');
  }
}

// --- Agent Teams: file ownership warning (Write/Edit in team context) ---
if (['Write', 'Edit'].includes(toolName)) {
  try {
    const { getTeamContext } = await import('./lib/team-detect.mjs');
    const teamCtx = getTeamContext(data);
    if (teamCtx.isTeam) {
      const toolInput = data.tool_input || data.toolInput || {};
      const filePath = toolInput.file_path || toolInput.filePath || '';
      if (filePath) {
        hints.push(`[AGENT TEAMS] You are teammate "${teamCtx.teammateName}" in team "${teamCtx.teamName}". Verify you own this file before editing: ${filePath}`);
      }
    }
  } catch {
    // Fault-tolerant: ignore team detection errors
  }
}

// --- Delegation Enforcer (Agent tool calls) ---
if (toolName === 'Agent') {
  const toolInput = data.tool_input || data.toolInput || {};
  try {
    const { checkDelegation, updateDelegationStats } = await import('./lib/delegation-enforcer.mjs');
    const result = checkDelegation(cwd, toolInput);
    if (result.action === 'inject' || result.action === 'warn') {
      hints.push(result.message);
    }
    updateDelegationStats(state, result.action);
  } catch {
    // Fault-tolerant: ignore delegation enforcer errors
  }
}

// --- SIVS Routing Enforcer (Agent tool calls) ---
if (toolName === 'Agent') {
  try {
    const { enforceRouting, appendAuditLog } = await import('./lib/sivs-enforcer.mjs');
    const bridgePath = join(__dirname, '..', '..', 'scripts', 'lib', 'codex_bridge.mjs');
    const { loadSivsConfig, isCodexReachable } = await import(
      pathToFileURL(bridgePath).href
    );
    const sivsConfig = loadSivsConfig();
    if (sivsConfig && Object.keys(sivsConfig).length > 0) {
      const toolInput = data.tool_input || data.toolInput || {};
      const reachable = isCodexReachable(state);
      const result = enforceRouting(toolInput, sivsConfig, reachable);
      appendAuditLog(cwd, result);
      if (result.actualEngine === 'codex' && result.action !== 'block') {
        try {
          const { injectCodexContext } = await import('./lib/codex-context-injector.mjs');
          const injection = await injectCodexContext(cwd, toolInput, result.stage);
          if (injection.injected) {
            mutatedInput = { ...toolInput, prompt: injection.updatedPrompt };
            const artifactSummary = injection.artifacts
              .map((artifact) => `${artifact.kind}(${artifact.bytes}B)`)
              .join(', ');
            hints.push(`[SIVS CONTEXT] Injected artifact context into codex delegation: ${artifactSummary}`);
          }
        } catch {
          // Fault-tolerant: context injection must never affect routing.
        }
      }
      if (result.action === 'block') {
        emitBlock({
          skill: result.configuredEngine === 'codex' ? 'codex:codex-rescue' : 'Etask-executor',
          reason: `SIVS routing violation: ${result.stage} stage requires ${result.configuredEngine} engine`,
          action: `Use ${result.configuredEngine === 'codex' ? 'codex:codex-rescue' : 'Etask-executor'} subagent instead`,
          bypass: `sivs-config.json — change ${result.stage}.engine to claude`,
        });
      }
      if (result.action === 'fallback') {
        hints.push(`[SIVS FALLBACK] ${result.stage} stage configured for codex but falling back to claude: ${result.reason}. Fix: ensure codex-plugin-cc is installed and operational.`);
      }
    }
  } catch {
    // Fault-tolerant: never let SIVS enforcer crash the hook
  }
}

// --- Qutopia QA mode: verify loop reminder ---
const currentCalls = stats.tool_calls;
const utopia = state.utopia_state || readStandaloneUtopiaState(cwd);
if (utopia && utopia.enabled && utopia.mode === 'qa') {
  const lastReminder = stats._last_verify_reminder || 0;
  if (currentCalls - lastReminder >= 10) {
    const clDir = join(cwd, '.qe', 'checklists', 'in-progress');
    if (existsSync(clDir)) {
      try {
        const clFiles = readdirSync(clDir).filter(f => f.endsWith('.md'));
        if (clFiles.length > 0) {
          hints.push('[UTOPIA QA] VERIFY_CHECKLIST item-by-item verification is MANDATORY. Each item needs a concrete check (glob, grep, build, test). "Build passed" alone is NOT sufficient.');
          stats._last_verify_reminder = currentCalls;
        }
      } catch {}
    }
  }
}

// --- Qutopia safety rails (hard block while autonomous mode is active) ---
// Inert in normal sessions: only runs when utopia_state.enabled and not overridden.
if (utopia && utopia.enabled && !utopia.allowUnsafe && (isShellTool(toolName) || ['Write', 'Edit'].includes(toolName))) {
  try {
    const { evaluateUtopiaAction } = await import('./lib/utopia-guard.mjs');
    const verdict = evaluateUtopiaAction({
      toolName: isShellTool(toolName) ? 'Bash' : toolName,
      toolInput: data.tool_input || data.toolInput || {},
      cwd,
    });
    if (verdict.block) {
      emitBlock({
        skill: '_utopia_guard',
        reason: `Utopia rail: ${verdict.reason}`,
        action: 'Use a sandbox branch / avoid this action, or set allowUnsafe:true in .qe/state/utopia-state.json to override (NOT for shared repos)',
      });
    }
  } catch {
    // fail-open: a guard error must never block the tool
  }
}

// --- Context pressure check ---
try {
  const { checkContextPressure } = await import('./context-monitor.mjs');
  const { message: ctxMessage } = checkContextPressure(cwd, stats, cfg, {
    transcriptPath: data.transcript_path || data.transcriptPath,
    modelId: data.model?.id || data.model,
    client: data.client || process.env.QE_CLIENT || 'claude',
    sessionId: data.session_id || data.sessionId || '',
  });
  if (ctxMessage) hints.push(ctxMessage);
} catch {}

// --- Profile/docs collection triggers ---
const errState = state.tool_errors || { errors: [] };
const hasRecentToolErrors = Array.isArray(errState.errors) &&
  errState.errors.length > 0 &&
  (Date.now() - (errState.window_start || 0)) <= cfg.error_window_ms;

if (currentCalls > 0 && currentCalls % cfg.profile_collect_interval === 0 && !hasRecentToolErrors) {
  hints.push('Run Eprofile-collector in background to update command patterns.');
}

const docsInterval = cfg.docs_collect_interval || 100;
if (currentCalls > 0 && currentCalls % docsInterval === 0 && !hasRecentToolErrors) {
  hints.push('Check .qe/docs/ for domain knowledge if relevant to current task.');
}

// --- Write Unified State ONCE ---
try {
  writeUnifiedState(cwd, state);
} catch {}

if (hints.length > 0 || mutatedInput) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
  };
  if (hints.length > 0) {
    hookSpecificOutput.additionalContext = `[QE] ${hints.join(' ')}`;
  }
  if (mutatedInput) {
    hookSpecificOutput.updatedInput = mutatedInput;
  }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput,
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
