#!/usr/bin/env node
'use strict';

/**
 * claude-token.mjs — single source of truth for reading the Claude Code OAuth token.
 *
 * Two sources, in order:
 *   1. ~/.claude/.credentials.json   (Linux / some setups)
 *   2. macOS Keychain item "Claude Code-credentials"  (darwin default — the file does
 *      NOT exist on macOS, which is why the legacy `.credentials.json`-only readers
 *      silently failed there).
 *
 * Both yield the same JSON shape: { claudeAiOauth: { accessToken } }. The token is an
 * `sk-ant-oat01-*` OAuth token: it authenticates against the Messages API via
 * `Authorization: Bearer <token>` (NOT `x-api-key`, which 401s) and only reaches the
 * current model ids (e.g. claude-haiku-4-5-*; legacy claude-3-5-haiku-* 404s).
 *
 * Fault-tolerant: returns null on any failure. The Keychain read uses a FIXED command
 * with no interpolation (no injection surface) and suppresses stderr so a Keychain
 * error message can never leak.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * @returns {string|null} The OAuth access token, or null if unavailable.
 */
export function readClaudeOAuthToken() {
  // 1) credentials file
  try {
    const credPath = join(process.env.HOME || '/root', '.claude', '.credentials.json');
    if (existsSync(credPath)) {
      const creds = JSON.parse(readFileSync(credPath, 'utf8'));
      const t = creds?.claudeAiOauth?.accessToken;
      if (t) return t;
    }
  } catch {
    // fall through to keychain
  }
  // 2) macOS Keychain (fixed command, no interpolation → no injection surface)
  if (process.platform === 'darwin') {
    try {
      const out = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const creds = JSON.parse(out);
      return creds?.claudeAiOauth?.accessToken || null;
    } catch {
      return null;
    }
  }
  return null;
}
