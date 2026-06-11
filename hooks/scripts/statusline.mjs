#!/usr/bin/env node
'use strict';

/**
 * QE HUD — Claude Code statusLine wrapper.
 *
 * Reads the statusLine JSON payload from stdin, loads the project's SIVS
 * config, and prints a single-line HUD to stdout. All failures degrade to
 * an empty line so the terminal never shows a crash.
 *
 * Wire-up: either `/Qhud on` (writes into .claude/settings.json at project
 * scope) or a manual statusLine entry pointing at this file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { renderHud } from './lib/hud-renderer.mjs';
import { writeCachedRatio, deriveContextLimit } from './lib/context-meter.mjs';

const SIVS_PATHS = ['.qe/sivs-config.json', '.qe/svs-config.json'];
const STDIN_TIMEOUT_MS = 500;

/**
 * Read the full stdin payload as a string.
 *
 * Claude Code pipes the statusLine JSON on stdin; when the script is run
 * manually from a TTY (e.g., `echo '{}' | statusline.mjs` is not used),
 * returns an empty string so the caller can fall back to defaults.
 *
 * @returns {Promise<string>} Raw stdin content, or '' on TTY / timeout / error.
 */
function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');

    // Unref'd timer so it never holds the event loop open after stdin ends.
    // Without unref, every statusline redraw would pay the full timeout as
    // latency tail (observed ~500ms per redraw).
    const timer = setTimeout(() => resolve(raw), STDIN_TIMEOUT_MS);
    timer.unref?.();

    const done = () => { clearTimeout(timer); resolve(raw); };
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

/**
 * Load the project's SIVS engine routing config.
 *
 * Looks for `.qe/sivs-config.json` first, then `.qe/svs-config.json` (legacy).
 * Any JSON parse error is swallowed and returned as an empty object so the HUD
 * still renders an "all-claude" default instead of crashing the statusline.
 *
 * @param {string} projectDir Absolute path to the project root.
 * @returns {object} Parsed SIVS config, or {} when absent or malformed.
 */
function readSivsConfig(projectDir) {
  if (!projectDir) return {};
  for (const rel of SIVS_PATHS) {
    const p = join(projectDir, rel);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        return {};
      }
    }
  }
  return {};
}

/**
 * Entry point: read stdin, resolve project dir, render the HUD to stdout.
 *
 * Always exits 0 — failures are swallowed so a broken statusline never shows
 * an error banner in the user's terminal.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const raw = await readStdin();
  let data = {};
  try {
    if (raw.trim()) data = JSON.parse(raw);
  } catch {
    data = {};
  }

  const projectDir =
    data?.workspace?.project_dir ||
    data?.workspace?.current_dir ||
    data?.cwd ||
    process.cwd();

  const sivs = readSivsConfig(projectDir);
  const noColor = process.env.NO_COLOR === '1' || process.env.NO_COLOR === 'true';
  const preset = parsePresetArg(process.argv);

  // Bridge Claude Code's authoritative context reading to the Stop hook —
  // context-guard prefers this over transcript-based estimation. Also persist
  // the back-solved true window limit (200k vs 1M) so the transcript fallback
  // keeps the right denominator once this cache goes stale.
  const cw = data?.context_window;
  const pct = cw?.used_percentage;
  if (typeof pct === 'number') writeCachedRatio(projectDir, pct, deriveContextLimit(cw));

  const line = renderHud(data, sivs, { noColor, preset, projectRoot: projectDir });
  if (line) process.stdout.write(line);
}

/**
 * Parse `--preset <name>` from argv. Returns undefined if absent so the
 * renderer falls back to its default preset.
 *
 * @param {string[]} argv
 * @returns {string|undefined}
 */
function parsePresetArg(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--preset' && i + 1 < argv.length) return argv[i + 1];
    const eq = /^--preset=(.+)$/.exec(argv[i]);
    if (eq) return eq[1];
  }
  return undefined;
}

main().catch(() => {
  process.exit(0);
});
