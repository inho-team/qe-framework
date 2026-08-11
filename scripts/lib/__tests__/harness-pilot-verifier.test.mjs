import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyPilotOutput } from '../../verify-harness-pilot.mjs';

function canonicalDigest(value) {
  const canonical = JSON.stringify(value, (_, item) => item && typeof item === 'object'
    && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash('sha256').update(canonical).digest('hex');
}

function bytesDigest(value) { return createHash('sha256').update(value).digest('hex'); }

function json(path, value) { writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 }); }

test('classifies empty, claim-only, coherent failed, and orphan evidence states', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-verify-'));
  try {
    assert.equal(verifyPilotOutput(root).classification, 'empty');
    const claim = { schema: 1, kind: 'execute-claim', invocationId: 'invocation-1',
      revision: 'a'.repeat(40) };
    json(join(root, '.pilot-execute-claim.json'), claim);
    assert.equal(verifyPilotOutput(root).classification, 'nonterminal');
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 1, kind: 'execute-terminal', status: 'failed', invocationId: claim.invocationId,
      revision: claim.revision, claimDigest: canonicalDigest(claim),
      completedIndexes: [], failedIndexes: [0], unstartedIndexes: Array.from({ length: 19 }, (_, i) => i + 1),
    });
    assert.equal(verifyPilotOutput(root).classification, 'failed');
    rmSync(join(root, '.pilot-execute-claim.json'));
    assert.equal(verifyPilotOutput(root).classification, 'corrupt');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI exits nonzero for every classification other than succeeded', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-verify-cli-'));
  try {
    const script = fileURLToPath(new URL('../../verify-harness-pilot.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.equal(JSON.parse(run.stdout).classification, 'empty');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects malformed partitions instead of inferring completion', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-verify-bad-'));
  try {
    mkdirSync(join(root, '.pilot-execute-cells'));
    const claim = { schema: 1, kind: 'execute-claim', invocationId: 'invocation-2',
      revision: 'b'.repeat(40) };
    json(join(root, '.pilot-execute-claim.json'), claim);
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 1, kind: 'execute-terminal', status: 'failed', invocationId: claim.invocationId,
      revision: claim.revision, claimDigest: canonicalDigest(claim),
      completedIndexes: [], failedIndexes: [0], unstartedIndexes: [0],
    });
    assert.equal(verifyPilotOutput(root).classification, 'corrupt');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recomputes cell, manifest, current, and artifact evidence before success', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-pilot-verify-success-'));
  try {
    const claim = { schema: 1, kind: 'execute-claim', invocationId: 'invocation-3',
      revision: 'c'.repeat(40) };
    json(join(root, '.pilot-execute-claim.json'), claim);
    const cells = join(root, '.pilot-execute-cells');
    mkdirSync(cells);
    for (let index = 0; index < 20; index += 1) {
      const cell = join(cells, String(index).padStart(3, '0'));
      mkdirSync(cell);
      json(join(cell, 'started.json'), { invocationId: claim.invocationId, index });
      json(join(cell, 'terminal.json'), { invocationId: claim.invocationId, index, status: 'completed' });
    }
    const generation = 'generation-1';
    const generationRoot = join(root, 'generations', generation);
    mkdirSync(generationRoot, { recursive: true });
    const artifact = '{"ok":true}\n';
    writeFileSync(join(generationRoot, 'report.json'), artifact);
    const manifestText = `${JSON.stringify({ files: { 'report.json': bytesDigest(artifact) } })}\n`;
    writeFileSync(join(generationRoot, 'manifest.json'), manifestText);
    const manifestHash = bytesDigest(manifestText);
    json(join(root, 'current.json'), { generation, manifestHash });
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 1, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, claimDigest: canonicalDigest(claim),
      completedIndexes: Array.from({ length: 20 }, (_, index) => index),
      failedIndexes: [], unstartedIndexes: [], generation, manifestHash,
    });
    assert.equal(verifyPilotOutput(root).classification, 'succeeded');
    writeFileSync(join(generationRoot, 'report.json'), '{"ok":false}\n');
    assert.equal(verifyPilotOutput(root).classification, 'corrupt');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
