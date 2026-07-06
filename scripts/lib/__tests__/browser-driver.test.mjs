import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as driver from '../browser-driver.mjs';

test('exports the full public API contract', () => {
  for (const name of ['isBrowserAvailable', 'launch', 'screenshot', 'collectConsole', 'getPageText', 'snapshot', 'close', 'detectWebProject', 'regressionSpecName']) {
    assert.equal(typeof driver[name], 'function', `missing export: ${name}`);
  }
});

const ABSENT_LOADER = () => { throw new Error('Cannot find package "playwright"'); };

test('isBrowserAvailable returns false when playwright is absent (never throws)', async () => {
  driver.__setPlaywrightForTest(ABSENT_LOADER); // simulate absence regardless of install state
  try {
    assert.equal(await driver.isBrowserAvailable(), false);
  } finally {
    driver.__setPlaywrightForTest(null);
  }
});

test('browser ops throw a typed PLAYWRIGHT_NOT_INSTALLED error with install hint when absent', async () => {
  driver.__setPlaywrightForTest(ABSENT_LOADER);
  const fakeSession = { page: {}, context: {}, browser: {} };
  const ops = [
    () => driver.launch({ url: 'http://x' }),
    () => driver.screenshot(fakeSession, '/tmp/x.png'),
    () => driver.getPageText(fakeSession),
    () => driver.snapshot(fakeSession),
  ];
  for (const op of ops) {
    await assert.rejects(op(), (err) => {
      assert.equal(err.code, 'PLAYWRIGHT_NOT_INSTALLED');
      assert.match(err.message, /npm i -D playwright/);
      return true;
    });
  }
});

test('launch returns a well-shaped session with an injected playwright', async () => {
  const consoleHandlers = [];
  const fakePage = {
    on: (evt, fn) => { if (evt === 'console') consoleHandlers.push(fn); },
    goto: async () => {},
  };
  const fakeContext = { pages: () => [fakePage], newPage: async () => fakePage };
  const fakeBrowser = { newContext: async () => fakeContext };
  const fakePlaywright = { chromium: { launch: async () => fakeBrowser } };
  driver.__setPlaywrightForTest(fakePlaywright);
  try {
    const session = await driver.launch({ url: 'http://example.test', storageState: undefined });
    assert.ok(session.browser && session.context && session.page);
    assert.ok(Array.isArray(session.consoleMessages));
    // console listener wired: simulate a console event
    consoleHandlers[0]({ type: () => 'log', text: () => 'hello' });
    assert.deepEqual(driver.collectConsole(session).messages, [{ type: 'log', text: 'hello' }]);
  } finally {
    driver.__setPlaywrightForTest(null);
  }
});

test('launch uses launchPersistentContext when userDataDir is given', async () => {
  let persistentCalledWith = null;
  const fakePage = { on: () => {}, goto: async () => {} };
  const fakeContext = { pages: () => [fakePage] };
  const fakePlaywright = {
    chromium: {
      launchPersistentContext: async (dir) => { persistentCalledWith = dir; return fakeContext; },
      launch: async () => { throw new Error('should not use ephemeral launch'); },
    },
  };
  driver.__setPlaywrightForTest(fakePlaywright);
  try {
    const session = await driver.launch({ userDataDir: '/tmp/profile' });
    assert.equal(persistentCalledWith, '/tmp/profile');
    assert.equal(session.browser, null);
  } finally {
    driver.__setPlaywrightForTest(null);
  }
});

test('detectWebProject flags web deps and config files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-webdetect-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vite: '^5' } }));
    const r = driver.detectWebProject(dir);
    assert.equal(r.isWeb, true);
    assert.ok(r.signals.includes('dep:vite'));

    const empty = mkdtempSync(join(tmpdir(), 'qe-nonweb-'));
    try {
      writeFileSync(join(empty, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
      assert.equal(driver.detectWebProject(empty).isWeb, false);
    } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regressionSpecName produces qa-regression-<slug>.spec.ts', () => {
  assert.equal(driver.regressionSpecName('Login Flow'), 'qa-regression-login-flow.spec.ts');
  assert.equal(driver.regressionSpecName('checkout/PAY'), 'qa-regression-checkout-pay.spec.ts');
  assert.equal(driver.regressionSpecName(''), 'qa-regression-scenario.spec.ts');
});
