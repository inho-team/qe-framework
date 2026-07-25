#!/usr/bin/env node
'use strict';

/**
 * Plan-owned knowledge operations.
 *
 * This is deliberately an internal library, not a user-facing Qwiki skill.
 * It treats QE documents as the source of truth, qe.db/the store as a lookup
 * index, and `.qe/wiki/` as a derived, reviewable knowledge layer.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { openStore } from './store.mjs';

const MAX_RESULTS = 5;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about',
  '작업', '목표', '계획', '프로젝트', '하고', '대한', '관련', '위한', '에서',
]);

function tokens(text) {
  return String(text || '').normalize('NFC').toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function score(text, queryTokens) {
  const haystack = String(text || '').normalize('NFC').toLowerCase();
  return queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
}

/**
 * Return a small, provenance-preserving context pack for the active Plan.
 * The function never reads wiki page bodies: callers receive paths and must
 * read a selected source only when they need its full evidence.
 */
export function retrievePlanKnowledge(cwd, intent, { limit = MAX_RESULTS } = {}) {
  const queryTokens = tokens(intent);
  if (queryTokens.length === 0) return { wiki: [], artifacts: [] };

  let store;
  try {
    store = openStore(cwd);
    const pages = store.queryWiki({ limit: 500 }) || [];
    const wiki = pages
      .filter((page) => page.status !== 'superseded' && page.tier !== 'deprecated')
      .map((page) => ({ ...page, score: score(`${page.title} ${page.topic} ${page.summary}`, queryTokens)
        + (page.tier === 'reviewed' ? 2 : 0) }))
      .filter((page) => page.score > 0)
      .sort((a, b) => b.score - a.score || String(a.path).localeCompare(String(b.path)))
      .slice(0, limit)
      .map(({ score: ignored, ...page }) => page);

    const artifacts = [];
    for (const kind of ['contract', 'analysis', 'plan']) {
      const rows = store.queryFiles({ kind, limit: 100 });
      if (!Array.isArray(rows)) continue;
      artifacts.push(...rows
        .map((row) => ({ ...row, score: score(`${row.title} ${row.path}`, queryTokens) }))
        .filter((row) => row.score > 0));
    }
    artifacts.sort((a, b) => b.score - a.score || String(a.path).localeCompare(String(b.path)));
    return { wiki, artifacts: artifacts.slice(0, limit).map(({ score: ignored, ...row }) => row) };
  } catch {
    return { wiki: [], artifacts: [] };
  } finally {
    try { store?.close(); } catch {}
  }
}

/** Format a compact context block suitable for an internal Qplan preflight. */
export function formatPlanKnowledge(pack) {
  const lines = [];
  for (const page of pack?.wiki || []) {
    lines.push(`- [wiki/${page.tier || 'unreviewed'}] ${page.title}: ${page.summary || ''} (${page.path})`);
  }
  for (const artifact of pack?.artifacts || []) {
    lines.push(`- [qe/${artifact.kind || 'artifact'}] ${artifact.title || artifact.path} (${artifact.path})`);
  }
  return lines.length ? `[Plan Knowledge]\n${lines.join('\n')}` : '';
}

function safeGoalId(goalId) {
  return /^G\d{3,}$/i.test(String(goalId || '')) ? String(goalId).toUpperCase() : null;
}

/**
 * Persist one verified Goal outcome into the project's derived wiki layer.
 * Completion evidence is mandatory so an LLM draft can never self-promote.
 */
export function writeVerifiedGoalKnowledge(cwd, { slug, goal, evidence }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(slug || ''))) {
    throw new Error('invalid plan slug for knowledge write-back');
  }
  const goalId = safeGoalId(goal?.id);
  const proof = String(evidence || '').trim();
  if (!goalId || !proof) throw new Error('verified knowledge requires goal id and evidence');

  const dir = join(cwd, '.qe', 'wiki', 'pages', 'plan-goals');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}-${goalId.toLowerCase()}.md`);
  const relPlan = `.qe/planning/plans/${slug}`;
  const title = `${slug} ${goalId}: ${String(goal.title || goal.objective || '').trim()}`;
  const summary = proof.replace(/\s+/g, ' ').slice(0, 280);
  const content = `---\n`
    + `type: goal\n`
    + `topic: plan-goals\n`
    + `canonical: ${JSON.stringify(title)}\n`
    + `summary: ${JSON.stringify(summary)}\n`
    + `provenance: verified\n`
    + `tier: reviewed\n`
    + `status: active\n`
    + `updated: ${JSON.stringify(new Date().toISOString())}\n`
    + `---\n\n# ${title}\n\n## Verified outcome\n\n${proof}\n\n## Provenance\n\n- ${relPlan}/goals.json\n- ${relPlan}/ledger.jsonl\n`;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
  return { path: `.qe/wiki/pages/plan-goals/${slug}-${goalId.toLowerCase()}.md` };
}
