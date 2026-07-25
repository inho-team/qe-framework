import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, '..', '..', '..', '..', 'skills');

test('only Qgoal and Qplan are user-invocable QE skills', () => {
  const publicSkills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8').includes('user_invocable: true'))
    .sort();
  assert.deepEqual(publicSkills, ['Qgoal', 'Qplan']);
});
