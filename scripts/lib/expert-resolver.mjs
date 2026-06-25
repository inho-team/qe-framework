/**
 * expert-resolver.mjs — deterministic stack -> coding-expert resolver.
 *
 * Turns the "agent might read coding-experts/" reference model into a deterministic
 * one: given the changed files (and the project manifests in cwd), it returns the exact
 * coding-expert SKILL.md path(s) the implementing/reviewing agent MUST read. Orchestrator
 * skills (Qrun-task, Qcode-run-task) inject the result into the agent's delegation prompt.
 *
 * Single source of truth for signals: skills/coding-experts/STACK_MAP.json.
 * Node built-ins only, zero external deps (mirrors wiki-retrieve.mjs).
 *
 * CLI:
 *   node scripts/lib/expert-resolver.mjs --files a.py src/App.tsx
 *   node scripts/lib/expert-resolver.mjs --cwd /path/to/project --files a.py
 *   node scripts/lib/expert-resolver.mjs --selftest
 * Programmatic:
 *   import { resolveExperts } from '.../expert-resolver.mjs'
 *   resolveExperts({ files: ['a.py'], cwd: '/proj' }) -> [{ slug, path, reason }]
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Plugin root = scripts/lib -> up two. */
const PLUGIN_ROOT = join(__dirname, '..', '..');
const EXPERTS_DIR = join(PLUGIN_ROOT, 'skills', 'coding-experts');
const STACK_MAP_PATH = join(EXPERTS_DIR, 'STACK_MAP.json');

/** Max experts returned — keep the delegation prompt focused. */
export const TOP_K = 2;

/** Lazy-loaded, cached map. */
let _map = null;
/**
 * Load and cache STACK_MAP.json. Returns `{ experts: [] }` if missing/unparseable
 * so resolution degrades to empty rather than throwing.
 * @returns {{experts: object[]}}
 */
function loadMap() {
  if (_map) return _map;
  try {
    _map = JSON.parse(readFileSync(STACK_MAP_PATH, 'utf8'));
  } catch {
    _map = { experts: [] };
  }
  if (!Array.isArray(_map.experts)) _map.experts = [];
  return _map;
}

/**
 * Collect declared dependency names from common manifests in cwd.
 * Returns a lowercased Set of dependency identifiers. Missing/unreadable manifests
 * are skipped silently — resolution degrades to ext/file signals only.
 */
export function collectDeps(cwd) {
  const deps = new Set();
  const add = (s) => { if (s && typeof s === 'string') deps.add(s.toLowerCase()); };

  // package.json (node)
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[field] && typeof pkg[field] === 'object') Object.keys(pkg[field]).forEach(add);
    }
  } catch {}

  // requirements.txt (python)
  try {
    const txt = readFileSync(join(cwd, 'requirements.txt'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const name = line.trim().split(/[=<>~!;[\s#]/)[0];
      if (name && !name.startsWith('#') && !name.startsWith('-')) add(name);
    }
  } catch {}

  // pyproject.toml (python, rough — quoted/bare dep names)
  try {
    const toml = readFileSync(join(cwd, 'pyproject.toml'), 'utf8');
    for (const m of toml.matchAll(/^[\s"']*([A-Za-z0-9_.-]+)\s*(?:[><=~^"']|=)/gm)) add(m[1]);
  } catch {}

  // composer.json (php)
  try {
    const comp = JSON.parse(readFileSync(join(cwd, 'composer.json'), 'utf8'));
    for (const field of ['require', 'require-dev']) {
      if (comp[field] && typeof comp[field] === 'object') Object.keys(comp[field]).forEach(add);
    }
  } catch {}

  // Gemfile (ruby) — gem 'rails'
  try {
    const gem = readFileSync(join(cwd, 'Gemfile'), 'utf8');
    for (const m of gem.matchAll(/gem\s+['"]([^'"]+)['"]/g)) add(m[1]);
  } catch {}

  // build.gradle / pom.xml (jvm) — substring presence is enough for our deps[]
  for (const f of ['build.gradle', 'build.gradle.kts', 'pom.xml']) {
    try {
      const txt = readFileSync(join(cwd, f), 'utf8');
      for (const m of txt.matchAll(/spring-boot-starter[a-z-]*/g)) add(m[0]);
    } catch {}
  }

  return deps;
}

/**
 * Find the first expert dependency present in the project's dep set.
 * Matches exact or substring (handles scoped names like `@langchain/core`,
 * vendor paths like `laravel/framework`).
 * @param {string[]} expertDeps  dependency identifiers declared by an expert
 * @param {Set<string>} projectDeps  lowercased deps collected from manifests
 * @returns {string|null} the matched expert dep, or null
 */
function depMatches(expertDeps, projectDeps) {
  for (const d of expertDeps) {
    const dl = d.toLowerCase();
    if (projectDeps.has(dl)) return d;
    for (const pd of projectDeps) {
      if (pd === dl || pd.includes(dl)) return d;
    }
  }
  return null;
}

/**
 * Resolve coding experts for a change set.
 * @param {{files?: string[], cwd?: string, deps?: Set<string>}} opts
 *   files: changed file paths. cwd: project root for manifest scan (default process.cwd()).
 *   deps:  pre-collected dep set (skips manifest scan; used by tests).
 * @returns {{slug:string, path:string, reason:string, score:number}[]} top-K, score desc.
 */
export function resolveExperts({ files = [], cwd = process.cwd(), deps } = {}) {
  const map = loadMap();
  const projectDeps = deps instanceof Set ? deps : collectDeps(cwd);
  const fileBases = files.map((f) => basename(f));
  const fileExts = files.map((f) => extname(f).toLowerCase());

  const scored = [];
  for (const e of map.experts) {
    let score = 0;
    const reasons = [];

    // dependency signal: strong (+3)
    let depHit = null;
    if (Array.isArray(e.deps) && e.deps.length) {
      depHit = depMatches(e.deps, projectDeps);
      if (depHit) { score += 3; reasons.push(`dep:${depHit}`); }
    }

    // file signal: strong (+3) — matched in change set OR present in cwd
    let fileHit = null;
    if (Array.isArray(e.files) && e.files.length) {
      fileHit = e.files.find((f) => fileBases.includes(basename(f)));
      if (!fileHit) fileHit = e.files.find((f) => existsSync(join(cwd, f)));
      if (fileHit) { score += 3; reasons.push(`file:${basename(fileHit)}`); }
    }

    // extension signal: 1 file = 1.0, scaling to a cap of 2.0.
    // For a `framework` expert, ext only corroborates — it must NOT qualify on its own
    // (a `.tsx` file with no `next`/`react-native` dep is not a Next.js / RN project).
    // Languages/infra/tools/tests qualify on ext alone.
    if (Array.isArray(e.ext) && e.ext.length) {
      const hits = fileExts.filter((x) => e.ext.includes(x)).length;
      const extQualifies = e.domain !== 'framework' || depHit || fileHit;
      if (hits > 0 && extQualifies) {
        score += 1 + Math.min(hits - 1, 2) * 0.5;
        const exts = [...new Set(fileExts.filter((x) => e.ext.includes(x)))].join(',');
        reasons.push(`ext:${exts}×${hits}`);
      }
    }

    if (score > 0) {
      // priority only breaks ties (tiny weight)
      score += (Number(e.priority) || 0) * 0.01;
      scored.push({
        slug: e.slug,
        path: join(EXPERTS_DIR, e.path),
        reason: reasons.join(' '),
        score: Math.round(score * 100) / 100,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored.slice(0, TOP_K);
}

/** Fallback guideline every code task can fall back to when nothing resolves. */
export function principlesPath() {
  return join(EXPERTS_DIR, 'PRINCIPLES.md');
}

// ---- self-test (zero-infra: `node expert-resolver.mjs --selftest`) ----
function selfTest() {
  const D = (arr) => new Set(arr.map((s) => s.toLowerCase()));
  const cases = [
    { name: 'python file', in: { files: ['app/main.py'], deps: D([]) }, want: ['Qpython-pro'] },
    { name: 'fastapi beats python', in: { files: ['app/main.py'], deps: D(['fastapi']) }, want: ['Qfastapi-expert', 'Qpython-pro'] },
    { name: 'react tsx + dep', in: { files: ['src/App.tsx'], deps: D(['react']) }, want: ['Qreact-expert'] },
    { name: 'next beats react', in: { files: ['pages/index.tsx'], deps: D(['next', 'react']) }, want0: 'Qnextjs-developer' },
    { name: 'react-native beats react', in: { files: ['App.tsx'], deps: D(['react-native', 'react']) }, want0: 'Qreact-native-expert' },
    { name: 'go file', in: { files: ['cmd/server/main.go'], deps: D([]) }, want: ['Qgolang-pro'] },
    { name: 'terraform', in: { files: ['infra/vpc.tf'], deps: D([]) }, want: ['Qterraform-engineer'] },
    { name: 'markdown -> none', in: { files: ['README.md'], deps: D([]) }, want: [] },
    { name: 'no files -> none', in: { files: [], deps: D([]) }, want: [] },
  ];
  let pass = 0, fail = 0;
  for (const c of cases) {
    const got = resolveExperts({ files: c.in.files, deps: c.in.deps, cwd: '/nonexistent-xyz' });
    const slugs = got.map((g) => g.slug);
    let ok;
    if (c.want0 !== undefined) ok = slugs[0] === c.want0;
    else ok = JSON.stringify(slugs) === JSON.stringify(c.want);
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  ->  [${slugs.join(', ')}]${c.want0 ? `  (want[0]=${c.want0})` : `  (want=[${(c.want || []).join(', ')}])`}`);
  }

  // map<->directory integrity: every path must exist
  const map = loadMap();
  let missing = 0;
  for (const e of map.experts) {
    if (!existsSync(join(EXPERTS_DIR, e.path))) { console.log(`FAIL  missing path: ${e.path}`); missing++; }
  }
  console.log(`\n${pass} passed, ${fail} failed · ${map.experts.length} mapped experts, ${missing} missing paths`);
  return fail === 0 && missing === 0;
}

// CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    process.exit(selfTest() ? 0 : 1);
  }
  let cwd = process.cwd();
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') { cwd = argv[++i]; continue; }
    if (argv[i] === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) files.push(argv[++i]); continue; }
  }
  const result = resolveExperts({ files, cwd });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
