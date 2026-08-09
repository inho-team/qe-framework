import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync as qeReadFileSync } from '../../hooks/scripts/lib/qe-fs.mjs';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve, relative, sep, isAbsolute, posix as pathPosix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = '.qe/planning/plans/runtime-controller-lifecycle-10';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_PRED_BYTES = 1024 * 1024;
const PARSER_TIMEOUT_MS = 5000;
const PARSER_MAX_BUFFER = 1024 * 1024;
const MANIFEST_DEADLINE_MS = 30_000;
const MAX_FILES = 64;
const MAX_REQUESTS = 4096;
const MIN_NODE = '22.20.0';
const BUILTIN_MODULES = new Set(builtinModules);

const SEEDS = Object.freeze([
  'scripts/__tests__/pse-capture-attestation.test.mjs',
  'hooks/scripts/lib/__tests__/lifecycle-pse-artifact-capture.test.mjs',
  'hooks/scripts/lib/__tests__/process-controller.test.mjs',
]);

const PARSER_SOURCE = String.raw`
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input');
const keys = Object.keys(input).sort();
if (keys.join('|') !== 'identifier|schema|source') throw new Error('input-keys');
if (input.schema !== 1 || typeof input.identifier !== 'string' || typeof input.source !== 'string') throw new Error('input-shape');

if (typeof SourceTextModule !== 'function') {
  process.stderr.write('QE_UNSUPPORTED_MODULE_REQUESTS');
  process.exit(86);
}
const module = new SourceTextModule(input.source, { identifier: input.identifier });
const requests = module.moduleRequests;
if (!Array.isArray(requests)) {
  process.stderr.write('QE_UNSUPPORTED_MODULE_REQUESTS');
  process.exit(86);
}
if (Object.keys(requests).length !== requests.length) throw new Error('moduleRequests');

const tuples = new Set();
const normalized = [];
for (const request of requests) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('request');
  const requestKeys = Object.keys(request).sort();
  if (requestKeys.join('|') !== 'attributes|phase|specifier') throw new Error('request-keys');
  if (typeof request.specifier !== 'string' || typeof request.phase !== 'string' || request.phase !== 'evaluation') throw new Error('request-shape');
  if (!request.attributes || typeof request.attributes !== 'object' || Array.isArray(request.attributes)) throw new Error('request-attributes');
  if (Object.keys(request.attributes).length !== 0) throw new Error('request-attributes');
  const tuple = request.specifier + '\u0000evaluation';
  if (tuples.has(tuple)) throw new Error('duplicate');
  tuples.add(tuple);
  normalized.push({ specifier: request.specifier, attributes: {}, phase: 'evaluation' });
}

process.stdout.write(JSON.stringify({ schema: 1, requestApi: 'moduleRequests', requests: normalized }));
`;

class PseCaptureError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function fail(code, message) {
  throw new PseCaptureError(code, message);
}

function nodeVersionAtLeast(required) {
  const current = process.versions.node.split('.').map(part => Number(part));
  const target = required.split('.').map(part => Number(part));
  for (let index = 0; index < target.length; index += 1) {
    const a = current[index] ?? 0;
    const b = target[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function assertUnicodeScalar(value, label = 'string') {
  if (typeof value !== 'string') fail('INVALID_UNICODE_SCALAR', label);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail('INVALID_UNICODE_SCALAR', label);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('INVALID_UNICODE_SCALAR', label);
    }
  }
  return value;
}

function assertNfc(value, label = 'path') {
  assertUnicodeScalar(value, label);
  if (value !== value.normalize('NFC')) fail('NON_NFC_PATH', label);
  return value;
}

function compareUtf8Unsigned(a, b) {
  const leftText = assertUnicodeScalar(String(a), 'sort-key').normalize('NFC');
  const rightText = assertUnicodeScalar(String(b), 'sort-key').normalize('NFC');
  const left = Buffer.from(leftText, 'utf8');
  const right = Buffer.from(rightText, 'utf8');
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(assertUnicodeScalar(value, 'json-string').normalize('NFC'));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) fail('INVALID_JSON', 'non-finite number');
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
      return `{${Object.keys(value).sort(compareUtf8Unsigned).map(key => `${JSON.stringify(assertUnicodeScalar(key, 'json-key').normalize('NFC'))}:${canonicalJson(value[key])}`).join(',')}}`;
    default:
      fail('INVALID_JSON', `unsupported type: ${typeof value}`);
  }
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function toRepoPosixPath(pathname) {
  return pathname.split(sep).join('/');
}

function asRelativePath(root, absolutePath) {
  const rel = relative(root, absolutePath);
  if (!rel || rel.startsWith('..') || rel === '.' || isAbsolute(rel)) fail('ROOT_ESCAPE', absolutePath);
  return toRepoPosixPath(rel).normalize('NFC');
}

function assertInsideRoot(root, absolutePath) {
  const rel = relative(root, absolutePath);
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) return;
  fail('ROOT_ESCAPE', absolutePath);
}

function rootRealpath(root) {
  return realpathSync(root);
}

function componentPaths(root, absolutePath) {
  const rel = relative(root, absolutePath);
  const parts = rel.split(sep).filter(Boolean);
  const out = [root];
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    out.push(current);
  }
  return out;
}

function assertNoSymlinkComponents(root, absolutePath) {
  for (const part of componentPaths(root, absolutePath)) {
    const stat = lstatSync(part);
    if (stat.isSymbolicLink()) fail('SYMLINK', part);
    if (part === absolutePath && !stat.isFile()) fail('NON_REGULAR_FILE', part);
  }
}

function readBoundedBuffer(filePath, limit, label) {
  const buffer = qeReadFileSync(filePath);
  if (!Buffer.isBuffer(buffer)) fail('INTERNAL_ERROR', `expected buffer for ${label}`);
  if (buffer.length > limit) fail('TOO_LARGE', label);
  if (buffer.includes(0x00)) fail('NUL_BYTE', label);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) fail('BOM', label);
  return buffer;
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    fail('INVALID_UTF8', label);
  }
}

function parseJsonString(text) {
  const input = String(text);
  let index = 0;

  function error(code) { fail(code, `json@${index}`); }
  function peek() { return input[index]; }
  function next() { return input[index++]; }
  function skipWs() {
    while (index < input.length && /[ \t\n\r]/.test(input[index])) index += 1;
  }
  function parseValue() {
    skipWs();
    const ch = peek();
    if (ch === '"') return parseString();
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === 't' && input.slice(index, index + 4) === 'true') { index += 4; return true; }
    if (ch === 'f' && input.slice(index, index + 5) === 'false') { index += 5; return false; }
    if (ch === 'n' && input.slice(index, index + 4) === 'null') { index += 4; return null; }
    return parseNumber();
  }
  function parseString() {
    if (next() !== '"') error('JSON_STRING');
    let out = '';
    while (index < input.length) {
      const ch = next();
      if (ch === '"') return out;
      if (ch === '\\') {
        const esc = next();
        if (esc === '"' || esc === '\\' || esc === '/') out += esc;
        else if (esc === 'b') out += '\b';
        else if (esc === 'f') out += '\f';
        else if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          const hex = input.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) error('JSON_STRING');
          out += String.fromCharCode(parseInt(hex, 16));
          index += 4;
        } else error('JSON_STRING');
      } else {
        out += ch;
      }
    }
    error('JSON_STRING');
  }
  function parseNumber() {
    const start = index;
    if (peek() === '-') index += 1;
    if (peek() === '0') {
      index += 1;
    } else if (/[1-9]/.test(peek() || '')) {
      while (/[0-9]/.test(peek() || '')) index += 1;
    } else error('JSON_NUMBER');
    if (peek() === '.') {
      index += 1;
      if (!/[0-9]/.test(peek() || '')) error('JSON_NUMBER');
      while (/[0-9]/.test(peek() || '')) index += 1;
    }
    if (peek() === 'e' || peek() === 'E') {
      index += 1;
      if (peek() === '+' || peek() === '-') index += 1;
      if (!/[0-9]/.test(peek() || '')) error('JSON_NUMBER');
      while (/[0-9]/.test(peek() || '')) index += 1;
    }
    const raw = input.slice(start, index);
    const value = Number(raw);
    if (!Number.isFinite(value)) error('JSON_NUMBER');
    return value;
  }
  function parseArray() {
    if (next() !== '[') error('JSON_ARRAY');
    const out = [];
    skipWs();
    if (peek() === ']') { index += 1; return out; }
    while (index < input.length) {
      out.push(parseValue());
      skipWs();
      const ch = next();
      if (ch === ']') return out;
      if (ch !== ',') error('JSON_ARRAY');
      skipWs();
    }
    error('JSON_ARRAY');
  }
  function parseObject() {
    if (next() !== '{') error('JSON_OBJECT');
    const out = {};
    const seen = new Set();
    skipWs();
    if (peek() === '}') { index += 1; return out; }
    while (index < input.length) {
      const key = parseString();
      const canonicalKey = key.normalize('NFC');
      if (seen.has(canonicalKey)) error('JSON_DUPLICATE_KEY');
      seen.add(canonicalKey);
      skipWs();
      if (next() !== ':') error('JSON_OBJECT');
      out[key] = parseValue();
      skipWs();
      const ch = next();
      if (ch === '}') return out;
      if (ch !== ',') error('JSON_OBJECT');
      skipWs();
    }
    error('JSON_OBJECT');
  }

  const value = parseValue();
  skipWs();
  if (index !== input.length) error('JSON_TRAILING_DATA');
  return value;
}

function strictLineSplit(text, label) {
  if (text.includes('\r')) fail('CR_BYTE', label);
  const lines = text.split('\n');
  if (lines.length === 0 || lines.at(-1) !== '') fail('NO_TERMINAL_LF', label);
  lines.pop();
  if (lines.some(line => line.trim() === '')) fail('BLANK_LINE', label);
  return lines;
}

function normalizeRepoRelativePath(root, inputPath) {
  assertNfc(inputPath, inputPath);
  const absolutePath = resolve(root, inputPath);
  assertInsideRoot(root, absolutePath);
  assertNoSymlinkComponents(root, absolutePath);
  const real = realpathSync(absolutePath);
  assertInsideRoot(root, real);
  const requestedRelative = toRepoPosixPath(relative(root, absolutePath)).normalize('NFC');
  const realRelative = asRelativePath(root, real);
  if (requestedRelative !== realRelative) fail('AMBIGUOUS_PATH_ALIAS', `${requestedRelative} <> ${realRelative}`);
  return {
    absolutePath,
    realPath: real,
    relativePath: realRelative,
    bytes: readBoundedBuffer(absolutePath, MAX_FILE_BYTES, inputPath),
  };
}

function isBuiltinSpecifier(specifier) {
  if (specifier.startsWith('node:')) {
    return BUILTIN_MODULES.has(specifier) || BUILTIN_MODULES.has(specifier.slice(5));
  }
  return BUILTIN_MODULES.has(specifier);
}

function resolveRelativeSpecifier(fromPath, specifier) {
  if (specifier.includes('?') || specifier.includes('#') || specifier.includes('%') || specifier.includes('\\')) {
    fail('UNSUPPORTED_STATIC_IMPORT', specifier);
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) fail('UNSUPPORTED_STATIC_IMPORT', specifier);
  if (!specifier.endsWith('.mjs')) fail('UNSUPPORTED_STATIC_IMPORT', specifier);
  const resolved = pathPosix.normalize(pathPosix.join(pathPosix.dirname(fromPath), specifier));
  if (!resolved || resolved.startsWith('..') || pathPosix.isAbsolute(resolved)) fail('ROOT_ESCAPE', specifier);
  return resolved;
}

function parseStaticModuleRequestsInternal(source, identifier, { spawn = spawnSync, timeout = PARSER_TIMEOUT_MS } = {}) {
  assertUnicodeScalar(source, identifier);
  assertNfc(identifier, identifier);
  if (!nodeVersionAtLeast(MIN_NODE)) fail('UNSUPPORTED_NODE_VM_MODULE_REQUESTS', 'node');
  const result = spawn(process.execPath, [
    '--experimental-vm-modules',
    '--no-warnings',
    '--input-type=module',
    '-e',
    PARSER_SOURCE,
  ], {
    input: canonicalJson({ schema: 1, identifier, source }),
    encoding: 'utf8',
    shell: false,
    timeout,
    maxBuffer: PARSER_MAX_BUFFER,
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') fail('PARSER_TIMEOUT', identifier);
    fail('PARSER_FAILED', result.error.message);
  }
  if (result.status === 86 && result.stderr === 'QE_UNSUPPORTED_MODULE_REQUESTS') {
    fail('UNSUPPORTED_NODE_VM_MODULE_REQUESTS', identifier);
  }
  if (result.signal !== null && result.signal !== undefined) fail('PARSER_FAILED', `signal ${result.signal}`);
  if (result.status !== 0) fail('PARSER_FAILED', result.stderr || `exit ${result.status}`);
  if (result.stderr !== '') fail('PARSER_FAILED', 'stderr');
  if (typeof result.stdout !== 'string' || result.stdout.length === 0) fail('PARSER_FAILED', 'stdout');
  if (result.stdout !== result.stdout.trim()) fail('PARSER_TRAILING_OUTPUT', identifier);

  const parsed = parseJsonString(result.stdout);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('PARSER_FAILED', identifier);
  const keys = Object.keys(parsed);
  if (keys.length !== 3 || keys[0] !== 'schema' || keys[1] !== 'requestApi' || keys[2] !== 'requests') fail('PARSER_FAILED', identifier);
  if (parsed.schema !== 1 || parsed.requestApi !== 'moduleRequests' || !Array.isArray(parsed.requests)) fail('PARSER_FAILED', identifier);
  if (Object.keys(parsed.requests).length !== parsed.requests.length) fail('PARSER_FAILED', identifier);
  const tuples = new Set();
  for (const request of parsed.requests) {
    validateRequest(request, identifier);
    const tuple = `${request.specifier}\u0000${request.phase}`;
    if (tuples.has(tuple)) fail('PARSER_FAILED', 'duplicate request tuple');
    tuples.add(tuple);
  }
  return parsed.requests;
}

function readLedgerSource(root, path) {
  const buffer = readBoundedBuffer(resolve(root, path), MAX_PRED_BYTES, path);
  if (buffer.includes(0x0d)) fail('CR_BYTE', path);
  if (buffer.length === 0 || buffer.at(-1) !== 0x0a || (buffer.length > 1 && buffer.at(-2) === 0x0a)) {
    fail('NO_TERMINAL_LF', path);
  }
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue;
    const record = buffer.subarray(start, index);
    if (record.length === 0 || record.toString('utf8').trim() === '') fail('BLANK_LINE', path);
    if (record.length > 262_144) fail('LEDGER_RECORD_TOO_LARGE', path);
    records.push(record);
    if (records.length > 4096) fail('LEDGER_TOO_MANY_RECORDS', path);
    start = index + 1;
  }
  const text = decodeUtf8(buffer, path);
  return { buffer, text };
}

function selectGoalProjection(goals, goalsPath) {
  if (!Array.isArray(goals?.goals) || Object.keys(goals.goals).length !== goals.goals.length) {
    fail('PREDECESSOR_INVALID', goalsPath);
  }
  const matches = goals.goals.filter(item => item && item.id === 'G001');
  if (matches.length !== 1) fail('PREDECESSOR_INVALID', goalsPath);
  const goal = matches[0];
  if (!goal || goal.status !== 'complete' || goal.attempts !== 1) fail('PREDECESSOR_INVALID', goalsPath);
  if (!goal.acceptance || goal.acceptance.status !== 'defined' || goal.acceptance.file !== 'evidence/G001.acceptance.json') fail('PREDECESSOR_INVALID', goalsPath);
  if (goal.acceptance.hash !== 'ac165b1e1c455e68b0538670fd1e70481b26fb0b9efc2e73472a7673a5838b22') fail('PREDECESSOR_INVALID', goalsPath);
  if (!goal.completionEvidence || goal.completionEvidence.status !== 'recorded' || goal.completionEvidence.file !== 'evidence/G001.completion.json') fail('PREDECESSOR_INVALID', goalsPath);
  return {
    status: goal.status,
    attempts: goal.attempts,
    acceptanceStatus: goal.acceptance.status,
    acceptanceFile: goal.acceptance.file,
    acceptanceHash: goal.acceptance.hash,
    completionStatus: goal.completionEvidence.status,
    completionFile: goal.completionEvidence.file,
  };
}

function selectVerifiedEvent(ledgerLines, ledgerPath) {
  const events = ledgerLines.map((line, lineIndex) => {
    const parsed = parseJsonString(line);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('LEDGER_INVALID', `${ledgerPath}:${lineIndex + 1}`);
    return parsed;
  });
  const verified = events.filter(event => event.event === 'verified' && event.goal === 'G001');
  if (verified.length !== 1) fail('PREDECESSOR_INVALID', ledgerPath);
  const event = verified[0];
  if (event.status !== 'complete' || event.attempt !== 1) fail('PREDECESSOR_INVALID', ledgerPath);
  if (event.receiptId !== '673840da454ba102d7a6b8edf89b3286b969f2588564029bc73750c23d90f09b'
    || event.goalProofDigest !== 'bf239d8b0c85c3546e2e88c002cbfad1005d3992b9f436e8c3c2313fe07203ce'
    || event.eventContentDigest !== '403c9fd2a67fae89a12ae28ca7aeee2594b0e20f97cd4e3d3c04709eb0ec36fd'
    || event.evidence !== 'qe-plan-goal-proof:0fe04e91be04948cf344a89cd1e96a8e64eae7ca5a7a5946d226b272c5f345ef') {
    fail('PREDECESSOR_INVALID', ledgerPath);
  }
  return {
    receiptId: event.receiptId,
    goalProofDigest: event.goalProofDigest,
    eventContentDigest: event.eventContentDigest,
    evidence: event.evidence,
  };
}

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort(compareUtf8Unsigned).join('|') === [...expected].sort(compareUtf8Unsigned).join('|');
}

function validateOutcomeItems(items, expectedIds, label) {
  if (!Array.isArray(items) || Object.keys(items).length !== items.length || items.length !== expectedIds.length) {
    fail('PREDECESSOR_INVALID', label);
  }
  const ids = new Set();
  for (const item of items) {
    if (!hasExactKeys(item, ['id', 'outcome', 'evidence']) || !expectedIds.includes(item.id)
      || ids.has(item.id) || item.outcome !== 'pass' || typeof item.evidence !== 'string' || item.evidence.trim() === '') {
      fail('PREDECESSOR_INVALID', label);
    }
    ids.add(item.id);
  }
}

function validatePredecessorCompletion(completion, label) {
  if (!hasExactKeys(completion, ['schema', 'goalId', 'requirements', 'scenarios', 'regression',
    'independentVerification', 'goalAlignment', 'humanAcceptance', 'limitations'])
    || completion.schema !== 1 || completion.goalId !== 'G001') fail('PREDECESSOR_INVALID', label);
  validateOutcomeItems(completion.requirements, ['R001', 'R002'], label);
  validateOutcomeItems(completion.scenarios, ['S001'], label);
  if (!hasExactKeys(completion.regression, ['outcome', 'evidence']) || completion.regression.outcome !== 'pass'
    || typeof completion.regression.evidence !== 'string' || completion.regression.evidence.trim() === '') {
    fail('PREDECESSOR_INVALID', label);
  }
  const verification = completion.independentVerification;
  if (!hasExactKeys(verification, ['verifier', 'mode', 'outcome', 'evidence'])
    || typeof verification.verifier !== 'string' || verification.verifier.trim() === ''
    || verification.mode !== 'machine-reexecution' || verification.outcome !== 'pass'
    || typeof verification.evidence !== 'string' || verification.evidence.trim() === '') {
    fail('PREDECESSOR_INVALID', label);
  }
  const alignment = completion.goalAlignment;
  if (!hasExactKeys(alignment, ['objective', 'verifier', 'outcome', 'evidence'])
    || alignment.objective !== 'PSE artifact byte·path·frontmatter가 exact bounded capture와 collision-free metadata identity를 제공한다'
    || alignment.verifier !== verification.verifier || alignment.outcome !== 'pass'
    || typeof alignment.evidence !== 'string' || alignment.evidence.trim() === '') {
    fail('PREDECESSOR_INVALID', label);
  }
  if (!hasExactKeys(completion.humanAcceptance, ['status'])
    || completion.humanAcceptance.status !== 'not-required') fail('PREDECESSOR_INVALID', label);
  if (!Array.isArray(completion.limitations) || Object.keys(completion.limitations).length !== 1
    || completion.limitations.length !== 1 || typeof completion.limitations[0] !== 'string'
    || completion.limitations[0].trim() === '') fail('PREDECESSOR_INVALID', label);
}

function createDeadline(now) {
  let last = now();
  if (!Number.isFinite(last) || last < 0) fail('MANIFEST_CLOCK_INVALID');
  const startedAt = last;
  const deadline = startedAt + MANIFEST_DEADLINE_MS;
  function read() {
    const current = now();
    if (!Number.isFinite(current) || current < 0 || current < last) fail('MANIFEST_CLOCK_INVALID');
    last = current;
    if (current - startedAt >= MANIFEST_DEADLINE_MS) fail('MANIFEST_DEADLINE_EXCEEDED');
    return current;
  }
  return {
    checkpoint: read,
    remaining() {
      const remaining = Math.floor(deadline - read());
      if (remaining <= 0) fail('MANIFEST_DEADLINE_EXCEEDED');
      return remaining;
    },
  };
}

function defaultResolvePath({ root, inputPath }) {
  assertNfc(inputPath, inputPath);
  if (inputPath.includes('\\') || pathPosix.isAbsolute(inputPath)) fail('ROOT_ESCAPE', inputPath);
  const candidate = pathPosix.normalize(inputPath);
  if (!candidate || candidate === '.' || candidate === '..' || candidate.startsWith('../')) fail('ROOT_ESCAPE', inputPath);
  const absolutePath = resolve(root, candidate.split('/').join(sep));
  assertInsideRoot(root, absolutePath);
  assertNoSymlinkComponents(root, absolutePath);
  const real = realpathSync(absolutePath);
  assertInsideRoot(root, real);
  return { candidateNfcPosix: candidate, realpathIdentity: real, manifestPathNfcPosix: asRelativePath(root, real) };
}

function validateResolvedPath(root, inputPath, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PATH_ADAPTER', inputPath);
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'candidateNfcPosix|manifestPathNfcPosix|realpathIdentity') {
    fail('INVALID_PATH_ADAPTER', inputPath);
  }
  for (const key of keys) assertUnicodeScalar(value[key], `${inputPath}:${key}`);
  if (relative(root, value.realpathIdentity) === '') fail('ROOT_ESCAPE', inputPath);
  const expectedCandidate = pathPosix.normalize(inputPath);
  if (value.candidateNfcPosix !== expectedCandidate || value.candidateNfcPosix !== value.candidateNfcPosix.normalize('NFC')) {
    fail('INVALID_PATH_ADAPTER', inputPath);
  }
  for (const pathValue of [value.candidateNfcPosix, value.manifestPathNfcPosix]) {
    if (!pathValue || pathValue === '.' || pathValue === '..' || pathValue.startsWith('../')
      || pathPosix.isAbsolute(pathValue) || pathValue.includes('\\') || pathValue !== pathPosix.normalize(pathValue)
      || pathValue !== pathValue.normalize('NFC')) fail('INVALID_PATH_ADAPTER', inputPath);
  }
  assertInsideRoot(root, value.realpathIdentity);
  return value;
}

function validateRequest(request, label) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join('|') !== 'attributes|phase|specifier') fail('PARSER_FAILED', label);
  assertUnicodeScalar(request.specifier, label);
  if (request.phase !== 'evaluation' || !request.attributes || typeof request.attributes !== 'object'
    || Array.isArray(request.attributes) || Object.keys(request.attributes).length !== 0) {
    fail('UNSUPPORTED_STATIC_IMPORT', label);
  }
  return request;
}

function collectClosure(root, seedPaths, adapters, deadline) {
  const realToCandidate = new Map();
  const manifestToReal = new Map();
  const queuedReal = new Set();
  const visitedReal = new Set();
  const files = [];
  const queue = [];
  let totalBytes = 0;
  let totalRequests = 0;

  function resolveAndRegister(inputPath) {
    assertNfc(inputPath, inputPath);
    deadline.checkpoint();
    const resolvedPath = validateResolvedPath(root, inputPath, adapters.resolvePath({ root, inputPath }));
    deadline.checkpoint();
    const firstCandidate = realToCandidate.get(resolvedPath.realpathIdentity);
    if (firstCandidate !== undefined && firstCandidate !== resolvedPath.candidateNfcPosix) {
      fail('AMBIGUOUS_PATH_ALIAS', `${firstCandidate} <> ${resolvedPath.candidateNfcPosix}`);
    }
    const firstReal = manifestToReal.get(resolvedPath.manifestPathNfcPosix);
    if (firstReal !== undefined && firstReal !== resolvedPath.realpathIdentity) {
      fail('AMBIGUOUS_UNICODE_PATH', resolvedPath.manifestPathNfcPosix);
    }
    if (!queuedReal.has(resolvedPath.realpathIdentity) && queuedReal.size >= MAX_FILES) {
      fail('TOO_MANY_FILES', resolvedPath.manifestPathNfcPosix);
    }
    realToCandidate.set(resolvedPath.realpathIdentity, resolvedPath.candidateNfcPosix);
    manifestToReal.set(resolvedPath.manifestPathNfcPosix, resolvedPath.realpathIdentity);
    if (!queuedReal.has(resolvedPath.realpathIdentity)) {
      queuedReal.add(resolvedPath.realpathIdentity);
      queue.push(resolvedPath);
    }
    return resolvedPath;
  }

  for (const seed of seedPaths) resolveAndRegister(seed);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor];
    if (visitedReal.has(item.realpathIdentity)) continue;
    visitedReal.add(item.realpathIdentity);
    if (files.length >= MAX_FILES) fail('TOO_MANY_FILES', item.manifestPathNfcPosix);

    deadline.checkpoint();
    const stat = adapters.stat(item.realpathIdentity);
    deadline.checkpoint();
    if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) fail('NON_REGULAR_FILE', item.realpathIdentity);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) fail('INVALID_FILE_SIZE', item.realpathIdentity);
    if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) fail('TOO_LARGE', item.manifestPathNfcPosix);
    totalBytes += stat.size;
    const bytes = adapters.read(item.realpathIdentity);
    deadline.checkpoint();
    if (!Buffer.isBuffer(bytes)) fail('INTERNAL_ERROR', `expected buffer for ${item.manifestPathNfcPosix}`);
    if (bytes.byteLength !== stat.size) fail('STAT_READ_MISMATCH', item.manifestPathNfcPosix);
    if (bytes.includes(0x00)) fail('NUL_BYTE', item.manifestPathNfcPosix);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('BOM', item.manifestPathNfcPosix);
    const text = decodeUtf8(bytes, item.manifestPathNfcPosix);
    const timeout = Math.min(PARSER_TIMEOUT_MS, deadline.remaining());
    const requests = adapters.parseRequests
      ? adapters.parseRequests(text, item.manifestPathNfcPosix, { timeout })
      : parseStaticModuleRequestsInternal(text, item.manifestPathNfcPosix, { spawn: adapters.spawn, timeout });
    deadline.checkpoint();
    if (!Array.isArray(requests) || Object.keys(requests).length !== requests.length) fail('PARSER_FAILED', item.manifestPathNfcPosix);
    totalRequests += requests.length;
    if (totalRequests > MAX_REQUESTS) fail('TOO_MANY_REQUESTS', item.manifestPathNfcPosix);
    const imports = [];
    const seenImports = new Set();
    for (const rawRequest of requests) {
      deadline.checkpoint();
      const request = validateRequest(rawRequest, item.manifestPathNfcPosix);
      const specifier = request.specifier;
      if (adapters.isBuiltin(specifier)) continue;
      assertNfc(specifier, specifier);
      const childRelative = resolveRelativeSpecifier(item.candidateNfcPosix, specifier);
      if (seenImports.has(childRelative)) fail('DUPLICATE_IMPORT', `${item.manifestPathNfcPosix} -> ${childRelative}`);
      seenImports.add(childRelative);
      imports.push(resolveAndRegister(childRelative).manifestPathNfcPosix);
    }
    imports.sort(compareUtf8Unsigned);
    files.push({ path: item.manifestPathNfcPosix, sha256: sha256(bytes), imports });
  }

  files.sort((a, b) => compareUtf8Unsigned(a.path, b.path));
  deadline.checkpoint();
  return files;
}

function manifestCore(root, deadline) {
  const goalsPath = resolve(root, `${MANIFEST_PATH}/goals.json`);
  const ledgerPath = resolve(root, `${MANIFEST_PATH}/ledger.jsonl`);
  const acceptancePath = resolve(root, `${MANIFEST_PATH}/evidence/G001.acceptance.json`);
  const completionPath = resolve(root, `${MANIFEST_PATH}/evidence/G001.completion.json`);

  const step = fn => {
    deadline.checkpoint();
    const value = fn();
    deadline.checkpoint();
    return value;
  };
  const goalsBuffer = step(() => readBoundedBuffer(goalsPath, MAX_PRED_BYTES, goalsPath));
  const ledgerSource = step(() => readLedgerSource(root, `${MANIFEST_PATH}/ledger.jsonl`));
  const acceptanceBuffer = step(() => readBoundedBuffer(acceptancePath, MAX_PRED_BYTES, acceptancePath));
  const completionBuffer = step(() => readBoundedBuffer(completionPath, MAX_PRED_BYTES, completionPath));

  deadline.checkpoint();
  if (sha256(goalsBuffer) !== 'd1b55e155e5c665c90cea55a7dddedc9e12615ec9eabea0ede30c186f4232bf4') fail('PREDECESSOR_INVALID', goalsPath);
  if (sha256(ledgerSource.buffer) !== '0d8d72c84b711a1fd0046e95ad86d854af937fbcad31048158eca5c464e6d224') fail('PREDECESSOR_INVALID', ledgerPath);
  if (sha256(acceptanceBuffer) !== '964853da55952531e65f27606fa64c9c3750286419b5230c2cb72763f4678d68') fail('PREDECESSOR_INVALID', acceptancePath);
  if (sha256(completionBuffer) !== 'dee0c3d910a0d306507ba15d2965684fac4f65c62e440e05b73cd31279cab108') fail('PREDECESSOR_INVALID', completionPath);
  deadline.checkpoint();

  const goals = step(() => parseJsonString(decodeUtf8(goalsBuffer, goalsPath)));
  const ledgerLines = step(() => strictLineSplit(ledgerSource.text, ledgerPath));
  const acceptance = step(() => parseJsonString(decodeUtf8(acceptanceBuffer, acceptancePath)));
  const completion = step(() => parseJsonString(decodeUtf8(completionBuffer, completionPath)));

  step(() => {
    if (goals.planSlug !== 'runtime-controller-lifecycle-10' || goals.schema !== 1) fail('PREDECESSOR_INVALID', goalsPath);
    if (goals.goals?.some(goal => goal.id === 'G001') !== true) fail('PREDECESSOR_INVALID', goalsPath);
  });
  const goalProjection = step(() => selectGoalProjection(goals, goalsPath));
  const verifiedEvent = step(() => selectVerifiedEvent(ledgerLines, ledgerPath));

  step(() => {
    if (acceptance.schema !== 1 || acceptance.goalId !== 'G001') fail('PREDECESSOR_INVALID', acceptancePath);
  });
  step(() => validatePredecessorCompletion(completion, completionPath));
  if (acceptance.acceptanceHash !== undefined) {
    // no-op: acceptance evidence is validated through the pinned raw hash.
  }

  const predecessor = {
    planSlug: 'runtime-controller-lifecycle-10',
    goalId: 'G001',
    goalProjection,
    goals: { path: `${MANIFEST_PATH}/goals.json`, rawSha256: 'd1b55e155e5c665c90cea55a7dddedc9e12615ec9eabea0ede30c186f4232bf4' },
    ledger: { path: `${MANIFEST_PATH}/ledger.jsonl`, rawSha256: '0d8d72c84b711a1fd0046e95ad86d854af937fbcad31048158eca5c464e6d224' },
    acceptance: { path: `${MANIFEST_PATH}/evidence/G001.acceptance.json`, rawSha256: '964853da55952531e65f27606fa64c9c3750286419b5230c2cb72763f4678d68' },
    completion: { path: `${MANIFEST_PATH}/evidence/G001.completion.json`, rawSha256: 'dee0c3d910a0d306507ba15d2965684fac4f65c62e440e05b73cd31279cab108' },
    verifiedEvent,
  };

  deadline.checkpoint();
  return { predecessor, goals, ledgerLines, acceptance, completion };
}

export function parseStaticModuleRequests(source, identifier, options) {
  return parseStaticModuleRequestsInternal(String(source), String(identifier), options);
}

export function buildPseCaptureAttestationManifest({ cwd = ROOT, seeds = SEEDS, predecessor, adapters: overrides = {} } = {}) {
  const earlyNow = typeof overrides.now === 'function' ? overrides.now : () => performance.now();
  const deadline = createDeadline(earlyNow);
  deadline.checkpoint();
  const root = resolve(cwd);
  const rootReal = rootRealpath(root);
  const adapters = {
    now: earlyNow,
    resolvePath: defaultResolvePath,
    stat: statSync,
    read: qeReadFileSync,
    spawn: spawnSync,
    isBuiltin: isBuiltinSpecifier,
    ...overrides,
  };
  deadline.checkpoint();
  const predecessorValue = predecessor ?? manifestCore(root, deadline).predecessor;
  deadline.checkpoint();
  const normalizedSeeds = [...seeds];
  const files = collectClosure(rootReal, normalizedSeeds, adapters, deadline);
  const parserSourceSha256 = sha256(PARSER_SOURCE);

  const manifest = {
    schema: 1,
    algorithm: 'qe-pse-capture-integrity-v1',
    scope: {
      assumption: 'quiescent-workspace',
      exclusions: [
        'dynamic-code-confinement',
        'malicious-same-uid-concurrent-writer',
        'os-or-node-runtime-compromise',
        'remote-signing',
        'reproducible-build',
      ],
    },
    parser: {
      engine: 'node:vm.SourceTextModule',
      args: ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e'],
      minimumNode: MIN_NODE,
      sourceSha256: parserSourceSha256,
      requestApi: 'moduleRequests',
    },
    predecessor: predecessorValue,
    seeds: normalizedSeeds,
    files,
  };
  deadline.checkpoint();
  const manifestDigest = sha256(canonicalJson(['qe-pse-capture-integrity-manifest-v1', { ...manifest }]));
  deadline.checkpoint();
  return { ...manifest, manifestDigest };
}

export function validatePseCaptureAttestationManifest(manifest, { cwd = ROOT } = {}) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, code: 'INVALID_MANIFEST' };
    const expected = buildPseCaptureAttestationManifest({ cwd });
    return canonicalJson(manifest) === canonicalJson(expected)
      ? { ok: true, code: 'VALID' }
      : { ok: false, code: 'MANIFEST_MISMATCH' };
  } catch (error) {
    return { ok: false, code: error.code || 'INVALID_MANIFEST' };
  }
}

export function loadPseCaptureAttestationManifest({ cwd = ROOT } = {}) {
  const path = resolve(cwd, 'core/pse-capture-attestation.json');
  const raw = readBoundedBuffer(path, 4 * 1024 * 1024, path);
  const text = decodeUtf8(raw, path);
  const manifest = parseJsonString(text);
  if (text !== canonicalJson(manifest)) fail('MANIFEST_NOT_CANONICAL', path);
  const validation = validatePseCaptureAttestationManifest(manifest, { cwd });
  if (!validation.ok) fail(validation.code, path);
  return manifest;
}
