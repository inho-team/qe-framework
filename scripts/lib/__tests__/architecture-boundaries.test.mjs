import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  classifyArchitecturePath,
  extractStaticImports,
  scanArchitectureBoundaries,
} from '../../check-architecture-boundaries.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'qe-architecture-'));
  for (const [file, content] of Object.entries(files)) {
    const absolute = join(root, file);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

test('classifies neutral core and host-specific adapter paths', () => {
  assert.equal(classifyArchitecturePath('scripts/lib/state.mjs'), 'core');
  assert.equal(classifyArchitecturePath('adapters/claude/runtime.mjs'), 'adapter:claude');
  assert.equal(classifyArchitecturePath('hooks/scripts/codex/lifecycle.mjs'), 'adapter:codex');
  assert.equal(classifyArchitecturePath('scripts/lib/claude_bridge.mjs'), 'adapter:claude');
});

test('allows adapters to depend on core and core to depend on core', () => {
  const root = fixture({
    'scripts/lib/state.mjs': `export const state = true;\n`,
    'scripts/lib/helper.mjs': `import { state } from './state.mjs'; export { state };\n`,
    'adapters/claude/runtime.mjs': `import { state } from '../../scripts/lib/state.mjs'; export { state };\n`,
  });
  assert.deepEqual(scanArchitectureBoundaries(root).findings, []);
});

test('rejects core importing a host adapter with concrete location', () => {
  const root = fixture({
    'scripts/lib/service.mjs': `import { run } from '../../adapters/claude/runtime.mjs';\nrun();\n`,
    'adapters/claude/runtime.mjs': `export const run = () => {};\n`,
  });
  const [finding] = scanArchitectureBoundaries(root).findings;
  assert.equal(finding.boundary, 'core-to-adapter');
  assert.equal(finding.file, 'scripts/lib/service.mjs');
  assert.equal(finding.line, 1);
  assert.equal(finding.target, 'adapters/claude/runtime.mjs');
});

test('rejects direct Claude-to-Codex adapter coupling', () => {
  const root = fixture({
    'adapters/claude/runtime.mjs': `import { run } from '../codex/runtime.mjs';\nrun();\n`,
    'adapters/codex/runtime.mjs': `export const run = () => {};\n`,
  });
  assert.equal(scanArchitectureBoundaries(root).findings[0].boundary, 'adapter-cross-import');
});

test('ignores comments while parsing static, dynamic, and require imports', () => {
  const parsed = extractStaticImports(`
    // import './ignored.mjs';
    /* import './also-ignored.mjs'; */
    import './static.mjs';
    const dynamic = import('./dynamic.mjs');
    const legacy = require('./legacy.cjs');
  `);
  assert.deepEqual(parsed.map(item => item.specifier), ['./static.mjs', './dynamic.mjs', './legacy.cjs']);
});

test('CLI failure names the boundary and import location for contributors', () => {
  const root = fixture({
    'core/service.mjs': `import '../adapters/codex/runtime.mjs';\n`,
    'adapters/codex/runtime.mjs': `export {};\n`,
  });
  const checker = resolve('scripts/check-architecture-boundaries.mjs');
  const result = spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /core\/service\.mjs:1 \[core-to-adapter\] imports adapters\/codex\/runtime\.mjs/);
});

test('repository has no unnamed dependency boundary violations', () => {
  const result = scanArchitectureBoundaries(process.cwd());
  assert.deepEqual(result.findings, []);
  assert.ok(result.debts.every(item => item.reason && item.file && item.line > 0));
});
