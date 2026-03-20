#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getTeamContext } from './lib/team-detect.mjs';

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
  process.exit(0);
}

const cwd = data.cwd || data.directory || process.cwd();
const teamCtx = getTeamContext(data);
const teammateName = teamCtx.teammateName || 'unknown';
const hints = [];

// Check pending tasks in .qe/tasks/pending/
try {
  const pendingDir = join(cwd, '.qe', 'tasks', 'pending');
  if (existsSync(pendingDir)) {
    const { readdirSync } = await import('fs');
    const pendingFiles = readdirSync(pendingDir).filter(f => f.startsWith('TASK_REQUEST_'));
    if (pendingFiles.length > 0) {
      hints.push(`${pendingFiles.length} pending task(s) in .qe/tasks/pending/. Claim next task or report completion.`);

      // Read first pending task to suggest specific next action
      try {
        const firstTask = readFileSync(join(pendingDir, pendingFiles[0]), 'utf8');
        const titleMatch = firstTask.match(/^#\s+(.+)/m);
        if (titleMatch) {
          hints.push(`Next available: "${titleMatch[1]}"`);
        }
      } catch {}
    }
  }
} catch {}

// Check if there are unchecked VERIFY_CHECKLIST items
try {
  const checklistDir = join(cwd, '.qe', 'checklists', 'pending');
  if (existsSync(checklistDir)) {
    const { readdirSync } = await import('fs');
    const checklists = readdirSync(checklistDir).filter(f => f.startsWith('VERIFY_CHECKLIST_'));
    for (const cl of checklists) {
      const content = readFileSync(join(checklistDir, cl), 'utf8');
      const unchecked = (content.match(/- \[ \]/g) || []).length;
      const checked = (content.match(/- \[x\]/gi) || []).length;
      if (unchecked > 0) {
        hints.push(`Checklist ${cl}: ${checked}/${checked + unchecked} complete, ${unchecked} remaining.`);
        break; // Only report first incomplete checklist
      }
    }
  }
} catch {}

if (hints.length > 0) {
  // Exit code 2 = send feedback and keep teammate working
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext: `[QE Agent Teams] Teammate "${teammateName}": ${hints.join(' | ')}`
    }
  }));
  process.exit(2);
} else {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
