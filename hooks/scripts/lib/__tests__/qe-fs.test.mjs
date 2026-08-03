#!/usr/bin/env node
/**
 * qe-fs.test.mjs — proves the DB-authoritative fs shim serves .qe/ paths from
 * the qe_files table and passes everything else through to real fs.
 *
 * Run: node --test hooks/scripts/lib/__tests__/qe-fs.test.mjs
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync as realWrite, existsSync as realExists, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = join(HERE, '..', 'qe-fs.mjs');

// Each test runs the shim in a fresh child process with QE_ROOT pointed at a
// temp sandbox (QE_ROOT is read at module load, so a child is the clean way).
function runInSandbox(body, { dbOnly = '1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qe-fs-'));
  mkdirSync(join(root, '.qe'), { recursive: true });
  // seed an empty store so the shim's CREATE TABLE has a db to open
  const seed = `import {DatabaseSync} from 'node:sqlite'; new DatabaseSync(${JSON.stringify(join(root, '.qe', 'qe.db'))}).close();`;
  spawnSync('node', ['--input-type=module', '-e', seed], { encoding: 'utf8' });
  const script = `
    process.env.QE_ROOT=${JSON.stringify(root)};
    const fs = await import(${JSON.stringify(pathToFileURL(SHIM).href)});
    const assert = (await import('node:assert/strict')).default;
    const ROOT=${JSON.stringify(root)};
    ${body}
    console.log('OK');
  `;
  // exercise the abolition end-state (DB_ONLY): writes never touch disk
  const env = { ...process.env };
  if (dbOnly == null) delete env.QE_STORE_DB_ONLY;
  else env.QE_STORE_DB_ONLY = dbOnly;
  const r = spawnSync('node', ['--input-type=module', '-e', script], {
    encoding: 'utf8', env,
  });
  return { ok: r.stdout.includes('OK'), out: r.stdout, err: r.stderr, status: r.status };
}

test('write then read a .qe file goes through the DB (no disk file created)', () => {
  const r = runInSandbox(`
    const p = ROOT + '/.qe/tasks/x.md';
    fs.writeFileSync(p, '# hello\\n한글');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(p), false, 'shim write must NOT create a disk file');
    assert.equal(fs.existsSync(p), true, 'shim existsSync sees the row');
    assert.equal(fs.readFileSync(p, 'utf8'), '# hello\\n한글');
  `);
  assert.equal(r.ok, true, r.err);
});

test('planning is DB-only by default while other .qe paths retain transition mirroring', () => {
  const r = runInSandbox(`
    const planning = ROOT + '/.qe/planning/plans/demo/ROADMAP.md';
    const task = ROOT + '/.qe/tasks/demo.md';
    fs.writeFileSync(planning, '# roadmap');
    fs.writeFileSync(task, '# task');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(planning), false, 'planning write must not create a disk file');
    assert.equal(real.existsSync(ROOT + '/.qe/planning'), false, 'planning directory must remain virtual');
    assert.equal(fs.readFileSync(planning, 'utf8'), '# roadmap');
    assert.deepEqual(fs.readdirSync(ROOT + '/.qe/planning/plans/demo'), ['ROADMAP.md']);
    assert.equal(real.existsSync(task), true, 'unmigrated namespaces must keep transition mirroring');
  `, { dbOnly: null });
  assert.equal(r.ok, true, r.err);
});

test('readdirSync unions row children; unlink drops the row', () => {
  const r = runInSandbox(`
    fs.writeFileSync(ROOT+'/.qe/d/a.md','A');
    fs.writeFileSync(ROOT+'/.qe/d/sub/b.md','B');
    const names = fs.readdirSync(ROOT+'/.qe/d').sort();
    assert.deepEqual(names, ['a.md','sub']);
    const types = fs.readdirSync(ROOT+'/.qe/d',{withFileTypes:true});
    assert.equal(types.find(e=>e.name==='sub').isDirectory(), true);
    assert.equal(types.find(e=>e.name==='a.md').isFile(), true);
    fs.unlinkSync(ROOT+'/.qe/d/a.md');
    assert.equal(fs.existsSync(ROOT+'/.qe/d/a.md'), false);
  `);
  assert.equal(r.ok, true, r.err);
});

test('atomic write-tmp-then-rename pattern lands the row at the final path', () => {
  const r = runInSandbox(`
    fs.writeFileSync(ROOT+'/.qe/state/s.json.tmp', '{"v":1}');
    fs.renameSync(ROOT+'/.qe/state/s.json.tmp', ROOT+'/.qe/state/s.json');
    assert.equal(fs.existsSync(ROOT+'/.qe/state/s.json.tmp'), false);
    assert.equal(fs.readFileSync(ROOT+'/.qe/state/s.json','utf8'), '{"v":1}');
  `);
  assert.equal(r.ok, true, r.err);
});

test('non-.qe paths pass straight through to real fs', () => {
  const r = runInSandbox(`
    const p = ROOT + '/outside.txt';
    fs.writeFileSync(p, 'plain');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(p), true, 'non-.qe write must hit real disk');
    assert.equal(fs.readFileSync(p,'utf8'), 'plain');
  `);
  assert.equal(r.ok, true, r.err);
});

test('reading a missing .qe file throws ENOENT', () => {
  const r = runInSandbox(`
    let code=null; try{ fs.readFileSync(ROOT+'/.qe/nope.md','utf8'); }catch(e){ code=e.code; }
    assert.equal(code, 'ENOENT');
  `);
  assert.equal(r.ok, true, r.err);
});
