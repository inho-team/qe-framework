import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanDocs, computeIndex, rebuildIndex, KINDS } from '../doc-index.mjs';

/** Create an isolated temp project root with a `mk(relPath, body)` file writer. */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'qe-doc-index-'));
  const mk = (rel, body) => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf8');
  };
  return { root, mk };
}

test('scanDocs derives kind from frontmatter, else from filename, and excludes .archive', () => {
  const { root, mk } = makeRoot();
  try {
    mk('.qe/tasks/in-progress/TASK_REQUEST_7950a12c.md',
      '# TASK_REQUEST_7950a12c — Doc Layer\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: 7950a12c\nstatus: in-progress\n-->\nbody');
    // No frontmatter → kind inferred from the SECURITY_REPORT filename.
    mk('.qe/security-reports/SECURITY_REPORT_20260101_000000.md', '# SECURITY_REPORT\nbody');
    // Legacy task, no block → grandfathered but still indexed as spec.
    mk('.qe/tasks/pending/TASK_REQUEST_qsumm001.md', '# TASK_REQUEST_qsumm001 — Legacy\nbody');
    // Archived doc must NOT appear.
    mk('.qe/tasks/.archive/TASK_REQUEST_deadbeef.md', '# TASK_REQUEST_deadbeef — Archived\nbody');

    const docs = scanDocs(root);
    const byRel = Object.fromEntries(docs.map(d => [d.rel, d]));

    assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_7950a12c.md'].kind, 'spec');
    assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_7950a12c.md'].status, 'in-progress');
    assert.equal(byRel['.qe/security-reports/SECURITY_REPORT_20260101_000000.md'].kind, 'audit');
    assert.equal(byRel['.qe/tasks/pending/TASK_REQUEST_qsumm001.md'].kind, 'spec');
    // status falls back to the lifecycle folder when frontmatter is absent.
    assert.equal(byRel['.qe/tasks/pending/TASK_REQUEST_qsumm001.md'].status, 'pending');
    assert.ok(!docs.some(d => d.rel.includes('.archive')), 'archive must be excluded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computeIndex is deterministic and groups every kind section', () => {
  const { root, mk } = makeRoot();
  try {
    mk('.qe/tasks/in-progress/TASK_REQUEST_7950a12c.md',
      '# TASK_REQUEST_7950a12c — Doc Layer\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: 7950a12c\n-->\nbody');
    const a = computeIndex(root);
    const b = computeIndex(root);
    assert.equal(a, b, 'identical state yields identical output');
    for (const kind of KINDS) {
      assert.ok(a.includes(`## ${kind}`), `section for ${kind} present`);
    }
    assert.ok(a.includes('[[.qe/tasks/in-progress/TASK_REQUEST_7950a12c.md]]'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuildIndex writes .qe/index.md atomically and self-heals stale rows', () => {
  const { root, mk } = makeRoot();
  try {
    mkdirSync(join(root, '.qe'), { recursive: true });
    mk('.qe/tasks/pending/TASK_REQUEST_aaaaaaaa.md', '# TASK_REQUEST_aaaaaaaa — One\nbody');
    rebuildIndex(root);
    let idx = readFileSync(join(root, '.qe', 'index.md'), 'utf8');
    assert.ok(idx.includes('TASK_REQUEST_aaaaaaaa.md'));
    assert.ok(!existsSync(join(root, '.qe', `.index.md.${process.pid}.tmp`)), 'no temp left behind');

    // Remove the doc and rebuild: the stale row must disappear (no append).
    rmSync(join(root, '.qe/tasks/pending/TASK_REQUEST_aaaaaaaa.md'));
    mk('.qe/tasks/pending/TASK_REQUEST_bbbbbbbb.md', '# TASK_REQUEST_bbbbbbbb — Two\nbody');
    rebuildIndex(root);
    idx = readFileSync(join(root, '.qe', 'index.md'), 'utf8');
    assert.ok(!idx.includes('TASK_REQUEST_aaaaaaaa.md'), 'stale row removed on rebuild');
    assert.ok(idx.includes('TASK_REQUEST_bbbbbbbb.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
