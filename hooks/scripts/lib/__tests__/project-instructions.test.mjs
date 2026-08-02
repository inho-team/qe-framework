import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  QE_POINTER_BEGIN,
  QE_POINTER_END,
  ensureQeProjectInstructions,
  instructionFileForClient,
  isQeInstructionBootstrapCommand,
} from '../project-instructions.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-project-instructions-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('explicit Qplan creates QE.md and a Claude pointer without a pre-existing instruction file', () => {
  const { dir, cleanup } = fixture();
  try {
    const result = ensureQeProjectInstructions(dir, 'claude');
    assert.equal(result.qe, 'created');
    assert.equal(result.instruction, 'CLAUDE.md');
    assert.equal(result.pointer, 'created');
    assert.match(readFileSync(join(dir, 'QE.md'), 'utf8'), /client-neutral/);
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), new RegExp(QE_POINTER_BEGIN));
  } finally { cleanup(); }
});

test('Codex uses AGENTS.md and preserves user-authored instructions on repeat', () => {
  const { dir, cleanup } = fixture();
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# Team rules\nDo not rewrite this.\n');
    ensureQeProjectInstructions(dir, 'codex');
    ensureQeProjectInstructions(dir, 'codex');
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(content, /Do not rewrite this\./);
    assert.equal(content.split(QE_POINTER_BEGIN).length - 1, 1);
    assert.equal(instructionFileForClient('codex'), 'AGENTS.md');
  } finally { cleanup(); }
});

test('existing QE.md is never overwritten and malformed or symlinked instruction files are skipped', () => {
  const { dir, cleanup } = fixture();
  try {
    writeFileSync(join(dir, 'QE.md'), '# Custom QE rules\n');
    writeFileSync(join(dir, 'CLAUDE.md'), `${QE_POINTER_BEGIN}\npartial`);
    const malformed = ensureQeProjectInstructions(dir, 'claude');
    assert.equal(readFileSync(join(dir, 'QE.md'), 'utf8'), '# Custom QE rules\n');
    assert.equal(malformed.pointer, 'skipped');
    assert.ok(malformed.errors.includes('CLAUDE.md:malformed-managed-block'));

    rmSync(join(dir, 'CLAUDE.md'));
    writeFileSync(join(dir, 'outside.md'), '# external\n');
    symlinkSync(join(dir, 'outside.md'), join(dir, 'CLAUDE.md'));
    const symlink = ensureQeProjectInstructions(dir, 'claude');
    assert.equal(symlink.pointer, 'skipped');
    assert.ok(symlink.errors.includes('CLAUDE.md:symlink'));
  } finally { cleanup(); }
});

test('bootstrap trigger only accepts explicit public Qplan and Qgoal commands', () => {
  for (const command of ['/Qplan add auth', '$Qgoal fix login']) {
    assert.equal(isQeInstructionBootstrapCommand(command), true, command);
  }
  for (const message of ['plan this work', 'Qplan without prefix', '/Qexecute run', '$Qgenerate-spec task', '/Qgs legacy spec', 'please use Qgoal']) {
    assert.equal(isQeInstructionBootstrapCommand(message), false, message);
  }
});

test('managed pointer markers remain balanced', () => {
  const { dir, cleanup } = fixture();
  try {
    ensureQeProjectInstructions(dir, 'claude');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.equal(content.split(QE_POINTER_BEGIN).length - 1, 1);
    assert.equal(content.split(QE_POINTER_END).length - 1, 1);
    assert.equal(existsSync(join(dir, 'QE.md')), true);
  } finally { cleanup(); }
});
