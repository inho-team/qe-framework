import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QE_POINTER_BEGIN,
  QE_POINTER_END,
  ensureQeProjectInstructions,
  instructionFileForClient,
  isQeInstructionBootstrapCommand,
} from '../project-instructions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

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

test('Qgoal and Qplan documents pin explicit-only Full SIVS and native ordinary work', () => {
  const qgoal = readFileSync(join(ROOT, 'skills', 'Qgoal', 'SKILL.md'), 'utf8');
  const qplan = readFileSync(join(ROOT, 'skills', 'Qplan', 'SKILL.md'), 'utf8');
  const sessionStart = readFileSync(join(ROOT, 'hooks', 'scripts', 'session-start.mjs'), 'utf8');
  const philosophy = readFileSync(join(ROOT, 'core', 'PHILOSOPHY.md'), 'utf8');
  const principles = readFileSync(join(ROOT, 'core', 'PRINCIPLES.md'), 'utf8');
  assert.match(qgoal, /Explicit Single-Goal Qplan Alias/);
  assert.match(qgoal, /Ordinary requests remain on the native client path/);
  assert.doesNotMatch(qgoal, /clear natural-language goals/i);
  assert.match(qplan, /explicit high-assurance entry/);
  assert.match(qplan, /Safety Kernel and QE response style stay/);
  assert.match(sessionStart, /Explicit Full SIVS entry/);
  assert.match(sessionStart, /Ordinary requests stay native/);
  assert.doesNotMatch(sessionStart, /clear natural-language goal/i);
  assert.doesNotMatch(sessionStart, /spec → .*Qgenerate-spec/);
  assert.doesNotMatch(sessionStart, /execute → .*Qexecute/);
  assert.match(philosophy, /native client path is the default/i);
  assert.doesNotMatch(philosophy, /drives every task to completion/i);
  assert.match(philosophy, /Obligations 1–5 and 8 govern work after\s+the user enters a Full SIVS Plan/);
  assert.match(philosophy, /do not create\s+an entry from ordinary prose/);
  assert.doesNotMatch(philosophy, /Every skill, agent, and hook in this framework must uphold/);
  assert.match(principles, /never promotes an ordinary request into Full SIVS/);
  assert.doesNotMatch(principles, /automatically route through/);
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
