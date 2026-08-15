import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constants as fsConstants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

import {
  BASELINE_BASENAME_RE,
  DIRFD_FAULT_BOUNDARY_MANIFEST,
  canonicalDirfdJson,
  canonicalDirfdRequestJson,
  classifyDirfdObservedState,
  compileDirfdHelper,
  createDirfdCompileAuthority,
  createDirfdTransactionRecord,
  writeDirfdTransactionRecord,
  writeDirfdOperationIntent,
  openDirfdTransaction,
  buildDirfdHelperInvocation,
  buildDirfdHelperSpawnPlan,
  buildDirfdOperationRequest,
  sha256File,
  sha256Hex,
  validateDirfdBasename,
  validateDirfdOperationRequest,
  parseDirfdNativeResponse,
  spawnDirfdOperationBounded,
  reopenDirfdRecoveryAuthority,
  assertDirfdTwoEmptyCensus,
  normalizeDirfdRecovery,
  parseDirfdProcessCensus,
  probeDirfdHelperCapability,
  snapshotDirfdDescriptorIdentity,
  snapshotDirfdFileIdentity,
} from '../harness-study-dirfd-helper.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const C_SOURCE = readFileSync(join(ROOT, 'scripts/native/harness-study-dirfd-helper.c'), 'utf8');

test('canonicalizes dirfd JSON and rejects invalid basenames', () => {
  assert.equal(canonicalDirfdJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(BASELINE_BASENAME_RE.source, '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
  assert.equal(validateDirfdBasename('Alpha-1_2.3'), 'Alpha-1_2.3');
  for (const value of ['../x', 'a/b', ' a', 'x y', '.hidden', '', '.', '..']) {
    assert.throws(() => validateDirfdBasename(value), TypeError);
  }
});

test('seals the exact fd7 transaction record and request schema', () => {
  const record = createDirfdTransactionRecord({
    schema: 'qe-dirfd-transaction-record-v1',
    launchUuid: '11111111-1111-4111-8111-111111111111',
    savedParent: {
      path: '/private/tmp/root',
      realpath: '/private/tmp/root',
      dev: 1,
      ino: 2,
      uid: 501,
      mode: 16832,
    },
    names: { temp: 'temp-file', final: 'final-file' },
    content: { length: 3, sha256: '0'.repeat(64) },
    digests: { source: '1'.repeat(64), core: '2'.repeat(64), production: '3'.repeat(64) },
  });
  assert.equal(record.schema, 'qe-dirfd-transaction-record-v1');
  assert.equal(record.requestDigest.length, 64);
  assert.equal(record.sha256.length, 64);
  assert.throws(() => validateDirfdOperationRequest({
    role: 'qe-dirfd-helper',
    launchUuid: record.launchUuid,
    operationUuid: '22222222-2222-4222-8222-222222222222',
    parentPid: 123,
    transactionRecordSha256: record.sha256,
    requestSha256: record.requestDigest,
    expectedParent: { dev: 1, ino: 2, uid: 501, mode: 16832 },
    sourceSha256: '1'.repeat(64),
    coreSha256: '2'.repeat(64),
    operation: 'inspect',
    tempName: 'temp-file',
    finalName: 'final-file',
    tempState: 'exact',
  }), TypeError);
});

test('G001-PARENT-DEATH-AUTH-001 seals an immutable operation intent before recovery', () => {
  assert.equal(typeof writeDirfdOperationIntent, 'function');
  assert.match(C_SOURCE, /if \(sigemptyset\(&action\.sa_mask\) != 0\) return errno;/);
  assert.match(C_SOURCE, /if \(sigaction\(SIGALRM, &action, NULL\) != 0\) return errno;/);
  assert.match(C_SOURCE, /if \(sigaction\(SIGTERM, &action, NULL\) != 0\) return errno;/);
  assert.match(C_SOURCE, /if \(alarm\(10\) != 0\) return EBUSY;/);
});

test('G001-FD7-001 writes a durable exact canonical record with O_EXCL 0600', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-record-'));
  const output = join(root, 'output'); const transport = join(root, 'transport');
  mkdirSync(output, { mode: 0o700 }); mkdirSync(transport, { mode: 0o700 });
  const path = join(transport, 'authority.json');
  try {
    const record = createDirfdTransactionRecord({
      schema: 'qe-dirfd-transaction-record-v1',
      launchUuid: '11111111-1111-4111-8111-111111111111',
      savedParent: { path: output, realpath: realpathSync(output), dev: 1, ino: 2, uid: process.getuid(), mode: 16832 },
      names: { temp: 'temp-file', final: 'final-file' },
      content: { length: 3, sha256: sha256Hex('abc') },
      digests: { source: '1'.repeat(64), core: '2'.repeat(64), production: '3'.repeat(64) },
    });
    const durable = writeDirfdTransactionRecord({ path, record });
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify(record)}\n`);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(durable.sha256, record.sha256);
    assert.throws(() => writeDirfdTransactionRecord({ path, record }), /exist/i);
    closeSync(durable.fd);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifies observed state and build plan normalization', () => {
  assert.equal(classifyDirfdObservedState({ temp: 'exact', final: 'absent' }).nextOperation, 'fsync-temp');
  assert.equal(classifyDirfdObservedState({ temp: 'exact', final: 'exact-same-inode' }).nextOperation, 'fsync-dir');
  assert.equal(classifyDirfdObservedState({ temp: 'foreign', final: 'absent' }).status, 'permanent-indeterminate');
  const plan = buildDirfdHelperSpawnPlan({ binaryPath: '/tmp/helper', launchUuid: '11111111-1111-4111-8111-111111111111' });
  assert.equal(plan.shell, false);
  assert.equal(plan.timeoutMs, 30_000);
  assert.equal(plan.env.PATH, undefined);
  assert.equal(plan.argv[0], '/tmp/helper');
});

test('G001-RECOVERY-001 enforces the sole idempotent normalization sequence and stops on failed authority', async () => {
  const exact = { name: 'temp-file', status: 'exact', dev: 1, ino: 2, size: 3, nlink: 1, sha256: 'a'.repeat(64) };
  const absentTemp = { name: 'temp-file', status: 'absent', dev: 0, ino: 0, size: 0, nlink: 0, sha256: '' };
  const absentFinal = { name: 'final-file', status: 'absent' };
  const sameFinal = { name: 'final-file', status: 'exact-same-inode' };
  const completeFinal = { name: 'final-file', status: 'exact-nlink1' };
  const observations = [
    { temp: absentTemp, final: absentFinal },
    { temp: exact, final: absentFinal },
    { temp: exact, final: absentFinal },
    { temp: { ...exact, nlink: 2 }, final: sameFinal },
    { temp: { ...exact, nlink: 2 }, final: sameFinal },
    { temp: absentTemp, final: completeFinal },
    { temp: absentTemp, final: completeFinal },
  ];
  const invoked = [];
  const result = await normalizeDirfdRecovery({
    inspect: () => ({ status: 0, authorityVerified: true, response: { ...observations.shift(), op: 'inspect', committed: false } }),
    invoke: operation => { invoked.push(operation); return { status: 0, authorityVerified: true, response: { op: operation, committed: true } }; },
    createAuthority: { contentLength: 3, contentSha256: 'a'.repeat(64) },
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(invoked, ['create-temp', 'fsync-temp', 'link-final', 'fsync-dir', 'unlink-temp', 'fsync-dir']);
  assert.equal((await normalizeDirfdRecovery({
    inspect: () => ({ status: 0, authorityVerified: true, response: { temp: { status: 'foreign' }, final: absentFinal, op: 'inspect', committed: false } }),
    invoke: () => assert.fail(), createAuthority: {},
  })).status, 'permanent-indeterminate');
  for (const failed of [
    { status: 5 },
    { status: null, code: 143, timedOut: true },
    { status: 0, authorityVerified: true, response: { op: 'wrong', committed: true } },
  ]) {
    let mutations = 0;
    const stopped = await normalizeDirfdRecovery({
      inspect: () => ({ status: 0, authorityVerified: true, response: { temp: absentTemp, final: absentFinal, op: 'inspect', committed: false } }),
      invoke: () => { mutations += 1; return failed; }, createAuthority: {},
    });
    assert.equal(stopped.status, 'permanent-indeterminate');
    assert.equal(mutations, 1);
  }
  const sameObserved = { temp: { ...exact, nlink: 2 }, final: sameFinal };
  const failureCases = [
    { fail: 'create-temp', observations: [{ temp: absentTemp, final: absentFinal }], expected: ['create-temp'] },
    { fail: 'fsync-temp', observations: [{ temp: exact, final: absentFinal }], expected: ['fsync-temp'] },
    { fail: 'link-final', observations: [{ temp: exact, final: absentFinal }, { temp: exact, final: absentFinal }], expected: ['fsync-temp', 'link-final'] },
    { fail: 'fsync-dir', observations: [sameObserved], expected: ['fsync-dir'] },
    { fail: 'unlink-temp', observations: [sameObserved, sameObserved], expected: ['fsync-dir', 'unlink-temp'] },
  ];
  for (const scenario of failureCases) {
    const calls = [];
    const queue = [...scenario.observations];
    const stopped = await normalizeDirfdRecovery({
      inspect: () => ({ status: 0, authorityVerified: true, response: { ...queue.shift(), op: 'inspect', committed: false } }),
      invoke: operation => {
        calls.push(operation);
        return operation === scenario.fail ? { status: 70 } : { status: 0, authorityVerified: true, response: { op: operation, committed: true } };
      }, createAuthority: {},
    });
    assert.equal(stopped.status, 'permanent-indeterminate', scenario.fail);
    assert.deepEqual(calls, scenario.expected, scenario.fail);
  }
  let afterBadInspect = 0;
  assert.equal((await normalizeDirfdRecovery({
    inspect: () => ({ status: 0, response: { op: 'inspect', committed: true } }),
    invoke: () => { afterBadInspect += 1; }, createAuthority: {},
  })).status, 'permanent-indeterminate');
  assert.equal(afterBadInspect, 0);
});

test('verifies the native response shape and source contract markers', () => {
  const line = `${JSON.stringify({
    schema: 'qe-dirfd-native-response-v1', op: 'fsync-dir', committed: true, errno: 0,
    requestDigest: '1'.repeat(64), transactionRecordSha256: '2'.repeat(64),
    sourceSha256: '3'.repeat(64), coreSha256: '4'.repeat(64),
    parent: { dev: 1, ino: 2, uid: 3, mode: 16832 },
    temp: { name: 'temp-file', dev: 0, ino: 0, size: 0, nlink: 0, sha256: '' },
    final: { name: 'final-file', dev: 0, ino: 0, uid: 0, mode: 0 },
  })}\n`;
  const response = parseDirfdNativeResponse(line);
  assert.equal(response.schema, 'qe-dirfd-native-response-v1');
  assert.equal(response.op, 'fsync-dir');
  assert.match(C_SOURCE, /qe-dirfd-helper/);
  assert.match(C_SOURCE, /openat\(3/);
  assert.match(C_SOURCE, /linkat\(3/);
  assert.match(C_SOURCE, /unlinkat\(3/);
  assert.match(C_SOURCE, /qe_dirfd_tracked_fsync\(3, "fsync-dir\.parent", "dir-fsync"\)/);
  assert.match(C_SOURCE, /alarm\(10\)/);
  assert.match(C_SOURCE, /_exit\(signo == SIGTERM \? 143 : 124\)/);
  assert.doesNotMatch(C_SOURCE, /QE_DIRFD_HELPER_FAULT_BUILD|g_fault_/);
  for (const syscall of ['fcntl', 'fstat', 'fstatat', 'openat', 'read', 'lseek', 'write', 'fchmod',
    'file-fsync', 'dir-fsync', 'close', 'linkat', 'unlinkat']) {
    assert.ok(DIRFD_FAULT_BOUNDARY_MANIFEST.some(id => id.includes(`.${syscall}.`)), syscall);
  }
  assert.ok(DIRFD_FAULT_BOUNDARY_MANIFEST.some(id => id.includes('.response.write.')));
  assert.throws(() => parseDirfdNativeResponse('{"schema":"qe-dirfd-native-response-v1","op":"inspect","committed":false,"errno":0}\n'));
});

test('compile authority is exact and fails closed on mismatched host/toolchain state', () => {
  const receipt = createDirfdCompileAuthority({
    sourcePath: '/tmp/helper.c',
    sourceSha256: 'a'.repeat(64),
    clangPath: '/usr/bin/clang',
    clangRealpath: '/usr/bin/clang',
    clangSha256: 'b'.repeat(64),
    objectSha256: 'c'.repeat(64),
    productionSha256: 'd'.repeat(64),
    faultSha256: 'e'.repeat(64),
    arch: 'arm64',
    deploymentTarget: 'macosx15.0',
    flags: ['-std=c17', '-O2', '-Wall', '-Wextra', '-Werror', '-arch', 'arm64', '-mmacosx-version-min=15.0'],
    hostArchitecture: 'arm64',
    hostProductVersion: '15.7.4',
  });
  assert.equal(receipt.arch, 'arm64');
  assert.equal(receipt.deploymentTarget, 'macosx15.0');
  assert.equal(receipt.flags.length, 8);
  assert.throws(() => createDirfdCompileAuthority({
    ...receipt,
    hostArchitecture: 'x86_64',
  }), TypeError);
});

test('compiles the native helper with the exact macOS arm64 toolchain contract', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'qe-dirfd-helper-build-'));
  try {
    const build = compileDirfdHelper({
      sourcePath: join(ROOT, 'scripts/native/harness-study-dirfd-helper.c'),
      outputDir,
      clangPath: '/usr/bin/clang',
      clangRealpath: '/usr/bin/clang',
      sourceSha256: sha256File(join(ROOT, 'scripts/native/harness-study-dirfd-helper.c')),
      clangSha256: sha256File('/usr/bin/clang'),
      objectSha256: '0'.repeat(64),
      productionSha256: '1'.repeat(64),
      faultSha256: '2'.repeat(64),
      hostArchitecture: 'arm64',
      hostProductVersion: '15.7.4',
    });
    assert.ok(existsSync(build.objectPath));
    assert.ok(existsSync(build.productionPath));
    assert.ok(existsSync(build.faultPath));
    assert.equal(build.objectSha256.length, 64);
    assert.equal(build.productionSha256.length, 64);
    assert.equal(build.faultSha256.length, 64);
    const productionWrapper = readFileSync(join(outputDir, 'harness-study-dirfd-helper.production-wrapper.c'), 'utf8');
    const faultWrapper = readFileSync(join(outputDir, 'harness-study-dirfd-helper.fault-wrapper.c'), 'utf8');
    assert.match(productionWrapper, /main\(int argc, char \*\*argv\) \{ int h=qe_dirfd_helper_install_handlers\(\); if\(h\) return 70; int e=prepare_fd4/);
    assert.match(faultWrapper, /main\(int argc, char \*\*argv\) \{ int h=qe_dirfd_helper_install_handlers\(\); if\(h\) return 70; if \(argc==2/);
    assert.match(faultWrapper, /char go=0;.*if\(n==0\) \{ errno=EPIPE; return -1; \}.*if\(go!='G'\)/);
    const manifest = spawnSync(build.faultPath, ['--manifest'], { encoding: 'utf8', shell: false });
    assert.equal(manifest.status, 0);
    assert.deepEqual(JSON.parse(manifest.stdout), DIRFD_FAULT_BOUNDARY_MANIFEST);
    assert.equal(spawnSync(build.productionPath, ['--manifest'], { encoding: 'utf8', shell: false }).status, 64);
    const censusAuthority = {
      binaryPath: build.productionPath,
      launchUuid: '11111111-1111-4111-8111-111111111111',
      operationUuid: '22222222-2222-4222-8222-222222222222',
    };
    const executable = realpathSync(build.productionPath);
    assert.deepEqual(parseDirfdProcessCensus(
      `12 ${executable} qe-dirfd-helper ${censusAuthority.launchUuid} ${censusAuthority.operationUuid} ${'x'.repeat(20_000)}\n`
      + `13 /tmp/spoof-${executable} qe-dirfd-helper x${censusAuthority.launchUuid} ${censusAuthority.operationUuid}x\n`, censusAuthority,
    ), [12]);
    assert.throws(() => parseDirfdProcessCensus(
      `12 ${executable} qe-dirfd-helper ${censusAuthority.launchUuid}\n`, censusAuthority,
    ), /truncated|ambiguous/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('G001-CAPABILITY-001 probes inherited fds, alarm-backed native mutations, and file/directory durability', { concurrency: true }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-capability-'));
  const output = join(root, 'output');
  const transport = join(root, 'transport');
  mkdirSync(output, { mode: 0o700 }); mkdirSync(transport, { mode: 0o700 });
  let parentFd; let contentFd; let recordFd;
  try {
    const sourcePath = join(ROOT, 'scripts/native/harness-study-dirfd-helper.c');
    const build = compileDirfdHelper({
      sourcePath, outputDir: join(root, 'build'), clangPath: '/usr/bin/clang', clangRealpath: '/usr/bin/clang',
      sourceSha256: sha256File(sourcePath), clangSha256: sha256File('/usr/bin/clang'), objectSha256: '0'.repeat(64),
      productionSha256: '1'.repeat(64), faultSha256: '2'.repeat(64), hostArchitecture: 'arm64', hostProductVersion: '15.7.4',
    });
    const content = Buffer.from('capability-content\n');
    const contentPath = join(transport, 'content'); writeFileSync(contentPath, content, { flag: 'wx', mode: 0o600 });
    parentFd = openSync(output, fsConstants.O_RDONLY); contentFd = openSync(contentPath, fsConstants.O_RDONLY);
    const stat = statSync(output); const parent = { dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode };
    const record = createDirfdTransactionRecord({
      schema: 'qe-dirfd-transaction-record-v1', launchUuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      savedParent: { path: output, realpath: realpathSync(output), ...parent }, names: { temp: 'probe-temp', final: 'probe-final' },
      content: { length: content.length, sha256: sha256Hex(content) },
      digests: { source: sha256File(sourcePath), core: build.objectSha256, production: build.productionSha256 },
    });
    const durable = writeDirfdTransactionRecord({ path: join(transport, 'authority.json'), record }); recordFd = durable.fd;
    const receipt = await probeDirfdHelperCapability({
      binaryPath: build.productionPath, transactionRecord: record, parentFd, recordFd, contentFd,
    });
    assert.equal(receipt.schema, 'qe-dirfd-capability-probe-v1');
    assert.equal(receipt.alarmExit, 124);
    assert.deepEqual(receipt.alarmCensus, { first: [], second: [], stable: true });
    assert.equal(receipt.receiptSha256.length, 64);
    assert.deepEqual(readFileSync(join(output, 'probe-final')), content);
    await assert.rejects(() => probeDirfdHelperCapability({
      binaryPath: build.faultPath, transactionRecord: record, parentFd, recordFd, contentFd,
    }), /production binary digest|capability/);
  } finally {
    for (const fd of [recordFd, contentFd, parentFd]) if (fd !== undefined) closeSync(fd);
    rmSync(root, { recursive: true, force: true });
  }
});

test('G001-TRANSACTION-OWNER-001 owns descriptors and removes only reaped journal paths idempotently', { concurrency: true }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-owner-'));
  const output = join(root, 'output'); const transport = join(root, 'transport');
  mkdirSync(output, { mode: 0o700 }); mkdirSync(transport, { mode: 0o700 });
  const sourcePath = join(ROOT, 'scripts/native/harness-study-dirfd-helper.c');
  let transaction;
  try {
    const build = compileDirfdHelper({
      sourcePath, outputDir: join(root, 'build'), clangPath: '/usr/bin/clang', clangRealpath: '/usr/bin/clang',
      sourceSha256: sha256File(sourcePath), clangSha256: sha256File('/usr/bin/clang'), objectSha256: '0'.repeat(64),
      productionSha256: '1'.repeat(64), faultSha256: '2'.repeat(64), hostArchitecture: 'arm64', hostProductVersion: '15.7.4',
    });
    const parentStat = statSync(output);
    const record = createDirfdTransactionRecord({
      schema: 'qe-dirfd-transaction-record-v1', launchUuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      savedParent: { path: output, realpath: realpathSync(output), dev: parentStat.dev, ino: parentStat.ino, uid: parentStat.uid, mode: parentStat.mode },
      names: { temp: 'owned-temp', final: 'owned-final' }, content: { length: 0, sha256: sha256Hex(Buffer.alloc(0)) },
      digests: { source: sha256File(sourcePath), core: build.objectSha256, production: build.productionSha256 },
    });
    const recordPath = join(transport, 'authority.json');
    const durable = writeDirfdTransactionRecord({ path: recordPath, record }); closeSync(durable.fd);
    const fdCountBefore = readdirSync('/dev/fd').length;
    transaction = openDirfdTransaction({ recordPath, transactionRecord: record, transportRoot: transport });
    const request = buildDirfdOperationRequest({
      launchUuid: record.launchUuid, operationUuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff', parentPid: process.pid,
      transactionRecordSha256: record.sha256, expectedParent: { dev: parentStat.dev, ino: parentStat.ino, uid: parentStat.uid, mode: parentStat.mode },
      sourceSha256: record.digests.source, coreSha256: record.digests.core, operation: 'inspect', tempName: record.names.temp, finalName: record.names.final,
    });
    const result = await spawnDirfdOperationBounded({
      binaryPath: build.productionPath, request, parentFd: transaction.parentFd, recordFd: transaction.recordFd,
      transactionRecord: record, transaction,
    });
    assert.equal(result.authorityVerified, true);
    assert.ok(existsSync(result.operationJournalPath)); assert.ok(existsSync(result.operationTerminalPath));
    const foreignPath = join(transport, 'foreign'); writeFileSync(foreignPath, 'foreign', { flag: 'wx', mode: 0o600 });
    assert.deepEqual(await transaction.close(), { status: 'permanent-indeterminate', reason: 'foreign transaction transport entry' });
    assert.ok(fstatSync(transaction.parentFd).isDirectory()); assert.ok(existsSync(result.operationJournalPath));
    rmSync(foreignPath);
    const originalRequest = transaction.journals[0].request;
    transaction.journals[0].request = { ...originalRequest, finalName: 'forged-final' };
    assert.deepEqual(await transaction.close(), { status: 'permanent-indeterminate', reason: 'request digest mismatch' });
    transaction.journals[0].request = originalRequest;
    assert.deepEqual(await transaction.close(), { status: 'closed', idempotent: false });
    assert.equal(existsSync(transport), false);
    assert.equal(readdirSync('/dev/fd').length, fdCountBefore);
    assert.deepEqual(await transaction.close(), { status: 'closed', idempotent: true });
    await assert.rejects(() => spawnDirfdOperationBounded({
      binaryPath: build.productionPath, request: { ...request, operationUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' },
      parentFd: transaction.parentFd, recordFd: transaction.recordFd, transactionRecord: record, transaction,
    }), /closed/);
  } finally {
    if (transaction && !transaction.closed) await transaction.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('G001-TRANSACTION-PARENT-001 rejects substituted descriptors and unauthorized parent entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-parent-stable-'));
  const output = join(root, 'output'); const transport = join(root, 'transport');
  mkdirSync(output, { mode: 0o700 }); mkdirSync(transport, { mode: 0o700 });
  let transaction;
  try {
    const parentStat = statSync(output);
    const record = createDirfdTransactionRecord({
      schema: 'qe-dirfd-transaction-record-v1', launchUuid: '12345678-1234-4123-8123-123456789abc',
      savedParent: { path: output, realpath: realpathSync(output), dev: parentStat.dev,
        ino: parentStat.ino, uid: parentStat.uid, mode: parentStat.mode },
      names: { temp: 'stable-temp', final: 'stable-final' },
      content: { length: 0, sha256: sha256Hex(Buffer.alloc(0)) },
      digests: { source: '1'.repeat(64), core: '2'.repeat(64), production: '3'.repeat(64) },
    });
    const recordPath = join(transport, 'record.json');
    const durable = writeDirfdTransactionRecord({ path: recordPath, record }); closeSync(durable.fd);
    transaction = openDirfdTransaction({ recordPath, transactionRecord: record, transportRoot: transport });
    const originalParentFd = transaction.parentFd;
    const foreignDirectory = join(root, 'foreign-directory'); mkdirSync(foreignDirectory, { mode: 0o700 });
    const foreignFd = openSync(foreignDirectory, fsConstants.O_RDONLY);
    transaction.parentFd = foreignFd;
    assert.deepEqual(await transaction.close(), {
      status: 'permanent-indeterminate', reason: 'parent descriptor identity changed',
    });
    transaction.parentFd = originalParentFd; closeSync(foreignFd);
    writeFileSync(join(output, record.names.final), '', { flag: 'wx', mode: 0o600 });
    assert.deepEqual(await transaction.close(), {
      status: 'permanent-indeterminate', reason: 'parent directory entries changed outside authorized publication',
    });
    rmSync(join(output, record.names.final));
    const foreign = join(output, 'foreign-entry'); writeFileSync(foreign, 'foreign', { flag: 'wx', mode: 0o600 });
    assert.deepEqual(await transaction.close(), {
      status: 'permanent-indeterminate', reason: 'parent directory entries changed outside authorized publication',
    });
    rmSync(foreign);
    assert.deepEqual(await transaction.close(), { status: 'closed', idempotent: false });
  } finally {
    if (transaction && !transaction.closed) await transaction.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('G001-PARENT-DEATH-001 recovers after the fd-owning parent dies at mutating and durability boundaries', { concurrency: true }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-parent-death-'));
  const sourcePath = join(ROOT, 'scripts/native/harness-study-dirfd-helper.c');
  const build = compileDirfdHelper({
    sourcePath, outputDir: join(root, 'build'), clangPath: '/usr/bin/clang', clangRealpath: '/usr/bin/clang',
    sourceSha256: sha256File(sourcePath), clangSha256: sha256File('/usr/bin/clang'), objectSha256: '0'.repeat(64),
    productionSha256: '1'.repeat(64), faultSha256: '2'.repeat(64), hostArchitecture: 'arm64', hostProductVersion: '15.7.4',
  });
  const parentProgram = String.raw`
    const c = JSON.parse(process.argv[1]);
    const fs = await import('node:fs'); const cp = await import('node:child_process');
    const m = await import(c.moduleUrl);
    const parentFd = fs.openSync(c.output, fs.constants.O_RDONLY);
    const recordFd = fs.openSync(c.recordPath, fs.constants.O_RDONLY);
    const contentFd = fs.openSync(c.contentPath, fs.constants.O_RDONLY);
    const common = { launchUuid:c.record.launchUuid, parentPid:process.pid, transactionRecordSha256:c.record.sha256,
      expectedParent:c.expectedParent, sourceSha256:c.record.digests.source, coreSha256:c.record.digests.core };
    let seq = 1;
    const request = (operation, specific={}) => m.buildDirfdOperationRequest({ ...common,
      operationUuid:'41000000-0000-4000-8000-' + String(seq++).padStart(12,'0'), operation, ...specific });
    if (c.setupCreate) {
      const setupRequest = request('create-temp', { tempName:c.record.names.temp, expectedTemp:'absent',
        contentLength:c.record.content.length, contentSha256:c.record.content.sha256 });
      const setup = await m.spawnDirfdOperationBounded({ binaryPath:c.productionPath, request:setupRequest,
        parentFd, recordFd, contentFd, transactionRecord:c.record, transactionRoot:c.transport, timeoutMs:2000, killGraceMs:100 });
      if (setup.status !== 0) process.exit(91);
    }
    let specific;
    if (c.operation === 'create-temp') specific = { tempName:c.record.names.temp, expectedTemp:'absent',
      contentLength:c.record.content.length, contentSha256:c.record.content.sha256 };
    else { const s=fs.statSync(c.output + '/' + c.record.names.temp); specific={ tempName:c.record.names.temp,
      tempDev:s.dev,tempIno:s.ino,tempSize:s.size,tempNlink:1,tempSha256:c.record.content.sha256 }; }
    const faultRequest = request(c.operation, specific);
    const binary = m.snapshotDirfdFileIdentity(c.faultPath);
    const intent = m.writeDirfdOperationIntent({ transactionRoot:c.transport, transactionRecord:c.record,
      request:faultRequest, binaryIdentity:binary, parentIdentity:m.snapshotDirfdDescriptorIdentity(parentFd),
      recordIdentity:m.snapshotDirfdDescriptorIdentity(recordFd),
      contentIdentity:c.operation==='create-temp' ? m.snapshotDirfdDescriptorIdentity(contentFd) : null });
    const invocation = m.buildDirfdHelperInvocation({ binaryPath:c.faultPath, request:faultRequest,
      parentFd, recordFd, contentFd:c.operation==='create-temp'?contentFd:null, controlFd:'pipe', ackFd:'pipe' });
    const helper = cp.spawn(invocation.argv[0], invocation.argv.slice(1), invocation);
    let buffered=''; helper.stdio[6].setEncoding('ascii'); helper.stdio[6].on('data', chunk => {
      buffered += chunk; while (buffered.includes('\n')) { const end=buffered.indexOf('\n');
        const boundary=buffered.slice(0,end); buffered=buffered.slice(end+1);
        if (boundary===c.target) process.stdout.write('READY '+JSON.stringify({journal:intent.path,operationUuid:faultRequest.operationUuid})+'\n');
        else helper.stdio[5].write('G');
      }
    });
    await new Promise(() => {});
  `;
  try {
    for (const [index, scenario] of [
      { operation: 'create-temp', target: 'create-temp.file.file-fsync.after', setupCreate: false },
      { operation: 'fsync-temp', target: 'fsync-temp.file.file-fsync.after', setupCreate: true },
    ].entries()) {
      const caseRoot = join(root, `case-${index}`); const output = join(caseRoot, 'output'); const transport = join(caseRoot, 'transport');
      mkdirSync(caseRoot); mkdirSync(output, { mode: 0o700 }); mkdirSync(transport, { mode: 0o700 });
      writeFileSync(join(output, 'foreign-sentinel'), 'untouched', { flag: 'wx', mode: 0o600 });
      const content = Buffer.from(`parent-death-${index}\n`); const contentPath = join(transport, 'content');
      writeFileSync(contentPath, content, { flag: 'wx', mode: 0o600 });
      const s = statSync(output); const expectedParent = { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode };
      const record = createDirfdTransactionRecord({
        schema: 'qe-dirfd-transaction-record-v1', launchUuid: `40000000-0000-4000-8000-00000000000${index + 1}`,
        savedParent: { path: output, realpath: realpathSync(output), ...expectedParent }, names: { temp: 'temp-file', final: 'final-file' },
        content: { length: content.length, sha256: sha256Hex(content) },
        digests: { source: sha256File(sourcePath), core: build.objectSha256, production: build.productionSha256 },
      });
      const recordPath = join(transport, 'authority.json'); const durable = writeDirfdTransactionRecord({ path: recordPath, record }); closeSync(durable.fd);
      const config = { ...scenario, moduleUrl: new URL('../harness-study-dirfd-helper.mjs', import.meta.url).href,
        output, transport, contentPath, recordPath, record, expectedParent,
        productionPath: build.productionPath, faultPath: build.faultPath };
      const parent = spawn(process.execPath, ['--input-type=module', '-e', parentProgram, JSON.stringify(config)], {
        stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      });
      const ready = await new Promise((resolve, reject) => {
        let buffered = ''; const deadline = setTimeout(() => reject(new Error(`parent boundary timeout: ${buffered}`)), 6_000);
        parent.stderr.setEncoding('utf8'); parent.stderr.on('data', chunk => { buffered += ` STDERR:${chunk}`; });
        parent.stdout.setEncoding('utf8'); parent.stdout.on('data', chunk => {
          buffered += chunk; const match = /READY (\{[^\n]+\})\n/.exec(buffered);
          if (match) { clearTimeout(deadline); resolve(JSON.parse(match[1])); }
        });
        parent.once('error', error => { clearTimeout(deadline); reject(error); });
        parent.once('close', (code, signal) => { if (!buffered.includes('READY ')) { clearTimeout(deadline); reject(new Error(`parent exited ${code}/${signal}: ${buffered}`)); } });
      });
      const liveBlocked = await reopenDirfdRecoveryAuthority({
        recordPath, transactionRecord: record, operationJournalPath: ready.journal, quiescenceTimeoutMs: 50,
      });
      assert.equal(liveBlocked.status, 'permanent-indeterminate');
      assert.match(liveBlocked.reason, /two-empty/);
      const parentPid = parent.pid; parent.kill('SIGKILL');
      const parentExit = await new Promise(resolve => parent.once('close', (code, signal) => resolve({ code, signal })));
      assert.deepEqual(parentExit, { code: null, signal: 'SIGKILL' });
      assert.throws(() => process.kill(parentPid, 0));
      const reopened = await reopenDirfdRecoveryAuthority({
        recordPath, transactionRecord: record, operationJournalPath: ready.journal, quiescenceTimeoutMs: 12_000,
      });
      assert.equal(reopened.status, 'reopened', reopened.reason);
      assert.deepEqual(reopened.census, { first: [], second: [], stable: true });
      const contentFd = openSync(contentPath, fsConstants.O_RDONLY); let recoverySequence = 1;
      const invoke = (operation, specific = {}) => {
        const request = buildDirfdOperationRequest({
          launchUuid: record.launchUuid, operationUuid: `42000000-0000-4000-8000-${String(recoverySequence++).padStart(12, '0')}`,
          parentPid: process.pid, transactionRecordSha256: record.sha256, expectedParent,
          sourceSha256: record.digests.source, coreSha256: record.digests.core, operation, ...specific,
        });
        return spawnDirfdOperationBounded({ binaryPath: build.productionPath, request, parentFd: reopened.parentFd,
          recordFd: reopened.recordFd, contentFd: operation === 'create-temp' ? contentFd : null,
          transactionRecord: record, transactionRoot: transport, timeoutMs: 2_000, killGraceMs: 100 });
      };
      const recovery = await normalizeDirfdRecovery({
        inspect: () => invoke('inspect', { tempName: record.names.temp, finalName: record.names.final }), invoke,
        createAuthority: { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 },
      });
      assert.equal(recovery.status, 'complete', `${scenario.target}: ${recovery.reason}`);
      assert.deepEqual(readFileSync(join(output, record.names.final)), content); assert.equal(existsSync(join(output, record.names.temp)), false);
      assert.equal(readFileSync(join(output, 'foreign-sentinel'), 'utf8'), 'untouched');
      closeSync(contentFd); closeSync(reopened.parentFd); closeSync(reopened.recordFd);
      assert.throws(() => fstatSync(reopened.parentFd)); assert.throws(() => fstatSync(reopened.recordFd));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G001-E2E-001 native create rejects forged argv and commits exact bytes through fd3/fd4/fd7', { concurrency: true }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-e2e-'));
  const buildRoot = join(root, 'build');
  const outputRoot = join(root, 'output');
  const transportRoot = join(root, 'transport');
  mkdirSync(outputRoot, { mode: 0o700 });
  mkdirSync(transportRoot, { mode: 0o700 });
  let directoryFd;
  let contentFd;
  let recordFd;
  try {
    const sourcePath = join(ROOT, 'scripts/native/harness-study-dirfd-helper.c');
    const build = compileDirfdHelper({
      sourcePath, outputDir: buildRoot, clangPath: '/usr/bin/clang', clangRealpath: '/usr/bin/clang',
      sourceSha256: sha256File(sourcePath), clangSha256: sha256File('/usr/bin/clang'),
      objectSha256: '0'.repeat(64), productionSha256: '1'.repeat(64), faultSha256: '2'.repeat(64),
      hostArchitecture: 'arm64', hostProductVersion: '15.7.4',
    });
    const content = Buffer.from('native-exact-content\n');
    const contentPath = join(transportRoot, 'content');
    writeFileSync(contentPath, content, { mode: 0o600, flag: 'wx' });
    contentFd = openSync(contentPath, fsConstants.O_RDONLY);
    directoryFd = openSync(outputRoot, fsConstants.O_RDONLY);
    const parentStat = statSync(outputRoot);
    const parent = { dev: parentStat.dev, ino: parentStat.ino, uid: parentStat.uid, mode: parentStat.mode };
    const record = createDirfdTransactionRecord({
      schema: 'qe-dirfd-transaction-record-v1', launchUuid: '11111111-1111-4111-8111-111111111111',
      savedParent: { path: outputRoot, realpath: realpathSync(outputRoot), ...parent },
      names: { temp: 'temp-file', final: 'final-file' },
      content: { length: content.length, sha256: sha256Hex(content) },
      digests: { source: sha256File(sourcePath), core: build.objectSha256, production: build.productionSha256 },
    });
    const durable = writeDirfdTransactionRecord({ path: join(transportRoot, 'authority.json'), record });
    recordFd = durable.fd;
    const request = buildDirfdOperationRequest({
      launchUuid: record.launchUuid, operationUuid: '22222222-2222-4222-8222-222222222222',
      parentPid: process.pid, transactionRecordSha256: record.sha256, expectedParent: parent,
      sourceSha256: record.digests.source, coreSha256: record.digests.core, operation: 'create-temp',
      tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256,
    });
    const forged = buildDirfdHelperInvocation({ binaryPath: build.productionPath, request, parentFd: directoryFd, contentFd, recordFd });
    forged.argv[6] = 'f'.repeat(64);
    const forgedResult = spawnSync(forged.argv[0], forged.argv.slice(1), forged);
    assert.equal(forgedResult.status, 64);
    assert.equal(existsSync(join(outputRoot, 'temp-file')), false);
    const result = await spawnDirfdOperationBounded({ binaryPath: build.productionPath, request, parentFd: directoryFd, contentFd, recordFd, transactionRecord: record });
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.deepEqual(readFileSync(join(outputRoot, 'temp-file')), content);
    const response = parseDirfdNativeResponse(result.stdout.toString());
    assert.equal(response.requestDigest, request.requestSha256);
    assert.equal(response.transactionRecordSha256, record.sha256);

    const tempStat = statSync(join(outputRoot, 'temp-file'));
    const tempAuthority = {
      tempName: record.names.temp, tempDev: tempStat.dev, tempIno: tempStat.ino,
      tempSize: tempStat.size, tempNlink: 1, tempSha256: record.content.sha256,
    };
    const common = {
      launchUuid: record.launchUuid, parentPid: process.pid, transactionRecordSha256: record.sha256,
      expectedParent: parent, sourceSha256: record.digests.source, coreSha256: record.digests.core,
    };
    const runResult = async (operationUuid, operation, specific = {}) => {
      assert.ok(fstatSync(recordFd).isFile());
      const operationRequest = buildDirfdOperationRequest({ ...common, operationUuid, operation, ...specific });
      const operationResult = await spawnDirfdOperationBounded({ binaryPath: build.productionPath, request: operationRequest, parentFd: directoryFd, recordFd, transactionRecord: record });
      assert.equal(operationResult.status, 0, `${operation}: ${operationResult.stderr?.toString()}`);
      return operationResult;
    };
    const run = async (operationUuid, operation, specific = {}) => (await runResult(operationUuid, operation, specific)).response;
    const inspect = suffix => run(`${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}-4${suffix}${suffix}${suffix}-8${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}`, 'inspect', {
      tempName: record.names.temp, finalName: record.names.final,
    });
    assert.equal(classifyDirfdObservedState(await inspect('7')).nextOperation, 'fsync-temp');
    assert.equal((await run('33333333-3333-4333-8333-333333333333', 'fsync-temp', tempAuthority)).committed, true);
    assert.equal((await run('44444444-4444-4444-8444-444444444444', 'link-final', {
      ...tempAuthority, finalName: record.names.final, expectedFinal: 'absent',
    })).committed, true);
    assert.equal(statSync(join(outputRoot, 'temp-file')).ino, statSync(join(outputRoot, 'final-file')).ino);
    assert.equal(statSync(join(outputRoot, 'temp-file')).nlink, 2);
    assert.equal(classifyDirfdObservedState(await inspect('8')).nextOperation, 'fsync-dir');
    assert.equal((await run('55555555-5555-4555-8555-555555555555', 'fsync-dir')).committed, true);
    assert.equal((await run('66666666-6666-4666-8666-666666666666', 'unlink-temp', {
      ...tempAuthority, tempNlink: 2, finalName: record.names.final,
    })).committed, true);
    assert.equal(existsSync(join(outputRoot, 'temp-file')), false);
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);
    assert.equal(classifyDirfdObservedState(await inspect('9')).status, 'complete');
    let recoverySequence = 10;
    const recoveryUuid = () => `cccccccc-cccc-4ccc-8ccc-${(recoverySequence++).toString(16).padStart(12, '0')}`;
    const recovered = await normalizeDirfdRecovery({
      inspect: () => runResult(recoveryUuid(), 'inspect', { tempName: record.names.temp, finalName: record.names.final }),
      invoke: (operation, specific) => runResult(recoveryUuid(), operation, specific),
      createAuthority: { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 },
    });
    assert.equal(recovered.status, 'complete');
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);

    const faultRequest = buildDirfdOperationRequest({
      ...common, operationUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operation: 'inspect',
      tempName: record.names.temp, finalName: record.names.final,
    });
    const faultInvocation = buildDirfdHelperInvocation({
      binaryPath: build.faultPath, request: faultRequest, parentFd: directoryFd, recordFd,
      controlFd: 'pipe', ackFd: 'pipe',
    });
    const faultChild = spawn(faultInvocation.argv[0], faultInvocation.argv.slice(1), faultInvocation);
    const boundary = await new Promise((resolve, reject) => {
      faultChild.once('error', reject);
      faultChild.stdio[6].once('data', chunk => resolve(chunk.toString('ascii').trim()));
    });
    assert.equal(boundary, 'startup.parent.fcntl.before');
    faultChild.kill('SIGTERM');
    const faultExit = await new Promise(resolve => faultChild.once('close', (code, signal) => resolve({ code, signal })));
    assert.deepEqual(faultExit, { code: 143, signal: null });
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);
    const eofRequest = buildDirfdOperationRequest({
      ...common, operationUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', operation: 'inspect',
      tempName: record.names.temp, finalName: record.names.final,
    });
    writeDirfdOperationIntent({
      transactionRoot: transportRoot, transactionRecord: record, request: eofRequest,
      binaryIdentity: snapshotDirfdFileIdentity(build.faultPath), parentIdentity: snapshotDirfdDescriptorIdentity(directoryFd),
      recordIdentity: snapshotDirfdDescriptorIdentity(recordFd), contentIdentity: null,
    });
    const eofInvocation = buildDirfdHelperInvocation({
      binaryPath: build.faultPath, request: eofRequest, parentFd: directoryFd, recordFd,
      controlFd: 'pipe', ackFd: 'pipe',
    });
    const eofChild = spawn(eofInvocation.argv[0], eofInvocation.argv.slice(1), eofInvocation);
    const eofBoundary = await new Promise((resolve, reject) => {
      eofChild.once('error', reject);
      eofChild.stdio[6].once('data', chunk => resolve(chunk.toString('ascii').trim()));
    });
    assert.equal(eofBoundary, 'startup.parent.fcntl.before');
    eofChild.stdio[5].end();
    const eofExit = await new Promise(resolve => eofChild.once('close', (code, signal) => resolve({ code, signal })));
    assert.deepEqual(eofExit, { code: 64, signal: null });
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);
    const boundedRequest = buildDirfdOperationRequest({
      ...common, operationUuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation: 'inspect',
      tempName: record.names.temp, finalName: record.names.final,
    });
    await assert.rejects(() => spawnDirfdOperationBounded({
      binaryPath: build.faultPath, request: boundedRequest, parentFd: directoryFd, recordFd,
      controlFd: 'pipe', ackFd: 'pipe', timeoutMs: 50, killGraceMs: 2_000, transactionRecord: record,
    }), /production binary digest/);
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);
    const extraFd4Invocation = buildDirfdHelperInvocation({
      binaryPath: build.productionPath, request: boundedRequest, parentFd: directoryFd,
      contentFd, recordFd,
    });
    const extraFd4 = spawnSync(extraFd4Invocation.argv[0], extraFd4Invocation.argv.slice(1), extraFd4Invocation);
    assert.equal(extraFd4.status, 64);
    assert.deepEqual(readFileSync(join(outputRoot, 'final-file')), content);

    assert.equal((await reopenDirfdRecoveryAuthority({ recordPath: durable.path, transactionRecord: record })).status,
      'permanent-indeterminate');
    const forgedJournalPath = join(transportRoot, 'forged-intent.json');
    const forgedJournal = JSON.parse(readFileSync(result.operationJournalPath, 'utf8'));
    writeFileSync(forgedJournalPath, `${JSON.stringify({ ...forgedJournal, ownerPid: forgedJournal.ownerPid + 1 })}\n`, { flag: 'wx', mode: 0o600 });
    assert.equal((await reopenDirfdRecoveryAuthority({
      recordPath: durable.path, transactionRecord: record, operationJournalPath: forgedJournalPath,
    })).status, 'permanent-indeterminate');
    const reopened = await reopenDirfdRecoveryAuthority({
      recordPath: durable.path, transactionRecord: record, operationJournalPath: result.operationJournalPath,
    });
    assert.equal(reopened.status, 'reopened');
    closeSync(reopened.parentFd);
    closeSync(reopened.recordFd);
    assert.equal((await reopenDirfdRecoveryAuthority({
      recordPath: durable.path, transactionRecord: { ...record, savedParent: { ...record.savedParent, ino: record.savedParent.ino + 1 } },
      operationJournalPath: result.operationJournalPath,
    })).status, 'permanent-indeterminate');
  } finally {
    for (const fd of [recordFd, contentFd, directoryFd]) if (fd !== undefined) closeSync(fd);
    rmSync(root, { recursive: true, force: true });
  }
});

test('G001-FAULT-ALL-001 injects every generated boundary with deterministic ACK/GO and no foreign mutation or leak', { concurrency: true }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-dirfd-fault-all-'));
  const sourcePath = join(ROOT, 'scripts/native/harness-study-dirfd-helper.c');
  const build = compileDirfdHelper({
    sourcePath, outputDir: join(root, 'build'), clangPath: '/usr/bin/clang', clangRealpath: '/usr/bin/clang',
    sourceSha256: sha256File(sourcePath), clangSha256: sha256File('/usr/bin/clang'),
    objectSha256: '0'.repeat(64), productionSha256: '1'.repeat(64), faultSha256: '2'.repeat(64),
    hostArchitecture: 'arm64', hostProductVersion: '15.7.4',
  });
  const faultBinaryIdentity = snapshotDirfdFileIdentity(build.faultPath);
  const operationFor = boundary => boundary.startsWith('unlink-temp.') ? 'unlink-temp'
    : boundary.startsWith('link-final.') ? 'link-final'
      : boundary.startsWith('fsync-temp.') ? 'fsync-temp'
        : boundary.startsWith('fsync-dir.') ? 'fsync-dir'
          : boundary.startsWith('create-temp.') || boundary.startsWith('startup.content.') ? 'create-temp' : 'inspect';
  try {
    const runFaultCase = async (index, target) => {
      const caseRoot = join(root, `case-${index}`);
      const output = join(caseRoot, 'output');
      const transport = join(caseRoot, 'transport');
      mkdirSync(output, { recursive: true, mode: 0o700 });
      mkdirSync(transport, { mode: 0o700 });
      writeFileSync(join(output, 'foreign-sentinel'), 'untouched', { flag: 'wx', mode: 0o600 });
      const content = Buffer.from(`fault-content-${index}\n`);
      const contentPath = join(transport, 'content');
      writeFileSync(contentPath, content, { flag: 'wx', mode: 0o600 });
      const parentFd = openSync(output, fsConstants.O_RDONLY);
      const contentFd = openSync(contentPath, fsConstants.O_RDONLY);
      let durable; let reopened; let child;
      try {
      const parentStat = statSync(output);
      const expectedParent = { dev: parentStat.dev, ino: parentStat.ino, uid: parentStat.uid, mode: parentStat.mode };
      const tail = (index + 1).toString(16).padStart(12, '0');
      const record = createDirfdTransactionRecord({
        schema: 'qe-dirfd-transaction-record-v1', launchUuid: `10000000-0000-4000-8000-${tail}`,
        savedParent: { path: output, realpath: realpathSync(output), ...expectedParent },
        names: { temp: 'temp-file', final: 'final-file' },
        content: { length: content.length, sha256: sha256Hex(content) },
        digests: { source: sha256File(sourcePath), core: build.objectSha256, production: build.productionSha256 },
      });
      durable = writeDirfdTransactionRecord({ path: join(transport, 'authority.json'), record });
      let sequence = 1;
      const request = (operation, specific = {}) => buildDirfdOperationRequest({
        launchUuid: record.launchUuid,
        operationUuid: `20000000-0000-4000-8000-${(sequence++).toString(16).padStart(12, '0')}`,
        parentPid: process.pid, transactionRecordSha256: record.sha256, expectedParent,
        sourceSha256: record.digests.source, coreSha256: record.digests.core, operation, ...specific,
      });
      const tempFields = nlink => {
        const stat = statSync(join(output, record.names.temp));
        return { tempName: record.names.temp, tempDev: stat.dev, tempIno: stat.ino, tempSize: stat.size, tempNlink: nlink, tempSha256: record.content.sha256 };
      };
      const production = async (operation, specific, includeContent = false) => {
        const opRequest = request(operation, specific);
        const result = await spawnDirfdOperationBounded({
          binaryPath: build.productionPath, request: opRequest, parentFd, recordFd: durable.fd,
          contentFd: includeContent ? contentFd : null, transactionRecord: record, timeoutMs: 2_000, killGraceMs: 100,
        });
        assert.equal(result.status, 0, `${target} setup ${operation}`);
        return result;
      };
      const op = operationFor(target);
      if (op === 'fsync-temp' || op === 'link-final' || op === 'unlink-temp') {
        await production('create-temp', { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 }, true);
      }
      if (op === 'link-final' || op === 'unlink-temp') await production('fsync-temp', tempFields(1));
      if (op === 'unlink-temp') await production('link-final', { ...tempFields(1), finalName: record.names.final, expectedFinal: 'absent' });
      if (target.startsWith('inspect.temp.')) {
        await production('create-temp', { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 }, true);
      }
      if (target.startsWith('inspect.final.')) {
        await production('create-temp', { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 }, true);
        await production('fsync-temp', tempFields(1));
        await production('link-final', { ...tempFields(1), finalName: record.names.final, expectedFinal: 'absent' });
      }
      const specific = op === 'create-temp'
        ? { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 }
        : op === 'fsync-temp' ? tempFields(1)
          : op === 'link-final' ? { ...tempFields(1), finalName: record.names.final, expectedFinal: 'absent' }
            : op === 'unlink-temp' ? { ...tempFields(2), finalName: record.names.final }
              : op === 'inspect' ? { tempName: record.names.temp, finalName: record.names.final } : {};
      const faultRequest = request(op, specific);
      const faultIntent = writeDirfdOperationIntent({
        transactionRoot: transport, transactionRecord: record, request: faultRequest,
        binaryIdentity: faultBinaryIdentity, parentIdentity: snapshotDirfdDescriptorIdentity(parentFd),
        recordIdentity: snapshotDirfdDescriptorIdentity(durable.fd),
        contentIdentity: op === 'create-temp' ? snapshotDirfdDescriptorIdentity(contentFd) : null,
      });
      const invocation = buildDirfdHelperInvocation({
        binaryPath: build.faultPath, request: faultRequest, parentFd, recordFd: durable.fd,
        contentFd: op === 'create-temp' ? contentFd : null, controlFd: 'pipe', ackFd: 'pipe',
      });
      child = spawn(invocation.argv[0], invocation.argv.slice(1), invocation);
      const faultDeadline = setTimeout(() => child.kill('SIGKILL'), 3_000);
      let buffer = '';
      let hitCount = 0;
      const seen = [];
      child.stdio[6].setEncoding('ascii');
      child.stdio[6].on('data', chunk => {
        buffer += chunk;
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          const boundary = buffer.slice(0, end);
          seen.push(boundary);
          buffer = buffer.slice(end + 1);
          if (boundary === target) {
            hitCount += 1;
            child.kill('SIGKILL');
          } else {
            child.stdio[5].write('G');
          }
        }
      });
      const exit = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      clearTimeout(faultDeadline);
      assert.equal(hitCount, 1, `${target}: exit=${JSON.stringify(exit)} seen=${seen.join(',')}`);
      assert.deepEqual(exit, { code: null, signal: 'SIGKILL' }, target);
      assert.equal(readFileSync(join(output, 'foreign-sentinel'), 'utf8'), 'untouched');
      const tempExists = existsSync(join(output, record.names.temp));
      const finalExists = existsSync(join(output, record.names.final));
      const linkCommitted = target.includes('commit.linkat.after') || target.includes('post-path.') || target.includes('link-final.response.');
      const unlinkCommitted = target.includes('commit.unlinkat.after') || target.includes('post-path.') || target.includes('unlink-temp.response.');
      if (op === 'link-final') assert.deepEqual([tempExists, finalExists], linkCommitted ? [true, true] : [true, false]);
      else if (op === 'unlink-temp') assert.deepEqual([tempExists, finalExists], unlinkCommitted ? [false, true] : [true, true]);
      else if (op === 'create-temp') assert.equal(finalExists, false);
      assert.deepEqual(assertDirfdTwoEmptyCensus({
        binaryPath: build.faultPath, launchUuid: faultRequest.launchUuid, operationUuid: faultRequest.operationUuid,
      }), { first: [], second: [] });
      reopened = await reopenDirfdRecoveryAuthority({
        recordPath: durable.path, transactionRecord: record,
        operationJournalPath: faultIntent.path,
      });
      assert.equal(reopened.status, 'reopened', target);
      const recoveryRequest = (operation, recoverySpecific = {}) => buildDirfdOperationRequest({
        launchUuid: record.launchUuid,
        operationUuid: `30000000-0000-4000-8000-${(sequence++).toString(16).padStart(12, '0')}`,
        parentPid: process.pid, transactionRecordSha256: record.sha256, expectedParent,
        sourceSha256: record.digests.source, coreSha256: record.digests.core, operation, ...recoverySpecific,
      });
      const recoverRun = (operation, recoverySpecific = {}) => spawnDirfdOperationBounded({
        binaryPath: build.productionPath, request: recoveryRequest(operation, recoverySpecific),
        parentFd: reopened.parentFd, recordFd: reopened.recordFd,
        contentFd: operation === 'create-temp' ? contentFd : null, transactionRecord: record,
        transactionRoot: transport, timeoutMs: 2_000, killGraceMs: 100,
      });
      const recovery = await normalizeDirfdRecovery({
        inspect: () => recoverRun('inspect', { tempName: record.names.temp, finalName: record.names.final }),
        invoke: recoverRun,
        createAuthority: { tempName: record.names.temp, expectedTemp: 'absent', contentLength: content.length, contentSha256: record.content.sha256 },
      });
      const partialBoundary = target === 'create-temp.file.openat.after' || target === 'create-temp.content-write.write.before';
      if (partialBoundary) {
        assert.equal(recovery.status, 'permanent-indeterminate', target);
        assert.equal(existsSync(join(output, record.names.final)), false, target);
      } else {
        assert.equal(recovery.status, 'complete', `${target}: ${recovery.reason ?? ''}`);
        assert.equal(existsSync(join(output, record.names.temp)), false, target);
        assert.deepEqual(readFileSync(join(output, record.names.final)), content, target);
      }
      assert.equal(readFileSync(join(output, 'foreign-sentinel'), 'utf8'), 'untouched');
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        for (const fd of [reopened?.recordFd, reopened?.parentFd, durable?.fd, contentFd, parentFd]) {
          if (fd !== undefined) { try { closeSync(fd); } catch {} }
        }
      }
    };
    let nextCase = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (nextCase < DIRFD_FAULT_BOUNDARY_MANIFEST.length) {
        const index = nextCase++;
        await runFaultCase(index, DIRFD_FAULT_BOUNDARY_MANIFEST[index]);
      }
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
