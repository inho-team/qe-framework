#!/usr/bin/env node
'use strict';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const LINE_HASH_PATTERN = /^[a-f0-9]{16}$/;

/** Hash exactly one line, excluding its line terminator. */
export function hashLineContent(lineContent) {
  return createHash('sha256').update(String(lineContent), 'utf8').digest('hex').slice(0, 16);
}

export function createLineAnchor(fileContent, line) {
  const lines = String(fileContent).split(/\r?\n/);
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    throw new RangeError('line anchor requires an existing 1-based line');
  }
  return { line, hash: hashLineContent(lines[line - 1]) };
}

/**
 * Validate a line/hash precondition against the latest file content. On a
 * mismatch, locate a unique moved line carrying the observed hash when possible.
 */
export function validateLineAnchor(fileContent, anchor) {
  if (!anchor || !Number.isInteger(anchor.line) || anchor.line < 1 || !LINE_HASH_PATTERN.test(String(anchor.hash || ''))) {
    return { allowed: false, reason: 'invalid-line-anchor', current: null, remap: null };
  }

  const lines = String(fileContent).split(/\r?\n/);
  const current = anchor.line <= lines.length
    ? { line: anchor.line, hash: hashLineContent(lines[anchor.line - 1]) }
    : null;
  if (current?.hash === anchor.hash) {
    return { allowed: true, reason: 'line-hash-matched', current, remap: null };
  }

  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (hashLineContent(lines[index]) === anchor.hash) matches.push(index + 1);
  }

  const remap = matches.length === 1
    ? { line: matches[0], hash: anchor.hash, kind: 'unique-hash-match' }
    : current
      ? { ...current, kind: 'current-line-changed' }
      : null;

  return {
    allowed: false,
    reason: 'line-hash-mismatch',
    expected: { line: anchor.line, hash: anchor.hash },
    current,
    remap,
    candidates: matches,
  };
}

function readAnchor(toolInput) {
  if (Object.hasOwn(toolInput, 'line_anchor')) return toolInput.line_anchor;
  if (Object.hasOwn(toolInput, 'lineAnchor')) return toolInput.lineAnchor;
  return undefined;
}

function withoutAnchor(toolInput) {
  const { line_anchor: _snake, lineAnchor: _camel, ...sanitized } = toolInput;
  return sanitized;
}

/** Evaluate and strip the optional Edit-only line anchor metadata. */
export function evaluateEditPrecondition({ toolName, toolInput = {}, cwd = process.cwd(), readFile = readFileSync } = {}) {
  const anchor = readAnchor(toolInput);
  if (toolName !== 'Edit' || anchor === undefined) {
    return { applies: false, allowed: true, sanitizedInput: toolInput };
  }

  const sanitizedInput = withoutAnchor(toolInput);
  const filePath = toolInput.file_path || toolInput.filePath;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { applies: true, allowed: false, reason: 'missing-edit-file-path', remap: null, sanitizedInput };
  }

  try {
    const absolutePath = resolve(cwd, filePath);
    const content = readFile(absolutePath, 'utf8');
    return { applies: true, sanitizedInput, ...validateLineAnchor(content, anchor) };
  } catch (error) {
    return {
      applies: true,
      allowed: false,
      reason: 'edit-target-unreadable',
      detail: error?.code || error?.message || 'read-failed',
      remap: null,
      sanitizedInput,
    };
  }
}

export function formatStaleEditAction(result) {
  const remap = result.remap ? ` remap=${JSON.stringify(result.remap)}` : '';
  return `Re-read the target line, create a fresh line_anchor, and retry.${remap}`;
}

/**
 * Compatibility parser for clients that attach multiple observed line hashes.
 * Canonical shape: stale_edit_precondition: { file_path?, observations:[{line,hash}] }.
 */
export function staleEditPreconditionFromToolInput(toolInput = {}) {
  const envelope = toolInput.stale_edit_precondition
    ?? toolInput.staleEditPrecondition
    ?? toolInput.qe_stale_edit;
  if (envelope === undefined) return null;

  const observations = Array.isArray(envelope?.observations) ? envelope.observations : [];
  return {
    filePath: envelope?.file_path || envelope?.filePath || toolInput.file_path || toolInput.filePath || '',
    observations,
  };
}

/** Validate every observation in a multi-line compatibility envelope. */
export function checkStaleEditPrecondition(cwd, filePath, observations, options = {}) {
  if (typeof filePath !== 'string' || !filePath.trim() || !Array.isArray(observations) || observations.length === 0) {
    return { ok: false, reason: 'invalid-stale-edit-precondition', conflicts: [] };
  }

  let content;
  try {
    content = (options.readFile ?? readFileSync)(resolve(cwd, filePath), 'utf8');
  } catch (error) {
    return { ok: false, reason: `edit-target-unreadable:${error?.code || 'read-failed'}`, conflicts: [] };
  }

  const conflicts = [];
  for (const observation of observations) {
    const verdict = validateLineAnchor(content, observation);
    if (verdict.allowed) continue;
    let remap = { kind: 'not-found' };
    if (verdict.remap?.kind === 'unique-hash-match') {
      remap = { kind: 'unique', line: verdict.remap.line, hash: verdict.remap.hash };
    } else if (Array.isArray(verdict.candidates) && verdict.candidates.length > 1) {
      remap = { kind: 'ambiguous', candidates: verdict.candidates };
    } else if (verdict.remap) {
      remap = { kind: 'current', line: verdict.remap.line, hash: verdict.remap.hash };
    }
    conflicts.push({ line: observation?.line ?? null, hash: observation?.hash ?? null, remap });
  }

  return {
    ok: conflicts.length === 0,
    reason: conflicts.length === 0 ? 'line-hashes-matched' : 'line-hash-mismatch',
    conflicts,
  };
}
