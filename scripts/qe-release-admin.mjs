#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSchemaCompatibility } from './lib/schema_compatibility.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Update every version-owned manifest without committing, tagging, or publishing. */
export function bumpVersion(version, root = ROOT) {
  if (!SEMVER.test(String(version || ''))) throw new Error(`Invalid semantic version: ${version || '<missing>'}`);

  const packagePath = join(root, 'package.json');
  const pluginPath = join(root, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
  const lockPath = join(root, 'package-lock.json');
  const schemaManifestPath = join(root, 'core', 'store', 'schema-manifest.json');
  const pkg = readJson(packagePath);
  const plugin = readJson(pluginPath);
  const marketplace = readJson(marketplacePath);
  const lock = readJson(lockPath);
  const schemaManifest = readJson(schemaManifestPath);
  const marketplacePlugin = (marketplace.plugins || []).find((entry) => entry?.name === 'qe-framework');
  if (!marketplacePlugin) throw new Error('qe-framework entry is missing from marketplace.json');
  const schemaCompatibility = findSchemaCompatibility(schemaManifest, version);
  if (!schemaCompatibility || schemaCompatibility.schema !== schemaManifest.currentSchemaVersion) {
    throw new Error(`Framework v${version} is not covered by core/store/schema-manifest.json`);
  }
  if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package-lock.json root metadata is not aligned with package.json');
  }

  pkg.version = version;
  plugin.version = version;
  marketplacePlugin.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  writeJson(packagePath, pkg);
  writeJson(pluginPath, plugin);
  writeJson(marketplacePath, marketplace);
  writeJson(lockPath, lock);
  return version;
}

export function main(args = process.argv.slice(2)) {
  const [command, version] = args;
  if (command !== 'bump' || !version) {
    throw new Error('Usage: npm run qe:release -- bump <semver>');
  }
  process.stdout.write(`Updated release manifests to v${bumpVersion(version)}. Review the diff, then use Qcommit.\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`qe-release: ${error.message}\n`);
    process.exitCode = 1;
  }
}
