#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installClaudeAssets,
  installCodexAssets,
  uninstallClaudeAssets,
} from './lib/client_installers.mjs';

const DEFAULT_HANDLERS = Object.freeze({
  installClaudeAssets,
  installCodexAssets,
  uninstallClaudeAssets,
});

export function runPackageLifecycle(action, handlers = DEFAULT_HANDLERS) {
  if (action === 'postinstall') {
    handlers.installClaudeAssets();
    handlers.installCodexAssets();
    return { action, invoked: ['installClaudeAssets', 'installCodexAssets'] };
  }
  if (action === 'preuninstall') {
    handlers.uninstallClaudeAssets();
    return { action, invoked: ['uninstallClaudeAssets'] };
  }
  throw new Error(`unsupported package lifecycle action: ${action || '<missing>'}`);
}

export function runPackageLifecycleCli(argv = process.argv.slice(2), warn = console.warn) {
  const action = argv[0];
  try {
    return runPackageLifecycle(action);
  } catch (error) {
    warn(`[qe-framework] ${action || 'lifecycle'} skipped:`, error?.message || error);
    if (action === 'postinstall') {
      warn('[qe-framework] Run qe-framework-install manually after installation.');
    }
    return { action: action || null, invoked: [], skipped: true };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPackageLifecycleCli();
}
