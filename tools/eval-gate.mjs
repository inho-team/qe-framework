import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Gate cases outside the interview family that are judged per run, like interview cases.
 * The handoff and review-consent cases combine several graders (a behavior judged from the reply
 * plus what the coordinating window must or must not do in that same run), so an average across
 * graders would let one run's miss hide behind another run's pass. The single-grader cases
 * (execution-method question, approach comparison) are listed so a run that errored or hit the
 * turn cap counts as failed instead of being averaged in by its partial reply.
 */
export const STRICT_CASES = new Set([
  'gate-handoff-subagent-plan',
  'gate-plan-asks-execution-mode',
  'gate-review-fix-needs-consent',
  'gate-review-fix-delegated',
  'gate-approach-alternatives',
]);

/**
 * Lists strict cases (every `gate-interview-*` case and STRICT_CASES) with fewer than
 * two thirds of their runs passing every grader, as "name (passed/expected)".
 * A run that errored, skipped paid graders, or left a grader unscored does not count as passed,
 * except a with-only grader (e.g. `tool_used: Skill`): the default with-without ablation leaves it
 * unscored as a plugin-fired indicator, yet its result in the with arm is what the case checks.
 * `runsOverride` replaces each case's `runsPerCase` when the run count was changed on the command line.
 */
export function failedStrictCases(report, runsOverride) {
  const failures = [];
  for (const entry of report.cases) {
    if (!entry.name.startsWith('gate-interview-') && !STRICT_CASES.has(entry.name)) continue;
    const complete = (entry.arms.with ?? []).filter((run) =>
      !run.error && !run.skippedPaidGraders && entry.graders.length > 0 &&
      entry.graders.every(({ name }) =>
        run.graders.some((result) => result.name === name && (result.scored || result.withOnly) && result.passed)
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
    // Handoff cases need their fixture repo and a worker that can write the goal folder under the sandbox HOME.
    'plugin', 'eval', '.', '--tag', 'gate', '--threshold', '0.66', '--scaffold',
    '--allow-tools', 'Write', 'Edit', 'Write(~/.qe/**)', 'Edit(~/.qe/**)',
    '--no-publish', '--trust-plugin', '-j', '3', ...args,
  ], { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0 || args.includes('--help') || args.includes('-h')) return child.status ?? 1;
  const report = JSON.parse(readFileSync(path.join(directory, 'aggregate-result.json'), 'utf8'));
  const failures = failedStrictCases(report, values.runs && Number(values.runs));
  if (failures.length === 0) return 0;
  console.error('Strict gate runs meeting every criterion:', failures.join(', '));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
