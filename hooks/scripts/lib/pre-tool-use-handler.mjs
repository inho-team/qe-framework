#!/usr/bin/env node
'use strict';

import {
  evaluateEditPrecondition,
  formatStaleEditAction,
} from '../../../scripts/lib/stale-edit-guard.mjs';

/** Pure adapter from a host PreToolUse payload to the stale-edit policy. */
export function evaluateStaleEditPayload(payload, options = {}) {
  const toolName = payload?.tool_name || payload?.toolName || '';
  const toolInput = payload?.tool_input || payload?.toolInput || {};
  const cwd = payload?.cwd || payload?.directory || options.cwd || process.cwd();
  const verdict = evaluateEditPrecondition({
    toolName,
    toolInput,
    cwd,
    readFile: options.readFile,
  });

  if (!verdict.applies || verdict.allowed) return verdict;
  return {
    ...verdict,
    block: {
      skill: '_stale_edit',
      reason: `Anchored edit rejected: ${verdict.reason}.`,
      action: formatStaleEditAction(verdict),
    },
  };
}
