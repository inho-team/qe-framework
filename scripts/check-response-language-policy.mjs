#!/usr/bin/env node
/**
 * CI guard for the canonical user-facing response-language contract.
 *
 * Client instruction files may add client-specific behavior, but they must not
 * override the shared latest-user-message language policy.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_POLICY_FILES = ['AGENTS.md', 'QE_CONVENTIONS.md'];
const OPTIONAL_POLICY_FILES = ['CLAUDE.md'];
const POLICY_MARKER = '<!-- qe:response-language=latest-user-message -->';
const POLICY_SENTENCE = "Reply in the language of the user's most recent message. Use a stored language profile only when that message has no detectable natural language.";

const CONFLICT_PATTERNS = [
  { label: 'English-first response policy', pattern: /reply\s+in\s+English|English\s*\([^)]*primary\s+language|English[- ]first/iu },
  { label: 'profile-first response policy', pattern: /(?:check|use|follow)\s+[^\n]{0,80}(?:profile\/language|language\s+profile)[^\n]{0,80}(?:preferred|primary|always)/iu },
];

/** Return semantic policy failures for an instruction-document map. */
export function evaluateResponseLanguagePolicy(documents, { requiredFiles = [...REQUIRED_POLICY_FILES, ...OPTIONAL_POLICY_FILES] } = {}) {
  const failures = [];

  for (const rel of requiredFiles) {
    const text = documents[rel];
    if (typeof text !== 'string') {
      failures.push(`${rel}: missing response-language policy document`);
      continue;
    }

    const markerCount = text.split(POLICY_MARKER).length - 1;
    if (markerCount !== 1) failures.push(`${rel}: expected exactly one canonical policy marker, found ${markerCount}`);
    if (!text.includes(POLICY_SENTENCE)) failures.push(`${rel}: canonical latest-user-message policy sentence is missing or changed`);

    for (const { label, pattern } of CONFLICT_PATTERNS) {
      if (pattern.test(text)) failures.push(`${rel}: conflicts with canonical policy (${label})`);
    }
  }

  return failures;
}

function run() {
  // CLAUDE.md is intentionally gitignored because it is user-authored local
  // adapter state. Validate it whenever present, while keeping clean-checkout CI
  // valid. The synthetic fixture below always exercises Claude conflict handling.
  const presentOptional = OPTIONAL_POLICY_FILES.filter((rel) => existsSync(join(ROOT, rel)));
  const liveFiles = [...REQUIRED_POLICY_FILES, ...presentOptional];
  const documents = Object.fromEntries(liveFiles.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));
  const failures = evaluateResponseLanguagePolicy(documents, { requiredFiles: liveFiles });

  // Prove the guard rejects the regression that motivated it, rather than only
  // checking that files exist.
  const canonicalClaude = documents['CLAUDE.md'] || `${POLICY_MARKER}\n${POLICY_SENTENCE}\n`;
  const conflictFixture = {
    ...documents,
    'CLAUDE.md': `${canonicalClaude}\n- Reply in English (primary language)\n`,
  };
  if (evaluateResponseLanguagePolicy(conflictFixture).length === 0) {
    failures.push('self-test: Claude English-first conflict fixture was not rejected');
  }

  if (failures.length > 0) {
    console.error('check-response-language-policy: FAIL');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }

  const claudeState = presentOptional.length > 0 ? 'CLAUDE.md checked' : 'CLAUDE.md absent/fixture checked';
  console.log(`check-response-language-policy: PASS (AGENTS.md + QE_CONVENTIONS.md aligned; ${claudeState})`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) run();
