import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as attestation from '../lib/pse-capture-attestation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = resolve(ROOT, 'core/pse-capture-attestation.json');
const SEEDS = [
  'scripts/__tests__/pse-capture-attestation.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-pse-artifact-capture.test.mjs',
  'hooks/scripts/lib/__tests__/process-controller.test.mjs',
];

test('exports only the attestation manifest API', () => {
  assert.deepEqual(
    Object.keys(attestation).sort(),
    [
      'buildPseCaptureAttestationManifest',
      'loadPseCaptureAttestationManifest',
      'parseStaticModuleRequests',
      'validatePseCaptureAttestationManifest',
    ],
  );
});

test('builds and loads the committed canonical manifest', () => {
  const built = attestation.buildPseCaptureAttestationManifest({ cwd: ROOT });
  const raw = readFileSync(MANIFEST_PATH);
  const committed = JSON.parse(raw.toString('utf8'));

  assert.deepEqual(built, committed);
  assert.equal(raw.at(-1), 0x7d, 'manifest must end at the closing brace without a terminal newline');
  assert.deepEqual(attestation.loadPseCaptureAttestationManifest({ cwd: ROOT }), committed);
  assert.deepEqual(attestation.validatePseCaptureAttestationManifest(built, { cwd: ROOT }), { ok: true, code: 'VALID' });
});

let predecessorCache;
function fixtureBuild({ seeds = ['a.mjs'], resolvePath, statSize = 0, bytes = Buffer.alloc(0), requests = [], adapters = {} } = {}) {
  predecessorCache ||= attestation.buildPseCaptureAttestationManifest({ cwd: ROOT }).predecessor;
  let reads = 0;
  const manifest = () => attestation.buildPseCaptureAttestationManifest({
    cwd: ROOT,
    seeds,
    predecessor: predecessorCache,
    adapters: {
      now: (() => { let tick = 0; return () => tick++; })(),
      resolvePath: resolvePath || (({ inputPath }) => ({
        candidateNfcPosix: inputPath,
        realpathIdentity: resolve(ROOT, '.fixture', inputPath),
        manifestPathNfcPosix: inputPath,
      })),
      stat: path => ({ size: typeof statSize === 'function' ? statSize(path) : statSize, isFile: () => true }),
      read: path => { reads += 1; return Buffer.from(typeof bytes === 'function' ? bytes(path) : bytes); },
      parseRequests: () => requests,
      ...adapters,
    },
  });
  return { manifest, reads: () => reads };
}

test('rejects non-NFC and invalid Unicode scalars before path resolution', () => {
  let resolutions = 0;
  for (const seed of ['e\u0301.mjs?x', '\ud800.mjs', '\udcff.mjs']) {
    const fixture = fixtureBuild({
      seeds: [seed],
      resolvePath: () => { resolutions += 1; throw new Error('must not resolve'); },
    });
    assert.throws(
      fixture.manifest,
      error => error?.code === (seed.includes('\u0301') ? 'NON_NFC_PATH' : 'INVALID_UNICODE_SCALAR'),
    );
  }
  assert.equal(resolutions, 0);

  const requestFixture = fixtureBuild({
    requests: [{ specifier: './e\u0301.mjs?x', attributes: {}, phase: 'evaluation' }],
    resolvePath: ({ inputPath }) => {
      resolutions += 1;
      return { candidateNfcPosix: inputPath, realpathIdentity: resolve(ROOT, '.fixture', inputPath), manifestPathNfcPosix: inputPath };
    },
  });
  const before = resolutions;
  assert.throws(requestFixture.manifest, error => error?.code === 'NON_NFC_PATH');
  assert.equal(resolutions, before + 1, 'only the seed is resolved; the invalid specifier is not');
});

test('fails alias maps before the second target read', () => {
  const sameReal = fixtureBuild({
    seeds: ['A.mjs', 'a.mjs'],
    resolvePath: ({ inputPath }) => ({
      candidateNfcPosix: inputPath,
      realpathIdentity: resolve(ROOT, '.fixture/shared.mjs'),
      manifestPathNfcPosix: inputPath,
    }),
  });
  assert.throws(sameReal.manifest, error => error?.code === 'AMBIGUOUS_PATH_ALIAS');
  assert.equal(sameReal.reads(), 0);

  const sameManifestPath = fixtureBuild({
    seeds: ['é.mjs', 'other.mjs'],
    resolvePath: ({ inputPath }) => ({
      candidateNfcPosix: inputPath,
      realpathIdentity: resolve(ROOT, '.fixture', inputPath),
      manifestPathNfcPosix: 'é.mjs',
    }),
  });
  assert.throws(sameManifestPath.manifest, error => error?.code === 'AMBIGUOUS_UNICODE_PATH');
  assert.equal(sameManifestPath.reads(), 0);
});

test('enforces pre-read stat bounds and stat/read equality', () => {
  const oversized = fixtureBuild({ statSize: 4_194_305, bytes: Buffer.alloc(0) });
  assert.throws(oversized.manifest, error => error?.code === 'TOO_LARGE');
  assert.equal(oversized.reads(), 0);

  const mismatch = fixtureBuild({ statSize: 1, bytes: Buffer.alloc(0) });
  assert.throws(mismatch.manifest, error => error?.code === 'STAT_READ_MISMATCH');
  assert.equal(mismatch.reads(), 1);

  const inverseMismatch = fixtureBuild({ statSize: 0, bytes: Buffer.from('x') });
  assert.throws(inverseMismatch.manifest, error => error?.code === 'STAT_READ_MISMATCH');

  assert.doesNotThrow(fixtureBuild({ statSize: 4_194_304, bytes: Buffer.alloc(4_194_304, 0x20) }).manifest);
});

test('enforces aggregate, file-count, and coalesced-request caps inclusively', () => {
  const fourFiles = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'];
  assert.doesNotThrow(fixtureBuild({ seeds: fourFiles, statSize: 4_194_304, bytes: Buffer.alloc(4_194_304, 0x20) }).manifest);
  const exactPlusOneSizes = new Map([...fourFiles.map(name => [name, 4_194_304]), ['e.mjs', 1]]);
  const exactPlusOne = fixtureBuild({
    seeds: [...fourFiles, 'e.mjs'],
    statSize: path => exactPlusOneSizes.get(path.split('/').at(-1)),
    bytes: path => Buffer.alloc(exactPlusOneSizes.get(path.split('/').at(-1)), 0x20),
  });
  assert.throws(exactPlusOne.manifest, error => error?.code === 'TOO_LARGE');
  assert.equal(exactPlusOne.reads(), 4, 'aggregate +1 file must not be read');

  assert.doesNotThrow(fixtureBuild({ seeds: Array.from({ length: 64 }, (_, index) => `f${index}.mjs`) }).manifest);
  const tooMany = fixtureBuild({ seeds: Array.from({ length: 65 }, (_, index) => `f${index}.mjs`) });
  assert.throws(tooMany.manifest, error => error?.code === 'TOO_MANY_FILES');
  assert.equal(tooMany.reads(), 0, 'all seeds are bounded before content reads');

  const distinctRequests = count => Array.from({ length: count }, (_, index) => ({ specifier: `virtual:${index}`, attributes: {}, phase: 'evaluation' }));
  assert.doesNotThrow(fixtureBuild({ requests: distinctRequests(4096), adapters: { isBuiltin: value => value.startsWith('virtual:') } }).manifest);
  assert.throws(
    fixtureBuild({ requests: distinctRequests(4097), adapters: { isBuiltin: value => value.startsWith('virtual:') } }).manifest,
    error => error?.code === 'TOO_MANY_REQUESTS',
  );
});

test('rejects encoding, containment, symlink, and inconsistent adapter targets', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([0])]) {
    assert.throws(fixtureBuild({ statSize: bytes.length, bytes }).manifest);
  }
  for (const target of [ROOT, resolve(ROOT, '..', 'qe-framework-evil', 'x.mjs')]) {
    assert.throws(
      fixtureBuild({ resolvePath: ({ inputPath }) => ({ candidateNfcPosix: inputPath, realpathIdentity: target, manifestPathNfcPosix: inputPath }) }).manifest,
      error => error?.code === 'ROOT_ESCAPE',
    );
  }
  assert.throws(fixtureBuild({ resolvePath: ({ inputPath }) => ({ candidateNfcPosix: inputPath, realpathIdentity: resolve(ROOT, '.fixture/a.mjs'), manifestPathNfcPosix: inputPath, extra: true }) }).manifest,
    error => error?.code === 'INVALID_PATH_ADAPTER');

  predecessorCache ||= attestation.buildPseCaptureAttestationManifest({ cwd: ROOT }).predecessor;
  const dir = mkdtempSync(resolve(tmpdir(), 'pse-attest-'));
  try {
    writeFileSync(resolve(dir, 'target.mjs'), '');
    symlinkSync(resolve(dir, 'target.mjs'), resolve(dir, 'link.mjs'));
    assert.throws(
      () => attestation.buildPseCaptureAttestationManifest({ cwd: dir, seeds: ['link.mjs'], predecessor: predecessorCache }),
      error => error?.code === 'SYMLINK',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates cycle/diamond graphs and uses UTF-8 byte ordering', () => {
  const graph = {
    'a.mjs': ['./b.mjs', './c.mjs'],
    'b.mjs': ['./d.mjs'],
    'c.mjs': ['./d.mjs'],
    'd.mjs': ['./a.mjs'],
  };
  const fixture = fixtureBuild({
    seeds: ['a.mjs', 'é.mjs', '𐀀.mjs'],
    adapters: {
      parseRequests: (_source, identifier) => (graph[identifier] || []).map(specifier => ({ specifier, attributes: {}, phase: 'evaluation' })),
    },
  });
  const manifest = fixture.manifest();
  assert.equal(new Set(manifest.files.map(file => file.path)).size, manifest.files.length);
  assert.ok(manifest.files.some(file => file.path === 'd.mjs'));
  assert.deepEqual(manifest.files.map(file => file.path), [...manifest.files.map(file => file.path)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
});

test('classifies only authoritative builtin members', () => {
  for (const specifier of ['node:fs', 'node:fs/promises', 'node:test', 'node:test/reporters', 'node:sqlite', 'fs', 'fs/promises']) {
    assert.doesNotThrow(fixtureBuild({ requests: [{ specifier, attributes: {}, phase: 'evaluation' }] }).manifest);
  }
  for (const specifier of ['node:not-a-real-builtin', 'node:fs/not-a-real-subpath', 'fs-extra', 'test', 'test/reporters', 'sqlite']) {
    assert.throws(
      fixtureBuild({ requests: [{ specifier, attributes: {}, phase: 'evaluation' }] }).manifest,
      error => error?.code === 'UNSUPPORTED_STATIC_IMPORT',
    );
  }
});

test('applies the cooperative deadline before spawning parser work', () => {
  const predecessor = attestation.buildPseCaptureAttestationManifest({ cwd: ROOT }).predecessor;
  let spawns = 0;
  const ticks = [0, 1, 29_999.25, 29_999.25];
  assert.throws(
    () => attestation.buildPseCaptureAttestationManifest({
      cwd: ROOT,
      seeds: ['a.mjs'],
      predecessor,
      adapters: {
        now: () => ticks.shift() ?? 29_999.25,
        resolvePath: ({ inputPath }) => ({ candidateNfcPosix: inputPath, realpathIdentity: resolve(ROOT, '.fixture/a.mjs'), manifestPathNfcPosix: inputPath }),
        stat: () => ({ size: 0, isFile: () => true }),
        read: () => Buffer.alloc(0),
        spawn: () => { spawns += 1; return { status: 0, signal: null, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[]}', stderr: '' }; },
      },
    }),
    error => error?.code === 'MANIFEST_DEADLINE_EXCEEDED',
  );
  assert.equal(spawns, 0);
});

test('passes exact remaining parser budgets to the worker adapter', () => {
  predecessorCache ||= attestation.buildPseCaptureAttestationManifest({ cwd: ROOT }).predecessor;
  for (const remaining of [1, 4_999, 5_000]) {
    const time = 30_000 - remaining;
    const timeouts = [];
    const fixture = fixtureBuild({
      adapters: {
        now: (() => { let calls = 0; return () => (++calls < 8 ? 0 : time); })(),
        parseRequests: (_source, _identifier, options) => { timeouts.push(options.timeout); return []; },
      },
    });
    assert.doesNotThrow(fixture.manifest);
    assert.deepEqual(timeouts, [Math.min(5_000, remaining)]);
  }
});

test('maps parser capability absence and rejects any stderr bytes', () => {
  const unsupported = () => ({
    error: undefined,
    status: 86,
    signal: null,
    stdout: '',
    stderr: 'QE_UNSUPPORTED_MODULE_REQUESTS',
  });
  assert.throws(
    () => attestation.parseStaticModuleRequests('', 'fixture.mjs', { spawn: unsupported, timeout: 5_000 }),
    error => error?.code === 'UNSUPPORTED_NODE_VM_MODULE_REQUESTS',
  );
  const whitespaceStderr = () => ({
    error: undefined,
    status: 0,
    signal: null,
    stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[]}',
    stderr: ' ',
  });
  assert.throws(
    () => attestation.parseStaticModuleRequests('', 'fixture.mjs', { spawn: whitespaceStderr, timeout: 5_000 }),
    error => error?.code === 'PARSER_FAILED',
  );
});

test('fails closed across parser process and IPC result variants', () => {
  const cases = [
    { error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), status: null, stdout: '', stderr: '', code: 'PARSER_TIMEOUT' },
    { error: new Error('spawn'), status: null, stdout: '', stderr: '', code: 'PARSER_FAILED' },
    { error: undefined, status: 1, stdout: '', stderr: 'boom', code: 'PARSER_FAILED' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[]}\n', stderr: '', code: 'PARSER_TRAILING_OUTPUT' },
    { error: undefined, status: 0, stdout: 'not-json', stderr: '', code: 'JSON_NUMBER' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[],"extra":1}', stderr: '', code: 'PARSER_FAILED' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[null]}', stderr: '', code: 'PARSER_FAILED' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[],"schema":1}', stderr: '', code: 'JSON_DUPLICATE_KEY' },
    { error: undefined, status: 0, signal: 'SIGKILL', stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[]}', stderr: '', code: 'PARSER_FAILED' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[{"specifier":"node:fs","attributes":{},"phase":"evaluation"},{"specifier":"node:fs","attributes":{},"phase":"evaluation"}]}', stderr: '', code: 'PARSER_FAILED' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[{"specifier":"node:fs","attributes":{"type":"json"},"phase":"evaluation"}]}', stderr: '', code: 'UNSUPPORTED_STATIC_IMPORT' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[{"specifier":"node:fs","attributes":{},"phase":"source"}]}', stderr: '', code: 'UNSUPPORTED_STATIC_IMPORT' },
    { error: undefined, status: 0, stdout: '{"schema":1,"requestApi":"moduleRequests","requests":[{"specifier":"node:fs","attributes":{},"phase":"evaluation","extra":1}]}', stderr: '', code: 'PARSER_FAILED' },
  ];
  for (const fixture of cases) {
    assert.throws(
      () => attestation.parseStaticModuleRequests('', 'fixture.mjs', { spawn: () => fixture, timeout: 5_000 }),
      error => error?.code === fixture.code,
      fixture.code,
    );
  }
});

test('checks deadline at predecessor, canonicalization, and final-return stages', () => {
  let calls = 0;
  assert.throws(
    () => attestation.buildPseCaptureAttestationManifest({
      cwd: ROOT,
      adapters: { now: () => (++calls < 5 ? 0 : 30_000) },
    }),
    error => error?.code === 'MANIFEST_DEADLINE_EXCEEDED',
  );

  predecessorCache ||= attestation.buildPseCaptureAttestationManifest({ cwd: ROOT }).predecessor;
  for (const exhaustionCall of [11, 12]) {
    calls = 0;
    assert.throws(
      fixtureBuild({ adapters: { now: () => (++calls < exhaustionCall ? 0 : 30_000) } }).manifest,
      error => error?.code === 'MANIFEST_DEADLINE_EXCEEDED',
    );
  }
});

test('parses only static module requests through the fixed worker contract', () => {
  const source = [
    "import x from './x.mjs';",
    "import { y } from './y.mjs';",
    'const z = 1 / 2;',
    'const t = `${a ? `${b}` : c}`;',
    "const dynamic = import('./dynamic.mjs');",
    "const text = /import '.\\/ghost.mjs'/;",
  ].join('\n');
  const requests = attestation.parseStaticModuleRequests(source, 'fixture.mjs');

  assert.deepEqual(requests, [
    { specifier: './x.mjs', attributes: {}, phase: 'evaluation' },
    { specifier: './y.mjs', attributes: {}, phase: 'evaluation' },
  ]);
});

test('parser fails closed on attributes and malformed source', () => {
  assert.throws(
    () => attestation.parseStaticModuleRequests("import data from './x.mjs' with { type: 'json' };", 'attributes.mjs'),
    error => error?.code === 'PARSER_FAILED',
  );
  assert.throws(
    () => attestation.parseStaticModuleRequests('export {', 'syntax-error.mjs'),
    error => error?.code === 'PARSER_FAILED',
  );
});

test('manifest pins the exact seeds, parser, predecessor, and supported closure', () => {
  const manifest = attestation.buildPseCaptureAttestationManifest({ cwd: ROOT });
  assert.deepEqual(manifest.seeds, SEEDS);
  assert.deepEqual(manifest.parser.args, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e']);
  assert.equal(manifest.parser.minimumNode, '22.20.0');
  assert.equal(manifest.parser.requestApi, 'moduleRequests');
  assert.match(manifest.parser.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.manifestDigest, /^[0-9a-f]{64}$/);
  const paths = manifest.files.map(file => file.path);
  assert.deepEqual(paths, [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  assert.equal(new Set(paths).size, paths.length);
  for (const required of [...SEEDS, 'scripts/lib/pse-capture-attestation.mjs', 'hooks/scripts/lib/process-controller.mjs']) {
    assert.ok(paths.includes(required), `missing closure member: ${required}`);
  }
  assert.equal(manifest.predecessor.goalProjection.acceptanceHash, 'ac165b1e1c455e68b0538670fd1e70481b26fb0b9efc2e73472a7673a5838b22');
  assert.equal(manifest.predecessor.goals.rawSha256, 'd1b55e155e5c665c90cea55a7dddedc9e12615ec9eabea0ede30c186f4232bf4');
  assert.equal(manifest.predecessor.ledger.rawSha256, '0d8d72c84b711a1fd0046e95ad86d854af937fbcad31048158eca5c464e6d224');
});

test('manifest validator rejects field, source, path, and anchor drift', () => {
  const manifest = attestation.buildPseCaptureAttestationManifest({ cwd: ROOT });
  const mutations = [
    value => { value.extra = true; },
    value => { value.parser.requestApi = 'dependencySpecifiers'; },
    value => { value.predecessor.goals.path = '.qe/planning/plans/runtime-controller-lifecycle-10/GOALS.json'; },
    value => { value.predecessor.verifiedEvent.receiptId = '0'.repeat(64); },
    value => { value.files[0].sha256 = '0'.repeat(64); },
    value => { value.seeds.reverse(); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.equal(attestation.validatePseCaptureAttestationManifest(candidate, { cwd: ROOT }).ok, false);
  }
});
