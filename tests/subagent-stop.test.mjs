import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVerdictLine, findVerdict, recordVerdict } from '../hooks/subagent-stop.mjs';

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

const SHA = 'abc1234def5678';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function setup() {
  const home = tmp('qe-sas-');
  const dir = path.join(home, 'tasks', 't1');
  fs.mkdirSync(dir, { recursive: true });
  return { home, dir, env: { QE_HOME: home } };
}

test('parseVerdictLine reads the last valid line and rejects unknown results or bad sha', () => {
  const text = [
    'report',
    `QE-VERDICT: t1 | 미충족 | main | ${SHA}`,
    `QE-VERDICT:  t1 |  일부  미충족 | feat/x-y | ${SHA}  `,
  ].join('\n');
  assert.deepEqual(parseVerdictLine(text), { task: 't1', result: '일부 미충족', branch: 'feat/x-y', commit: SHA });
  // last line invalid -> falls back to the earlier valid one
  const t2 = `QE-VERDICT: t1 | 충족 | main | ${SHA}\nQE-VERDICT: t1 | 아마도 | main | ${SHA}`;
  assert.equal(parseVerdictLine(t2).result, '충족');
  assert.equal(parseVerdictLine('QE-VERDICT: t1 | 충족 | main | xyz'), null);
  assert.equal(parseVerdictLine('QE-VERDICT: t1 | 충족 | main | abc12'), null);
  assert.equal(parseVerdictLine(`QE-VERDICT: ../x | 충족 | main | ${SHA}`), null);
  assert.equal(parseVerdictLine('nothing'), null);
  assert.equal(parseVerdictLine(undefined), null);
});

test('records a verdict file with planHash and agent fields', () => {
  const { dir, env } = setup();
  fs.writeFileSync(path.join(dir, 'implement-plan.md'), '- [x] a\n');
  const input = {
    agent_id: 'ag/1 x',
    agent_type: 'qe-verifier',
    last_assistant_message: `done\nQE-VERDICT: t1 | 충족 | feat/a | ${SHA}`,
  };
  const file = recordVerdict(input, env);
  assert.ok(file && fs.existsSync(file));
  assert.match(path.basename(file), /^\d+-ag1x\.json$/);
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(v.task, 't1');
  assert.equal(v.result, '충족');
  assert.equal(v.branch, 'feat/a');
  assert.equal(v.commit, SHA);
  assert.match(v.planHash, /^[0-9a-f]{64}$/);
  assert.equal(v.agentId, 'ag1x');
  assert.equal(v.agentType, 'qe-verifier');
  assert.equal(typeof v.at, 'number');
});

test('finds the line inside a SubagentHandback message in the agent transcript', () => {
  const { env } = setup();
  const tp = path.join(tmp('qe-tr-'), 'agent.jsonl');
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: `보고\n\nQE-VERDICT: t1 | 미충족 | main | ${SHA}` } }] } },
    { type: 'user', message: { content: 'ok' } },
  ];
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n{broken');
  const input = { agent_id: 'a2', agent_transcript_path: tp, last_assistant_message: 'wrap up' };
  assert.equal(findVerdict(input).result, '미충족');
  const file = recordVerdict(input, env);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).result, '미충족');
});

test('does nothing when no line or the task folder is missing', () => {
  const { home, env } = setup();
  assert.equal(recordVerdict({ agent_id: 'a', last_assistant_message: 'no verdict' }, env), null);
  assert.equal(recordVerdict({ agent_id: 'a', last_assistant_message: `QE-VERDICT: nope | 충족 | main | ${SHA}` }, env), null);
  assert.equal(fs.existsSync(path.join(home, 'tasks', 'nope')), false);
  const empty = path.join(tmp('qe-none-'), 'absent');
  assert.equal(recordVerdict({ agent_id: 'a', last_assistant_message: `QE-VERDICT: t1 | 충족 | main | ${SHA}` }, { QE_HOME: empty }), null);
  assert.equal(fs.existsSync(empty), false);
  assert.equal(recordVerdict(null, env), null);
});

test('ignores QE-VERDICT lines in non-assistant transcript entries', () => {
  const { dir, env } = setup();
  const tp = path.join(tmp('qe-tr-'), 'agent.jsonl');
  const lines = [
    { type: 'user', message: { content: `prompt: end with QE-VERDICT: t1 | 충족 | main | ${SHA}\nQE-VERDICT: t1 | 충족 | main | ${SHA}` } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'no verdict here' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: `QE-VERDICT: t1 | 충족 | main | ${SHA}` }] } },
  ];
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n'));
  assert.equal(recordVerdict({ agent_id: 'a3', agent_transcript_path: tp }, env), null);
  assert.equal(fs.existsSync(path.join(dir, 'verdicts')), false);
});

function transcript(lines) {
  const tp = path.join(tmp('qe-tr-'), 'agent.jsonl');
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n'));
  return tp;
}

test('a thinking draft never counts: only the final report is read', () => {
  const { dir, env } = setup();
  const tp = transcript([
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: `초안\nQE-VERDICT: t1 | 충족 | main | ${SHA}` },
          { type: 'tool_use', name: 'Bash', input: { command: `echo "QE-VERDICT: t1 | 충족 | main | ${SHA}"` } },
          { type: 'text', text: `보고\nQE-VERDICT: t1 | 아마도 | main | ${SHA}` },
        ],
      },
    },
  ]);
  assert.equal(findVerdict({ agent_transcript_path: tp }), null);
  assert.equal(recordVerdict({ agent_id: 'a4', agent_transcript_path: tp }, env), null);
  assert.equal(fs.existsSync(path.join(dir, 'verdicts')), false);
});

test('an earlier assistant entry with a valid line does not count when the final report has none', () => {
  const { dir, env } = setup();
  const tp = transcript([
    { type: 'assistant', message: { content: [{ type: 'text', text: `중간 정리\nQE-VERDICT: t1 | 충족 | main | ${SHA}` }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'more checks' }] } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: '최종 보고: 줄을 빠뜨림' } }] } },
  ]);
  assert.equal(findVerdict({ agent_transcript_path: tp }), null);
  assert.equal(recordVerdict({ agent_id: 'a5', agent_transcript_path: tp }, env), null);
  assert.equal(fs.existsSync(path.join(dir, 'verdicts')), false);
});

test('tool calls and thinking after the final text do not hide it', () => {
  const tp = transcript([
    { type: 'assistant', message: { content: [{ type: 'text', text: `보고\nQE-VERDICT: t1 | 일부 미충족 | main | ${SHA}` }] } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: `QE-VERDICT: t1 | 충족 | main | ${SHA}` }, { type: 'redacted_thinking', data: 'x' }] } },
  ]);
  assert.equal(findVerdict({ agent_transcript_path: tp }).result, '일부 미충족');
});
