import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

export const BASELINE_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const DIRFD_HELPER_ROLE = 'qe-dirfd-helper';
export const DIRFD_HELPER_SCHEMA = 'qe-dirfd-helper-request-v1';
export const DIRFD_TRANSACTION_SCHEMA = 'qe-dirfd-transaction-record-v1';
export const DIRFD_OPERATION_INTENT_SCHEMA = 'qe-dirfd-operation-intent-v1';
export const DIRFD_NATIVE_RESPONSE_SCHEMA = 'qe-dirfd-native-response-v1';
export const DIRFD_BUILD_FLAGS = Object.freeze([
  '-std=c17',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-arch',
  'arm64',
  '-mmacosx-version-min=15.0',
]);
const DIRFD_FAULT_SITES = [
  ['startup.parent', ['fcntl']], ['startup.record', ['fcntl']], ['startup.content', ['fcntl']],
  ['startup.content-absent', ['fcntl']], ['startup.record-read', ['fstat', 'lseek', 'read']],
  ['startup.parent-identity', ['fstat']], ['common.parent', ['fstat']],
  ['create-temp.content-read', ['fstat', 'lseek', 'read']], ['create-temp.file', ['openat', 'fchmod', 'fstat', 'file-fsync', 'close']],
  ['create-temp.content-write', ['write']], ['create-temp.response', ['write']],
  ['fsync-temp.path', ['fstatat']], ['fsync-temp.file', ['openat', 'fstat', 'file-fsync', 'close']],
  ['fsync-temp.data-read', ['fstat', 'lseek', 'read']], ['fsync-temp.response', ['write']],
  ['link-final.temp-path', ['fstatat']], ['link-final.file', ['openat', 'close']],
  ['link-final.data-read', ['fstat', 'lseek', 'read']], ['link-final.final-absent', ['fstatat']],
  ['link-final.commit', ['linkat']], ['link-final.post-path', ['fstatat']], ['link-final.response', ['write']],
  ['unlink-temp.temp-path', ['fstatat']], ['unlink-temp.file', ['openat', 'close']],
  ['unlink-temp.data-read', ['fstat', 'lseek', 'read']], ['unlink-temp.final-path', ['fstatat']],
  ['unlink-temp.commit', ['unlinkat']], ['unlink-temp.post-path', ['fstatat']], ['unlink-temp.response', ['write']],
  ['fsync-dir.parent', ['dir-fsync']], ['fsync-dir.response', ['write']],
  ['inspect.temp', ['fstatat', 'openat', 'fstat', 'lseek', 'read', 'close']],
  ['inspect.final', ['fstatat', 'openat', 'fstat', 'lseek', 'read', 'close']], ['inspect.response', ['write']],
];
export const DIRFD_FAULT_BOUNDARY_MANIFEST = Object.freeze(DIRFD_FAULT_SITES.flatMap(([site, calls]) =>
  calls.flatMap(call => [`${site}.${call}.before`, `${site}.${call}.after`])));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const MAX_CONTENT_LENGTH = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;
const OBJECT_NAME = 'harness-study-dirfd-helper.o';
const PRODUCTION_WRAPPER_NAME = 'harness-study-dirfd-helper.production-wrapper.c';
const FAULT_WRAPPER_NAME = 'harness-study-dirfd-helper.fault-wrapper.c';
const PRODUCTION_BINARY_NAME = 'harness-study-dirfd-helper';
const FAULT_BINARY_NAME = 'harness-study-dirfd-helper-fault';
const ALLOWED_OPS = new Set(['inspect', 'create-temp', 'fsync-temp', 'link-final', 'unlink-temp', 'fsync-dir']);
const ALLOWED_TEMP_STATES = new Set(['absent', 'partial', 'foreign', 'mismatch', 'exact']);
const ALLOWED_FINAL_STATES = new Set(['absent', 'foreign', 'mismatch', 'exact', 'exact-same-inode', 'exact-nlink1', 'exact-nlink2']);
const durableRecordRegistry = new Map();

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
  }
  return value;
}

export function canonicalDirfdJson(value) {
  return JSON.stringify(stableSort(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path) {
  return sha256Hex(readFileSync(path));
}

function assertHex64(value, label) {
  if (!HEX64_RE.test(value || '')) throw new TypeError(`${label} must be a 64-char lowercase sha256 hex digest`);
  return value;
}

function assertUuid(value, label) {
  if (!UUID_RE.test(value || '')) throw new TypeError(`${label} must be a UUID`);
  return value;
}

function compareVersion(left, right) {
  const lhs = String(left).split('.').map(Number);
  const rhs = String(right).split('.').map(Number);
  const limit = Math.max(lhs.length, rhs.length);
  for (let index = 0; index < limit; index += 1) {
    const a = Number.isFinite(lhs[index]) ? lhs[index] : 0;
    const b = Number.isFinite(rhs[index]) ? rhs[index] : 0;
    if (a !== b) return a - b;
  }
  return 0;
}

function parseHostArchitecture(value) {
  const arch = String(value ?? '').trim();
  if (!arch) throw new TypeError('host architecture unavailable');
  return arch;
}

function parseHostVersion(value) {
  const version = String(value ?? '').trim();
  if (!version) throw new TypeError('host product version unavailable');
  return version;
}

function hostArchitecture() {
  const result = spawnSync('/usr/bin/uname', ['-m'], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (result.status !== 0) throw new TypeError('unable to detect host architecture');
  return parseHostArchitecture(result.stdout);
}

function hostProductVersion() {
  const result = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (result.status !== 0) throw new TypeError('unable to detect host product version');
  return parseHostVersion(result.stdout);
}

function validateParentIdentity(value) {
  if (!exactKeys(value, ['dev', 'ino', 'uid', 'mode'])
    || !Number.isSafeInteger(value.dev)
    || !Number.isSafeInteger(value.ino)
    || !Number.isSafeInteger(value.uid)
    || !Number.isSafeInteger(value.mode)) {
    throw new TypeError('invalid parent identity');
  }
  return {
    dev: value.dev,
    ino: value.ino,
    uid: value.uid,
    mode: value.mode,
  };
}

function validateSavedParent(value) {
  if (!exactKeys(value, ['dev', 'ino', 'mode', 'path', 'realpath', 'uid'])
    || typeof value.path !== 'string'
    || typeof value.realpath !== 'string') {
    throw new TypeError('invalid saved parent');
  }
  return {
    path: value.path,
    realpath: value.realpath,
    ...validateParentIdentity({
      dev: value.dev,
      ino: value.ino,
      uid: value.uid,
      mode: value.mode,
    }),
  };
}

function normalizeRecordFields(input) {
  if (!exactKeys(input, ['content', 'digests', 'launchUuid', 'names', 'savedParent', 'schema'])
    || input.schema !== DIRFD_TRANSACTION_SCHEMA) {
    throw new TypeError('invalid transaction record shape');
  }
  return {
    schema: DIRFD_TRANSACTION_SCHEMA,
    launchUuid: assertUuid(input.launchUuid, 'launchUuid'),
    savedParent: validateSavedParent(input.savedParent),
    names: (() => {
      if (!exactKeys(input.names, ['final', 'temp'])) throw new TypeError('invalid names');
      return {
        temp: validateDirfdBasename(input.names.temp),
        final: validateDirfdBasename(input.names.final),
      };
    })(),
    content: (() => {
      if (!exactKeys(input.content, ['length', 'sha256'])
        || !Number.isSafeInteger(input.content.length)
        || input.content.length < 0
        || input.content.length > MAX_CONTENT_LENGTH) {
        throw new TypeError('invalid content');
      }
      return {
        length: input.content.length,
        sha256: assertHex64(input.content.sha256, 'content.sha256'),
      };
    })(),
    digests: (() => {
      if (!exactKeys(input.digests, ['core', 'production', 'source'])) throw new TypeError('invalid digests');
      return {
        source: assertHex64(input.digests.source, 'digests.source'),
        core: assertHex64(input.digests.core, 'digests.core'),
        production: assertHex64(input.digests.production, 'digests.production'),
      };
    })(),
  };
}

export function validateDirfdBasename(value) {
  if (typeof value !== 'string' || !BASELINE_BASENAME_RE.test(value) || value === '.' || value === '..') {
    throw new TypeError('invalid basename');
  }
  return value;
}

export function createDirfdTransactionRecord(input) {
  const record = normalizeRecordFields(input);
  const requestDigest = sha256Hex(JSON.stringify([
    record.schema,
    record.launchUuid,
    record.savedParent.realpath,
    record.savedParent.dev,
    record.savedParent.ino,
    record.savedParent.uid,
    record.savedParent.mode,
    record.names.temp,
    record.names.final,
    record.content.length,
    record.content.sha256,
    record.digests.source,
    record.digests.core,
    record.digests.production,
  ]));
  const sealed = { ...record, requestDigest };
  const sha256 = sha256Hex(JSON.stringify(sealed));
  return { ...sealed, sha256 };
}

/**
 * Persist the transaction authority before the first helper is launched.
 * The returned descriptor is a separately opened read-only descriptor whose
 * identity is stable for the lifetime of the transaction and is suitable for
 * inheritance as child fd 7.
 */
export function writeDirfdTransactionRecord({ path, record }) {
  if (typeof path !== 'string' || path.length === 0 || !plainObject(record)) {
    throw new TypeError('invalid durable transaction record input');
  }
  const transportRoot = realpathSync(dirname(path));
  if (transportRoot === record.savedParent?.realpath) {
    throw new TypeError('transaction transport must not be the canonical parent');
  }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  const expected = createDirfdTransactionRecord({
    schema: record.schema,
    launchUuid: record.launchUuid,
    savedParent: record.savedParent,
    names: record.names,
    content: record.content,
    digests: record.digests,
  });
  if (JSON.stringify(expected) !== JSON.stringify(record)) {
    throw new TypeError('transaction record is not an exact sealed record');
  }
  let writeFd;
  try {
    writeFd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(writeFd, bytes, offset, bytes.length - offset, null);
      if (count <= 0) throw new Error('short transaction record write');
      offset += count;
    }
    fsyncSync(writeFd);
  } finally {
    if (writeFd !== undefined) closeSync(writeFd);
  }
  const fd = openSync(path, fsConstants.O_RDONLY);
  const identity = fstatSync(fd, { bigint: true });
  const actual = Buffer.alloc(bytes.length + 1);
  const count = readSync(fd, actual, 0, actual.length, 0);
  if (count !== bytes.length || !actual.subarray(0, count).equals(bytes)) {
    closeSync(fd);
    throw new TypeError('durable transaction record verification failed');
  }
  const durable = {
    fd,
    path,
    transportRoot,
    length: bytes.length,
    sha256: record.sha256,
    identity: {
      dev: Number(identity.dev),
      ino: Number(identity.ino),
      uid: Number(identity.uid),
      size: Number(identity.size),
      mode: Number(identity.mode),
      nlink: Number(identity.nlink),
    },
  };
  durableRecordRegistry.set(fd, { path, transportRoot, identity: durable.identity });
  return durable;
}

function writeExclusiveDurableJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  let fd;
  try {
    fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset, null);
      if (count <= 0) throw new Error('short durable authority write');
      offset += count;
    }
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const directoryFd = openSync(dirname(path), fsConstants.O_RDONLY);
  try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  return bytes;
}

function exactOperationIdentity(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (!plainObject(value)) throw new TypeError(`invalid ${label} identity`);
  for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'uid']) {
    if (!Number.isSafeInteger(value[field])) throw new TypeError(`invalid ${label} identity`);
  }
  return { dev: value.dev, ino: value.ino, uid: value.uid, mode: value.mode, size: value.size, nlink: value.nlink };
}

function resolveTransactionRoot({ transactionRoot, recordFd, transactionRecord }) {
  const registered = durableRecordRegistry.get(recordFd);
  if (transactionRoot === undefined && registered
    && canonicalDirfdJson(snapshotDirfdDescriptorIdentity(recordFd)) !== canonicalDirfdJson(registered.identity)) {
    durableRecordRegistry.delete(recordFd);
    throw new TypeError('durable record descriptor was closed or reused');
  }
  const requested = transactionRoot ?? registered?.transportRoot;
  if (typeof requested !== 'string') throw new TypeError('durable transaction root is required');
  const root = realpathSync(requested);
  if (root === transactionRecord.savedParent.realpath) throw new TypeError('operation intent cannot use canonical parent');
  if (transactionRoot === undefined && registered && realpathSync(dirname(registered.path)) !== root) {
    throw new TypeError('record is outside transaction root');
  }
  return root;
}

export function openDirfdTransaction({ recordPath, transactionRecord, contentPath = null, transportRoot = dirname(recordPath) }) {
  const root = realpathSync(transportRoot);
  if (root === transactionRecord.savedParent.realpath) throw new TypeError('transaction transport must not be canonical');
  const recordRealpath = realpathSync(recordPath);
  const relativeRecord = relative(root, recordRealpath);
  if (!relativeRecord || relativeRecord.startsWith('..') || resolve(root, relativeRecord) !== recordRealpath) {
    throw new TypeError('transaction record is outside transport root');
  }
  const expected = Buffer.from(`${JSON.stringify(transactionRecord)}\n`);
  const recordFd = openSync(recordPath, fsConstants.O_RDONLY);
  let parentFd; let contentFd;
  try {
    const actual = Buffer.alloc(expected.length + 1);
    const count = readSync(recordFd, actual, 0, actual.length, 0);
    if (count !== expected.length || !actual.subarray(0, count).equals(expected)) throw new TypeError('transaction record bytes mismatch');
    parentFd = openSync(transactionRecord.savedParent.realpath, fsConstants.O_RDONLY);
    const parentIdentity = snapshotDirfdDescriptorIdentity(parentFd);
    const saved = transactionRecord.savedParent;
    if (parentIdentity.dev !== saved.dev || parentIdentity.ino !== saved.ino
      || parentIdentity.uid !== saved.uid || parentIdentity.mode !== saved.mode) throw new TypeError('transaction parent identity mismatch');
    if (contentPath !== null) contentFd = openSync(contentPath, fsConstants.O_RDONLY);
    const authority = {
      schema: 'qe-dirfd-transaction-authority-v1', transportRoot: root, recordPath,
      transactionRecord, parentFd, recordFd, contentFd: contentFd ?? null,
      identities: {
        parent: parentIdentity, record: snapshotDirfdDescriptorIdentity(recordFd),
        content: contentFd === undefined ? null : snapshotDirfdDescriptorIdentity(contentFd),
      },
      journals: [], closed: false,
      async close() {
        if (authority.closed) return { status: 'closed', idempotent: true };
        try {
          const ownedNames = new Set([relative(root, recordRealpath)]);
          if (contentPath !== null) ownedNames.add(relative(root, realpathSync(contentPath)));
          for (const journal of authority.journals) {
            await waitForDirfdTwoEmptyCensus(journal.census, 2_000);
            if (!journal.terminalPath) return { status: 'permanent-indeterminate', reason: 'operation journal has no terminal receipt' };
            const intent = readDirfdOperationIntent(journal.intentPath, transactionRecord);
            readDirfdOperationTerminal(journal.terminalPath, intent.record.sha256);
            if (canonicalDirfdJson(snapshotDirfdFileIdentity(journal.intentPath)) !== canonicalDirfdJson(journal.intentIdentity)
              || canonicalDirfdJson(snapshotDirfdFileIdentity(journal.terminalPath)) !== canonicalDirfdJson(journal.terminalIdentity)) {
              return { status: 'permanent-indeterminate', reason: 'operation journal identity changed' };
            }
            ownedNames.add(relative(root, realpathSync(journal.intentPath)));
            ownedNames.add(relative(root, realpathSync(journal.terminalPath)));
          }
          const actualNames = readdirSync(root).sort();
          if (canonicalDirfdJson(actualNames) !== canonicalDirfdJson([...ownedNames].sort())) {
            return { status: 'permanent-indeterminate', reason: 'foreign transaction transport entry' };
          }
        } catch (error) {
          return { status: 'permanent-indeterminate', reason: error.message };
        }
        for (const [label, fd, identity] of [
          ['parent', authority.parentFd, authority.identities.parent],
          ['record', authority.recordFd, authority.identities.record],
          ['content', authority.contentFd, authority.identities.content],
        ]) {
          if (fd !== null && canonicalDirfdJson(snapshotDirfdDescriptorIdentity(fd)) !== canonicalDirfdJson(identity)) {
            return { status: 'permanent-indeterminate', reason: `${label} descriptor identity changed` };
          }
        }
        for (const fd of [authority.contentFd, authority.recordFd, authority.parentFd]) if (fd !== null) closeSync(fd);
        durableRecordRegistry.delete(authority.recordFd);
        for (const journal of authority.journals) {
          unlinkSync(journal.terminalPath);
          unlinkSync(journal.intentPath);
        }
        unlinkSync(recordPath);
        if (contentPath !== null) unlinkSync(contentPath);
        if (readdirSync(root).length === 0) rmdirSync(root);
        authority.closed = true;
        return { status: 'closed', idempotent: false };
      },
    };
    durableRecordRegistry.set(recordFd, { path: recordPath, transportRoot: root, identity: authority.identities.record });
    return authority;
  } catch (error) {
    for (const fd of [contentFd, parentFd, recordFd]) if (fd !== undefined) { try { closeSync(fd); } catch {} }
    throw error;
  }
}

export function writeDirfdOperationIntent({
  transactionRoot, transactionRecord, request, binaryIdentity,
  parentIdentity, recordIdentity, contentIdentity = null,
  ownerPid = process.pid, sessionUuid = randomUUID(),
}) {
  const root = realpathSync(transactionRoot);
  if (root === transactionRecord?.savedParent?.realpath) throw new TypeError('operation intent cannot use canonical parent');
  const operationUuid = assertUuid(request?.operationUuid, 'operationUuid');
  const core = {
    schema: DIRFD_OPERATION_INTENT_SCHEMA,
    transactionRecordSha256: assertHex64(transactionRecord?.sha256, 'transactionRecordSha256'),
    requestSha256: assertHex64(request?.requestSha256, 'requestSha256'),
    binary: {
      realpath: realpathSync(binaryIdentity?.realpath),
      sha256: assertHex64(binaryIdentity?.sha256, 'binary.sha256'),
      identity: exactOperationIdentity(binaryIdentity, 'binary'),
    },
    launchUuid: assertUuid(request?.launchUuid, 'launchUuid'),
    operationUuid,
    operation: ALLOWED_OPS.has(request?.operation) ? request.operation : (() => { throw new TypeError('invalid intent operation'); })(),
    ownerPid: Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : (() => { throw new TypeError('invalid ownerPid'); })(),
    parentPid: Number.isSafeInteger(request?.parentPid) && request.parentPid > 0 ? request.parentPid : (() => { throw new TypeError('invalid parentPid'); })(),
    sessionUuid: assertUuid(sessionUuid, 'sessionUuid'),
    census: {
      role: DIRFD_HELPER_ROLE,
      executable: realpathSync(binaryIdentity.realpath),
      launchUuid: request.launchUuid,
      operationUuid,
    },
    descriptors: {
      parent: exactOperationIdentity(parentIdentity, 'parent'),
      record: exactOperationIdentity(recordIdentity, 'record'),
      content: exactOperationIdentity(contentIdentity, 'content', true),
    },
  };
  const sha256 = sha256Hex(canonicalDirfdJson(core));
  const record = { ...core, sha256 };
  const path = join(root, `${operationUuid}.intent.json`);
  writeExclusiveDurableJson(path, record);
  return { path, record, sha256, transportRoot: root, identity: snapshotDirfdFileIdentity(path) };
}

function readDirfdOperationIntent(path, transactionRecord) {
  if (typeof path !== 'string') throw new TypeError('operation journal is required');
  const line = readFileSync(path, 'utf8');
  if (!line.endsWith('\n') || line.indexOf('\n') !== line.length - 1) throw new TypeError('operation journal framing mismatch');
  const record = JSON.parse(line.slice(0, -1));
  if (`${JSON.stringify(record)}\n` !== line) throw new TypeError('operation journal bytes are not exact');
  const expectedKeys = ['binary', 'census', 'descriptors', 'launchUuid', 'operation', 'operationUuid', 'ownerPid',
    'parentPid', 'requestSha256', 'schema', 'sessionUuid', 'sha256', 'transactionRecordSha256'];
  if (!exactKeys(record, expectedKeys) || record.schema !== DIRFD_OPERATION_INTENT_SCHEMA) throw new TypeError('operation journal schema mismatch');
  assertUuid(record.launchUuid, 'operation journal launchUuid');
  assertUuid(record.operationUuid, 'operation journal operationUuid');
  assertUuid(record.sessionUuid, 'operation journal sessionUuid');
  assertHex64(record.requestSha256, 'operation journal requestSha256');
  if (!ALLOWED_OPS.has(record.operation) || !Number.isSafeInteger(record.ownerPid) || record.ownerPid <= 0
    || !Number.isSafeInteger(record.parentPid) || record.parentPid <= 0) throw new TypeError('operation journal authority fields invalid');
  if (!exactKeys(record.binary, ['identity', 'realpath', 'sha256']) || typeof record.binary.realpath !== 'string') {
    throw new TypeError('operation journal binary shape mismatch');
  }
  assertHex64(record.binary.sha256, 'operation journal binary sha256');
  exactOperationIdentity(record.binary.identity, 'binary');
  if (!exactKeys(record.descriptors, ['content', 'parent', 'record'])) throw new TypeError('operation journal descriptor shape mismatch');
  exactOperationIdentity(record.descriptors.parent, 'parent');
  exactOperationIdentity(record.descriptors.record, 'record');
  exactOperationIdentity(record.descriptors.content, 'content', true);
  const { sha256, ...core } = record;
  if (sha256 !== sha256Hex(canonicalDirfdJson(core))) throw new TypeError('operation journal digest mismatch');
  if (record.transactionRecordSha256 !== transactionRecord.sha256 || record.launchUuid !== transactionRecord.launchUuid) {
    throw new TypeError('operation journal transaction binding mismatch');
  }
  if (!exactKeys(record.census, ['executable', 'launchUuid', 'operationUuid', 'role'])
    || record.census.role !== DIRFD_HELPER_ROLE || record.census.launchUuid !== record.launchUuid
    || record.census.operationUuid !== record.operationUuid) throw new TypeError('operation journal census binding mismatch');
  const binary = snapshotDirfdFileIdentity(record.binary.realpath);
  if (binary.sha256 !== record.binary.sha256
    || canonicalDirfdJson(exactOperationIdentity(binary, 'binary')) !== canonicalDirfdJson(record.binary.identity)) {
    throw new TypeError('operation journal binary identity mismatch');
  }
  return { path, record, bytes: Buffer.from(line) };
}

function writeDirfdOperationTerminal(intent, result) {
  const core = {
    schema: 'qe-dirfd-operation-terminal-v1', intentSha256: intent.sha256,
    launchUuid: intent.record.launchUuid, operationUuid: intent.record.operationUuid,
    status: result.code, signal: result.signal, timedOut: result.timedOut === true,
    reaped: result.reaped === true, census: result.census,
  };
  const record = { ...core, sha256: sha256Hex(canonicalDirfdJson(core)) };
  const path = join(intent.transportRoot, `${intent.record.operationUuid}.terminal.json`);
  writeExclusiveDurableJson(path, record);
  return { path, record, identity: snapshotDirfdFileIdentity(path) };
}

function readDirfdOperationTerminal(path, intentSha256) {
  const line = readFileSync(path, 'utf8');
  if (!line.endsWith('\n') || line.indexOf('\n') !== line.length - 1) throw new TypeError('operation terminal framing mismatch');
  const record = JSON.parse(line.slice(0, -1));
  if (`${JSON.stringify(record)}\n` !== line
    || !exactKeys(record, ['census', 'intentSha256', 'launchUuid', 'operationUuid', 'reaped', 'schema', 'sha256', 'signal', 'status', 'timedOut'])
    || record.schema !== 'qe-dirfd-operation-terminal-v1' || record.intentSha256 !== intentSha256 || record.reaped !== true) {
    throw new TypeError('operation terminal authority mismatch');
  }
  const { sha256, ...core } = record;
  if (sha256 !== sha256Hex(canonicalDirfdJson(core))
    || !plainObject(record.census) || record.census.first?.length !== 0 || record.census.second?.length !== 0) {
    throw new TypeError('operation terminal digest or census mismatch');
  }
  return record;
}

function commonRequestShape(input) {
  if (!plainObject(input) || input.role !== DIRFD_HELPER_ROLE) throw new TypeError('invalid request role');
  return {
    role: input.role,
    launchUuid: assertUuid(input.launchUuid, 'launchUuid'),
    operationUuid: assertUuid(input.operationUuid, 'operationUuid'),
    parentPid: Number.isSafeInteger(input.parentPid) && input.parentPid > 0 ? input.parentPid : (() => { throw new TypeError('invalid parentPid'); })(),
    transactionRecordSha256: assertHex64(input.transactionRecordSha256, 'transactionRecordSha256'),
    requestSha256: assertHex64(input.requestSha256, 'requestSha256'),
    expectedParent: validateParentIdentity(input.expectedParent),
    sourceSha256: assertHex64(input.sourceSha256, 'sourceSha256'),
    coreSha256: assertHex64(input.coreSha256, 'coreSha256'),
    operation: input.operation,
  };
}

function operationKeys(operation) {
  switch (operation) {
    case 'inspect':
      return ['coreSha256', 'expectedParent', 'finalName', 'launchUuid', 'operation', 'operationUuid',
        'parentPid', 'requestSha256', 'role', 'sourceSha256', 'tempName', 'transactionRecordSha256'];
    case 'create-temp':
      return ['contentLength', 'contentSha256', 'coreSha256', 'expectedParent', 'expectedTemp', 'launchUuid',
        'operation', 'operationUuid', 'parentPid', 'requestSha256', 'role', 'sourceSha256', 'tempName',
        'transactionRecordSha256'];
    case 'fsync-temp':
      return ['coreSha256', 'expectedParent', 'launchUuid', 'operation', 'operationUuid', 'parentPid',
        'requestSha256', 'role', 'sourceSha256', 'tempDev', 'tempIno', 'tempName', 'tempNlink',
        'tempSha256', 'tempSize', 'transactionRecordSha256'];
    case 'link-final':
      return ['coreSha256', 'expectedFinal', 'expectedParent', 'launchUuid', 'operation', 'operationUuid',
        'parentPid', 'requestSha256', 'role', 'sourceSha256', 'finalName', 'tempDev', 'tempIno', 'tempName',
        'tempNlink', 'tempSha256', 'tempSize', 'transactionRecordSha256'];
    case 'unlink-temp':
      return ['coreSha256', 'expectedParent', 'launchUuid', 'operation', 'operationUuid', 'parentPid',
        'requestSha256', 'role', 'sourceSha256', 'finalName', 'tempDev', 'tempIno', 'tempName', 'tempNlink',
        'tempSha256', 'tempSize', 'transactionRecordSha256'];
    case 'fsync-dir':
      return ['coreSha256', 'expectedParent', 'launchUuid', 'operation', 'operationUuid', 'parentPid',
        'requestSha256', 'role', 'sourceSha256', 'transactionRecordSha256'];
    default:
      throw new TypeError('unsupported operation');
  }
}

function validateOperationSpecificRequest(operation, input) {
  switch (operation) {
    case 'inspect':
      if (!exactKeys(input, operationKeys(operation))) throw new TypeError('invalid inspect request shape');
      return {
        tempName: validateDirfdBasename(input.tempName),
        finalName: validateDirfdBasename(input.finalName),
      };
    case 'create-temp':
      if (!exactKeys(input, operationKeys(operation))
        || input.expectedTemp !== 'absent'
        || !Number.isSafeInteger(input.contentLength)
        || input.contentLength < 0
        || input.contentLength > MAX_CONTENT_LENGTH) {
        throw new TypeError('invalid create-temp request shape');
      }
      return {
        tempName: validateDirfdBasename(input.tempName),
        expectedTemp: input.expectedTemp,
        contentLength: input.contentLength,
        contentSha256: assertHex64(input.contentSha256, 'contentSha256'),
      };
    case 'fsync-temp':
      if (!exactKeys(input, operationKeys(operation))
        || !Number.isSafeInteger(input.tempDev)
        || !Number.isSafeInteger(input.tempIno)
        || !Number.isSafeInteger(input.tempSize)
        || !Number.isSafeInteger(input.tempNlink)
        || input.tempNlink !== 1) {
        throw new TypeError('invalid fsync-temp request shape');
      }
      return {
        tempName: validateDirfdBasename(input.tempName),
        tempDev: input.tempDev,
        tempIno: input.tempIno,
        tempSize: input.tempSize,
        tempNlink: input.tempNlink,
        tempSha256: assertHex64(input.tempSha256, 'tempSha256'),
      };
    case 'link-final':
      if (!exactKeys(input, operationKeys(operation))
        || input.expectedFinal !== 'absent'
        || !Number.isSafeInteger(input.tempDev)
        || !Number.isSafeInteger(input.tempIno)
        || !Number.isSafeInteger(input.tempSize)
        || !Number.isSafeInteger(input.tempNlink)
        || input.tempNlink !== 1) {
        throw new TypeError('invalid link-final request shape');
      }
      return {
        tempName: validateDirfdBasename(input.tempName),
        finalName: validateDirfdBasename(input.finalName),
        expectedFinal: input.expectedFinal,
        tempDev: input.tempDev,
        tempIno: input.tempIno,
        tempSize: input.tempSize,
        tempNlink: input.tempNlink,
        tempSha256: assertHex64(input.tempSha256, 'tempSha256'),
      };
    case 'unlink-temp':
      if (!exactKeys(input, operationKeys(operation))
        || !Number.isSafeInteger(input.tempDev)
        || !Number.isSafeInteger(input.tempIno)
        || !Number.isSafeInteger(input.tempSize)
        || !Number.isSafeInteger(input.tempNlink)
        || input.tempNlink !== 2) {
        throw new TypeError('invalid unlink-temp request shape');
      }
      return {
        tempName: validateDirfdBasename(input.tempName),
        finalName: validateDirfdBasename(input.finalName),
        tempDev: input.tempDev,
        tempIno: input.tempIno,
        tempSize: input.tempSize,
        tempNlink: input.tempNlink,
        tempSha256: assertHex64(input.tempSha256, 'tempSha256'),
      };
    case 'fsync-dir':
      if (!exactKeys(input, operationKeys(operation))) throw new TypeError('invalid fsync-dir request shape');
      return {};
    default:
      throw new TypeError('unsupported operation');
  }
}

export function validateDirfdOperationRequest(input) {
  const common = commonRequestShape(input);
  if (!ALLOWED_OPS.has(common.operation)) throw new TypeError('unsupported operation');
  const specific = validateOperationSpecificRequest(common.operation, input);
  const requestDigest = sha256Hex(JSON.stringify({
    role: common.role,
    launchUuid: common.launchUuid,
    operationUuid: common.operationUuid,
    parentPid: common.parentPid,
    transactionRecordSha256: common.transactionRecordSha256,
    expectedParent: common.expectedParent,
    sourceSha256: common.sourceSha256,
    coreSha256: common.coreSha256,
    operation: common.operation,
    ...specific,
  }));
  if (requestDigest !== common.requestSha256) throw new TypeError('request digest mismatch');
  return { ...common, ...specific, requestDigest };
}

export function buildDirfdOperationRequest(input) {
  const request = {
    role: DIRFD_HELPER_ROLE,
    ...input,
  };
  const requestDigest = sha256Hex(JSON.stringify({
    role: request.role,
    launchUuid: request.launchUuid,
    operationUuid: request.operationUuid,
    parentPid: request.parentPid,
    transactionRecordSha256: request.transactionRecordSha256,
    expectedParent: request.expectedParent,
    sourceSha256: request.sourceSha256,
    coreSha256: request.coreSha256,
    operation: request.operation,
    ...(request.operation === 'inspect' ? { tempName: request.tempName, finalName: request.finalName }
      : request.operation === 'create-temp' ? {
        tempName: request.tempName,
        expectedTemp: request.expectedTemp,
        contentLength: request.contentLength,
        contentSha256: request.contentSha256,
      }
        : request.operation === 'fsync-temp' ? {
          tempName: request.tempName, tempDev: request.tempDev, tempIno: request.tempIno,
          tempSize: request.tempSize, tempNlink: request.tempNlink, tempSha256: request.tempSha256,
        }
          : request.operation === 'link-final' ? {
            tempName: request.tempName, finalName: request.finalName, expectedFinal: request.expectedFinal,
            tempDev: request.tempDev, tempIno: request.tempIno, tempSize: request.tempSize,
            tempNlink: request.tempNlink, tempSha256: request.tempSha256,
          }
            : request.operation === 'unlink-temp' ? {
              tempName: request.tempName, finalName: request.finalName, tempDev: request.tempDev,
              tempIno: request.tempIno, tempSize: request.tempSize, tempNlink: request.tempNlink,
              tempSha256: request.tempSha256,
            }
              : {}),
  }));
  return { ...request, requestSha256: requestDigest };
}

export function canonicalDirfdRequestJson(request) {
  const validated = validateDirfdOperationRequest(request);
  const { requestDigest: ignored, ...withoutDerivedDigest } = validated;
  void ignored;
  return JSON.stringify({ ...withoutDerivedDigest, requestSha256: request.requestSha256 });
}

export function buildDirfdHelperInvocation({
  binaryPath,
  request,
  requestJson = canonicalDirfdRequestJson(request),
  parentFd = 3,
  contentFd = null,
  recordFd = 7,
  controlFd = null,
  ackFd = null,
  extraStdio = [],
}) {
  const executablePath = realpathSync(binaryPath);
  const argv = [
    executablePath,
    request.role,
    request.launchUuid,
    request.operationUuid,
    String(request.parentPid),
    request.transactionRecordSha256,
    request.requestSha256,
    String(request.expectedParent.dev),
    String(request.expectedParent.ino),
    String(request.expectedParent.uid),
    String(request.expectedParent.mode),
    request.sourceSha256,
    request.coreSha256,
    request.operation,
    requestJson,
  ];
  const stdio = ['ignore', 'pipe', 'pipe'];
  stdio[3] = parentFd;
  stdio[4] = contentFd !== null && contentFd !== undefined ? contentFd : recordFd;
  stdio[5] = controlFd !== null && controlFd !== undefined ? controlFd : 'ignore';
  stdio[6] = ackFd !== null && ackFd !== undefined ? ackFd : 'ignore';
  if (recordFd !== null && recordFd !== undefined) stdio[7] = recordFd;
  for (const entry of extraStdio) stdio[entry.index] = entry.value;
  return {
    argv,
    env: {
      LC_ALL: 'C',
      LANG: 'C',
      TMPDIR: request.tempRoot ?? '/tmp',
    },
    stdio,
    shell: false,
    detached: true,
    timeout: MAX_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  };
}

function validateDirfdProductionAuthority(options) {
  if (options?.transaction) {
    if (options.transaction.closed === true) throw new TypeError('transaction authority is closed');
    const ownedContentFd = options.request?.operation === 'create-temp' ? options.transaction.contentFd : null;
    if (options.parentFd !== options.transaction.parentFd || options.recordFd !== options.transaction.recordFd
      || (options.contentFd ?? null) !== ownedContentFd) {
      throw new TypeError('operation descriptors are not owned by transaction authority');
    }
  }
  if (!plainObject(options?.transactionRecord)) throw new TypeError('transactionRecord is required');
  const transactionRecord = options.transactionRecord;
  const resealed = createDirfdTransactionRecord({
    schema: transactionRecord.schema, launchUuid: transactionRecord.launchUuid,
    savedParent: transactionRecord.savedParent, names: transactionRecord.names,
    content: transactionRecord.content, digests: transactionRecord.digests,
  });
  if (JSON.stringify(resealed) !== JSON.stringify(transactionRecord)) throw new TypeError('transactionRecord is not exact or digest-valid');
  if (transactionRecord.sha256 !== options.request?.transactionRecordSha256
    || transactionRecord.digests?.source !== options.request?.sourceSha256
    || transactionRecord.digests?.core !== options.request?.coreSha256) {
    throw new TypeError('request is not bound to the transaction record');
  }
  const invocation = buildDirfdHelperInvocation(options);
  const binaryBefore = snapshotDirfdFileIdentity(invocation.argv[0]);
  if (binaryBefore.sha256 !== transactionRecord.digests?.production) {
    throw new TypeError('production binary digest is not bound to the transaction record');
  }
  const parentBefore = snapshotDirfdDescriptorIdentity(options.parentFd);
  const recordBefore = snapshotDirfdDescriptorIdentity(options.recordFd);
  const contentBefore = options.contentFd === null || options.contentFd === undefined
    ? null : snapshotDirfdDescriptorIdentity(options.contentFd);
  const expectedParent = transactionRecord.savedParent;
  if (parentBefore.dev !== expectedParent.dev || parentBefore.ino !== expectedParent.ino
    || parentBefore.uid !== expectedParent.uid || parentBefore.mode !== expectedParent.mode) {
    throw new TypeError('parent descriptor is not bound to the transaction record');
  }
  const recordBytes = Buffer.from(`${JSON.stringify(transactionRecord)}\n`);
  const actualRecord = Buffer.alloc(recordBefore.size + 1);
  const recordCount = readSync(options.recordFd, actualRecord, 0, actualRecord.length, 0);
  if (recordCount !== recordBytes.length || !actualRecord.subarray(0, recordCount).equals(recordBytes)) {
    throw new TypeError('record descriptor bytes mismatch');
  }
  if (options.request.operation === 'create-temp') {
    if (contentBefore === null || (contentBefore.mode & fsConstants.S_IFMT) !== fsConstants.S_IFREG
      || contentBefore.size !== transactionRecord.content.length) throw new TypeError('content descriptor mismatch');
    const bytes = Buffer.alloc(contentBefore.size + 1);
    const count = readSync(options.contentFd, bytes, 0, bytes.length, 0);
    if (count !== contentBefore.size || sha256Hex(bytes.subarray(0, count)) !== transactionRecord.content.sha256) {
      throw new TypeError('content descriptor digest mismatch');
    }
  } else if (contentBefore !== null) {
    throw new TypeError('content descriptor forbidden for non-create operation');
  }
  const transactionRoot = resolveTransactionRoot({
    transactionRoot: options.transactionRoot ?? options.transaction?.transportRoot,
    recordFd: options.recordFd,
    transactionRecord,
  });
  return { invocation, transactionRecord, binaryBefore, parentBefore, recordBefore, contentBefore, transactionRoot };
}

function verifyDirfdProductionAuthorityAfter(options, authority, result) {
  const { invocation, transactionRecord, binaryBefore, parentBefore, recordBefore, contentBefore } = authority;
  const binaryAfter = snapshotDirfdFileIdentity(invocation.argv[0]);
  const parentAfter = snapshotDirfdDescriptorIdentity(options.parentFd);
  const recordAfter = snapshotDirfdDescriptorIdentity(options.recordFd);
  const contentAfter = contentBefore === null ? null : snapshotDirfdDescriptorIdentity(options.contentFd);
  const stableParent = ({ dev, ino, uid, mode }) => ({ dev, ino, uid, mode });
  for (const [label, before, after] of [
    ['binary', binaryBefore, binaryAfter], ['parent fd', stableParent(parentBefore), stableParent(parentAfter)],
    ['record fd', recordBefore, recordAfter], ['content fd', contentBefore, contentAfter],
  ]) {
    if (before !== null && canonicalDirfdJson(before) !== canonicalDirfdJson(after)) {
      throw new TypeError(`${label} identity changed across helper execution`);
    }
  }
  result.verifiedIdentity = { binary: binaryAfter, parent: parentAfter, record: recordAfter, content: contentAfter };
  if (result.status === 0 || result.code === 0) {
    const response = parseDirfdNativeResponse(result.stdout.toString());
    if (response.requestDigest !== options.request.requestSha256
      || response.transactionRecordSha256 !== transactionRecord.sha256
      || response.sourceSha256 !== transactionRecord.digests.source
      || response.coreSha256 !== transactionRecord.digests.core) {
      throw new TypeError('native response authority mismatch');
    }
    result.response = response;
    result.authorityVerified = true;
  }
  return result;
}

export function snapshotDirfdDescriptorIdentity(fd) {
  if (!Number.isInteger(fd) || fd < 0) throw new TypeError('invalid descriptor');
  const value = fstatSync(fd, { bigint: true });
  return {
    dev: Number(value.dev), ino: Number(value.ino), uid: Number(value.uid), mode: Number(value.mode),
    size: Number(value.size), nlink: Number(value.nlink),
  };
}

export function snapshotDirfdFileIdentity(path) {
  const realpathBefore = realpathSync(path);
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    const before = snapshotDirfdDescriptorIdentity(fd);
    if ((before.mode & fsConstants.S_IFMT) !== fsConstants.S_IFREG || before.size < 0 || before.size > 64 * 1024 * 1024) {
      throw new TypeError('binary is not a bounded regular file');
    }
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (count <= 0) throw new TypeError('short binary read');
      hash.update(chunk.subarray(0, count));
      offset += count;
    }
    if (readSync(fd, chunk, 0, 1, offset) !== 0) throw new TypeError('binary grew during hash');
    const after = snapshotDirfdDescriptorIdentity(fd);
    if (canonicalDirfdJson(before) !== canonicalDirfdJson(after)) throw new TypeError('binary identity changed during hash');
    const realpathAfter = realpathSync(path);
    if (realpathBefore !== realpathAfter) throw new TypeError('binary realpath changed during hash');
    return { ...after, sha256: hash.digest('hex'), realpath: realpathAfter };
  } finally {
    closeSync(fd);
  }
}

export function parseDirfdProcessCensus(text, { binaryPath, launchUuid, operationUuid }) {
  if (typeof text !== 'string' || !text.endsWith('\n')) throw new TypeError('process census output is truncated');
  const executable = realpathSync(binaryPath);
  const matches = [];
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) {
      if (line.trim()) throw new TypeError('malformed process census line');
      continue;
    }
    const command = match[2];
    if (!(command === executable || command.startsWith(`${executable} `))) continue;
    const argv = command === executable ? [] : command.slice(executable.length + 1).split(/\s+/);
    if (argv[0] !== DIRFD_HELPER_ROLE) continue;
    if (argv[1] !== launchUuid) continue;
    if (argv.length < 3 || argv[2] !== operationUuid) throw new TypeError('matching helper argv is truncated or ambiguous');
    matches.push(Number(match[1]));
  }
  return matches;
}

export function censusDirfdHelperProcesses({ binaryPath, launchUuid, operationUuid }) {
  const result = spawnSync('/bin/ps', ['-ww', '-axo', 'pid=,command='], {
    encoding: 'utf8', shell: false, timeout: 5_000, env: { LC_ALL: 'C', LANG: 'C' },
  });
  if (result.status !== 0) throw new Error('process census failed');
  return parseDirfdProcessCensus(result.stdout, { binaryPath, launchUuid, operationUuid });
}

export function assertDirfdTwoEmptyCensus(authority) {
  const first = censusDirfdHelperProcesses(authority);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  const second = censusDirfdHelperProcesses(authority);
  if (first.length !== 0 || second.length !== 0) throw new Error('helper process census is not two-empty');
  return { first, second };
}

let sharedCensusSnapshot = { settledAt: 0, promise: null };

function sharedDirfdPsSnapshot() {
  const now = Date.now();
  if (sharedCensusSnapshot.promise
    && (sharedCensusSnapshot.settledAt === 0 || now - sharedCensusSnapshot.settledAt <= 8)) {
    return sharedCensusSnapshot.promise;
  }
  const promise = new Promise((resolve, reject) => {
    const child = spawn('/bin/ps', ['-ww', '-axo', 'pid=,command='], {
      shell: false, env: { LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = []; const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(`process census failed: ${Buffer.concat(stderr).toString('utf8')}`)));
  });
  const snapshot = { settledAt: 0, promise };
  sharedCensusSnapshot = snapshot;
  promise.then(() => { snapshot.settledAt = Date.now(); }, () => { snapshot.settledAt = Date.now(); });
  return promise;
}

async function assertDirfdTwoEmptyCensusAsync(authority) {
  const first = parseDirfdProcessCensus(await sharedDirfdPsSnapshot(), authority);
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = parseDirfdProcessCensus(await sharedDirfdPsSnapshot(), authority);
  if (first.length !== 0 || second.length !== 0) throw new Error('helper process census is not two-empty');
  return { first, second };
}

async function waitForDirfdTwoEmptyCensus(authority, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const first = parseDirfdProcessCensus(await sharedDirfdPsSnapshot(), authority);
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = parseDirfdProcessCensus(await sharedDirfdPsSnapshot(), authority);
    if (first.length === 0 && second.length === 0) return { first, second, stable: true };
    if (Date.now() >= deadline) throw new Error('helper process census did not become two-empty');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export async function spawnDirfdOperationBounded(options) {
  const timeoutMs = options.timeoutMs ?? MAX_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? 2_000;
  const authority = validateDirfdProductionAuthority(options);
  const { invocation } = authority;
  const intent = writeDirfdOperationIntent({
    transactionRoot: authority.transactionRoot,
    transactionRecord: authority.transactionRecord,
    request: options.request,
    binaryIdentity: authority.binaryBefore,
    parentIdentity: authority.parentBefore,
    recordIdentity: authority.recordBefore,
    contentIdentity: authority.contentBefore,
    sessionUuid: options.sessionUuid ?? randomUUID(),
  });
  let child;
  try {
    child = spawn(invocation.argv[0], invocation.argv.slice(1), { ...invocation, timeout: undefined, maxBuffer: undefined });
  } catch (error) {
    const census = await waitForDirfdTwoEmptyCensus({
      binaryPath: invocation.argv[0], launchUuid: options.request.launchUuid, operationUuid: options.request.operationUuid,
    }, 2_000);
    writeDirfdOperationTerminal(intent, { code: null, signal: null, timedOut: false, reaped: true, census });
    throw error;
  }
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let killTimer;
  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    timedOut = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, killGraceMs);
  };
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > invocation.maxBuffer) terminate(); else stdout.push(chunk);
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > invocation.maxBuffer) terminate(); else stderr.push(chunk);
  });
  const timeout = setTimeout(terminate, timeoutMs);
  const completion = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  if (killTimer) clearTimeout(killTimer);
  const census = await waitForDirfdTwoEmptyCensus({
    binaryPath: invocation.argv[0], launchUuid: options.request.launchUuid, operationUuid: options.request.operationUuid,
  }, 2_000);
  const result = { ...completion, status: completion.code, timedOut, reaped: true, census,
    stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
    operationJournalPath: intent.path, operationJournalSha256: intent.sha256 };
  const terminal = writeDirfdOperationTerminal(intent, result);
  result.operationTerminalPath = terminal.path;
  if (options.transaction) options.transaction.journals.push({
    intentPath: intent.path, terminalPath: terminal.path,
    intentIdentity: intent.identity, terminalIdentity: terminal.identity,
    census: { binaryPath: invocation.argv[0], launchUuid: options.request.launchUuid, operationUuid: options.request.operationUuid },
  });
  if (completion.error) throw completion.error;
  return verifyDirfdProductionAuthorityAfter(options, authority, result);
}

export async function probeDirfdHelperCapability({ binaryPath, transactionRecord, parentFd, recordFd, contentFd }) {
  const common = {
    launchUuid: transactionRecord.launchUuid,
    parentPid: process.pid,
    transactionRecordSha256: transactionRecord.sha256,
    expectedParent: {
      dev: transactionRecord.savedParent.dev, ino: transactionRecord.savedParent.ino,
      uid: transactionRecord.savedParent.uid, mode: transactionRecord.savedParent.mode,
    },
    sourceSha256: transactionRecord.digests.source,
    coreSha256: transactionRecord.digests.core,
  };
  const execute = async (operation, specific = {}, includeContent = false) => {
    const request = buildDirfdOperationRequest({ ...common, operationUuid: randomUUID(), operation, ...specific });
    const result = await spawnDirfdOperationBounded({
      binaryPath, request, parentFd, recordFd, contentFd: includeContent ? contentFd : null, transactionRecord,
    });
    if (result.status !== 0 || result.response?.op !== operation) throw new TypeError(`capability ${operation} failed`);
    return result.response;
  };
  const names = transactionRecord.names;
  await execute('create-temp', {
    tempName: names.temp, expectedTemp: 'absent', contentLength: transactionRecord.content.length,
    contentSha256: transactionRecord.content.sha256,
  }, true);
  const tempStat = statSync(join(transactionRecord.savedParent.realpath, names.temp));
  const temp = {
    tempName: names.temp, tempDev: tempStat.dev, tempIno: tempStat.ino, tempSize: tempStat.size,
    tempNlink: 1, tempSha256: transactionRecord.content.sha256,
  };
  await execute('fsync-temp', temp);
  await execute('link-final', { ...temp, finalName: names.final, expectedFinal: 'absent' });
  await execute('fsync-dir');
  await execute('unlink-temp', { ...temp, tempNlink: 2, finalName: names.final });
  await execute('fsync-dir');
  const inspected = await execute('inspect', { tempName: names.temp, finalName: names.final });
  if (classifyDirfdObservedState(inspected).status !== 'complete'
    || sha256File(join(transactionRecord.savedParent.realpath, names.final)) !== transactionRecord.content.sha256) {
    throw new TypeError('capability final state mismatch');
  }
  const alarmRequest = buildDirfdOperationRequest({
    ...common, operationUuid: randomUUID(), operation: 'inspect', tempName: names.temp, finalName: names.final,
  });
  const alarmBinaryPath = join(dirname(realpathSync(binaryPath)), FAULT_BINARY_NAME);
  const alarmBinary = snapshotDirfdFileIdentity(alarmBinaryPath);
  const alarmRoot = resolveTransactionRoot({ recordFd, transactionRecord });
  const alarmIntent = writeDirfdOperationIntent({
    transactionRoot: alarmRoot, transactionRecord, request: alarmRequest, binaryIdentity: alarmBinary,
    parentIdentity: snapshotDirfdDescriptorIdentity(parentFd), recordIdentity: snapshotDirfdDescriptorIdentity(recordFd),
  });
  const alarmInvocation = buildDirfdHelperInvocation({
    binaryPath: alarmBinaryPath, request: alarmRequest, parentFd, recordFd, controlFd: 'pipe', ackFd: 'pipe',
  });
  const alarmChild = spawn(alarmInvocation.argv[0], alarmInvocation.argv.slice(1), {
    ...alarmInvocation, timeout: undefined, maxBuffer: undefined,
  });
  let alarmAck = '';
  alarmChild.stdio[6].setEncoding('ascii');
  alarmChild.stdio[6].on('data', chunk => { alarmAck += chunk; });
  const alarmDeadline = setTimeout(() => alarmChild.kill('SIGKILL'), 12_000);
  const alarmCompletion = await new Promise((resolve, reject) => {
    alarmChild.once('error', reject);
    alarmChild.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(alarmDeadline);
  const alarmCensus = await waitForDirfdTwoEmptyCensus({
    binaryPath: alarmBinaryPath, launchUuid: alarmRequest.launchUuid, operationUuid: alarmRequest.operationUuid,
  }, 2_000);
  const alarmResult = { ...alarmCompletion, timedOut: false, reaped: true, census: alarmCensus };
  writeDirfdOperationTerminal(alarmIntent, alarmResult);
  if (alarmCompletion.code !== 124 || alarmCompletion.signal !== null || !alarmAck.endsWith('\n')) {
    throw new TypeError('native alarm capability failed');
  }
  const receipt = {
    schema: 'qe-dirfd-capability-probe-v1', binarySha256: transactionRecord.digests.production,
    parent: common.expectedParent, operations: ['create-temp', 'fsync-temp', 'link-final', 'fsync-dir', 'unlink-temp', 'fsync-dir', 'inspect'],
    finalSha256: transactionRecord.content.sha256, alarmExit: 124, alarmCensus,
  };
  return { ...receipt, receiptSha256: sha256Hex(canonicalDirfdJson(receipt)) };
}

export async function reopenDirfdRecoveryAuthority({
  recordPath, transactionRecord, operationJournalPath, quiescenceTimeoutMs = 12_000,
}) {
  let recordFd;
  const expectedBytes = Buffer.from(`${JSON.stringify(transactionRecord)}\n`);
  try {
    const resealed = createDirfdTransactionRecord({
      schema: transactionRecord.schema, launchUuid: transactionRecord.launchUuid,
      savedParent: transactionRecord.savedParent, names: transactionRecord.names,
      content: transactionRecord.content, digests: transactionRecord.digests,
    });
    if (JSON.stringify(resealed) !== JSON.stringify(transactionRecord)) throw new TypeError('transaction record seal mismatch');
    const intent = readDirfdOperationIntent(operationJournalPath, transactionRecord);
    const journalRoot = realpathSync(dirname(operationJournalPath));
    if (journalRoot === transactionRecord.savedParent.realpath || journalRoot !== realpathSync(dirname(recordPath))) {
      throw new TypeError('operation journal is outside transaction transport');
    }
    const census = await waitForDirfdTwoEmptyCensus({
      binaryPath: intent.record.census.executable,
      launchUuid: intent.record.census.launchUuid,
      operationUuid: intent.record.census.operationUuid,
    }, quiescenceTimeoutMs);
    recordFd = openSync(recordPath, fsConstants.O_RDONLY);
    const actualBytes = readFileSync(recordFd);
    if (!actualBytes.equals(expectedBytes)) throw new TypeError('durable transaction record mismatch');
    const parentPath = realpathSync(transactionRecord.savedParent.realpath);
    if (parentPath !== transactionRecord.savedParent.realpath) throw new TypeError('saved parent realpath mismatch');
    const parentFd = openSync(parentPath, fsConstants.O_RDONLY);
    const identity = snapshotDirfdDescriptorIdentity(parentFd);
    const expected = transactionRecord.savedParent;
    if (identity.dev !== expected.dev || identity.ino !== expected.ino || identity.uid !== expected.uid || identity.mode !== expected.mode) {
      closeSync(parentFd);
      throw new TypeError('saved parent identity mismatch');
    }
    const journalParent = intent.record.descriptors.parent;
    if (identity.dev !== journalParent.dev || identity.ino !== journalParent.ino
      || identity.uid !== journalParent.uid || identity.mode !== journalParent.mode) {
      closeSync(parentFd);
      throw new TypeError('operation journal parent identity mismatch');
    }
    const recordIdentity = snapshotDirfdDescriptorIdentity(recordFd);
    if (canonicalDirfdJson(recordIdentity) !== canonicalDirfdJson(intent.record.descriptors.record)) {
      closeSync(parentFd);
      throw new TypeError('operation journal record identity mismatch');
    }
    return { status: 'reopened', parentFd, recordFd, operationIntent: intent.record, census };
  } catch (error) {
    if (recordFd !== undefined) closeSync(recordFd);
    return { status: 'permanent-indeterminate', reason: error.message };
  }
}

function recoveryResultResponse(result, operation, committed) {
  if (!plainObject(result) || result.timedOut === true || (result.status !== 0 && result.code !== 0)
    || result.authorityVerified !== true || !plainObject(result.response)
    || result.response.op !== operation || result.response.committed !== committed) {
    throw new TypeError(`${operation} recovery operation failed authority checks`);
  }
  return result.response;
}

export async function normalizeDirfdRecovery({ inspect, invoke, createAuthority }) {
  if (typeof inspect !== 'function' || typeof invoke !== 'function') throw new TypeError('invalid recovery controller');
  const fail = reason => ({ status: 'permanent-indeterminate', retryable: false, reason });
  const observe = async () => recoveryResultResponse(await inspect(), 'inspect', false);
  const mutate = async (operation, specific) => recoveryResultResponse(await invoke(operation, specific), operation, true);
  for (let transition = 0; transition < 8; transition += 1) {
    let observed;
    try { observed = await observe(); } catch (error) { return fail(error.message); }
    const state = classifyDirfdObservedState(observed);
    if (state.status === 'permanent-indeterminate') return state;
    if (state.status === 'needs-create-temp') {
      try { await mutate('create-temp', createAuthority); } catch (error) { return fail(error.message); }
      continue;
    }
    if (state.status === 'needs-fsync-temp') {
      const temp = observed.temp;
      try { await mutate('fsync-temp', {
        tempName: temp.name, tempDev: temp.dev, tempIno: temp.ino, tempSize: temp.size,
        tempNlink: 1, tempSha256: temp.sha256,
      }); } catch (error) { return fail(error.message); }
      let fresh;
      try { fresh = await observe(); } catch (error) { return fail(error.message); }
      if (classifyDirfdObservedState(fresh).status !== 'needs-fsync-temp') return { status: 'permanent-indeterminate', retryable: false };
      try { await mutate('link-final', {
        tempName: fresh.temp.name, finalName: fresh.final.name, expectedFinal: 'absent',
        tempDev: fresh.temp.dev, tempIno: fresh.temp.ino, tempSize: fresh.temp.size,
        tempNlink: 1, tempSha256: fresh.temp.sha256,
      }); } catch (error) { return fail(error.message); }
      continue;
    }
    if (state.status === 'needs-fsync-dir') {
      try { await mutate('fsync-dir', {}); } catch (error) { return fail(error.message); }
      let fresh;
      try { fresh = await observe(); } catch (error) { return fail(error.message); }
      if (classifyDirfdObservedState(fresh).status !== 'needs-fsync-dir') return { status: 'permanent-indeterminate', retryable: false };
      try { await mutate('unlink-temp', {
        tempName: fresh.temp.name, finalName: fresh.final.name,
        tempDev: fresh.temp.dev, tempIno: fresh.temp.ino, tempSize: fresh.temp.size,
        tempNlink: 2, tempSha256: fresh.temp.sha256,
      }); } catch (error) { return fail(error.message); }
      continue;
    }
    if (state.status === 'complete') {
      try { await mutate('fsync-dir', {}); } catch (error) { return fail(error.message); }
      let fresh;
      try { fresh = await observe(); } catch (error) { return fail(error.message); }
      return classifyDirfdObservedState(fresh).status === 'complete'
        ? { status: 'complete', observed: fresh }
        : { status: 'permanent-indeterminate', retryable: false };
    }
  }
  return { status: 'permanent-indeterminate', retryable: false, reason: 'transition bound exceeded' };
}

export function classifyDirfdObservedState(input) {
  const temp = plainObject(input?.temp) ? input.temp.status : input?.temp ?? input?.tempState ?? input?.tempStatus;
  const final = plainObject(input?.final) ? input.final.status : input?.final ?? input?.finalState ?? input?.finalStatus;
  if (temp === 'absent' && final === 'absent') {
    return { status: 'needs-create-temp', nextOperation: 'create-temp', retryable: true };
  }
  if (temp === 'exact' && final === 'absent') {
    return { status: 'needs-fsync-temp', nextOperation: 'fsync-temp', retryable: true };
  }
  if (temp === 'exact' && final === 'exact-same-inode') {
    return { status: 'needs-fsync-dir', nextOperation: 'fsync-dir', retryable: true };
  }
  if (temp === 'absent' && (final === 'exact-nlink1' || final === 'exact')) {
    return { status: 'complete', nextOperation: 'fsync-dir', retryable: false };
  }
  if (ALLOWED_TEMP_STATES.has(temp) && ALLOWED_FINAL_STATES.has(final)
    && (temp === 'foreign' || temp === 'mismatch' || temp === 'partial'
      || final === 'foreign' || final === 'mismatch')) {
    return { status: 'permanent-indeterminate', nextOperation: null, retryable: false };
  }
  return { status: 'permanent-indeterminate', nextOperation: null, retryable: false };
}

export const normalizeDirfdObservedState = classifyDirfdObservedState;

export function buildDirfdHelperSpawnPlan(input) {
  if (!plainObject(input) || typeof input.binaryPath !== 'string' || input.binaryPath.length === 0) {
    throw new TypeError('invalid spawn plan input');
  }
  const argv = [input.binaryPath];
  for (const value of [input.launchUuid, input.operationUuid, input.parentPid, input.transactionRecordSha256,
    input.requestSha256, input.operation]) {
    if (value !== undefined && value !== null) argv.push(String(value));
  }
  if (Array.isArray(input.extraArgs)) argv.push(...input.extraArgs.map(value => String(value)));
  return {
    argv,
    env: {
      LC_ALL: 'C',
      LANG: 'C',
      TMPDIR: input.tempRoot ?? '/tmp',
    },
    shell: false,
    detached: true,
    timeoutMs: MAX_TIMEOUT_MS,
    stdoutLimitBytes: 4 * 1024 * 1024,
    stderrLimitBytes: 4 * 1024 * 1024,
    signal: 'SIGTERM',
  };
}

export function spawnDirfdHelper(input) {
  const plan = buildDirfdHelperSpawnPlan(input);
  return spawnSync(plan.argv[0], plan.argv.slice(1), {
    encoding: 'utf8',
    shell: false,
    env: plan.env,
    timeout: plan.timeoutMs,
    maxBuffer: Math.max(plan.stdoutLimitBytes, plan.stderrLimitBytes),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function canonicalResponseOrThrow(value) {
  const responseKeys = ['committed', 'coreSha256', 'errno', 'final', 'op', 'parent', 'requestDigest', 'schema',
    'sourceSha256', 'temp', 'transactionRecordSha256'];
  const identityKeys = ['dev', 'ino', 'mode', 'uid'];
  const tempKeys = ['dev', 'ino', 'name', 'nlink', 'sha256', 'size'];
  const inspectEntryKeys = ['dev', 'ino', 'mode', 'name', 'nlink', 'sha256', 'size', 'status', 'uid'];
  const inspectStatuses = new Set(['absent', 'partial', 'foreign', 'mismatch', 'exact', 'exact-same-inode', 'exact-nlink1']);
  const inspectShape = value?.op === 'inspect';
  if (!exactKeys(value, responseKeys) || value.schema !== DIRFD_NATIVE_RESPONSE_SCHEMA || !ALLOWED_OPS.has(value.op)
    || typeof value.committed !== 'boolean' || !Number.isInteger(value.errno)
    || !exactKeys(value.parent, identityKeys)
    || !(inspectShape ? exactKeys(value.final, inspectEntryKeys) && exactKeys(value.temp, inspectEntryKeys)
      : exactKeys(value.final, ['dev', 'ino', 'mode', 'name', 'uid']) && exactKeys(value.temp, tempKeys))
    || ![value.parent.dev, value.parent.ino, value.parent.uid, value.parent.mode,
      value.final.dev, value.final.ino, value.final.uid, value.final.mode,
      value.temp.dev, value.temp.ino, value.temp.size, value.temp.nlink].every(Number.isSafeInteger)
    || typeof value.temp.name !== 'string' || typeof value.final.name !== 'string'
    || (inspectShape && (!inspectStatuses.has(value.temp.status) || !inspectStatuses.has(value.final.status)
      || !Number.isSafeInteger(value.final.size) || !Number.isSafeInteger(value.final.nlink)
      || !(value.final.sha256 === '' || HEX64_RE.test(value.final.sha256))))
    || !(value.temp.sha256 === '' || HEX64_RE.test(value.temp.sha256))
    || !HEX64_RE.test(value.requestDigest) || !HEX64_RE.test(value.transactionRecordSha256)
    || !HEX64_RE.test(value.sourceSha256) || !HEX64_RE.test(value.coreSha256)) {
    throw new TypeError('invalid native response');
  }
  return value;
}

export function parseDirfdNativeResponse(line) {
  if (typeof line !== 'string' || !line.endsWith('\n') || line.includes('\r') || line.indexOf('\n') !== line.length - 1) {
    throw new TypeError('native response must be a single LF-terminated line');
  }
  const value = JSON.parse(line.slice(0, -1));
  if (`${JSON.stringify(value)}\n` !== line) throw new TypeError('native response is not exact canonical JSON');
  return canonicalResponseOrThrow(value);
}

function fileSha256IfAvailable(path) {
  return sha256File(path);
}

function writeWrapperSources(outputDir) {
  const productionWrapper = [
    '#include <string.h>',
    '#include <sys/stat.h>',
    '#include <unistd.h>',
    'extern int qe_dirfd_helper_install_handlers(void);',
    'extern int qe_dirfd_helper_entry_production(int argc, char **argv);',
    'static int prepare_fd4(int argc,char **argv){ if(argc!=15) return 64; if(strcmp(argv[13],"create-temp")==0) return 0; struct stat a,b; if(fstat(4,&a)||fstat(7,&b)||a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||a.st_mode!=b.st_mode||a.st_size!=b.st_size||close(4)) return 64; return 0; }',
    'int main(int argc, char **argv) { int h=qe_dirfd_helper_install_handlers(); if(h) return 70; int e=prepare_fd4(argc,argv); return e ? e : qe_dirfd_helper_entry_production(argc, argv); }',
    '',
  ].join('\n');
  const faultWrapper = [
    '#include <errno.h>',
    '#include <fcntl.h>',
    '#include <stddef.h>',
    '#include <stdio.h>',
    '#include <string.h>',
    '#include <sys/stat.h>',
    '#include <unistd.h>',
    'typedef struct qe_dirfd_callback_set { int (*before)(const char *); int (*after)(const char *); } qe_dirfd_callback_set;',
    'extern int qe_dirfd_helper_install_handlers(void);',
    'extern int qe_dirfd_helper_set_callbacks(qe_dirfd_callback_set callbacks);',
    'extern int qe_dirfd_helper_entry_production(int argc, char **argv);',
    `static const char manifest_json[] = ${JSON.stringify(`${JSON.stringify(DIRFD_FAULT_BOUNDARY_MANIFEST)}\n`)};`,
    'static int full_write(int fd, const char *p, size_t n) { while (n) { ssize_t k = write(fd,p,n); if (k < 0 && errno == EINTR) continue; if (k <= 0) return -1; p += k; n -= (size_t)k; } return 0; }',
    'static int boundary(const char *id) { char go=0; ssize_t n; if (full_write(6,id,strlen(id)) || full_write(6,"\\n",1)) return -1; do { n=read(5,&go,1); } while(n<0 && errno==EINTR); if(n==0) { errno=EPIPE; return -1; } if(n<0) return -1; if(go!=\'G\') { errno=EPROTO; return -1; } return 0; }',
    'static int prepare_fd4(int argc,char **argv){ if(argc!=15) return 64; if(strcmp(argv[13],"create-temp")==0) return 0; struct stat a,b; if(fstat(4,&a)||fstat(7,&b)||a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||a.st_mode!=b.st_mode||a.st_size!=b.st_size||close(4)) return 64; return 0; }',
    'int main(int argc, char **argv) { int h=qe_dirfd_helper_install_handlers(); if(h) return 70; if (argc==2 && strcmp(argv[1],"--manifest")==0) return full_write(1,manifest_json,sizeof(manifest_json)-1)==0 ? 0 : 64; if (fcntl(5,F_GETFD)<0 || fcntl(6,F_GETFD)<0) return 64; int e=prepare_fd4(argc,argv); if(e) return e; qe_dirfd_callback_set c={boundary,boundary}; qe_dirfd_helper_set_callbacks(c); return qe_dirfd_helper_entry_production(argc,argv); }',
    '',
  ].join('\n');
  writeFileSync(join(outputDir, PRODUCTION_WRAPPER_NAME), productionWrapper, { mode: 0o600 });
  writeFileSync(join(outputDir, FAULT_WRAPPER_NAME), faultWrapper, { mode: 0o600 });
}

function validateMachOBinary(path) {
  const header = spawnSync('/usr/bin/otool', ['-hv', path], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (header.status !== 0 || !/ARM64/i.test(header.stdout)) throw new TypeError('mach-o arm64 header mismatch');
  const load = spawnSync('/usr/bin/otool', ['-l', path], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (load.status !== 0 || !/minos 15\.0/.test(load.stdout)) throw new TypeError('mach-o deployment target mismatch');
}

export function createDirfdCompileAuthority(input) {
  if (!plainObject(input) || typeof input.sourcePath !== 'string' || typeof input.clangPath !== 'string') {
    throw new TypeError('invalid compile authority input');
  }
  const resolvedClang = realpathSync(input.clangPath);
  if (resolvedClang !== (input.clangRealpath ?? resolvedClang)) throw new TypeError('clang realpath mismatch');
  const arch = input.arch ?? 'arm64';
  const deploymentTarget = input.deploymentTarget ?? 'macosx15.0';
  if (arch !== 'arm64' || deploymentTarget !== 'macosx15.0') throw new TypeError('unsupported build target');
  const flags = input.flags ?? DIRFD_BUILD_FLAGS;
  if (JSON.stringify(flags) !== JSON.stringify(DIRFD_BUILD_FLAGS)) throw new TypeError('invalid build flags');
  const hostArch = parseHostArchitecture(input.hostArchitecture ?? hostArchitecture());
  const hostVersion = parseHostVersion(input.hostProductVersion ?? hostProductVersion());
  if (hostArch !== 'arm64') throw new TypeError('host architecture mismatch');
  if (compareVersion(hostVersion, '15.0') < 0) throw new TypeError('host deployment target mismatch');
  return {
    schema: 'qe-dirfd-compile-authority-v1',
    sourcePath: input.sourcePath,
    sourceSha256: assertHex64(input.sourceSha256, 'sourceSha256'),
    clangPath: resolvedClang,
    clangRealpath: resolvedClang,
    clangSha256: assertHex64(input.clangSha256, 'clangSha256'),
    objectSha256: assertHex64(input.objectSha256, 'objectSha256'),
    productionSha256: assertHex64(input.productionSha256, 'productionSha256'),
    faultSha256: assertHex64(input.faultSha256, 'faultSha256'),
    arch,
    deploymentTarget,
    flags: [...DIRFD_BUILD_FLAGS],
    hostArchitecture: hostArch,
    hostProductVersion: hostVersion,
    authorityDigest: sha256Hex(canonicalDirfdJson({
      sourcePath: input.sourcePath,
      sourceSha256: input.sourceSha256,
      clangPath: resolvedClang,
      clangSha256: input.clangSha256,
      objectSha256: input.objectSha256,
      productionSha256: input.productionSha256,
      faultSha256: input.faultSha256,
      arch,
      deploymentTarget,
      flags,
      hostArchitecture: hostArch,
      hostProductVersion: hostVersion,
    })),
  };
}

export function compileDirfdHelper(input) {
  const requestedAuthority = createDirfdCompileAuthority(input);
  const sourcePath = input.sourcePath;
  const outputDir = input.outputDir;
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const sourceSha256 = fileSha256IfAvailable(sourcePath);
  if (sourceSha256 !== requestedAuthority.sourceSha256) throw new TypeError('source digest mismatch');
  const clangSha256 = fileSha256IfAvailable(requestedAuthority.clangPath);
  if (clangSha256 !== requestedAuthority.clangSha256) throw new TypeError('clang digest mismatch');
  writeWrapperSources(outputDir);
  const objectPath = join(outputDir, OBJECT_NAME);
  const productionPath = join(outputDir, PRODUCTION_BINARY_NAME);
  const faultPath = join(outputDir, FAULT_BINARY_NAME);
  const commonEnv = {
    LC_ALL: 'C',
    LANG: 'C',
    TMPDIR: outputDir,
  };
  const objectRun = spawnSync(requestedAuthority.clangPath,
    ['-c', sourcePath, '-o', objectPath, ...DIRFD_BUILD_FLAGS], {
    encoding: 'utf8',
    shell: false,
    env: commonEnv,
    timeout: MAX_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (objectRun.status !== 0) throw new Error(`object compile failed: ${objectRun.stderr || objectRun.stdout}`);
  const prodRun = spawnSync(requestedAuthority.clangPath, [
    join(outputDir, PRODUCTION_WRAPPER_NAME), objectPath, '-o', productionPath,
    ...DIRFD_BUILD_FLAGS, '-Wl,-dead_strip',
  ], {
    encoding: 'utf8',
    shell: false,
    env: commonEnv,
    timeout: MAX_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (prodRun.status !== 0) throw new Error(`production compile failed: ${prodRun.stderr || prodRun.stdout}`);
  const faultRun = spawnSync(requestedAuthority.clangPath, [
    join(outputDir, FAULT_WRAPPER_NAME), objectPath, '-o', faultPath,
    ...DIRFD_BUILD_FLAGS, '-Wl,-dead_strip',
  ], {
    encoding: 'utf8',
    shell: false,
    env: commonEnv,
    timeout: MAX_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (faultRun.status !== 0) throw new Error(`fault compile failed: ${faultRun.stderr || faultRun.stdout}`);
  validateMachOBinary(productionPath);
  validateMachOBinary(faultPath);
  const objectSha256 = sha256File(objectPath);
  const productionSha256 = sha256File(productionPath);
  const faultSha256 = sha256File(faultPath);
  const authority = createDirfdCompileAuthority({
    ...input,
    objectSha256,
    productionSha256,
    faultSha256,
  });
  const symbols = spawnSync('/usr/bin/nm', [productionPath], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (symbols.status !== 0 || /fault|control_fd|ack_fd/i.test(symbols.stdout)) {
    throw new TypeError('production binary contains fault protocol symbols');
  }
  return {
    authority,
    objectPath,
    productionPath,
    faultPath,
    objectSha256,
    productionSha256,
    faultSha256,
  };
}

export function verifyDirfdClangIdentity(clangPath) {
  const result = spawnSync(clangPath, ['--version'], { encoding: 'utf8', shell: false, timeout: 5_000 });
  if (result.status !== 0) throw new TypeError('clang unavailable');
  return result.stdout;
}
