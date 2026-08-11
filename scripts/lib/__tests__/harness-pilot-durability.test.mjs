import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPilot, validatePilotFixture } from '../harness-pilot.mjs';
import { immutableWritePilotJson } from '../../run-harness-pilot.mjs';

const REVISION = '1'.repeat(40);

function fixture() {
  return validatePilotFixture({
    schema: 1, seed: 'durability-test', model: 'test-model', effort: 'medium', repetition: 1,
    budget: { maxInputTokens: 100, maxOutputTokens: 100, maxWallSeconds: 30, maxBudgetUsd: 1 },
    tasks: Array.from({ length: 5 }, (_, index) => ({
      id: `task-${index}`, category: 'feature', prompt: 'make the requested change',
      starterFiles: { 'package.json': '{"type":"module"}\n' },
      hiddenAcceptance: { command: 'true' },
    })),
  });
}

function actorResult(request, inputTokens = 1) {
  return {
    ok: true, modelTurn: true, inputTokens, outputTokens: 1, wallSeconds: 1,
    timedOut: false, bufferExceeded: false,
    controller: request.condition.endsWith('-durable') ? {
      admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED',
      activeCode: 'ALLOWED', terminalCode: 'ALLOWED', processId: 'test-process',
      auditDigest: 'a'.repeat(64),
    } : null,
  };
}

test('immutable evidence publication never replaces an existing target', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-immutable-'));
  const target = join(root, 'claim.json');
  try {
    immutableWritePilotJson(target, { invocation: 1 });
    assert.throws(() => immutableWritePilotJson(target, { invocation: 2 }), error => {
      assert.equal(error.code, 'PILOT_EXECUTE_CONSUMED');
      return true;
    });
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { invocation: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('awaits durable lifecycle evidence, preserves observed usage, and stops new cells after fatal evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-lifecycle-'));
  const started = [];
  const terminals = [];
  let calls = 0;
  try {
    await assert.rejects(runPilot(fixture(), {
      root, revision: REVISION, concurrency: 2,
      lifecycle: {
        started: async event => { started.push(event.index); },
        terminal: async event => { terminals.push(structuredClone(event)); },
      },
      actor: async request => {
        const call = calls++;
        if (call === 0) await new Promise(resolve => setTimeout(resolve, 10));
        return actorResult(request, call === 1 ? 101 : 7);
      },
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: 'b'.repeat(64) }),
    }), error => {
      assert.match(error.message, /INPUT_TOKENS_EXCEEDED/);
      assert.ok(error.pilotEvidence.unstartedIndexes.length > 0);
      return true;
    });
    assert.ok(calls <= 3, `fatal scheduling started too many actors: ${calls}`);
    const failed = terminals.find(event => event.status === 'failed');
    assert.equal(failed.evidence.actor.inputTokens, 101);
    assert.deepEqual(new Set(terminals.map(event => event.index)), new Set(started));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a started-sink failure invokes no actor and leaves later cells unstarted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-started-sink-'));
  let actors = 0;
  try {
    await assert.rejects(runPilot(fixture(), {
      root, revision: REVISION, concurrency: 1,
      lifecycle: { started: async () => { throw new Error('evidence medium unavailable'); } },
      actor: async request => { actors += 1; return actorResult(request); },
      scorer: async () => ({ passed: true }),
    }), /evidence medium unavailable/);
    assert.equal(actors, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
