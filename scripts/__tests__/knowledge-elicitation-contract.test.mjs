import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('Qplan orders reconnaissance and confirmed intake before Plan finalization', () => {
  const skill = read('skills/Qplan/SKILL.md');
  const reconnaissance = skill.indexOf('**Reconnaissance first:**');
  const init = skill.indexOf('node scripts/qe-intake.mjs init');
  const next = skill.indexOf('node scripts/qe-intake.mjs next');
  const synthesize = skill.indexOf('CLI `synthesize` operation');
  const confirm = skill.indexOf('run `confirm`');
  const finalize = skill.indexOf('Only after confirmed intake');
  assert.ok([reconnaissance, init, next, synthesize, confirm, finalize].every((value) => value >= 0));
  assert.ok(reconnaissance < init && init < next && next < synthesize && synthesize < confirm && confirm < finalize);
  assert.match(skill, /retain the intake draft[\s\S]*block Plan finalization/);
  assert.match(skill, /maximum\s+12 allocated follow-ups[\s\S]*maximum batch size of 3/);
});

test('Qgoal delegates intake without a duplicate engine', () => {
  const skill = read('skills/Qgoal/SKILL.md');
  assert.match(skill, /Qplan is the sole owner of tacit-knowledge intake/);
  assert.match(skill, /must not create a second question inventory/);
  assert.match(skill, /\/Qgoal \{goal\}[^\n]*\$Qgoal \{goal\}/);
  assert.match(skill, /\/Qgoal \{목표\}` in Claude or `\$Qgoal \{목표\}` in Codex/);
  assert.doesNotMatch(skill, /\[\d+-\d+\/\d+\]|issuedVersionLimit|followUpAllocationLimit/);
  assert.doesNotMatch(skill, /scripts\/qe-intake\.mjs/);
});

test('interaction adapter preserves labels, fatigue budget, and client parity', () => {
  const adapter = read('core/INTERACTION_ADAPTER.md');
  assert.match(adapter, /Questions: 30 base, up to 12 follow-ups; 3 per batch\. You can pause or stop\./);
  assert.match(adapter, /"label": "\[17\/30\]"/);
  assert.match(adapter, /\[17-1\/3\]/);
  assert.match(adapter, /Claude interactive and Codex interactive render the same label and open-question/);
  assert.match(adapter, /wait for free-form input/);
  assert.match(adapter, /explicitly reversible[\s\S]*non-material question as an assumption/);
  assert.match(adapter, /material question is unresolved[\s\S]*return a blocked result/);
  assert.match(adapter, /-utopia` does not override this rule/);
});
