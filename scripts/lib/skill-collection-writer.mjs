import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  computeSkillContentHash,
  parseSkillFrontmatter,
} from './skill-frontmatter.mjs';
import { validateCollectedSkillFrontmatter } from './local-skill-collector.mjs';

export function writeCollectedSkill(options) {
  const {
    cwd,
    name,
    body,
    source,
    verification,
    ttlDays,
    collectedAt = new Date().toISOString(),
    overwriteUserEdits = false,
    clock = () => Date.now(),
  } = options || {};

  if (!cwd) throw new Error('cwd is required');
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('valid skill name is required');
  if (typeof body !== 'string' || body.trim() === '') {
    throw new Error('collection body is required; existing skill was not modified');
  }

  const commandReview = classifySkillCommands(body);
  if (!commandReview.ok) {
    throw new Error(`blocked unsafe command content: ${commandReview.blocked.join('; ')}`);
  }

  const targetPath = join(cwd, '.claude', 'skills', name, 'SKILL.md');
  const finalBody = appendCommandRiskAnnotations(body, commandReview.allowed);
  const expiresAt = new Date(Date.parse(collectedAt) + Number(ttlDays) * 24 * 60 * 60 * 1000).toISOString();
  const contentHash = computeSkillContentHash(finalBody);
  const metadata = {
    source,
    collected_at: collectedAt,
    ttl_days: Number(ttlDays),
    expires_at: expiresAt,
    generated_by: 'Qcollect-skill',
    content_hash: contentHash,
    verification,
  };
  const validation = validateCollectedSkillFrontmatter(metadata);
  if (!validation.ok) {
    throw new Error(`invalid collected skill frontmatter: ${validation.errors.join('; ')}`);
  }

  let backupPath = null;
  if (existsSync(targetPath)) {
    const existing = readFileSync(targetPath, 'utf8');
    const parsed = parseSkillFrontmatter(existing);
    if (!parsed.ok || !parsed.metadata.generated_by) {
      throw new Error(`refusing to overwrite manual skill ${targetPath}`);
    }
    const existingHash = computeSkillContentHash(existing);
    if (parsed.metadata.content_hash !== existingHash) {
      if (!overwriteUserEdits) {
        throw new Error(
          `refusing to overwrite user edits in ${targetPath}; rerun with --overwrite-user-edits to back up the current file to a timestamped .bak before replacement`
        );
      }
      backupPath = `${targetPath}.${formatBackupTimestamp(clock())}.bak`;
    }
  }

  const markdown = `${serializeFrontmatter(metadata)}\n${finalBody.replace(/^\n+/, '')}`;
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  if (backupPath) {
    copyFileSync(targetPath, backupPath);
  }
  const tmpPath = join(dir, `.SKILL.md.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmpPath, markdown, 'utf8');
  renameSync(tmpPath, targetPath);

  return { targetPath, backupPath, contentHash, commandReview };
}

export function classifySkillCommands(markdown) {
  const blocked = [];
  const allowed = [];
  const commands = extractShellCommands(markdown);
  for (const command of commands) {
    const normalized = command.text.trim();
    if (!normalized) continue;
    if (/\bcurl\b[\s\S]*\|\s*(?:sh|bash)\b/i.test(normalized) || /\bwget\b[\s\S]*\|\s*(?:sh|bash)\b/i.test(normalized)) {
      blocked.push(`network pipe: ${oneLine(normalized)}`);
      continue;
    }
    if (/\b(?:npm|pnpm|yarn|pip|pipx|brew|apt|apt-get|dnf|yum|cargo|go)\s+(?:install|add|get)\b/i.test(normalized)) {
      blocked.push(`install command: ${oneLine(normalized)}`);
      continue;
    }
    if (/\b(?:rm\s+-rf|git\s+clean|del\s+\/|Remove-Item\b|rmdir\b)/i.test(normalized)) {
      blocked.push(`delete command: ${oneLine(normalized)}`);
      continue;
    }
    if (/\b(?:api[_-]?key|token|secret|password|credential|authorization:|bearer\s+[A-Za-z0-9._-]+)/i.test(normalized)) {
      blocked.push(`credential command: ${oneLine(normalized)}`);
      continue;
    }
    allowed.push({
      command: normalized,
      source: command.source,
      risk: riskForCommand(normalized),
    });
  }
  return { ok: blocked.length === 0, blocked, allowed };
}

export function assertGitignoreAllowsLocalSkills(cwd, options = {}) {
  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return { ok: true, skipped: true, reason: 'not a git repository' };
  }
  const gitignorePath = join(cwd, '.gitignore');
  const text = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const ignored = text.split(/\r?\n/).some((line) => line.trim() === '.claude/skills/');
  if (ignored) return { ok: true, skipped: false };
  const message = '.claude/skills/ must be listed in .gitignore before collecting local skills';
  if (options.throwOnError) throw new Error(message);
  return { ok: false, skipped: false, reason: message };
}

function extractShellCommands(markdown) {
  const commands = [];
  const fenceRe = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(markdown))) {
    const lang = (match[1] || '').toLowerCase();
    if (['bash', 'sh', 'shell', 'zsh', 'console', 'terminal'].includes(lang)) {
      for (const line of match[2].split(/\r?\n/)) {
        const text = line.replace(/^\s*\$\s*/, '').trim();
        if (text && !text.startsWith('#')) {
          commands.push({ text, source: `fenced ${lang || 'shell'} block` });
        }
      }
    }
  }
  return commands;
}

function appendCommandRiskAnnotations(body, allowedCommands) {
  if (allowedCommands.length === 0) return body.endsWith('\n') ? body : `${body}\n`;
  const rows = allowedCommands
    .map((entry) => `| \`${entry.command.replace(/\|/g, '\\|')}\` | ${entry.source} | ${entry.risk} |`)
    .join('\n');
  const section = [
    '',
    '## Command Review',
    '',
    '| Command | Source | Risk |',
    '|---|---|---|',
    rows,
    '',
  ].join('\n');
  return `${body.replace(/\s+$/, '')}\n${section}`;
}

function serializeFrontmatter(metadata) {
  const lines = [
    '---',
    `source: ${quoteScalar(metadata.source)}`,
    `collected_at: ${metadata.collected_at}`,
    `ttl_days: ${metadata.ttl_days}`,
    `expires_at: ${metadata.expires_at}`,
    `generated_by: ${metadata.generated_by}`,
    `content_hash: ${metadata.content_hash}`,
    'verification:',
    `  devils_advocate_ran: ${metadata.verification.devils_advocate_ran ? 'true' : 'false'}`,
    '  sources:',
    ...metadata.verification.sources.flatMap((source) => [
      `    - url: ${quoteScalar(source.url)}`,
      `      published_at: ${quoteScalar(source.published_at)}`,
    ]),
    ...(metadata.verification.conflicting_claims.length === 0
      ? ['  conflicting_claims: []']
      : ['  conflicting_claims:', ...metadata.verification.conflicting_claims.map((claim) => `    - ${quoteScalar(claim)}`)]),
    '---',
  ];
  return lines.join('\n');
}

function quoteScalar(value) {
  const str = String(value);
  if (/^[A-Za-z0-9_.:/@ -]+$/.test(str) && !str.includes('#')) return str;
  return JSON.stringify(str);
}

function riskForCommand(command) {
  if (/\b(?:test|node --test|npm test|npm run test|pytest|go test|cargo test)\b/i.test(command)) {
    return 'low: verification command';
  }
  if (/\b(?:git status|git diff|rg|grep|ls|find|cat|sed -n)\b/i.test(command)) {
    return 'low: read-only inspection command';
  }
  return 'medium: review before running in a project shell';
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').slice(0, 180);
}

function formatBackupTimestamp(ms) {
  return new Date(ms).toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
