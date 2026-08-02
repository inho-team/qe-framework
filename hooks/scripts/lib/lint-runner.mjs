#!/usr/bin/env node
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from './qe-fs.mjs';
import { execSync } from 'child_process';
import { join, extname, dirname } from 'path';
import { readUnifiedState, writeUnifiedState } from './state.mjs';

// ---------------------------------------------------------------------------
// Extension → Lint Command Mapping
// ---------------------------------------------------------------------------

const LINT_MAP = {
  '.js':   { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', config: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'] },
  '.jsx':  { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', config: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js'] },
  '.mjs':  { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', config: ['.eslintrc', 'eslint.config.js', 'eslint.config.mjs'] },
  '.ts':   { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', typeCheck: 'npx tsc --noEmit', config: ['tsconfig.json', '.eslintrc', 'eslint.config.js'] },
  '.tsx':  { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', typeCheck: 'npx tsc --noEmit', config: ['tsconfig.json'] },
  '.py':   { lint: 'ruff check {file}', fix: 'ruff check --fix {file}', typeCheck: 'mypy {file}', config: ['pyproject.toml', 'setup.cfg', '.flake8', 'ruff.toml'] },
  '.go':   { lint: 'golangci-lint run {file}', fix: 'gofmt -w {file}', config: ['.golangci.yml', '.golangci.yaml'] },
  '.rs':   { lint: 'cargo clippy', fix: 'cargo clippy --fix --allow-dirty', config: ['Cargo.toml'] },
  '.css':  { lint: 'npx stylelint {file}', fix: 'npx stylelint --fix {file}', config: ['.stylelintrc', '.stylelintrc.json', 'stylelint.config.js'] },
  '.scss': { lint: 'npx stylelint {file}', fix: 'npx stylelint --fix {file}', config: ['.stylelintrc'] },
  '.vue':  { lint: 'npx eslint {file}', fix: 'npx eslint --fix {file}', config: ['.eslintrc', 'eslint.config.js'] },
  '.rb':   { lint: 'rubocop {file}', fix: 'rubocop -a {file}', config: ['.rubocop.yml'] },
  '.php':  { lint: 'phpcs {file}', fix: 'phpcbf {file}', config: ['phpcs.xml', 'phpcs.xml.dist'] },
  '.dart': { lint: 'dart analyze {file}', fix: 'dart fix --apply', config: ['analysis_options.yaml'] },
  '.kt':   { lint: 'ktlint {file}', fix: 'ktlint -F {file}', config: ['.editorconfig'] },
  '.swift':{ lint: 'swiftlint lint {file}', fix: 'swiftlint --fix', config: ['.swiftlint.yml'] },
};

// Directories to always skip
const SKIP_DIRS = ['node_modules', '.git', 'vendor', 'dist', 'build'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace {file} placeholder in a command template.
 * @param {string} template
 * @param {string} filePath
 * @returns {string}
 */
function interpolate(template, filePath) {
  return template.replace('{file}', filePath);
}

/**
 * Extract the primary tool name from a command string (first non-flag word).
 * e.g. "npx eslint {file}" → "eslint", "ruff check {file}" → "ruff"
 * @param {string} cmd
 * @returns {string}
 */
function extractToolName(cmd) {
  const parts = cmd.trim().split(/\s+/);
  // Skip "npx" and "cargo" launchers
  if (parts[0] === 'npx' || parts[0] === 'cargo') return parts[1] || parts[0];
  return parts[0];
}

/**
 * Check if a CLI tool is on PATH.
 * @param {string} tool
 * @returns {boolean}
 */
function isToolAvailable(tool) {
  try {
    execSync(`which ${tool}`, { timeout: 2000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse lint output for rule/error identifiers.
 * Recognises patterns like:
 *   - ESLint:   "no-unused-vars", "import/no-cycle"
 *   - Ruff/flake8: "E501", "W291", "F401"
 *   - Generic:  anything that looks like an id inside parentheses or after a colon
 * @param {string} output
 * @returns {string[]}
 */
function parseErrorPatterns(output) {
  const patterns = new Set();

  // ESLint-style rule names: (rule-name) or (plugin/rule-name)
  const eslintPattern = /\(([a-z@][\w/-]+)\)/gi;
  let m;
  while ((m = eslintPattern.exec(output)) !== null) {
    patterns.add(m[1]);
  }

  // Ruff / flake8 codes: E501, W291, F401, etc.
  const codePattern = /\b([A-Z]\d{3,4})\b/g;
  while ((m = codePattern.exec(output)) !== null) {
    patterns.add(m[1]);
  }

  return [...patterns];
}

/**
 * Update unified-state.json with lint error patterns and, if a rule triggers
 * 3+ times, append it to the internal `.qe/MISTAKE.md` failure registry.
 * @param {string} cwd
 * @param {string[]} patterns
 * @param {string} tool
 * @param {string} filePath
 */
function trackErrorPatterns(cwd, patterns, tool, filePath) {
  if (!patterns.length) return;

  try {
    const state = readUnifiedState(cwd);
    if (!state.lint_error_patterns) state.lint_error_patterns = {};

    for (const rule of patterns) {
      if (!state.lint_error_patterns[rule]) {
        state.lint_error_patterns[rule] = { count: 0, tool, files: [] };
      }
      state.lint_error_patterns[rule].count += 1;
      if (!state.lint_error_patterns[rule].files.includes(filePath)) {
        state.lint_error_patterns[rule].files.push(filePath);
      }
    }

    writeUnifiedState(cwd, state);

    // Rules that hit 3+ times go to the internal failure registry.
    const mistakePath = join(cwd, '.qe', 'MISTAKE.md');
    for (const rule of patterns) {
      const entry = state.lint_error_patterns[rule];
      if (entry.count >= 3) {
        _appendMistake(mistakePath, rule, tool, entry.count, entry.files);
      }
    }
  } catch {
    // Never crash the hook
  }
}

/**
 * Append a mistake entry to .qe/MISTAKE.md (idempotent per rule).
 */
function _appendMistake(mistakePath, rule, tool, count, files) {
  try {
    const dir = dirname(mistakePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let existing = '';
    if (existsSync(mistakePath)) {
      existing = readFileSync(mistakePath, 'utf8');
    }

    // Idempotency: don't duplicate entries for the same rule
    const marker = `<!-- lint:${rule} -->`;
    if (existing.includes(marker)) {
      // Update count in-place by replacing the line
      const updated = existing.replace(
        new RegExp(`(${marker}[^\n]*\n.*count: )\\d+`, 's'),
        (_, prefix) => `${prefix}${count}`
      );
      writeFileSync(mistakePath, updated, 'utf8');
      return;
    }

    const entry = [
      `\n## Lint Rule: \`${rule}\` ${marker}`,
      `- **Tool:** ${tool}`,
      `- **Count:** ${count}`,
      `- **Files:** ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` (+${files.length - 5} more)` : ''}`,
      `- **Added:** ${new Date().toISOString().slice(0, 10)}`,
    ].join('\n');

    writeFileSync(mistakePath, existing + entry + '\n', 'utf8');
  } catch {
    // Never crash
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if filePath has a recognized extension and does not reside
 * inside a skip directory.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isLintableFile(filePath) {
  const ext = extname(filePath);
  if (!LINT_MAP[ext]) return false;

  const normalised = filePath.replace(/\\/g, '/');
  for (const dir of SKIP_DIRS) {
    if (normalised.includes(`/${dir}/`) || normalised.includes(`/${dir}`) ||
        normalised.startsWith(`${dir}/`) || normalised === dir) {
      return false;
    }
  }
  return true;
}

/**
 * Detect available lint tools for a file extension inside a project root.
 *
 * @param {string} cwd   - Project root directory
 * @param {string} ext   - File extension including dot (e.g. ".ts")
 * @returns {{
 *   lintCmd: string|null,
 *   fixCmd: string|null,
 *   typeCheckCmd: string|null,
 *   configFound: boolean,
 *   toolAvailable: boolean
 * }}
 */
export function detectLintConfig(cwd, ext) {
  const entry = LINT_MAP[ext];
  const empty = { lintCmd: null, fixCmd: null, typeCheckCmd: null, configFound: false, toolAvailable: false };

  if (!entry) return empty;

  // Check if any config file exists in cwd
  const configFound = entry.config.some(cfg => existsSync(join(cwd, cfg)));

  // Check if the primary lint tool is on PATH
  const toolName = extractToolName(entry.lint);
  const toolAvailable = isToolAvailable(toolName);

  if (!configFound || !toolAvailable) {
    return { lintCmd: null, fixCmd: null, typeCheckCmd: entry.typeCheck || null, configFound, toolAvailable };
  }

  return {
    lintCmd: entry.lint,
    fixCmd: entry.fix || null,
    typeCheckCmd: entry.typeCheck || null,
    configFound,
    toolAvailable,
  };
}

/**
 * Run lint (and optionally auto-fix) on a single file.
 *
 * @param {string} filePath                         - Absolute or relative path to the file
 * @param {string} cwd                              - Project root (used for config detection + state)
 * @param {{ autoFix?: boolean, maxRetries?: number, timeout?: number }} [options]
 * @returns {{
 *   passed: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   errors?: string[],
 *   tool?: string,
 *   attempts?: number
 * }}
 */
export function runLint(filePath, cwd, options = {}) {
  const { autoFix = true, maxRetries = 2, timeout = 3000 } = options;

  // Guard: non-lintable file
  if (!isLintableFile(filePath)) {
    return { passed: true, skipped: true, reason: 'not a lintable file' };
  }

  const ext = extname(filePath);
  const config = detectLintConfig(cwd, ext);

  if (!config.lintCmd) {
    return { passed: true, skipped: true, reason: 'no lint config' };
  }

  const tool = extractToolName(config.lintCmd);
  let attempts = 0;

  const runCmd = (cmd) => {
    const fullCmd = interpolate(cmd, filePath);
    try {
      execSync(fullCmd, { cwd, timeout, stdio: 'pipe' });
      return { ok: true, stderr: '' };
    } catch (err) {
      const stderr = (err.stderr?.toString() || '') + (err.stdout?.toString() || '');
      return { ok: false, stderr };
    }
  };

  // Attempt loop
  let lastStderr = '';
  let remainingRetries = maxRetries;

  while (remainingRetries > 0) {
    attempts += 1;

    // Run lint
    const lintResult = runCmd(config.lintCmd);
    if (lintResult.ok) {
      return { passed: true, errors: [], tool, attempts };
    }

    lastStderr = lintResult.stderr;

    if (autoFix && config.fixCmd) {
      // Attempt auto-fix (ignore result — lint re-run is the arbiter)
      try {
        const fixCmd = interpolate(config.fixCmd, filePath);
        execSync(fixCmd, { cwd, timeout, stdio: 'pipe' });
      } catch {
        // Fix tool failure is non-fatal
      }

      // Re-run lint after fix
      const recheckResult = runCmd(config.lintCmd);
      if (recheckResult.ok) {
        return { passed: true, errors: [], tool, attempts };
      }
      lastStderr = recheckResult.stderr;
    }

    remainingRetries -= 1;
  }

  // All retries exhausted
  const errorLines = lastStderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const patterns = parseErrorPatterns(lastStderr);
  trackErrorPatterns(cwd, patterns, tool, filePath);

  return { passed: false, errors: errorLines, tool, attempts };
}
