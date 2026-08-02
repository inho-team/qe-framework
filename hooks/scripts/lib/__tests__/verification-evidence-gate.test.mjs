#!/usr/bin/env node

/**
 * verification-evidence-gate.test.mjs
 *
 * Tests for the R005 verification-evidence gate library.
 *
 * Covers:
 *   - isCompletionClaim: positive and negative fixtures
 *   - isAllowlistCommand: allowlist matching with cd-prefix strip
 *   - agentResultContainsTrace: Agent result evidence detection
 *   - hasVerificationEvidence: Bash tool_use/tool_result correlation
 *   - evaluateEvidenceGate: top-level gate (warn / block / fail-open)
 *   - Hook-level smoke: stdin JSON → stop-handler decision output
 *
 * Run with: node --test hooks/scripts/lib/__tests__/verification-evidence-gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  isCompletionClaim,
  isAllowlistCommand,
  evidenceCommandKind,
  isBehavioralEvidenceCommand,
  agentResultContainsTrace,
  hasVerificationEvidence,
  parseSameTurnEvents,
  evaluateEvidenceGate,
} from '../verification-evidence-gate.mjs';

// ============================================================================
// isCompletionClaim — positive fixtures (MUST fire)
// ============================================================================

const CLAIM_POSITIVES = [
  '구현이 완료되었습니다.',
  '검증 완료했습니다.',
  '작업 완료.',
  '끝났습니다.',
  'The implementation is complete.',
  'All done.',
  'Quality Verification Complete',
  'Final status: passed',
  'Implementation completed successfully.',
  // Fix 1 regression: bare "done" was lost in migration
  'Done.',
  'done',
  'The fix is done.',
  // Fix 2 regression: 완료했습니다 must still fire
  '완료했습니다',
];

for (const text of CLAIM_POSITIVES) {
  test(`isCompletionClaim positive: "${text.slice(0, 40)}"`, () => {
    assert.equal(isCompletionClaim(text), true, `expected true for: ${text}`);
  });
}

// ============================================================================
// isCompletionClaim — NEGATIVE fixtures (must NOT fire)
// ============================================================================

test('isCompletionClaim negative: 완료하지 못했습니다 (Korean negation)', () => {
  assert.equal(isCompletionClaim('완료하지 못했습니다. 다시 시도해야 합니다.'), false);
});

test('isCompletionClaim negative: 완료되지 않았 (Korean negation variant)', () => {
  assert.equal(isCompletionClaim('작업이 완료되지 않았습니다.'), false);
});

test('isCompletionClaim negative: code-fence embedded completion phrase', () => {
  // A phrase inside ``` ``` should not count as a completion claim
  const text = 'Here is an example:\n```\n구현 완료\n```\nThe code is not done yet.';
  assert.equal(isCompletionClaim(text), false);
});

test('isCompletionClaim negative: inline backtick embedded phrase', () => {
  const text = 'The variable is named `완료` and the work continues.';
  assert.equal(isCompletionClaim(text), false);
});

test('isCompletionClaim negative: English negation "not complete"', () => {
  assert.equal(isCompletionClaim('The task is not complete yet.'), false);
});

test('isCompletionClaim negative: "not done" must not match', () => {
  // Fix 1 regression: adding bare "done" must not false-positive on "not done"
  assert.equal(isCompletionClaim('The task is not done yet.'), false);
  assert.equal(isCompletionClaim('not done'), false);
});

test('isCompletionClaim negative: "incomplete" must not match', () => {
  // The old unbounded regex would false-match "complete" inside "incomplete"
  assert.equal(isCompletionClaim('The work is incomplete and needs more effort.'), false);
  assert.equal(isCompletionClaim('incomplete'), false);
});

test('isCompletionClaim negative: 미완료입니다 (Korean 미-prefix negation)', () => {
  // Fix 2 regression: 미완료 is an incomplete-status report, not a completion claim
  assert.equal(isCompletionClaim('미완료입니다.'), false);
  assert.equal(isCompletionClaim('미완료'), false);
});

test('isCompletionClaim negative: quote-embedded completion phrase', () => {
  // "완료" is inside double quotes (stripped by the gate) and no other claim word present
  const text = 'The spec says "완료" means done-state, but we have not reached it.';
  assert.equal(isCompletionClaim(text), false);
});

test('isCompletionClaim: empty / non-string → false', () => {
  assert.equal(isCompletionClaim(''), false);
  assert.equal(isCompletionClaim(null), false);
  assert.equal(isCompletionClaim(undefined), false);
  assert.equal(isCompletionClaim(42), false);
});

// ============================================================================
// isAllowlistCommand
// ============================================================================

test('isAllowlistCommand: exact matches', () => {
  assert.equal(isAllowlistCommand('npm run qe:validate'), true);
  assert.equal(isAllowlistCommand('node scripts/check-all.mjs'), true);
});

test('evidence commands distinguish structural checks from behavioral tests', () => {
  assert.equal(evidenceCommandKind('npm run qe:validate'), 'structural');
  assert.equal(evidenceCommandKind('node scripts/check-all.mjs'), 'structural');
  assert.equal(evidenceCommandKind('node --test hooks/foo.test.mjs'), 'behavioral');
  assert.equal(evidenceCommandKind('npm test'), null);
  assert.equal(isBehavioralEvidenceCommand('node --test hooks/foo.test.mjs'), true);
  assert.equal(isBehavioralEvidenceCommand('node scripts/check-all.mjs'), false);
});

test('isAllowlistCommand: node --test with a path', () => {
  assert.equal(isAllowlistCommand('node --test hooks/scripts/lib/__tests__/foo.test.mjs'), true);
  assert.equal(isAllowlistCommand('node --test some/path/bar.test.mjs'), true);
});

test('isAllowlistCommand: single leading cd X && strip', () => {
  assert.equal(isAllowlistCommand('cd qe-framework && npm run qe:validate'), true);
  assert.equal(isAllowlistCommand('cd /some/path && node scripts/check-all.mjs'), true);
  assert.equal(isAllowlistCommand('cd repo && node --test tests/foo.test.mjs'), true);
});

test('isAllowlistCommand: npm --prefix does not match', () => {
  assert.equal(isAllowlistCommand('npm --prefix qe-framework run qe:validate'), false);
});

test('isAllowlistCommand: chained double-cd does not match', () => {
  assert.equal(isAllowlistCommand('cd a && cd b && npm run qe:validate'), false);
});

test('isAllowlistCommand: non-allowlist commands → false', () => {
  assert.equal(isAllowlistCommand('npm test'), false);
  assert.equal(isAllowlistCommand('npm run test'), false);
  assert.equal(isAllowlistCommand('jest'), false);
  assert.equal(isAllowlistCommand('mocha'), false);
  assert.equal(isAllowlistCommand(''), false);
  assert.equal(isAllowlistCommand(null), false);
});

test('isAllowlistCommand: node --test without a path argument → false', () => {
  // The regex requires at least one non-whitespace char after --test
  assert.equal(isAllowlistCommand('node --test'), false);
});

// F3: trailing compound operators after the allowlist prefix must be rejected.
test('isAllowlistCommand: trailing compound operators disqualify prefix match (F3)', () => {
  // `|| true` after the allowlist command is a compound operator — reject.
  assert.equal(isAllowlistCommand('node --test hooks/foo.test.mjs || true'), false,
    'trailing || must reject the match');
  // `&& echo ok` likewise.
  assert.equal(isAllowlistCommand('node --test hooks/foo.test.mjs && echo ok'), false,
    'trailing && must reject the match');
  // `;` separator also disqualifies.
  assert.equal(isAllowlistCommand('node --test hooks/foo.test.mjs; echo ok'), false,
    'trailing ; must reject the match');
  // Clean command (no trailing operator) must still pass.
  assert.equal(isAllowlistCommand('node --test hooks/foo.test.mjs'), true,
    'clean node --test command must still be accepted');
});

// ============================================================================
// agentResultContainsTrace
// ============================================================================

test('agentResultContainsTrace: result with npm run qe:validate + PASS', () => {
  const text = 'Ran npm run qe:validate — all checks PASS.';
  assert.equal(agentResultContainsTrace(text), true);
});

test('agentResultContainsTrace: result with node --test + passed', () => {
  const text = 'Executed node --test hooks/foo.test.mjs\n3 tests passed.';
  assert.equal(agentResultContainsTrace(text), true);
});

test('agentResultContainsTrace: result with check-all + FAIL', () => {
  const text = 'node scripts/check-all.mjs output:\n1 check FAILED.';
  assert.equal(agentResultContainsTrace(text), true);
});

test('agentResultContainsTrace: trace-less Agent completion → false (not evidence)', () => {
  // A bare "task complete" agent result with no command trace is NOT evidence
  assert.equal(agentResultContainsTrace('모든 작업이 완료되었습니다.'), false);
  assert.equal(agentResultContainsTrace('Implementation complete. All items done.'), false);
  assert.equal(agentResultContainsTrace(''), false);
  assert.equal(agentResultContainsTrace(null), false);
});

test('agentResultContainsTrace: command present but no outcome indicator → false', () => {
  // Command name appears but no PASS/FAIL/passed/failed/✓
  const text = 'I ran npm run qe:validate but the output is not shown here.';
  // "but" does not constitute a PASS/FAIL summary
  assert.equal(agentResultContainsTrace(text), false);
});

// ============================================================================
// parseSameTurnEvents
// ============================================================================

function writeTmpTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-'));
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return { dir, p };
}

test('parseSameTurnEvents: returns events after last human user turn', (t) => {
  const { dir, p } = writeTmpTranscript([
    { type: 'user', message: { role: 'user', content: '해줘' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '먼저 본다.' }] } },
    { type: 'user', message: { role: 'user', content: '다시 해줘' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '완료.' }] } },
  ]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const events = parseSameTurnEvents(p);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'assistant');
});

test('parseSameTurnEvents: missing transcript → [] (fail-open)', () => {
  assert.deepEqual(parseSameTurnEvents('/nonexistent/path.jsonl'), []);
  assert.deepEqual(parseSameTurnEvents(''), []);
  assert.deepEqual(parseSameTurnEvents(null), []);
});

// ============================================================================
// hasVerificationEvidence — Bash tool_use / tool_result correlation
// ============================================================================

function makeToolUseEvent(toolUseId, command) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } },
      ],
    },
  };
}

/**
 * Build a minimal transcript event representing a tool_result response.
 *
 * @param {string} toolUseId - The tool_use_id that this result is paired with.
 * @param {object} [opts]
 * @param {boolean} [opts.isError=false]      - Set is_error:true to simulate a Bash failure.
 * @param {boolean} [opts.interrupted=false]  - Set interrupted:true to simulate a cancelled run.
 * @param {string}  [opts.text='ok']          - Result content text.
 * @returns {object} A transcript event object of type 'user' with a tool_result block.
 */
function makeToolResultEvent(toolUseId, { isError = false, interrupted = false, text = 'ok' } = {}) {
  const block = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: [{ type: 'text', text }],
  };
  if (isError) block.is_error = true;
  if (interrupted) block.interrupted = true;
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [block],
    },
  };
}

test('hasVerificationEvidence: allowlist Bash success → true (not blocked)', () => {
  const events = [
    makeToolUseEvent('tid1', 'npm run qe:validate'),
    makeToolResultEvent('tid1', { text: 'All checks passed.' }),
  ];
  assert.equal(hasVerificationEvidence(events), true);
});

test('hasVerificationEvidence: allowlist Bash with cd-prefix → true', () => {
  const events = [
    makeToolUseEvent('tid2', 'cd qe-framework && npm run qe:validate'),
    makeToolResultEvent('tid2', { text: 'ok' }),
  ];
  assert.equal(hasVerificationEvidence(events), true);
});

test('hasVerificationEvidence: allowlist Bash is_error:true → false', () => {
  const events = [
    makeToolUseEvent('tid3', 'npm run qe:validate'),
    makeToolResultEvent('tid3', { isError: true }),
  ];
  assert.equal(hasVerificationEvidence(events), false);
});

test('hasVerificationEvidence: allowlist Bash interrupted:true → false', () => {
  const events = [
    makeToolUseEvent('tid4', 'npm run qe:validate'),
    makeToolResultEvent('tid4', { interrupted: true }),
  ];
  assert.equal(hasVerificationEvidence(events), false);
});

test('hasVerificationEvidence: non-allowlist Bash success → false', () => {
  const events = [
    makeToolUseEvent('tid5', 'npm test'),
    makeToolResultEvent('tid5', { text: 'passed' }),
  ];
  assert.equal(hasVerificationEvidence(events), false);
});

test('hasVerificationEvidence: no events → false', () => {
  assert.equal(hasVerificationEvidence([]), false);
  assert.equal(hasVerificationEvidence(null), false);
});

test('hasVerificationEvidence: Agent result with trace → true', () => {
  // An Agent toolUseResult whose text contains an allowlist command trace + PASS.
  // The paired tool_use must have name 'Agent' or 'Task' for trace-based evidence (F1).
  const events = [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'agent-tid', name: 'Agent', input: {} }],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'agent-tid',
            content: [{ type: 'text', text: 'Ran npm run qe:validate — all checks PASS.' }],
          },
        ],
      },
    },
  ];
  assert.equal(hasVerificationEvidence(events), true);
});

test('hasVerificationEvidence: Task result with trace → true', () => {
  // 'Task' is an alternative tool name for agent-style results (F1: both names accepted).
  const events = [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'task-tid', name: 'Task', input: {} }],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'task-tid',
            content: [{ type: 'text', text: 'node --test hooks/foo.test.mjs — 5 passed.' }],
          },
        ],
      },
    },
  ];
  assert.equal(hasVerificationEvidence(events), true);
});

// F1 spoof regression: allowlist trace inside a non-Agent tool result must NOT be evidence.
test('hasVerificationEvidence: allowlist trace in Read/Bash cat result → false (spoof rejected)', () => {
  // A Bash (cat) tool_result whose output happens to contain an allowlist trace must NOT
  // count as Agent evidence.  The Bash path requires a paired Bash tool_use with an
  // allowlist command, not a traced result text.  This test verifies the spoof is rejected.
  const events = [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'cat-tid', name: 'Bash', input: { command: 'cat some-log.txt' } }],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'cat-tid',
            content: [{ type: 'text', text: 'npm run qe:validate output:\nAll checks PASS.' }],
          },
        ],
      },
    },
  ];
  // The Bash cat command is NOT on the allowlist (it's `cat some-log.txt`), so
  // _hasBashAllowlistSuccess returns false.  The trace check only applies to Agent/Task.
  assert.equal(hasVerificationEvidence(events), false,
    'cat output containing allowlist trace must not be accepted as evidence');
});

test('hasVerificationEvidence: Agent result without trace → false (not evidence)', () => {
  // Bare completion report — no command trace
  const events = [
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'agent-tid2',
            content: [{ type: 'text', text: '작업이 완료되었습니다. 모든 항목 처리됨.' }],
          },
        ],
      },
    },
  ];
  assert.equal(hasVerificationEvidence(events), false);
});

// F1 — real transcript shape: `interrupted` lives on top-level `toolUseResult`,
// not inside the content block.  Audit of 60 real transcripts found 1019 hits at
// event.toolUseResult.interrupted; zero hits at block.interrupted.
test('hasVerificationEvidence: real-shape toolUseResult.interrupted=true → false (not success)', () => {
  // Modeled on actual JSONL: user event has top-level toolUseResult.interrupted=true,
  // while the content block carries no interrupted field (real shape, not unit-fixture shape).
  const events = [
    makeToolUseEvent('real-tid1', 'npm run qe:validate'),
    {
      type: 'user',
      // Real transcript shape: interrupted at top-level toolUseResult, not in block.
      toolUseResult: { stdout: '', stderr: 'Interrupted', interrupted: true },
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'real-tid1',
            // No `interrupted` field on the block itself — that is the real shape.
            content: [{ type: 'text', text: '' }],
          },
        ],
      },
    },
  ];
  assert.equal(hasVerificationEvidence(events), false,
    'real-shape interrupted=true at toolUseResult level must not be accepted as evidence');
});

test('hasVerificationEvidence: real-shape toolUseResult success (no interrupted) → true', () => {
  // Real-transcript success: toolUseResult present but interrupted is absent/false;
  // no is_error on the block either.  This models a normal successful Bash result.
  const events = [
    makeToolUseEvent('real-tid2', 'npm run qe:validate'),
    {
      type: 'user',
      // Real transcript shape: toolUseResult without interrupted flag → success.
      toolUseResult: { stdout: 'All checks passed.', stderr: '', interrupted: false },
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'real-tid2',
            content: [{ type: 'text', text: 'All checks passed.' }],
          },
        ],
      },
    },
  ];
  assert.equal(hasVerificationEvidence(events), true,
    'real-shape success (toolUseResult.interrupted=false) must be accepted as evidence');
});

test('hasVerificationEvidence: behavioral mode rejects structural-only success', () => {
  const structural = [
    makeToolUseEvent('structural-tid', 'npm run qe:validate'),
    makeToolResultEvent('structural-tid', { text: 'All checks passed.' }),
  ];
  const behavioral = [
    makeToolUseEvent('behavioral-tid', 'node --test hooks/foo.test.mjs'),
    makeToolResultEvent('behavioral-tid', { text: '3 tests passed.' }),
  ];
  assert.equal(hasVerificationEvidence(structural, { requireBehavioral: true }), false);
  assert.equal(hasVerificationEvidence(behavioral, { requireBehavioral: true }), true);
});

// ============================================================================
// evaluateEvidenceGate — top-level integration
// ============================================================================

/**
 * Build a minimal transcript fixture as a JSONL string with:
 *   - a human user turn
 *   - optionally a Bash tool_use + tool_result pair
 * Returns the path; caller is responsible for cleanup.
 */
function makeFixtureTranscript(dir, opts = {}) {
  const {
    withAllowlistBash = false,
    bashIsError = false,
    bashInterrupted = false,
    agentTrace = null,
    command = 'npm run qe:validate',
  } = opts;

  const lines = [
    { type: 'user', message: { role: 'user', content: '구현해줘' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '구현 완료했습니다.' }] } },
  ];

  if (withAllowlistBash) {
    lines.push({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'fix-tid', name: 'Bash', input: { command } }],
      },
    });
    const resultBlock = {
      type: 'tool_result',
      tool_use_id: 'fix-tid',
      content: [{ type: 'text', text: 'All checks passed.' }],
    };
    if (bashIsError) resultBlock.is_error = true;
    if (bashInterrupted) resultBlock.interrupted = true;
    lines.push({
      type: 'user',
      message: { role: 'user', content: [resultBlock] },
    });
  }

  if (agentTrace) {
    // F1: paired tool_use with name 'Task' must precede the tool_result so that
    // hasVerificationEvidence can confirm the result came from an Agent/Task tool.
    lines.push({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'agent-trace-tid', name: 'Task', input: {} }],
      },
    });
    lines.push({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'agent-trace-tid',
            content: [{ type: 'text', text: agentTrace }],
          },
        ],
      },
    });
  }

  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return p;
}

/**
 * Create a minimal git repo in a temp dir so changedCodeFiles sees a code file.
 */
function makeTmpCwd(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-cwd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  // Write an untracked code file so changedCodeFiles returns length > 0
  fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const x = 1;\n');
  return dir;
}

test('evaluateEvidenceGate: completion claim + code diff + no evidence → fire=true', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir);
  const text = '구현 완료했습니다.';
  const result = evaluateEvidenceGate(cwd, text, transcriptPath);
  assert.equal(result.fire, true);
  assert.equal(result.reason, 'verification-evidence-missing');
});

test('evaluateEvidenceGate: structural-only Bash success does not prove changed code', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir, { withAllowlistBash: true });
  const text = '구현 완료했습니다.';
  const result = evaluateEvidenceGate(cwd, text, transcriptPath);
  assert.equal(result.fire, true);
});

test('evaluateEvidenceGate: structural-only Agent trace does not prove changed code', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir, {
    agentTrace: 'Ran npm run qe:validate — all checks PASS.',
  });
  const text = '구현 완료했습니다.';
  const result = evaluateEvidenceGate(cwd, text, transcriptPath);
  assert.equal(result.fire, true);
});

test('evaluateEvidenceGate: focused behavioral Bash success proves changed code', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir, {
    withAllowlistBash: true,
    command: 'node --test hooks/foo.test.mjs',
  });
  const result = evaluateEvidenceGate(cwd, '구현 완료했습니다.', transcriptPath);
  assert.equal(result.fire, false);
});

test('evaluateEvidenceGate: trace-less Agent completion → fire=true (not evidence)', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir, {
    agentTrace: '모든 작업이 완료되었습니다. 항목 처리 완료.',
  });
  const text = '구현 완료했습니다.';
  const result = evaluateEvidenceGate(cwd, text, transcriptPath);
  assert.equal(result.fire, true);
});

test('evaluateEvidenceGate: no completion claim → fire=false', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir);
  const text = '다음 단계를 진행 중입니다.';
  const result = evaluateEvidenceGate(cwd, text, transcriptPath);
  assert.equal(result.fire, false);
});

test('evaluateEvidenceGate: empty diff (no code files) → fire=false', (t) => {
  // cwd has no code files → changedCodeFiles returns []
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-empty-'));
  t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));
  execSync('git init', { cwd: emptyDir });

  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-tr-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));
  const transcriptPath = makeFixtureTranscript(transcriptDir);

  const result = evaluateEvidenceGate(emptyDir, '구현 완료했습니다.', transcriptPath);
  assert.equal(result.fire, false);
});

test('evaluateEvidenceGate: missing transcript → fail-open (fire=false)', (t) => {
  const cwd = makeTmpCwd(t);
  // Use a nonexistent transcript path — should fail-open
  const result = evaluateEvidenceGate(cwd, '구현 완료했습니다.', '/nonexistent/transcript.jsonl');
  // parseSameTurnEvents returns [] → hasVerificationEvidence returns false → gate fires
  // But the gate should still fire (missing transcript means no evidence found) —
  // fail-open means no error thrown, not that we suppress the gate when evidence is absent.
  // The gate fires because there's no evidence; fail-open only means it never throws.
  assert.equal(result.fire, true);
  // Verify it didn't throw (the result has the expected shape)
  assert.equal(typeof result.fire, 'boolean');
});

// ============================================================================
// Block-mode smoke (cfg = 'block')
// ============================================================================

test('evaluateEvidenceGate + block mode: injected changedCodeFiles confirms block path', (t) => {
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-evgate-blk-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  const transcriptPath = makeFixtureTranscript(transcriptDir);
  // Inject a changedCodeFiles that always returns a code file
  const fakeChangedCodeFiles = () => ['app.mjs'];
  const result = evaluateEvidenceGate('/any', '구현 완료했습니다.', transcriptPath, fakeChangedCodeFiles);
  assert.equal(result.fire, true, 'gate must fire in block scenario');
  assert.equal(result.reason, 'verification-evidence-missing');
});

// ============================================================================
// Hook-level smoke: stdin → stop-handler decision
// ============================================================================

/**
 * Run stop-handler.mjs with a given JSON payload written to a temp stdin file.
 * Returns the first valid JSON line parsed from stdout.
 *
 * @param {object} payload   - The hook input object (cwd, session_id, transcript_path, …).
 * @param {string} stdinDir  - Temp directory to write the stdin file into.
 * @returns {{ parsed: object|undefined, output: string }}
 */
function runStopHandler(payload, stdinDir) {
  const stdinFile = path.join(stdinDir, 'hook-stdin.json');
  fs.writeFileSync(stdinFile, JSON.stringify(payload), 'utf8');

  // fileURLToPath decodes the percent-encoded Korean path segments that appear in
  // import.meta.url.pathname — without it node cannot find stop-handler.mjs.
  const handlerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../stop-handler.mjs'
  );

  let output = '';
  try {
    output = execSync(`node "${handlerPath}" < "${stdinFile}"`, {
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (err) {
    output = err.stdout || '';
  }

  let parsed;
  for (const line of output.split('\n')) {
    const tr = line.trim();
    if (!tr) continue;
    try { parsed = JSON.parse(tr); break; } catch {}
  }
  return { parsed, output };
}

// F4: warn mode must emit advisory on EVERY eligible stop (not just every other one).
// We run stop-handler twice in a row with the same conditions and verify both emits.
test('hook smoke: warn mode emits advisory every eligible stop — not alternating (F4)', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-smoke-warn-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));
  const transcriptPath = makeFixtureTranscript(transcriptDir);

  // Disable code-risk gate so only the evidence gate fires (isolate the test).
  const configDir = path.join(cwd, '.qe');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ hooks: { code_risk_stop_gate: false, style_gate: false } }),
    'utf8'
  );

  const stateDir = path.join(cwd, '.qe', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'unified-state.json'), '{}', 'utf8');

  const stdinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-smoke-warn-stdin-'));
  t.after(() => fs.rmSync(stdinDir, { recursive: true, force: true }));

  const payload = { session_id: 'smoke-warn-f4', cwd, transcript_path: transcriptPath };

  // First stop: must emit warn advisory.
  const first = runStopHandler(payload, stdinDir);
  assert.ok(first.parsed, `first stop produced no JSON. stdout: ${first.output}`);
  assert.equal(first.parsed.continue, true, `first stop must be continue:true (warn). got: ${JSON.stringify(first.parsed)}`);
  assert.ok(
    first.parsed.systemMessage && /QE Evidence/.test(first.parsed.systemMessage),
    `first stop must include QE Evidence advisory. got: ${JSON.stringify(first.parsed)}`
  );

  // Second stop (same conditions, same unified-state): must also emit the advisory.
  // In the old behaviour the repeat guard would have armed and the second stop would
  // NOT emit — F4 fixes this by not arming the guard in warn mode.
  const second = runStopHandler(payload, stdinDir);
  assert.ok(second.parsed, `second stop produced no JSON. stdout: ${second.output}`);
  assert.equal(second.parsed.continue, true, `second stop must also be continue:true (warn). got: ${JSON.stringify(second.parsed)}`);
  assert.ok(
    second.parsed.systemMessage && /QE Evidence/.test(second.parsed.systemMessage),
    `second stop must also include QE Evidence advisory — not suppressed by repeat guard (F4). got: ${JSON.stringify(second.parsed)}`
  );
});

// F5: block-mode smoke — must not trigger code-risk gate; block reason must be
// the evidence gate specifically (marker: 'verification-evidence' in the reason).
test('hook smoke: block config blocks with evidence-gate reason specifically (F5)', (t) => {
  const cwd = makeTmpCwd(t);
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-smoke-blk-'));
  t.after(() => fs.rmSync(transcriptDir, { recursive: true, force: true }));

  // Transcript: completion claim but NO code-risk report sections (would trip code-risk gate).
  // We disable the code-risk gate in config to isolate the evidence gate block.
  // The transcript has a plain completion claim with no evidence and no risk sections.
  const transcriptPath = makeFixtureTranscript(transcriptDir);

  // Block mode for evidence gate; disable code-risk and style gates explicitly so only
  // the evidence gate can produce the block (F5: isolate the blocking source).
  const configDir = path.join(cwd, '.qe');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      hooks: {
        verification_evidence_gate: 'block',
        code_risk_stop_gate: false,
        style_gate: false,
      },
    }),
    'utf8'
  );

  const stateDir = path.join(cwd, '.qe', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'unified-state.json'), '{}', 'utf8');

  const stdinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-smoke-blk-stdin-'));
  t.after(() => fs.rmSync(stdinDir, { recursive: true, force: true }));

  const { parsed, output } = runStopHandler(
    { session_id: 'smoke-block-f5', cwd, transcript_path: transcriptPath },
    stdinDir
  );

  assert.ok(parsed, `no JSON from stop-handler. stdout: ${output}`);
  assert.equal(parsed.continue, false,
    `Expected block (continue:false) but got: ${JSON.stringify(parsed)}`);
  // F5: the block reason must reference the evidence gate specifically.
  assert.ok(
    parsed.reason && /verification-evidence|QE Evidence/i.test(parsed.reason),
    `block reason must identify the evidence gate. got reason: ${parsed.reason}`
  );
});
