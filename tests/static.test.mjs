// Static checks on the plugin's files. They guard against maintenance slips
// (broken links, version drift, stale counts); they do not police model behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const skillsDir = path.join(root, 'skills');
const skillNames = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Claude Code registers a skill by its frontmatter name; a mismatch with the folder confuses links and docs.
test('every skill folder name equals its frontmatter name', () => {
  for (const name of skillNames) {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    assert.match(fm, new RegExp(`^name: ${name}$`, 'm'), name);
  }
});

// The description is what makes a skill trigger; QE writes them as "Use when …" conditions.
test('every skill description starts with "Use when"', () => {
  for (const name of skillNames) {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    assert.match(fm, /^description: "?Use when/m, name);
  }
});

// Long skill bodies get cut after compaction; detail belongs in linked support files.
test('every SKILL.md stays within 200 lines', () => {
  for (const name of skillNames) {
    const lines = read(`skills/${name}/SKILL.md`).split(/\r?\n/).length;
    assert.ok(lines <= 200, `${name}: ${lines} lines`);
  }
});

// A skill that points at a missing template or prompt leaves the model guessing.
// Templates are skipped: their links (plan.md, implement-plan.md) resolve only after they are copied into a task folder.
test('relative markdown links in skills resolve', () => {
  for (const file of walkMarkdown(skillsDir).filter((f) => !f.endsWith('-template.md'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (target.includes('://') || target.startsWith('#')) continue;
      const clean = target.split('#')[0];
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), clean)), `${path.relative(root, file)} -> ${target}`);
    }
  }
});

// Plugin updates are keyed by version; the three manifests must agree.
test('manifest versions match', () => {
  const pkg = readJson('package.json').version;
  const plugin = readJson('.claude-plugin/plugin.json').version;
  const market = readJson('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'qe-framework').version;
  assert.equal(plugin, pkg);
  assert.equal(market, pkg);
});

// The session-start guide is the model's map of the skills; a skill it never names is easy to miss.
test('hooks/guide.md names every skill', () => {
  const guide = read('hooks/guide.md');
  for (const name of skillNames) assert.ok(guide.includes(name), name);
});

// Skill counts in prose drift every time a skill is added; describe the path instead.
test('descriptions carry no skill count', () => {
  for (const p of ['package.json', '.claude-plugin/plugin.json']) {
    assert.doesNotMatch(readJson(p).description, /\d+[- ]skills?/i, p);
  }
  for (const p of ['README.md', 'AGENTS.md']) {
    assert.doesNotMatch(read(p), /스킬 \d+개|\b(five|six|seven|eight|nine|ten) skills\b/i, p);
  }
});

// Eval cases are how a release is judged complete; a case without a grader silently scores nothing.
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);
test('every eval case has a prompt, a suite tag, and valid graders', () => {
  const evalsDir = path.join(root, 'evals');
  assert.ok(fs.existsSync(evalsDir), 'evals/ is missing');
  const cases = fs
    .readdirSync(evalsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !['results', 'mocks'].includes(d.name));
  assert.ok(cases.length > 0, 'no eval cases');
  for (const c of cases) {
    const dir = path.join(evalsDir, c.name);
    const promptPath = path.join(dir, 'prompt.md');
    assert.ok(fs.existsSync(promptPath), `${c.name}: prompt.md missing`);
    const fm = frontmatter(fs.readFileSync(promptPath, 'utf8'));
    assert.match(fm, /^tags: \[.*\b(trigger|gate)\b.*\]$/m, `${c.name}: needs tag trigger or gate`);
    const gradersDir = path.join(dir, 'graders');
    const graders = fs.existsSync(gradersDir) ? fs.readdirSync(gradersDir).filter((f) => f.endsWith('.md')) : [];
    assert.ok(graders.length > 0, `${c.name}: no graders`);
    for (const g of graders) {
      const type = frontmatter(fs.readFileSync(path.join(gradersDir, g), 'utf8')).match(/^type: (\S+)$/m)?.[1];
      assert.ok(GRADER_TYPES.has(type), `${c.name}/${g}: bad grader type ${type}`);
    }
  }
});
