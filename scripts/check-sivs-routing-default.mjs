#!/usr/bin/env node
/** Guard the single-AI SIVS role contract. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'core/SIVS_SINGLE_AI_MODEL.md',
  'skills/Qgenerate-spec/SKILL.md',
  'skills/Qexecute/SKILL.md',
  'agents/Esupervision-orchestrator.md',
];
const failures = [];
for (const rel of files) {
  const text = readFileSync(join(root, rel), 'utf8');
  if (!/single[- ]AI|단일 AI/i.test(text)) failures.push(`${rel} must state the single-AI contract`);
}
const model = readFileSync(join(root, 'core/SIVS_SINGLE_AI_MODEL.md'), 'utf8');
for (const phrase of ['Spec | Main thread', 'Implement | Main thread', 'Verify | High-reasoning critical lead', 'Supervise | High-reasoning critical lead']) {
  if (!model.includes(phrase)) failures.push(`role model missing: ${phrase}`);
}
if (!/Verify is an \*\*evidence gate\*\*/.test(model) || !/Supervise is a \*\*release gate\*\*/.test(model)) {
  failures.push('single-AI model must separate Verify evidence from Supervise release decisions');
}
if (failures.length) {
  console.error('[sivs-single-ai] FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[sivs-single-ai] PASS — active client owns every SIVS stage');
