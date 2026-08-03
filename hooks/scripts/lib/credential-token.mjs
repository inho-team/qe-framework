import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync } from './qe-fs.mjs';

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

/**
 * Read an OAuth token from a JSON credential file, then an optional macOS
 * Keychain service. Provider names and JSON paths are supplied by the adapter.
 */
export function readCredentialToken({
  home = process.env.HOME || '/root',
  relativeFile,
  jsonPath,
  keychainService = null,
  platform = process.platform,
} = {}) {
  if (!relativeFile || !Array.isArray(jsonPath) || jsonPath.length === 0) return null;
  try {
    const credentialPath = join(home, relativeFile);
    if (existsSync(credentialPath)) {
      const token = readPath(JSON.parse(readFileSync(credentialPath, 'utf8')), jsonPath);
      if (typeof token === 'string' && token) return token;
    }
  } catch {
    // Fall through to the platform credential store.
  }

  if (platform !== 'darwin' || !keychainService) return null;
  try {
    const output = execFileSync(
      'security',
      ['find-generic-password', '-s', keychainService, '-w'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const token = readPath(JSON.parse(output), jsonPath);
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}
