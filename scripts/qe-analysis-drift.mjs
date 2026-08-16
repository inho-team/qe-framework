#!/usr/bin/env node

import { assessAnalysisDrift, formatAnalysisDrift } from '../hooks/scripts/lib/analysis-drift.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const thresholdAt = args.indexOf('--threshold');
const threshold = thresholdAt >= 0 ? Number(args[thresholdAt + 1]) : 3;
const result = assessAnalysisDrift(process.cwd(), {
  threshold: Number.isInteger(threshold) && threshold >= 1 ? threshold : 3,
});

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (result.skipped) {
  process.stdout.write(`analysis-drift: skipped (${result.reason})\n`);
} else if (!result.actionRequired) {
  process.stdout.write(`analysis-drift: current (${result.elements.length}/${result.threshold} structural elements)\n`);
} else {
  process.stdout.write(`${formatAnalysisDrift(result)}\n`);
}
