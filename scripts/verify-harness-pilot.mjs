#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const EXPECTED_INDEXES = Array.from({ length: 20 }, (_, index) => index);

function digest(value) {
  const canonical = JSON.stringify(value, (_, item) => item && typeof item === 'object'
    && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonNoFollow(path, maxBytes = MAX_EVIDENCE_BYTES) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error(`unsafe evidence: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error(`evidence changed: ${path}`);
    const bytes = Buffer.alloc(opened.size);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error(`short evidence read: ${path}`);
    return JSON.parse(bytes.toString('utf8'));
  } finally { closeSync(fd); }
}

function entryExists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function exactPartition(terminal) {
  const groups = [terminal.completedIndexes, terminal.failedIndexes, terminal.unstartedIndexes];
  if (!groups.every(Array.isArray)) return false;
  const flat = groups.flat();
  return flat.length === 20 && new Set(flat).size === 20
    && flat.every(Number.isInteger) && [...flat].sort((a, b) => a - b).every((value, index) => value === index);
}

function verifyGeneration(root, terminal) {
  const current = readJsonNoFollow(join(root, 'current.json'));
  if (current.generation !== terminal.generation || current.manifestHash !== terminal.manifestHash) {
    throw new Error('terminal/current identity mismatch');
  }
  const generationRoot = join(root, 'generations', current.generation);
  const manifestText = readFileSync(join(generationRoot, 'manifest.json'));
  if (sha256(manifestText) !== current.manifestHash) throw new Error('manifest hash mismatch');
  const manifest = JSON.parse(manifestText.toString('utf8'));
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    if (basename(name) !== name || sha256(readFileSync(join(generationRoot, name))) !== expected) {
      throw new Error(`artifact hash mismatch: ${name}`);
    }
  }
}

export function verifyPilotOutput(outputRoot) {
  const root = resolve(outputRoot);
  const claimPath = join(root, '.pilot-execute-claim.json');
  const terminalPath = join(root, '.pilot-execute-terminal.json');
  const cellsRoot = join(root, '.pilot-execute-cells');
  const hasClaim = entryExists(claimPath);
  const hasOther = entryExists(terminalPath) || entryExists(cellsRoot) || entryExists(join(root, 'current.json'));
  if (!hasClaim) return hasOther
    ? { classification: 'corrupt', reason: 'execute evidence exists without claim' }
    : { classification: 'empty', reason: 'no execute claim' };
  try {
    const claim = readJsonNoFollow(claimPath);
    if (claim.schema !== 1 || claim.kind !== 'execute-claim' || typeof claim.invocationId !== 'string'
      || !/^[0-9a-f]{40}$/.test(claim.revision || '')) throw new Error('invalid execute claim');
    if (!entryExists(terminalPath)) return { classification: 'nonterminal', invocationId: claim.invocationId };
    const terminal = readJsonNoFollow(terminalPath);
    if (terminal.schema !== 1 || terminal.kind !== 'execute-terminal'
      || terminal.invocationId !== claim.invocationId || terminal.revision !== claim.revision
      || terminal.claimDigest !== digest(claim) || !exactPartition(terminal)) throw new Error('invalid execute terminal');
    if (terminal.status === 'failed') return { classification: 'failed', invocationId: claim.invocationId,
      completedIndexes: terminal.completedIndexes, failedIndexes: terminal.failedIndexes,
      unstartedIndexes: terminal.unstartedIndexes };
    if (terminal.status !== 'succeeded' || terminal.completedIndexes.length !== 20
      || terminal.failedIndexes.length || terminal.unstartedIndexes.length) throw new Error('invalid success partition');
    for (const index of EXPECTED_INDEXES) {
      const cellRoot = join(cellsRoot, String(index).padStart(3, '0'));
      const started = readJsonNoFollow(join(cellRoot, 'started.json'));
      const cellTerminal = readJsonNoFollow(join(cellRoot, 'terminal.json'));
      if (started.invocationId !== claim.invocationId || started.index !== index
        || cellTerminal.invocationId !== claim.invocationId || cellTerminal.index !== index
        || cellTerminal.status !== 'completed') throw new Error(`invalid cell evidence: ${index}`);
    }
    verifyGeneration(root, terminal);
    return { classification: 'succeeded', invocationId: claim.invocationId,
      generation: terminal.generation };
  } catch (error) {
    return { classification: 'corrupt', reason: error.message };
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const outputRoot = process.argv[2];
  if (!outputRoot) {
    process.stderr.write('usage: verify-harness-pilot.mjs <output-root>\n');
    process.exitCode = 2;
  } else {
    const result = verifyPilotOutput(outputRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.classification !== 'succeeded') process.exitCode = 2;
  }
}
