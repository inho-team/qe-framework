import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../mcp/codebase-memory.mjs', import.meta.url));

test('MCP launcher restores eval paths and preserves an existing runtime path', (t) => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-cbm-launch-'));
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-cbm-empty-'));
  const name = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  const fakeServer = path.join(binDir, name);
  try {
    fs.linkSync(process.execPath, fakeServer);
  } catch {
    fs.copyFileSync(process.execPath, fakeServer);
  }
  t.after(() => {
    fs.unlinkSync(fakeServer);
    fs.rmdirSync(binDir);
    fs.rmdirSync(emptyPath);
  });

  const env = { ...process.env };
  delete env.CBM_CACHE_DIR;
  env.PATH = binDir;
  env.CBM_RUNTIME_DIR = 'normal runtime';
  env.EVAL_QE_CBM_CACHE_DIR = 'cached graphs';
  env.EVAL_QE_CBM_RUNTIME_DIR = 'eval runtime';
  const result = spawnSync(process.execPath, [launcher], {
    cwd: binDir,
    env,
    input: 'console.log(JSON.stringify([process.env.CBM_CACHE_DIR, process.env.CBM_RUNTIME_DIR]));',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['cached graphs', 'normal runtime']);

  // Some Windows hosts search cwd implicitly when this variable is absent.
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[key];
  }
  const missing = spawnSync(process.execPath, [launcher], {
    cwd: binDir,
    env: { ...env, PATH: emptyPath },
    input: 'console.log("unexpected cwd executable");',
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stderr, /codebase-memory-mcp.*PATH/);
});
