#!/usr/bin/env node
/**
 * Static guard for the Code Risk Gate contract.
 *
 * This does not judge whether a model thought deeply enough. It verifies the
 * framework-owned surfaces still force code tasks through risk registration,
 * adversarial review, Supervise-stage risk ownership, and final risk reporting.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    file: 'skills/Qgenerate-spec/SKILL.md',
    terms: [
      'Code Risk Register',
      '## Risk Register',
      'Worst-case failure',
      'Data loss / corruption risk',
      'Security / permission risk',
      'Concurrency / race risk',
      'Rollback strategy',
      'Unverified assumptions',
      'High-risk findings are mitigated'
    ]
  },
  {
    file: 'skills/Qatomic-run/SKILL.md',
    terms: [
      'Code Risk Gate',
      'hard block',
      'worst-case failure',
      'data loss/corruption risk',
      'security/permission risk',
      'concurrency/race risk'
    ]
  },
  {
    file: 'skills/Qcode-run-task/SKILL.md',
    terms: [
      'Code Risk Gate',
      'Qrisk-proof {UUID}',
      'Risk Proof Gate',
      '.qe/agent-results/risk-proof-{UUID}.md',
      'Worst-case failure considered',
      'High-risk findings',
      'Residual Risks',
      'Unverified assumptions',
      'purely positive completion summary'
    ]
  },
  {
    file: 'skills/Qcritical-review/SKILL.md',
    terms: [
      'final **Code Risk Gate**',
      'Qrisk-proof',
      '.qe/agent-results/risk-proof-{UUID}.md',
      'low-probability high-impact failures',
      'unknown` HIGH/CRITICAL risk is a FAIL',
      'Merge Blocker'
    ]
  },
  {
    file: 'skills/Qcritical-review/reference/verify-gate-protocol.md',
    terms: [
      'TASK_REQUEST `## Risk Register`',
      'Low-probability high-impact failures',
      'HIGH/CRITICAL risk',
      'gate FAIL'
    ]
  },
  {
    file: 'skills/Qcritical-review/reference/supervise-gate-protocol.md',
    terms: [
      'final owner of the **Code Risk Gate**',
      '.qe/agent-results/risk-proof-{UUID}.md',
      'Risk Proof matrix',
      'worst credible production outcome',
      'unknown` HIGH/CRITICAL risk is FAIL',
      'hides an unresolved'
    ]
  },
  {
    file: 'skills/Qcritical-review/reference/risk-mode.md',
    terms: [
      'Qrisk-proof',
      'Erisk-proof-auditor',
      'Risk Proof Matrix',
      'Missing/placeholder `## Risk Register`',
      'verified-safe',
      'deferred-with-owner',
      '.qe/agent-results/risk-proof-{UUID}.md',
      'New unregistered `CRITICAL` or `HIGH` risk'
    ]
  },
  {
    file: 'agents/Erisk-proof-auditor.md',
    terms: [
      'low-probability high-impact failures',
      'Risk Matrix',
      'verified-safe',
      'deferred-with-owner',
      'New unregistered CRITICAL/HIGH risk',
      'PASS | WARN | FAIL'
    ]
  },
  {
    file: 'hooks/scripts/stop-handler.mjs',
    terms: [
      'evaluateCodeRiskReportGate',
      'code_risk_stop_gate',
      'Facts/사실',
      'Residual Risks/남은 리스크',
      'Assumptions/추정'
    ]
  },
  {
    file: 'hooks/scripts/lib/config.mjs',
    terms: [
      'code_risk_stop_gate',
      'positive summary',
      'residual risks'
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
  console.error('check-code-risk-gate: FAIL');
  process.exit(1);
}

console.log('check-code-risk-gate: PASS');
