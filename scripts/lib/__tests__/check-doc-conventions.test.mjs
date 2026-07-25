import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rebuildIndex } from '../doc-index.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LINT = join(REPO_ROOT, 'scripts', 'check-doc-conventions.mjs');

/** Create an isolated fixture root with a `mk(relPath, body)` writer. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'qe-doc-lint-'));
  const mk = (rel, body) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  };
  return { root, mk };
}

/** Build a valid title+frontmatter document body linking to an existing file. */
function validDoc(title, kind, uuid) {
  return [
    `# ${title}`,
    '<!-- qe-doc-frontmatter',
    `kind: ${kind}`,
    `uuid: ${uuid}`,
    'plan: fixture-plan',
    'phase: "Phase X"',
    'created: "2026-07-25"',
    'status: pending',
    'links:',
    '  - "[[README.md]]"',
    '-->',
    'body',
  ].join('\n');
}

/** Run the lint against a fixture root; returns { status, stdout, stderr }. */
function runLint(root) {
  const r = spawnSync('node', [LINT, root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('[G024] real legacy filenames without a block are grandfather-skipped (0 false failures)', () => {
  const { root, mk } = makeFixture();
  try {
    mk('README.md', '# readme');
    // The four current legacy files, none carrying a frontmatter block.
    mk('.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md', '# TASK_REQUEST_5b7591e7 — legacy\nbody');
    mk('.qe/tasks/pending/TASK_REQUEST_923a69eb.md', '# legacy\nbody');
    mk('.qe/tasks/pending/TASK_REQUEST_qsumm001.md', '# legacy\nbody');
    mk('.qe/tasks/completed/TASK_REQUEST_2026-06-29T155430-sivs-autofallback.md', '# legacy\nbody');
    // One opted-in valid doc so the run is not vacuous.
    mk('.qe/tasks/pending/TASK_REQUEST_aaaaaaaa.md', validDoc('TASK_REQUEST_aaaaaaaa — ok', 'spec', 'aaaaaaaa'));
    rebuildIndex(root);

    const { status, stdout } = runLint(root);
    assert.equal(status, 0, `expected PASS, got:\n${stdout}`);
    assert.match(stdout, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('[G024] an unterminated block is a FAIL, never a grandfather skip', () => {
  const { root, mk } = makeFixture();
  try {
    mk('README.md', '# readme');
    mk('.qe/tasks/pending/TASK_REQUEST_bbbbbbbb.md', '# TASK_REQUEST_bbbbbbbb\n<!-- qe-doc-frontmatter\nkind: spec');
    rebuildIndex(root);

    const { status, stderr } = runLint(root);
    assert.equal(status, 1, 'unterminated block must fail the gate');
    assert.match(stderr, /invalid qe-doc-frontmatter|unterminated/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('[G024] pending broken link FAILs; completed dangling link only WARNs', () => {
  const brokenLink = (title, kind, uuid) =>
    validDoc(title, kind, uuid).replace('[[README.md]]', '[[.qe/does/not/exist.md]]');

  // pending source → FAIL
  {
    const { root, mk } = makeFixture();
    try {
      mk('README.md', '# readme');
      mk('.qe/tasks/pending/TASK_REQUEST_cccccccc.md', brokenLink('t', 'spec', 'cccccccc'));
      rebuildIndex(root);
      const { status, stderr } = runLint(root);
      assert.equal(status, 1, 'pending broken link must FAIL');
      assert.match(stderr, /broken link/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // completed source → WARN only (exit 0)
  {
    const { root, mk } = makeFixture();
    try {
      mk('README.md', '# readme');
      mk('.qe/tasks/completed/TASK_REQUEST_dddddddd.md', brokenLink('t', 'spec', 'dddddddd'));
      rebuildIndex(root);
      const { status, stdout } = runLint(root);
      assert.equal(status, 0, `completed dangling link must only WARN, got:\n${stdout}`);
      assert.match(stdout, /warning/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('[G024] security link forms (absolute / traversal / external / shell) are rejected', () => {
  const { root, mk } = makeFixture();
  try {
    mk('README.md', '# readme');
    const bad = validDoc('t', 'spec', 'eeeeeeee')
      .replace('  - "[[README.md]]"', [
        '  - "[[/etc/passwd]]"',
        '  - "[[../../secret.md]]"',
        '  - "[[..\\\\..\\\\secret.md]]"',
        '  - "[[https://evil.example/x.md]]"',
        '  - "[[a.md; rm -rf .]]"',
      ].join('\n'));
    mk('.qe/tasks/pending/TASK_REQUEST_eeeeeeee.md', bad);
    rebuildIndex(root);
    const { status, stderr } = runLint(root);
    assert.equal(status, 1);
    assert.match(stderr, /absolute link not allowed/);
    assert.match(stderr, /parent-traversal/);
    assert.match(stderr, /external\/scheme/);
    assert.match(stderr, /unsafe characters/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('[G025] a Qgoal-style run producing all 6 kinds passes and indexes every kind', () => {
  const { root, mk } = makeFixture();
  try {
    mk('README.md', '# readme');
    mk('.qe/tasks/pending/TASK_REQUEST_a0000001.md', validDoc('TASK_REQUEST_a0000001', 'spec', 'a0000001'));
    mk('.qe/checklists/pending/VERIFY_CHECKLIST_a0000001.md', validDoc('VERIFY_CHECKLIST_a0000001', 'verify', 'a0000001'));
    mk('.qe/security-reports/SECURITY_REPORT_20260725_000000.md', validDoc('SECURITY_REPORT', 'audit', 'a0000002'));
    mk('.qe/agent-results/EXEC_a0000003.md', validDoc('Execution Result', 'execution', 'a0000003'));
    mk('.qe/handoffs/sessions/ab12cd34/HANDOFF_20260725_0000.md', validDoc('Session Handoff', 'handoff', 'a0000004'));
    mk('.qe/agent-results/REPORT_a0000005.md', validDoc('Report', 'report', 'a0000005'));
    rebuildIndex(root);

    const { status, stdout } = runLint(root);
    assert.equal(status, 0, `expected PASS, got:\n${stdout}`);

    const index = readFileSync(join(root, '.qe', 'index.md'), 'utf8');
    for (const kind of ['spec', 'verify', 'audit', 'execution', 'handoff', 'report']) {
      assert.match(index, new RegExp(`## ${kind}\\n`), `index has ${kind} section`);
    }
    // title/header/link surfaced for each kind
    assert.match(index, /\[\[\.qe\/tasks\/pending\/TASK_REQUEST_a0000001\.md\]\] — TASK_REQUEST_a0000001/);
    assert.match(index, /\[\[\.qe\/handoffs\/sessions\/ab12cd34\/HANDOFF_20260725_0000\.md\]\] — Session Handoff/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('[G025] template + Qexecute-consumed sections are preserved (no parser regression)', () => {
  const taskTpl = readFileSync(join(REPO_ROOT, 'skills/Qgenerate-spec/templates/TASK_REQUEST_TEMPLATE.md'), 'utf8');
  const verifyTpl = readFileSync(join(REPO_ROOT, 'skills/Qgenerate-spec/templates/VERIFY_CHECKLIST_TEMPLATE.md'), 'utf8');
  // Frontmatter added…
  assert.match(taskTpl, /<!-- qe-doc-frontmatter/);
  assert.match(verifyTpl, /<!-- qe-doc-frontmatter/);
  for (const ph of ['{{kind}}', '{{plan}}', '{{phase}}', '{{created}}', '{{status}}']) {
    assert.ok(taskTpl.includes(ph), `task template has ${ph}`);
    assert.ok(verifyTpl.includes(ph), `verify template has ${ph}`);
  }
  // …without removing the sections Qexecute and the checklist parser consume.
  assert.match(taskTpl, /## 체크리스트/);
  assert.match(taskTpl, /→ output:/);
  assert.match(verifyTpl, /- \[ \]/);
  // Title stays on line 1 so the completion hook still extracts it.
  assert.match(taskTpl.split('\n')[0], /^# TASK_REQUEST_\{\{UUID\}\}/);
});
