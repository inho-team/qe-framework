#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RUNTIME_CONTROLLER_TESTS = Object.freeze([
  'hooks/scripts/lib/__tests__/process-controller-e2e.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-sivs-stage-adapter.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-sivs-completion-gate.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-sivs-bounded-remediation.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-persistent-completion-lease.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-process-metrics.test.mjs',
]);

const RUNTIME_CONTROLLER_ADMISSION_TESTS = Object.freeze([
  ...RUNTIME_CONTROLLER_TESTS,
  'hooks/scripts/lib/__tests__/controller-admission.test.mjs',
]);

export function runRuntimeControllerChecks({ spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl(process.execPath, ['--test', ...RUNTIME_CONTROLLER_TESTS], {
    stdio: 'inherit',
  });
  return result && !result.error && result.signal === null && result.status === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync(process.execPath, ['--test', ...RUNTIME_CONTROLLER_ADMISSION_TESTS], {
    stdio: 'inherit',
  });
  process.exitCode = result && !result.error && result.signal === null && result.status === 0 ? 0 : 1;
}
