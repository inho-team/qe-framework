#!/usr/bin/env node

//
// Git pre-commit hook: validates staged active contracts against .qe/contracts/.lock.
// Enforces contract approval before commit (3rd layer of defense).
//
// Installation:
//   ln -s ../../hooks/git/pre-commit-contract-check.mjs .git/hooks/pre-commit
//   chmod +x .git/hooks/pre-commit
//
// Or as part of an existing pre-commit chain, add:
//   node hooks/git/pre-commit-contract-check.mjs || exit 1
//

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { verifyLock } from '../scripts/lib/contract-lock.mjs';

/**
 * Main entry point: check staged active contracts for approval.
 */
async function main() {
  try {
    // Get staged files (ACM = added/copied/modified).
    // execFileSync (argv array, no shell) blocks filename-injection — git permits
    // metacharacters in filenames which would be executed by shell interpolation.
    let stagedFiles;
    try {
      const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      stagedFiles = output.trim().split('\n').filter(f => f.length > 0);
    } catch (err) {
      // Fail open: if git command fails unexpectedly, exit 0 (don't block)
      process.exit(0);
    }

    // Filter for active contracts: .qe/contracts/active/*.md
    const activeContractFiles = stagedFiles.filter(file =>
      file.startsWith('.qe/contracts/active/') && file.endsWith('.md')
    );

    // If no active contracts staged, exit silently (happy path)
    if (activeContractFiles.length === 0) {
      process.exit(0);
    }

    // For each staged active contract, verify against lock
    const failures = [];

    for (const file of activeContractFiles) {
      const name = path.basename(file, '.md');
      let content;

      try {
        // Get the staged content from git index — execFileSync argv form so that
        // filenames with shell metachars (`;`, backticks, `$()`) cannot be executed.
        content = execFileSync('git', ['show', `:${file}`], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        // Fail open: infrastructure error, don't block
        continue;
      }

      // Verify contract lock
      const result = verifyLock(name, content);

      if (result.status === 'mismatch') {
        failures.push({
          name,
          type: 'mismatch',
          expected: result.expected,
          actual: result.actual
        });
      } else if (result.status === 'unapproved') {
        failures.push({
          name,
          type: 'unapproved'
        });
      }
      // If status === 'match', no failure
    }

    // If any failures, print message and exit 1
    if (failures.length > 0) {
      process.stderr.write('\n✖ Contract drift detected (commit blocked):\n');
      for (const failure of failures) {
        if (failure.type === 'mismatch') {
          process.stderr.write(
            `  - ${failure.name} [mismatch] expected: ${failure.expected} actual: ${failure.actual}\n`
          );
        } else {
          process.stderr.write(
            `  - ${failure.name} [unapproved] — run \`npm run qe:contract -- approve ${failure.name} --reason "..."\` first\n`
          );
        }
      }
      process.stderr.write('\nTo approve edits: npm run qe:contract -- approve <name> --reason "..."\n');
      process.stderr.write('To bypass (not recommended): git commit --no-verify\n\n');
      process.exit(1);
    }

    // All contracts match: exit 0 silently
    process.exit(0);
  } catch (err) {
    // Unexpected error: fail open (don't block commits on bugs)
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
