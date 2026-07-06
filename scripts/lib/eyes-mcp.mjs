// eyes-mcp.mjs — Dual-engine Playwright MCP availability, identity verification,
// startup probe, fallback ladder, and liveness receipt for Qqa council browser roles.
//
// Design constraints (from TASK_REQUEST d1c9dc08 v5):
// - engine is INJECTED, never runtime-detected (interaction_adapter has no detection primitive).
// - QE_ACTIVE_CLIENT env is the only fallback when caller omits engine.
// - resolveEngine(stage) from engines.mjs is NOT used here (browser selection, not SIVS routing).
// - browser-driver.mjs is reused unmodified for programmatic browser ops.
// - codex mcp add is NEVER executed automatically; only a guidance string is generated.
// - @latest version pins are FORBIDDEN; a concrete X.Y.Z is resolved and recorded.

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as browserDriver from './browser-driver.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_ENGINES = new Set(['claude', 'codex']);
const PROBE_TIMEOUT_MS = 15_000;
// Pinned version — @latest is forbidden. Bump this when a newer stable is verified.
const PINNED_PLAYWRIGHT_MCP_VERSION = '0.0.29';

// Production domain patterns — extend as needed.
const PROD_DOMAIN_PATTERNS = [
  /^[^.]+\.prod\./i,
  /^[^.]+\.production\./i,
  /^app\.[^.]+\.[a-z]{2,}$/i,
  /\bprod\b/i,
  /^(?!localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.).+\.[a-z]{2,}$/,
];

// ─── Test seams ──────────────────────────────────────────────────────────────

let _codexExecStub = null;
let _probeDriverStub = null;

/**
 * Inject (or clear with null) the exec function used to call `codex mcp list`.
 * Only for tests — mirrors __setPlaywrightForTest seam in browser-driver.mjs.
 * @param {((cmd: string) => string) | null} fn
 */
export function __setCodexExecForTest(fn) {
  _codexExecStub = fn;
}

/**
 * Inject (or clear with null) a replacement for the browser-driver probe pair
 * used inside runStartupProbe. Allows tests to simulate a hanging or failing
 * launch without going through browser-driver's fixed API.
 *
 * The stub receives `{ signal }` and must return a Promise that resolves to a
 * session object (or rejects). When the probe timeout fires it calls
 * `signal.abort()`, so stubs should listen on signal to settle promptly.
 *
 * @param {((opts: { signal: AbortSignal }) => Promise<void>) | null} fn
 */
export function __setProbeDriverForTest(fn) {
  _probeDriverStub = fn;
}

// ─── Typed errors ────────────────────────────────────────────────────────────

/**
 * Create a typed Error with a `.code` property for programmatic handling.
 * @param {string} message human-readable error description
 * @param {string} code machine-readable error code (e.g. 'INVALID_ENGINE')
 * @returns {Error} error instance with `.code` attached
 */
function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Build a typed INVALID_ENGINE error for an unrecognised engine value.
 * @param {string} engine the rejected engine string
 * @returns {Error} error with code 'INVALID_ENGINE'
 */
function invalidEngineError(engine) {
  return makeError(
    `[eyes-mcp] Invalid engine "${engine}". Must be one of: ${[...VALID_ENGINES].join(', ')}.\n` +
      'Pass engine explicitly or set QE_ACTIVE_CLIENT env var.',
    'INVALID_ENGINE',
  );
}

/**
 * Build a typed MCP_START_FAILED error describing why the startup probe failed.
 * @param {string} reason short description of the failure or timeout cause
 * @returns {Error} error with code 'MCP_START_FAILED'
 */
function mcpStartFailedError(reason) {
  return makeError(
    `[eyes-mcp] Playwright MCP startup probe failed: ${reason}\n` +
      'Ensure Playwright MCP is registered and the browser process can start.',
    'MCP_START_FAILED',
  );
}

/**
 * Build a typed PLAYWRIGHT_NOT_INSTALLED error for the end of the fallback ladder.
 * Thrown when both MCP and the playwright library are unavailable.
 * @returns {Error} error with code 'PLAYWRIGHT_NOT_INSTALLED'
 */
function notInstalledError() {
  return makeError(
    '[eyes-mcp] No browser transport available (Playwright MCP probe failed and ' +
      'playwright library is not installed).\n' +
      'Options: register Playwright MCP, or run: npm i -D playwright && npx playwright install chromium',
    'PLAYWRIGHT_NOT_INSTALLED',
  );
}

// ─── Item 1: Engine injection + validation ────────────────────────────────────

/**
 * Resolve and validate the engine parameter.
 * engine must be one of {claude, codex}; falls back to QE_ACTIVE_CLIENT env.
 * Throws INVALID_ENGINE for any other value.
 *
 * Rescue-delegation rule: when a Claude session delegates to a Codex sub-agent,
 * the caller MUST pass engine='codex' (the actual running layer), not 'claude'
 * (the orchestrator layer). engine reflects the agent that will invoke browser
 * tools, not the top-level orchestrator.
 *
 * @param {string|undefined} engine
 * @returns {string} validated engine name
 */
export function resolveEngine(engine) {
  const candidate = (engine || process.env.QE_ACTIVE_CLIENT || '').toLowerCase().trim();
  if (!candidate) {
    throw invalidEngineError('(empty — not provided and QE_ACTIVE_CLIENT is unset)');
  }
  if (!VALID_ENGINES.has(candidate)) {
    throw invalidEngineError(candidate);
  }
  return candidate;
}

// ─── Item 2: Playwright MCP identity-match verification ───────────────────────

/**
 * Verify that Playwright MCP is identity-matched for the given engine.
 *
 * Claude: assumes MCP tool presence (tool availability is asserted by the
 *         framework at runtime; no shell call possible from within Claude).
 * Codex:  parses `codex mcp list` output and checks that an entry's
 *         command/args string contains '@playwright/mcp' (impostor guard).
 *
 * Returns { matched: boolean, entry: string|null, reason: string }.
 *
 * @param {string} engine validated engine name
 * @returns {{ matched: boolean, entry: string|null, reason: string }}
 */
export function verifyMcpIdentity(engine) {
  if (engine === 'claude') {
    // Claude's MCP tools are injected by the framework; we assume presence
    // if the caller is operating under Claude (tool-presence assumption).
    return { matched: true, entry: null, reason: 'Claude MCP tool-presence assumed by framework' };
  }

  // Codex: parse `codex mcp list` output for an entry whose command/args
  // contains '@playwright/mcp' — simple name match is insufficient (impostor guard).
  let raw;
  try {
    if (_codexExecStub) {
      raw = _codexExecStub('codex mcp list');
    } else {
      raw = execSync('codex mcp list', { encoding: 'utf8', timeout: 10_000 });
    }
  } catch (err) {
    return {
      matched: false,
      entry: null,
      reason: `codex mcp list failed: ${err.message || err}`,
    };
  }

  // Each line may look like:
  //   playwright   npx @playwright/mcp@0.0.29
  //   some-other   npx some-other-package
  const lines = String(raw).split('\n');
  for (const line of lines) {
    if (line.includes('@playwright/mcp')) {
      return { matched: true, entry: line.trim(), reason: 'identity matched via @playwright/mcp in command/args' };
    }
  }

  return {
    matched: false,
    entry: null,
    reason: 'no entry with @playwright/mcp found in `codex mcp list` output (impostor guard rejected or not registered)',
  };
}

// ─── Item 3: Real no-op startup probe (with timeout) ─────────────────────────

/**
 * Perform a real no-op startup probe: open about:blank + snapshot.
 * Times out after timeoutMs (default 15 s). Throws MCP_START_FAILED on
 * failure or timeout — never hangs.
 *
 * Uses browser-driver.mjs (unmodified) as the programmatic layer.
 * When the test seam __setProbeDriverForTest is active, the stub receives an
 * AbortSignal that fires on timeout, allowing it to settle cleanly with no
 * event-loop leak (no Promise.race needed in that path).
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function runStartupProbe({ timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  let session = null;
  let timeoutHandle = null;
  const timeoutErr = mcpStartFailedError(`probe timed out after ${timeoutMs}ms`);

  // The timeout ALWAYS wins the race when it fires — the probe work never has to
  // cooperate. This guarantees the function settles even if the underlying stub
  // or browser ignores the abort signal (the exact hang the probe exists to kill).
  const ac = new AbortController();
  const timeoutRace = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => { ac.abort(); reject(timeoutErr); }, timeoutMs);
  });

  const probeWork = (async () => {
    if (_probeDriverStub) {
      // Test-seam path: stub receives the AbortSignal so it *may* settle early,
      // but the race guarantees settlement regardless of the stub's cooperation.
      await _probeDriverStub({ signal: ac.signal });
      return;
    }
    // Real path: browser-driver.launch has no AbortSignal, so the race is the
    // only timeout mechanism. In production the browser starts or fails fast.
    session = await browserDriver.launch({ url: 'about:blank', headless: true });
    await browserDriver.snapshot(session);
  })();

  // Attach a no-op catch so a late rejection from the losing promise never
  // surfaces as an unhandledRejection after the race has already settled.
  probeWork.catch(() => {});

  try {
    await Promise.race([probeWork, timeoutRace]);
  } catch (err) {
    if (err.code === 'MCP_START_FAILED') throw err;
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') throw timeoutErr;
    throw mcpStartFailedError(err.message || String(err));
  } finally {
    clearTimeout(timeoutHandle);
    if (session) {
      try { await browserDriver.close(session); } catch { /* ignore close errors */ }
    }
  }
}

// ─── Item 4: Codex guidance string (never auto-executed) ─────────────────────

/**
 * Generate a pinned `codex mcp add` guidance string for the user.
 * Resolves a concrete X.Y.Z version (never @latest).
 * Does NOT execute the command — caller must display and obtain user confirmation.
 *
 * @returns {{ guidanceString: string, resolvedVersion: string }}
 */
export function generateCodexMcpAddGuidance() {
  const version = PINNED_PLAYWRIGHT_MCP_VERSION;
  const guidanceString = `codex mcp add playwright -- npx @playwright/mcp@${version}`;
  return { guidanceString, resolvedVersion: version };
}

// ─── Item 5: Fallback ladder ──────────────────────────────────────────────────

/**
 * Determine the available browser transport for the given engine.
 * Returns one of: 'mcp' | 'browser-driver' | throws typed stop.
 *
 * Ladder:
 *   1. Playwright MCP — identity matched AND startup probe passed
 *   2. browser-driver.isBrowserAvailable() — playwright library present
 *   3. Typed stop (PLAYWRIGHT_NOT_INSTALLED or MCP_START_FAILED)
 *
 * Fallback keeps the same evidence engine directory (namespaced by engine,
 * pinned once at run start — see buildEvidenceDir).
 *
 * @param {string} engine validated engine name
 * @param {{ skipProbe?: boolean, probeTimeoutMs?: number }} [opts]
 * @returns {Promise<'mcp' | 'browser-driver'>}
 */
export async function resolveBrowserTransport(engine, { skipProbe = false, probeTimeoutMs = PROBE_TIMEOUT_MS } = {}) {
  // Step 1: Playwright MCP identity check
  const identity = verifyMcpIdentity(engine);
  if (identity.matched) {
    // Step 1b: Real startup probe
    if (!skipProbe) {
      try {
        await runStartupProbe({ timeoutMs: probeTimeoutMs });
        return 'mcp';
      } catch (err) {
        // MCP identity matched but probe failed — fall through to browser-driver
        if (err.code !== 'MCP_START_FAILED') throw err;
        // fall through
      }
    } else {
      return 'mcp';
    }
  }

  // Step 2: browser-driver library
  const browserAvailable = await browserDriver.isBrowserAvailable();
  if (browserAvailable) {
    return 'browser-driver';
  }

  // Step 3: Typed stop
  if (identity.matched) {
    // MCP was matched but probe failed
    throw mcpStartFailedError('startup probe failed and playwright library is also unavailable');
  }
  throw notInstalledError();
}

// ─── Item 6: 3-state liveness receipt ────────────────────────────────────────

/**
 * Create a liveness receipt writer for a run.
 *
 * The receipt is written incrementally so that a crash before flush()
 * leaves terminal_state as 'not_run' — never misread as 'ran_no_findings'.
 * terminal_state is only stamped at flush() time.
 *
 * Schema: { engine, probes_run, assertions_run, findings_count, terminal_state }
 * terminal_state ∈ { unavailable, not_run, ran_no_findings, ran_with_findings }
 *
 * @param {string} engine
 * @param {string} evidenceDir directory where receipt.json is written
 * @returns {{ increment: Function, flush: Function, getState: Function }}
 */
export function createLivenessReceipt(engine, evidenceDir) {
  const receiptPath = join(evidenceDir, 'receipt.json');

  // Initial state written immediately — crash leaves this state (not_run)
  const state = {
    engine,
    probes_run: 0,
    assertions_run: 0,
    findings_count: 0,
    terminal_state: 'not_run', // stamped only at flush; crash leaves 'not_run'
  };

  /**
   * Write the current receipt state to disk atomically (sync).
   * Called after every mutation so a crash always leaves a readable file.
   */
  function persist() {
    writeFileSync(receiptPath, JSON.stringify(state, null, 2), 'utf8');
  }

  // Write initial not_run state immediately
  persist();

  return {
    /**
     * Increment counters incrementally (crash-safe: not_run remains until flush).
     * @param {{ probes?: number, assertions?: number, findings?: number }} delta
     */
    increment({ probes = 0, assertions = 0, findings = 0 } = {}) {
      state.probes_run += probes;
      state.assertions_run += assertions;
      state.findings_count += findings;
      // Do NOT stamp terminal_state here — only at flush()
      persist();
    },

    /**
     * Stamp terminal_state and write final receipt.
     * Must be called explicitly; a missing flush leaves 'not_run'.
     * @param {'unavailable'|'not_run'|'ran_no_findings'|'ran_with_findings'} terminalState
     */
    flush(terminalState) {
      const valid = new Set(['unavailable', 'not_run', 'ran_no_findings', 'ran_with_findings']);
      if (!valid.has(terminalState)) {
        throw new Error(`[eyes-mcp] Invalid terminal_state: "${terminalState}". Must be one of: ${[...valid].join(', ')}`);
      }
      state.terminal_state = terminalState;
      persist();
    },

    /** Return a snapshot of current state (does not flush). */
    getState() {
      return { ...state };
    },
  };
}

// ─── Item 7: Per-capture non-prod URL gate ────────────────────────────────────

/**
 * Check the resolved URL immediately before each evidence capture.
 * Blocks if the URL looks like production (server redirect, SPA client-side
 * redirect, or prod iframe). Throws if production is detected.
 *
 * This must be called before every screenshot/snapshot capture, not once at
 * run start — redirects can happen between captures.
 *
 * @param {string} resolvedUrl the page.url() value at capture time
 * @param {{ allowProd?: boolean }} [opts] allowProd=true bypasses gate (for tests only)
 */
export function assertNonProdUrl(resolvedUrl, { allowProd = false } = {}) {
  if (allowProd) return;

  const url = String(resolvedUrl || '').trim();
  if (!url || url === 'about:blank') return; // probe URL, always safe

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // unparseable URL — block it
    throw makeError(
      `[eyes-mcp] Cannot verify non-prod status of URL: "${url}". Capture blocked.`,
      'PROD_URL_BLOCKED',
    );
  }

  // Scheme allowlist: only http/https carry a gate-able host. Hostless schemes
  // (javascript:, data:, file:, …) parse but bypass the host check, so block
  // them outright — matches the "cannot verify → block" intent above.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw makeError(
      `[eyes-mcp] Non-http(s) URL scheme "${parsed.protocol}" cannot be gated: "${url}". Capture blocked.`,
      'PROD_URL_BLOCKED',
    );
  }

  const hostname = parsed.hostname;

  // localhost and RFC-1918 ranges are always safe
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('0.0.0.0') ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return;
  }

  for (const pattern of PROD_DOMAIN_PATTERNS) {
    if (pattern.test(hostname)) {
      throw makeError(
        `[eyes-mcp] Resolved URL appears to be production: "${url}" (matched: ${pattern}). ` +
          'Capture blocked. Use a non-production URL with synthetic data.',
        'PROD_URL_BLOCKED',
      );
    }
  }
}

// ─── Item 8: Evidence namespacing ────────────────────────────────────────────

/**
 * Build and pin the evidence directory for a run.
 * Path: evidence/<engine>/<runId>/
 * The engine identity is fixed once at run start; fallback keeps same dir.
 * Creates the directory if it does not exist.
 *
 * @param {string} engine validated engine name
 * @param {string} runId unique run identifier (e.g. ISO timestamp slug)
 * @param {string} [baseDir] base directory (defaults to process.cwd()/evidence)
 * @returns {string} absolute path to the evidence directory for this run
 */
export function buildEvidenceDir(engine, runId, baseDir) {
  const base = baseDir || join(process.cwd(), 'evidence');
  const dir = join(base, engine, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Compound entry point ─────────────────────────────────────────────────────

/**
 * Initialise the eyes-mcp subsystem for a council run.
 * Validates engine, verifies MCP identity, runs the startup probe,
 * determines transport via the fallback ladder, pins the evidence dir,
 * and returns a liveness receipt writer.
 *
 * This is the primary entry point for council browser-role spawning.
 * Agent spawn points must pass `engine` explicitly (see resolveEngine docs).
 *
 * @param {{
 *   engine?: string,
 *   runId?: string,
 *   baseDir?: string,
 *   probeTimeoutMs?: number,
 *   skipProbe?: boolean,
 * }} opts
 * @returns {Promise<{
 *   engine: string,
 *   transport: 'mcp' | 'browser-driver',
 *   evidenceDir: string,
 *   receipt: ReturnType<typeof createLivenessReceipt>,
 *   mcpIdentity: object,
 * }>}
 */
export async function initEyesMcp({
  engine: engineParam,
  runId,
  baseDir,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  skipProbe = false,
} = {}) {
  // 1. Validate engine
  const engine = resolveEngine(engineParam);

  // 2. Pin run ID and evidence dir (fixed for the lifetime of this run)
  const id = runId || new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = buildEvidenceDir(engine, id, baseDir);

  // 3. Record pinned MCP version in evidence
  const { resolvedVersion } = generateCodexMcpAddGuidance();
  writeFileSync(
    join(evidenceDir, 'run-meta.json'),
    JSON.stringify({ engine, runId: id, pinnedPlaywrightMcpVersion: resolvedVersion, startedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );

  // 4. Identity match
  const mcpIdentity = verifyMcpIdentity(engine);

  // 5. If Codex and not matched, surface guidance (do not execute)
  if (engine === 'codex' && !mcpIdentity.matched) {
    const { guidanceString } = generateCodexMcpAddGuidance();
    writeFileSync(
      join(evidenceDir, 'mcp-registration-guidance.txt'),
      [
        'Playwright MCP is not registered for Codex.',
        'Run the following command and confirm before proceeding:',
        '',
        `  ${guidanceString}`,
        '',
        `Resolved version: ${resolvedVersion}`,
        '',
        'DO NOT run this automatically. Obtain user confirmation first.',
      ].join('\n'),
      'utf8',
    );
    // Not registered — fall through to fallback ladder which may use browser-driver
  }

  // 6. Fallback ladder (throws on typed stop)
  let transport;
  try {
    transport = await resolveBrowserTransport(engine, { skipProbe, probeTimeoutMs });
  } catch (err) {
    // Write unavailable receipt and rethrow
    const receipt = createLivenessReceipt(engine, evidenceDir);
    receipt.flush('unavailable');
    throw err;
  }

  // 7. Create liveness receipt (initial state: not_run)
  const receipt = createLivenessReceipt(engine, evidenceDir);

  return { engine, transport, evidenceDir, receipt, mcpIdentity };
}
