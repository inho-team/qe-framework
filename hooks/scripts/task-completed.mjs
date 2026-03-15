#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || process.cwd();
const taskId = data.task_id || '';
const hints = [];

// Check if verify checklist exists for this task
if (taskId) {
  const checklistPath = join(cwd, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${taskId}.md`);
  if (existsSync(checklistPath)) {
    const content = readFileSync(checklistPath, 'utf8');
    const unchecked = (content.match(/- *\[ +\]/g) || []).length;
    if (unchecked > 0) {
      hints.push(`Task ${taskId} has ${unchecked} unchecked verification items. Complete verification before marking done.`);
      // Exit code 2 = prevent completion
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          additionalContext: `[QE Agent Teams] ${hints.join(' ')}`
        }
      }));
      process.exit(2);
    }
  }
}

console.log(JSON.stringify({ continue: true }));
process.exit(0);
