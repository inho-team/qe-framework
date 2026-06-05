import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(__dirname, '..', 'scripts');

/**
 * Executes a hook script with the given input and returns the parsed JSON output.
 * @param {string} scriptName - The name of the hook script file (e.g., 'setup.mjs')
 * @param {object} input - The input object to pass to the hook (default: {})
 * @returns {object} The parsed JSON output from the hook script
 * @throws {Error} If the script execution fails or output is not valid JSON
 */
function runHook(scriptName, input = {}) {
  const inputJson = JSON.stringify(input);
  const result = execSync(
    `echo '${inputJson.replace(/'/g, "'\\''")}' | node "${join(SCRIPTS, scriptName)}"`,
    { encoding: 'utf8', env: { ...process.env, HOME: '/tmp' }, timeout: 5000 }
  );
  return JSON.parse(result.trim());
}

const stubs = [
  'setup.mjs',
  'user-prompt-expansion.mjs',
  'post-tool-batch.mjs',
  'permission-request.mjs',
  'permission-denied.mjs',
  'task-created.mjs',
  'instructions-loaded.mjs',
  'post-compact.mjs',
  'config-change.mjs',
  'cwd-changed.mjs',
  'worktree-create.mjs',
  'worktree-remove.mjs',
  'stop-failure.mjs',
];

for (const stub of stubs) {
  test(`${stub} returns continue:true on empty input`, () => {
    const result = runHook(stub, {});
    assert.equal(result.continue, true);
  });
}
