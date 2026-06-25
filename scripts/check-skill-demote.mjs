#!/usr/bin/env node
/**
 * check-skill-demote.mjs (guard — auto-discovered by check-all.mjs)
 *
 * Self-contained contract test for the ADR-025 qe-diet Phase 3 demotion mechanism.
 * Builds throwaway fixture repos (fake plugin.json, fake skill dirs at flat +
 * depth-3, duplicate basenames, tier:core, no-tier, fake manifests) and exercises
 * the exported functions. NEVER mutates the real skills/ tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mod = await import(join(__dirname, 'skill-demote.mjs'));
const { makeConfig, isInsideCatalog, catalogRoots, demote, restore, list, loadManifest, tierOf, DemoteError } = mod;

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const throws = (fn, rx, msg) => {
  try { fn(); failures.push(`${msg} (expected throw, none)`); }
  catch (e) { if (rx && !rx.test(e.message)) failures.push(`${msg} (wrong error: ${e.message})`); }
};

/** Build a fresh fixture repo; returns its root path. */
function mkFixture(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qe-demote-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ skills: ['./skills/', './skills/coding-experts/quality/'] }));
  const mkSkill = (rel, frontmatter) => {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: x\n${frontmatter || ''}---\nbody of ${rel}\n`);
  };
  mkSkill('skills/Qflat', '');                                  // no tier → demotable
  mkSkill('skills/coding-experts/quality/Qnested', '');         // depth-3 nested
  mkSkill('skills/Qcoreskill', 'tier: core\n');                 // core → refused
  if (opts.dup) { mkSkill('skills/Dup', ''); mkSkill('skills/coding-experts/quality/Dup', ''); }
  mkdirSync(join(root, 'skills-optional'), { recursive: true });
  writeFileSync(join(root, 'skills-optional', 'DEMOTED.json'),
    JSON.stringify(opts.manifest || { version: 1, demoted: {} }, null, 2));
  return root;
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

// 1. path-segment containment (the skills vs skills-optional prefix trap)
{
  const root = mkFixture(); const cfg = makeConfig(root); const roots = catalogRoots(cfg);
  try {
    expect(isInsideCatalog(join(root, 'skills', 'Qflat'), roots) === true, '[containment] skills/Qflat not inside catalog');
    expect(isInsideCatalog(join(root, 'skills-optional', 'Qfoo'), roots) === false, '[containment] skills-optional/Qfoo WRONGLY inside catalog (startsWith trap)');
  } finally { cleanup(root); }
}

// 2. bare-name ambiguity → reject with candidates
{
  const root = mkFixture({ dup: true }); const cfg = makeConfig(root);
  try { throws(() => demote('Dup', cfg), /ambiguous/, '[ambiguity] duplicate basename not rejected'); }
  finally { cleanup(root); }
}

// 3. nested depth-3 round-trip → byte-identical, exact original path
{
  const root = mkFixture(); const cfg = makeConfig(root);
  try {
    const orig = join(root, 'skills/coding-experts/quality/Qnested/SKILL.md');
    const before = readFileSync(orig, 'utf8');
    const d = demote('Qnested', cfg);
    expect(d.originalPath === 'skills/coding-experts/quality/Qnested', `[nested] wrong originalPath: ${d.originalPath}`);
    expect(existsSync(join(root, 'skills-optional/Qnested/SKILL.md')), '[nested] not moved to skills-optional');
    expect(!existsSync(orig), '[nested] original still present after demote');
    restore('Qnested', cfg);
    expect(existsSync(orig), '[nested] not restored to exact original path');
    expect(readFileSync(orig, 'utf8') === before, '[nested] restored content not byte-identical');
    expect(Object.keys(loadManifest(cfg).demoted).length === 0, '[nested] manifest not empty after restore');
  } finally { cleanup(root); }
}

// 4. tier:core refused, no-tier allowed
{
  const root = mkFixture(); const cfg = makeConfig(root);
  try {
    expect(tierOf(join(root, 'skills/Qcoreskill/SKILL.md')) === 'core', '[tier] core not parsed');
    throws(() => demote('Qcoreskill', cfg), /core/, '[tier] core skill not refused');
    const d = demote('Qflat', cfg);   // no-tier → allowed
    expect(d.base === 'Qflat', '[tier] no-tier skill not demotable');
  } finally { cleanup(root); }
}

// 5. atomic rollback on manifest-write failure → skill intact, dest gone, manifest unchanged
{
  const root = mkFixture();
  const cfg = makeConfig(root, { writeManifest: () => { throw new Error('disk full'); } });
  try {
    throws(() => demote('Qflat', cfg), /rolled back/, '[atomic] write failure did not roll back');
    expect(existsSync(join(root, 'skills/Qflat/SKILL.md')), '[atomic] skill lost after rollback');
    expect(!existsSync(join(root, 'skills-optional/Qflat')), '[atomic] dest dir left behind after rollback');
    expect(Object.keys(loadManifest(cfg).demoted).length === 0, '[atomic] manifest changed despite rollback');
  } finally { cleanup(root); }
}

// 6. EXDEV → reject, no copy+unlink, no partial
{
  const root = mkFixture();
  const cfg = makeConfig(root, { rename: () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; } });
  try {
    throws(() => demote('Qflat', cfg), /EXDEV/, '[exdev] not rejected');
    expect(existsSync(join(root, 'skills/Qflat/SKILL.md')), '[exdev] skill lost');
    expect(!existsSync(join(root, 'skills-optional/Qflat')), '[exdev] partial dest created');
  } finally { cleanup(root); }
}

// 7. manifest corruption → non-zero (throws)
for (const [bad, label] of [
  ['{not json', 'non-JSON'],
  [JSON.stringify({ demoted: {} }), 'missing version'],
  [JSON.stringify({ version: 1 }), 'missing demoted'],
  [JSON.stringify({ version: 9, demoted: {} }), 'wrong version'],
  [JSON.stringify({ version: 1, demoted: [] }), 'demoted not object'],
]) {
  const root = mkFixture();
  try {
    writeFileSync(join(root, 'skills-optional', 'DEMOTED.json'), bad);
    throws(() => loadManifest(makeConfig(root)), /manifest/, `[manifest] ${label} not rejected`);
  } finally { cleanup(root); }
}

// 8. out-of-sync manifest (entry points at missing dir) → integrity failure on list/restore
{
  const root = mkFixture({ manifest: { version: 1, demoted: { Ghost: { originalPath: 'skills/Ghost', demotedPath: 'skills-optional/Ghost' } } } });
  const cfg = makeConfig(root);
  try {
    throws(() => list(cfg), /integrity/, '[out-of-sync] list did not report integrity failure');
    throws(() => restore('Ghost', cfg), /integrity/, '[out-of-sync] restore did not report integrity failure');
  } finally { cleanup(root); }
}

// 9. empty-set no-op + deterministic key ordering
{
  const root = mkFixture(); const cfg = makeConfig(root);
  try {
    expect(list(cfg).length === 0, '[empty] non-empty list on fresh fixture');
    demote('Qnested', cfg); demote('Qflat', cfg);
    const keys = Object.keys(loadManifest(cfg).demoted);
    expect(JSON.stringify(keys) === JSON.stringify([...keys].sort()), '[deterministic] manifest keys not sorted');
  } finally { cleanup(root); }
}

// 10. path traversal rejected (CLI input)
{
  const root = mkFixture(); const cfg = makeConfig(root);
  try { throws(() => demote('../../etc/passwd', cfg), /outside the catalog|not found|no SKILL/, '[traversal] CLI arg not rejected'); }
  finally { cleanup(root); }
}

// 11. SECURITY: manifest-supplied originalPath escaping the repo is rejected on restore
{
  const root = mkFixture({ manifest: { version: 1, demoted: { Evil: { originalPath: '../../../tmp/qe-pwned-restore', demotedPath: 'skills-optional/Evil' } } } });
  const cfg = makeConfig(root);
  try {
    mkdirSync(join(root, 'skills-optional', 'Evil'), { recursive: true }); // make move source exist
    throws(() => restore('Evil', cfg), /escapes/, '[sec] manifest originalPath repo-escape not blocked');
  } finally { cleanup(root); }
}

// 12. SECURITY: manifest demotedPath pointing at a LIVE catalog skill (clobber primitive) is rejected
{
  const root = mkFixture({ manifest: { version: 1, demoted: { Clobber: { originalPath: 'skills/Moved', demotedPath: 'skills/Qflat' } } } });
  const cfg = makeConfig(root);
  try { throws(() => restore('Clobber', cfg), /escapes/, '[sec] manifest demotedPath live-skill clobber not blocked'); }
  finally { cleanup(root); }
}

if (failures.length) {
  console.error('check-skill-demote: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('check-skill-demote: PASS (containment, ambiguity, nested round-trip, tier-core, atomic rollback, EXDEV, manifest corruption x5, out-of-sync, empty/deterministic, traversal)');
