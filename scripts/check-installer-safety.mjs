#!/usr/bin/env node
/**
 * check-installer-safety.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * End-to-end safety contract for the installer (trust-hardening Phase 3). Every
 * scenario injects a TEMPORARY homeDir + a synthetic repoRoot, so the REAL ~/.claude
 * is never read or written. Asserts:
 *   - planInstall is pure (no writes, classifies create/overwrite)
 *   - install backs up an overwritten original before clobbering it
 *   - --dry-run writes nothing
 *   - doctor reports mode/version read-only
 *   - uninstall --restore brings the original back
 *   - plain uninstall leaves no residue from the installed set
 */

import { planInstall, installClaudeAssets, uninstallClaudeAssets, doctor } from '../scripts/lib/client_installers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const silent = () => {};

/** Build a throwaway repoRoot with one file under each installed source dir. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'qe-repo-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
  for (const [d, f, c] of [
    ['skills', 'a.md', 'SKILL-A'], ['agents', 'b.md', 'AGENT-B'], ['core', 'c.md', 'CORE-C'],
    ['hooks', 'd.mjs', 'HOOK-D'], ['scripts', 'e.mjs', 'SCRIPT-E'],
  ]) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, f), c);
  }
  return root;
}

/** Count files (recursively) under a directory; 0 if absent. */
function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

const repoRoot = makeRepo();
const cleanup = [repoRoot];
const home = () => { const h = mkdtempSync(join(tmpdir(), 'qe-home-')); cleanup.push(h); return h; };

try {
  // 1. planInstall is pure: nothing written, all 'create' on a fresh HOME.
  {
    const h = home();
    const plan = planInstall({ repoRoot, homeDir: h, log: silent });
    expect(plan.actions.length === 5, `planInstall: expected 5 actions, got ${plan.actions.length}`);
    expect(plan.actions.every((a) => a.action === 'create'), 'planInstall: all should be create on fresh HOME');
    expect(countFiles(join(h, '.claude')) === 0, 'planInstall WROTE files (must be pure)');
  }

  // 2. install backs up an overwritten original.
  {
    const h = home();
    mkdirSync(join(h, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(h, '.claude', 'commands', 'a.md'), 'ORIGINAL');
    const res = installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    expect(res.overwritten === 1, `expected 1 overwrite, got ${res.overwritten}`);
    expect(readFileSync(join(h, '.claude', 'commands', 'a.md'), 'utf8') === 'SKILL-A', 'install did not overwrite a.md');
    expect(res.backupDir && existsSync(join(res.backupDir, 'manifest.json')), 'no backup manifest written');
    const man = JSON.parse(readFileSync(join(res.backupDir, 'manifest.json'), 'utf8'));
    expect(man.entries.length === 1 && readFileSync(man.entries[0].backup, 'utf8') === 'ORIGINAL', 'backup did not capture original content');
  }

  // 3. dry-run writes nothing.
  {
    const h = home();
    installClaudeAssets({ repoRoot, homeDir: h, log: silent, dryRun: true });
    expect(countFiles(join(h, '.claude')) === 0, 'dry-run WROTE files');
  }

  // 4. doctor is read-only and reports mode + version.
  {
    const h = home();
    const d = doctor({ repoRoot, homeDir: h, log: silent });
    expect(d.mode === 'standalone' && d.version === '0.0.0-test', `doctor wrong: ${JSON.stringify(d)}`);
  }

  // 5. uninstall --restore brings the overwritten original back.
  {
    const h = home();
    mkdirSync(join(h, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(h, '.claude', 'commands', 'a.md'), 'ORIGINAL');
    installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    uninstallClaudeAssets({ repoRoot, homeDir: h, log: silent, restore: true });
    expect(readFileSync(join(h, '.claude', 'commands', 'a.md'), 'utf8') === 'ORIGINAL', 'restore did not bring back original');
  }

  // 6. plain uninstall removes the QE-shipped (byte-identical) files it installed.
  {
    const h = home();
    installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    uninstallClaudeAssets({ repoRoot, homeDir: h, log: silent });
    for (const sub of ['commands', 'agents', 'core', 'hooks', 'scripts']) {
      expect(countFiles(join(h, '.claude', sub)) === 0, `shipped residue left in ~/.claude/${sub} after uninstall`);
    }
  }

  // 7. W1: a USER file colliding with a shipped name (never installed) is NOT deleted.
  {
    const h = home();
    mkdirSync(join(h, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(h, '.claude', 'commands', 'a.md'), 'USER-OWNED'); // differs from shipped SKILL-A
    uninstallClaudeAssets({ repoRoot, homeDir: h, log: silent });
    expect(existsSync(join(h, '.claude', 'commands', 'a.md')) &&
      readFileSync(join(h, '.claude', 'commands', 'a.md'), 'utf8') === 'USER-OWNED',
      'plain uninstall DELETED a colliding user file (W1 regression)');
  }

  // 8. W1: a file the user edited AFTER install is not deleted on plain uninstall.
  {
    const h = home();
    installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    writeFileSync(join(h, '.claude', 'commands', 'a.md'), 'USER-EDITED'); // diverges from shipped
    uninstallClaudeAssets({ repoRoot, homeDir: h, log: silent });
    expect(existsSync(join(h, '.claude', 'commands', 'a.md')) &&
      readFileSync(join(h, '.claude', 'commands', 'a.md'), 'utf8') === 'USER-EDITED',
      'plain uninstall DELETED a user-edited installed file');
  }

  // 9. Standalone update removes only manifest-owned retired skill directories.
  {
    const h = home();
    const commands = join(h, '.claude', 'commands');
    mkdirSync(join(commands, 'Qinit'), { recursive: true });
    writeFileSync(join(commands, 'Qinit', 'SKILL.md'), 'RETIRED-QE-SKILL');
    mkdirSync(join(commands, 'UserSkill'), { recursive: true });
    writeFileSync(join(commands, 'UserSkill', 'SKILL.md'), 'USER-SKILL');
    installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    expect(!existsSync(join(commands, 'Qinit')), 'standalone install left retired Qinit behind');
    expect(existsSync(join(commands, 'UserSkill', 'SKILL.md')), 'standalone install deleted an unrelated user skill');
  }

  // 10. Plugin-mode update prunes stale assets inside the plugin cache.
  {
    const h = home();
    const pluginPath = join(h, '.claude', 'plugins', 'cache', 'inho-team-qe-framework', 'qe-framework', 'test');
    mkdirSync(pluginPath, { recursive: true });
    mkdirSync(join(h, '.claude', 'plugins'), { recursive: true });
    writeFileSync(join(h, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 1,
      plugins: {
        'qe-framework@inho-team-qe-framework': [{
          installPath: pluginPath,
          installedAt: '2026-07-01T00:00:00.000Z',
        }],
      },
    }));
    mkdirSync(join(pluginPath, 'hooks', 'stale'), { recursive: true });
    writeFileSync(join(pluginPath, 'hooks', 'stale', 'old.mjs'), 'STALE');
    installClaudeAssets({ repoRoot, homeDir: h, log: silent });
    expect(!existsSync(join(pluginPath, 'hooks', 'stale', 'old.mjs')), 'plugin-mode install left stale plugin cache asset behind');
    expect(existsSync(join(pluginPath, 'hooks', 'd.mjs')), 'plugin-mode install did not copy current hook asset');
  }
} finally {
  for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

if (failures.length) {
  console.error('check-installer-safety: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('check-installer-safety: PASS (10 scenarios, temp HOME only — real ~/.claude untouched)');
