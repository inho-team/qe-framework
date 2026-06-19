#!/usr/bin/env node

import { uninstallClaudeAssets } from '../scripts/lib/client_installers.mjs';

// Usage:
//   qe-framework-uninstall            remove installed assets
//   qe-framework-uninstall --restore  also restore originals from the latest backup
const args = process.argv.slice(2);

uninstallClaudeAssets({ restore: args.includes('--restore') });
