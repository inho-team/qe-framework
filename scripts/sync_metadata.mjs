import fs from 'fs';
import path from 'path';

const MEMO_INJECTION_BLOCK = `
## Minimal I/O Rule (ContextMemo)
Before performing any file I/O (Read, Grep, Glob), check for [MEMO HIT] hints from hooks. If available, use the cached content from your history to save token budget.
`;

function findMarkdownFiles(dir, pattern) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(findMarkdownFiles(file, pattern));
    } else {
      if (file.endsWith(pattern)) {
        results.push(file);
      }
    }
  });
  return results;
}

function parseMarkdown(content) {
  const lines = content.split('\n');
  const frontmatter = {};
  let inFrontmatter = false;
  let fmLines = [];
  let bodyLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') {
      if (!inFrontmatter && fmLines.length === 0) {
        inFrontmatter = true;
        continue;
      } else if (inFrontmatter) {
        inFrontmatter = false;
        bodyLines = lines.slice(i + 1);
        break;
      }
    }
    if (inFrontmatter) {
      fmLines.push(line);
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim().replace(/^"(.*)"$/, '$1');
        frontmatter[key] = value;
      }
    } else if (fmLines.length === 0) {
      // No frontmatter found yet
      bodyLines.push(line);
    }
  }
  
  return { frontmatter, body: bodyLines.join('\n'), originalFmLines: fmLines };
}

function stringifyFrontmatter(fm) {
  let str = '---\n';
  for (const [key, value] of Object.entries(fm)) {
    if (value && value.includes('"')) {
      str += `${key}: '${value}'\n`;
    } else if (value && (value.includes(':') || value.includes('#'))) {
      str += `${key}: "${value}"\n`;
    } else {
      str += `${key}: ${value}\n`;
    }
  }
  str += '---';
  return str;
}

// 1. Sync Skills
const skillMetadataMap = {
  'Writing': {
    trigger: 'When improving prose or documentation clarity.',
    model: 'haiku'
  },
  'Core': {
    trigger: 'When framework initialization, maintenance, or audit is required.',
    model: 'haiku'
  }
};

const skillFiles = findMarkdownFiles('skills', 'SKILL.md');
console.log(`Syncing ${skillFiles.length} skills...`);

for (const file of skillFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const { frontmatter, body } = parseMarkdown(content);
  let changed = false;

  // Determine category and defaults
  let trigger = frontmatter.invocation_trigger;
  let model = frontmatter.recommendedModel;

  if (!trigger) {
    if (file.includes('Qwriting-') || file.includes('Qdoc-')) trigger = skillMetadataMap['Writing'].trigger;
    else trigger = skillMetadataMap['Core'].trigger;
    frontmatter.invocation_trigger = trigger;
    changed = true;
  }

  if (!model) {
    model = 'haiku';
    frontmatter.recommendedModel = model;
    changed = true;
  }

  if (changed) {
    const newContent = stringifyFrontmatter(frontmatter) + '\n' + body;
    fs.writeFileSync(file, newContent);
  }
}

// 2. Sync Agents
// Load Agent Tiers from core/AGENT_TIERS.md
const agentTiersContent = fs.readFileSync('core/AGENT_TIERS.md', 'utf-8');
const agentToModelMap = {};
const tierRows = agentTiersContent.match(/\| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g);
if (tierRows) {
  tierRows.forEach(row => {
    const parts = row.split('|').map(p => p.trim());
    if (parts.length >= 4 && parts[1] !== 'Agent' && parts[1] !== '---') {
      const tier = parts[2];
      let model = 'sonnet';
      if (tier === 'LOW') model = 'haiku';
      if (tier === 'HIGH') model = 'opus';
      agentToModelMap[parts[1]] = model;
    }
  });
}

const agentFiles = findMarkdownFiles('agents', '.md');
console.log(`Syncing ${agentFiles.length} agents...`);

for (const file of agentFiles) {
  const agentName = path.basename(file, '.md');
  if (agentName === 'AGENT_BASE' || agentName === 'AGENT_TEAMS' || agentName === 'AGENT_TIERS') continue;
  
  const content = fs.readFileSync(file, 'utf-8');
  const { frontmatter, body } = parseMarkdown(content);
  let changed = false;

  // Update Model
  const targetModel = agentToModelMap[agentName] || 'sonnet';
  if (frontmatter.recommendedModel !== targetModel) {
    frontmatter.recommendedModel = targetModel;
    changed = true;
  }

  // Inject ContextMemo if missing
  let newBody = body;
  const memoHeader = '## Minimal I/O Rule (ContextMemo)';
  if (!body.includes('ContextMemo') && !body.includes('Minimal I/O Rule')) {
    // Inject after ## Will or ## Role
    if (body.includes('## Will')) {
      newBody = body.replace('## Will', `## Will\n${memoHeader}\nBefore performing any file I/O (Read, Grep, Glob), check for [MEMO HIT] hints from hooks. If available, use the cached content from your history to save token budget.\n`);
    } else if (body.includes('## Role')) {
      newBody = body.replace('## Role', `## Role\n${memoHeader}\nBefore performing any file I/O (Read, Grep, Glob), check for [MEMO HIT] hints from hooks. If available, use the cached content from your history to save token budget.\n`);
    } else {
      newBody = body + '\n' + memoHeader + '\nBefore performing any file I/O (Read, Grep, Glob), check for [MEMO HIT] hints from hooks. If available, use the cached content from your history to save token budget.\n';
    }
    changed = true;
  }

  if (changed) {
    const newContent = stringifyFrontmatter(frontmatter) + '\n' + newBody;
    fs.writeFileSync(file, newContent);
  }
}

console.log('Synchronization complete.');
