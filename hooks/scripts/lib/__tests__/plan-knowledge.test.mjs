import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPlanKnowledge, retrievePlanKnowledge, writeVerifiedGoalKnowledge } from '../plan-knowledge.mjs';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'plan-knowledge-'));
  const pageDir = join(cwd, '.qe', 'wiki', 'pages', 'domain');
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(pageDir, 'payment.md'), `---\ntype: concept\ntopic: domain\ncanonical: Payment retry policy\nsummary: Retry failed payment requests with idempotency keys.\nprovenance: verified\ntier: reviewed\nstatus: active\n---\n`, 'utf8');
  return cwd;
}

test('retrievePlanKnowledge returns reviewed, intent-relevant project wiki pages', () => {
  const cwd = project();
  const pack = retrievePlanKnowledge(cwd, 'payment retry failures');
  assert.equal(pack.wiki.length, 1);
  assert.equal(pack.wiki[0].title, 'Payment retry policy');
  assert.match(formatPlanKnowledge(pack), /\[wiki\/reviewed\]/);
  rmSync(cwd, { recursive: true, force: true });
});

test('writeVerifiedGoalKnowledge requires evidence and persists provenance', () => {
  const cwd = project();
  assert.throws(() => writeVerifiedGoalKnowledge(cwd, { slug: 'demo-plan', goal: { id: 'G001' } }), /requires goal id and evidence/);
  const result = writeVerifiedGoalKnowledge(cwd, {
    slug: 'demo-plan',
    goal: { id: 'G001', title: 'Verify retry policy' },
    evidence: 'integration test passed',
  });
  assert.equal(result.path, '.qe/wiki/pages/plan-goals/demo-plan-g001.md');
  const content = readFileSync(join(cwd, result.path), 'utf8');
  assert.match(content, /provenance: verified/);
  assert.match(content, /ledger\.jsonl/);
  rmSync(cwd, { recursive: true, force: true });
});
