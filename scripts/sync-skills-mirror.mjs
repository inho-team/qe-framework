#!/usr/bin/env node
/**
 * sync-skills-mirror.mjs
 *
 * Dual-harness skill mirror for QE Framework.
 * Creates symlinks in the Codex skills target directory (~/.codex/skills/) that
 * point back to the live repo's skills/ source directories.
 *
 * Rationale:
 *  - Claude (1-level) discovers skills as flat command entries under ~/.claude/commands/
 *  - Codex (recursive) discovers skills by walking ~/.codex/skills/ for dirs containing SKILL.md
 *  - A symlink mirror lets both clients see the same source without copying, preventing
 *    sync drift that would occur if files were duplicated.
 *
 * Key contracts:
 *  - dry-run by default; --apply to write symlinks
 *  - Codex skill target path validated against installCodexAssets() real path (~/.codex/skills)
 *    before --apply is permitted; abort if unverified or absent
 *  - ~/.codex absent machine: skip (existsSync gate, same convention as client_installers.mjs)
 *  - Ownership: .qe/state/skill-mirror-manifest.json (machine-local, absolute paths, not synced)
 *  - Prune: only manifest-declared symlinks are removed; user symlinks/real files untouched
 *  - Collision priority: installer real assets (real dir / non-symlink file) > mirror symlinks
 *    - If target is a real dir or non-symlink file: skip + report (installer-owned)
 *  - Foreign symlinks (target from another repo manifest): skip + report
 *  - manifest loss: existing links become unmanaged orphans, reported but not pruned (accepted residual)
 *  - Idempotency: readlink set comparison; symlink targets are absolute paths; 2 runs → diff 0
 *  - validated client version field: verified from package.json; [UNVERIFIED] if unreadable
 *
 * Testability:
 *  - runMirror() accepts explicit overrideOpts for repoRoot, codexSkillsDir, manifestPath,
 *    homeDir so tests can pass tmpdir paths without touching real ~/.codex.
 *  - Env vars SKILL_MIRROR_TARGET_ROOT / SKILL_MIRROR_MANIFEST / SKILL_MIRROR_REPO_ROOT
 *    are honoured as CLI-level defaults (read once at CLI entry, passed into runMirror).
 *
 * Attribution:
 *  Inspired by steipete/agent-scripts sync-skills pattern.
 *  Rewritten for QE Framework conventions. MIT License.
 *  Original: https://github.com/steipete/agent-scripts (MIT)
 *
 * Usage:
 *   node scripts/sync-skills-mirror.mjs          # dry-run (default)
 *   node scripts/sync-skills-mirror.mjs --apply  # write symlinks
 *
 * Run from: qe-framework/
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Module-level constants (for CLI use — not used inside runMirror directly)
// ---------------------------------------------------------------------------

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// Default repo root: scripts/ -> ../ -> repo root
export const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, '..');

// ---------------------------------------------------------------------------
// Skill discovery (Codex recursive: finds dirs with SKILL.md)
// ---------------------------------------------------------------------------

/**
 * Recursively collect skill source directories — directories that contain SKILL.md.
 * Mirrors collectSkillSourceDirs() in client_installers.mjs (Codex discovery).
 * Skips symlinks to prevent traversal loops.
 *
 * @param {string} skillsDir - Current directory to scan
 * @param {string} baseDir - Root skills/ directory (for computing rel path)
 * @param {Array} out - Accumulator
 * @returns {Array<{src: string, rel: string}>}
 */
function collectSkillSourceDirs(skillsDir, baseDir = skillsDir, out = []) {
  let stat;
  try { stat = lstatSync(skillsDir); } catch { return out; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return out;

  if (existsSync(join(skillsDir, 'SKILL.md'))) {
    out.push({
      src: skillsDir,
      rel: relative(baseDir, skillsDir).split(sep).join('/'),
    });
    return out;
  }

  let entries = [];
  try { entries = readdirSync(skillsDir); } catch { return out; }
  for (const entry of entries) {
    collectSkillSourceDirs(join(skillsDir, entry), baseDir, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MirrorManifest
 * @property {string} version - QE Framework version at time of last apply
 * @property {string} codexSkillsDir - Absolute path to Codex skills directory
 * @property {string} repoRoot - Absolute path to repo root
 * @property {string} updatedAt - ISO timestamp
 * @property {string[]} managedLinks - Absolute paths of symlinks created by this script
 */

/**
 * Load the manifest, returning null if it does not exist or cannot be parsed.
 * @param {string} manifestPath
 * @returns {MirrorManifest|null}
 */
function loadManifest(manifestPath) {
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.managedLinks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the manifest.
 * @param {string} manifestPath
 * @param {MirrorManifest} manifest
 */
function saveManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/**
 * Read QE Framework version from package.json.
 * @param {string} repoRoot
 * @returns {string}
 */
function readPackageVersion(repoRoot) {
  try {
    const pkgPath = join(repoRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim();
    }
    return '[UNVERIFIED]';
  } catch {
    return '[UNVERIFIED]';
  }
}

// ---------------------------------------------------------------------------
// Symlink ownership classification
// ---------------------------------------------------------------------------

/**
 * Returns true if the path is a symlink (even a dangling one).
 * existsSync returns false for dangling symlinks.
 * @param {string} p
 * @returns {boolean}
 */
function isSymlinkAt(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Classify the ownership of a path that is a symlink.
 *
 * Returns:
 *  'managed'  - this script created it (in our managed set, or target matches expected)
 *  'foreign'  - symlink exists but not in our manifest and target differs
 *  'unknown'  - readlink fails
 *
 * @param {string} linkPath - Absolute path to the symlink
 * @param {string|null} expectedTarget - Absolute target path we would create
 * @param {Set<string>} managedSet - Set of resolved managed link paths from manifest
 * @returns {'managed'|'foreign'|'unknown'}
 */
function classifySymlink(linkPath, expectedTarget, managedSet) {
  try {
    const target = readlinkSync(linkPath);
    const absTarget = isAbsolute(target) ? target : resolve(dirname(linkPath), target);
    // If it matches our expected target → managed
    if (expectedTarget && absTarget === resolve(expectedTarget)) {
      return 'managed';
    }
    // If it's in our manifest by path → managed (target may have changed)
    if (managedSet.has(resolve(linkPath))) {
      return 'managed';
    }
    return 'foreign';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Core mirror logic
// ---------------------------------------------------------------------------

/**
 * Run the skill mirror operation.
 *
 * All paths are passed explicitly so this function is fully testable without
 * relying on module-level constants or environment variables.
 *
 * @param {object} opts
 * @param {boolean}  [opts.apply=false]          - If true, write symlinks; if false, dry-run
 * @param {Function} [opts.log]                  - Logger (default: console.log)
 * @param {string}   [opts.repoRoot]             - Repo root (default: DEFAULT_REPO_ROOT)
 * @param {string}   [opts.homeDir]              - Home directory (default: os.homedir())
 * @param {string}   [opts.codexSkillsDir]       - Override Codex skills target dir (for tests)
 * @param {string}   [opts.manifestPath]         - Override manifest file path (for tests)
 * @param {boolean}  [opts.allowUnverified=false] - If true, allow --apply even when path is
 *   an unverified override. Set ONLY by the programmatic/test API (explicit caller intent).
 *   CLI env-var overrides must NOT set this — they trigger abort on --apply.
 * @returns {object} Result summary
 */
export function runMirror({
  apply = false,
  log = console.log,
  repoRoot: repoRootOpt,
  homeDir: homeDirOpt,
  codexSkillsDir: codexSkillsDirOpt,
  manifestPath: manifestPathOpt,
  allowUnverified = false,
} = {}) {
  const isDryRun = !apply;

  // Resolve paths — explicit opts take priority over env vars, then defaults
  const repoRoot = repoRootOpt
    ? resolve(repoRootOpt)
    : (process.env.SKILL_MIRROR_REPO_ROOT ? resolve(process.env.SKILL_MIRROR_REPO_ROOT) : DEFAULT_REPO_ROOT);

  const homeDir = homeDirOpt || homedir();

  const realCodexSkillsPath = join(homeDir, '.codex', 'skills');
  const codexSkillsDir = codexSkillsDirOpt
    ? resolve(codexSkillsDirOpt)
    : (process.env.SKILL_MIRROR_TARGET_ROOT ? resolve(process.env.SKILL_MIRROR_TARGET_ROOT) : realCodexSkillsPath);

  const defaultManifestPath = resolve(repoRoot, '..', '.qe', 'state', 'skill-mirror-manifest.json');
  const manifestPath = manifestPathOpt
    ? resolve(manifestPathOpt)
    : (process.env.SKILL_MIRROR_MANIFEST ? resolve(process.env.SKILL_MIRROR_MANIFEST) : defaultManifestPath);

  // Whether this is a test override (i.e. codexSkillsDir was explicitly provided and differs from real)
  const isOverride = codexSkillsDir !== realCodexSkillsPath;

  const qeVersion = readPackageVersion(repoRoot);

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  log('');
  log('sync-skills-mirror — QE Framework Dual-Harness Skill Mirror');
  log(`  QE version : ${qeVersion}`);
  log(`  mode       : ${isDryRun ? 'dry-run (no changes)' : 'APPLY'}`);
  log(`  repoRoot   : ${repoRoot}`);
  log(`  targetDir  : ${codexSkillsDir}`);

  // -------------------------------------------------------------------------
  // Step 1: Validate Codex skills target path
  // -------------------------------------------------------------------------
  const codexBaseDir = join(homeDir, '.codex');

  if (!isOverride) {
    // Production path: check ~/.codex exists (gate per existsSync convention)
    if (!existsSync(codexBaseDir)) {
      log('');
      log('[skip] ~/.codex not found — not a Codex user machine. Skipping.');
      return { skipped: true, reason: 'no-codex-dir' };
    }

    // Verify target matches installCodexAssets() real path
    const resolvedTarget = resolve(codexSkillsDir);
    const resolvedReal = resolve(realCodexSkillsPath);
    if (resolvedTarget !== resolvedReal) {
      log('');
      log('[UNVERIFIED] Codex skills path mismatch.');
      log(`  Expected : ${resolvedReal}`);
      log(`  Got      : ${resolvedTarget}`);
      if (apply) {
        log('[abort] --apply rejected: Codex target path could not be verified against installCodexAssets() real path.');
        return { skipped: false, aborted: true, reason: 'path-unverified' };
      }
    } else {
      log(`  pathCheck  : verified (matches installCodexAssets target)`);
    }
  } else {
    // isOverride is true: codexSkillsDir was supplied and differs from the real ~/.codex/skills path.
    // Two sources:
    //   1. Programmatic param (codexSkillsDirOpt) with allowUnverified=true → sanctioned test path, allow.
    //   2. CLI env-var (SKILL_MIRROR_TARGET_ROOT) with allowUnverified=false → unverified, abort on --apply.
    if (allowUnverified) {
      log(`  pathCheck  : [UNVERIFIED] override active (programmatic/test path — apply allowed)`);
    } else {
      log(`  pathCheck  : [UNVERIFIED] override active (env/CLI override)`);
      if (apply) {
        log('[abort] --apply rejected: unverified CLI/env target override. ' +
            'Set SKILL_MIRROR_TARGET_ROOT to the real ~/.codex/skills path or omit the override.');
        return { skipped: false, aborted: true, reason: 'unverified-env-override' };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Discover skill sources
  // -------------------------------------------------------------------------
  const skillsSrcDir = join(repoRoot, 'skills');
  if (!existsSync(skillsSrcDir)) {
    log('');
    log(`[skip] skills/ directory not found at ${skillsSrcDir}`);
    return { skipped: true, reason: 'no-skills-dir' };
  }

  // Codex recursive discovery
  const codexSkills = collectSkillSourceDirs(skillsSrcDir);

  // Claude 1-level discovery (direct children with SKILL.md)
  const claudeSkills = (() => {
    const found = [];
    try {
      for (const entry of readdirSync(skillsSrcDir)) {
        const p = join(skillsSrcDir, entry);
        try {
          const st = lstatSync(p);
          if (st.isDirectory() && !st.isSymbolicLink() && existsSync(join(p, 'SKILL.md'))) {
            found.push({ src: p, rel: entry });
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore readdir error */ }
    return found;
  })();

  log('');
  log(`  skill discovery:`);
  log(`    Claude (1-level) : ${claudeSkills.length} skill(s)`);
  log(`    Codex (recursive): ${codexSkills.length} skill(s)`);

  if (codexSkills.length !== claudeSkills.length) {
    log(`    [note] discovery counts differ — nested skills present (Codex picks up sub-skills)`);
  }

  // -------------------------------------------------------------------------
  // Step 3: Load manifest and build managed-link set
  // -------------------------------------------------------------------------
  const manifest = loadManifest(manifestPath);
  const managedSet = manifest ? new Set(manifest.managedLinks.map((p) => resolve(p))) : new Set();

  if (!manifest) {
    log('');
    log('[warn] Manifest not found or unreadable — existing links treated as unmanaged orphans (prune disabled for them).');
  }

  // -------------------------------------------------------------------------
  // Step 4: Compute intended links
  // -------------------------------------------------------------------------
  const intended = codexSkills.map((skill) => ({
    linkPath: join(codexSkillsDir, ...skill.rel.split('/')),
    srcPath: resolve(skill.src),
    rel: skill.rel,
  }));

  // -------------------------------------------------------------------------
  // Step 5: Classify each intended link
  // -------------------------------------------------------------------------
  const toCreate = [];
  const toUpdate = [];
  const skipRealDir = [];
  const skipForeign = [];
  const skipUnknown = [];
  const alreadyCorrect = [];

  for (const { linkPath, srcPath, rel } of intended) {
    const linkExists = existsSync(linkPath) || isSymlinkAt(linkPath);

    if (!linkExists) {
      toCreate.push({ linkPath, srcPath, rel });
      continue;
    }

    let stat;
    try { stat = lstatSync(linkPath); } catch {
      toCreate.push({ linkPath, srcPath, rel });
      continue;
    }

    if (!stat.isSymbolicLink()) {
      // Real directory or non-symlink file: installer-owned, skip
      skipRealDir.push({ linkPath, srcPath, rel });
      continue;
    }

    // It's a symlink — classify ownership
    const ownership = classifySymlink(linkPath, srcPath, managedSet);
    if (ownership === 'foreign') {
      skipForeign.push({ linkPath, srcPath, rel });
      continue;
    }
    if (ownership === 'unknown') {
      skipUnknown.push({ linkPath, srcPath, rel });
      continue;
    }

    // managed symlink: check if target matches
    let currentTarget;
    try { currentTarget = readlinkSync(linkPath); } catch {
      toUpdate.push({ linkPath, srcPath, rel });
      continue;
    }
    const absCurrentTarget = isAbsolute(currentTarget)
      ? currentTarget
      : resolve(dirname(linkPath), currentTarget);

    if (absCurrentTarget === srcPath) {
      alreadyCorrect.push({ linkPath, srcPath, rel });
    } else {
      toUpdate.push({ linkPath, srcPath, rel });
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Compute prune candidates (managed links not in intended set)
  // -------------------------------------------------------------------------
  const intendedLinkPaths = new Set(intended.map((i) => resolve(i.linkPath)));
  const toPrune = [];
  const skipOutsideRoot = []; // F2: manifest entries that escape the target root

  // Resolved target root for containment checks (use realpathSync where the path
  // exists so a symlinked root directory is dereferenced — closes symlink-root escapes).
  // Both the root and each candidate link are normalized via the same strategy so that
  // tmpdir symlinks (common on macOS: /var/folders → /private/var/folders) don't cause
  // false mismatches.
  let resolvedTargetRoot;
  try {
    resolvedTargetRoot = realpathSync(codexSkillsDir);
  } catch {
    resolvedTargetRoot = resolve(codexSkillsDir);
  }
  const targetRootPrefix = resolvedTargetRoot + sep;

  if (manifest) {
    for (const managedLink of manifest.managedLinks) {
      const absLink = resolve(managedLink);

      // F2 containment: reject any manifest entry whose resolved path is not
      // strictly under the target root. Never unlink paths outside the root.
      // Normalize the candidate link via realpathSync on its parent directory
      // (the link itself may be dangling/not-yet-real). Fall back to resolve().
      let resolvedLink;
      try {
        // Try realpathSync on the parent dir to dereference any parent symlinks,
        // then re-join the basename so dangling/non-existent entries still work.
        const parentReal = realpathSync(dirname(absLink));
        resolvedLink = join(parentReal, basename(absLink));
      } catch {
        resolvedLink = absLink;
      }
      const isUnderRoot =
        resolvedLink === resolvedTargetRoot ||
        resolvedLink.startsWith(targetRootPrefix);
      if (!isUnderRoot) {
        skipOutsideRoot.push(absLink);
        log(`  [outside-target-root] manifest entry escapes target root — skipped: ${absLink}`);
        continue;
      }

      if (intendedLinkPaths.has(absLink)) continue;
      toPrune.push(absLink);
    }
  }

  // Report unmanaged symlinks in the target dir that point into our skills dir
  const unmanagedOrphans = [];
  if (existsSync(codexSkillsDir)) {
    try {
      for (const entry of readdirSync(codexSkillsDir)) {
        const p = join(codexSkillsDir, entry);
        let st;
        try { st = lstatSync(p); } catch { continue; }
        if (!st.isSymbolicLink()) continue;
        if (managedSet.has(resolve(p))) continue;
        try {
          const tgt = readlinkSync(p);
          const absTgt = isAbsolute(tgt) ? tgt : resolve(dirname(p), tgt);
          if (absTgt.startsWith(skillsSrcDir + sep) || absTgt === skillsSrcDir) {
            unmanagedOrphans.push({ linkPath: p, target: absTgt });
          }
        } catch { /* skip */ }
      }
    } catch { /* target dir may not exist yet */ }
  }

  // -------------------------------------------------------------------------
  // Step 7: Report plan
  // -------------------------------------------------------------------------
  log('');
  log('--- Plan ---');
  log(`  to create  : ${toCreate.length}`);
  log(`  to update  : ${toUpdate.length}`);
  log(`  correct    : ${alreadyCorrect.length}`);
  log(`  to prune   : ${toPrune.length}`);
  log(`  skip (real dir/file, installer-owned) : ${skipRealDir.length}`);
  log(`  skip (foreign symlink) : ${skipForeign.length}`);
  log(`  skip (outside-target-root, manifest poisoning rejected) : ${skipOutsideRoot.length}`);
  log(`  unmanaged orphans (manifest-loss residual) : ${unmanagedOrphans.length}`);

  if (toCreate.length > 0) {
    log('');
    log('  [create]');
    for (const { rel, linkPath, srcPath } of toCreate) {
      log(`    ${rel}: ${linkPath} -> ${srcPath}`);
    }
  }
  if (toUpdate.length > 0) {
    log('');
    log('  [update]');
    for (const { rel, linkPath, srcPath } of toUpdate) {
      log(`    ${rel}: ${linkPath} -> ${srcPath}`);
    }
  }
  if (toPrune.length > 0) {
    log('');
    log('  [prune]');
    for (const p of toPrune) {
      log(`    ${p}`);
    }
  }
  if (skipRealDir.length > 0) {
    log('');
    log('  [skip — installer real asset, will NOT overwrite]');
    for (const { linkPath, rel } of skipRealDir) {
      log(`    ${rel}: ${linkPath} (real dir or non-symlink file)`);
    }
  }
  if (skipForeign.length > 0) {
    log('');
    log('  [skip — foreign symlink (other repo or user)]');
    for (const { linkPath, rel } of skipForeign) {
      log(`    ${rel}: ${linkPath}`);
    }
  }
  if (skipUnknown.length > 0) {
    log('');
    log('  [skip — symlink ownership unknown (readlink failed)]');
    for (const { linkPath, rel } of skipUnknown) {
      log(`    ${rel}: ${linkPath}`);
    }
  }
  if (unmanagedOrphans.length > 0) {
    log('');
    log('  [unmanaged orphans — manifest loss residual, reported only, not pruned]');
    for (const { linkPath, target } of unmanagedOrphans) {
      log(`    ${linkPath} -> ${target}`);
    }
  }

  if (isDryRun) {
    log('');
    log('--- dry-run complete (no changes made) ---');
    log('    Re-run with --apply to write symlinks.');
    return {
      dryRun: true,
      skipped: false,
      plan: {
        create: toCreate.length,
        update: toUpdate.length,
        prune: toPrune.length,
        correct: alreadyCorrect.length,
        skipRealDir: skipRealDir.length,
        skipForeign: skipForeign.length,
        unmanagedOrphans: unmanagedOrphans.length,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Step 8: Apply — validate target accessibility
  // -------------------------------------------------------------------------
  if (!isOverride) {
    if (!existsSync(codexBaseDir)) {
      log('[abort] --apply: ~/.codex not found at apply time.');
      return { skipped: false, aborted: true, reason: 'no-codex-dir-at-apply' };
    }
  }
  // Ensure target dir exists (always — also for test override)
  mkdirSync(codexSkillsDir, { recursive: true });

  const appliedCreate = [];
  const appliedUpdate = [];
  const appliedPrune = [];
  const errors = [];

  // Create new symlinks
  for (const { linkPath, srcPath, rel } of toCreate) {
    try {
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(srcPath, linkPath);
      log(`  [create] ${rel}: ${linkPath} -> ${srcPath}`);
      appliedCreate.push(resolve(linkPath));
    } catch (e) {
      log(`  [error] create ${rel}: ${e.message}`);
      errors.push({ op: 'create', linkPath, error: e.message });
    }
  }

  // Update existing managed symlinks with wrong target
  for (const { linkPath, srcPath, rel } of toUpdate) {
    try {
      // F2 TOCTOU: re-lstat immediately before unlinkSync to ensure it is still a symlink.
      let stBefore;
      try { stBefore = lstatSync(linkPath); } catch { stBefore = null; }
      if (stBefore && !stBefore.isSymbolicLink()) {
        log(`  [skip-update] ${rel}: ${linkPath} is no longer a symlink at apply time, skipping`);
        continue;
      }
      unlinkSync(linkPath);
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(srcPath, linkPath);
      log(`  [update] ${rel}: ${linkPath} -> ${srcPath}`);
      appliedUpdate.push(resolve(linkPath));
    } catch (e) {
      log(`  [error] update ${rel}: ${e.message}`);
      errors.push({ op: 'update', linkPath, error: e.message });
    }
  }

  // Prune stale managed symlinks (only manifest-declared)
  for (const linkPath of toPrune) {
    try {
      // F2 TOCTOU: re-lstat immediately before unlinkSync (minimise race window).
      const st = lstatSync(linkPath);
      if (!st.isSymbolicLink()) {
        log(`  [skip-prune] ${linkPath} is no longer a symlink, skipping prune`);
        continue;
      }
      unlinkSync(linkPath);
      log(`  [prune] removed stale managed symlink: ${linkPath}`);
      appliedPrune.push(linkPath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        appliedPrune.push(linkPath);
        continue;
      }
      log(`  [error] prune ${linkPath}: ${e.message}`);
      errors.push({ op: 'prune', linkPath, error: e.message });
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: Update manifest
  // -------------------------------------------------------------------------
  const newManagedLinks = [
    ...alreadyCorrect.map((i) => resolve(i.linkPath)),
    ...appliedCreate,
    ...appliedUpdate,
  ].sort();

  const newManifest = {
    version: qeVersion,
    codexSkillsDir: resolve(codexSkillsDir),
    repoRoot: resolve(repoRoot),
    updatedAt: new Date().toISOString(),
    managedLinks: newManagedLinks,
  };

  try {
    saveManifest(manifestPath, newManifest);
    log(`  [manifest] written: ${manifestPath}`);
  } catch (e) {
    log(`  [warn] could not write manifest: ${e.message}`);
  }

  log('');
  log('--- apply complete ---');
  log(`  created : ${appliedCreate.length}`);
  log(`  updated : ${appliedUpdate.length}`);
  log(`  pruned  : ${appliedPrune.length}`);
  log(`  errors  : ${errors.length}`);

  return {
    dryRun: false,
    skipped: false,
    applied: {
      create: appliedCreate.length,
      update: appliedUpdate.length,
      prune: appliedPrune.length,
      errors: errors.length,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  // Read CLI env overrides here (not at module level) so they're used for the
  // single CLI invocation and not embedded in cached module constants.
  // NOTE: allowUnverified is intentionally NOT set here — CLI/env-var overrides
  // are [UNVERIFIED] and must abort on --apply (Fix 1 / V17 contract).
  const cliOpts = {
    apply,
    repoRoot: process.env.SKILL_MIRROR_REPO_ROOT || undefined,
    codexSkillsDir: process.env.SKILL_MIRROR_TARGET_ROOT || undefined,
    manifestPath: process.env.SKILL_MIRROR_MANIFEST || undefined,
    // allowUnverified: false (default) — env-var override → abort on --apply
  };

  const result = runMirror(cliOpts);
  if (result.aborted) {
    process.exit(1);
  }
}
