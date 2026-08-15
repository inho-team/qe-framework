import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runPlanCli } from '../../../../scripts/qe-plan.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { sha256 } from '../process-controller-store.mjs';

const HOOK = fileURLToPath(new URL('../../pre-tool-use.mjs', import.meta.url));
const SESSION = '11111111-1111-4111-8111-111111111111';

function initializeActivePlan(cwd) {
  const inputPath = join(cwd, 'plan.json');
  writeFileSync(inputPath, JSON.stringify({
    schema: 1,
    roadmap: '# Roadmap\n',
    requirements: '# Requirements\n',
    state: '# State\n\n## Phase Progress\n',
    goals: [{ title: 'Continue', objective: 'Continue the formal pipeline', phase: 'Phase 1', wave: 'Wave 1' }],
  }));
  runPlanCli(['init', '--slug', 'db-plan', '--session', SESSION, '--input', inputPath, '--cwd', cwd], cwd);
  const db = openSqlite(cwd);
  const path = '.qe/planning/plans/db-plan/goals.json';
  const row = db.prepare('SELECT content FROM qe_files WHERE path=?').get(path);
  const doc = JSON.parse(row.content);
  doc.goals[0].status = 'active';
  doc.goals[0].attempts = 1;
  doc.goals[0].executionOwnerSession = SESSION;
  doc.goals[0].acceptance = { status: 'defined', file: 'evidence/G001.acceptance.json', hash: 'a'.repeat(64) };
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  db.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?')
    .run(content, Buffer.byteLength(content), sha256(content), path);
  closeSqlite(db);
}

function invoke(cwd) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: SESSION, tool_name: 'Skill',
      tool_input: { skill: 'Qgenerate-spec', args: '' } }),
    encoding: 'utf8',
  });
}

test('PSE continuation reads the request-root DB even when the hook process cwd differs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-plan-continuation-'));
  try {
    initializeActivePlan(cwd);
    const allowed = invoke(cwd);
    assert.notEqual(allowed.status, 2, allowed.stderr || allowed.stdout);

    const db = openSqlite(cwd);
    db.prepare('UPDATE qe_files SET sha256=? WHERE path=?')
      .run('0'.repeat(64), `.qe/planning/.sessions/${SESSION}.json`);
    closeSqlite(db);
    const blocked = invoke(cwd);
    assert.equal(blocked.status, 2, blocked.stderr || blocked.stdout);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
