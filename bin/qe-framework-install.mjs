#!/usr/bin/env node

import { installClaudeAssets, installCodexAssets, doctor } from '../scripts/lib/client_installers.mjs';

// Usage:
//   qe-framework-install            install (backs up any overwritten file)
//   qe-framework-install --dry-run  preview only — writes nothing
//   qe-framework-install doctor     report install mode, locations, backups
//   qe-framework-install --codex-provider ollama  inherit the active Ollama model in QE agents
const args = process.argv.slice(2);

function readCodexProvider(argv) {
  const inline = argv.find((arg) => arg.startsWith('--codex-provider='));
  const index = argv.indexOf('--codex-provider');
  const value = inline !== undefined
    ? inline.slice('--codex-provider='.length)
    : (index >= 0 ? argv[index + 1] : undefined);
  if ((inline !== undefined || index >= 0) && (!value?.trim() || value.startsWith('-'))) {
    throw new TypeError('--codex-provider requires openai, ollama, or lmstudio');
  }
  if (value && !['openai', 'ollama', 'lmstudio'].includes(value)) {
    throw new TypeError(`unsupported --codex-provider value: ${value}`);
  }
  return value;
}

const codexProvider = readCodexProvider(args);

if (args.includes('doctor')) {
  doctor();
} else if (args.includes('--dry-run')) {
  installClaudeAssets({ dryRun: true });
  // Dual-target preview: also show what the Codex sync would do (no-op if ~/.codex absent).
  installCodexAssets({ dryRun: true, codexProvider });
} else {
  installClaudeAssets();
  // Dual-target: keep ~/.codex assets (agent .toml files + config fence) in sync with
  // the plugin so a re-install repairs Codex drift too. Graceful skip when ~/.codex
  // is absent (user is not a Codex user). This mirrors install.js's dual-target intent
  // — without it, the standard CLI install path never refreshes Codex and a stale
  // config fence keeps pointing at missing .toml files.
  installCodexAssets({ codexProvider });
}
