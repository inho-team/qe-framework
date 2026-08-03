#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as createSignature,
  verify as verifySignature,
} from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..');

export const REQUIRED_PACKAGE_ASSETS = Object.freeze([
  '.claude-plugin/marketplace.json',
  '.claude-plugin/plugin.json',
  'LICENSE',
  'agents/Ecode-test-engineer.md',
  'bin/qe-framework-install.mjs',
  'bin/qe-framework-uninstall.mjs',
  'hooks/hooks.json',
  'package.json',
  'scripts/check-package-provenance.mjs',
  'scripts/check-packaged-install.mjs',
  'scripts/lib/client_installers.mjs',
  'skills/Qplan/SKILL.md',
]);

function hash(algorithm, value, encoding = 'hex') {
  return createHash(algorithm).update(value).digest(encoding);
}

export function digestFile(filePath) {
  return hash('sha256', readFileSync(filePath));
}

export function digestManifest(provenance) {
  return hash('sha256', JSON.stringify({
    schema: provenance.schema,
    package: provenance.package,
    installContract: provenance.installContract,
    files: provenance.files,
  }));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function createProvenanceSigningPayload(provenance) {
  return Buffer.from(`qe-package-provenance-signature-v1\n${canonicalJson(provenance)}\n`, 'utf8');
}

function assertEd25519Key(key, kind) {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${kind} key must be Ed25519`);
  }
  return key;
}

export function signPackageProvenance(provenance, privateKey) {
  const parsed = privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey);
  const key = assertEd25519Key(parsed, 'private');
  return createSignature(null, createProvenanceSigningPayload(provenance), key).toString('base64');
}

export function verifyPackageProvenanceSignature(provenance, signature, publicKey) {
  const errors = [];
  try {
    const encoded = Buffer.isBuffer(signature) ? signature.toString('utf8').trim() : String(signature).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('signature is not canonical base64');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length !== 64 || decoded.toString('base64') !== encoded) {
      throw new Error('signature is not a canonical 64-byte Ed25519 signature');
    }
    const parsed = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
    const key = assertEd25519Key(parsed, 'public');
    if (!verifySignature(null, createProvenanceSigningPayload(provenance), key, decoded)) {
      errors.push('provenance Ed25519 signature mismatch');
    }
  } catch (error) {
    errors.push(`provenance signature verification failed: ${error.message}`);
  }
  return { ok: errors.length === 0, errors };
}

function parseOctal(field, label) {
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`invalid tar ${label}: ${JSON.stringify(text)}`);
  return Number.parseInt(text, 8);
}

function parsePax(data) {
  const attributes = {};
  let offset = 0;
  while (offset < data.length) {
    const separator = data.indexOf(0x20, offset);
    if (separator < 0) throw new Error('invalid PAX record length');
    const length = Number.parseInt(data.toString('ascii', offset, separator), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) {
      throw new Error('invalid PAX record boundary');
    }
    const record = data.toString('utf8', separator + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) attributes[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return attributes;
}

function validatePackedPath(path) {
  if (!path || path.includes('\\') || path.startsWith('/')) {
    throw new Error(`unsafe packed path: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error(`unsafe packed path: ${JSON.stringify(path)}`);
  }
  if (segments[0] !== 'package' || segments.length < 2) {
    throw new Error(`packed path must be rooted under package/: ${path}`);
  }
  return segments.slice(1).join('/');
}

export function readTarGzEntries(artifactPath) {
  let tar;
  try {
    tar = gunzipSync(readFileSync(artifactPath));
  } catch (error) {
    throw new Error(`artifact is not a readable gzip archive: ${error.message}`);
  }

  const entries = [];
  let offset = 0;
  let pendingPax = {};
  let globalPax = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const storedChecksum = parseOctal(header.subarray(148, 156), 'checksum');
    let calculatedChecksum = 0;
    for (let index = 0; index < 512; index += 1) {
      calculatedChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (storedChecksum !== calculatedChecksum) throw new Error('tar header checksum mismatch');

    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const headerPath = prefix ? `${prefix}/${rawName}` : rawName;
    const size = parseOctal(header.subarray(124, 136), 'size');
    const mode = parseOctal(header.subarray(100, 108), 'mode');
    const type = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`truncated tar entry: ${headerPath}`);
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x' || type === 'g') {
      const parsed = parsePax(data);
      if (type === 'g') globalPax = { ...globalPax, ...parsed };
      else pendingPax = parsed;
      continue;
    }

    const attributes = { ...globalPax, ...pendingPax };
    pendingPax = {};
    const packedPath = attributes.path || headerPath;
    if (type === '5') {
      validatePackedPath(packedPath.replace(/\/$/, ''));
      continue;
    }
    if (type !== '0' && type !== '\0') {
      throw new Error(`unsupported tar entry type ${JSON.stringify(type)}: ${packedPath}`);
    }

    entries.push({
      path: validatePackedPath(packedPath),
      size,
      mode,
      sha256: hash('sha256', data),
      data: Buffer.from(data),
    });
  }

  const paths = entries.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) throw new Error('archive contains duplicate file paths');
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function createPackageProvenanceFromArtifact(artifactPath) {
  const artifact = readFileSync(artifactPath);
  const entries = readTarGzEntries(artifactPath);
  const packageEntry = entries.find(({ path }) => path === 'package.json');
  if (!packageEntry) throw new Error('packed package.json is missing');

  let packageJson;
  try {
    packageJson = JSON.parse(packageEntry.data.toString('utf8'));
  } catch (error) {
    throw new Error(`packed package.json is invalid: ${error.message}`);
  }

  const provenance = {
    schema: 1,
    package: { name: packageJson.name, version: packageJson.version },
    artifact: {
      filename: basename(artifactPath),
      size: artifact.length,
      sha256: hash('sha256', artifact),
      integrity: `sha512-${hash('sha512', artifact, 'base64')}`,
    },
    installContract: {
      bin: Object.fromEntries(
        Object.entries(packageJson.bin || {}).sort(([left], [right]) => left.localeCompare(right)),
      ),
      postinstall: packageJson.scripts?.postinstall || null,
      preuninstall: packageJson.scripts?.preuninstall || null,
    },
    files: entries.map(({ path, size, mode, sha256 }) => ({ path, size, mode, sha256 })),
  };
  provenance.manifestSha256 = digestManifest(provenance);
  return provenance;
}

export function createPackageProvenance(repositoryRoot = REPOSITORY_ROOT) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qe-package-provenance-'));
  try {
    const packed = spawnSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryDirectory],
      { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    );
    if (packed.status !== 0 || packed.error) {
      throw new Error(`npm pack failed: ${packed.error?.message || packed.stderr.trim() || `exit ${packed.status}`}`);
    }
    let metadata;
    try {
      const parsed = JSON.parse(packed.stdout);
      metadata = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
      throw new Error(`npm pack did not return JSON: ${error.message}`);
    }
    if (!metadata?.filename) throw new Error('npm pack metadata is missing filename');
    const artifactPath = join(temporaryDirectory, metadata.filename);
    return {
      provenance: createPackageProvenanceFromArtifact(artifactPath),
      artifactPath,
      cleanup() { rmSync(temporaryDirectory, { recursive: true, force: true }); },
    };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyPackageProvenance(
  provenance,
  artifactPath,
  {
    requiredAssets = REQUIRED_PACKAGE_ASSETS,
    signature,
    publicKey,
  } = {},
) {
  const errors = [];
  const hasSignature = signature !== undefined;
  const hasPublicKey = publicKey !== undefined;
  if (hasSignature !== hasPublicKey) {
    errors.push('detached signature and trusted public key must be supplied together');
  } else if (hasSignature) {
    errors.push(...verifyPackageProvenanceSignature(provenance, signature, publicKey).errors);
  }
  try {
    const artifact = readFileSync(artifactPath);
    if (artifact.length !== provenance.artifact?.size) errors.push('artifact size mismatch');
    if (hash('sha256', artifact) !== provenance.artifact?.sha256) errors.push('artifact SHA-256 digest mismatch');
    if (`sha512-${hash('sha512', artifact, 'base64')}` !== provenance.artifact?.integrity) {
      errors.push('artifact SHA-512 integrity mismatch');
    }
  } catch (error) {
    return { ok: false, errors: [`artifact is unreadable: ${error.message}`] };
  }

  let actual;
  try {
    actual = createPackageProvenanceFromArtifact(artifactPath);
  } catch (error) {
    errors.push(`artifact validation failed: ${error.message}`);
    return { ok: false, errors };
  }

  if (provenance.schema !== 1) errors.push(`unsupported provenance schema: ${provenance.schema}`);
  if (!provenance.package?.name || !provenance.package?.version) errors.push('package identity is incomplete');
  const packagedPaths = new Set(actual.files.map(({ path }) => path));
  for (const asset of requiredAssets) {
    if (!packagedPaths.has(asset)) errors.push(`required package asset is missing: ${asset}`);
  }
  if (provenance.manifestSha256 !== digestManifest(provenance)) {
    errors.push('package manifest digest mismatch');
  }
  if (actual.manifestSha256 !== provenance.manifestSha256) errors.push('packed file manifest mismatch');
  if (actual.package.name !== provenance.package?.name || actual.package.version !== provenance.package?.version) {
    errors.push('packed package identity mismatch');
  }
  return { ok: errors.length === 0, errors };
}

export function formatFailure(errors) {
  return errors.map((error) => `  - ${error}`).join('\n');
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (![
      '--artifact', '--out', '--provenance', '--sign-private-key', '--signature', '--verify-public-key',
    ].includes(name) || !argv[index + 1] || options[name.slice(2)] !== undefined) {
      throw new Error(`unknown or incomplete argument: ${name}`);
    }
    options[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

export function runProvenanceCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const signingRequested = options['sign-private-key'] !== undefined || options.signature !== undefined;
  const verificationRequested = options['verify-public-key'] !== undefined || options.signature !== undefined;
  if (options.artifact && options.out && !options.provenance && !options['verify-public-key']) {
    if (signingRequested && (!options['sign-private-key'] || !options.signature)) {
      throw new Error('--sign-private-key and --signature must be supplied together');
    }
    const provenance = createPackageProvenanceFromArtifact(resolve(options.artifact));
    const result = verifyPackageProvenance(provenance, resolve(options.artifact));
    if (!result.ok) throw new Error(formatFailure(result.errors));
    const outputPath = resolve(options.out);
    const signaturePath = options.signature && resolve(options.signature);
    if (existsSync(outputPath)) throw new Error(`output already exists: ${outputPath}`);
    if (signaturePath && existsSync(signaturePath)) throw new Error(`output already exists: ${signaturePath}`);
    const signature = signaturePath
      ? signPackageProvenance(provenance, readFileSync(resolve(options['sign-private-key'])))
      : null;
    writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
    if (signaturePath) writeFileSync(signaturePath, `${signature}\n`, { flag: 'wx', mode: 0o644 });
    console.log(`package-provenance: WROTE ${outputPath}${signaturePath ? ` + ${signaturePath}` : ''} — ${provenance.artifact.sha256}`);
    return;
  }
  if (options.artifact && options.provenance && !options.out && !options['sign-private-key']) {
    if (verificationRequested && (!options.signature || !options['verify-public-key'])) {
      throw new Error('--signature and --verify-public-key must be supplied together');
    }
    const provenance = JSON.parse(readFileSync(resolve(options.provenance), 'utf8'));
    const verification = options.signature ? {
      signature: readFileSync(resolve(options.signature), 'utf8'),
      publicKey: readFileSync(resolve(options['verify-public-key'])),
    } : {};
    const result = verifyPackageProvenance(provenance, resolve(options.artifact), verification);
    if (!result.ok) throw new Error(formatFailure(result.errors));
    console.log(`package-provenance: PASS${options.signature ? ' (Ed25519 signed)' : ''} — ${provenance.package.name}@${provenance.package.version}, artifact ${provenance.artifact.sha256}`);
    return;
  }
  if (argv.length > 0) throw new Error('use --artifact <tgz> with --out <json> [--sign-private-key <pem> --signature <sig>] or --provenance <json> [--signature <sig> --verify-public-key <pem>]');

  const packed = createPackageProvenance();
  try {
    const result = verifyPackageProvenance(packed.provenance, packed.artifactPath);
    if (!result.ok) throw new Error(formatFailure(result.errors));
    console.log(`package-provenance: PASS — ${packed.provenance.package.name}@${packed.provenance.package.version}, ${packed.provenance.files.length} files, artifact ${packed.provenance.artifact.sha256}`);
  } finally {
    packed.cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runProvenanceCli();
  } catch (error) {
    console.error(`package-provenance: FAIL\n  - ${error.message}`);
    process.exitCode = 1;
  }
}
