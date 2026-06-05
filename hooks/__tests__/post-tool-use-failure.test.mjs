import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
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

test('post-tool-use-failure: 빈 입력 시 continue: true 반환', () => {
  const result = runHook('post-tool-use-failure.mjs', {});
  assert.deepStrictEqual(result, { continue: true });
});

test('post-tool-use-failure: 도구 실패 정보가 포함된 입력 시 continue: true 반환', () => {
  const tempCwd = mkdtempSync(join(tmpdir(), 'qe-test-'));

  const result = runHook('post-tool-use-failure.mjs', {
    tool_name: 'Read',
    error: 'File not found',
    duration_ms: 100,
    cwd: tempCwd
  });

  assert.strictEqual(result.continue, true);
  // Fresh state → streak = 1, so no hookSpecificOutput
  assert.strictEqual(result.hookSpecificOutput, undefined);
});
