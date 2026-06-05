import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(__dirname, '..', 'scripts');

function runHook(scriptName, input = {}) {
  const inputJson = JSON.stringify(input);
  const result = execSync(
    `echo '${inputJson.replace(/'/g, "'\\''")}' | node "${join(SCRIPTS, scriptName)}"`,
    { encoding: 'utf8', env: { ...process.env, HOME: '/tmp' }, timeout: 5000 }
  );
  return JSON.parse(result.trim());
}

test('session-end: 빈 입력 시 continue: true 반환', () => {
  const result = runHook('session-end.mjs', {});
  assert.deepStrictEqual(result, { continue: true });
});

test('session-end: 정상 입력 시 continue: true 반환', () => {
  const result = runHook('session-end.mjs', {
    session_id: 'test-session-123',
    cwd: '/tmp'
  });

  assert.deepStrictEqual(result, { continue: true });
});
