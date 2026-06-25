#!/usr/bin/env node

import { installClaudeAssets, installCodexAssets } from './scripts/lib/client_installers.mjs';

installClaudeAssets();
// Dual-target: also install into ~/.codex when it exists (graceful skip if not).
installCodexAssets();
