#!/usr/bin/env node
'use strict';

/**
 * qe-shadow.mjs — QE Shadow-Git Snapshot CLI (thin entry point)
 *
 * Parses argv and dispatches to the core library in lib/shadow-snapshot.mjs.
 * All business logic lives in the library; this file only handles:
 *   - subcommand routing
 *   - flag/arg extraction
 *   - process.exit codes
 *
 * Subcommands:
 *   snapshot [--source <edit|write|codex>] [--sid <id>]
 *   list     [<n>]
 *   diff     <ref>
 *   restore  <ref> [path] [--confirm|--yes] [--force]
 *   prune
 *
 * The store root (.qe/.snapshots/shadow.git) is resolved at runtime by the
 * library via findShadowRoot(), so this CLI works correctly from any cwd
 * that has a .qe/ ancestor — the wrapper covers both qe-framework and qe-mcp,
 * and single-repo projects resolve to their own root automatically.
 */

import { snapshot, list, diff, restore, prune } from './lib/shadow-snapshot.mjs';

const [, , sub = '', ...rest] = process.argv;

switch (sub) {
  case 'snapshot': {
    const sourceFlag = rest.indexOf('--source');
    const sidFlag = rest.indexOf('--sid');
    const source = sourceFlag >= 0 ? rest[sourceFlag + 1] : 'manual';
    const sid = sidFlag >= 0 ? rest[sidFlag + 1] : (process.env.QE_SESSION_ID || '');
    try {
      snapshot({ source, sid });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    break;
  }

  case 'list': {
    const n = rest[0] ? parseInt(rest[0], 10) : 20;
    try { list(n); } catch (err) { console.error(err.message); process.exit(1); }
    break;
  }

  case 'diff': {
    const ref = rest[0];
    try { diff(ref); } catch (err) { console.error(err.message); process.exit(1); }
    break;
  }

  case 'restore': {
    const ref = rest[0];
    const hasConfirm = rest.includes('--confirm') || rest.includes('--yes');
    const hasForce = rest.includes('--force');
    // path arg: first non-flag token after ref
    const pathArg = rest.slice(1).find(a => !a.startsWith('--')) || null;
    try {
      restore(ref, pathArg, hasConfirm, hasForce);
    } catch (err) { console.error(err.message); process.exit(1); }
    break;
  }

  case 'prune': {
    try { prune(); } catch (err) { console.error(err.message); process.exit(1); }
    break;
  }

  default:
    console.log(`Usage: qe-shadow.mjs <snapshot|list|diff|restore|prune> [options]

  snapshot [--source <edit|write|codex>] [--sid <id>]
  list     [<n>]              (default: last 20)
  diff     <ref>
  restore  <ref> [path]       (dry-run by default; use --confirm to apply, --force to overwrite dirty files)
  prune                       (enforce 200-snapshot / 72 h policy)
`);
    process.exit(sub ? 1 : 0);
}
