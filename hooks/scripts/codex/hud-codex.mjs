#!/usr/bin/env node
'use strict';

/**
 * QE HUD — Codex-compatible command wrapper.
 *
 * Codex does not currently expose a Claude Code-style native statusLine hook.
 * This wrapper renders the same HUD elements from project state and optional
 * environment hints so Codex users can call it from a shell prompt, tmux status,
 * or manually via `node ~/.codex/scripts/qe-hud.mjs`.
 */

import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { renderHud } from '../lib/hud-renderer.mjs';
import { readCachedRatio } from '../lib/context-meter.mjs';

const SIVS_PATHS = ['.qe/sivs-config.json', '.qe/svs-config.json'];
const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', '.qe', '.claude'];

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readSivsConfig(projectDir) {
  if (!projectDir) return {};
  for (const rel of SIVS_PATHS) {
    const parsed = readJson(join(projectDir, rel));
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return {};
}

function findProjectRoot(startDir = process.cwd()) {
  let dir = startDir;
  const home = process.env.HOME || '';
  while (dir && dir !== dirname(dir)) {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;
    if (home && dir === home) break;
    dir = dirname(dir);
  }
  return startDir;
}

function parseArgs(argv) {
  const opts = {
    preset: undefined,
    noColor: process.env.NO_COLOR === '1' || process.env.NO_COLOR === 'true',
    projectRoot: undefined,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--no-color') opts.noColor = true;
    else if (arg === '--color') opts.noColor = false;
    else if (arg === '--preset' && i + 1 < argv.length) opts.preset = argv[++i];
    else if (arg.startsWith('--preset=')) opts.preset = arg.slice('--preset='.length);
    else if ((arg === '--project' || arg === '--project-root') && i + 1 < argv.length) opts.projectRoot = argv[++i];
    else if (arg.startsWith('--project=')) opts.projectRoot = arg.slice('--project='.length);
    else if (arg.startsWith('--project-root=')) opts.projectRoot = arg.slice('--project-root='.length);
  }

  return opts;
}

function readPercentFromEnv() {
  const raw = process.env.QE_CONTEXT_USED_PERCENT || process.env.CODEX_CONTEXT_USED_PERCENT;
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function buildPayload(projectRoot) {
  const data = {
    workspace: {
      project_dir: projectRoot,
      current_dir: process.cwd(),
    },
    cwd: process.cwd(),
    client: 'codex',
  };

  const envPercent = readPercentFromEnv();
  const cachedRatio = readCachedRatio(projectRoot);
  const used = envPercent ?? (typeof cachedRatio === 'number' ? cachedRatio * 100 : null);
  if (typeof used === 'number') {
    data.context_window = { used_percentage: used };
  }

  const modelId = process.env.CODEX_MODEL
    || process.env.OPENAI_MODEL
    || process.env.OMX_DEFAULT_FRONTIER_MODEL
    || process.env.OMX_DEFAULT_SPARK_MODEL
    || '';
  if (modelId) data.model = { id: modelId, display_name: modelId };

  const currentSession = readJson(join(projectRoot, '.qe', 'state', 'current-session.json'));
  const sessionId = currentSession?.session_id || currentSession?.sessionId || '';
  if (sessionId) data.session_id = sessionId;

  return data;
}

function printHelp() {
  const script = basename(fileURLToPath(import.meta.url));
  process.stdout.write(`QE Codex HUD

Usage:
  node ${script} [--preset session|focused|qe|mix|full|wiki] [--project <path>] [--no-color]

Environment hints:
  QE_CONTEXT_USED_PERCENT=42      Override context percentage when Codex cannot expose it.
  CODEX_MODEL=gpt-5.4             Show the active model label.
`);
}

export function renderCodexHud(argv = process.argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return '';
  }

  const projectRoot = opts.projectRoot || findProjectRoot(process.cwd());
  const sivs = readSivsConfig(projectRoot);
  const data = buildPayload(projectRoot);
  return renderHud(data, sivs, {
    noColor: opts.noColor,
    preset: opts.preset,
    projectRoot,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const line = renderCodexHud(process.argv);
    if (line) process.stdout.write(line);
  } catch {
    process.exit(0);
  }
}
