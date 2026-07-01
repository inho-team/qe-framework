#!/usr/bin/env node
/**
 * Static guard for unmarked Claude-only assumptions in shared lifecycle/runtime
 * surfaces. This is intentionally dependency-free so `check-all` can run it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DEFAULT_TARGETS = [
  'core/LIFECYCLE_ADAPTER.md',
  'docs/HOOKS.md',
  'docs/SYSTEM_OVERVIEW.md',
  'hooks/scripts/session-start.mjs',
  'hooks/scripts/pre-tool-use.mjs',
  'hooks/scripts/notification.mjs',
  'hooks/scripts/codex/lifecycle-codex.mjs',
];

const DOC_TARGETS = [
  'README.md',
  'docs/INSTALL.md',
  'docs/USAGE_GUIDE.md',
  'docs/SYSTEM_OVERVIEW.md',
  'docs/HOOKS.md',
  'docs/DOCUMENTATION_MAP.md',
  'core/INTERACTION_ADAPTER.md',
  'core/LIFECYCLE_ADAPTER.md',
];

const PATTERNS = [
  { name: 'bare-slash-command', regex: /\/[QM][A-Za-z0-9_-]+\b(?!\.md)/g, fix: 'Use {adapter.commandPrefix}, active-client rendering, or paired Claude/Codex examples.' },
  { name: 'AskUserQuestion', regex: /\bAskUserQuestion\b/g, fix: 'Use interaction adapter in generic text; keep AskUserQuestion under Claude adapter only.' },
  { name: 'Agent tool', regex: /\bAgent tool\b/g, fix: 'Use agent adapter in generic text; keep Agent tool under Claude adapter only.' },
  { name: 'Agent Teams', regex: /\bAgent Teams\b/g, fix: 'Label Agent Teams as a Claude adapter capability.' },
  { name: 'CLAUDE.md', regex: /\bCLAUDE\.md\b/g, fix: 'Use project instruction artifact unless the file is specifically Claude adapter behavior.' },
  { name: '.claude path', regex: /(^|[^A-Za-z0-9_-])\.claude(\/|[A-Za-z0-9_.-]*)/g, fix: 'Use provider adapter path or label the Claude adapter path.' },
];

const ADAPTER_LABELS = [
  'Claude',
  'Codex',
  'Adapter',
  'Compatibility',
  'provider-bridge',
  'distribution-metadata',
  'localized-pending',
  'degraded-inline',
  'StatusProjected',
  'Codex Adapter',
  'Claude Adapter',
];

/** Parse CLI arguments for the client-neutrality checker. */
function parseArgs(argv) {
  const args = { root: process.cwd(), files: [], mode: 'runtime' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) args.root = argv[++i];
    else if (arg === '--docs') args.mode = 'docs';
    else if (arg === '--files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.files.push(argv[++i]);
    } else if (!arg.startsWith('--')) {
      args.files.push(arg);
    }
  }
  return args;
}

/** Resolve the file targets for runtime, docs, or explicit file mode. */
export function resolveTargets({ mode = 'runtime', files = [] } = {}) {
  if (files.length > 0) return files;
  if (mode === 'docs') return DOC_TARGETS;
  return DEFAULT_TARGETS;
}

/** Recursively list files under a target path, skipping common generated dirs. */
function listFiles(root, relPath) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'coverage' || entry === 'dist') continue;
    out.push(...listFiles(root, join(relPath, entry)));
  }
  return out;
}

/** Return the nearest markdown heading above a line index. */
function nearestHeading(lines, index) {
  for (let i = index; i >= 0; i--) {
    if (/^\s{0,3}#{1,6}\s+/.test(lines[i])) return lines[i];
  }
  return '';
}

/** Check whether a line or heading is explicitly scoped to a client adapter. */
function hasAdapterLabel(text) {
  return ADAPTER_LABELS.some((label) => {
    if (label === 'Claude' || label === 'Codex') {
      return new RegExp(`\\b${label}\\b`).test(text);
    }
    return text.toLowerCase().includes(label.toLowerCase());
  });
}

/** Return true when one line contains paired Claude slash and Codex dollar commands. */
function isPairedCommandLine(line) {
  return /\/[QM][A-Za-z0-9_-]+/.test(line) && /\$[QM][A-Za-z0-9_-]+/.test(line);
}

/** Extract QE command names using the requested prefix. */
function matchingCommands(text, prefix) {
  return [...text.matchAll(new RegExp(`\\${prefix}([QM][A-Za-z0-9_-]+)\\b`, 'g'))].map((match) => match[1]);
}

/** Allow adjacent-line paired command examples, such as Claude then Codex rows. */
function isPairedCommandContext(line, prevLine, nextLine) {
  const slashCommands = matchingCommands(line, '/');
  if (slashCommands.length === 0) return false;
  const adjacentDollarCommands = new Set([
    ...matchingCommands(prevLine, '$'),
    ...matchingCommands(nextLine, '$'),
  ]);
  return slashCommands.some((command) => adjacentDollarCommands.has(command));
}

/** Decide whether a matched line is allowed by adapter-neutrality exceptions. */
function isAllowedLine({ line, heading, relPath, prevLine = '', nextLine = '' }) {
  if (line.includes('{adapter.commandPrefix}')) return true;
  if (line.includes('QE_COMMAND_PREFIX') || line.includes('COMMAND_PREFIX')) return true;
  if (line.includes('CLAUDE.md') && line.includes('AGENTS.md')) return true;
  if (line.includes("'CLAUDE.md'") && nextLine.includes("'AGENTS.md'")) return true;
  if (line.includes("'AGENTS.md'") && prevLine.includes("'CLAUDE.md'")) return true;
  if (isPairedCommandLine(line)) return true;
  if (isPairedCommandContext(line, prevLine, nextLine)) return true;
  if (hasAdapterLabel(line) || hasAdapterLabel(heading) || hasAdapterLabel(prevLine)) return true;
  if (relPath === 'docs/INSTALL.md' && line.includes('~/.claude')) return true;
  if (relPath === 'docs/INSTALL.md' && line.includes('.claude-plugin')) return true;
  if (relPath.includes('/codex/')) return true;
  if (/^\s*\/\//.test(line)) return true;
  if (/toolName\s*={2,3}\s*['"]AskUserQuestion['"]/.test(line)) return true;
  if (/^\s*\/\//.test(line) && /(Detection|Guard|tool calls|Agent tool calls|Agent Teams)/.test(line)) return true;
  return false;
}

/** Scan target files and return neutrality findings. */
export function scanFiles(root, files) {
  const rootAbs = resolve(root);
  const fileList = files.flatMap((file) => listFiles(rootAbs, file));
  const findings = [];

  for (const file of fileList) {
    const relPath = relative(rootAbs, file).replaceAll('\\', '/');
    if (/\.(html|png|jpg|jpeg|gif|svg)$/.test(relPath)) continue;
    if (/docs\/README\.(ko|ja|zh)\.md$/.test(relPath)) continue;
    if (/docs\/archive\//.test(relPath)) continue;

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const heading = nearestHeading(lines, index);
      const prevLine = lines[index - 1] || '';
      const nextLine = lines[index + 1] || '';
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        if (!pattern.regex.test(line)) continue;
        if (isAllowedLine({ line, heading, relPath, prevLine, nextLine })) continue;
        findings.push({
          file: relPath,
          line: index + 1,
          pattern: pattern.name,
          text: line.trim(),
          fix: pattern.fix,
        });
      }
    });
  }

  return findings;
}

/** CLI entry point for the checker. */
function main() {
  const args = parseArgs(process.argv);
  const files = resolveTargets(args);
  const findings = scanFiles(args.root, files);

  if (findings.length === 0) {
    console.log(`check-client-neutrality: PASS (${args.mode}, ${files.length} target(s))`);
    return;
  }

  console.error(`check-client-neutrality: FAIL (${args.mode}, ${findings.length} finding(s))`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.pattern}] ${finding.text}`);
    console.error(`  fix: ${finding.fix}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
