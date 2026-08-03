#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPackageProvenance,
  createPackageProvenanceFromArtifact,
  formatFailure,
  verifyPackageProvenance,
} from './check-package-provenance.mjs';

export const SUPPORTED_PACKAGE_PLATFORMS = Object.freeze(['darwin', 'linux', 'win32']);

export function verifyPackedInstallMatrix(provenance, platforms = SUPPORTED_PACKAGE_PLATFORMS) {
  const packagedPaths = new Set(provenance.files?.map(({ path }) => path) || []);
  const binTargets = Object.values(provenance.installContract?.bin || {}).map((path) => path.replace(/^\.\//, ''));
  const results = platforms.map((platform) => {
    const errors = [];
    if (!SUPPORTED_PACKAGE_PLATFORMS.includes(platform)) errors.push(`unsupported package platform: ${platform}`);
    if (binTargets.length === 0) errors.push('package does not declare an install entrypoint');
    for (const target of binTargets) {
      if (!packagedPaths.has(target)) errors.push(`package bin target is missing: ${target}`);
    }
    if ([...packagedPaths].some((path) => path.includes('\\'))) errors.push('package contains a non-portable path separator');
    if (!packagedPaths.has('scripts/package-lifecycle.mjs')) {
      errors.push('package lifecycle entrypoint is missing: scripts/package-lifecycle.mjs');
    }
    for (const [name, command] of [
      ['postinstall', provenance.installContract?.postinstall],
      ['preuninstall', provenance.installContract?.preuninstall],
    ]) {
      if (!command?.includes('scripts/package-lifecycle.mjs')) {
        errors.push(`${name} lifecycle is not wired to package-lifecycle.mjs`);
      }
      if (/\b(?:sh|bash|zsh|cmd|powershell)\b/i.test(command || '')) {
        errors.push(`${name} lifecycle depends on a host shell`);
      }
    }
    return { platform, ok: errors.length === 0, errors };
  });
  return {
    ok: results.every(({ ok }) => ok),
    results,
    errors: results.flatMap(({ platform, errors }) => errors.map((error) => `${platform}: ${error}`)),
  };
}

export function runPackagedInstallCli(argv = process.argv.slice(2)) {
  let packed;
  let provenance;
  let artifactPath;
  let verification = {};
  if (argv.length === 0) {
    packed = createPackageProvenance();
    provenance = packed.provenance;
    artifactPath = packed.artifactPath;
  } else if (argv.length === 2 && argv[0] === '--artifact') {
    artifactPath = resolve(argv[1]);
    provenance = createPackageProvenanceFromArtifact(artifactPath);
  } else {
    const options = {};
    for (let index = 0; index < argv.length; index += 2) {
      const name = argv[index];
      if (!['--artifact', '--provenance', '--signature', '--verify-public-key'].includes(name)
          || !argv[index + 1] || options[name.slice(2)] !== undefined) {
        throw new Error(`unknown or incomplete argument: ${name}`);
      }
      options[name.slice(2)] = argv[index + 1];
    }
    const signatureRequested = options.signature !== undefined || options['verify-public-key'] !== undefined;
    if (!options.artifact || !options.provenance
        || (signatureRequested && (!options.signature || !options['verify-public-key']))) {
      throw new Error('use no arguments, --artifact <tgz>, or --artifact <tgz> --provenance <json> [--signature <sig> --verify-public-key <pem>]');
    }
    artifactPath = resolve(options.artifact);
    provenance = JSON.parse(readFileSync(resolve(options.provenance), 'utf8'));
    if (signatureRequested) verification = {
      signature: readFileSync(resolve(options.signature), 'utf8'),
      publicKey: readFileSync(resolve(options['verify-public-key'])),
    };
  }

  try {
    const provenanceResult = verifyPackageProvenance(provenance, artifactPath, verification);
    const matrixResult = verifyPackedInstallMatrix(provenance);
    const errors = [...provenanceResult.errors, ...matrixResult.errors];
    if (errors.length > 0) throw new Error(formatFailure(errors));
    console.log(`packaged-install: PASS — ${matrixResult.results.map(({ platform }) => platform).join(', ')}; ${provenance.package.name}@${provenance.package.version}`);
  } finally {
    packed?.cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPackagedInstallCli();
  } catch (error) {
    console.error(`packaged-install: FAIL\n  - ${error.message}`);
    process.exitCode = 1;
  }
}
