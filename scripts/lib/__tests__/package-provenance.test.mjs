import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  createPackageProvenance,
  createProvenanceSigningPayload,
  digestManifest,
  readTarGzEntries,
  REQUIRED_PACKAGE_ASSETS,
  signPackageProvenance,
  verifyPackageProvenance,
  verifyPackageProvenanceSignature,
} from '../../check-package-provenance.mjs';
import {
  SUPPORTED_PACKAGE_PLATFORMS,
  verifyPackedInstallMatrix,
} from '../../check-packaged-install.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let packed;
let signingKeys;

test.before(() => {
  packed = createPackageProvenance();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  signingKeys = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  };
});

test.after(() => {
  packed?.cleanup();
});

test('actual npm package has deterministic immutable provenance and every required asset', () => {
  const result = verifyPackageProvenance(packed.provenance, packed.artifactPath);
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.match(packed.provenance.artifact.integrity, /^sha512-/);
  assert.match(packed.provenance.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.provenance.manifestSha256, digestManifest(packed.provenance));
  assert.ok(packed.provenance.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
  assert.ok(REQUIRED_PACKAGE_ASSETS.every((asset) =>
    packed.provenance.files.some(({ path }) => path === asset)));
});

test('missing required asset fails before installation', () => {
  const result = verifyPackageProvenance(packed.provenance, packed.artifactPath, {
    requiredAssets: [...REQUIRED_PACKAGE_ASSETS, 'missing/required-asset.txt'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('required package asset is missing: missing/required-asset.txt'));
});

test('manifest or per-file digest mutation fails deterministic verification', () => {
  const provenance = structuredClone(packed.provenance);
  provenance.files[0].sha256 = '0'.repeat(64);
  let result = verifyPackageProvenance(provenance, packed.artifactPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('package manifest digest mismatch'));

  provenance.manifestSha256 = digestManifest(provenance);
  result = verifyPackageProvenance(provenance, packed.artifactPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('packed file manifest mismatch'));
});

test('artifact mutation fails SHA-256 and SHA-512 verification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qe-package-tamper-'));
  const tamperedArtifact = join(directory, 'tampered.tgz');
  try {
    copyFileSync(packed.artifactPath, tamperedArtifact);
    appendFileSync(tamperedArtifact, 'tampered');
    const result = verifyPackageProvenance(packed.provenance, tamperedArtifact);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('artifact SHA-256 digest mismatch'));
    assert.ok(result.errors.includes('artifact SHA-512 integrity mismatch'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('supported macOS, Linux, and Windows package matrix passes', () => {
  const result = verifyPackedInstallMatrix(packed.provenance);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.results.map(({ platform, ok }) => ({ platform, ok })),
    SUPPORTED_PACKAGE_PLATFORMS.map((platform) => ({ platform, ok: true })),
  );
});

test('unsupported OS fails the package matrix before installation', () => {
  const result = verifyPackedInstallMatrix(packed.provenance, ['freebsd']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('freebsd: unsupported package platform: freebsd'));
});

test('detached Ed25519 signature binds canonical immutable provenance', () => {
  const signature = signPackageProvenance(packed.provenance, signingKeys.privateKey);
  assert.equal(Buffer.from(signature, 'base64').length, 64);
  assert.match(createProvenanceSigningPayload(packed.provenance).toString('utf8'),
    /^qe-package-provenance-signature-v1\n/);
  assert.deepEqual(
    verifyPackageProvenanceSignature(packed.provenance, signature, signingKeys.publicKey),
    { ok: true, errors: [] },
  );
  assert.deepEqual(
    verifyPackageProvenance(packed.provenance, packed.artifactPath, {
      signature,
      publicKey: signingKeys.publicKey,
    }),
    { ok: true, errors: [] },
  );
});

test('provenance, signature, and trusted-key mismatches fail closed', () => {
  const signature = signPackageProvenance(packed.provenance, signingKeys.privateKey);
  const mutated = structuredClone(packed.provenance);
  mutated.package.version = `${mutated.package.version}-tampered`;
  let result = verifyPackageProvenance(mutated, packed.artifactPath, {
    signature,
    publicKey: signingKeys.publicKey,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('provenance Ed25519 signature mismatch'));

  const tamperedSignature = `${signature.slice(0, -4)}AAAA`;
  result = verifyPackageProvenance(packed.provenance, packed.artifactPath, {
    signature: tamperedSignature,
    publicKey: signingKeys.publicKey,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('signature')));

  const otherKeys = generateKeyPairSync('ed25519');
  result = verifyPackageProvenance(packed.provenance, packed.artifactPath, {
    signature,
    publicKey: otherKeys.publicKey,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('provenance Ed25519 signature mismatch'));

  result = verifyPackageProvenance(packed.provenance, packed.artifactPath, { signature });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('detached signature and trusted public key must be supplied together'));
});

function tarHeader(path, size, type = '0') {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function writeSyntheticTar(directory, name, path, data, type = '0') {
  const body = Buffer.from(data);
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  const artifact = join(directory, name);
  writeFileSync(artifact, gzipSync(Buffer.concat([
    tarHeader(path, body.length, type), body, padding, Buffer.alloc(1024),
  ])));
  return artifact;
}

test('unsafe traversal and link entries fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qe-package-unsafe-'));
  try {
    const traversal = writeSyntheticTar(directory, 'traversal.tgz', 'package/../escape', 'x');
    assert.throws(() => readTarGzEntries(traversal), /unsafe packed path/);
    const link = writeSyntheticTar(directory, 'link.tgz', 'package/link', '', '2');
    assert.throws(() => readTarGzEntries(link), /unsupported tar entry type/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI writes an exclusive provenance record and verifies the supplied artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qe-package-cli-'));
  const provenancePath = join(directory, 'provenance.json');
  try {
    let run = spawnSync(process.execPath, [
      'scripts/check-package-provenance.mjs', '--artifact', packed.artifactPath, '--out', provenancePath,
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const saved = JSON.parse(readFileSync(provenancePath, 'utf8'));
    assert.equal(saved.artifact.sha256, packed.provenance.artifact.sha256);

    run = spawnSync(process.execPath, [
      'scripts/check-package-provenance.mjs', '--artifact', packed.artifactPath, '--provenance', provenancePath,
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /package-provenance: PASS/);

    run = spawnSync(process.execPath, [
      'scripts/check-package-provenance.mjs', '--artifact', packed.artifactPath, '--out', provenancePath,
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI creates a detached signature and both verification entrypoints fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qe-package-signature-cli-'));
  const provenancePath = join(directory, 'provenance.json');
  const signaturePath = join(directory, 'provenance.sig');
  const privateKeyPath = join(directory, 'private.pem');
  const publicKeyPath = join(directory, 'public.pem');
  const wrongPublicKeyPath = join(directory, 'wrong-public.pem');
  try {
    writeFileSync(privateKeyPath, signingKeys.privateKey, { mode: 0o600 });
    writeFileSync(publicKeyPath, signingKeys.publicKey);
    const wrongKeys = generateKeyPairSync('ed25519');
    writeFileSync(wrongPublicKeyPath, wrongKeys.publicKey.export({ type: 'spki', format: 'pem' }));

    let run = spawnSync(process.execPath, [
      'scripts/check-package-provenance.mjs',
      '--artifact', packed.artifactPath,
      '--out', provenancePath,
      '--sign-private-key', privateKeyPath,
      '--signature', signaturePath,
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64').length, 64);

    const verifyArgs = [
      '--artifact', packed.artifactPath,
      '--provenance', provenancePath,
      '--signature', signaturePath,
      '--verify-public-key', publicKeyPath,
    ];
    run = spawnSync(process.execPath, ['scripts/check-package-provenance.mjs', ...verifyArgs], {
      cwd: REPOSITORY_ROOT, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /PASS \(Ed25519 signed\)/);

    run = spawnSync(process.execPath, ['scripts/check-packaged-install.mjs', ...verifyArgs], {
      cwd: REPOSITORY_ROOT, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);

    run = spawnSync(process.execPath, [
      'scripts/check-packaged-install.mjs',
      ...verifyArgs.slice(0, -1), wrongPublicKeyPath,
    ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /signature mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
