#!/usr/bin/env node
/**
 * Static guard for QE subagent lifecycle instructions.
 *
 * The live handle primitives are owned by the client runtime, not this repo.
 * This guard verifies the framework-owned contract stays present on the core
 * orchestration surfaces that spawn or coordinate subagents.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = process.cwd();

const checks = [
  {
    file: 'core/AGENT_TEAMS.md',
    terms: [
      'Subagent Handle Lifecycle',
      'wait_agent',
      'close_agent',
      'open handles: 0',
      'stale warning',
      'final report'
    ]
  },
  {
    file: 'skills/Qexecute/SKILL.md',
    terms: [
      'Eqa-orchestrator',
      'wait_agent',
      'close_agent',
      'open handles: 0',
      'stale warning',
      'final report'
    ]
  },
  {
    file: 'skills/Qexecute/SKILL.md',
    terms: [
      'Lifecycle Cleanup',
      'wait_agent',
      'close_agent',
      'completed',
      'failed',
      'timed-out',
      'open handles: 0',
      'stale warning'
    ]
  },
  {
    file: 'skills/Qcritical-review/SKILL.md',
    terms: [
      'wait_agent',
      'close_agent',
      'open handles: 0',
      'stale warning',
      'Subagent Lifecycle',
      'final report'
    ]
  },
  {
    file: 'agents/Eqa-orchestrator.md',
    terms: [
      'Subagent Lifecycle Status',
      'degraded-inline',
      'wait_agent',
      'close_agent',
      'open handles: 0',
      'stale warning',
      'final summary'
    ]
  },
  {
    file: 'docs/SUBAGENT_LIFECYCLE.md',
    terms: [
      'Closed ...',
      'Waiting for ...',
      'wait_agent',
      'close_agent',
      'open handles: 0',
      'stale cleanup',
      'deterministic static guard'
    ]
  }
];

let failed = false;

for (const check of checks) {
  const path = resolve(root, check.file);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    failed = true;
    console.error(`[FAIL] ${check.file}: cannot read (${error.message})`);
    continue;
  }

  const missing = check.terms.filter(term => !text.includes(term));
  if (missing.length > 0) {
    failed = true;
    console.error(`[FAIL] ${check.file}: missing ${missing.join(', ')}`);
  } else {
    console.log(`[PASS] ${check.file}`);
  }
}

if (failed) {
  console.error('check-subagent-lifecycle: FAIL');
  process.exit(1);
}

console.log('check-subagent-lifecycle: PASS');
