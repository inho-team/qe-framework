import { readFileSync, writeFileSync, existsSync, mkdirSync } from './qe-fs.mjs';
import path from 'node:path';
import { computeContractHash } from './contract-hash.mjs';
import { assertValidContractName } from './contract-manifest.mjs';

/**
 * Approval lock file manager for contract layer.
 * Maintains `.qe/contracts/.lock` (JSON) tracking approved contract hashes.
 * All name-accepting entry points validate via assertValidContractName (defense-in-depth).
 */

const LOCK_PATH = '.qe/contracts/.lock';

/**
 * Read the lock file; returns empty object if file missing.
 * @param {string} [baseDir] — defaults to process.cwd()
 * @returns {Record<string, {hash: string, approved_at: string, reason: string}>}
 * @throws {Error} if lock file is malformed JSON
 */
export function readLock(baseDir) {
  const lockFile = path.join(baseDir ?? process.cwd(), LOCK_PATH);

  if (!existsSync(lockFile)) {
    return {};
  }

  try {
    const content = readFileSync(lockFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Malformed .qe/contracts/.lock — manual cleanup required');
  }
}

/**
 * Write the full lock object (atomic replace).
 * @param {object} lockData
 * @param {string} [baseDir]
 */
export function writeLock(lockData, baseDir) {
  const lockFile = path.join(baseDir ?? process.cwd(), LOCK_PATH);
  const lockDir = path.dirname(lockFile);

  mkdirSync(lockDir, { recursive: true });
  writeFileSync(lockFile, JSON.stringify(lockData, null, 2) + '\n', 'utf8');
}

/**
 * Update a single entry (approve). Preserves other entries.
 * @param {string} name
 * @param {string} hash — "sha256:..." form
 * @param {string} reason
 * @param {string} [baseDir]
 * @returns {{hash: string, approved_at: string, reason: string}} — the entry written
 */
export function updateLockEntry(name, hash, reason, baseDir) {
  assertValidContractName(name);
  const lockData = readLock(baseDir);

  const entry = {
    hash,
    approved_at: new Date().toISOString(),
    reason: String(reason || '').slice(0, 500)
  };

  lockData[name] = entry;
  writeLock(lockData, baseDir);

  return entry;
}

/**
 * Remove an entry from the lock when an admin revision invalidates approval.
 * @param {string} name
 * @param {string} [baseDir]
 * @returns {boolean} — true if removed, false if not present
 */
export function removeLockEntry(name, baseDir) {
  assertValidContractName(name);
  const lockData = readLock(baseDir);

  if (!(name in lockData)) {
    return false;
  }

  delete lockData[name];
  writeLock(lockData, baseDir);

  return true;
}

/**
 * Verify a contract's content against its lock entry.
 * @param {string} name
 * @param {string} content — the file content
 * @param {string} [baseDir]
 * @returns {{status: 'match'} | {status: 'mismatch', expected: string, actual: string} | {status: 'unapproved'}}
 */
export function verifyLock(name, content, baseDir) {
  assertValidContractName(name);
  const lockData = readLock(baseDir);

  if (!(name in lockData)) {
    return { status: 'unapproved' };
  }

  const actual = computeContractHash(content);
  const expected = lockData[name].hash;

  if (expected === actual) {
    return { status: 'match' };
  }

  return {
    status: 'mismatch',
    expected,
    actual
  };
}

export default { readLock, writeLock, updateLockEntry, removeLockEntry, verifyLock };
