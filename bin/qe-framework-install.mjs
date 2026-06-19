#!/usr/bin/env node

import { installClaudeAssets, doctor } from '../scripts/lib/client_installers.mjs';

// Usage:
//   qe-framework-install            install (backs up any overwritten file)
//   qe-framework-install --dry-run  preview only — writes nothing
//   qe-framework-install doctor     report install mode, locations, backups
const args = process.argv.slice(2);

if (args.includes('doctor')) {
  doctor();
} else if (args.includes('--dry-run')) {
  installClaudeAssets({ dryRun: true });
} else {
  installClaudeAssets();
}
