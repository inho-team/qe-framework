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

import { readCredentialToken } from './credential-token.mjs';

/**
 * @returns {string|null} The OAuth access token, or null if unavailable.
 */
export function readClaudeOAuthToken() {
  return readCredentialToken({
    relativeFile: '.claude/.credentials.json',
    jsonPath: ['claudeAiOauth', 'accessToken'],
    keychainService: 'Claude Code-credentials',
  });
}
