import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export function collectExpiredSkillHints(cwd, cfg = {}, options = {}) {
  if (cfg.skill_expiry_hint_enabled === false) return [];
  const clock = options.clock || (() => Date.now());
  const skillsDir = join(cwd, '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];

  const hints = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    try {
      const scalars = parseScalarFrontmatter(readFileSync(skillPath, 'utf8'));
      if (!scalars.generated_by) continue;
      const collectedAt = Date.parse(scalars.collected_at || '');
      const ttlDays = Number(scalars.ttl_days);
      if (!Number.isFinite(collectedAt) || !Number.isFinite(ttlDays) || ttlDays <= 0) continue;
      const expiresAt = collectedAt + ttlDays * 24 * 60 * 60 * 1000;
      if (clock() >= expiresAt) {
        hints.push({
          name: entry.name,
          collected_at: scalars.collected_at,
          ttl_days: ttlDays,
          expires_at: new Date(expiresAt).toISOString(),
        });
      }
    } catch {
      // Fail-open: one broken local skill must not break SessionStart.
    }
  }
  return hints;
}

export function formatExpiredSkillHint(hints, commandPrefix = '/') {
  if (!hints || hints.length === 0) return '';
  const names = hints.map((hint) => hint.name).slice(0, 5).join(', ');
  const extra = hints.length > 5 ? ` +${hints.length - 5} more` : '';
  return `[QE] Local collected skills expired: ${names}${extra}. Refresh with \`${commandPrefix}Qcollect-skill\` or delete stale local skills.`;
}

function parseScalarFrontmatter(markdown) {
  const match = String(markdown || '').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error('missing frontmatter');
  const out = {};
  for (const raw of match[1].split('\n')) {
    if (/^\s/.test(raw)) continue;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (['collected_at', 'ttl_days', 'generated_by'].includes(key)) {
      out[key] = value;
    }
  }
  return out;
}
