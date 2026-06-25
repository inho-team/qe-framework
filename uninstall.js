#!/usr/bin/env node

import { uninstallClaudeAssets } from './scripts/lib/client_installers.mjs';

const purgeCodex = process.argv.includes('--purge-codex');

uninstallClaudeAssets({ purgeCodex });
