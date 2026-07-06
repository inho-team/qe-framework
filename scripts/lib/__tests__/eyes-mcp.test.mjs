import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as eyesMcp from '../eyes-mcp.mjs';
import * as browserDriver from '../browser-driver.mjs';
import { __setCodexExecForTest, __setProbeDriverForTest } from '../eyes-mcp.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'qe-eyes-mcp-'));
}

/**
 * Read and parse the liveness receipt written by createLivenessReceipt.
 * @param {string} dir evidence directory containing receipt.json
 * @returns {object} parsed receipt object
 */
function readReceipt(dir) {
  return JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8'));
}

// ─── Item 1: engine injection + INVALID_ENGINE ────────────────────────────────

describe('resolveEngine — engine injection and validation', () => {
  const origEnv = process.env.QE_ACTIVE_CLIENT;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.QE_ACTIVE_CLIENT;
    else process.env.QE_ACTIVE_CLIENT = origEnv;
  });

  test('accepts "claude" explicitly', () => {
    assert.equal(eyesMcp.resolveEngine('claude'), 'claude');
  });

  test('accepts "codex" explicitly', () => {
    assert.equal(eyesMcp.resolveEngine('codex'), 'codex');
  });

  test('normalises to lowercase', () => {
    assert.equal(eyesMcp.resolveEngine('Claude'), 'claude');
    assert.equal(eyesMcp.resolveEngine('CODEX'), 'codex');
  });

  test('falls back to QE_ACTIVE_CLIENT when engine omitted', () => {
    process.env.QE_ACTIVE_CLIENT = 'codex';
    assert.equal(eyesMcp.resolveEngine(undefined), 'codex');
  });

  test('throws INVALID_ENGINE for unrecognised value', () => {
    assert.throws(
      () => eyesMcp.resolveEngine('gpt4'),
      (err) => {
        assert.equal(err.code, 'INVALID_ENGINE');
        assert.match(err.message, /gpt4/);
        return true;
      },
    );
  });

  test('throws INVALID_ENGINE when engine is empty and env unset', () => {
    delete process.env.QE_ACTIVE_CLIENT;
    assert.throws(
      () => eyesMcp.resolveEngine(''),
      (err) => {
        assert.equal(err.code, 'INVALID_ENGINE');
        return true;
      },
    );
  });

  test('throws INVALID_ENGINE for "browser_use" (v1/v2 regression guard)', () => {
    assert.throws(
      () => eyesMcp.resolveEngine('browser_use'),
      (err) => {
        assert.equal(err.code, 'INVALID_ENGINE');
        return true;
      },
    );
  });
});

// ─── Item 2: Playwright MCP identity match ────────────────────────────────────

describe('verifyMcpIdentity — identity matching', () => {
  afterEach(() => __setCodexExecForTest(null));

  test('Claude always returns matched=true (tool-presence assumption)', () => {
    const result = eyesMcp.verifyMcpIdentity('claude');
    assert.equal(result.matched, true);
  });

  test('Codex: matches entry whose args contain @playwright/mcp', () => {
    __setCodexExecForTest(() =>
      [
        'computer-use   npx @anthropic-ai/computer-use-mcp@1.0.0',
        'playwright     npx @playwright/mcp@0.0.29',
      ].join('\n'),
    );
    const result = eyesMcp.verifyMcpIdentity('codex');
    assert.equal(result.matched, true);
    assert.match(result.entry, /@playwright\/mcp/);
  });

  test('Codex: rejects impostor entry with name "playwright" but wrong command', () => {
    __setCodexExecForTest(() =>
      [
        'playwright   npx some-other-browser-tool@1.0.0',
        'another      npx totally-different@2.0.0',
      ].join('\n'),
    );
    const result = eyesMcp.verifyMcpIdentity('codex');
    assert.equal(result.matched, false);
    assert.match(result.reason, /impostor/i);
  });

  test('Codex: returns matched=false when list is empty', () => {
    __setCodexExecForTest(() => '');
    const result = eyesMcp.verifyMcpIdentity('codex');
    assert.equal(result.matched, false);
  });

  test('Codex: returns matched=false when codex mcp list throws', () => {
    __setCodexExecForTest(() => { throw new Error('command not found: codex'); });
    const result = eyesMcp.verifyMcpIdentity('codex');
    assert.equal(result.matched, false);
    assert.match(result.reason, /codex mcp list failed/);
  });

  test('Codex: handles multiple entries, picks correct one', () => {
    __setCodexExecForTest(() =>
      [
        'browser-fake   npx fake-playwright@9.9.9',
        'pw-real        npx @playwright/mcp@0.0.29 --some-flag',
        'other          npx something-else@1.0.0',
      ].join('\n'),
    );
    const result = eyesMcp.verifyMcpIdentity('codex');
    assert.equal(result.matched, true);
  });
});

// ─── Item 3: Startup probe — failure and timeout ──────────────────────────────

describe('runStartupProbe — failure and timeout', () => {
  afterEach(() => {
    browserDriver.__setPlaywrightForTest(null);
    __setProbeDriverForTest(null);
  });

  test('succeeds when browser-driver launches and snapshots successfully', async () => {
    const fakePage = {
      on: () => {},
      goto: async () => {},
      accessibility: { snapshot: async () => ({ role: 'WebArea', name: '' }) },
      close: async () => {},
    };
    const fakeContext = {
      pages: () => [fakePage],
      newPage: async () => fakePage,
      close: async () => {},
    };
    const fakeBrowser = {
      newContext: async () => fakeContext,
      close: async () => {},
    };
    browserDriver.__setPlaywrightForTest({ chromium: { launch: async () => fakeBrowser } });

    await assert.doesNotReject(() => eyesMcp.runStartupProbe({ timeoutMs: 5000 }));
  });

  test('throws MCP_START_FAILED when browser launch fails', async () => {
    browserDriver.__setPlaywrightForTest({
      chromium: {
        launch: async () => { throw new Error('browser process exited unexpectedly'); },
      },
    });

    await assert.rejects(
      () => eyesMcp.runStartupProbe({ timeoutMs: 5000 }),
      (err) => {
        assert.equal(err.code, 'MCP_START_FAILED');
        assert.match(err.message, /browser process exited/);
        return true;
      },
    );
  });

  test('throws MCP_START_FAILED on timeout (never hangs)', async () => {
    // Use the probe-driver seam so the hanging work Promise settles immediately
    // when the timeout fires ac.abort() — no event-loop leak.
    __setProbeDriverForTest(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }));

    await assert.rejects(
      () => eyesMcp.runStartupProbe({ timeoutMs: 80 }),
      (err) => {
        assert.equal(err.code, 'MCP_START_FAILED');
        assert.match(err.message, /timed out/i);
        return true;
      },
    );
  });
});

// ─── Item 4: Codex guidance string (pinned version) ───────────────────────────

describe('generateCodexMcpAddGuidance — pinned version, no @latest', () => {
  test('returns a concrete X.Y.Z version, never @latest', () => {
    const { guidanceString, resolvedVersion } = eyesMcp.generateCodexMcpAddGuidance();
    assert.match(resolvedVersion, /^\d+\.\d+\.\d+$/, 'version must be X.Y.Z');
    assert.ok(!guidanceString.includes('@latest'), 'guidance must not contain @latest');
    assert.match(guidanceString, /@playwright\/mcp@\d+\.\d+\.\d+/);
  });

  test('guidance string starts with codex mcp add', () => {
    const { guidanceString } = eyesMcp.generateCodexMcpAddGuidance();
    assert.ok(guidanceString.startsWith('codex mcp add'), `got: ${guidanceString}`);
  });
});

// ─── Item 5: Fallback ladder ──────────────────────────────────────────────────

describe('resolveBrowserTransport — fallback ladder', () => {
  afterEach(() => {
    browserDriver.__setPlaywrightForTest(null);
    __setCodexExecForTest(null);
  });

  test('returns "mcp" when identity matches and probe passes (claude)', async () => {
    // Claude: identity always matches; inject working playwright for probe
    const fakePage = {
      on: () => {},
      goto: async () => {},
      accessibility: { snapshot: async () => ({}) },
      close: async () => {},
    };
    const fakeCtx = { pages: () => [fakePage], newPage: async () => fakePage, close: async () => {} };
    const fakeBr = { newContext: async () => fakeCtx, close: async () => {} };
    browserDriver.__setPlaywrightForTest({ chromium: { launch: async () => fakeBr } });

    const transport = await eyesMcp.resolveBrowserTransport('claude', { probeTimeoutMs: 5000 });
    assert.equal(transport, 'mcp');
  });

  test('falls back to "browser-driver" when MCP probe fails but playwright is available', async () => {
    // Codex identity: matched
    __setCodexExecForTest(() => 'playwright  npx @playwright/mcp@0.0.29');
    // Probe fails on first call (launch throws), then playwright is available for isBrowserAvailable
    let callCount = 0;
    browserDriver.__setPlaywrightForTest({
      chromium: {
        launch: async () => {
          callCount++;
          if (callCount === 1) throw new Error('probe launch failed');
          // second call (isBrowserAvailable) just needs to not throw
          return { newContext: async () => ({ pages: () => [], newPage: async () => ({}), close: async () => {} }), close: async () => {} };
        },
      },
    });

    const transport = await eyesMcp.resolveBrowserTransport('codex', { probeTimeoutMs: 500 });
    assert.equal(transport, 'browser-driver');
  });

  test('throws PLAYWRIGHT_NOT_INSTALLED when both MCP and library are unavailable', async () => {
    // Codex identity: not matched
    __setCodexExecForTest(() => 'some-other   npx unrelated-tool@1.0.0');
    // playwright library also absent
    browserDriver.__setPlaywrightForTest(null);

    await assert.rejects(
      () => eyesMcp.resolveBrowserTransport('codex', { probeTimeoutMs: 500 }),
      (err) => {
        assert.equal(err.code, 'PLAYWRIGHT_NOT_INSTALLED');
        return true;
      },
    );
  });

  test('throws MCP_START_FAILED when identity matched, probe fails, and library absent', async () => {
    // Claude: identity always matched. Clear the playwright override so the whole
    // library is absent (playwright is an optional dep, not installed here):
    // the startup probe's launch fails -> wrapped to MCP_START_FAILED, AND the
    // shallow isBrowserAvailable() module probe also returns false. The ladder
    // reaches its terminal typed stop. (isBrowserAvailable checks module presence,
    // not launch success, so a truthy fake would make it report available.)
    browserDriver.__setPlaywrightForTest(null);

    await assert.rejects(
      () => eyesMcp.resolveBrowserTransport('claude', { probeTimeoutMs: 500 }),
      (err) => {
        assert.ok(
          err.code === 'MCP_START_FAILED' || err.code === 'PLAYWRIGHT_NOT_INSTALLED',
          `expected typed stop, got: ${err.code} — ${err.message}`,
        );
        return true;
      },
    );
  });

  test('skipProbe=true skips the startup probe when identity matches', async () => {
    // Claude: identity matched; no playwright injected (probe would throw if called)
    browserDriver.__setPlaywrightForTest(null);

    const transport = await eyesMcp.resolveBrowserTransport('claude', { skipProbe: true });
    assert.equal(transport, 'mcp');
  });
});

// ─── Item 6: Liveness receipt — crash-before-flush ───────────────────────────

describe('createLivenessReceipt — 3-state schema and crash-before-flush', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  test('initial write leaves terminal_state as not_run (crash-safe)', () => {
    eyesMcp.createLivenessReceipt('claude', tmpDir);
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.terminal_state, 'not_run');
    assert.equal(receipt.engine, 'claude');
    assert.equal(receipt.probes_run, 0);
    assert.equal(receipt.assertions_run, 0);
    assert.equal(receipt.findings_count, 0);
  });

  test('increment updates counters but NOT terminal_state', () => {
    const r = eyesMcp.createLivenessReceipt('codex', tmpDir);
    r.increment({ probes: 2, assertions: 5, findings: 1 });
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.probes_run, 2);
    assert.equal(receipt.assertions_run, 5);
    assert.equal(receipt.findings_count, 1);
    assert.equal(receipt.terminal_state, 'not_run'); // NOT changed yet
  });

  test('flush stamps terminal_state correctly', () => {
    const r = eyesMcp.createLivenessReceipt('claude', tmpDir);
    r.increment({ probes: 3, assertions: 7, findings: 0 });
    r.flush('ran_no_findings');
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.terminal_state, 'ran_no_findings');
  });

  test('flush with ran_with_findings stamps correctly', () => {
    const r = eyesMcp.createLivenessReceipt('claude', tmpDir);
    r.increment({ probes: 1, assertions: 3, findings: 2 });
    r.flush('ran_with_findings');
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.terminal_state, 'ran_with_findings');
  });

  test('flush with unavailable stamps correctly', () => {
    const r = eyesMcp.createLivenessReceipt('codex', tmpDir);
    r.flush('unavailable');
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.terminal_state, 'unavailable');
  });

  test('flush rejects an invalid terminal_state', () => {
    const r = eyesMcp.createLivenessReceipt('claude', tmpDir);
    assert.throws(
      () => r.flush('done'),
      (err) => {
        assert.match(err.message, /invalid terminal_state/i);
        return true;
      },
    );
  });

  test('crash-before-flush: file on disk still reads not_run (cannot misread as ran_no_findings)', () => {
    // Simulate: increment called, then process crashes before flush
    const r = eyesMcp.createLivenessReceipt('claude', tmpDir);
    r.increment({ probes: 1, assertions: 2, findings: 0 });
    // Do NOT call flush — simulates crash
    const receipt = readReceipt(tmpDir);
    assert.equal(receipt.terminal_state, 'not_run');
    // Distinguishes from ran_no_findings: not_run means "never finished"
    assert.notEqual(receipt.terminal_state, 'ran_no_findings');
  });

  test('getState returns current in-memory snapshot', () => {
    const r = eyesMcp.createLivenessReceipt('codex', tmpDir);
    r.increment({ probes: 1 });
    const s = r.getState();
    assert.equal(s.engine, 'codex');
    assert.equal(s.probes_run, 1);
    assert.equal(s.terminal_state, 'not_run');
  });
});

// ─── Item 7: Per-capture non-prod URL gate ────────────────────────────────────

describe('assertNonProdUrl — per-capture safety gate', () => {
  test('allows localhost URLs', () => {
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('http://localhost:3000'));
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('http://127.0.0.1:8080/page'));
  });

  test('allows RFC-1918 private ranges', () => {
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('http://192.168.1.100:3000'));
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('http://10.0.0.5:4000'));
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('http://172.16.0.1:5000'));
  });

  test('allows about:blank (startup probe URL)', () => {
    assert.doesNotThrow(() => eyesMcp.assertNonProdUrl('about:blank'));
  });

  test('blocks URLs with "prod" in the hostname', () => {
    assert.throws(
      () => eyesMcp.assertNonProdUrl('https://app.prod.example.com/dashboard'),
      (err) => {
        assert.equal(err.code, 'PROD_URL_BLOCKED');
        return true;
      },
    );
  });

  test('blocks URLs with "production" in the hostname', () => {
    assert.throws(
      () => eyesMcp.assertNonProdUrl('https://api.production.myapp.io/v1'),
      (err) => {
        assert.equal(err.code, 'PROD_URL_BLOCKED');
        return true;
      },
    );
  });

  test('allowProd=true bypasses gate (test-only escape hatch)', () => {
    assert.doesNotThrow(() =>
      eyesMcp.assertNonProdUrl('https://app.prod.example.com', { allowProd: true }),
    );
  });
});

// ─── Item 8: Evidence namespacing ────────────────────────────────────────────

describe('buildEvidenceDir — namespacing and run-id pinning', () => {
  let tmpBase;
  beforeEach(() => { tmpBase = makeTmpDir(); });
  afterEach(() => rmSync(tmpBase, { recursive: true, force: true }));

  test('creates evidence/<engine>/<runId> directory', () => {
    const dir = eyesMcp.buildEvidenceDir('claude', 'run-001', tmpBase);
    assert.ok(existsSync(dir), `expected dir to exist: ${dir}`);
    assert.ok(dir.endsWith(join('claude', 'run-001')), `unexpected path: ${dir}`);
  });

  test('fallback keeps same engine dir when engine is fixed at run start', () => {
    const dir1 = eyesMcp.buildEvidenceDir('codex', 'run-002', tmpBase);
    const dir2 = eyesMcp.buildEvidenceDir('codex', 'run-002', tmpBase); // same call = same dir
    assert.equal(dir1, dir2);
  });

  test('different engines produce separate namespaced directories', () => {
    const claudeDir = eyesMcp.buildEvidenceDir('claude', 'run-003', tmpBase);
    const codexDir = eyesMcp.buildEvidenceDir('codex', 'run-003', tmpBase);
    assert.notEqual(claudeDir, codexDir);
    assert.ok(claudeDir.includes('claude'));
    assert.ok(codexDir.includes('codex'));
  });
});

// ─── Typed stop — final error codes exposed correctly ────────────────────────

describe('typed stop error codes', () => {
  afterEach(() => {
    browserDriver.__setPlaywrightForTest(null);
    __setCodexExecForTest(null);
    __setProbeDriverForTest(null);
  });

  test('INVALID_ENGINE is surfaced for unknown engine values', () => {
    assert.throws(
      () => eyesMcp.resolveEngine('fugu'),
      (err) => { assert.equal(err.code, 'INVALID_ENGINE'); return true; },
    );
  });

  test('PLAYWRIGHT_NOT_INSTALLED surfaced when no transport available', async () => {
    __setCodexExecForTest(() => 'unrelated  npx unrelated-thing@1.0.0');
    browserDriver.__setPlaywrightForTest(null);
    await assert.rejects(
      () => eyesMcp.resolveBrowserTransport('codex', { probeTimeoutMs: 200 }),
      (err) => { assert.equal(err.code, 'PLAYWRIGHT_NOT_INSTALLED'); return true; },
    );
  });

  test('MCP_START_FAILED surfaced on probe timeout', async () => {
    // Use probe-driver seam: hangs until abort fires, then rejects cleanly.
    __setProbeDriverForTest(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }));

    await assert.rejects(
      () => eyesMcp.resolveBrowserTransport('claude', { probeTimeoutMs: 80 }),
      (err) => {
        assert.ok(
          err.code === 'MCP_START_FAILED' || err.code === 'PLAYWRIGHT_NOT_INSTALLED',
          `unexpected code: ${err.code}`,
        );
        return true;
      },
    );
  });
});

// ─── Exports contract ─────────────────────────────────────────────────────────

test('exports the full public API contract', () => {
  const expected = [
    '__setCodexExecForTest',
    '__setProbeDriverForTest',
    'resolveEngine',
    'verifyMcpIdentity',
    'runStartupProbe',
    'generateCodexMcpAddGuidance',
    'resolveBrowserTransport',
    'createLivenessReceipt',
    'assertNonProdUrl',
    'buildEvidenceDir',
    'initEyesMcp',
  ];
  for (const name of expected) {
    assert.equal(typeof eyesMcp[name], 'function', `missing export: ${name}`);
  }
});
