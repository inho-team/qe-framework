#!/usr/bin/env node
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, platform, arch, totalmem, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { createProcessController } from '../hooks/scripts/lib/process-controller.mjs';
import { canonicalJson, createProcessControllerStore, sha256 } from '../hooks/scripts/lib/process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../hooks/scripts/lib/store-sqlite.mjs';

export const TABLES = Object.freeze(['process_controller_state', 'process_controller_audit',
  'process_controller_sivs_task_binding', 'process_controller_sivs_verification_proof',
  'process_controller_sivs_supervision_proof', 'process_controller_sivs_remediation_current',
  'process_controller_sivs_remediation_event']);
export const OWNER = 'QE Runtime Controller maintainers';
export const REVIEW_DATE = '2026-11-08';
export const SAMPLE_TIMEOUT_MS = 30_000;
export const RSS_BUDGET_BYTES = 536_870_912;

export function nearestRank(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1];
}

export function seedFixture(cwd, cardinality) {
  const controller = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
  for (let index = 0; index < cardinality; index += 1) {
    const processId = `scale-sivs-${String(index).padStart(5, '0')}`;
    const result = controller.initialize({ processId, requestId: `init-${index}` });
    if (result.code !== 'INITIALIZED') throw new Error(`fixture initialize failed: ${result.code}`);
  }
  controller.close();
  const db = openSqlite(cwd); const controllerIdentity = sha256(canonicalJson({ layer: 'sivs', authority: 'sivs-controller' }));
  db.exec('BEGIN');
  try {
    const insert = db.prepare(`INSERT INTO process_controller_sivs_task_binding
      (process_id,controller_identity,token_text,token_sha256,original_request_id,
       original_request_digest,payload_json,binding_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < cardinality; index += 1) {
      const processId = `scale-sivs-${String(index).padStart(5, '0')}`;
      const token = sha256(`scale-token:${index}`); const tokenSha = sha256(token);
      const payload = { schema: 1, processId, controllerIdentity, pseProcessId: `scale-pse-${index}`,
        pseBindingSha256: sha256(`pse-binding:${index}`), pseRevision: 3, pseAuditSeq: 3,
        pseAuditHash: sha256(`pse-audit:${index}`), planSlug: 'runtime-controller-scale-fixture',
        goalId: 'G001', goalAttempt: 1, acceptanceHash: sha256('scale-acceptance'),
        uuid: (index + 1).toString(16).padStart(8, '0'),
        taskPath: `.qe/tasks/in-progress/TASK_REQUEST_${(index + 1).toString(16).padStart(8, '0')}.md`,
        checklistPath: `.qe/checklists/in-progress/VERIFY_CHECKLIST_${(index + 1).toString(16).padStart(8, '0')}.md`,
        immutableDigest: sha256(`immutable:${index}`) };
      insert.run(processId, controllerIdentity, token, tokenSha, `bind-${index}`,
        sha256(`request:${index}`), canonicalJson(payload),
        sha256(canonicalJson(['qe-sivs-task-binding-v1', processId, controllerIdentity, tokenSha, payload])), Date.now());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { closeSqlite(db); }
}

export function independentOracle(cwd) {
  const db = openSqlite(cwd, { readOnly: true });
  try {
    const tables = Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT process_id) AS processes FROM ${table}`).get()]));
    const logicalTasks = db.prepare(`SELECT COUNT(DISTINCT json_extract(payload_json,'$.uuid') || '|' ||
      json_extract(payload_json,'$.planSlug') || '|' || json_extract(payload_json,'$.goalId') || '|' ||
      json_extract(payload_json,'$.goalAttempt') || '|' || json_extract(payload_json,'$.acceptanceHash')) AS n
      FROM process_controller_sivs_task_binding`).get().n;
    return { tables, logicalTasks };
  } finally { closeSqlite(db); }
}

function qualifiedFingerprint(events) {
  const reads = events.filter(event => event.selectCount > 0);
  return reads.length === 7 && reads.every(event => event.selectCount === 1 && event.tables.length === 1)
    && canonicalJson(reads.map(event => event.tables[0]).sort()) === canonicalJson([...TABLES].sort());
}

function childMain(cwd) {
  let events = [];
  const store = createProcessControllerStore(cwd, { metricsStatementObserver: event => events.push(event) });
  const baselineRssBytes = process.memoryUsage.rss();
  process.on('message', message => {
    if (message?.kind === 'close') { store.close(); process.disconnect(); return; }
    if (message?.kind !== 'sample') return;
    events = []; const start = performance.now(); const report = store.processMetrics(); const elapsedMs = performance.now() - start;
    process.send({ id: message.id, elapsedMs, events, reportDigest: report.digest ?? null,
      reportStatus: report.ok === false ? report.code : 'OK', counts: report.counts ?? null,
      rssBytes: process.memoryUsage.rss(), baselineRssBytes });
  });
}

function requestSample(child, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('sample timeout')); }, SAMPLE_TIMEOUT_MS);
    const onMessage = message => {
      if (message?.id !== id) return;
      clearTimeout(timer); child.off('message', onMessage); resolve(message);
    };
    child.on('message', onMessage); child.send({ kind: 'sample', id });
  });
}

export async function qualifyCardinality(cardinality) {
  const cwd = mkdtempSync(path.join(tmpdir(), `qe-metrics-${cardinality}-`));
  let child;
  try {
    seedFixture(cwd, cardinality); const oracle = independentOracle(cwd);
    child = fork(fileURLToPath(import.meta.url), ['--child', cwd], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const cold = await requestSample(child, 'cold');
    await requestSample(child, 'warmup-1'); await requestSample(child, 'warmup-2');
    const warm = [];
    for (let index = 0; index < 20; index += 1) warm.push(await requestSample(child, `warm-${index}`));
    const samples = warm.map(item => item.elapsedMs); const rssSamples = [cold, ...warm].map(item => item.rssBytes);
    const rssPeakBytes = Math.max(...rssSamples); const rssDeltaBytes = Math.max(0, rssPeakBytes - cold.baselineRssBytes);
    const fingerprintPass = [cold, ...warm].every(item => qualifiedFingerprint(item.events));
    const oraclePass = cold.counts?.controllerProcesses === cardinality
      && cold.counts?.boundTasks === cardinality && oracle.logicalTasks === cardinality;
    const p50Ms = nearestRank(samples, .5); const p95Ms = nearestRank(samples, .95);
    const qualified = fingerprintPass && oraclePass && p95Ms <= SAMPLE_TIMEOUT_MS && rssDeltaBytes <= RSS_BUDGET_BYTES;
    return { cardinality, fixtureDigest: sha256(canonicalJson(oracle)), oracle,
      fingerprint: cold.events, coldMs: cold.elapsedMs, warmSamplesMs: samples, p50Ms, p95Ms,
      reportDigest: cold.reportDigest, reportStatus: cold.reportStatus,
      rssBaselineBytes: cold.baselineRssBytes, rssPeakBytes, rssDeltaBytes,
      qualification: qualified ? 'PASS' : 'NOT_QUALIFIED' };
  } finally {
    if (child?.connected) child.send({ kind: 'close' });
    if (child && !child.killed) child.kill();
    rmSync(cwd, { recursive: true, force: true });
  }
}

export async function runQualification(cardinalities = [0, 100, 1000, 10000]) {
  const rows = [];
  for (const cardinality of cardinalities) rows.push(await qualifyCardinality(cardinality));
  const measuredRows = rows.map((row, index) => ({ ...row,
    executionCount: row.fingerprint.filter(item => item.selectCount > 0).length,
    p95GrowthVsPrevious: index === 0 ? null : row.p95Ms / rows[index - 1].p95Ms,
    executionGrowthVsPrevious: index === 0 ? null
      : row.fingerprint.filter(item => item.selectCount > 0).length
        / rows[index - 1].fingerprint.filter(item => item.selectCount > 0).length }));
  const cpu = cpus();
  const report = { schema: 1, owner: OWNER, reviewDate: REVIEW_DATE,
    budgets: { executions: 7, p95Ms: SAMPLE_TIMEOUT_MS, rssDeltaBytes: RSS_BUDGET_BYTES },
    runtime: { version: process.version, platform: platform(), arch: arch(), cpuModel: cpu[0]?.model ?? null,
      cpuCount: cpu.length, totalMemoryBytes: totalmem() },
    coverage: { requiredCardinalities: [0, 100, 1000, 10000],
      measuredCardinalities: measuredRows.map(row => row.cardinality) }, rows: measuredRows };
  const complete = canonicalJson(report.coverage.measuredCardinalities)
    === canonicalJson(report.coverage.requiredCardinalities);
  report.status = complete && measuredRows.every(row => row.qualification === 'PASS')
    ? 'QUALIFIED' : 'NOT_QUALIFIED';
  report.digest = sha256(canonicalJson(report)); return report;
}

const mainFile = fileURLToPath(import.meta.url);
if (process.argv[1] === mainFile) {
  if (process.argv[2] === '--child') childMain(process.argv[3]);
  else {
    const requested = process.argv.find(arg => arg.startsWith('--cardinalities='));
    const cardinalities = requested ? requested.split('=')[1].split(',').map(Number) : undefined;
    runQualification(cardinalities).then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'QUALIFIED' ? 0 : 1; })
      .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
  }
}
