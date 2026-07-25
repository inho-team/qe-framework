/**
 * gc-analyzer.mjs
 * GC analysis engine for the Qgc skill.
 * Provides doc-drift detection, rule violation scanning, and dead code analysis.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from './qe-fs.mjs';
import { join, extname, basename, relative } from 'path';
import { execSync } from 'child_process';
import { checkComments, isCheckableFile } from './comment-checker.mjs';
import { detectLintConfig } from './lint-runner.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.qe']);

const SOURCE_EXTS = new Set([
  '.js', '.mjs', '.jsx', '.ts', '.tsx',
  '.py', '.go', '.rs', '.java', '.kt',
  '.rb', '.php', '.dart', '.cs', '.swift',
  '.cpp', '.c', '.h', '.hpp',
]);

/** Common framework/tech names to look for in documentation. */
const TECH_PATTERN = /\b(react|vue|angular|next\.?js|nuxt|svelte|express|fastapi|django|flask|rails|spring|nestjs|laravel|typescript|javascript|python|golang|rust|java|kotlin|docker|kubernetes|postgres|mongodb|redis|graphql|prisma|drizzle|tailwind|vite|webpack|babel|eslint|jest|vitest|playwright|codex|claude)\b/gi;

const MAX_FILES = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely execute a shell command, returning stdout string or empty string on failure.
 * @param {string} cmd
 * @param {string} cwd
 * @param {number} [timeout=5000]
 * @returns {string}
 */
function execCommandQuietly(cmd, cwd, timeout = 5000) {
  try {
    return execSync(cmd, { cwd, timeout, stdio: 'pipe' }).toString().trim();
  } catch {
    return '';
  }
}

/**
 * Recursively collect all source files under a directory, skipping skip dirs.
 * @param {string} dir - Absolute path to search
 * @param {string} cwd - Project root for relative path computation
 * @param {string[]} [results]
 * @returns {string[]} Relative paths from cwd
 */
function collectSourceFiles(dir, cwd, results = []) {
  if (results.length >= MAX_FILES) return results;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;

    const abs = join(dir, entry);

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        collectSourceFiles(abs, cwd, results);
      }
    } else if (stat.isFile() && SOURCE_EXTS.has(extname(entry).toLowerCase())) {
      results.push(relative(cwd, abs));
    }
  }

  return results;
}

/**
 * Return true when file content looks binary (contains null bytes).
 * @param {string} content
 * @returns {boolean}
 */
function isBinaryContent(content) {
  return content.includes('\0');
}

/**
 * Read file safely; return null on any error.
 * @param {string} absPath
 * @returns {string|null}
 */
function readFileOrNull(absPath) {
  try {
    const content = readFileSync(absPath, 'utf8');
    if (isBinaryContent(content)) return null;
    return content;
  } catch {
    return null;
  }
}

/**
 * Parse ISO date string from a git log line and return a Date, or null.
 * @param {string} raw
 * @returns {Date|null}
 */
function parseGitDate(raw) {
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// analyzeDocDrift
// ---------------------------------------------------------------------------

/**
 * Detect documentation vs code mismatches:
 * - Frameworks/libs mentioned in CLAUDE.md but absent from package.json deps.
 * - .qe/analysis/ files that are stale (> 7 days older than latest commit).
 *
 * @param {string} cwd - Project root directory
 * @returns {{
 *   drifts: Array<{file: string, issue: string, severity: 'warn'|'info'}>,
 *   staleAnalysis: boolean
 * }}
 */
export function analyzeDocDrift(cwd) {
  const result = { drifts: [], staleAnalysis: false };

  try {
    // 1. Read CLAUDE.md
    const claudePath = join(cwd, 'CLAUDE.md');
    let docMentions = new Set();
    if (existsSync(claudePath)) {
      const content = readFileOrNull(claudePath);
      if (content) {
        const matches = content.match(TECH_PATTERN) || [];
        for (const m of matches) {
          docMentions.add(m.toLowerCase());
        }
      }
    }

    // 2. Read package.json deps
    const pkgPath = join(cwd, 'package.json');
    let allDeps = new Set();
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const deps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        for (const key of Object.keys(deps)) {
          // Normalize: strip scope and special chars, lowercase
          allDeps.add(key.toLowerCase().replace(/^@[^/]+\//, ''));
          allDeps.add(key.toLowerCase());
        }
      } catch {
        // Malformed package.json — skip dep check
      }
    }

    // 3. Compare doc mentions vs deps
    if (docMentions.size > 0 && allDeps.size > 0) {
      for (const mention of docMentions) {
        // Skip generic language names that wouldn't be in package.json
        const genericNames = new Set(['javascript', 'typescript', 'python', 'golang', 'rust', 'java', 'kotlin', 'claude', 'codex']);
        if (genericNames.has(mention)) continue;

        // Check if mention or any dep contains the mention as substring
        const found = allDeps.has(mention) ||
          [...allDeps].some(dep => dep.includes(mention) || mention.includes(dep));

        if (!found) {
          result.drifts.push({
            file: 'CLAUDE.md',
            issue: `Framework/tool "${mention}" mentioned in docs but not found in package.json dependencies`,
            severity: 'warn',
          });
        }
      }
    }

    // 4. Check .qe/analysis/ file staleness
    const analysisDir = join(cwd, '.qe', 'analysis');
    if (existsSync(analysisDir)) {
      // Get latest commit date
      const latestCommitDateStr = execCommandQuietly('git log -1 --format=%cI', cwd);
      const latestCommitDate = parseGitDate(latestCommitDateStr);

      if (latestCommitDate) {
        let analysisEntries;
        try {
          analysisEntries = readdirSync(analysisDir);
        } catch {
          analysisEntries = [];
        }

        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        let staleCount = 0;

        for (const entry of analysisEntries) {
          const absFile = join(analysisDir, entry);
          try {
            const st = statSync(absFile);
            if (st.isFile()) {
              const ageDiff = latestCommitDate.getTime() - st.mtimeMs;
              if (ageDiff > sevenDaysMs) {
                staleCount++;
                result.drifts.push({
                  file: relative(cwd, absFile),
                  issue: `Analysis file is more than 7 days older than latest commit — may be outdated`,
                  severity: 'info',
                });
              }
            }
          } catch {
            // Skip unreadable entries
          }
        }

        if (staleCount > 0) {
          result.staleAnalysis = true;
        }
      }
    }
  } catch {
    // Never crash — return partial results
  }

  return result;
}

// ---------------------------------------------------------------------------
// analyzeRuleViolations
// ---------------------------------------------------------------------------

/**
 * Scan recently changed files for missing comment coverage and lint availability.
 *
 * @param {string} cwd - Project root directory
 * @returns {{
 *   totalMissing: number,
 *   files: Array<{path: string, missingComments: number, lintAvailable: boolean}>
 * }}
 */
export function analyzeRuleViolations(cwd) {
  const aggregate = { totalMissing: 0, files: [] };

  try {
    // 1. Get recently changed files (last 20 commits)
    const diffOutput = execCommandQuietly('git diff --name-only HEAD~20', cwd);
    if (!diffOutput) return aggregate;

    const changedFiles = diffOutput
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);

    // 2. Filter to checkable files only
    const checkable = changedFiles
      .filter(f => isCheckableFile(f))
      .slice(0, MAX_FILES);

    // 3. Analyze each file
    for (const relPath of checkable) {
      try {
        const absPath = join(cwd, relPath);
        if (!existsSync(absPath)) continue;

        const content = readFileOrNull(absPath);
        if (content === null) continue;

        // a. Check comments
        const commentResult = checkComments(absPath, content);
        const missingCount = commentResult.missing ? commentResult.missing.length : 0;

        // b. Check lint availability
        const ext = extname(relPath);
        const lintConfig = detectLintConfig(cwd, ext);
        const lintAvailable = lintConfig.configFound && lintConfig.toolAvailable;

        aggregate.totalMissing += missingCount;
        aggregate.files.push({
          path: relPath,
          missingComments: missingCount,
          lintAvailable,
        });
      } catch {
        // Skip problematic files
      }
    }
  } catch {
    // Never crash
  }

  return aggregate;
}

// ---------------------------------------------------------------------------
// analyzeDeadCode
// ---------------------------------------------------------------------------

/**
 * Find stale and potentially orphaned source files.
 *
 * @param {string} cwd - Project root directory
 * @returns {{
 *   staleFiles: Array<{path: string, lastModified: string, daysSinceModify: number}>,
 *   orphanFiles: Array<{path: string, reason: string}>
 * }}
 */
export function analyzeDeadCode(cwd) {
  const result = { staleFiles: [], orphanFiles: [] };

  try {
    // 1. Collect all source files
    const allSourceFiles = collectSourceFiles(cwd, cwd);

    // 2. Get files modified within the last 90 days via git log
    const logOutput = execCommandQuietly(
      'git log --since="90 days ago" --diff-filter=M --name-only --pretty=format:',
      cwd
    );

    const recentlyModified = new Set(
      logOutput
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean)
    );

    // Also include files added recently
    const addedOutput = execCommandQuietly(
      'git log --since="90 days ago" --diff-filter=A --name-only --pretty=format:',
      cwd
    );
    for (const f of addedOutput.split('\n').map(f => f.trim()).filter(Boolean)) {
      recentlyModified.add(f);
    }

    const now = Date.now();

    // 3. Identify stale files
    const stale = allSourceFiles.filter(f => !recentlyModified.has(f));

    for (const relPath of stale.slice(0, MAX_FILES)) {
      try {
        const absPath = join(cwd, relPath);
        const st = statSync(absPath);
        const daysSince = Math.floor((now - st.mtimeMs) / (1000 * 60 * 60 * 24));
        result.staleFiles.push({
          path: relPath,
          lastModified: new Date(st.mtimeMs).toISOString().slice(0, 10),
          daysSinceModify: daysSince,
        });
      } catch {
        // Skip
      }
    }

    // 4. Check each stale file for imports (orphan detection)
    for (const { path: relPath } of result.staleFiles) {
      try {
        const name = basename(relPath, extname(relPath));
        // Skip index files and very short names — too many false positives
        if (name === 'index' || name.length <= 2) continue;

        // Sanitize name to prevent shell injection — allow only alphanumeric, hyphen, underscore, dot
        const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '');
        if (!safeName) continue;

        const grepOut = execCommandQuietly(
          `grep -rl "${safeName}" --include="*.js" --include="*.mjs" --include="*.ts" --include="*.py" --include="*.go" . | head -5`,
          cwd,
          3000
        );

        // Filter out self-references
        const importers = grepOut
          .split('\n')
          .map(l => l.trim().replace(/^\.\//, ''))
          .filter(l => l && l !== relPath && l !== `./${relPath}`);

        if (importers.length === 0) {
          result.orphanFiles.push({
            path: relPath,
            reason: `No imports found for "${name}" in JS/TS/Python/Go source files`,
          });
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Never crash
  }

  return result;
}

// ---------------------------------------------------------------------------
// analyzeSkillBudget
// ---------------------------------------------------------------------------

/**
 * Scan skill catalog for token budget estimation.
 *
 * Adapted from steipete/agent-scripts skill-cleaner budget-audit pattern (MIT),
 * rewritten for QE with chars/4 heuristic and per-skill analysis.
 *
 * @param {string} cwd - Project root directory (must contain skills/ subdirectory)
 * @returns {{
 *   skills: Array<{name: string, path: string, chars: number, estimatedTokens: number}>,
 *   total: {chars: number, estimatedTokens: number},
 *   skipped: number,
 *   label: string
 * }}
 */
export function analyzeSkillBudget(cwd) {
  const skillsDir = join(cwd, 'skills');
  const result = {
    skills: [],
    total: { chars: 0, estimatedTokens: 0 },
    skipped: 0, // SKILL.md files that were unreadable/binary and excluded from totals
    label: '자체 산정 추정치(chars/4)',
  };

  if (!existsSync(skillsDir)) {
    return result;
  }

  let entries;
  try {
    entries = readdirSync(skillsDir).sort(); // deterministic order across platforms
  } catch {
    return result;
  }

  // Collect all skills: direct child directories with SKILL.md
  const skillDirs = [];
  for (const entry of entries) {
    const skillPath = join(skillsDir, entry);
    let stat;
    try {
      stat = statSync(skillPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    const skillMdPath = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    skillDirs.push({ name: entry, fullPath: skillPath, skillMdPath });
  }

  // Analyze each skill
  for (const { name, fullPath, skillMdPath } of skillDirs) {
    try {
      let content = readFileOrNull(skillMdPath);
      if (content === null) {
        result.skipped++; // unreadable or binary SKILL.md — excluded from totals
        continue;
      }

      // Strip BOM if present
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }

      // Count characters
      const charCount = content.length;
      // chars/4 heuristic for token estimation
      const estimatedTokens = Math.ceil(charCount / 4);

      result.skills.push({
        name,
        path: relative(cwd, skillMdPath),
        chars: charCount,
        estimatedTokens,
      });

      result.total.chars += charCount;
      result.total.estimatedTokens += estimatedTokens;
    } catch {
      result.skipped++; // stat/read failure — excluded from totals
    }
  }

  // Sort by estimatedTokens descending (largest first), name ascending as tie-breaker
  result.skills.sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.name.localeCompare(b.name));

  return result;
}

// ---------------------------------------------------------------------------
// runFullGC
// ---------------------------------------------------------------------------

/**
 * Run all three GC analyzers, write GC_REPORT.md, and append to gc-history.jsonl.
 *
 * @param {string} cwd - Project root directory
 * @returns {{
 *   drift: ReturnType<typeof analyzeDocDrift>,
 *   violations: ReturnType<typeof analyzeRuleViolations>,
 *   deadCode: ReturnType<typeof analyzeDeadCode>,
 *   budget: ReturnType<typeof analyzeSkillBudget>,
 *   reportPath: string
 * }}
 */
export function runFullGC(cwd) {
  const gcDir = join(cwd, '.qe', 'gc');

  try {
    mkdirSync(gcDir, { recursive: true });
  } catch {
    // Already exists or unwritable — proceed anyway
  }

  // 1. Run all analyzers
  const drift = analyzeDocDrift(cwd);
  const violations = analyzeRuleViolations(cwd);
  const deadCode = analyzeDeadCode(cwd);
  const budget = analyzeSkillBudget(cwd);

  const now = new Date();
  const timestamp = now.toISOString();
  const reportPath = join(gcDir, 'GC_REPORT.md');

  // 2. Generate GC_REPORT.md
  try {
    const lines = [
      `# GC Report`,
      ``,
      `**Generated:** ${timestamp}`,
      `**Project:** ${cwd}`,
      ``,
      `---`,
      ``,
      `## 1. Documentation Drift`,
      ``,
      drift.drifts.length === 0
        ? '_No drift detected._'
        : drift.drifts
            .map(d => `- **[${d.severity.toUpperCase()}]** \`${d.file}\`: ${d.issue}`)
            .join('\n'),
      ``,
      `**Stale analysis files:** ${drift.staleAnalysis ? 'Yes — run `/Qrefresh` to update.' : 'No'}`,
      ``,
      `---`,
      ``,
      `## 2. Rule Violations`,
      ``,
      `**Total missing comments:** ${violations.totalMissing}`,
      ``,
    ];

    if (violations.files.length > 0) {
      lines.push(`| File | Missing Comments | Lint Available |`);
      lines.push(`|------|-----------------|----------------|`);
      for (const f of violations.files) {
        lines.push(`| \`${f.path}\` | ${f.missingComments} | ${f.lintAvailable ? 'Yes' : 'No'} |`);
      }
    } else {
      lines.push(`_No recently changed checkable files found._`);
    }

    lines.push(``, `---`, ``);
    lines.push(`## 3. Dead Code`, ``);

    if (deadCode.staleFiles.length > 0) {
      lines.push(`### Stale Files (not modified in 90+ days)`, ``);
      lines.push(`| File | Last Modified | Days Since Modify |`);
      lines.push(`|------|--------------|-------------------|`);
      for (const f of deadCode.staleFiles) {
        lines.push(`| \`${f.path}\` | ${f.lastModified} | ${f.daysSinceModify} |`);
      }
      lines.push(``);
    } else {
      lines.push(`_No stale files detected._`, ``);
    }

    if (deadCode.orphanFiles.length > 0) {
      lines.push(`### Orphan Candidates (no detected imports)`, ``);
      for (const f of deadCode.orphanFiles) {
        lines.push(`- \`${f.path}\`: ${f.reason}`);
      }
      lines.push(``);
    } else {
      lines.push(`_No orphan files detected._`, ``);
    }

    lines.push(`---`, ``);
    lines.push(`## 4. Skill Catalog Budget`, ``);
    lines.push(`**Label: ${budget.label}**`, ``);
    lines.push(`**Caveat:** Korean-body skills may be ~2x undercounted by chars/4 due to CJK character width.`, ``);

    if (budget.skills.length > 0) {
      const topSkills = budget.skills.slice(0, 20); // table says "Top" — cap at 20
      lines.push(`### Top Skills by Estimated Tokens (top ${topSkills.length} of ${budget.skills.length})`, ``);
      lines.push(`| Skill | Chars | Estimated Tokens (${budget.label}) |`);
      lines.push(`|-------|-------|------|`);
      for (const skill of topSkills) {
        lines.push(`| \`${skill.name}\` | ${skill.chars} | ${skill.estimatedTokens} |`);
      }
      lines.push(``);
    }

    if (budget.skipped > 0) {
      lines.push(`**Skipped/unreadable SKILL.md files:** ${budget.skipped} (excluded from totals)`, ``);
    }

    if (budget.total.chars > 0) {
      lines.push(`### Catalog Total`, ``);
      lines.push(`- **Total characters:** ${budget.total.chars}`);
      lines.push(`- **Estimated tokens (${budget.label}):** ${budget.total.estimatedTokens}`);
      lines.push(``);
    }

    lines.push(`---`, ``);
    lines.push(`## Summary`, ``);
    lines.push(`| Category | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Doc drifts | ${drift.drifts.length} |`);
    lines.push(`| Missing comments | ${violations.totalMissing} |`);
    lines.push(`| Stale files | ${deadCode.staleFiles.length} |`);
    lines.push(`| Orphan candidates | ${deadCode.orphanFiles.length} |`);
    lines.push(`| Skills in catalog | ${budget.skills.length} |`);
    lines.push(`| Total catalog tokens | ${budget.total.estimatedTokens} (${budget.label}) |`);
    lines.push(``);

    writeFileSync(reportPath, lines.join('\n'), 'utf8');
  } catch {
    // Report write failure is non-fatal
  }

  // 3. Append to gc-history.jsonl
  try {
    const historyPath = join(gcDir, 'gc-history.jsonl');
    const entry = JSON.stringify({
      timestamp,
      driftCount: drift.drifts.length,
      staleAnalysis: drift.staleAnalysis,
      totalMissingComments: violations.totalMissing,
      violationFileCount: violations.files.length,
      staleFileCount: deadCode.staleFiles.length,
      orphanFileCount: deadCode.orphanFiles.length,
    });
    const existing = existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : '';
    writeFileSync(historyPath, existing + entry + '\n', 'utf8');
  } catch {
    // History write failure is non-fatal
  }

  return { drift, violations, deadCode, budget, reportPath };
}
