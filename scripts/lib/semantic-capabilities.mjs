/** Managed, read-only discovery and health policy for optional semantic tools. */

import { accessSync, constants } from 'node:fs';
import { delimiter, extname, join } from 'node:path';

export const TEXT_FALLBACK = Object.freeze({
  id: 'text-search',
  kind: 'text',
  status: 'fallback',
  reason: 'No usable semantic capability is available; continue with bounded text search.',
});

export const DEFAULT_SEMANTIC_CANDIDATES = Object.freeze([
  { id: 'typescript-lsp', kind: 'lsp', commands: ['typescript-language-server'] },
  { id: 'python-lsp', kind: 'lsp', commands: ['pyright-langserver', 'pylsp'] },
  { id: 'go-lsp', kind: 'lsp', commands: ['gopls'] },
  { id: 'rust-lsp', kind: 'lsp', commands: ['rust-analyzer'] },
  { id: 'clang-lsp', kind: 'lsp', commands: ['clangd'] },
  { id: 'ast-grep', kind: 'ast', commands: ['ast-grep', 'sg'] },
]);

function normalizeCandidate(raw) {
  const commands = Array.isArray(raw?.commands)
    ? raw.commands.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
    : [];
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || !['lsp', 'ast'].includes(raw.kind) || commands.length === 0) {
    throw new TypeError('semantic candidate requires id, kind=lsp|ast, and commands');
  }
  return { id: raw.id.trim(), kind: raw.kind, commands };
}

/** Resolve an executable from PATH without spawning a shell or changing state. */
export function resolveExecutable(command, env = process.env, platform = process.platform) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const pathEntries = String(env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const hasExtension = Boolean(extname(command));
  for (const directory of pathEntries) {
    for (const extension of hasExtension ? [''] : extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Continue through the bounded PATH candidate list.
      }
    }
  }
  return null;
}

function initialCapability(candidate, executable) {
  if (!executable) {
    return {
      id: candidate.id,
      kind: candidate.kind,
      command: null,
      executable: null,
      availability: 'unavailable',
      health: { state: 'unknown', consecutiveFailures: 0, reason: `not found: ${candidate.commands.join(' | ')}` },
      usable: false,
    };
  }
  return {
    id: candidate.id,
    kind: candidate.kind,
    command: executable.command,
    executable: executable.path,
    availability: 'available',
    health: { state: 'unknown', consecutiveFailures: 0, reason: 'executable discovered; runtime health not observed' },
    usable: true,
  };
}

/** Discover configured LSP/AST executables and expose one common state model. */
export function discoverSemanticCapabilities({
  candidates = DEFAULT_SEMANTIC_CANDIDATES,
  env = process.env,
  platform = process.platform,
  resolver = resolveExecutable,
} = {}) {
  const capabilities = candidates.map(normalizeCandidate).map((candidate) => {
    let executable = null;
    for (const command of candidate.commands) {
      const path = resolver(command, env, platform);
      if (path) {
        executable = { command, path };
        break;
      }
    }
    return initialCapability(candidate, executable);
  });
  const usable = capabilities.filter((item) => item.usable).length;
  return {
    schema: 1,
    capabilities,
    summary: { total: capabilities.length, available: usable, unavailable: capabilities.length - usable },
    fallback: usable === 0 ? { ...TEXT_FALLBACK } : null,
  };
}

/** Apply bounded runtime observations to a discovered capability. */
export function transitionSemanticHealth(capability, outcome) {
  if (!capability || capability.availability !== 'available') return { ...capability, usable: false };
  const success = outcome === true || outcome?.ok === true;
  const previousFailures = Number(capability.health?.consecutiveFailures || 0);
  const consecutiveFailures = success ? 0 : previousFailures + 1;
  const state = success ? 'healthy' : consecutiveFailures >= 2 ? 'unhealthy' : 'degraded';
  const reason = typeof outcome?.reason === 'string' && outcome.reason.trim()
    ? outcome.reason.trim()
    : success ? 'runtime operation succeeded' : 'runtime operation failed';
  return {
    ...capability,
    health: { state, consecutiveFailures, reason },
    usable: state !== 'unhealthy',
  };
}

/** Choose a usable capability, or return the explicit text fallback. */
export function selectSemanticCapability(report, { kind = null } = {}) {
  const capabilities = Array.isArray(report?.capabilities) ? report.capabilities : [];
  const selected = capabilities.find((item) => item?.usable && (!kind || item.kind === kind));
  if (selected) return { selected, fallback: null };
  const suffix = kind ? ` for ${kind}` : '';
  return {
    selected: null,
    fallback: { ...TEXT_FALLBACK, reason: `No usable semantic capability${suffix} is available; continue with bounded text search.` },
  };
}

