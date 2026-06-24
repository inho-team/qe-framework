#!/usr/bin/env node
// QE bench runner — exercises QE skills one by one and records every result.
//
// Depth (hybrid):
//   smoke      — load skills/<skill>/SKILL.md + parse frontmatter (no API, deterministic)
//   functional — run headless `claude -p <invocation>` and assert `expect` substring (needs key)
//
// Reuses the repo's own routing guard (`npm run check:routing`) once as a baseline.
// Results: bench/bench-results/<date>.jsonl  (machine)  +  bench/RESULTS.md  (human).
// API key is never written to results — output is redacted.
//
// Usage:
//   node bench/bench-runner.mjs                 # smoke + functional (functional needs ANTHROPIC_API_KEY)
//   node bench/bench-runner.mjs --smoke-only    # skip functional entirely (no API)
//   node bench/bench-runner.mjs --skills Qversion,Qhelp
//   BENCH_OUT=/some/dir node bench/bench-runner.mjs   # override results dir

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const args = process.argv.slice(2);
const SMOKE_ONLY = args.includes('--smoke-only');
const skillsArg = (() => {
  const i = args.indexOf('--skills');
  return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()) : null;
})();

const OUT_DIR = process.env.BENCH_OUT || join(HERE, 'bench-results');
const KEY = process.env.ANTHROPIC_API_KEY || '';

function redact(s) {
  if (!s) return s;
  let out = String(s).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-REDACTED');
  if (KEY) out = out.split(KEY).join('REDACTED');
  return out;
}

// pad-free ISO date (YYYY-MM-DD) — plain node, Date is allowed here.
function today() {
  return new Date().toISOString().slice(0, 10);
}

// --- smoke: SKILL.md present + frontmatter has name + description ---
function smokeCheck(skill) {
  const p = join(REPO, 'skills', skill, 'SKILL.md');
  if (!existsSync(p)) return { pass: false, notes: 'SKILL.md missing' };
  const text = readFileSync(p, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { pass: false, notes: 'no frontmatter' };
  const fm = m[1];
  const hasName = /\bname\s*:/.test(fm);
  const hasDesc = /\bdescription\s*:/.test(fm);
  if (!hasName || !hasDesc) {
    return { pass: false, notes: `frontmatter missing ${!hasName ? 'name ' : ''}${!hasDesc ? 'description' : ''}`.trim() };
  }
  return { pass: true, notes: `loaded (${text.length}B)` };
}

// --- functional: headless claude -p, assert expect substring ---
function functionalCheck(sc) {
  if (SMOKE_ONLY) return { result: 'na', notes: 'smoke-only mode' };
  if (sc.mode !== 'functional') return { result: 'na', notes: 'smoke-tier skill' };
  if (!KEY) return { result: 'na', notes: 'ANTHROPIC_API_KEY absent (on-hold)' };
  const res = spawnSync('claude', ['-p', sc.invocation, '--dangerously-skip-permissions'], {
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  if (res.error) return { result: 'fail', notes: redact(`spawn error: ${res.error.message}`) };
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = sc.expect ? out.includes(sc.expect) : res.status === 0;
  return { result: ok ? 'pass' : 'fail', notes: redact(ok ? 'expect matched' : `expect "${sc.expect}" not found`) };
}

// --- routing baseline (reuse repo guard) — best-effort, recorded once ---
function routingBaseline() {
  try {
    execSync('npm run --silent check:routing', { cwd: REPO, stdio: 'pipe', timeout: 120000 });
    return 'pass';
  } catch (e) {
    return existsSync(join(REPO, 'scripts', 'check-skill-routing.mjs')) ? 'fail' : 'na';
  }
}

function main() {
  const scenarios = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8')).skills;
  const targets = skillsArg ? scenarios.filter((s) => skillsArg.includes(s.skill)) : scenarios;

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonl = join(OUT_DIR, `${today()}.jsonl`);
  const routing = routingBaseline();

  const rows = [];
  for (const sc of targets) {
    const t0 = Date.now();
    const smoke = smokeCheck(sc.skill);
    const fn = functionalCheck(sc);
    const row = {
      skill: sc.skill,
      tier: sc.tier,
      smoke: smoke.pass ? 'pass' : 'fail',
      functional: fn.result,
      durationMs: Date.now() - t0,
      notes: [smoke.notes, fn.notes].filter(Boolean).join(' | '),
      repro: `node bench/bench-runner.mjs --skills ${sc.skill}`,
    };
    rows.push(row);
    appendFileSync(jsonl, JSON.stringify(row) + '\n');
    console.log(`${row.smoke === 'pass' ? 'OK ' : 'XX '} ${sc.skill.padEnd(16)} smoke=${row.smoke} functional=${row.functional}`);
  }

  renderResults(rows, routing, jsonl);
  const failed = rows.filter((r) => r.smoke === 'fail' || r.functional === 'fail');
  console.log(`\nrouting baseline: ${routing} | skills: ${rows.length} | failures: ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

function renderResults(rows, routing, jsonl) {
  const date = today();
  const lines = [];
  lines.push(`# QE bench results`);
  lines.push('');
  lines.push(`- Date: ${date}`);
  lines.push(`- Routing baseline (\`check:routing\`): **${routing}**`);
  lines.push(`- Skills benched: ${rows.length}`);
  lines.push(`- Raw log: \`bench-results/${date}.jsonl\``);
  lines.push('');
  lines.push('| Skill | Tier | Smoke | Functional | ms | Notes |');
  lines.push('|-------|------|-------|-----------|----|-------|');
  for (const r of rows) {
    const notes = String(r.notes).replace(/\|/g, '\\|'); // keep table cells intact
    lines.push(`| ${r.skill} | ${r.tier} | ${r.smoke} | ${r.functional} | ${r.durationMs} | ${notes} |`);
  }
  lines.push('');
  const fails = rows.filter((r) => r.smoke === 'fail' || r.functional === 'fail');
  lines.push(`## Failures (${fails.length})`);
  if (!fails.length) lines.push('- none');
  for (const r of fails) lines.push(`- **${r.skill}** — smoke=${r.smoke} functional=${r.functional} — ${r.notes} — repro: \`${r.repro}\``);
  lines.push('');
  const content = lines.join('\n');
  // Prefer bench/RESULTS.md (host); fall back to the writable OUT_DIR when the
  // repo is mounted read-only (in-container bench run).
  for (const p of [join(HERE, 'RESULTS.md'), join(OUT_DIR, 'RESULTS.md')]) {
    try { writeFileSync(p, content); return; } catch { /* read-only — try next */ }
  }
}

main();
