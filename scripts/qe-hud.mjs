#!/usr/bin/env node
'use strict';

/**
 * Proxy entry for Codex installs.
 *
 * `installCodexAssets()` mirrors scripts/ into ~/.codex/scripts. The real HUD
 * implementation lives with the hook bundle so it can reuse the shared HUD
 * renderer via relative imports. This proxy locates that installed hook bundle
 * and executes it.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

function pluginCandidates(homeDir) {
  const registryPath = join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return [];
  }

  const entries = registry?.plugins?.['qe-framework@inho-team-qe-framework'];
  if (!Array.isArray(entries)) return [];

  return [...entries]
    .sort((a, b) => (b.installedAt || '').localeCompare(a.installedAt || ''))
    .map((entry) => entry.installPath)
    .filter(Boolean)
    .map((installPath) => join(installPath, 'hooks', 'scripts', 'codex', 'hud-codex.mjs'));
}

function findHudScript() {
  const here = dirname(fileURLToPath(import.meta.url));
  const home = homedir();
  const candidates = [
    join(here, '..', 'hooks', 'scripts', 'codex', 'hud-codex.mjs'),
    ...pluginCandidates(home),
    join(home, '.claude', 'hooks', 'scripts', 'codex', 'hud-codex.mjs'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

const hudScript = findHudScript();
if (!hudScript) {
  process.stderr.write('[qe-hud] Could not find hooks/scripts/codex/hud-codex.mjs. Reinstall QE Framework assets, then retry.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [hudScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(typeof result.status === 'number' ? result.status : 1);
