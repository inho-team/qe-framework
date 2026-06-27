import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TASK_DIRS = [
  '.qe/tasks/in-progress',
  '.qe/tasks/pending',
];

const CHECKLIST_DIRS = [
  '.qe/checklists/in-progress',
  '.qe/checklists/pending',
];

const TASK_PATTERN = /^TASK_REQUEST_.*\.md$/;
const CHECKLIST_PATTERN = /^VERIFY_CHECKLIST_.*\.md$/;

function newestMatchingFile(cwd, directories, pattern) {
  for (const directory of directories) {
    const absoluteDirectory = join(cwd, directory);
    if (!existsSync(absoluteDirectory)) continue;

    let candidates = [];
    try {
      candidates = readdirSync(absoluteDirectory)
        .filter((name) => pattern.test(name))
        .map((name) => {
          const relativePath = join(directory, name);
          const absolutePath = join(cwd, relativePath);
          const stats = statSync(absolutePath);
          return { relativePath, mtimeMs: stats.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      candidates = [];
    }

    if (candidates.length > 0) {
      return candidates[0].relativePath;
    }
  }

  return null;
}

export function resolveActiveArtifacts(cwd) {
  try {
    return {
      taskPath: newestMatchingFile(cwd, TASK_DIRS, TASK_PATTERN),
      checklistPath: newestMatchingFile(cwd, CHECKLIST_DIRS, CHECKLIST_PATTERN),
    };
  } catch {
    return { taskPath: null, checklistPath: null };
  }
}

export async function injectCodexContext(cwd, toolInput, stage) {
  try {
    const prompt = toolInput?.prompt || toolInput?.description || '';
    if (prompt.includes('=== TASK_REQUEST') || prompt.includes('=== VERIFY_CHECKLIST')) {
      return {
        updatedPrompt: null,
        injected: false,
        reason: 'already_present',
        artifacts: [],
        warnings: [],
      };
    }

    const { taskPath, checklistPath } = resolveActiveArtifacts(cwd);
    if (!taskPath && !checklistPath) {
      return {
        updatedPrompt: null,
        injected: false,
        reason: 'no_artifacts',
        artifacts: [],
        warnings: [],
      };
    }

    const bridgePath = join(__dirname, '..', '..', '..', 'scripts', 'lib', 'codex_bridge.mjs');
    const { buildDelegationContext } = await import(pathToFileURL(bridgePath).href);
    const { context, warnings, artifacts } = buildDelegationContext(stage, {
      taskPath,
      checklistPath,
      cwd,
    });

    if (!context) {
      return {
        updatedPrompt: null,
        injected: false,
        reason: 'empty_context',
        artifacts,
        warnings,
      };
    }

    return {
      updatedPrompt: `${prompt}\n\n${context}`,
      injected: true,
      reason: 'injected',
      artifacts,
      warnings,
    };
  } catch (err) {
    return {
      updatedPrompt: null,
      injected: false,
      reason: 'error',
      artifacts: [],
      warnings: [err?.message || 'unknown codex context injection error'],
    };
  }
}
