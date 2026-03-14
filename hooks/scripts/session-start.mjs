#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { formatMemoryForInjection } from './lib/memory.mjs';

// Read stdin (Claude Code provides JSON with cwd, session_id, etc.)
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
  // If no valid input, pass through
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || process.cwd();
const messages = [];

// Check 1: CLAUDE.md existence (Qinit check)
const claudeMdPath = join(cwd, 'CLAUDE.md');
if (!existsSync(claudeMdPath)) {
  messages.push('QE 프레임워크가 초기화되지 않았습니다. `/Qinit`을 실행하세요.');
}

// Check 2: .qe/analysis/ freshness
const analysisDir = join(cwd, '.qe', 'analysis');
if (existsSync(analysisDir)) {
  const analysisFiles = ['project-structure.md', 'tech-stack.md', 'entry-points.md', 'architecture.md'];
  const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();

  let staleCount = 0;
  for (const file of analysisFiles) {
    const filePath = join(analysisDir, file);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > staleThreshold) {
        staleCount++;
      }
    } else {
      staleCount++;
    }
  }

  if (staleCount >= 2) {
    messages.push('프로젝트 분석 데이터가 오래되었습니다. Erefresh-executor가 백그라운드에서 갱신합니다.');
  }
}

// Check 3: .qe/context/snapshot.md existence (resume hint)
const snapshotPath = join(cwd, '.qe', 'context', 'snapshot.md');
if (existsSync(snapshotPath)) {
  const stat = statSync(snapshotPath);
  const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  if (ageHours < 24) {
    messages.push('이전 세션의 맥락이 저장되어 있습니다. `/Qresume`으로 복원할 수 있습니다.');
  }
}

// Check 4: Project memory
const memoryContext = formatMemoryForInjection(cwd);
if (memoryContext) {
  messages.push(memoryContext);
}

if (messages.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `[QE Framework] ${messages.join(' | ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
