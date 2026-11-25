import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function failedInterviews(report, runsOverride) {
  const failures = [];
  for (const entry of report.cases) {
    if (!entry.name.startsWith('gate-interview-')) continue;
    const complete = (entry.arms.with ?? []).filter((run) =>
      !run.error && !run.skippedPaidGraders && entry.graders.length > 0 &&
      entry.graders.every(({ name }) =>
        run.graders.some((result) => result.name === name && result.scored && result.passed)
      )
    ).length;
    const expected = runsOverride ?? entry.runsPerCase;
    if (complete / expected < 2 / 3) {
      failures.push(`${entry.name} (${complete}/${expected})`);
    }
  }
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args, options: { 'output-dir': { type: 'string' }, runs: { type: 'string' } }, strict: false, allowPositionals: true,
  });
  const directory = values['output-dir'] ?? path.join('evals', 'results', new Date().toISOString().replaceAll(':', '-'));
  if (!values['output-dir']) args.push('--output-dir', directory);
  const child = spawnSync('claude', [
    'plugin', 'eval', '.', '--tag', 'gate', '--threshold', '0.66',
    '--allow-tools', 'Write', 'Edit', '--no-publish', '--trust-plugin', '-j', '3', ...args,
  ], { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0 || args.includes('--help') || args.includes('-h')) return child.status ?? 1;
  const report = JSON.parse(readFileSync(path.join(directory, 'aggregate-result.json'), 'utf8'));
  const failures = failedInterviews(report, values.runs && Number(values.runs));
  if (failures.length === 0) return 0;
  console.error('Interview runs meeting every criterion:', failures.join(', '));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
