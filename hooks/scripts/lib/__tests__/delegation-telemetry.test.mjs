import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, '..', '..', 'pre-tool-use.mjs');

test('PreToolUse records a delegation request in metrics and telemetry', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-delegation-telemetry-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'agents'), { recursive: true });
  writeFileSync(join(cwd, 'agents', 'Etask-executor.md'), '---\nrecommendedModel: sonnet\n---\n', 'utf8');

  const result = spawnSync(process.execPath, [hook], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({
      cwd,
      session_id: 'test-session',
      tool_name: 'Task',
      tool_input: { subagent_type: 'Etask-executor', prompt: 'Implement item 1' },
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(readFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), 'utf8'));
  assert.equal(state.harnessMetrics.delegationRequests, 1);
  assert.equal(state.harnessMetrics.delegationByAgent['Etask-executor'], 1);
  assert.equal(state.harnessMetrics.delegationByModel.sonnet, 1);

  const events = readFileSync(join(cwd, '.qe', 'telemetry', new Date().toISOString().slice(0, 10) + '.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.at(-1), {
    timestamp: events.at(-1).timestamp,
    eventType: 'delegation_requested',
    sessionId: 'test-session',
    data: { agentName: 'Etask-executor', model: 'sonnet', action: 'inject' },
  });
});
