#!/usr/bin/env node
/**
 * check-agent-tools.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Tool-declaration/body consistency for sub-agents (audit-harvest R7).
 *
 * Invariant: if an agent's body gives an imperative instruction to WRITE a
 * result or trigger file under `.qe/agent-results/` or `.qe/agent-triggers/`,
 * then its frontmatter `tools:` MUST declare `Write` — otherwise the agent
 * hits a permission error at runtime when it tries to persist that file.
 *
 * This encodes the Ecode-reviewer under-grant defect found by the critical
 * skill/hook audit (L2 TOOL-MISMATCH) so it cannot silently regress.
 *
 * Scope: this legacy guard checks WRITE-side under-grants in free-form bodies.
 * `check-agent-registry.mjs` is the authoritative least-privilege gate and rejects
 * Write/Edit grants on read-only agent classes.
 *
 * Env override: set QE_AGENTS_DIR to point the scan at a fixture directory
 * (used by the red-green test); defaults to the repo `agents/` directory.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = process.env.QE_AGENTS_DIR || join(ROOT, 'agents');

/** Read the `tools:` line from a YAML frontmatter block, or '' if absent. */
function frontmatterTools(text) {
  const lines = text.replace(/^﻿/, '').split('\n');
  if (lines[0].trim() !== '---') return '';
  const end = lines.indexOf('---', 1);
  if (end < 0) return '';
  for (const l of lines.slice(1, end)) {
    const m = l.match(/^tools:\s*(.+)$/);
    if (m) return m[1];
  }
  return '';
}

/**
 * True when the body imperatively instructs writing a result/trigger file
 * under the agent state directories. Matches lines that pair a write verb with
 * an `.qe/agent-results/` or `.qe/agent-triggers/` path to avoid flagging mere
 * mentions (e.g. "read the latest result").
 */
function bodyWritesStateFile(text) {
  return text.split('\n').some((line) => {
    const hasWriteVerb = /\bwrite\s+(result|trigger)\b/i.test(line)
      || /\bwrite\s+to\s+`?\.qe\/agent-(results|triggers)\//i.test(line);
    const hasStatePath = /\.qe\/agent-(results|triggers)\//.test(line);
    return hasWriteVerb && hasStatePath;
  });
}

/** True when a `tools:` declaration line includes the Write tool. */
function declaresWrite(toolsLine) {
  return /\bWrite\b/.test(toolsLine);
}

if (!existsSync(AGENTS_DIR)) {
  console.log(`check-agent-tools: no agents dir at ${AGENTS_DIR} — nothing to check.`);
  process.exit(0);
}

const failures = [];
const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));

for (const f of files) {
  const text = readFileSync(join(AGENTS_DIR, f), 'utf8');
  if (!bodyWritesStateFile(text)) continue;
  const tools = frontmatterTools(text);
  if (!declaresWrite(tools)) {
    failures.push(`${f}: body writes .qe/agent-results|triggers but tools: "${tools.trim() || '(none)'}" lacks Write`);
  }
}

if (failures.length > 0) {
  console.error(`check-agent-tools: FAIL (${failures.length})`);
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log(`check-agent-tools: PASS (${files.length} agents scanned, write-side tool grants consistent)`);
process.exit(0);
