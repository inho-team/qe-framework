/**
 * utopia-guard.mjs — enforceable safety rails for Qexecute -utopia (autonomous mode).
 *
 * Pure, side-effect-free classifiers + one evaluator. The PreToolUse hook calls
 * `evaluateUtopiaAction` ONLY while `utopia_state.enabled` is true and `allowUnsafe`
 * is not set, so these rails are completely inert in normal (non-autonomous) sessions.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROTECTED_BRANCHES = new Set(['main', 'master']);

/**
 * Current git branch by reading `.git/HEAD` (no subprocess).
 * @returns {string|null} branch name, or null when detached or not a repo.
 */
export function currentBranch(cwd) {
  try {
    const head = readFileSync(join(cwd, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : null; // detached HEAD (raw sha) → null
  } catch {
    return null;
  }
}

/** @returns {boolean} true for main/master. */
export function isProtectedBranch(branch) {
  return branch != null && PROTECTED_BRANCHES.has(branch);
}

/**
 * Classify a bash command's irreversible-risk for autonomous mode.
 * @returns {string|null} a human reason when the command is risky, else null.
 */
export function classifyBashRisk(cmd) {
  if (typeof cmd !== 'string' || !cmd) return null;

  if (/\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)/.test(cmd)) return 'git push --force';
  if (/\bgit\s+push\b/.test(cmd)) return 'git push (no auto-push in autonomous mode)';
  if (/\bgit\s+reset\s+(--hard|--merge)\b/.test(cmd)) return 'git reset --hard';
  if (/\bgit\s+clean\s+-[a-z]*f/i.test(cmd)) return 'git clean -f';
  // discard working-tree changes — optional tree-ish (e.g. `checkout HEAD -- .`) then `.`
  if (/\bgit\s+(checkout|restore)\s+(\S+\s+)?(--\s+)?\.(\s|$)/.test(cmd)) return 'git checkout/restore . (discards changes)';
  if (/\bgit\s+branch\s+-D\b/.test(cmd)) return 'git branch -D (force delete)';
  if (/\bgit\s+stash\s+(drop|clear)\b/.test(cmd)) return 'git stash drop/clear';

  // Recursive delete is destructive on its own (-f only suppresses prompts).
  if (/\brm\b/.test(cmd)) {
    const hasR = /\brm\b[^;|&]*(-[a-zA-Z]*r|--recursive)/i.test(cmd);
    if (hasR) return 'rm -r (recursive delete)';
  }
  if (/\bfind\b[^|;&]*\s-delete\b/.test(cmd)) return 'find -delete';
  if (/\btruncate\b/.test(cmd)) return 'truncate';
  if (/\bdd\b[^|;&]*\bof=/.test(cmd)) return 'dd of=';

  // Redirect-clobber: a single `>` (not `>>`, `2>`, `&>`) to a real file overwrites it.
  // /dev/{null,stdout,stderr} are allowed. (Inert outside autonomous mode.)
  const redir = cmd.match(/(?<![>&0-9])>(?!>)\s*([^\s>&|;()]+)/);
  if (redir && !/^\/dev\/(null|stdout|stderr)$/.test(redir[1])) return 'redirect-clobber (> file)';

  return null;
}

/**
 * Classify a file path as security/infra-sensitive.
 * @returns {string|null} a category when sensitive, else null.
 */
export function isSensitivePath(p) {
  if (typeof p !== 'string' || !p) return null;
  const lc = p.toLowerCase();
  if (/(^|\/)[\w.-]*\.env(\.[\w-]+)?$/.test(lc)) return '.env (secrets)'; // .env, prod.env, .env.local
  if (/(^|\/)migrations?\//.test(lc)) return 'database migration';
  if (/\.(tf|tfvars)$/.test(lc)) return 'terraform/infra';
  if (/(^|\/)dockerfile(\.[\w-]+)?$/.test(lc) || /\.dockerfile$/.test(lc)) return 'Dockerfile';
  if (/(^|\/)(secrets?|credentials?)\//.test(lc)) return 'secrets directory';
  if (/(^|\/)\.aws\/credentials$/.test(lc)) return 'aws credentials';
  if (/(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/.test(lc)) return 'ssh key';
  if (/(^|\/)\.(npmrc|pypirc|netrc)$/.test(lc)) return 'token-bearing config';
  if (/\.(pem|key|p12|pfx|keystore|crt|cer|csr)$/.test(lc)) return 'private key/cert';
  if (/(^|\/)(k8s|kube|helm|charts)\//.test(lc) && /\.ya?ml$/.test(lc)) return 'k8s/infra manifest';
  return null;
}

/**
 * Evaluate one tool call under autonomous mode. The caller is responsible for only
 * invoking this when Utopia is active and not overridden.
 * @returns {{block: boolean, reason: string|null}}
 */
export function evaluateUtopiaAction({ toolName, toolInput = {}, cwd = process.cwd() }) {
  if (toolName === 'Bash') {
    const reason = classifyBashRisk(toolInput.command || '');
    if (reason) return { block: true, reason: `${reason} is blocked in autonomous mode` };
    return { block: false, reason: null };
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    const fp = toolInput.file_path || toolInput.filePath || '';
    const sens = isSensitivePath(fp);
    if (sens) return { block: true, reason: `editing ${sens} (${fp}) is blocked in autonomous mode` };

    // Protected-branch guard: never mutate non-.qe files on main/master.
    const branch = currentBranch(cwd);
    if (isProtectedBranch(branch) && fp && !/(^|\/)\.qe\//.test(fp)) {
      return { block: true, reason: `refusing to modify ${fp} on protected branch "${branch}" — create a sandbox branch first` };
    }
  }

  return { block: false, reason: null };
}
