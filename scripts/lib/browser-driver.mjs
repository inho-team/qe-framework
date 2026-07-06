// browser-driver.mjs — reusable Playwright browser automation for Qqa run --browser
// (Phase 6 real-browser QA loop).
//
// Playwright is an OPTIONAL dependency loaded on demand via dynamic import, so the
// base install stays lean (diet ethos). Every browser operation fails fast with a
// typed, actionable error when playwright is absent; callers can probe first with
// isBrowserAvailable(). Web-project detection (detectWebProject) is dependency-free
// so Qqa can recommend --browser without playwright installed.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const INSTALL_HINT = 'npm i -D playwright && npx playwright install chromium';

// Test seam: __setPlaywrightForTest injects either a fake module object (to exercise
// the API shape without a real browser) or a loader FUNCTION (which may throw, to
// simulate playwright being absent regardless of whether it is actually installed).
// Null means "load the real playwright package". This keeps the unit tests
// deterministic in both installed and not-installed environments.
let playwrightOverride = null;

// Test-only: inject a fake module, a loader function, or null to clear.
export function __setPlaywrightForTest(modOrLoader) {
  playwrightOverride = modOrLoader;
}

function notInstalledError() {
  const err = new Error(`[browser-driver] playwright is not installed.\nRun: ${INSTALL_HINT}`);
  err.code = 'PLAYWRIGHT_NOT_INSTALLED';
  return err;
}

async function requirePlaywright() {
  const loader = typeof playwrightOverride === 'function'
    ? playwrightOverride
    : playwrightOverride
      ? async () => playwrightOverride
      : () => import('playwright');
  try {
    return await loader();
  } catch {
    throw notInstalledError();
  }
}

// Probe whether a browser can be driven. Never throws.
export async function isBrowserAvailable() {
  try {
    await requirePlaywright();
    return true;
  } catch {
    return false;
  }
}

// Launch a browser session. Supports session reuse via a storageState JSON
// (path or parsed object) and, for persistent profiles, a userDataDir.
// Returns { browser, context, page, consoleMessages }.
export async function launch({ url, headless = true, storageState, userDataDir, browserType = 'chromium', timeoutMs = 30000 } = {}) {
  const pw = await requirePlaywright();
  const engine = pw[browserType] || pw.chromium;
  const consoleMessages = [];

  let browser = null;
  let context;
  if (userDataDir) {
    // Persistent context owns its own browser process; storageState is ignored here
    // because the profile directory already carries auth/session state.
    context = await engine.launchPersistentContext(userDataDir, { headless, timeout: timeoutMs });
  } else {
    // A bounded launch timeout gives callers (e.g. the Eyes startup probe) a hard
    // upper bound instead of a hang; Playwright throws a TimeoutError if exceeded.
    browser = await engine.launch({ headless, timeout: timeoutMs });
    const contextOptions = {};
    if (storageState) contextOptions.storageState = storageState;
    context = await browser.newContext(contextOptions);
  }

  const page = context.pages()[0] || await context.newPage();
  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  if (url) await page.goto(url, { timeout: timeoutMs });

  return { browser, context, page, consoleMessages };
}

// Save a screenshot of the session's current page to `path` (.png).
export async function screenshot(session, path) {
  await requirePlaywright();
  if (!session || !session.page) throw new Error('[browser-driver] screenshot requires an active session');
  await session.page.screenshot({ path, fullPage: true });
}

// Return the live console-message buffer for the session. The listener is attached
// at launch(), so messages accumulate for the session's lifetime.
export function collectConsole(session) {
  if (!session) throw new Error('[browser-driver] collectConsole requires a session');
  return { messages: session.consoleMessages || [] };
}

// Return the page's visible text (innerText of <body>).
export async function getPageText(session) {
  await requirePlaywright();
  if (!session || !session.page) throw new Error('[browser-driver] getPageText requires an active session');
  return session.page.innerText('body');
}

// Return the page's accessibility/aria snapshot. Playwright removed
// page.accessibility in newer releases, so prefer the current Locator.ariaSnapshot()
// and fall back to the legacy API when present.
export async function snapshot(session) {
  await requirePlaywright();
  if (!session || !session.page) throw new Error('[browser-driver] snapshot requires an active session');
  const page = session.page;
  if (page.accessibility && typeof page.accessibility.snapshot === 'function') {
    return page.accessibility.snapshot();
  }
  if (typeof page.locator === 'function') {
    return page.locator('body').ariaSnapshot();
  }
  throw new Error('[browser-driver] no accessibility snapshot API available in this Playwright version');
}

// Close the session (page → context → browser).
export async function close(session) {
  if (!session) return;
  try { if (session.page) await session.page.close(); } catch { /* already closed */ }
  try { if (session.context) await session.context.close(); } catch { /* already closed */ }
  try { if (session.browser) await session.browser.close(); } catch { /* persistent context has no separate browser */ }
}

const WEB_DEP_MARKERS = [
  'vite', 'next', 'nuxt', 'react-scripts', 'gatsby', 'remix', '@remix-run/node',
  '@vitejs/plugin-react', '@angular/core', 'svelte', '@sveltejs/kit', 'astro',
];
const WEB_CONFIG_FILES = [
  'index.html', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
  'next.config.js', 'next.config.mjs', 'next.config.ts', 'nuxt.config.ts',
  'angular.json', 'svelte.config.js', 'astro.config.mjs',
];

// Detect whether `cwd` looks like a web project that would benefit from browser QA.
// Dependency-free (no playwright), so Qqa can recommend `Qqa run --browser`
// regardless of install state. Returns { isWeb, signals }.
export function detectWebProject(cwd = process.cwd()) {
  const signals = [];
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const marker of WEB_DEP_MARKERS) {
        if (deps[marker]) signals.push(`dep:${marker}`);
      }
    } catch { /* unreadable package.json → no dep signals */ }
  }
  for (const file of WEB_CONFIG_FILES) {
    if (existsSync(join(cwd, file))) signals.push(`file:${file}`);
  }
  return { isWeb: signals.length > 0, signals };
}

// Build the conventional browser-regression spec filename for a scenario slug.
export function regressionSpecName(slug) {
  const clean = String(slug || 'scenario')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scenario';
  return `qa-regression-${clean}.spec.ts`;
}
