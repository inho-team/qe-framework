/**
 * sync-skills-mirror.test.mjs
 *
 * Tests for sync-skills-mirror.mjs using temporary directory fixtures.
 *
 * NEVER touches real ~/.codex — all tests pass explicit tmpdir paths to runMirror()
 * via the codexSkillsDir / manifestPath / repoRoot parameters (testability contract).
 *
 * Contract under test (R007):
 *  - dry-run is the default; apply:true is required to write symlinks
 *  - Claude (1-level) vs Codex (recursive) discovery difference is absorbed
 *  - Real dir / non-symlink file collision: installer-owned, skip + report (V27)
 *  - User (foreign) symlink: skip + report
 *  - Broken managed link: prune on --apply
 *  - Foreign link in target dir: skip + report
 *  - dry-run causes zero filesystem changes
 *  - --apply idempotency: two runs produce diff=0 (V18)
 *  - manifest-loss: existing links become unmanaged orphans, reported but not pruned
 *  - validated client version field in output (V19)
 *  - [UNVERIFIED] shown for test-override path (V17 / V19)
 *
 * Run with: node --test scripts/lib/__tests__/sync-skills-mirror.test.mjs
 * (from qe-framework/ directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Import runMirror once — it is pure with respect to paths (accepts explicit opts)
import { runMirror } from '../../sync-skills-mirror.mjs';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal repo root fixture with named skill directories.
 * Each skill gets a SKILL.md file so it is discovered by both Claude and Codex.
 * Nested skills (e.g. 'parent/child') are created under a subdirectory within skills/.
 *
 * @param {string} tmpBase
 * @param {string[]} skillNames - top-level skill dir names
 * @param {object} [opts]
 * @param {string[]} [opts.nestedSkills] - slash-separated relative paths under skills/
 * @returns {string} repoRoot path
 */
function makeRepoFixture(tmpBase, skillNames, { nestedSkills = [] } = {}) {
  const repoRoot = path.join(tmpBase, 'fake-repo');
  const skillsDir = path.join(repoRoot, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  for (const name of skillNames) {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${name}\n`, 'utf8');
  }

  for (const relPath of nestedSkills) {
    const parts = relPath.split('/');
    const skillDir = path.join(skillsDir, ...parts);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${parts[parts.length - 1]}\n`, 'utf8');
  }

  // package.json with a test version
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'test-qe', version: '0.0.0-test' }, null, 2),
    'utf8',
  );

  return repoRoot;
}

/**
 * Create the Codex skills target directory within a temp home.
 * @param {string} tmpBase
 * @returns {{ targetDir: string }}
 */
function makeTargetDir(tmpBase) {
  const targetDir = path.join(tmpBase, 'fake-codex', 'skills');
  fs.mkdirSync(targetDir, { recursive: true });
  return { targetDir };
}

/**
 * Create a manifest path inside tmpBase.
 * @param {string} tmpBase
 * @returns {string}
 */
function makeManifestPath(tmpBase) {
  const stateDir = path.join(tmpBase, '.qe', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, 'skill-mirror-manifest.json');
}

/**
 * Collect all entries in a directory that are symlinks (shallow).
 * @param {string} dir
 * @returns {string[]} absolute paths of symlinks
 */
function collectSymlinks(dir) {
  const links = [];
  if (!fs.existsSync(dir)) return links;
  try {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      try {
        if (fs.lstatSync(p).isSymbolicLink()) links.push(p);
      } catch { /* skip */ }
    }
  } catch { /* dir may not exist */ }
  return links;
}

/**
 * Convenience wrapper: call runMirror with explicit fixture paths.
 * Never sets or reads env vars — paths are explicit.
 * Passes allowUnverified:true because these are programmatic test-path overrides
 * (explicit caller intent), not unverified CLI/env-var overrides.
 */
function mirrorFixture({ repoRoot, targetDir, manifestPath, apply = false, logs = [] }) {
  return runMirror({
    apply,
    log: (msg) => logs.push(msg),
    repoRoot,
    codexSkillsDir: targetDir,
    manifestPath,
    allowUnverified: true,
  });
}

// ---------------------------------------------------------------------------
// (A) dry-run default: no filesystem changes
// ---------------------------------------------------------------------------

test('(A) dry-run default: no symlinks created, no manifest written', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-A-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qtest-A1', 'Qtest-A2']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);
  const logs = [];

  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: false, logs });

  // No symlinks in target dir
  assert.equal(collectSymlinks(targetDir).length, 0, 'dry-run: no symlinks created');

  // Manifest not written (the state dir exists but manifest file must not)
  assert.ok(!fs.existsSync(manifestPath), 'dry-run: manifest file not written');

  // Result shape
  assert.equal(result.dryRun, true, 'result.dryRun is true');
  assert.ok(result.plan, 'result has plan field');
  assert.ok(result.plan.create >= 2, 'plan.create >= 2 (two skills to create)');

  // Output mentions dry-run
  const allLogs = logs.join('\n');
  assert.ok(allLogs.includes('dry-run'), 'output contains "dry-run"');
});

// ---------------------------------------------------------------------------
// (B) --apply creates symlinks with absolute targets
// ---------------------------------------------------------------------------

test('(B) --apply creates symlinks pointing to absolute source paths', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-B-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qskill-B1', 'Qskill-B2']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Symlinks must exist
  const symlinks = collectSymlinks(targetDir);
  assert.ok(symlinks.length >= 2, `--apply: at least 2 symlinks created (got ${symlinks.length})`);

  // All targets must be absolute paths
  for (const link of symlinks) {
    const target = fs.readlinkSync(link);
    assert.ok(path.isAbsolute(target), `symlink target is absolute: ${link} -> ${target}`);
  }

  // Targets must point to dirs containing SKILL.md
  for (const link of symlinks) {
    const target = fs.readlinkSync(link);
    assert.ok(
      fs.existsSync(path.join(target, 'SKILL.md')),
      `SKILL.md exists at target: ${target}`,
    );
  }

  // Manifest must be written
  assert.ok(fs.existsSync(manifestPath), '--apply: manifest file written');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.managedLinks), 'manifest.managedLinks is an array');
  assert.ok(manifest.managedLinks.length >= 2, 'at least 2 managed links recorded');
  for (const link of manifest.managedLinks) {
    assert.ok(path.isAbsolute(link), `manifest link is absolute: ${link}`);
  }

  assert.equal(result.dryRun, false, 'result.dryRun is false');
  assert.ok(result.applied.create >= 2, 'applied.create >= 2');
});

// ---------------------------------------------------------------------------
// (C) --apply idempotency: two consecutive runs produce diff=0 (R007 / V18)
// ---------------------------------------------------------------------------

test('(C) --apply idempotency: second run creates/updates/prunes nothing (R007)', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-C-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qidem-C1', 'Qidem-C2', 'Qidem-C3']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // First run
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  const linksAfterFirst = collectSymlinks(targetDir).sort();
  const targets1 = linksAfterFirst.map((l) => fs.readlinkSync(l)).sort();
  const manifest1 = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Second run
  const result2 = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  const linksAfterSecond = collectSymlinks(targetDir).sort();
  const targets2 = linksAfterSecond.map((l) => fs.readlinkSync(l)).sort();
  const manifest2 = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.deepEqual(linksAfterSecond, linksAfterFirst, 'idempotency: same symlinks after 2nd run');
  assert.deepEqual(targets2, targets1, 'idempotency: same targets after 2nd run');
  assert.deepEqual(
    [...manifest2.managedLinks].sort(),
    [...manifest1.managedLinks].sort(),
    'idempotency: manifest unchanged after 2nd run',
  );

  assert.equal(result2.applied.create, 0, '2nd run: create=0');
  assert.equal(result2.applied.update, 0, '2nd run: update=0');
  assert.equal(result2.applied.prune, 0, '2nd run: prune=0');
});

// ---------------------------------------------------------------------------
// (D) Real dir collision: installer-owned, skip + report; never overwrite (V27)
// ---------------------------------------------------------------------------

test('(D) real dir at target position: installer-owned, skip + report, no overwrite (V27)', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-D-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qconflict-D', 'Qclean-D']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // Pre-seed a real directory (installer-owned) at the conflict target position
  const conflictPath = path.join(targetDir, 'Qconflict-D');
  fs.mkdirSync(conflictPath, { recursive: true });
  fs.writeFileSync(path.join(conflictPath, 'SKILL.md'), '# installer real copy\n', 'utf8');
  fs.writeFileSync(path.join(conflictPath, 'real-asset.txt'), 'real data', 'utf8');

  const logs = [];
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true, logs });

  // Real dir must still be a real dir (not replaced with symlink)
  const conflictStat = fs.lstatSync(conflictPath);
  assert.ok(!conflictStat.isSymbolicLink(), 'real dir was NOT replaced with symlink');
  assert.ok(conflictStat.isDirectory(), 'real dir is still a directory');
  assert.ok(
    fs.existsSync(path.join(conflictPath, 'real-asset.txt')),
    'installer file inside real dir preserved',
  );

  // The clean skill should have been symlinked
  const cleanLink = path.join(targetDir, 'Qclean-D');
  assert.ok(fs.lstatSync(cleanLink).isSymbolicLink(), 'non-conflicting skill was symlinked');

  // Output must report the skip
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.includes('installer') || allLogs.includes('real') || allLogs.includes('skip'),
    'output reports installer-owned skip',
  );
});

// ---------------------------------------------------------------------------
// (E) Foreign symlink preservation: user-created symlink skipped, not removed
// ---------------------------------------------------------------------------

test('(E) foreign (user) symlink at target: skip + report, not removed', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-E-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Quser-E', 'Qclean-E']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // Pre-seed a foreign symlink (user-created, pointing to an external target)
  const userLinkPath = path.join(targetDir, 'Quser-E');
  const externalTarget = path.join(tmpBase, 'external-skill-E');
  fs.mkdirSync(externalTarget, { recursive: true });
  fs.writeFileSync(path.join(externalTarget, 'SKILL.md'), '# external\n', 'utf8');
  fs.symlinkSync(externalTarget, userLinkPath);

  const logs = [];
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true, logs });

  // User symlink must still point to the external target
  assert.ok(fs.lstatSync(userLinkPath).isSymbolicLink(), 'foreign symlink still exists');
  const rawTarget = fs.readlinkSync(userLinkPath);
  const absTarget = path.isAbsolute(rawTarget)
    ? rawTarget
    : path.resolve(path.dirname(userLinkPath), rawTarget);
  assert.equal(absTarget, externalTarget, 'foreign symlink still points to external target');

  // Output must report the skip
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.includes('foreign') || allLogs.includes('skip'),
    'output reports foreign symlink skip',
  );
});

// ---------------------------------------------------------------------------
// (F) Broken managed symlink: pruned on --apply
// ---------------------------------------------------------------------------

test('(F) broken managed symlink: pruned on --apply', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-F-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qskill-F']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // First apply — creates managed symlink for Qskill-F
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Manually create a dangling (broken) symlink and add it to the manifest
  const staleLink = path.join(targetDir, 'Qstale-F');
  const nonExistentTarget = path.join(repoRoot, 'skills', 'Qstale-F');
  fs.symlinkSync(nonExistentTarget, staleLink); // dangling — target does not exist

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.managedLinks.push(path.resolve(staleLink));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Second apply — should prune the stale managed symlink
  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Stale symlink must be gone
  let staleExists = false;
  try { fs.lstatSync(staleLink); staleExists = true; } catch { /* ENOENT → pruned */ }
  assert.ok(!staleExists, 'broken managed symlink was pruned');

  assert.ok(result.applied.prune >= 1, 'applied.prune >= 1');
});

// ---------------------------------------------------------------------------
// (G) Manifest-loss: existing links become unmanaged orphans, reported not pruned
// ---------------------------------------------------------------------------

test('(G) manifest-loss: orphan links reported but not pruned (accepted residual)', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-G-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qorphan-G']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // First apply
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Delete the manifest (simulate manifest loss)
  fs.unlinkSync(manifestPath);
  assert.ok(!fs.existsSync(manifestPath), 'manifest deleted');

  // Second apply without manifest — orphan should NOT be pruned
  const logs = [];
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true, logs });

  // The previously created symlink must still exist
  const orphanLink = path.join(targetDir, 'Qorphan-G');
  assert.ok(fs.lstatSync(orphanLink).isSymbolicLink(), 'orphan symlink still exists after manifest-loss');

  // Output must mention manifest or unmanaged
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.toLowerCase().includes('manifest') || allLogs.toLowerCase().includes('unmanaged'),
    'output mentions manifest loss or unmanaged state',
  );
});

// ---------------------------------------------------------------------------
// (H) Claude (1-level) vs Codex (recursive) discovery difference absorbed
// ---------------------------------------------------------------------------

test('(H) Claude 1-level vs Codex recursive discovery: nested skills picked up by Codex', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-H-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  // Top-level skill: both Claude and Codex discover it
  // Nested skill under a parent dir: only Codex discovers it recursively
  const repoRoot = makeRepoFixture(tmpBase, ['Qtop-H'], {
    nestedSkills: ['Qparent-H/Qnested-H'],
  });
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  const logs = [];
  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: false, logs });

  const allLogs = logs.join('\n');

  // Both top-level and nested skill must appear in plan
  assert.ok(allLogs.includes('Qtop-H'), 'top-level skill appears in plan');
  // Codex recursive discovery finds the nested skill (Qnested-H inside Qparent-H)
  assert.ok(
    allLogs.includes('Qnested-H') || result.plan.create >= 2,
    'nested skill discovered by Codex recursive traversal',
  );

  // Discovery counts must be reported
  assert.ok(allLogs.includes('Claude (1-level)'), 'Claude discovery count reported');
  assert.ok(allLogs.includes('Codex (recursive)'), 'Codex discovery count reported');
});

// ---------------------------------------------------------------------------
// (I) Version field in header output (V19)
// ---------------------------------------------------------------------------

test('(I) validated client version field appears in output header (V19)', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-I-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qver-I']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);
  const logs = [];

  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: false, logs });

  const allLogs = logs.join('\n');

  // Version from our fixture's package.json is '0.0.0-test'
  assert.ok(allLogs.includes('0.0.0-test'), 'version from package.json appears in output');
  assert.ok(allLogs.includes('QE version'), 'QE version label appears in header');
});

// ---------------------------------------------------------------------------
// (J) [UNVERIFIED] shown when override active (V17 / V19)
// ---------------------------------------------------------------------------

test('(J) [UNVERIFIED] shown for path check when override (test) target active', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-J-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qcheck-J']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);
  const logs = [];

  // Test override path differs from real ~/.codex/skills → [UNVERIFIED] in output
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: false, logs });

  const allLogs = logs.join('\n');
  assert.ok(allLogs.includes('[UNVERIFIED]'), '[UNVERIFIED] appears when override path active');
});

// ---------------------------------------------------------------------------
// (K) Manifest contents: absolute paths, version, codexSkillsDir, repoRoot
// ---------------------------------------------------------------------------

test('(K) manifest after --apply has absolute paths and all required metadata fields', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-K-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qmeta-K1', 'Qmeta-K2']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(typeof manifest.version === 'string', 'manifest.version present');
  assert.ok(typeof manifest.codexSkillsDir === 'string', 'manifest.codexSkillsDir present');
  assert.ok(typeof manifest.repoRoot === 'string', 'manifest.repoRoot present');
  assert.ok(typeof manifest.updatedAt === 'string', 'manifest.updatedAt present');
  assert.ok(Array.isArray(manifest.managedLinks), 'manifest.managedLinks is array');
  assert.ok(manifest.managedLinks.length >= 2, 'at least 2 managed links');

  for (const link of manifest.managedLinks) {
    assert.ok(path.isAbsolute(link), `managed link is absolute: ${link}`);
  }
  assert.ok(path.isAbsolute(manifest.codexSkillsDir), 'codexSkillsDir is absolute');
  assert.ok(path.isAbsolute(manifest.repoRoot), 'repoRoot is absolute');
});

// ---------------------------------------------------------------------------
// (L) Prune scope: only manifest-declared symlinks; user symlinks preserved
// ---------------------------------------------------------------------------

test('(L) prune only removes manifest-declared symlinks, user symlinks untouched', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-L-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qskill-L']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // First apply — creates managed symlink for Qskill-L
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Add a user symlink (not in manifest)
  const userLink = path.join(targetDir, 'user-own-link');
  const userTarget = path.join(tmpBase, 'user-stuff');
  fs.mkdirSync(userTarget, { recursive: true });
  fs.symlinkSync(userTarget, userLink);

  // Add a stale managed link (dangling) to the manifest
  const staleLink = path.join(targetDir, 'Qstale-L');
  fs.symlinkSync(path.join(repoRoot, 'skills', 'Qstale-L'), staleLink);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.managedLinks.push(path.resolve(staleLink));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Second apply — prune stale, keep user link
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // User symlink must survive
  assert.ok(fs.lstatSync(userLink).isSymbolicLink(), 'user symlink preserved');

  // Stale managed symlink must be gone
  let staleExists = false;
  try { fs.lstatSync(staleLink); staleExists = true; } catch { /* ENOENT → pruned */ }
  assert.ok(!staleExists, 'stale managed symlink pruned');
});

// ---------------------------------------------------------------------------
// (V17) CLI-style unverified env override + --apply → abort, no fs changes
// ---------------------------------------------------------------------------

test('(V17) CLI env-var override + apply:true → abort, no symlinks created', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-V17-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qabort-V17']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);
  const logs = [];

  // Simulate CLI env-var override: pass codexSkillsDir but omit allowUnverified (defaults false)
  const result = runMirror({
    apply: true,
    log: (msg) => logs.push(msg),
    repoRoot,
    codexSkillsDir: targetDir,
    manifestPath,
    // allowUnverified intentionally omitted → defaults false → CLI/env-var path → must abort
  });

  // Must abort
  assert.equal(result.aborted, true, 'result.aborted must be true for unverified env override');
  assert.ok(!result.skipped, 'result.skipped must be false (aborted, not skipped)');

  // No symlinks must have been created
  const symlinks = collectSymlinks(targetDir);
  assert.equal(symlinks.length, 0, 'no symlinks created when aborted');

  // Manifest must NOT be written
  assert.ok(!fs.existsSync(manifestPath), 'manifest not written when aborted');

  // Output must mention abort or unverified
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.includes('[abort]') || allLogs.includes('[UNVERIFIED]'),
    'output mentions abort or UNVERIFIED',
  );
});

// ---------------------------------------------------------------------------
// (M) Fixture isolation: all tests use explicit override paths (not real ~/.codex)
// ---------------------------------------------------------------------------

test('(M) fixture isolation: runMirror with override paths never touches real ~/.codex', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-M-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qisolate-M']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // Run with explicit override paths
  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: false });

  // Result is dry-run (not skipped)
  assert.equal(result.dryRun, true, 'dry-run result');
  assert.ok(!result.skipped, 'not skipped when override paths supplied');

  // Verify targetDir is inside tmpBase, not under real home
  const home = os.homedir();
  assert.ok(!targetDir.startsWith(home), 'targetDir is not under real home directory');
});

// ---------------------------------------------------------------------------
// (O) F2: Poisoned manifest entry pointing outside fixture root → skipped,
//         reported as outside-target-root, target file untouched
// ---------------------------------------------------------------------------

test('(O) F2 prune containment: poisoned manifest entry outside target root → skipped, file untouched', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-O-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qskill-O']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // First apply — creates the managed symlink for Qskill-O
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true });

  // Create a file OUTSIDE the target root that a poisoned manifest entry would
  // attempt to unlink.
  const outsideDir = path.join(tmpBase, 'outside-root');
  fs.mkdirSync(outsideDir, { recursive: true });
  const poisonTarget = path.join(outsideDir, 'important-file.txt');
  fs.writeFileSync(poisonTarget, 'must-not-be-deleted', 'utf8');

  // Inject a poisoned manifest entry pointing to the outside file
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.managedLinks.push(poisonTarget); // absolute path outside targetDir
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const logs = [];
  const result = mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true, logs });

  // The outside file must be untouched
  assert.ok(fs.existsSync(poisonTarget), 'outside-root file must NOT be deleted');
  assert.equal(
    fs.readFileSync(poisonTarget, 'utf8'),
    'must-not-be-deleted',
    'file contents unchanged after poisoned manifest run',
  );

  // The poisoned entry must have been skipped (prune=0 for it; legitimate prune unaffected)
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.includes('outside-target-root') || allLogs.includes('outside'),
    `output must report outside-target-root skip: ${allLogs}`,
  );

  // The legitimate skill symlink must still be present
  const skillLink = path.join(targetDir, 'Qskill-O');
  assert.ok(fs.lstatSync(skillLink).isSymbolicLink(), 'legitimate skill symlink still exists');
});

// ---------------------------------------------------------------------------
// (N) Non-symlink file at target: skip + report, file content preserved
// ---------------------------------------------------------------------------

test('(N) non-symlink file at target position: skip + report, content unchanged', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-N-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  const repoRoot = makeRepoFixture(tmpBase, ['Qfile-N', 'Qclean-N']);
  const { targetDir } = makeTargetDir(tmpBase);
  const manifestPath = makeManifestPath(tmpBase);

  // Pre-seed a regular file (not a directory, not a symlink) at the conflict position
  const conflictFile = path.join(targetDir, 'Qfile-N');
  fs.writeFileSync(conflictFile, 'non-symlink installer file', 'utf8');

  const logs = [];
  mirrorFixture({ repoRoot, targetDir, manifestPath, apply: true, logs });

  // Regular file must not be replaced
  const stat = fs.lstatSync(conflictFile);
  assert.ok(!stat.isSymbolicLink(), 'non-symlink file not replaced with symlink');
  assert.ok(stat.isFile(), 'still a regular file');
  assert.equal(
    fs.readFileSync(conflictFile, 'utf8'),
    'non-symlink installer file',
    'file contents unchanged',
  );

  // Clean skill must be symlinked
  const cleanLink = path.join(targetDir, 'Qclean-N');
  assert.ok(fs.lstatSync(cleanLink).isSymbolicLink(), 'non-conflicting skill symlinked');

  // Output must report skip
  const allLogs = logs.join('\n');
  assert.ok(
    allLogs.includes('skip') || allLogs.includes('installer') || allLogs.includes('real'),
    'output reports skip for non-symlink file collision',
  );
});
