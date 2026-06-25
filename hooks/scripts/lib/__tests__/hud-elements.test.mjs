/**
 * hud-elements.test.mjs
 * Unit tests for the new HUD elements introduced in the post-v6.6.3 refactor:
 * phase, task, model-ratio, plus preset resolution + renderer composition.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pickActivePhase } from '../hud/elements/phase.mjs';
import { pickActiveTask } from '../hud/elements/task.mjs';
import { pickSessionSummary } from '../hud/elements/summary.mjs';
import { bucketTokens, normalizePercents } from '../hud/elements/model-ratio.mjs';
import { resolvePreset, PRESETS, DEFAULT_PRESET } from '../hud/presets.mjs';
import { render as composeRender, ELEMENTS } from '../hud/renderer.mjs';

// ============================================================================
// phase element
// ============================================================================

test('phase: reads Active Phase from STATE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning'), { recursive: true });
    writeFileSync(
      join(root, '.qe/planning/STATE.md'),
      `# STATE\n\n- **Active Initiative**: Something\n- **Active Phase**: Phase 1 — Foundation\n- **Status**: running\n`,
    );
    const label = pickActivePhase(root);
    assert.equal(label, 'Phase 1');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: returns null for idle marker "(none active)"', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning'), { recursive: true });
    writeFileSync(
      join(root, '.qe/planning/STATE.md'),
      `- **Active Phase**: (none active)\n`,
    );
    assert.equal(pickActivePhase(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: missing STATE.md yields null, no throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    assert.equal(pickActivePhase(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: truncates long labels with ellipsis', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning'), { recursive: true });
    const long = 'A'.repeat(80);
    writeFileSync(
      join(root, '.qe/planning/STATE.md'),
      `- **Active Phase**: ${long}\n`,
    );
    const label = pickActivePhase(root);
    assert.ok(label.length <= 40);
    assert.ok(label.endsWith('…'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: session binding resolves named plan STATE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning/plans/auth-refactor'), { recursive: true });
    mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
    writeFileSync(
      join(root, '.qe/planning/plans/auth-refactor/STATE.md'),
      `- **Active Phase**: Phase 2 — Codex Bridge\n`,
    );
    writeFileSync(
      join(root, '.qe/planning/STATE.md'),
      `- **Active Phase**: Phase 1 — Legacy\n`,
    );
    writeFileSync(
      join(root, '.qe/planning/.sessions/sess-abc.json'),
      JSON.stringify({ activePlanSlug: 'auth-refactor' }),
    );
    assert.equal(pickActivePhase(root, 'sess-abc'), 'Phase 2');
    // No sessionId → fall back to flat STATE.md
    assert.equal(pickActivePhase(root), 'Phase 1');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: ACTIVE_PLAN pointer resolves when session file missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning/plans/dashboard-v2'), { recursive: true });
    writeFileSync(
      join(root, '.qe/planning/plans/dashboard-v2/STATE.md'),
      `- **Active Phase**: Phase 3 — Polish\n`,
    );
    writeFileSync(join(root, '.qe/planning/ACTIVE_PLAN'), 'dashboard-v2\n');
    assert.equal(pickActivePhase(root, 'unknown-session'), 'Phase 3');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('phase: rejects path-traversal slug, falls back to flat STATE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-phase-'));
  try {
    mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
    writeFileSync(
      join(root, '.qe/planning/STATE.md'),
      `- **Active Phase**: Phase 1 — Flat\n`,
    );
    writeFileSync(
      join(root, '.qe/planning/.sessions/sess-bad.json'),
      JSON.stringify({ activePlanSlug: '../../../etc/passwd' }),
    );
    assert.equal(pickActivePhase(root, 'sess-bad'), 'Phase 1');
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ============================================================================
// task element
// ============================================================================

test('task: picks most-recent pending TASK_REQUEST, extracts uuid + title', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-task-'));
  try {
    mkdirSync(join(root, '.qe/tasks/pending'), { recursive: true });
    writeFileSync(
      join(root, '.qe/tasks/pending/TASK_REQUEST_abc12345.md'),
      `# TASK_REQUEST_abc12345.md — Build landing page\n\nbody\n`,
    );
    const t = pickActiveTask(root);
    assert.equal(t.uuid, 'abc12345');
    assert.equal(t.title, 'Build landing page');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('task: empty pending folder yields null', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-task-'));
  try {
    mkdirSync(join(root, '.qe/tasks/pending'), { recursive: true });
    assert.equal(pickActiveTask(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('task: missing pending dir yields null, no throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-task-'));
  try {
    assert.equal(pickActiveTask(root), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ============================================================================
// summary element
// ============================================================================

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function seedSummary(root, sessionId, json) {
  mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
  writeFileSync(join(root, `.qe/planning/.sessions/${sessionId}.json`), JSON.stringify(json));
}

test('summary: reads summary field from session binding file', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-sum-'));
  try {
    seedSummary(root, SID, { activePlanSlug: 'x', summary: 'Refactoring auth flow' });
    assert.equal(pickSessionSummary(root, SID), 'Refactoring auth flow');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('summary: null when no sessionId, no file, or empty summary', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-sum-'));
  try {
    assert.equal(pickSessionSummary(root, null), null);
    assert.equal(pickSessionSummary(root, SID), null); // no file
    seedSummary(root, SID, { activePlanSlug: 'x' }); // no summary field
    assert.equal(pickSessionSummary(root, SID), null);
    seedSummary(root, SID, { summary: '   ' }); // whitespace-only
    assert.equal(pickSessionSummary(root, SID), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('summary: truncates long text with ellipsis', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-sum-'));
  try {
    seedSummary(root, SID, { summary: 'Z'.repeat(80) });
    const label = pickSessionSummary(root, SID);
    assert.ok(label.length <= 48);
    assert.ok(label.endsWith('…'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('summary: rejects non-UUID sessionId (path-traversal guard)', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-sum-'));
  try {
    // A hostile id must not resolve a path outside .sessions/.
    assert.equal(pickSessionSummary(root, '../../../etc/passwd'), null);
    assert.equal(pickSessionSummary(root, 'not-a-uuid'), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ============================================================================
// model-ratio element
// ============================================================================

function writeTranscript(path, lines) {
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'));
}

test('model-ratio: buckets tokens by model across Opus/Sonnet/Haiku', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-mr-'));
  try {
    const t = join(root, 'transcript.jsonl');
    writeTranscript(t, [
      { message: { role: 'assistant', model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 50 }, content: [] } },
      { message: { role: 'assistant', model: 'claude-sonnet-4', usage: { input_tokens: 80, output_tokens: 20 }, content: [] } },
      { message: { role: 'assistant', model: 'claude-haiku-4', usage: { input_tokens: 40, output_tokens: 10 }, content: [] } },
    ]);
    const b = bucketTokens(t);
    assert.equal(b.O, 150);
    assert.equal(b.S, 100);
    assert.equal(b.H, 50);
    assert.equal(b.X, 0);
    assert.equal(b.total, 300);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('model-ratio: turns invoking codex tools go into X bucket', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-mr-'));
  try {
    const t = join(root, 'transcript.jsonl');
    writeTranscript(t, [
      {
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4',
          usage: { input_tokens: 50, output_tokens: 50 },
          content: [{ type: 'tool_use', name: 'mcp__codex__rescue' }],
        },
      },
      { message: { role: 'assistant', model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 0 }, content: [] } },
    ]);
    const b = bucketTokens(t);
    assert.equal(b.X, 100);
    assert.equal(b.O, 100);
    assert.equal(b.S, 0);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('model-ratio: normalizePercents sums to exactly 100', () => {
  const pct = normalizePercents({ O: 33, S: 33, H: 33, X: 1, total: 100 });
  assert.equal(pct.O + pct.S + pct.H + pct.X, 100);
});

test('model-ratio: empty / missing transcript yields null percents', () => {
  assert.equal(normalizePercents({ O: 0, S: 0, H: 0, X: 0, total: 0 }), null);
  assert.deepEqual(bucketTokens('/nonexistent/path.jsonl'), { O: 0, S: 0, H: 0, X: 0, total: 0 });
});

test('model-ratio: user messages ignored, only assistant counted', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-mr-'));
  try {
    const t = join(root, 'transcript.jsonl');
    writeTranscript(t, [
      { message: { role: 'user', content: 'hello' } },
      { message: { role: 'assistant', model: 'claude-opus-4', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
    ]);
    const b = bucketTokens(t);
    assert.equal(b.total, 15);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// ============================================================================
// presets
// ============================================================================

test('presets: resolvePreset returns the named preset', () => {
  assert.deepEqual(resolvePreset('focused'), PRESETS.focused);
  assert.deepEqual(resolvePreset('qe'), PRESETS.qe);
  assert.deepEqual(resolvePreset('mix'), PRESETS.mix);
  assert.deepEqual(resolvePreset('full'), PRESETS.full);
});

test('presets: unknown name falls back to default (session)', () => {
  assert.deepEqual(resolvePreset('does-not-exist'), PRESETS[DEFAULT_PRESET]);
  assert.deepEqual(resolvePreset(undefined), PRESETS[DEFAULT_PRESET]);
  assert.deepEqual(resolvePreset(''), PRESETS[DEFAULT_PRESET]);
});

test('presets: all named presets reference known elements only', () => {
  // Derive the known set from the renderer's registry so adding a new element
  // (e.g. `wiki`) never silently leaves this guard stale.
  const known = new Set(Object.keys(ELEMENTS));
  for (const [name, list] of Object.entries(PRESETS)) {
    for (const el of list) {
      assert.ok(known.has(el), `preset "${name}" references unknown element "${el}"`);
    }
  }
});

// ============================================================================
// renderer composition
// ============================================================================

test('renderer: session preset matches v6.6.3 element order', () => {
  const out = composeRender({ context_window: { used_percentage: 40 } }, {}, { noColor: true, preset: 'session' });
  // session: ctx, rateLimits, model, tokens, sivs — only ctx + sivs surface with minimal payload.
  // The context element leads (now with a progress bar) and sivs trails; assert order + content,
  // not the exact bar glyphs, so cosmetic bar changes don't break the order guard.
  assert.ok(out.startsWith('ctx '));
  assert.ok(out.includes('40%'));
  assert.ok(out.endsWith('SIVS C/C/C/C'));
});

test('renderer: mix preset includes model-ratio when transcript present', () => {
  const root = mkdtempSync(join(tmpdir(), 'hud-mix-'));
  try {
    const t = join(root, 'transcript.jsonl');
    writeTranscript(t, [
      { message: { role: 'assistant', model: 'claude-opus-4', usage: { input_tokens: 90, output_tokens: 10 }, content: [] } },
    ]);
    const out = composeRender(
      { context_window: { used_percentage: 10 }, transcript_path: t },
      {},
      { noColor: true, preset: 'mix' },
    );
    assert.ok(out.includes('O:100'));
    assert.ok(out.includes('S:0'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('renderer: empty data with all-skippable elements returns empty string', () => {
  // qe preset = [sivs, phase, task]; with no sivs config (defaults C/C/C/C) sivs still emits.
  const out = composeRender({}, {}, { noColor: true, preset: 'qe', projectRoot: '/nonexistent' });
  assert.equal(out, 'SIVS C/C/C/C');
});
