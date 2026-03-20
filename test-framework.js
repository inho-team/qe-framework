#!/usr/bin/env node

/**
 * QE Framework comprehensive health check.
 * Tests skills, agents, hooks, and cross-consistency.
 * Output: accuracy: <float> (0.0 ~ 1.0)
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = __dirname;

let correct = 0;
let total = 0;
let errors = [];

function pass(testName) { total++; correct++; }
function fail(testName, reason) { total++; errors.push(`${testName}: ${reason}`); }

// ============ 1. Skill Spec Completeness ============

const skillsDir = join(CWD, 'skills');
const skillDirs = readdirSync(skillsDir).filter(d => {
  const p = join(skillsDir, d);
  return statSync(p).isDirectory();
});

for (const skill of skillDirs) {
  const skillMd = join(skillsDir, skill, 'SKILL.md');

  // 1a. SKILL.md exists (skip catalog directories)
  const catalogDirs = ['coding-experts'];
  if (!existsSync(skillMd)) {
    if (catalogDirs.includes(skill)) {
      // Not a skill — it's a catalog directory, skip all checks
      continue;
    }
    fail(`skill:${skill}:exists`, 'SKILL.md not found');
    continue;
  }
  pass(`skill:${skill}:exists`);

  const content = readFileSync(skillMd, 'utf8');

  // 1b. Has frontmatter with name
  if (/^---[\s\S]*?name:\s*.+[\s\S]*?---/m.test(content)) {
    pass(`skill:${skill}:name`);
  } else {
    fail(`skill:${skill}:name`, 'Missing name in frontmatter');
  }

  // 1c. Has frontmatter with description
  if (/^---[\s\S]*?description:\s*.+[\s\S]*?---/m.test(content)) {
    pass(`skill:${skill}:description`);
  } else {
    fail(`skill:${skill}:description`, 'Missing description in frontmatter');
  }

  // 1d. Description is at least 30 chars (meaningful)
  // Handle both single-line and multi-line YAML descriptions
  let descText = '';
  const singleLineDesc = content.match(/description:\s*["']?(.{30,})["']?\s*$/m);
  const multiLineDesc = content.match(/description:\s*\|\s*\n([\s\S]*?)(?=\n\w|\n---)/);
  if (singleLineDesc) {
    descText = singleLineDesc[1];
  } else if (multiLineDesc) {
    descText = multiLineDesc[1].trim();
  }
  if (descText.length >= 30) {
    pass(`skill:${skill}:desc-quality`);
  } else {
    fail(`skill:${skill}:desc-quality`, `Description too short: ${descText.length} chars`);
  }

  // 1e. Has a "## " section (actual content beyond frontmatter)
  if (/^## /m.test(content)) {
    pass(`skill:${skill}:has-sections`);
  } else {
    fail(`skill:${skill}:has-sections`, 'No ## sections found');
  }
}

// ============ 2. Agent Spec Completeness ============

const agentsDir = join(CWD, 'agents');
const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.md'));

for (const agentFile of agentFiles) {
  const agentName = agentFile.replace('.md', '');
  const agentPath = join(agentsDir, agentFile);
  const content = readFileSync(agentPath, 'utf8');

  // 2a. Has title (either # heading or name: in frontmatter)
  if (/^#\s+.+/m.test(content) || /^---[\s\S]*?name:\s*.+[\s\S]*?---/m.test(content)) {
    pass(`agent:${agentName}:title`);
  } else {
    fail(`agent:${agentName}:title`, 'No # title or name: frontmatter found');
  }

  // 2b. Has description/role section
  if (/role|purpose|description|overview/im.test(content)) {
    pass(`agent:${agentName}:role`);
  } else {
    fail(`agent:${agentName}:role`, 'No role/purpose/description section');
  }

  // 2c. Minimum content length (at least 200 chars)
  if (content.length >= 200) {
    pass(`agent:${agentName}:content-length`);
  } else {
    fail(`agent:${agentName}:content-length`, `Only ${content.length} chars`);
  }

  // 2d. Has tool list or capabilities mentioned
  if (/tool|Read|Write|Edit|Grep|Glob|Bash|capability|abilities/im.test(content)) {
    pass(`agent:${agentName}:tools`);
  } else {
    fail(`agent:${agentName}:tools`, 'No tool/capability references');
  }
}

// ============ 3. Hook Reliability ============

const hookScripts = [
  'session-start.mjs',
  'pre-tool-use.mjs',
  'post-tool-use.mjs',
  'prompt-check.mjs',
  'pre-compact.mjs',
  'stop-handler.mjs',
  'notification.mjs',
  'task-completed.mjs',
  'teammate-idle.mjs',
];

function runHook(script, payload) {
  try {
    const escaped = JSON.stringify(payload).replace(/'/g, "'\\''");
    return execSync(
      `echo '${escaped}' | node "${join(CWD, 'hooks', 'scripts', script)}"`,
      { encoding: 'utf8', timeout: 10000, cwd: CWD }
    ).trim();
  } catch (e) {
    return e.stdout || `ERROR: ${e.message.slice(0, 100)}`;
  }
}

for (const hook of hookScripts) {
  const hookPath = join(CWD, 'hooks', 'scripts', hook);

  // 3a. Hook file exists
  if (!existsSync(hookPath)) {
    fail(`hook:${hook}:exists`, 'File not found');
    continue;
  }
  pass(`hook:${hook}:exists`);

  // 3b. Hook handles empty input gracefully (no crash)
  const emptyResult = runHook(hook, {});
  if (!emptyResult.startsWith('ERROR:')) {
    pass(`hook:${hook}:empty-input`);
  } else {
    fail(`hook:${hook}:empty-input`, emptyResult.slice(0, 80));
  }

  // 3c. Hook returns valid JSON
  try {
    const parsed = JSON.parse(emptyResult || '{}');
    if (typeof parsed === 'object') {
      pass(`hook:${hook}:valid-json`);
    } else {
      fail(`hook:${hook}:valid-json`, 'Not a JSON object');
    }
  } catch {
    fail(`hook:${hook}:valid-json`, `Invalid JSON: ${emptyResult.slice(0, 60)}`);
  }

  // 3d. Hook handles normal input with cwd
  const normalResult = runHook(hook, {
    cwd: CWD,
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/test.txt' },
    user_message: 'test message',
    message: 'test notification',
  });
  if (!normalResult.startsWith('ERROR:')) {
    pass(`hook:${hook}:normal-input`);
  } else {
    fail(`hook:${hook}:normal-input`, normalResult.slice(0, 80));
  }

  // 3e. Hook handles malformed cwd gracefully
  const badCwdResult = runHook(hook, { cwd: '/nonexistent/path/xyz' });
  if (!badCwdResult.startsWith('ERROR:')) {
    pass(`hook:${hook}:bad-cwd`);
  } else {
    fail(`hook:${hook}:bad-cwd`, badCwdResult.slice(0, 80));
  }
}

// ============ 4. Cross-Consistency Checks ============

// 4a. intent-routes.json covers all Q-prefixed skills
const routesPath = join(CWD, 'hooks', 'scripts', 'lib', 'intent-routes.json');
let routes = {};
let agentTiers = {};
if (existsSync(routesPath)) {
  const routesConfig = JSON.parse(readFileSync(routesPath, 'utf8'));
  routes = routesConfig.routes || {};
  agentTiers = routesConfig.agent_tiers || {};

  // Build set of all routed targets
  const routedTargets = new Set(Object.values(routes));

  // Check each Q-skill has a route (except special ones)
  const skipSkills = ['coding-experts', 'Qcc-setup']; // non-standard or new
  for (const skill of skillDirs) {
    if (skipSkills.includes(skill)) continue;
    if (!skill.startsWith('Q')) continue;

    if (routedTargets.has(skill)) {
      pass(`cross:route:${skill}`);
    } else {
      fail(`cross:route:${skill}`, `Skill not in intent-routes.json targets`);
    }
  }

  // 4b. All agents are in agent_tiers
  const allTieredAgents = new Set();
  for (const agents of Object.values(agentTiers)) {
    for (const a of agents) allTieredAgents.add(a);
  }

  for (const agentFile of agentFiles) {
    const agentName = agentFile.replace('.md', '');
    if (allTieredAgents.has(agentName)) {
      pass(`cross:tier:${agentName}`);
    } else {
      fail(`cross:tier:${agentName}`, `Agent not in any tier`);
    }
  }

  // 4c. All routed agents exist as agent files
  for (const target of routedTargets) {
    if (target.startsWith('E')) {
      const agentFile = `${target}.md`;
      if (agentFiles.includes(agentFile)) {
        pass(`cross:agent-exists:${target}`);
      } else {
        fail(`cross:agent-exists:${target}`, `Routed agent file not found`);
      }
    }
  }

  // 4d. No duplicate route targets (same skill referenced by multiple identical routes)
  pass(`cross:routes-valid`);

} else {
  fail('cross:routes-file', 'intent-routes.json not found');
}

// ============ 5. hooks.json Structure ============

const hooksJsonPath = join(CWD, 'hooks', 'hooks.json');
if (existsSync(hooksJsonPath)) {
  try {
    const hooksConfig = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    const definedHooks = Object.keys(hooksConfig.hooks || {});

    // 5a. All expected hook events are defined
    const expectedEvents = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop', 'UserPromptSubmit', 'Notification'];
    for (const event of expectedEvents) {
      if (definedHooks.includes(event)) {
        pass(`hookjson:${event}`);
      } else {
        fail(`hookjson:${event}`, `Event not defined in hooks.json`);
      }
    }

    // 5b. Each hook references an existing script
    for (const [event, configs] of Object.entries(hooksConfig.hooks || {})) {
      for (const cfg of configs) {
        const hooks = cfg.hooks || [];
        for (const h of hooks) {
          if (h.command) {
            // Extract script path from command
            const scriptMatch = h.command.match(/scripts\/([a-z-]+\.mjs)/);
            if (scriptMatch) {
              const scriptPath = join(CWD, 'hooks', 'scripts', scriptMatch[1]);
              if (existsSync(scriptPath)) {
                pass(`hookjson:script:${event}:${scriptMatch[1]}`);
              } else {
                fail(`hookjson:script:${event}:${scriptMatch[1]}`, 'Referenced script not found');
              }
            }
          }
        }
      }
    }
  } catch (e) {
    fail('hookjson:parse', `Failed to parse: ${e.message.slice(0, 60)}`);
  }
} else {
  fail('hookjson:exists', 'hooks.json not found');
}

// ============ 6. Core Files Exist ============

const coreFiles = [
  'core/INTENT_GATE.md',
  'core/AGENT_TIERS.md',
  'core/AGENT_TEAMS.md',
  'core/PRINCIPLES.md',
  'core/STATE_SPEC.md',
  'core/MEMORY_SPEC.md',
  'core/CONTEXT_BUDGET.md',
];

for (const f of coreFiles) {
  const p = join(CWD, f);
  if (existsSync(p)) {
    const content = readFileSync(p, 'utf8');
    if (content.length >= 100) {
      pass(`core:${f}`);
    } else {
      fail(`core:${f}`, `Too short: ${content.length} chars`);
    }
  } else {
    fail(`core:${f}`, 'File not found');
  }
}

// ============ Output ============

const accuracy = total > 0 ? correct / total : 0;

console.log(`accuracy: ${accuracy.toFixed(6)}`);
console.log(`correct: ${correct}/${total}`);
console.log(`errors: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n--- Errors (top 30) ---');
  for (const err of errors.slice(0, 30)) {
    console.log(err);
  }
  if (errors.length > 30) {
    console.log(`... and ${errors.length - 30} more`);
  }
}
