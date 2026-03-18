#!/usr/bin/env node
/**
 * Supervision Agent Spec Validator
 * Checks quality of supervision agent .md files and outputs a numeric score.
 *
 * Output: assertion_failures:<N>
 * Lower is better (target: 0)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let failures = 0;
const report = [];

function fail(file, msg) {
  failures++;
  report.push(`FAIL [${file}]: ${msg}`);
}
function pass(file, msg) {
  report.push(`pass [${file}]: ${msg}`);
}

// ─── Agent files to validate ───────────────────────────────────────────────
const AGENTS = {
  'Esupervision-orchestrator': {
    path: 'agents/Esupervision-orchestrator.md',
    requiredFrontmatter: ['name', 'description', 'tools', 'memory', 'recommendedModel', 'color'],
    requiredSections: ['## Will', '## Will Not', '## Task Type Routing Table', '## Supervision Grade Definitions', '## Execution Workflow', '## Loop Counter Management'],
    requiredModel: 'opus',
    requiredReturnFormat: 'Grade: PASS|PARTIAL|FAIL',
  },
  'Ecode-quality-supervisor': {
    path: 'agents/Ecode-quality-supervisor.md',
    requiredFrontmatter: ['name', 'description', 'tools', 'memory', 'recommendedModel', 'color'],
    requiredSections: ['## Will', '## Will Not', '## Workflow', '## Return Format'],
    requiredModel: 'sonnet',
    requiredReturnFormat: 'Grade: PASS | PARTIAL | FAIL',
    mustNotContain: ['security', 'Security'],  // security is Esecurity-officer's job
    mustNotContainNote: 'Should delegate security to Esecurity-officer, not handle it directly',
  },
  'Edocs-supervisor': {
    path: 'agents/Edocs-supervisor.md',
    requiredFrontmatter: ['name', 'description', 'tools', 'memory', 'recommendedModel', 'color'],
    requiredSections: ['## Will', '## Will Not', '## Workflow', '## Return Format'],
    requiredModel: 'haiku',
    requiredReturnFormat: 'Grade: PASS | PARTIAL | FAIL',
  },
  'Eanalysis-supervisor': {
    path: 'agents/Eanalysis-supervisor.md',
    requiredFrontmatter: ['name', 'description', 'tools', 'memory', 'recommendedModel', 'color'],
    requiredSections: ['## Will', '## Will Not', '## Workflow', '## Return Format'],
    requiredModel: 'sonnet',
    requiredReturnFormat: 'Grade: PASS | PARTIAL | FAIL',
  },
};

// ─── REMEDIATION_REQUEST_FORMAT ─────────────────────────────────────────────
const REMEDIATION_FORMAT_PATH = 'core/REMEDIATION_REQUEST_FORMAT.md';
const REMEDIATION_REQUIRED_SECTIONS = [
  'Supervision Result',
  'Deficient Items',
  'Remediation Checklist',
  'Round Information',
];

// ─── Qrun-task Step 4.5 ─────────────────────────────────────────────────────
const QRUN_TASK_PATH = 'skills/Qrun-task/SKILL.md';
const QRUN_REQUIRED_PHRASES = [
  'Step 4.5',
  'Supervision Gate',
  'skip-supervision',
  'supervision_iteration',
  'REMEDIATION',
  'type: code',  // code tasks should never be skipped
];

// ─── Validation helpers ──────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const [k, ...v] = line.split(':');
    if (k && v.length) fm[k.trim()] = v.join(':').trim();
  }
  return fm;
}

function validateAgent(name, spec) {
  const filePath = join(ROOT, spec.path);
  if (!existsSync(filePath)) {
    fail(name, `File not found: ${spec.path}`);
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);

  // Frontmatter fields
  for (const field of spec.requiredFrontmatter) {
    if (!fm[field]) {
      fail(name, `Missing frontmatter field: ${field}`);
    } else {
      pass(name, `frontmatter.${field} present`);
    }
  }

  // Recommended model
  if (spec.requiredModel && fm['recommendedModel'] !== spec.requiredModel) {
    fail(name, `recommendedModel should be "${spec.requiredModel}", got "${fm['recommendedModel']}"`);
  } else if (spec.requiredModel) {
    pass(name, `recommendedModel: ${fm['recommendedModel']}`);
  }

  // Required sections
  for (const section of spec.requiredSections) {
    if (!content.includes(section)) {
      fail(name, `Missing required section: "${section}"`);
    } else {
      pass(name, `section "${section}" present`);
    }
  }

  // Return format consistency
  if (spec.requiredReturnFormat && !content.includes(spec.requiredReturnFormat)) {
    fail(name, `Return format missing or inconsistent — expected to contain: "${spec.requiredReturnFormat}"`);
  } else if (spec.requiredReturnFormat) {
    pass(name, 'Return format present');
  }

  // Responsibility boundary check (Ecode-quality-supervisor must NOT handle security directly)
  if (name === 'Ecode-quality-supervisor') {
    // Should reference Esecurity-officer for security (delegate), not handle security checks itself
    const hasSecurityDelegate = content.includes('Esecurity-officer');
    if (!hasSecurityDelegate) {
      fail(name, 'Must reference Esecurity-officer as delegate for security findings');
    } else {
      pass(name, 'Delegates security to Esecurity-officer');
    }
  }
}

function validateRemediationFormat() {
  const filePath = join(ROOT, REMEDIATION_FORMAT_PATH);
  if (!existsSync(filePath)) {
    fail('REMEDIATION_FORMAT', `File not found: ${REMEDIATION_FORMAT_PATH}`);
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  for (const section of REMEDIATION_REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      fail('REMEDIATION_FORMAT', `Missing required section: "${section}"`);
    } else {
      pass('REMEDIATION_FORMAT', `section "${section}" present`);
    }
  }
  // Must only be generated on FAIL, not PARTIAL
  if (!content.includes('FAIL')) {
    fail('REMEDIATION_FORMAT', 'Must state REMEDIATION_REQUEST is only generated on FAIL grade');
  } else {
    pass('REMEDIATION_FORMAT', 'FAIL-only generation rule present');
  }
}

function validateQrunTask() {
  const filePath = join(ROOT, QRUN_TASK_PATH);
  if (!existsSync(filePath)) {
    fail('Qrun-task', `File not found: ${QRUN_TASK_PATH}`);
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  for (const phrase of QRUN_REQUIRED_PHRASES) {
    if (!content.includes(phrase)) {
      fail('Qrun-task', `Missing required phrase: "${phrase}"`);
    } else {
      pass('Qrun-task', `"${phrase}" present`);
    }
  }

  // Routing table: all 4 types must be present
  for (const type of ['code', 'docs', 'analysis', 'other']) {
    if (!content.includes(`type` ) || !content.includes(type)) {
      fail('Qrun-task', `Routing table missing type: "${type}"`);
    } else {
      pass('Qrun-task', `routing type "${type}" present`);
    }
  }

  // supervision_iteration persistence (session survival)
  if (!content.includes('supervision_iteration') || !content.includes('session')) {
    fail('Qrun-task', 'supervision_iteration persistence across sessions not documented');
  } else {
    pass('Qrun-task', 'supervision_iteration session persistence documented');
  }

  // code tasks must NOT be skippable
  if (content.includes('type: code') && content.includes('skip')) {
    // Good — should explicitly say code is not skipped
    if (content.includes('never') || content.includes('not.*code') || content.match(/code.*never|never.*skip.*code/s)) {
      pass('Qrun-task', 'code tasks explicitly not skippable');
    } else {
      fail('Qrun-task', 'skip-supervision condition must explicitly exclude type: code tasks');
    }
  }
}

// ─── Orchestrator-specific checks ───────────────────────────────────────────
function validateOrchestratorResponsibility() {
  const filePath = join(ROOT, AGENTS['Esupervision-orchestrator'].path);
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');

  // Orchestrator should NOT directly call Etask-executor (that's Qrun-task's job)
  // It should return the REMEDIATION draft to Qrun-task
  const hasResponsibilityBoundary = content.includes('Return the draft to Qrun-task') ||
    content.includes('return.*Qrun-task') ||
    content.includes('Qrun-task is responsible');
  if (!hasResponsibilityBoundary) {
    fail('Esupervision-orchestrator', 'Must clearly state that REMEDIATION file saving and Etask-executor delegation is Qrun-task\'s responsibility, not orchestrator\'s');
  } else {
    pass('Esupervision-orchestrator', 'Responsibility boundary (orchestrator vs Qrun-task) clearly stated');
  }

  // Return format must not use JSON syntax ({domain: ...})
  if (content.match(/\{\s*domain:/)) {
    fail('Esupervision-orchestrator', 'Return format uses JSON-like syntax ({domain: ...}) — should use unified markdown list format');
  } else {
    pass('Esupervision-orchestrator', 'Return format uses correct markdown format');
  }

  // Must not use "WARN" as an overall grade (only PASS/PARTIAL/FAIL are valid grades)
  const gradeSection = content.match(/Grade:.*?(?=###|\n\n)/s)?.[0] || '';
  if (gradeSection.includes('"WARN"') || content.match(/grade.*"WARN"/)) {
    fail('Esupervision-orchestrator', 'Uses "WARN" as an overall grade — only PASS/PARTIAL/FAIL are valid overall grades');
  } else {
    pass('Esupervision-orchestrator', 'No invalid "WARN" overall grade used');
  }
}

// ─── Run all validations ─────────────────────────────────────────────────────
for (const [name, spec] of Object.entries(AGENTS)) {
  validateAgent(name, spec);
}
validateRemediationFormat();
validateQrunTask();
validateOrchestratorResponsibility();

// ─── Output ──────────────────────────────────────────────────────────────────
const total = report.length;
const passed = report.filter(l => l.startsWith('pass')).length;

console.log(report.join('\n'));
console.log('');
console.log(`─── Results: ${passed}/${total} passed ───`);
console.log(`assertion_failures:${failures}`);
