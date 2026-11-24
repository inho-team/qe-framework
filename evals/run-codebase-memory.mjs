import { spawnSync } from 'node:child_process';

const server = 'mcp__plugin_qe-framework_codebase-memory-mcp__';
const env = { ...process.env };
// Claude plugin eval forwards EVAL_* to its child, but drops CBM_*.
for (const key of ['CBM_CACHE_DIR', 'CBM_RUNTIME_DIR']) {
  if (env[key]) env[`EVAL_QE_${key}`] = env[key];
}

const result = spawnSync('claude', [
  'plugin', 'eval', '.', '--tag', 'codebase-memory', '--ablation', 'none',
  '--threshold', '0.66', '--scaffold', '--mocks', 'off',
  '--allow-tools', 'ToolSearch', `${server}list_projects`, `${server}index_repository`, `${server}trace_path`,
  '--no-publish', '--trust-plugin', ...process.argv.slice(2),
], { env, stdio: 'inherit', windowsHide: true });

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
