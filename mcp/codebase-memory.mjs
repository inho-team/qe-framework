import { spawn } from 'node:child_process';
import { findCodeGraphExecutable } from './find-executable.mjs';

const executable = findCodeGraphExecutable();
if (!executable) {
  console.error('QE: codebase-memory-mcp executable was not found on PATH.');
  process.exit(1);
}

const env = { ...process.env };
for (const key of ['CBM_CACHE_DIR', 'CBM_RUNTIME_DIR']) {
  const evalValue = env[`EVAL_QE_${key}`];
  if (!env[key] && evalValue) env[key] = evalValue;
}

const server = spawn(executable, [], { env, stdio: 'inherit', windowsHide: true });
server.once('error', (error) => {
  console.error(`QE: ${error.message}`);
  process.exitCode = 1;
});
server.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
