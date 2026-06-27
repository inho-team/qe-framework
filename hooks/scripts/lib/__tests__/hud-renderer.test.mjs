import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTokens,
  pickContextUsed,
  pickSessionTokens,
  pickRateLimits,
  pickModelName,
  renderSivsLetters,
  renderHud,
  safe,
} from '../hud-renderer.mjs';

// ============================================================================
// formatTokens
// ============================================================================

test('formatTokens: small counts render as integers', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(42), '42');
  assert.equal(formatTokens(999), '999');
});

test('formatTokens: thousands use one decimal below 10k', () => {
  assert.equal(formatTokens(1000), '1.0k');
  assert.equal(formatTokens(4230), '4.2k');
});

test('formatTokens: ten-thousands round to integer k', () => {
  assert.equal(formatTokens(12_345), '12k');
  assert.equal(formatTokens(99_900), '100k');
});

test('formatTokens: millions use one decimal M', () => {
  assert.equal(formatTokens(1_500_000), '1.5M');
});

test('formatTokens: 999_500+ promotes to M to avoid "1000k"', () => {
  assert.equal(formatTokens(999_499), '999k');
  assert.equal(formatTokens(999_500), '1.0M');
  assert.equal(formatTokens(1_049_999), '1.0M');
});

test('formatTokens: invalid input returns zero', () => {
  assert.equal(formatTokens(NaN), '0');
  assert.equal(formatTokens(-5), '0');
  assert.equal(formatTokens(undefined), '0');
});

// ============================================================================
// pickContextUsed
// ============================================================================

test('pickContextUsed: prefers used_percentage when present', () => {
  const data = { context_window: { remaining_percentage: 67.4, used_percentage: 32.6 } };
  assert.equal(pickContextUsed(data), 33);
});

test('pickContextUsed: falls back to 100 - remaining_percentage', () => {
  const data = { context_window: { remaining_percentage: 70 } };
  assert.equal(pickContextUsed(data), 30);
});

test('pickContextUsed: returns null when context_window missing', () => {
  assert.equal(pickContextUsed({}), null);
  assert.equal(pickContextUsed(null), null);
});

// ============================================================================
// pickSessionTokens
// ============================================================================

test('pickSessionTokens: sums input + output tokens', () => {
  const data = {
    context_window: { total_input_tokens: 40_000, total_output_tokens: 2_300 },
  };
  assert.equal(pickSessionTokens(data), 42_300);
});

test('pickSessionTokens: returns null when total is zero', () => {
  const data = { context_window: { total_input_tokens: 0, total_output_tokens: 0 } };
  assert.equal(pickSessionTokens(data), null);
});

test('pickSessionTokens: handles missing fields', () => {
  assert.equal(pickSessionTokens({}), null);
  assert.equal(pickSessionTokens({ context_window: {} }), null);
});

// ============================================================================
// safe (ANSI / control sanitizer)
// ============================================================================

test('safe: strips ANSI CSI escapes', () => {
  assert.equal(safe('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(safe('plain'), 'plain');
});

test('safe: strips raw ESC and control chars but keeps tab', () => {
  assert.equal(safe('a\x00b\x07c'), 'abc');
  assert.equal(safe('a\tb'), 'a\tb');
});

test('safe: returns empty string for non-string input', () => {
  assert.equal(safe(null), '');
  assert.equal(safe(undefined), '');
  assert.equal(safe(42), '');
});

// ============================================================================
// pickRateLimits
// ============================================================================

test('pickRateLimits: reads both windows and rounds to int', () => {
  const data = {
    rate_limits: {
      five_hour: { used_percentage: 23.6 },
      seven_day: { used_percentage: 12.1 },
    },
  };
  assert.deepEqual(pickRateLimits(data), { fiveHour: 24, sevenDay: 12 });
});

test('pickRateLimits: handles partial windows and missing payload', () => {
  assert.deepEqual(
    pickRateLimits({ rate_limits: { five_hour: { used_percentage: 80 } } }),
    { fiveHour: 80, sevenDay: null },
  );
  assert.deepEqual(pickRateLimits({}), { fiveHour: null, sevenDay: null });
  assert.deepEqual(pickRateLimits(null), { fiveHour: null, sevenDay: null });
});

// ============================================================================
// pickModelName
// ============================================================================

test('pickModelName: prefers display_name', () => {
  assert.equal(pickModelName({ model: { display_name: 'Opus', id: 'claude-opus-4-7' } }), 'Opus');
});

test('pickModelName: falls back to id heuristic when display_name missing', () => {
  assert.equal(pickModelName({ model: { id: 'claude-sonnet-4-6' } }), 'Sonnet');
  assert.equal(pickModelName({ model: { id: 'claude-haiku-4-5' } }), 'Haiku');
});

test('pickModelName: returns raw id when no heuristic matches', () => {
  assert.equal(pickModelName({ model: { id: 'mystery-model-1' } }), 'mystery-model-1');
});

test('pickModelName: sanitizes ANSI injection in display_name', () => {
  assert.equal(pickModelName({ model: { display_name: '\x1b[31mEvil\x1b[0m' } }), 'Evil');
});

test('pickModelName: returns null when model absent', () => {
  assert.equal(pickModelName({}), null);
  assert.equal(pickModelName({ model: {} }), null);
});

// ============================================================================
// renderSivsLetters
// ============================================================================

test('renderSivsLetters: empty config → all-claude 4-letter slash form', () => {
  const out = renderSivsLetters({});
  assert.equal(out.letters, 'C/C/C/C');
  assert.equal(out.mixed, false);
});

test('renderSivsLetters: mixed engines show slash-separated initials', () => {
  const out = renderSivsLetters({
    spec: { engine: 'claude' },
    implement: { engine: 'codex' },
    verify: { engine: 'claude' },
    supervise: { engine: 'codex' },
  });
  assert.equal(out.letters, 'C/X/C/X');
  assert.equal(out.mixed, true);
});

test('renderSivsLetters: unknown engine falls back to claude (C)', () => {
  const out = renderSivsLetters({ spec: { engine: 'gemini' } });
  assert.equal(out.letters, 'C/C/C/C');
});

// ============================================================================
// renderHud
// ============================================================================

// Multi-terminal sessions write a sessionName into the project's .qe, and the
// HUD's sessionName element reads it from projectRoot. Point these tests at a
// path with no .qe so the session-name segment self-skips — keeping assertions
// deterministic regardless of the developer's live session state.
const NO_SESSION = '/__hud_test_no_session__';

test('renderHud: full payload → ctx·SIVS on row 1, quotas·model on row 2', () => {
  const data = {
    context_window: {
      used_percentage: 32,
      total_input_tokens: 40_000,
      total_output_tokens: 2_300,
    },
    rate_limits: {
      five_hour: { used_percentage: 23 },
      seven_day: { used_percentage: 12 },
    },
    model: { display_name: 'Opus' },
  };
  const line = renderHud(data, {}, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'ctx [██░░░░░] 32% │ SIVS C/C/C/C\n5h 23%·7d 12% │ Opus');
});

test('renderHud: single rate limit renders without separator (row 2)', () => {
  const data = {
    context_window: { used_percentage: 30 },
    rate_limits: { five_hour: { used_percentage: 45 } },
  };
  const line = renderHud(data, {}, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'ctx [██░░░░░] 30% │ SIVS C/C/C/C\n5h 45%');
});

test('renderHud: no model and no quotas drops the empty second row', () => {
  const data = { context_window: { used_percentage: 40 } };
  const line = renderHud(data, {}, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'ctx [███░░░░] 40% │ SIVS C/C/C/C');
});

test('renderHud: model present but no quotas → model alone on row 2', () => {
  const data = {
    context_window: { used_percentage: 58 },
    model: { display_name: 'Sonnet' },
  };
  const line = renderHud(data, {}, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'ctx [████░░░] 58% │ SIVS C/C/C/C\nSonnet');
});

test('renderHud: missing context still shows SIVS segment', () => {
  const line = renderHud({}, {}, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'SIVS C/C/C/C');
});

test('renderHud: mixed SIVS keeps "SIVS" prefix with slash letters', () => {
  const data = { context_window: { used_percentage: 20 } };
  const sivs = { implement: { engine: 'codex' } };
  const line = renderHud(data, sivs, { noColor: true, projectRoot: NO_SESSION });
  assert.equal(line, 'ctx [█░░░░░░] 20% │ SIVS C/X/C/C');
});

test('renderHud: low-usage context paints green', () => {
  const data = { context_window: { used_percentage: 16 } };
  const line = renderHud(data, {}, { projectRoot: NO_SESSION });
  assert.match(line, /\x1b\[32m/);
  assert.match(line, /\x1b\[0m/);
});

test('renderHud: high-usage context paints red', () => {
  const data = { context_window: { used_percentage: 92 } };
  const line = renderHud(data, {}, { projectRoot: NO_SESSION });
  assert.match(line, /\x1b\[31m/);
});

// ============================================================================
// Preset regression — adding the `wiki` preset must NOT alter existing presets
// (Phase 3 zero-regression gate). Frozen element-order snapshots.
// ============================================================================

import { PRESETS, resolvePreset } from '../hud/presets.mjs';

test('presets: existing 5 presets have frozen element order (no regression)', () => {
  // `session` is the uniform 2-row default: row 1 = sessionName·ctx·SIVS, then
  // a `newline` marker, row 2 = quotas·model. mix stays single-row. focused/qe/
  // full assert their deliberate order with a leading `summary` element.
  assert.deepEqual(PRESETS.session, ['sessionName', 'context', 'sivs', 'newline', 'rateLimits', 'model']);
  assert.deepEqual(PRESETS.mix, ['sessionName', 'context', 'modelRatio', 'sivs']);
  assert.deepEqual(PRESETS.focused, ['sessionName', 'summary', 'context', 'phase', 'task', 'sivs']);
  assert.deepEqual(PRESETS.qe, ['sessionName', 'summary', 'sivs', 'phase', 'task']);
  assert.deepEqual(PRESETS.full, ['sessionName', 'summary', 'context', 'rateLimits', 'model', 'tokens', 'modelRatio', 'phase', 'task', 'sivs']);
});

test('presets: none of the existing presets reference the wiki element', () => {
  for (const key of ['session', 'focused', 'qe', 'mix', 'full']) {
    assert.equal(PRESETS[key].includes('wiki'), false, `${key} must not include wiki`);
  }
});

test('presets: new wiki preset exists and contains the wiki element (opt-in)', () => {
  assert.deepEqual(PRESETS.wiki, ['sessionName', 'context', 'phase', 'wiki', 'sivs']);
});

test('presets: unknown name still falls back to session', () => {
  assert.deepEqual(resolvePreset('nonexistent'), PRESETS.session);
  assert.deepEqual(resolvePreset(undefined), PRESETS.session);
});
