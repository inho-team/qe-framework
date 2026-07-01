import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const WRAPPER = join(ROOT, 'scripts', 'codex', 'lifecycle-codex.mjs');

test('Codex lifecycle wrapper rewrites slash skill commands in hook output', () => {
  const temp = mkdtempSync(join(tmpdir(), 'qe-codex-wrapper-'));
  const scriptRel = 'scripts/__tmp-codex-wrapper-target.mjs';
  const scriptAbs = join(ROOT, scriptRel);
  try {
    writeFileSync(scriptAbs, [
      "process.stdout.write(JSON.stringify({ continue: true, hookSpecificOutput: { additionalContext: 'Run /Qgs next and then `/Qcommit`.' } }));",
      "process.stderr.write('[QE:BLOCK] action=Use /Qcommit instead');",
      "process.exit(2);",
    ].join('\n'), 'utf8');

    const result = spawnSync(process.execPath, [WRAPPER, 'PreToolUse', scriptRel], {
      input: JSON.stringify({ cwd: temp, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /\$Qgs next/);
    assert.match(result.stdout, /`\$Qcommit`/);
    assert.match(result.stderr, /Use \$Qcommit instead/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(scriptAbs, { force: true });
  }
});

test('Codex lifecycle wrapper promotes tool_input.workdir to hook cwd', () => {
  const temp = mkdtempSync(join(tmpdir(), 'qe-codex-wrapper-workdir-'));
  const scriptRel = 'scripts/__tmp-codex-wrapper-cwd-target.mjs';
  const scriptAbs = join(ROOT, scriptRel);
  try {
    writeFileSync(scriptAbs, [
      "process.stdout.write(JSON.stringify({ continue: true, cwd: process.cwd() }));",
    ].join('\n'), 'utf8');

    const result = spawnSync(process.execPath, [WRAPPER, 'PreToolUse', scriptRel], {
      input: JSON.stringify({
        tool_name: 'exec_command',
        tool_input: { workdir: temp, command: 'pwd' },
      }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(scriptAbs, { force: true });
  }
});

test('Codex lifecycle wrapper emits minimal JSON for PreCompact', () => {
  const scriptRel = 'scripts/__tmp-codex-wrapper-precompact-target.mjs';
  const scriptAbs = join(ROOT, scriptRel);
  try {
    writeFileSync(scriptAbs, [
      "process.stdout.write(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: 'Run /Qcompact after compact.' } }));",
    ].join('\n'), 'utf8');

    const result = spawnSync(process.execPath, [WRAPPER, 'PreCompact', scriptRel], {
      input: JSON.stringify({ cwd: process.cwd(), hook_event_name: 'PreCompact' }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { continue: true });
    assert.equal(result.stderr, '');
  } finally {
    rmSync(scriptAbs, { force: true });
  }
});
