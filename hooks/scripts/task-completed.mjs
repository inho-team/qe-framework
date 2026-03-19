#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readStdinJson, getCwd } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);
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

// Trigger domain knowledge collection on task completion
// Only trigger if the task involved code/config changes (domain knowledge likely present)
try {
  const diff = execSync('git diff HEAD~1 --name-only 2>/dev/null', { cwd, encoding: 'utf8', timeout: 3000 });
  const changedFiles = diff.trim().split('\n').filter(Boolean);
  const hasCodeChanges = changedFiles.some(f =>
    /\.(js|mjs|ts|jsx|tsx|py|java|go|rs|rb|cs|json|yaml|yml|sql)$/.test(f)
  );
  if (hasCodeChanges) {
    hints.push('Run Edocs-collector in background to extract domain knowledge from completed task.');
  }
} catch {
  // git diff failed — skip docs collection rather than triggering on error
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext: `[QE] ${hints.join(' ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
process.exit(0);
