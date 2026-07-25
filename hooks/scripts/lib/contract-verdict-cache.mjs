import { readFileSync, writeFileSync, existsSync, mkdirSync } from './qe-fs.mjs';
import path from 'node:path';
import { assertValidContractName } from './contract-manifest.mjs';

/**
 * Verdict cache manager for contract judge results.
 * Maintains `.qe/contracts/.verdicts/{name}.json` tracking LLM judge verdicts keyed by contract + implementation + test hashes.
 * All name-accepting entry points validate via assertValidContractName (defense-in-depth).
 */

const VERDICTS_DIR = '.qe/contracts/.verdicts';

/**
 * Read verdict cache entry for a contract. Returns null if no cached verdict exists.
 * @param {string} name
 * @param {string} [baseDir] — defaults to process.cwd()
 * @returns {object | null}
 * @throws {Error} if verdict cache file is malformed JSON
 */
export function readVerdict(name, baseDir) {
  assertValidContractName(name);
  const cacheDir = path.join(baseDir ?? process.cwd(), VERDICTS_DIR);
  const verdictFile = path.join(cacheDir, name + '.json');

  if (!existsSync(verdictFile)) {
    return null;
  }

  try {
    const content = readFileSync(verdictFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed verdict cache: ${name} — manual cleanup required`);
  }
}

/**
 * Write verdict cache entry. Creates .verdicts/ dir if missing.
 * Overwrites any existing entry.
 * @param {string} name
 * @param {object} data — must have all 8 fields: contract_hash, impl_hash, test_hash, verdict, summary, findings, judged_at, model
 * @param {string} [baseDir]
 * @throws {Error} if any required field is missing or invalid
 */
export function writeVerdict(name, data, baseDir) {
  assertValidContractName(name);

  // Validate all required fields.
  const requiredFields = ['contract_hash', 'impl_hash', 'test_hash', 'verdict', 'summary', 'findings', 'judged_at', 'model'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      throw new Error(`writeVerdict: missing field ${field}`);
    }
  }

  // Validate verdict enum.
  if (data.verdict !== 'PASS' && data.verdict !== 'FAIL') {
    throw new Error(`writeVerdict: verdict must be "PASS" or "FAIL", got "${data.verdict}"`);
  }

  // Validate findings is an array.
  if (!Array.isArray(data.findings)) {
    throw new Error(`writeVerdict: findings must be an array`);
  }

  const cacheDir = path.join(baseDir ?? process.cwd(), VERDICTS_DIR);
  const verdictFile = path.join(cacheDir, name + '.json');

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(verdictFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Check whether a cached verdict matches the given 3-hash tuple.
 * @param {string} name
 * @param {{contract_hash: string, impl_hash: string, test_hash: string}} hashes
 * @param {string} [baseDir]
 * @returns {boolean} — true if cache exists AND all 3 hashes match; false otherwise
 */
export function isCacheHit(name, hashes, baseDir) {
  assertValidContractName(name);

  try {
    const verdict = readVerdict(name, baseDir);
    if (!verdict) {
      return false;
    }

    return (
      verdict.contract_hash === hashes.contract_hash &&
      verdict.impl_hash === hashes.impl_hash &&
      verdict.test_hash === hashes.test_hash
    );
  } catch {
    // Graceful fallback: treat malformed cache as cache miss.
    return false;
  }
}

export default { readVerdict, writeVerdict, isCacheHit };
