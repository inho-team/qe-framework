#!/usr/bin/env node

import { installClaudeAssets, installCodexAssets, doctor } from '../scripts/lib/client_installers.mjs';

// Usage:
//   qe-framework-install            install (backs up any overwritten file)
//   qe-framework-install --dry-run  preview only — writes nothing
//   qe-framework-install doctor     report install mode, locations, backups
const args = process.argv.slice(2);

if (args.includes('doctor')) {
  doctor();
} else if (args.includes('--dry-run')) {
  installClaudeAssets({ dryRun: true });
  // Dual-target preview: also show what the Codex sync would do (no-op if ~/.codex absent).
  installCodexAssets({ dryRun: true });
} else {
  installClaudeAssets();
  // Dual-target: keep ~/.codex assets (agent .toml files + config fence) in sync with
  // the plugin so a re-install repairs Codex drift too. Graceful skip when ~/.codex
  // is absent (user is not a Codex user). This mirrors install.js's dual-target intent
  // — without it, the standard CLI install path never refreshes Codex and a stale
  // config fence keeps pointing at missing .toml files.
  installCodexAssets();
}
