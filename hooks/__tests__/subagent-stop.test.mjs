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

test('subagent-stop: 빈 입력 시 continue: true 반환 (additionalContext with default agent name)', () => {
  const result = runHook('subagent-stop.mjs', {});
  assert.strictEqual(result.continue, true);
  assert.ok(result.hookSpecificOutput);
  assert.ok(result.hookSpecificOutput.additionalContext.includes('Subagent stopped'));
  assert.ok(result.hookSpecificOutput.additionalContext.includes('unknown'));
  assert.ok(result.hookSpecificOutput.additionalContext.includes('completed'));
});

test('subagent-stop: agent_name이 있으면 additionalContext에 stop 메시지 포함', () => {
  const result = runHook('subagent-stop.mjs', {
    agent_name: 'TestAgent',
    result_status: 'completed',
    cwd: '/tmp'
  });

  assert.strictEqual(result.continue, true);
  assert.ok(result.hookSpecificOutput);
  assert.ok(result.hookSpecificOutput.additionalContext.includes('Subagent stopped'));
  assert.ok(result.hookSpecificOutput.additionalContext.includes('TestAgent'));
  assert.ok(result.hookSpecificOutput.additionalContext.includes('completed'));
});
