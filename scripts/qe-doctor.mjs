#!/usr/bin/env node

import { discoverSemanticCapabilities } from './lib/semantic-capabilities.mjs';

const report = discoverSemanticCapabilities();

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write('QE Semantic Tool Doctor\n');
  for (const capability of report.capabilities) {
    const location = capability.executable || capability.health.reason;
    process.stdout.write(`  ${capability.kind.padEnd(3)} ${capability.id.padEnd(16)} ${capability.availability.padEnd(11)} ${location}\n`);
  }
  if (report.fallback) process.stdout.write(`  fallback: ${report.fallback.reason}\n`);
}

