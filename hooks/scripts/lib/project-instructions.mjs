/**
 * Project instruction bootstrap for QE entry points.
 *
 * `QE.md` is the client-neutral shared contract.  Claude and Codex load
 * different root instruction files, so this module adds a small managed pointer
 * to the active client's file without replacing user-authored instructions.
 */

import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const QE_POINTER_BEGIN = '<!-- qe-framework:begin -->';
export const QE_POINTER_END = '<!-- qe-framework:end -->';

const QE_MD = `# QE Framework Project Instructions

This is the shared QE Framework contract for this project. It is intentionally
client-neutral: Claude-specific behavior belongs in \`CLAUDE.md\`; Codex-specific
behavior belongs in \`AGENTS.md\`.

## Required workflow

- Start or resume outcome-oriented work with \`Qplan\` or \`Qgoal\`.
- A Plan owns its Goals. Specification, execution, verification, and evidence
  recording are internal QE stages; do not treat a bare test claim as completion.
- Preserve project-local instructions and use the repository's documented
  validation commands before declaring work complete.

## Authoritative references

- \`QE_CONVENTIONS.md\` — workflow, naming, and routing rules.
- \`docs/USAGE_GUIDE.md\` — user workflow and lifecycle behavior.
- \`docs/STORE_SCHEMA.md\` — document-store schema, ERD, and migrations.

Project-specific rules may be added below this line. QE upgrades do not overwrite
this file automatically.
`;

function pointerBlock() {
  return `${QE_POINTER_BEGIN}
## QE Framework

Before QE work, read \`QE.md\` and use it as the shared QE contract. Keep this
client's instructions for client-specific behavior only.
${QE_POINTER_END}
`;
}

export function instructionFileForClient(client = 'claude') {
  return String(client).toLowerCase() === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
}

/** True only for explicit QE entry commands, never ordinary natural-language text. */
export function isQeInstructionBootstrapCommand(message) {
  return /^[\t ]*(?:\/|\$)(?:Qplan|Qgoal)(?=\s|$)/i.test(String(message ?? ''));
}

function canWriteFile(path) {
  if (!existsSync(path)) return { ok: true, exists: false };
  let stat;
  try { stat = lstatSync(path); } catch { return { ok: false, reason: 'unreadable' }; }
  if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink' };
  if (!stat.isFile()) return { ok: false, reason: 'not-a-file' };
  return { ok: true, exists: true };
}

function atomicWrite(path, content) {
  const tmp = `${path}.qe-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o644 });
  renameSync(tmp, path);
}

function ensurePointer(path) {
  const state = canWriteFile(path);
  if (!state.ok) return { status: 'skipped', reason: state.reason };
  if (!state.exists) {
    atomicWrite(path, `# ${path.split('/').pop()}\n\n${pointerBlock()}`);
    return { status: 'created' };
  }

  const text = readFileSync(path, 'utf8');
  const begin = text.indexOf(QE_POINTER_BEGIN);
  const end = text.indexOf(QE_POINTER_END);
  if (begin === -1 && end !== -1 || begin !== -1 && end === -1 || (end !== -1 && end < begin)) {
    return { status: 'skipped', reason: 'malformed-managed-block' };
  }
  if (begin !== -1) {
    const afterEnd = end + QE_POINTER_END.length;
    const next = `${text.slice(0, begin)}${pointerBlock().trimEnd()}${text.slice(afterEnd)}`;
    if (next !== text) atomicWrite(path, next);
    return { status: 'updated' };
  }

  const separator = text.endsWith('\n') ? '\n' : '\n\n';
  atomicWrite(path, `${text}${separator}${pointerBlock()}`);
  return { status: 'updated' };
}

/**
 * Ensure the shared QE.md and the active client's root instruction pointer.
 * Existing QE.md content is never rewritten, and malformed/symlink instruction
 * files are reported instead of followed or overwritten.
 */
export function ensureQeProjectInstructions(cwd, client = 'claude') {
  const root = resolve(cwd);
  const qePath = join(root, 'QE.md');
  const qeState = canWriteFile(qePath);
  const result = { qe: null, instruction: instructionFileForClient(client), pointer: null, errors: [] };

  if (!qeState.ok) {
    result.qe = 'skipped';
    result.errors.push(`QE.md:${qeState.reason}`);
  } else if (!qeState.exists) {
    atomicWrite(qePath, QE_MD);
    result.qe = 'created';
  } else {
    result.qe = 'existing';
  }

  const pointer = ensurePointer(join(root, result.instruction));
  result.pointer = pointer.status;
  if (pointer.reason) result.errors.push(`${result.instruction}:${pointer.reason}`);
  return result;
}
