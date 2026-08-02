#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXPECTED = new Set([
  'Qcommit', 'Qcompact', 'Qcritical-review', 'Qexecute', 'Qgenerate-spec',
  'Qgoal', 'Qplan', 'Qresume', 'Qupdate', 'Qversion',
]);
const PUBLIC = new Set(['Qcommit', 'Qcompact', 'Qcritical-review', 'Qgoal', 'Qplan', 'Qresume', 'Qupdate', 'Qversion']);
const INTERNAL = new Set(['Qgenerate-spec', 'Qexecute']);
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function setEqual(a, b) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function frontmatter(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  return Object.fromEntries(block.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
    return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

const skillNames = new Set(readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'skills', entry.name, 'SKILL.md')))
  .map((entry) => entry.name));
expect(setEqual(skillNames, EXPECTED), `skill set drift: ${[...skillNames].sort().join(', ')}`);

const publicNames = new Set();
for (const name of skillNames) {
  const fm = frontmatter(readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8'));
  expect(fm.name === name, `${name}: frontmatter name mismatch`);
  if (fm.user_invocable === 'true') publicNames.add(name);
  if (INTERNAL.has(name)) expect(fm.user_invocable === 'false', `${name}: internal stage must set user_invocable: false`);
}
expect(setEqual(publicNames, PUBLIC), `public skill metadata drift: ${[...publicNames].sort().join(', ')}`);

const publicDocs = [
  'README.md', 'CLAUDE.md', 'docs/QE_SKILL_ROUTING.md', 'docs/USAGE_GUIDE.md',
  'docs/README.ko.md', 'docs/README.ja.md', 'docs/README.zh.md',
];
for (const rel of publicDocs) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  expect(!/[$\/]Q(?:generate-spec|execute)\b/.test(text), `${rel}: exposes an internal PSE command`);
}

const planText = readFileSync(join(ROOT, 'skills', 'Qplan', 'SKILL.md'), 'utf8');
expect(planText.includes('Do not expose `Qgenerate-spec`, `Qexecute`'), 'Qplan: missing internal-stage non-exposure contract');
const stateRouter = readFileSync(join(ROOT, 'hooks', 'scripts', 'lib', 'pse-state-router.mjs'), 'utf8');
expect(!/hintTarget\s*=\s*['"]Q(?:generate-spec|execute)/.test(stateRouter), 'PSE state router exposes an internal target');
expect(!/Next Command:/.test(stateRouter), 'PSE state router emits copied next-command choreography');

const intent = JSON.parse(readFileSync(join(ROOT, 'hooks', 'scripts', 'lib', 'intent-routes.json'), 'utf8'));
for (const target of Object.values(intent.routes || {})) {
  const name = String(target).split(/\s+/, 1)[0];
  expect(!INTERNAL.has(name), `intent route exposes internal stage ${target}`);
  expect(skillNames.has(name) || existsSync(join(ROOT, 'agents', `${name}.md`)), `intent route target does not exist: ${target}`);
}
for (const names of Object.values(intent.agent_tiers || {})) {
  for (const name of names) expect(existsSync(join(ROOT, 'agents', `${name}.md`)), `agent tier target does not exist: ${name}`);
}

const operationalFiles = [];
for (const dir of ['skills', 'agents']) {
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) operationalFiles.push(full);
    }
  };
  walk(join(ROOT, dir));
}
for (const path of operationalFiles) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/`(E[a-z][A-Za-z0-9]*-[A-Za-z0-9-]+)`/g)) {
    expect(existsSync(join(ROOT, 'agents', `${match[1]}.md`)), `${path}: referenced agent does not exist: ${match[1]}`);
  }
  for (const match of text.matchAll(/[$\/](Q[a-z][A-Za-z0-9-]*)\b/g)) {
    expect(skillNames.has(match[1]), `${path}: referenced skill command does not exist: ${match[1]}`);
  }
}

const hookFiles = [];
const walkHooks = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.baseline-')) continue; // concurrent benchmark fixture, not a shipped hook
    const full = join(path, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') walkHooks(full);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) hookFiles.push(full);
  }
};
walkHooks(join(ROOT, 'hooks', 'scripts'));
for (const path of hookFiles) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/skillCommand\(['"](Q[A-Za-z][A-Za-z0-9-]*)['"]/g)) {
    expect(skillNames.has(match[1]), `${path}: hook emits missing skill ${match[1]}`);
  }
}

if (failures.length) {
  console.error('check-skill-surface-integrity: FAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('check-skill-surface-integrity: PASS (10 skills, public/internal boundary, live Q/E targets)');
