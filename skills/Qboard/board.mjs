// QE Board: a local, read-only page of every QE goal in ~/.qe/tasks, the live Claude Code
// sessions (`claude agents --json`), and warnings where claims and evidence disagree.
// Run: node board.mjs   (QE_HOME, QE_BOARD_PORT optional). Binds 127.0.0.1 only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qeHome } from '../../hooks/lib/qe-home.mjs';
import { listTasks, planHash } from '../../hooks/lib/tasks.mjs';
import { collectGitFacts, computeAlerts } from '../../hooks/lib/alerts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4949;

function runAgents(env) {
  const opts = { env, encoding: 'utf8', timeout: 5000, windowsHide: true };
  let r = spawnSync('claude', ['agents', '--json'], opts);
  // npm installs on Windows ship claude.cmd, which only a shell resolves. Arguments are constant.
  if (r.error?.code === 'ENOENT' && process.platform === 'win32') r = spawnSync('claude agents --json', { ...opts, shell: true });
  return r;
}

export function listSessions(env = process.env) {
  try {
    const r = runAgents(env);
    if (r.error) return { sessions: [], sessionsError: `claude agents 실행 실패: ${r.error.code || r.error.message}` };
    if (r.status !== 0) return { sessions: [], sessionsError: `claude agents 종료 코드 ${r.status}` };
    const list = JSON.parse(r.stdout);
    if (!Array.isArray(list)) return { sessions: [], sessionsError: 'claude agents 출력이 배열이 아니다' };
    return { sessions: list.filter((x) => x && typeof x === 'object'), sessionsError: null };
  } catch (err) {
    return { sessions: [], sessionsError: `claude agents 출력을 읽지 못했다: ${err.message}` };
  }
}

export function collectState(env = process.env) {
  const { sessions, sessionsError } = listSessions(env);
  const live = sessionsError ? null : new Set(sessions.map((s) => s.sessionId).filter(Boolean));
  const tasks = listTasks(qeHome(env)).map((t) => {
    const valid = t.status && !t.status.invalid;
    const info = { ...t, planHash: planHash(t.dir) };
    let facts = null;
    try {
      facts = valid ? collectGitFacts(t.status) : null;
    } catch {
      facts = null;
    }
    return { ...info, facts, alerts: computeAlerts(info, facts, live) };
  });
  return { tasks, sessions, sessionsError, at: Date.now() };
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

export function createServer(env = process.env) {
  return http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    try {
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
      if (url === '/' || url === '/index.html') {
        return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(HERE, 'board.html')));
      }
      if (url === '/api/state') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(collectState(env)));
      return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    } catch (err) {
      return send(res, 500, 'text/plain; charset=utf-8', String(err?.message || err));
    }
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// Port in use → let the OS pick one, so a second board (or another app on 4949) never blocks starting.
export async function startServer({ port, env = process.env } = {}) {
  const want = port ?? (Number.parseInt(env.QE_BOARD_PORT, 10) || DEFAULT_PORT);
  const server = createServer(env);
  try {
    return await listen(server, want);
  } catch (err) {
    if (err.code !== 'EADDRINUSE' || want === 0) throw err;
    return listen(server, 0);
  }
}

async function main() {
  const server = await startServer();
  process.stdout.write(`QE Board: http://127.0.0.1:${server.address().port}\n`);
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`QE Board failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
