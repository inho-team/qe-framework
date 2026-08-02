#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from '../hooks/scripts/lib/qe-fs.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidContractName } from '../hooks/scripts/lib/contract-manifest.mjs';
import { computeContractHash } from '../hooks/scripts/lib/contract-hash.mjs';
import { readLock, removeLockEntry, updateLockEntry } from '../hooks/scripts/lib/contract-lock.mjs';

function usage() {
  return 'Usage: node scripts/qe-contract.mjs approve|retire <name> --reason "<reason>"';
}

function parseReason(args) {
  const index = args.indexOf('--reason');
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

/** Promote one reviewed pending contract and record its immutable approval hash. */
export function approveContract(name, reason, baseDir = process.cwd()) {
  assertValidContractName(name);
  if (!reason) throw new Error('--reason is required');

  const pending = join(baseDir, '.qe', 'contracts', 'pending', `${name}.md`);
  const active = join(baseDir, '.qe', 'contracts', 'active', `${name}.md`);
  if (!existsSync(pending)) throw new Error(`Pending contract not found: ${name}`);
  if (existsSync(active)) throw new Error(`Active contract already exists: ${name}`);

  const content = readFileSync(pending, 'utf8');
  mkdirSync(join(baseDir, '.qe', 'contracts', 'active'), { recursive: true });
  renameSync(pending, active);
  try {
    const entry = updateLockEntry(name, computeContractHash(content), reason, baseDir);
    return { name, path: active, ...entry };
  } catch (error) {
    try { renameSync(active, pending); } catch { /* leave original error as the primary failure */ }
    throw error;
  }
}

/**
 * Retire one active contract without discarding its reviewed content or approval
 * history. The active file is moved to archived/ and a sidecar records the
 * retirement reason plus the previous lock entry. Any post-move failure rolls
 * the active file back before the error escapes.
 */
export function retireContract(name, reason, baseDir = process.cwd()) {
  assertValidContractName(name);
  if (!reason) throw new Error('--reason is required');

  const active = join(baseDir, '.qe', 'contracts', 'active', `${name}.md`);
  const archivedDir = join(baseDir, '.qe', 'contracts', 'archived');
  const archived = join(archivedDir, `${name}.md`);
  const retirement = join(archivedDir, `${name}.retirement.json`);

  if (!existsSync(active)) throw new Error(`Active contract not found: ${name}`);
  if (existsSync(archived) || existsSync(retirement)) throw new Error(`Archived contract already exists: ${name}`);

  // Validate lock readability before moving anything. A malformed lock must
  // fail closed while the active contract remains untouched.
  const previousApproval = readLock(baseDir)[name] ?? null;
  mkdirSync(archivedDir, { recursive: true });
  renameSync(active, archived);

  try {
    const record = {
      name,
      retired_at: new Date().toISOString(),
      reason: String(reason).slice(0, 500),
      previous_approval: previousApproval,
    };
    writeFileSync(retirement, JSON.stringify(record, null, 2) + '\n', 'utf8');
    removeLockEntry(name, baseDir);
    return { name, path: archived, retirementPath: retirement, previousApproval };
  } catch (error) {
    try { if (existsSync(retirement)) unlinkSync(retirement); } catch { /* preserve primary error */ }
    try { renameSync(archived, active); } catch { /* preserve primary error */ }
    throw error;
  }
}

export function main(args = process.argv.slice(2)) {
  const [command, name] = args;
  if (!name || !['approve', 'retire'].includes(command)) throw new Error(usage());
  const reason = parseReason(args);
  if (command === 'approve') {
    const result = approveContract(name, reason);
    process.stdout.write(`Approved contract ${result.name} (${result.hash})\n`);
    return;
  }
  const result = retireContract(name, reason);
  process.stdout.write(`Retired contract ${result.name} (${result.path})\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`qe-contract: ${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}
