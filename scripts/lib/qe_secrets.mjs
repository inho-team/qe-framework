#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import os from 'os';
import { dirname, join, resolve } from 'path';
import { readJsonFile, writeJsonFile } from './json-io.mjs';

const REGISTRY_VERSION = 1;
const SUPPORTED_SCOPES = new Set(['project', 'global', 'all']);
const DEFAULT_GLOBAL_REGISTRY = join(os.homedir(), '.qe', 'secrets', 'registry.json');
const DEFAULT_DPAPI_STORE = join(os.homedir(), '.qe', 'secret-store', 'dpapi');

function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function sanitizeSecretName(value) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new Error(
      'Secret names must use 1-128 characters from: letters, numbers, dot, underscore, dash.'
    );
  }
  return value;
}

function defaultEnvName(name) {
  return name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function isCommandAvailable(command, args = ['--help']) {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return !result.error;
}

function getProjectRegistryPath(cwd) {
  return resolve(cwd, '.qe', 'secrets', 'registry.json');
}

function getRegistryPath(cwd, scope) {
  if (scope === 'project') return getProjectRegistryPath(cwd);
  if (scope === 'global') return DEFAULT_GLOBAL_REGISTRY;
  throw new Error(`Unsupported scope for registry path: ${scope}`);
}

function readRegistry(path) {
  if (!existsSync(path)) {
    return { version: REGISTRY_VERSION, secrets: [] };
  }

  const parsed = readJsonFile(path);
  return {
    version: parsed.version ?? REGISTRY_VERSION,
    secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [],
  };
}

function writeRegistry(path, registry) {
  ensureParentDir(path);
  writeJsonFile(path, {
    version: REGISTRY_VERSION,
    secrets: [...registry.secrets].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

function getProjectFingerprint(cwd) {
  return sha256(resolve(cwd)).slice(0, 12);
}

function buildStorageKey({ cwd, scope, name }) {
  return scope === 'global'
    ? `qe-framework/global/${name}`
    : `qe-framework/project/${getProjectFingerprint(cwd)}/${name}`;
}

function getWindowsPowerShellCommand() {
  return 'powershell';
}

function getBackendSupport() {
  const platform = process.platform;

  if (platform === 'darwin') {
    return {
      recommended: 'keychain',
      available: {
        keychain: isCommandAvailable('security'),
      },
    };
  }

  if (platform === 'linux') {
    return {
      recommended: 'libsecret',
      available: {
        libsecret: isCommandAvailable('secret-tool', ['lookup', 'service', 'qe-framework', 'name', 'probe']),
      },
    };
  }

  return {
    recommended: 'dpapi-file',
    available: {
      'dpapi-file': isCommandAvailable(getWindowsPowerShellCommand(), ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
    },
  };
}

export function getSecretDoctorReport() {
  const backendSupport = getBackendSupport();
  const platform = process.platform;

  const report = {
    platform,
    recommended_backend: backendSupport.recommended,
    available_backends: Object.entries(backendSupport.available)
      .filter(([, available]) => available)
      .map(([name]) => name),
    notes: [],
  };

  if (platform === 'win32') {
    report.notes.push(
      'Windows uses a DPAPI-protected user store by default. Values stay encrypted at rest but Windows does not guarantee a second password prompt for every read.'
    );
    report.notes.push(
      'Actual secret values are stored outside the project tree. Project and global registry files contain metadata only.'
    );
  } else if (platform === 'darwin') {
    report.notes.push('macOS uses Keychain via the security CLI when available.');
  } else if (platform === 'linux') {
    report.notes.push('Linux uses libsecret/secret-tool when available.');
  }

  return report;
}

function chooseBackend(requestedBackend = 'auto') {
  const support = getBackendSupport();
  if (requestedBackend !== 'auto') {
    if (!support.available[requestedBackend]) {
      throw new Error(`Backend "${requestedBackend}" is not available on this system.`);
    }
    return requestedBackend;
  }

  if (support.available[support.recommended]) {
    return support.recommended;
  }

  throw new Error(
    'No supported secret backend is available on this system. Run "node scripts/qe_secret.mjs doctor" for details.'
  );
}

function getDpapiPath(storageKey) {
  return join(DEFAULT_DPAPI_STORE, `${sha256(storageKey)}.txt`);
}

function storeWithDpapi(storageKey, value) {
  const targetPath = getDpapiPath(storageKey);
  ensureParentDir(targetPath);

  const command = [
    "$ErrorActionPreference='Stop'",
    "$value=[Environment]::GetEnvironmentVariable('QE_SECRET_VALUE','Process')",
    "if ([string]::IsNullOrEmpty($value)) { throw 'QE_SECRET_VALUE is empty.' }",
    "$secure=ConvertTo-SecureString -String $value -AsPlainText -Force",
    "$cipher=ConvertFrom-SecureString -SecureString $secure",
    "[IO.Directory]::CreateDirectory((Split-Path -Parent $env:QE_SECRET_PATH)) | Out-Null",
    "Set-Content -LiteralPath $env:QE_SECRET_PATH -Value $cipher -Encoding UTF8",
  ].join('; ');

  const result = spawnSync(getWindowsPowerShellCommand(), ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, QE_SECRET_VALUE: value, QE_SECRET_PATH: targetPath },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to persist DPAPI secret.');
  }
}

function loadWithDpapi(storageKey) {
  const targetPath = getDpapiPath(storageKey);
  if (!existsSync(targetPath)) {
    throw new Error(`Secret value store is missing for key ${storageKey}.`);
  }

  const command = [
    "$ErrorActionPreference='Stop'",
    "$cipher=(Get-Content -LiteralPath $env:QE_SECRET_PATH -Raw).Trim()",
    "$secure=ConvertTo-SecureString -String $cipher",
    "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
  ].join('; ');

  const result = spawnSync(getWindowsPowerShellCommand(), ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, QE_SECRET_PATH: targetPath },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to load DPAPI secret.');
  }

  return result.stdout.replace(/\r?\n$/, '');
}

function deleteWithDpapi(storageKey) {
  const targetPath = getDpapiPath(storageKey);
  if (!existsSync(targetPath)) return;
  rmSync(targetPath, { force: true });
}

function storeWithKeychain(storageKey, value) {
  const result = spawnSync(
    'security',
    ['add-generic-password', '-U', '-a', storageKey, '-s', 'qe-framework', '-w', value],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to write secret to macOS Keychain.');
  }
}

function loadWithKeychain(storageKey) {
  const result = spawnSync(
    'security',
    ['find-generic-password', '-a', storageKey, '-s', 'qe-framework', '-w'],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to read secret from macOS Keychain.');
  }

  return result.stdout.replace(/\r?\n$/, '');
}

function deleteWithKeychain(storageKey) {
  const result = spawnSync('security', ['delete-generic-password', '-a', storageKey, '-s', 'qe-framework'], {
    encoding: 'utf8',
  });

  if (result.status !== 0 && !/could not be found/i.test(result.stderr || '')) {
    throw new Error(result.stderr?.trim() || 'Failed to delete secret from macOS Keychain.');
  }
}

function storeWithLibsecret(storageKey, name, value) {
  const result = spawnSync(
    'secret-tool',
    ['store', '--label', `QE Framework ${name}`, 'service', 'qe-framework', 'name', storageKey],
    { input: value, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to store secret with libsecret.');
  }
}

function loadWithLibsecret(storageKey) {
  const result = spawnSync('secret-tool', ['lookup', 'service', 'qe-framework', 'name', storageKey], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to load secret with libsecret.');
  }

  return result.stdout.replace(/\r?\n$/, '');
}

function deleteWithLibsecret(storageKey) {
  const result = spawnSync('secret-tool', ['clear', 'service', 'qe-framework', 'name', storageKey], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to delete secret with libsecret.');
  }
}

function persistSecretValue({ backend, storageKey, name, value }) {
  if (backend === 'dpapi-file') return storeWithDpapi(storageKey, value);
  if (backend === 'keychain') return storeWithKeychain(storageKey, value);
  if (backend === 'libsecret') return storeWithLibsecret(storageKey, name, value);
  throw new Error(`Unsupported secret backend: ${backend}`);
}

function loadPersistedSecretValue({ backend, storageKey }) {
  if (backend === 'dpapi-file') return loadWithDpapi(storageKey);
  if (backend === 'keychain') return loadWithKeychain(storageKey);
  if (backend === 'libsecret') return loadWithLibsecret(storageKey);
  throw new Error(`Unsupported secret backend: ${backend}`);
}

function deletePersistedSecretValue({ backend, storageKey }) {
  if (backend === 'dpapi-file') return deleteWithDpapi(storageKey);
  if (backend === 'keychain') return deleteWithKeychain(storageKey);
  if (backend === 'libsecret') return deleteWithLibsecret(storageKey);
  throw new Error(`Unsupported secret backend: ${backend}`);
}

function normalizeScope(scope) {
  if (!SUPPORTED_SCOPES.has(scope)) {
    throw new Error(`Unsupported scope: ${scope}`);
  }
  return scope;
}

function sortSecrets(secrets) {
  return [...secrets].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.name.localeCompare(b.name);
  });
}

export function listSecrets({ cwd, scope = 'all' }) {
  normalizeScope(scope);
  const items = [];

  if (scope === 'project' || scope === 'all') {
    const registry = readRegistry(getRegistryPath(cwd, 'project'));
    items.push(...registry.secrets.map((entry) => ({ ...entry, scope: 'project' })));
  }

  if (scope === 'global' || scope === 'all') {
    const registry = readRegistry(getRegistryPath(cwd, 'global'));
    items.push(...registry.secrets.map((entry) => ({ ...entry, scope: 'global' })));
  }

  return sortSecrets(items);
}

function readScopeRegistry(cwd, scope) {
  const registryPath = getRegistryPath(cwd, scope);
  return { path: registryPath, registry: readRegistry(registryPath) };
}

export function setSecret({ cwd, name, envName, scope = 'project', backend = 'auto', value, note = '' }) {
  const normalizedName = sanitizeSecretName(name);
  if (!value) {
    throw new Error('Secret value is required.');
  }

  if (!['project', 'global'].includes(scope)) {
    throw new Error('Secret scope must be "project" or "global".');
  }

  const selectedBackend = chooseBackend(backend);
  const { path, registry } = readScopeRegistry(cwd, scope);
  const storageKey = buildStorageKey({ cwd, scope, name: normalizedName });
  const now = new Date().toISOString();
  const nextEnvName = envName || defaultEnvName(normalizedName);
  const existingIndex = registry.secrets.findIndex((entry) => entry.name === normalizedName);
  const existing = existingIndex >= 0 ? registry.secrets[existingIndex] : null;

  // Keep values out of project metadata. The registry only tracks where QE should look.
  persistSecretValue({
    backend: selectedBackend,
    storageKey,
    name: normalizedName,
    value,
  });

  if (
    existing &&
    (existing.backend !== selectedBackend || existing.storage_key !== storageKey)
  ) {
    deletePersistedSecretValue({
      backend: existing.backend,
      storageKey: existing.storage_key,
    });
  }

  const nextEntry = {
    name: normalizedName,
    env_name: nextEnvName,
    backend: selectedBackend,
    note,
    storage_key: storageKey,
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  if (existingIndex >= 0) {
    registry.secrets[existingIndex] = nextEntry;
  } else {
    registry.secrets.push(nextEntry);
  }

  writeRegistry(path, registry);

  return {
    name: normalizedName,
    scope,
    env_name: nextEnvName,
    backend: selectedBackend,
    registry_path: path,
    overwritten: Boolean(existing),
  };
}

function findSecretEntry(cwd, name, scope = 'project') {
  const normalizedName = sanitizeSecretName(name);
  const scopes = scope === 'all' ? ['project', 'global'] : [scope];

  for (const currentScope of scopes) {
    const { path, registry } = readScopeRegistry(cwd, currentScope);
    const entry = registry.secrets.find((candidate) => candidate.name === normalizedName);
    if (entry) {
      return { entry, scope: currentScope, registry_path: path, registry };
    }
  }

  return null;
}

export function deleteSecret({ cwd, name, scope = 'project' }) {
  if (!['project', 'global', 'all'].includes(scope)) {
    throw new Error('Delete scope must be "project", "global", or "all".');
  }

  const targets = scope === 'all' ? ['project', 'global'] : [scope];
  const deleted = [];

  for (const currentScope of targets) {
    const found = findSecretEntry(cwd, name, currentScope);
    if (!found) continue;

    deletePersistedSecretValue({
      backend: found.entry.backend,
      storageKey: found.entry.storage_key,
    });

    found.registry.secrets = found.registry.secrets.filter((entry) => entry.name !== found.entry.name);
    writeRegistry(found.registry_path, found.registry);
    deleted.push({ scope: currentScope, backend: found.entry.backend, registry_path: found.registry_path });
  }

  if (deleted.length === 0) {
    throw new Error(`Secret "${name}" was not found.`);
  }

  return deleted;
}

function resolveSecretBinding(cwd, spec) {
  const separator = spec.indexOf('=');
  if (separator <= 0 || separator === spec.length - 1) {
    throw new Error(`Invalid binding "${spec}". Use ENV_NAME=secret-name or ENV_NAME=scope:secret-name.`);
  }

  const envName = spec.slice(0, separator);
  const descriptor = spec.slice(separator + 1);
  const match = descriptor.match(/^(project|global):(.*)$/);
  const requestedScope = match ? match[1] : 'all';
  const secretName = match ? match[2] : descriptor;
  const found = findSecretEntry(cwd, secretName, requestedScope);

  if (!found) {
    throw new Error(`Secret "${secretName}" was not found for binding ${envName}.`);
  }

  return {
    envName,
    secretName,
    scope: found.scope,
    entry: found.entry,
    value: loadPersistedSecretValue({
      backend: found.entry.backend,
      storageKey: found.entry.storage_key,
    }),
  };
}

export function resolveSecretBindings({ cwd, bindings }) {
  return bindings.map((binding) => resolveSecretBinding(cwd, binding));
}

export function executeWithSecrets({ cwd, bindings, command, args = [] }) {
  if (!command) {
    throw new Error('A command is required after "--".');
  }

  const resolvedBindings = resolveSecretBindings({ cwd, bindings });
  const env = { ...process.env };

  for (const binding of resolvedBindings) {
    env[binding.envName] = binding.value;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    // Avoid going through a shell so quoting stays stable and QE does not leak values
    // through shell expansion or command echo.
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      resolvePromise({
        code: code ?? 1,
        signal: signal ?? null,
        bindings: resolvedBindings.map(({ envName, secretName, scope }) => ({ envName, secretName, scope })),
      });
    });
  });
}

export function getSecretPromptLabel({ name, scope }) {
  return `Enter secret value for ${name} (${scope})`;
}

export function readMultilineFriendlyValueFromStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')));
    process.stdin.on('error', rejectPromise);
  });
}

export function promptHiddenValue(label) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      rejectPromise(new Error('Interactive secret prompt requires a TTY. Use --stdin in non-interactive environments.'));
      return;
    }

    const stdin = process.stdin;
    const stdout = process.stdout;
    const chunks = [];

    stdout.write(`${label}: `);
    stdin.setRawMode?.(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.off('data', onData);
    };

    const onData = (buffer) => {
      const value = buffer.toString('utf8');

      if (value === '\u0003') {
        cleanup();
        stdout.write('\n');
        rejectPromise(new Error('Secret input cancelled.'));
        return;
      }

      if (value === '\r' || value === '\n') {
        cleanup();
        stdout.write('\n');
        resolvePromise(chunks.join(''));
        return;
      }

      if (value === '\u0008' || value === '\u007f') {
        chunks.pop();
        return;
      }

      chunks.push(value);
    };

    stdin.on('data', onData);
  });
}

export function saveSecretRegistryTemplate(path) {
  ensureParentDir(path);
  if (!existsSync(path)) {
    writeJsonFile(path, { version: REGISTRY_VERSION, secrets: [] });
  }
}

export function describeRegistryLocations(cwd) {
  return {
    project_registry_path: getRegistryPath(cwd, 'project'),
    global_registry_path: getRegistryPath(cwd, 'global'),
  };
}
