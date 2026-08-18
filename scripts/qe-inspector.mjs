#!/usr/bin/env node
/**
 * qe-inspector.mjs — generate a self-contained HTML view of the QE state store.
 *
 * Reads the local SQLite index (.qe/qe.db) and the .qe/ document tree and emits
 * a single, dependency-free HTML file with three surfaces:
 *   - Documents : Spec (TASK_REQUEST), Verify (VERIFY_CHECKLIST), Supervise
 *                 (supervision / security reports), and Analysis docs, rendered.
 *   - Database  : browse every table in qe.db with per-table search.
 *   - .qe Tree  : the folder tree with file counts and how much is indexed.
 *
 * The output is body-only HTML (a leading <title>/<style>, content, trailing
 * <script>) so it works both opened directly in a browser and published as an
 * Artifact. Regenerate any time: `node scripts/qe-inspector.mjs`.
 *
 * Usage: node scripts/qe-inspector.mjs [--out <path>]
 */

import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = process.cwd();
const QE = join(ROOT, '.qe');
const DB_PATH = join(QE, 'qe.db');
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/qe-inspector.mjs [--out <path>]');
  console.log('Generate a self-contained HTML inspection report from .qe/qe.db.');
  process.exit(0);
}
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? process.argv[outArg + 1] : join(QE, 'inspector.html');

const ROW_CAP = 800;          // max rows embedded per table
const DOC_CAP = 120;          // max documents whose full text is embedded
const DOC_BYTES = 90_000;     // per-doc text cap
const SKIP_DIRS = new Set(['.archive', '.snapshots', '.git', 'node_modules', '.qe']);
const DOC_KINDS = new Set(['task', 'checklist', 'analysis', 'contract', 'handoff', 'plan']);

if (!existsSync(DB_PATH)) {
  console.error(`qe-inspector: no store at ${DB_PATH}. Run a QE command first (the index self-builds on read).`);
  process.exit(1);
}

// ---- 1. Dump the store -----------------------------------------------------
let db;
try { db = new DatabaseSync(DB_PATH, { readOnly: true }); }
catch { db = new DatabaseSync(DB_PATH); }

const tableNames = db.prepare(
  "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
).all().map((r) => r.name);

const CELL_CAP = 300; // keep the embedded HTML small: cap long text cells (e.g. qe_files.content)
const tables = {};
for (const name of tableNames) {
  const total = db.prepare(`select count(*) c from "${name}"`).get().c;
  const raw = db.prepare(`select * from "${name}" limit ${ROW_CAP}`).all();
  const rows = raw.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = (typeof v === 'string' && v.length > CELL_CAP) ? v.slice(0, CELL_CAP) + `… (+${v.length - CELL_CAP} chars)` : v;
    }
    return o;
  });
  const cols = rows[0] ? Object.keys(rows[0])
    : db.prepare(`pragma table_info("${name}")`).all().map((c) => c.name);
  tables[name] = { total, shown: rows.length, cols, rows };
}

const schemaVersion = (() => {
  try { return db.prepare('pragma user_version').get().user_version; }
  catch { return '?'; }
})();

// Indexed doc paths (for the tree "indexed" badge and the Documents surface).
// Coverage reflects every table that points back at a source file, not just
// file_index — so wiki pages, task-log rows and failures count as "indexed" too.
const indexed = tables.file_index?.rows || [];
const indexedPaths = new Set(indexed.map((r) => r.path));
for (const r of tables.wiki_pages?.rows || []) if (r.path) indexedPaths.add(r.path);
for (const r of tables.task_log?.rows || []) if (r.src_path) indexedPaths.add(r.src_path);
for (const r of tables.failures?.rows || []) if (r.src_path) indexedPaths.add(r.src_path);

// ---- 2. Read document bodies ----------------------------------------------
function readDoc(absPath) {
  try {
    const raw = readFileSync(absPath, 'utf8');
    return raw.length > DOC_BYTES ? raw.slice(0, DOC_BYTES) + '\n\n…(truncated)…' : raw;
  } catch { return null; }
}

// Prefer the indexed docs; fall back to scanning tasks/checklists/analysis dirs.
const docs = [];
const seen = new Set();
function pushDoc(relPath, kind, status, uuid, title) {
  if (seen.has(relPath) || docs.length >= DOC_CAP) return;
  const abs = join(ROOT, relPath);
  if (!existsSync(abs) || !relPath.endsWith('.md')) return;
  const text = readDoc(abs);
  if (text == null) return;
  seen.add(relPath);
  docs.push({ path: relPath, kind, status: status || '', uuid: uuid || '', title: title || basename(relPath), text });
}
for (const r of indexed) {
  if (DOC_KINDS.has(r.kind)) pushDoc(r.path, r.kind, r.status, r.uuid, r.title);
}
// Supervision / security reports live under agent-results & security-reports.
for (const dir of ['agent-results', 'security-reports']) {
  const abs = join(QE, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs)) {
    if (f.endsWith('.md')) pushDoc(relative(ROOT, join(abs, f)), 'supervise', '', '', f);
  }
}

// ---- 3. Build the .qe tree -------------------------------------------------
function walk(absDir) {
  const node = { name: basename(absDir), path: relative(ROOT, absDir), files: 0, indexed: 0, bytes: 0, ext: {}, dirs: [] };
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return node; }
  for (const e of entries) {
    if (e.name === '.DS_Store') continue;
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) {
        // record the skipped dir as a leaf with a count only
        let n = 0; try { n = countFiles(abs); } catch { /* ignore */ }
        node.dirs.push({ name: e.name, path: relative(ROOT, abs), files: n, indexed: 0, bytes: 0, ext: {}, dirs: [], skipped: true });
      } else {
        node.dirs.push(walk(abs));
      }
    } else if (e.isFile()) {
      node.files += 1;
      const ext = e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.') + 1) : '(none)';
      node.ext[ext] = (node.ext[ext] || 0) + 1;
      try { node.bytes += statSync(abs).size; } catch { /* ignore */ }
      if (indexedPaths.has(relative(ROOT, abs))) node.indexed += 1;
    }
  }
  // roll up child counts
  for (const d of node.dirs) { node.files += d.files; node.indexed += d.indexed; node.bytes += d.bytes; }
  node.dirs.sort((a, b) => b.files - a.files);
  return node;
}
function countFiles(absDir) {
  let n = 0;
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(join(absDir, e.name));
    else if (e.isFile()) n += 1;
  }
  return n;
}
const tree = existsSync(QE) ? walk(QE) : null;

// A task_log row is historical evidence, not a mutable issue. Project it into
// a small read-only board so users can understand the store before opening SQL.
function taskLane(row) {
  const status = String(row.status || '').toLowerCase();
  const raw = String(row.status_raw || '').toLowerCase();
  if (status === 'done' || status === 'completed' || /(?:done|complete|completed|완료|完了|已完成)/.test(raw)) return 'done';
  if (status === 'paused' || /(?:paused|blocked|hold|중단|보류|中断|保留|暂停)/.test(raw)) return 'paused';
  if (status === 'pending' || status === 'planned' || /(?:📋|pending|planned|ready|대기|예정|待機|计划|待处理)/.test(raw)) return 'planned';
  return 'active';
}
const kanban = (tables.task_log?.rows || []).map((row) => ({
  uuid: row.uuid || '', title: row.title || row.uuid || '(untitled task)',
  body: row.body || '', status: row.status || '', statusRaw: row.status_raw || '',
  plan: row.plan || '', datedAt: row.dated_at || '', srcPath: row.src_path || '',
  lane: taskLane(row),
})).sort((a, b) => String(b.datedAt).localeCompare(String(a.datedAt)));
const laneCounts = Object.fromEntries(['planned', 'active', 'paused', 'done'].map((lane) => [lane, kanban.filter((task) => task.lane === lane).length]));
const fileRows = tables.file_index?.rows || [];
const workSummary = {
  laneCounts,
  pendingFiles: fileRows.filter((row) => row.status === 'pending').length,
  inProgressFiles: fileRows.filter((row) => row.status === 'in-progress').length,
};

db.close();

// ---- 4. Summary tiles ------------------------------------------------------
const projectName = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name || basename(ROOT); }
  catch { return basename(ROOT); }
})();
const qeVersion = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

const summary = {
  project: projectName,
  qeVersion,
  totalFiles: tree ? tree.files : 0,
  indexedFiles: tree ? tree.indexed : 0,
  tables: tableNames.length,
  tasks: tables.task_log?.total || 0,
  specs: indexed.filter((r) => r.kind === 'task').length,
  checklists: indexed.filter((r) => r.kind === 'checklist').length,
  failures: tables.failures?.total || 0,
  wikiPages: tables.wiki_pages?.total || 0,
  brokenLinks: (tables.wiki_links?.rows || []).filter((r) => !r.target_path).length,
  schemaVersion: schemaVersion,
};

const DATA = {
  summary,
  tables,
  docs,
  tree,
  kanban,
  workSummary,
  generatedAt: new Date().toISOString(),
  regenerateCommand: 'node scripts/qe-inspector.mjs',
};

// ---- 5. Emit HTML (write happens at the end, after CSS/JS are defined) -----
function renderHtml(dataJson, s) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>QE Inspector — ${esc(s.project)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip-link" href="#main" data-i18n="skipToContent">Skip to content</a>
<div id="app" data-loading="1">
  <aside id="side">
    <div class="brand"><span class="dot" aria-hidden="true"></span><div class="brand-copy"><b>QE Inspector</b><small>${esc(s.project)}${s.qeVersion ? ' · v' + esc(s.qeVersion) : ''}</small></div></div>
    <nav id="nav"></nav>
    <div class="side-foot"><small id="schema-note">SQLite · schema ${esc(String(s.schemaVersion))}</small><small class="muted">${esc(DATA.regenerateCommand)}</small></div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="context"><span class="eyebrow" data-i18n="readOnly">Read-only</span><strong>${esc(s.project)}</strong></div>
      <div class="toolbar">
        <label class="sr-only" for="locale-select" data-i18n="language">Language</label>
        <select id="locale-select" class="control" aria-label="Language">
          <option value="ko">한국어</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="zh">简体中文</option>
        </select>
        <button id="theme-toggle" class="control icon-control" type="button"></button>
      </div>
    </header>
    <main id="main" tabindex="-1"></main>
  </div>
</div>
<div id="announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
<script>const DATA=${dataJson};${JS}</script>
</body>
</html>`;
}

function esc(x) {
  return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// CSS ------------------------------------------------------------------------
const CSS = String.raw`
:root{
  --bg:#f4f6f9; --surface:#ffffff; --surface-2:#edf1f6; --surface-3:#e5eaf1;
  --ink:#17202b; --muted:#526071; --faint:#657287; --line:#d7dee8;
  --accent:#275efe; --accent-strong:#1747d1; --accent-weak:#e8eeff; --accent-fill:#275efe;
  --good:#087b55; --good-weak:#e4f5ee; --warn:#9a6200; --warn-weak:#fff1cf;
  --crit:#b42318; --crit-weak:#fee9e7; --focus:#6b4eff;
  --radius:10px; --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:"Pretendard","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans",system-ui,sans-serif;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d1117; --surface:#151b23; --surface-2:#1d2530; --surface-3:#263140;
  --ink:#edf1f7; --muted:#b2bdcc; --faint:#8d9aab; --line:#303b49;
  --accent:#7aa2ff; --accent-strong:#a8c0ff; --accent-weak:#1c2b4f; --accent-fill:#315fc9;
  --good:#59d3a3; --good-weak:#16362c; --warn:#f1bd63; --warn-weak:#3b2d14;
  --crit:#ff8b82; --crit-weak:#401f20; --focus:#a994ff; color-scheme:dark;
}}
:root[data-theme="dark"]{
  --bg:#0d1117; --surface:#151b23; --surface-2:#1d2530; --surface-3:#263140;
  --ink:#edf1f7; --muted:#b2bdcc; --faint:#8d9aab; --line:#303b49;
  --accent:#7aa2ff; --accent-strong:#a8c0ff; --accent-weak:#1c2b4f; --accent-fill:#315fc9;
  --good:#59d3a3; --good-weak:#16362c; --warn:#f1bd63; --warn-weak:#3b2d14;
  --crit:#ff8b82; --crit-weak:#401f20; --focus:#a994ff; color-scheme:dark;
}
:root[data-theme="light"]{
  --bg:#f4f6f9; --surface:#ffffff; --surface-2:#edf1f6; --surface-3:#e5eaf1;
  --ink:#17202b; --muted:#526071; --faint:#657287; --line:#d7dee8;
  --accent:#275efe; --accent-strong:#1747d1; --accent-weak:#e8eeff; --accent-fill:#275efe;
  --good:#087b55; --good-weak:#e4f5ee; --warn:#9a6200; --warn-weak:#fff1cf;
  --crit:#b42318; --crit-weak:#fee9e7; --focus:#6b4eff; color-scheme:light;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;max-width:100%;overflow-x:hidden}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
:lang(ja){font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans CJK JP",var(--sans)}
:lang(zh){font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",var(--sans)}
button,input,select{font:inherit}
button,select{touch-action:manipulation}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.skip-link{position:fixed;top:8px;left:8px;z-index:1000;background:var(--ink);color:var(--surface);padding:9px 12px;border-radius:7px;transform:translateY(-150%)}
.skip-link:focus{transform:translateY(0)}
#app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
#side{background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;min-width:0;z-index:20}
.brand{display:flex;gap:11px;align-items:center;padding:20px 18px 16px;min-width:0}
.brand-copy{min-width:0}.brand b{font-size:15px;letter-spacing:-.01em;display:block}.brand small{display:block;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:10px;height:18px;border-radius:3px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-weak);flex:none}
#nav{display:flex;flex-direction:column;gap:3px;padding:10px;flex:1;overflow:auto}
#nav button{appearance:none;border:0;background:transparent;display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;padding:9px 11px;border-radius:7px;color:var(--muted);cursor:pointer;font-weight:620;font-size:13.5px;text-align:left}
#nav button:hover{background:var(--surface-2);color:var(--ink)}
#nav button[aria-current="page"]{background:var(--accent-weak);color:var(--accent-strong)}
#nav button[aria-current="page"] .cnt{color:var(--accent-strong);font-weight:760}
#nav .grp{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);padding:16px 11px 5px;font-weight:720}
#nav .cnt{font-family:var(--mono);font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}
.side-foot{padding:12px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:3px}
.side-foot small{font-size:11px;color:var(--muted);font-family:var(--mono)}
.side-foot .muted{color:var(--faint)}
.workspace{min-width:0}.topbar{height:64px;position:sticky;top:0;z-index:15;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 30px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid color-mix(in srgb,var(--line) 72%,transparent)}
.context{display:flex;align-items:center;gap:9px;min-width:0}.context strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.eyebrow{border:1px solid var(--line);border-radius:999px;padding:2px 7px;color:var(--muted);font-size:10.5px;font-weight:760;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.toolbar{display:flex;gap:8px;align-items:center}.control{min-height:36px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:6px 10px;cursor:pointer}.control:hover{border-color:var(--accent)}.icon-control{min-width:40px}
#main{padding:30px 30px 64px;max-width:1240px;width:100%;min-width:0}
.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.page-head-copy{min-width:0}
h1.page{font-size:clamp(22px,2vw,28px);line-height:1.25;letter-spacing:-.025em;margin:0 0 5px;text-wrap:balance;word-break:keep-all}
.sub{color:var(--muted);margin:0;font-size:13px;max-width:70ch}.timestamp{color:var(--faint);font-size:11px;font-family:var(--mono);white-space:nowrap;padding-top:6px}
.status-callout{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--line);border-left:4px solid var(--good);background:var(--surface);border-radius:var(--radius);margin-bottom:16px}
.status-callout.attention{border-left-color:var(--warn);background:var(--warn-weak)}.status-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--good-weak);color:var(--good);font-weight:800}.attention .status-icon{background:var(--surface);color:var(--warn)}.status-copy{min-width:0}.status-copy strong{display:block}.status-copy span{display:block;color:var(--muted);font-size:12.5px}.status-action{appearance:none;border:0;background:transparent;color:var(--accent-strong);font-weight:720;cursor:pointer;padding:7px 8px;border-radius:6px;white-space:nowrap}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:22px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px;min-width:0}
.tile .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.045em;font-weight:700;word-break:keep-all}
.tile .v{font-size:25px;font-weight:740;letter-spacing:-.025em;font-variant-numeric:tabular-nums;margin-top:4px}
.tile .v small{font-size:13px;color:var(--faint);font-weight:500}
.tile.stripe{border-top:3px solid var(--accent)}.tile.good{border-top:3px solid var(--good)}.tile.warn{border-top:3px solid var(--warn)}.tile.crit{border-top:3px solid var(--crit)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.field{display:flex;flex-direction:column;gap:5px;min-width:0}.field.grow{flex:1}.field-label{font-size:11px;color:var(--muted);font-weight:720}
.search,.select{width:100%;min-height:40px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 11px;color:var(--ink);font-family:var(--sans);font-size:13px}.select{min-width:220px}
.search:focus,.select:focus{border-color:var(--accent)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{appearance:none;cursor:pointer;padding:6px 10px;border-radius:20px;font-size:12px;font-weight:650;color:var(--muted);background:var(--surface);border:1px solid var(--line)}
.chip[aria-pressed="true"]{background:var(--accent-fill);color:#fff;border-color:var(--accent-fill)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.list{display:flex;flex-direction:column}
.item{appearance:none;border:0;background:transparent;display:grid;grid-template-columns:auto minmax(140px,1fr) auto minmax(100px,.8fr);gap:12px;align-items:center;width:100%;padding:12px 15px;border-bottom:1px solid var(--line);cursor:pointer;color:var(--ink);text-align:left}
.item:last-child{border-bottom:0}
.item:hover{background:var(--surface-2)}
.item .ttl{font-weight:560;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .path{font-family:var(--mono);font-size:11px;color:var(--faint);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}.item.overview-item{grid-template-columns:minmax(130px,.6fr) minmax(200px,1fr) auto}.item.overview-item .path{text-align:left;font-family:var(--sans);font-size:12.5px;color:var(--muted)}
.badge{font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:5px;text-transform:uppercase;letter-spacing:.03em;font-family:var(--mono)}
.b-task{background:var(--accent-weak);color:var(--accent)} .b-checklist{background:#efe7fd;color:#7a3ed6}
.b-analysis{background:#e7f6ef;color:var(--good)} .b-supervise{background:var(--warn-weak);color:var(--warn)}
.b-contract{background:#e6f2fb;color:#2b7fc4} .b-handoff{background:var(--surface-2);color:var(--muted)} .b-plan{background:var(--surface-2);color:var(--muted)}
:root[data-theme="dark"] .b-checklist{background:#2a2140;color:#c4a5ff} :root[data-theme="dark"] .b-analysis{background:#123026}
:root[data-theme="dark"] .b-supervise{background:#332612} :root[data-theme="dark"] .b-contract{background:#12293b}
@media (prefers-color-scheme:dark){.b-checklist{background:#2a2140;color:#c4a5ff}.b-analysis{background:#123026}.b-supervise{background:#332612}.b-contract{background:#12293b}}
.st{font-size:11px;font-weight:600;font-family:var(--mono);padding:2px 6px;border-radius:5px;background:var(--surface-2);color:var(--muted)}
.st.completed,.st.done{color:var(--good)} .st.pending{color:var(--warn)} .st.in-progress{color:var(--accent)}
.results-meta{color:var(--muted);font-size:12px;margin:-3px 0 11px}.tablewrap{overflow:auto;max-height:min(66vh,720px);border-radius:var(--radius)}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--surface-2);color:var(--muted);font-weight:620;font-size:11px;text-transform:uppercase;letter-spacing:.04em;z-index:1}
td{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink)}
tr:hover td{background:var(--surface-2)}
.tbl-meta{color:var(--muted);font-size:12px;margin:2px 0 14px;font-family:var(--mono)}
.reader{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:8px 4px}
.reader-head{display:flex;gap:10px;align-items:center;padding:8px 16px 12px;border-bottom:1px solid var(--line);margin-bottom:8px;min-width:0}
.reader-head .path{font-family:var(--mono);font-size:11.5px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis}
.back,.secondary-action{appearance:none;border:0;background:transparent;cursor:pointer;color:var(--accent-strong);font-weight:680;font-size:13px;padding:6px 8px;border-radius:6px}
.md{padding:4px 20px 22px;max-width:74ch}
.md h1,.md h2,.md h3,.md h4,.md h5{letter-spacing:-.015em;line-height:1.25;margin:1.4em 0 .5em;text-wrap:balance}
.md h2{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:.3em} .md h3{font-size:17px} .md h4,.md h5{font-size:14.5px;color:var(--muted);text-transform:none}
.md p{margin:.6em 0} .md ul,.md ol{margin:.5em 0;padding-left:1.4em} .md li{margin:.2em 0}
.md code{font-family:var(--mono);font-size:.86em;background:var(--surface-2);padding:1.5px 5px;border-radius:4px}
.md pre{background:var(--surface-2);padding:12px 14px;border-radius:8px;overflow-x:auto} .md pre code{background:none;padding:0}
.md blockquote{border-left:3px solid var(--accent);margin:.7em 0;padding:.1em 0 .1em 14px;color:var(--muted)}
.md table{margin:.8em 0} .md th,.md td{white-space:normal;font-family:var(--sans)} .md td{font-family:var(--sans)}
.md a{color:var(--accent)} .md hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
.tree{font-family:var(--mono);font-size:12.5px}
.tnode{padding:2px 0}
.trow{appearance:none;border:0;background:transparent;color:var(--ink);display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border-radius:6px;cursor:default;text-align:left;font-family:var(--mono)}
.trow[aria-expanded]{cursor:pointer}
.trow:hover{background:var(--surface-2)}
.tname{flex:1} .tname b{font-family:var(--sans);font-weight:600}
.tw{color:var(--faint)} .caret{width:12px;display:inline-block;color:var(--faint);transition:transform .12s}
.tchildren{margin-left:16px;border-left:1px solid var(--line);padding-left:6px}
.bar{height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden;width:70px;flex:none}
.bar>i{display:block;height:100%;background:var(--good)}
.pct{color:var(--muted);font-size:11px;width:34px;text-align:right;font-variant-numeric:tabular-nums}
.skip{color:var(--faint);font-style:italic}
.empty{color:var(--muted);padding:34px 18px;text-align:center}.empty strong{display:block;color:var(--ink);margin-bottom:4px}.empty .secondary-action{margin-top:8px}
.purpose{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(250px,.6fr);gap:12px;margin-bottom:18px}.purpose-main,.purpose-side,.guide{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px}.purpose-main{border-top:4px solid var(--accent)}.purpose h2,.guide h2{font-size:17px;margin:0 0 6px;letter-spacing:-.015em}.purpose p,.guide p{color:var(--muted);margin:0}.purpose-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.primary-action,.secondary-button{appearance:none;border:1px solid var(--accent-fill);border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700}.primary-action{background:var(--accent-fill);color:#fff}.secondary-button{background:var(--surface);color:var(--accent-strong);border-color:var(--line)}.purpose-side strong{display:block;margin-bottom:8px}.purpose-side ol{margin:0;padding-left:20px;color:var(--muted)}
.board-note{display:flex;align-items:flex-start;gap:8px;color:var(--muted);font-size:12px;margin:-8px 0 14px}.evidence{display:inline-block;flex:none;border-radius:999px;padding:2px 7px;background:var(--surface-2);color:var(--muted);font-family:var(--mono);font-size:10px;font-weight:700}.kanban-wrap{overflow-x:auto;padding-bottom:8px}.kanban{display:grid;grid-template-columns:repeat(4,minmax(250px,1fr));gap:12px;min-width:1040px}.lane{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius);padding:10px;align-self:start}.lane-head{display:flex;justify-content:space-between;align-items:center;padding:2px 3px 10px}.lane-head h2{font-size:13px;margin:0}.lane-count{font-family:var(--mono);font-size:11px;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:1px 7px;border-radius:999px}.task-card{background:var(--surface);border:1px solid var(--line);border-radius:8px;margin-bottom:8px;overflow:hidden}.task-card:last-child{margin-bottom:0}.task-card summary{cursor:pointer;list-style:none;padding:11px}.task-card summary::-webkit-details-marker{display:none}.task-title{display:block;font-weight:680;line-height:1.4}.task-meta{display:flex;gap:6px;flex-wrap:wrap;color:var(--faint);font-family:var(--mono);font-size:10.5px;margin-top:7px}.task-detail{border-top:1px solid var(--line);padding:10px 11px;color:var(--muted);font-size:12px}.task-detail p{margin:0 0 8px;white-space:pre-wrap}.task-detail code{font-family:var(--mono);font-size:10.5px}.lane-empty{padding:18px 8px;color:var(--muted);font-size:12px;text-align:center}.show-more{width:100%;margin-top:4px}
.guide{margin-bottom:14px;display:grid;grid-template-columns:minmax(180px,.4fr) minmax(0,1fr);gap:18px;align-items:start}.guide-name{font-family:var(--mono);color:var(--accent-strong);font-size:12px;margin-bottom:5px}.guide-use{border-left:3px solid var(--accent);padding-left:12px}.guide-use strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;color:var(--muted)}
.assistant-shell{max-width:820px;margin:0 auto}.assistant-disclosure{background:var(--accent-weak);border:1px solid color-mix(in srgb,var(--accent) 35%,var(--line));border-radius:var(--radius);padding:13px 15px;color:var(--muted);font-size:12px;margin-bottom:14px}.assistant-disclosure strong{display:block;color:var(--ink);margin-bottom:3px}.assistant-status{display:flex;gap:8px;align-items:center;margin-bottom:14px;color:var(--muted);font-size:12px}.chat{display:flex;flex-direction:column;gap:12px;min-height:180px;margin:18px 0}.message{max-width:90%;border-radius:12px;padding:12px 14px}.message.user{align-self:flex-end;background:var(--accent-fill);color:#fff}.message.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--line);width:100%}.message.assistant .md{padding:0;max-width:none}.suggestions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.suggestion{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:7px 10px;cursor:pointer;font-size:12px}.suggestion:hover{border-color:var(--accent)}.composer{position:sticky;bottom:12px;background:var(--surface);border:1px solid var(--line);box-shadow:0 8px 30px color-mix(in srgb,#000 12%,transparent);border-radius:13px;padding:10px}.composer textarea{display:block;width:100%;min-height:82px;resize:vertical;border:0;background:transparent;color:var(--ink);padding:4px;font:inherit}.composer textarea:focus{outline:0}.composer-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:8px}.provider{min-width:130px}.assistant-error{color:var(--crit);font-size:12px;margin:8px 2px}.static-command{display:flex;align-items:center;gap:8px;margin-top:12px;background:var(--surface-2);border-radius:8px;padding:9px 10px}.static-command code{font-family:var(--mono);font-size:12px;flex:1}.spinner{width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.caret{transition:none}}
@media(max-width:860px){
  #app{grid-template-columns:1fr}#side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  .brand{padding:14px 16px 8px}#nav{flex-direction:row;overflow-x:auto;padding:7px 10px 10px}.side-foot,#nav .grp{display:none}#nav button{width:auto;min-width:max-content;padding:8px 10px}.topbar{top:0;height:58px;padding:0 16px}
  #main{padding:22px 16px 48px}.tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.item{grid-template-columns:auto minmax(120px,1fr) auto}.item .path{grid-column:2/-1;text-align:left}.item.overview-item{grid-template-columns:minmax(100px,.55fr) minmax(150px,1fr) auto}.item.overview-item .path{grid-column:auto}.timestamp{display:none}.purpose{grid-template-columns:1fr}.guide{grid-template-columns:1fr;gap:8px}
}
@media(max-width:560px){
  body{font-size:13.5px}.context strong{display:none}.toolbar{margin-left:auto}.control{min-height:40px}.topbar{gap:8px}
  .page-head{margin-bottom:18px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.tile{padding:12px}.tile .v{font-size:23px}
  .status-callout{grid-template-columns:auto minmax(0,1fr)}.status-action{grid-column:2;justify-self:start;padding-left:0}
  .row{align-items:stretch}.field,.field.grow{width:100%}.select{min-width:0}.chips{flex-wrap:nowrap;overflow-x:auto;padding:3px 2px 5px}
  .item,.item.overview-item{grid-template-columns:auto minmax(0,1fr) auto;gap:8px}.item .path,.item.overview-item .path{grid-column:2/-1}.reader-head{flex-wrap:wrap}.reader-head .path{order:3;flex-basis:100%}.md{padding:4px 14px 18px}
  .tw,.bar,.pct{display:none}.tchildren{margin-left:10px;padding-left:3px}.message{max-width:100%}.composer-foot{align-items:stretch;flex-wrap:wrap}.provider{flex:1}.composer .primary-action{flex:1}
}
@media(max-width:340px){.tiles{grid-template-columns:1fr}.brand small{max-width:230px}#main{padding-left:12px;padding-right:12px}.topbar{padding-left:12px;padding-right:12px}}
`;

// JS -------------------------------------------------------------------------
const JS = String.raw`
const $=(s,r=document)=>r.querySelector(s), el=(tag,className)=>{const node=document.createElement(tag);if(className)node.className=className;return node;};
const I18N={
  en:{
    skipToContent:'Skip to content',readOnly:'Read-only',language:'Language',primaryNavigation:'Primary navigation',contentGroup:'Content',
    overviewNav:'Overview',workNav:'Work board',assistantNav:'Ask AI',documentsNav:'Documents',databaseNav:'Data explorer',treeNav:'.qe Tree',themeToDark:'Switch to dark mode',themeToLight:'Switch to light mode',
    overviewTitle:'QE work console',overviewSub:'Understand what is happening, why it matters, and where to verify it.',generatedAt:'Generated {time}',
    needsReview:'Needs review',needsReviewDetail:'{failures} failure records · {broken} broken links',reviewFailures:'Review failures',healthy:'Store looks healthy',healthyDetail:'No failures or broken links were found in this snapshot.',
    filesInQe:'Files in .qe',indexed:'Indexed',dbTables:'DB tables',taskRows:'Task log rows',specs:'Specs',checklists:'Checklists',failures:'Failures',wikiPages:'Wiki pages',brokenLinks:'Broken links',
    purposeTitle:'Start with the work, then inspect the evidence',purposeText:'The board translates task history into an understandable workflow. Documents and database rows remain the source evidence.',purposeSteps:'Recommended path',stepWork:'Check planned, active, paused, and completed work',stepExplain:'Open a card to see its status and source',stepEvidence:'Use documents or data only when you need proof',openWork:'Open work board',askAi:'Ask about this snapshot',workDesc:'See task history as a read-only Kanban board.',assistantDesc:'Ask the locally logged-in Claude or Codex about this snapshot.',documentsDesc:'Read specs, verification, supervision, and analysis.',databaseDesc:'Inspect explained SQLite tables without modifying data.',treeDesc:'Explore folders and index coverage.',docsCount:'{count} documents',tablesCount:'{count} tables',filesCount:'{count} files',tasksCount:'{count} tasks',
    workTitle:'Work board',workSub:'A read-only Kanban projection of task history, not a live issue tracker.',boardEvidence:'Derived from task_log.status and status_raw. Cards cannot be moved here.',planned:'Planned',active:'Active',paused:'Paused',done:'Done',emptyLane:'No tasks are classified in this lane.',showAll:'Show all {count}',source:'Source',recorded:'Recorded',rawStatus:'Recorded status',pendingFiles:'Pending indexed files',inProgressFiles:'In-progress indexed files',
    assistantTitle:'Ask about the project state',assistantSub:'Use the locally logged-in Claude or Codex to interpret only this dashboard snapshot.',assistantDisclosureTitle:'Local, opt-in assistant',assistantDisclosure:'Your question and a compact dashboard context are sent to the selected local CLI. Claude tools are disabled; Codex runs ephemerally in a read-only sandbox. Account usage may apply.',assistantUnavailable:'Assistant mode is off in this static file.',assistantUnavailableHint:'Start the loopback-only server to enable local questions. No credentials are stored by the dashboard.',copyCommand:'Copy command',copied:'Copied',provider:'Provider',questionPlaceholder:'Ask what needs attention or where a status came from…',send:'Ask',asking:'Asking…',assistantReady:'Local assistant is ready.',assistantNoProvider:'No supported local CLI is available.',assistantFailed:'The assistant could not answer. Your question was kept.',suggestAttention:'What needs attention?',suggestPaused:'Why are tasks paused?',suggestEvidence:'Which evidence should I inspect next?',you:'You',assistant:'Assistant',
    documentsTitle:'Documents',documentsSub:'Rendered specs, verification, supervision, and analysis.',searchDocuments:'Search titles and paths',filterByKind:'Filter by document type',all:'All',resultsCount:'{count} results',
    noMatchingDocs:'No matching documents',noMatchingDocsHint:'Try another search or clear the filters.',clearFilters:'Clear filters',backToDocuments:'Back to all documents',
    databaseTitle:'Data explorer',databaseSub:'Choose an explained dataset, then inspect the local qe.db rows in read-only mode.',chooseTable:'Dataset',filterRows:'Filter rows in the selected dataset',tablePurpose:'What this dataset means',tableUse:'Use it when',guideTaskLog:'Task history captured by QE goals and workflows.',guideTaskLogUse:'You need to understand work titles, recorded states, plans, or source files.',guideSessions:'Execution sessions and their lifecycle timestamps.',guideSessionsUse:'You need to trace when a QE run started, ended, or may be stale.',guideFailures:'Recorded validation, execution, or workflow failures.',guideFailuresUse:'You need to investigate warnings and failed outcomes.',guideFileIndex:'QE documents discovered in the project and their indexing state.',guideFileIndexUse:'You need to find pending or in-progress project artifacts.',guideQeFiles:'Normalized metadata and content references for indexed QE files.',guideQeFilesUse:'You need the stored representation behind a document.',guideWikiPages:'Pages available to the QE wiki index.',guideWikiPagesUse:'You need reusable project knowledge.',guideWikiLinks:'Links resolved between wiki pages.',guideWikiLinksUse:'You need to find missing or broken knowledge links.',guideLifecycle:'Internal lifecycle state used to coordinate goals and runs.',guideLifecycleUse:'You are diagnosing framework state transitions.',guideProcess:'Internal process-controller state and leases.',guideProcessUse:'You are diagnosing concurrency or ownership.',guideProjection:'Derived state that can be rebuilt from source records.',guideProjectionUse:'You are investigating sync or projection debt.',guideGeneric:'Framework-owned records stored in this SQLite table.',guideGenericUse:'You already know the table name or are tracing an implementation detail.',
    tableMeta:'{table} · {total} rows · {columns} columns',tableMetaCapped:'{table} · {total} rows, first {shown} loaded · {columns} columns',emptyTable:'This table is empty',emptyTableHint:'Choose another table to inspect its rows.',noMatchingRows:'No rows match this filter',noMatchingRowsHint:'Change the search text or clear the filter.',moreRows:'{count} additional matching rows are not shown.',
    treeTitle:'.qe tree',treeSub:'{files} files · {indexed} indexed in the store',notIndexed:'not indexed',expandFolder:'Expand {name}',collapseFolder:'Collapse {name}',
    schemaNote:'SQLite · schema {version}'
  },
  ko:{
    skipToContent:'본문으로 건너뛰기',readOnly:'읽기 전용',language:'언어',primaryNavigation:'주요 탐색',contentGroup:'콘텐츠',
    overviewNav:'개요',workNav:'작업 보드',assistantNav:'AI에게 질문',documentsNav:'문서',databaseNav:'데이터 탐색',treeNav:'.qe 트리',themeToDark:'다크 모드로 전환',themeToLight:'라이트 모드로 전환',
    overviewTitle:'QE 작업 콘솔',overviewSub:'지금 무엇이 일어나고 있는지, 왜 중요한지, 어디서 근거를 확인할지 보여줍니다.',generatedAt:'생성 시각: {time}',
    needsReview:'검토 필요',needsReviewDetail:'실패 기록 {failures}건 · 깨진 링크 {broken}건',reviewFailures:'실패 기록 확인',healthy:'저장소 상태 양호',healthyDetail:'이 스냅샷에서 실패 기록이나 깨진 링크가 발견되지 않았습니다.',
    filesInQe:'.qe 파일',indexed:'인덱싱됨',dbTables:'DB 테이블',taskRows:'작업 로그 행',specs:'명세',checklists:'체크리스트',failures:'실패 기록',wikiPages:'위키 페이지',brokenLinks:'깨진 링크',
    purposeTitle:'작업을 먼저 보고, 필요할 때 근거를 확인하세요',purposeText:'작업 보드는 로그를 이해하기 쉬운 흐름으로 바꾸어 보여줍니다. 문서와 DB 행은 그 판단의 근거입니다.',purposeSteps:'추천 확인 순서',stepWork:'예정·진행·중단·완료 작업 확인',stepExplain:'카드를 열어 상태와 출처 확인',stepEvidence:'필요할 때만 문서나 데이터로 검증',openWork:'작업 보드 열기',askAi:'이 스냅샷에 대해 질문',workDesc:'작업 이력을 읽기 전용 칸반으로 보여줍니다.',assistantDesc:'로컬에 로그인된 Claude 또는 Codex에게 스냅샷을 묻습니다.',documentsDesc:'명세, 검증, 감독, 분석 문서를 읽습니다.',databaseDesc:'설명이 포함된 SQLite 테이블을 읽기 전용으로 확인합니다.',treeDesc:'폴더 구조와 인덱스 포함 범위를 탐색합니다.',docsCount:'문서 {count}개',tablesCount:'테이블 {count}개',filesCount:'파일 {count}개',tasksCount:'작업 {count}개',
    workTitle:'작업 보드',workSub:'작업 이력을 칸반으로 투영한 읽기 전용 화면입니다. 실시간 이슈 트래커가 아닙니다.',boardEvidence:'task_log.status와 status_raw로 분류했습니다. 여기서 카드를 이동할 수는 없습니다.',planned:'예정',active:'진행',paused:'중단',done:'완료',emptyLane:'이 단계로 분류된 작업이 없습니다.',showAll:'{count}개 모두 보기',source:'출처',recorded:'기록 시각',rawStatus:'기록 상태',pendingFiles:'대기 인덱스 파일',inProgressFiles:'진행 인덱스 파일',
    assistantTitle:'프로젝트 상태에 대해 질문',assistantSub:'로컬에 로그인된 Claude 또는 Codex로 이 대시보드 스냅샷만 해석합니다.',assistantDisclosureTitle:'로컬·선택형 AI 도우미',assistantDisclosure:'질문과 축약된 대시보드 맥락을 선택한 로컬 CLI에 전달합니다. Claude는 도구를 끄고, Codex는 임시 읽기 전용 샌드박스로 실행합니다. 계정 사용량이 차감될 수 있습니다.',assistantUnavailable:'정적 파일에서는 AI 모드가 꺼져 있습니다.',assistantUnavailableHint:'루프백 전용 서버를 실행하면 로컬 질의를 활성화합니다. 대시보드는 인증 정보를 저장하지 않습니다.',copyCommand:'명령어 복사',copied:'복사됨',provider:'제공자',questionPlaceholder:'무엇을 점검해야 하는지, 상태의 근거가 어디인지 물어보세요…',send:'질문',asking:'확인 중…',assistantReady:'로컬 AI 도우미를 사용할 수 있습니다.',assistantNoProvider:'사용 가능한 로컬 CLI가 없습니다.',assistantFailed:'AI 응답을 받지 못했습니다. 질문은 그대로 유지했습니다.',suggestAttention:'지금 무엇을 점검해야 해?',suggestPaused:'중단된 작업의 이유는?',suggestEvidence:'다음으로 어떤 근거를 볼까?',you:'나',assistant:'AI',
    documentsTitle:'문서',documentsSub:'명세, 검증, 감독, 분석 문서를 렌더링합니다.',searchDocuments:'제목과 경로 검색',filterByKind:'문서 유형 필터',all:'전체',resultsCount:'결과 {count}개',
    noMatchingDocs:'일치하는 문서가 없습니다',noMatchingDocsHint:'다른 검색어를 입력하거나 필터를 초기화하세요.',clearFilters:'필터 초기화',backToDocuments:'전체 문서로 돌아가기',
    databaseTitle:'데이터 탐색',databaseSub:'설명을 읽고 데이터셋을 선택한 뒤, 로컬 qe.db 행을 읽기 전용으로 확인합니다.',chooseTable:'데이터셋',filterRows:'선택한 데이터셋의 행 검색',tablePurpose:'이 데이터셋의 의미',tableUse:'이럴 때 보세요',guideTaskLog:'QE 목표와 워크플로에서 기록한 작업 이력입니다.',guideTaskLogUse:'작업 제목, 기록 상태, 계획, 출처 파일을 확인할 때',guideSessions:'실행 세션과 시작·종료 시각 기록입니다.',guideSessionsUse:'QE 실행이 언제 시작·종료됐는지나 오래된 세션을 추적할 때',guideFailures:'검증, 실행, 워크플로 실패 기록입니다.',guideFailuresUse:'경고나 실패 결과를 조사할 때',guideFileIndex:'프로젝트에서 발견한 QE 문서와 인덱싱 상태입니다.',guideFileIndexUse:'대기·진행 중인 프로젝트 산출물을 찾을 때',guideQeFiles:'인덱싱된 QE 파일의 표준화된 메타데이터와 콘텐츠 참조입니다.',guideQeFilesUse:'문서 뒤에 저장된 표현을 확인할 때',guideWikiPages:'QE 위키 인덱스에서 사용할 수 있는 페이지입니다.',guideWikiPagesUse:'재사용 가능한 프로젝트 지식을 찾을 때',guideWikiLinks:'위키 페이지 사이에서 해석된 링크입니다.',guideWikiLinksUse:'누락되거나 깨진 지식 링크를 찾을 때',guideLifecycle:'목표와 실행을 조율하는 내부 생명주기 상태입니다.',guideLifecycleUse:'프레임워크 상태 전이를 진단할 때',guideProcess:'내부 프로세스 컨트롤러 상태와 리스입니다.',guideProcessUse:'동시성이나 소유권을 진단할 때',guideProjection:'원본 기록에서 다시 만들 수 있는 파생 상태입니다.',guideProjectionUse:'동기화나 프로젝션 부채를 조사할 때',guideGeneric:'이 SQLite 테이블에 저장된 프레임워크 내부 기록입니다.',guideGenericUse:'테이블 이름을 알고 있거나 구현 세부사항을 추적할 때',
    tableMeta:'{table} · 전체 {total}행 · {columns}열',tableMetaCapped:'{table} · 전체 {total}행 중 처음 {shown}행 로드 · {columns}열',emptyTable:'빈 테이블입니다',emptyTableHint:'다른 테이블을 선택해 행을 확인하세요.',noMatchingRows:'필터와 일치하는 행이 없습니다',noMatchingRowsHint:'검색어를 바꾸거나 필터를 초기화하세요.',moreRows:'일치하는 행 {count}개가 추가로 있지만 표시하지 않았습니다.',
    treeTitle:'.qe 트리',treeSub:'파일 {files}개 · 저장소 인덱스 포함 {indexed}개',notIndexed:'인덱싱 제외',expandFolder:'{name} 폴더 펼치기',collapseFolder:'{name} 폴더 접기',
    schemaNote:'SQLite · 스키마 {version}'
  },
  ja:{
    skipToContent:'本文へ移動',readOnly:'読み取り専用',language:'言語',primaryNavigation:'メインナビゲーション',contentGroup:'コンテンツ',
    overviewNav:'概要',workNav:'作業ボード',assistantNav:'AIに質問',documentsNav:'ドキュメント',databaseNav:'データ探索',treeNav:'.qe ツリー',themeToDark:'ダークモードに切り替え',themeToLight:'ライトモードに切り替え',
    overviewTitle:'QE 作業コンソール',overviewSub:'何が起きているか、なぜ重要か、どこで根拠を確認するかを示します。',generatedAt:'生成日時: {time}',
    needsReview:'要確認',needsReviewDetail:'失敗記録 {failures} 件 · リンク切れ {broken} 件',reviewFailures:'失敗記録を確認',healthy:'ストアは正常です',healthyDetail:'このスナップショットに失敗記録やリンク切れはありません。',
    filesInQe:'.qe のファイル',indexed:'インデックス済み',dbTables:'DB テーブル',taskRows:'タスクログ行',specs:'仕様',checklists:'チェックリスト',failures:'失敗記録',wikiPages:'Wiki ページ',brokenLinks:'リンク切れ',
    purposeTitle:'まず作業を見て、必要なときに根拠を確認',purposeText:'作業ボードはログを理解しやすい流れに変換します。ドキュメントとDB行が根拠です。',purposeSteps:'推奨する確認順',stepWork:'予定・進行・中断・完了を確認',stepExplain:'カードで状態と出典を確認',stepEvidence:'必要時のみドキュメントやデータで検証',openWork:'作業ボードを開く',askAi:'このスナップショットに質問',workDesc:'作業履歴を読み取り専用カンバンで表示します。',assistantDesc:'ローカルのClaudeまたはCodexにスナップショットを質問します。',documentsDesc:'仕様、検証、監督、分析ドキュメントを読みます。',databaseDesc:'説明付きSQLiteテーブルを読み取り専用で確認します。',treeDesc:'フォルダー構成とインデックス範囲を確認します。',docsCount:'{count} 件のドキュメント',tablesCount:'{count} テーブル',filesCount:'{count} ファイル',tasksCount:'{count} 件の作業',
    workTitle:'作業ボード',workSub:'作業履歴の読み取り専用カンバン投影です。ライブの課題管理ではありません。',boardEvidence:'task_log.status と status_raw から分類。カードは移動できません。',planned:'予定',active:'進行',paused:'中断',done:'完了',emptyLane:'この段階の作業はありません。',showAll:'{count} 件すべて表示',source:'出典',recorded:'記録日時',rawStatus:'記録状態',pendingFiles:'待機中のファイル',inProgressFiles:'進行中のファイル',
    assistantTitle:'プロジェクト状態について質問',assistantSub:'ローカルのClaudeまたはCodexでこのスナップショットのみ解釈します。',assistantDisclosureTitle:'ローカル・オプトインAI',assistantDisclosure:'質問と圧縮コンテキストをローカルCLIに送ります。Claudeはツール無効、Codexは一時的な読み取り専用サンドボックスで実行します。アカウント使用量が発生する場合があります。',assistantUnavailable:'静的ファイルではAIモードはオフです。',assistantUnavailableHint:'ループバック専用サーバーを起動して有効にします。認証情報は保存しません。',copyCommand:'コマンドをコピー',copied:'コピー済み',provider:'プロバイダー',questionPlaceholder:'注意点や状態の根拠を質問…',send:'質問',asking:'確認中…',assistantReady:'ローカルAIを使用できます。',assistantNoProvider:'利用可能なローカルCLIがありません。',assistantFailed:'AIが回答できませんでした。質問は保持されます。',suggestAttention:'今の注意点は？',suggestPaused:'中断した作業の理由は？',suggestEvidence:'次に確認すべき根拠は？',you:'あなた',assistant:'AI',
    documentsTitle:'ドキュメント',documentsSub:'仕様、検証、監督、分析をレンダリングします。',searchDocuments:'タイトルとパスを検索',filterByKind:'ドキュメント種別で絞り込み',all:'すべて',resultsCount:'{count} 件',
    noMatchingDocs:'一致するドキュメントがありません',noMatchingDocsHint:'検索語を変更するか、フィルターを解除してください。',clearFilters:'フィルターを解除',backToDocuments:'すべてのドキュメントに戻る',
    databaseTitle:'データ探索',databaseSub:'説明を読んでから、qe.dbの行を読み取り専用で確認します。',chooseTable:'データセット',filterRows:'選択したデータセットを検索',tablePurpose:'このデータの意味',tableUse:'使う場面',guideGeneric:'このSQLiteテーブルに保存されたフレームワーク内部記録です。',guideGenericUse:'テーブル名が分かる場合や実装詳細の追跡時',guideTaskLog:'QEが記録した作業履歴です。',guideTaskLogUse:'作業名、状態、計画、出典の確認時',guideSessions:'実行セッションとライフサイクルの記録です。',guideSessionsUse:'QE実行の開始・終了・停滞の追跡時',guideFailures:'検証や実行の失敗記録です。',guideFailuresUse:'警告や失敗の調査時',guideFileIndex:'QEドキュメントとインデックス状態です。',guideFileIndexUse:'待機中や進行中の成果物を探す時',guideQeFiles:'インデックスされたQEファイルの正規化表現です。',guideQeFilesUse:'ドキュメントの保存表現の確認時',guideWikiPages:'QE Wikiインデックスのページです。',guideWikiPagesUse:'再利用可能なプロジェクト知識の検索時',guideWikiLinks:'Wikiページ間で解決されたリンクです。',guideWikiLinksUse:'欠落やリンク切れの調査時',guideLifecycle:'目標と実行を調整する内部状態です。',guideLifecycleUse:'フレームワークの状態遷移の診断時',guideProcess:'内部プロセス制御状態です。',guideProcessUse:'並行性や所有権の診断時',guideProjection:'元データから再構築可能な導出状態です。',guideProjectionUse:'同期や投影負債の調査時',
    tableMeta:'{table} · 全 {total} 行 · {columns} 列',tableMetaCapped:'{table} · 全 {total} 行のうち先頭 {shown} 行を読込 · {columns} 列',emptyTable:'このテーブルは空です',emptyTableHint:'別のテーブルを選択してください。',noMatchingRows:'条件に一致する行がありません',noMatchingRowsHint:'検索語を変更するか、フィルターを解除してください。',moreRows:'一致する残り {count} 行は表示されていません。',
    treeTitle:'.qe ツリー',treeSub:'{files} ファイル · {indexed} ファイルをインデックス済み',notIndexed:'インデックス対象外',expandFolder:'{name} フォルダーを展開',collapseFolder:'{name} フォルダーを折りたたむ',
    schemaNote:'SQLite · スキーマ {version}'
  },
  zh:{
    skipToContent:'跳到主要内容',readOnly:'只读',language:'语言',primaryNavigation:'主导航',contentGroup:'内容',
    overviewNav:'概览',workNav:'工作看板',assistantNav:'询问 AI',documentsNav:'文档',databaseNav:'数据探索',treeNav:'.qe 目录树',themeToDark:'切换到深色模式',themeToLight:'切换到浅色模式',
    overviewTitle:'QE 工作控制台',overviewSub:'了解发生了什么、为何重要，以及去哪里核对证据。',generatedAt:'生成时间：{time}',
    needsReview:'需要检查',needsReviewDetail:'{failures} 条失败记录 · {broken} 个失效链接',reviewFailures:'查看失败记录',healthy:'存储状态正常',healthyDetail:'此快照中未发现失败记录或失效链接。',
    filesInQe:'.qe 文件',indexed:'已索引',dbTables:'DB 表',taskRows:'任务日志行',specs:'规格',checklists:'检查清单',failures:'失败记录',wikiPages:'Wiki 页面',brokenLinks:'失效链接',
    purposeTitle:'先看工作，需要时再核对证据',purposeText:'看板将日志转换为易懂的流程。文档和数据库行是判断的证据。',purposeSteps:'建议查看顺序',stepWork:'查看计划、进行、暂停和完成工作',stepExplain:'打开卡片查看状态和来源',stepEvidence:'需要时用文档或数据验证',openWork:'打开工作看板',askAi:'询问此快照',workDesc:'以只读看板展示工作历史。',assistantDesc:'询问本地已登录的 Claude 或 Codex。',documentsDesc:'阅读规格、验证、监督和分析文档。',databaseDesc:'只读查看带说明的 SQLite 表。',treeDesc:'浏览文件夹结构和索引覆盖范围。',docsCount:'{count} 份文档',tablesCount:'{count} 个表',filesCount:'{count} 个文件',tasksCount:'{count} 个工作',
    workTitle:'工作看板',workSub:'工作历史的只读看板投影，不是实时问题跟踪器。',boardEvidence:'由 task_log.status 和 status_raw 分类。此处不能移动卡片。',planned:'计划',active:'进行',paused:'暂停',done:'完成',emptyLane:'此阶段没有工作。',showAll:'显示全部 {count} 个',source:'来源',recorded:'记录时间',rawStatus:'记录状态',pendingFiles:'待处理索引文件',inProgressFiles:'处理中索引文件',
    assistantTitle:'询问项目状态',assistantSub:'使用本地 Claude 或 Codex 仅解读此仪表板快照。',assistantDisclosureTitle:'本地、可选 AI 助手',assistantDisclosure:'问题和精简上下文会发送给所选本地 CLI。Claude 禁用工具；Codex 在临时只读沙箱中运行。可能消耗账户用量。',assistantUnavailable:'静态文件中 AI 模式已关闭。',assistantUnavailableHint:'启动仅回环地址的服务器以启用本地问答。仪表板不保存凭据。',copyCommand:'复制命令',copied:'已复制',provider:'提供者',questionPlaceholder:'询问需要关注什么，或状态依据在哪里…',send:'询问',asking:'正在查询…',assistantReady:'本地 AI 助手已就绪。',assistantNoProvider:'没有可用的本地 CLI。',assistantFailed:'AI 未能回答。问题已保留。',suggestAttention:'现在需要关注什么？',suggestPaused:'任务为什么暂停？',suggestEvidence:'下一步应查看什么证据？',you:'你',assistant:'AI',
    documentsTitle:'文档',documentsSub:'呈现规格、验证、监督和分析文档。',searchDocuments:'搜索标题和路径',filterByKind:'按文档类型筛选',all:'全部',resultsCount:'{count} 个结果',
    noMatchingDocs:'没有匹配的文档',noMatchingDocsHint:'请尝试其他搜索词或清除筛选条件。',clearFilters:'清除筛选',backToDocuments:'返回全部文档',
    databaseTitle:'数据探索',databaseSub:'先阅读说明，再以只读方式查看 qe.db 行。',chooseTable:'数据集',filterRows:'筛选所选数据集',tablePurpose:'数据集含义',tableUse:'适用场景',guideGeneric:'此 SQLite 表中的框架内部记录。',guideGenericUse:'已知表名或追踪实现细节时',guideTaskLog:'QE 记录的工作历史。',guideTaskLogUse:'查看工作标题、状态、计划或来源时',guideSessions:'执行会话及生命周期时间记录。',guideSessionsUse:'追踪 QE 运行的开始、结束或停滞时',guideFailures:'验证或执行失败记录。',guideFailuresUse:'调查警告或失败结果时',guideFileIndex:'QE 文档及其索引状态。',guideFileIndexUse:'查找待处理或处理中产物时',guideQeFiles:'已索引 QE 文件的标准化表示。',guideQeFilesUse:'查看文档背后的存储表示时',guideWikiPages:'QE Wiki 索引中的页面。',guideWikiPagesUse:'查找可复用项目知识时',guideWikiLinks:'Wiki 页面之间已解析的链接。',guideWikiLinksUse:'查找缺失或断开的知识链接时',guideLifecycle:'协调目标和运行的内部生命周期状态。',guideLifecycleUse:'诊断框架状态转换时',guideProcess:'内部进程控制状态。',guideProcessUse:'诊断并发或所有权时',guideProjection:'可从源记录重建的派生状态。',guideProjectionUse:'调查同步或投影债务时',
    tableMeta:'{table} · 共 {total} 行 · {columns} 列',tableMetaCapped:'{table} · 共 {total} 行，已加载前 {shown} 行 · {columns} 列',emptyTable:'此表为空',emptyTableHint:'请选择其他表查看数据行。',noMatchingRows:'没有符合筛选条件的行',noMatchingRowsHint:'请更改搜索内容或清除筛选条件。',moreRows:'另有 {count} 个匹配行未显示。',
    treeTitle:'.qe 目录树',treeSub:'{files} 个文件 · {indexed} 个已加入存储索引',notIndexed:'未索引',expandFolder:'展开 {name} 文件夹',collapseFolder:'折叠 {name} 文件夹',
    schemaNote:'SQLite · 架构 {version}'
  }
};
const LOCALE_TAG={ko:'ko-KR',en:'en-US',ja:'ja-JP',zh:'zh-CN'};
const root=document.documentElement,app=$('#app'),announcer=$('#announcer');
function storageGet(key){try{return localStorage.getItem(key)}catch{return null}}
function storageSet(key,value){try{localStorage.setItem(key,value)}catch{/* local file privacy mode */}}
function detectLocale(){const saved=storageGet('qe-inspector-locale');if(I18N[saved])return saved;const lang=(navigator.language||'en').toLowerCase();if(lang.startsWith('ko'))return 'ko';if(lang.startsWith('ja'))return 'ja';if(lang.startsWith('zh'))return 'zh';return 'en';}
let locale=detectLocale();
function t(key,vars){let value=(I18N[locale]&&I18N[locale][key])||I18N.en[key]||key;for(const [name,replacement] of Object.entries(vars||{}))value=value.replaceAll('{'+name+'}',String(replacement));return value;}
function number(value){return new Intl.NumberFormat(LOCALE_TAG[locale]).format(value)}
function generatedTime(){return new Intl.DateTimeFormat(LOCALE_TAG[locale],{dateStyle:'medium',timeStyle:'short'}).format(new Date(DATA.generatedAt))}
function announce(message){announcer.textContent='';requestAnimationFrame(()=>{announcer.textContent=message;});}
function applyStaticTranslations(){root.lang=LOCALE_TAG[locale];document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});$('#locale-select').value=locale;$('#locale-select').setAttribute('aria-label',t('language'));$('#nav').setAttribute('aria-label',t('primaryNavigation'));$('#schema-note').textContent=t('schemaNote',{version:DATA.summary.schemaVersion});updateThemeControl();}
const systemDark=()=>matchMedia('(prefers-color-scheme:dark)').matches;
const savedTheme=storageGet('qe-inspector-theme');root.setAttribute('data-theme',savedTheme==='dark'||savedTheme==='light'?savedTheme:(systemDark()?'dark':'light'));
function updateThemeControl(){const dark=root.getAttribute('data-theme')==='dark',button=$('#theme-toggle');button.textContent=(dark?'☀ ':'☾ ')+t(dark?'themeToLight':'themeToDark');button.setAttribute('aria-label',t(dark?'themeToLight':'themeToDark'));button.setAttribute('aria-pressed',String(dark));}
function toggleTheme(){const next=root.getAttribute('data-theme')==='dark'?'light':'dark';root.setAttribute('data-theme',next);storageSet('qe-inspector-theme',next);updateThemeControl();}
$('#theme-toggle').addEventListener('click',toggleTheme);
$('#locale-select').addEventListener('change',event=>{locale=event.target.value;storageSet('qe-inspector-locale',locale);applyStaticTranslations();buildNav();paint();announce(t('language')+': '+event.target.options[event.target.selectedIndex].text);});
app.removeAttribute('data-loading');
// markdown (escape-first, minimal, safe)
function mdEsc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function md(src){
  const lines=src.replace(/\r\n/g,'\n').split('\n'); let out=[],i=0;
  const inline=t=>mdEsc(t)
    .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g,'$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(all,label,href)=>{const safe=/^(https?:|mailto:|#|\/)/i.test(href)?href:'#';return '<a href="'+safe.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';})
    .replace(/\[\[([^\]]+)\]\]/g,'<code>[[$1]]</code>');
  while(i<lines.length){
    let l=lines[i];
    if(/^\`\`\`/.test(l)){let buf=[];i++;while(i<lines.length&&!/^\`\`\`/.test(lines[i]))buf.push(lines[i++]);i++;out.push('<pre><code>'+mdEsc(buf.join('\n'))+'</code></pre>');continue;}
    if(/^\s*$/.test(l)){i++;continue;}
    let h=l.match(/^(#{1,4})\s+(.*)/);if(h){const level=Math.min(h[1].length+1,5);out.push('<h'+level+'>'+inline(h[2])+'</h'+level+'>');i++;continue;}
    if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){out.push('<hr>');i++;continue;}
    if(/^\s*>/.test(l)){let buf=[];while(i<lines.length&&/^\s*>/.test(lines[i]))buf.push(lines[i++].replace(/^\s*>\s?/,''));out.push('<blockquote>'+md(buf.join('\n'))+'</blockquote>');continue;}
    if(/^\s*\|.*\|/.test(l)&&i+1<lines.length&&/^\s*\|?[\s:|-]+\|/.test(lines[i+1])){
      const cell=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const head=cell(l);i+=2;let body=[];while(i<lines.length&&/^\s*\|.*\|/.test(lines[i]))body.push(cell(lines[i++]));
      out.push('<table><thead><tr>'+head.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+body.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');continue;
    }
    if(/^\s*([-*+]|\d+\.)\s+/.test(l)){const ol=/^\s*\d+\./.test(l);let buf=[];while(i<lines.length&&/^\s*([-*+]|\d+\.)\s+/.test(lines[i]))buf.push('<li>'+inline(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/,''))+'</li>');out.push('<'+(ol?'ol':'ul')+'>'+buf.join('')+'</'+(ol?'ol':'ul')+'>');continue;}
    let buf=[l];i++;while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^(#{1,4}\s|\s*[-*+]\s|\s*\d+\.\s|>|\`\`\`|\s*\|)/.test(lines[i]))buf.push(lines[i++]);
    out.push('<p>'+inline(buf.join(' '))+'</p>');
  }
  return out.join('\n');
}
// state
const S=DATA.summary;
const ASSISTANT_MODE=document.querySelector('meta[name="qe-assistant-mode"]')?.content==='interactive';
const ASSISTANT_TOKEN=document.querySelector('meta[name="qe-assistant-token"]')?.content||'';
const views={
  overview:{label:'overviewNav',grp:'',render:overview},
  work:{label:'workNav',grp:'',cnt:DATA.kanban.length,render:work},
  assistant:{label:'assistantNav',grp:'',render:assistantView},
  documents:{label:'documentsNav',grp:'contentGroup',cnt:DATA.docs.length,render:documents},
  database:{label:'databaseNav',grp:'contentGroup',cnt:S.tables,render:database},
  tree:{label:'treeNav',grp:'contentGroup',cnt:S.totalFiles,render:tree},
};
let active=views[location.hash.slice(1)]?location.hash.slice(1):'overview',preferredTable='',selectedTable='';
function buildNav(){
  const nav=$('#nav');nav.innerHTML='';let grp=null;
  for(const [id,v] of Object.entries(views)){
    if(v.grp!==grp){grp=v.grp;if(grp){const group=el('div','grp');group.textContent=t(grp);nav.appendChild(group);}}
    const b=el('button'),label=el('span'),count=el('span','cnt');label.textContent=t(v.label);b.appendChild(label);if(v.cnt!=null){count.textContent=number(v.cnt);b.appendChild(count);}
    b.setAttribute('aria-current',id===active?'page':'false');b.onclick=()=>activateView(id,true);nav.appendChild(b);
  }
}
function activateView(id,focus){active=id;location.hash=id==='overview'?'':id;buildNav();paint();window.scrollTo(0,0);if(focus)$('#main').focus();}
function paint(){const m=$('#main');m.innerHTML='';views[active].render(m);document.title='QE Inspector — '+S.project+' · '+t(views[active].label);}
function head(m,titleKey,subKey,vars){const wrap=el('div','page-head'),copy=el('div','page-head-copy'),h=el('h1','page'),sub=el('p','sub'),stamp=el('div','timestamp');h.textContent=t(titleKey,vars);sub.textContent=t(subKey,vars);stamp.textContent=t('generatedAt',{time:generatedTime()});copy.append(h,sub);wrap.append(copy,stamp);m.appendChild(wrap);}
function tile(key,value,small,cls){const node=el('div','tile '+(cls||'')),label=el('div','k'),amount=el('div','v');label.textContent=t(key);amount.textContent=number(value);if(small){const detail=el('small');detail.textContent=' '+small;amount.appendChild(detail);}node.append(label,amount);return node;}
function emptyState(titleKey,hintKey,onClear){const box=el('div','empty'),title=el('strong'),hint=el('span');title.textContent=t(titleKey);hint.textContent=t(hintKey);box.append(title,hint);if(onClear){const clear=el('button','secondary-action');clear.type='button';clear.textContent=t('clearFilters');clear.onclick=onClear;box.appendChild(clear);}return box;}

function overview(m){
  head(m,'overviewTitle','overviewSub');
  const purpose=el('section','purpose'),main=el('div','purpose-main'),side=el('div','purpose-side'),h=el('h2'),p=el('p'),actions=el('div','purpose-actions'),workButton=el('button','primary-action'),askButton=el('button','secondary-button');
  h.textContent=t('purposeTitle');p.textContent=t('purposeText');workButton.type=askButton.type='button';workButton.textContent=t('openWork');askButton.textContent=t('askAi');workButton.onclick=()=>activateView('work',true);askButton.onclick=()=>activateView('assistant',true);actions.append(workButton,askButton);main.append(h,p,actions);
  const sideTitle=el('strong'),steps=el('ol');sideTitle.textContent=t('purposeSteps');['stepWork','stepExplain','stepEvidence'].forEach(key=>{const li=el('li');li.textContent=t(key);steps.appendChild(li);});side.append(sideTitle,steps);purpose.append(main,side);m.appendChild(purpose);
  const attention=S.failures>0||S.brokenLinks>0,callout=el('section','status-callout'+(attention?' attention':'')),icon=el('span','status-icon'),copy=el('div','status-copy'),title=el('strong'),detail=el('span');
  icon.textContent=attention?'!':'✓';title.textContent=t(attention?'needsReview':'healthy');detail.textContent=attention?t('needsReviewDetail',{failures:number(S.failures),broken:number(S.brokenLinks)}):t('healthyDetail');copy.append(title,detail);callout.append(icon,copy);
  if(attention){const action=el('button','status-action');action.type='button';action.textContent=t('reviewFailures');action.onclick=()=>{preferredTable=DATA.tables.failures?'failures':'';activateView('database',true);};callout.appendChild(action);}m.appendChild(callout);
  const pct=S.totalFiles?Math.round(S.indexedFiles/S.totalFiles*100):0;
  const tiles=el('div','tiles');
  tiles.append(
    tile('filesInQe',S.totalFiles,'','stripe'),tile('indexed',S.indexedFiles,pct+'%','good'),tile('dbTables',S.tables,'','stripe'),
    tile('taskRows',S.tasks,''),tile('specs',S.specs,''),tile('checklists',S.checklists,''),tile('failures',S.failures,'',S.failures?'warn':'good'),tile('wikiPages',S.wikiPages,''),tile('brokenLinks',S.brokenLinks,'',S.brokenLinks?'crit':'good'),
  );
  m.appendChild(tiles);
  const c=el('div','card');const list=el('div','list');
  const rows=[['workNav','workDesc',t('tasksCount',{count:number(DATA.kanban.length)}),'work'],['assistantNav','assistantDesc','Claude · Codex','assistant'],['documentsNav','documentsDesc',t('docsCount',{count:number(DATA.docs.length)}),'documents'],['databaseNav','databaseDesc',t('tablesCount',{count:number(S.tables)}),'database'],['treeNav','treeDesc',t('filesCount',{count:number(S.totalFiles)}),'tree']];
  for(const [titleKey,descKey,count,id] of rows){const item=el('button','item overview-item'),title=el('span','ttl'),desc=el('span','path'),amount=el('span','cnt');item.type='button';title.textContent=t(titleKey);desc.textContent=t(descKey);amount.textContent=count;item.append(title,desc,amount);item.onclick=()=>activateView(id,true);list.appendChild(item);}
  c.appendChild(list);m.appendChild(c);
}

function work(m){
  head(m,'workTitle','workSub');
  const stats=el('div','tiles');stats.append(tile('planned',DATA.workSummary.laneCounts.planned,'','stripe'),tile('active',DATA.workSummary.laneCounts.active,'','stripe'),tile('paused',DATA.workSummary.laneCounts.paused,'',DATA.workSummary.laneCounts.paused?'warn':''),tile('done',DATA.workSummary.laneCounts.done,'','good'),tile('pendingFiles',DATA.workSummary.pendingFiles,''),tile('inProgressFiles',DATA.workSummary.inProgressFiles,''));m.appendChild(stats);
  const note=el('div','board-note'),badge=el('span','evidence'),text=el('span');badge.textContent='task_log';text.textContent=t('boardEvidence');note.append(badge,text);m.appendChild(note);
  const wrap=el('div','kanban-wrap'),board=el('div','kanban');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',t('workTitle'));
  for(const laneName of ['planned','active','paused','done']){
    const lane=el('section','lane'),header=el('div','lane-head'),title=el('h2'),count=el('span','lane-count'),items=DATA.kanban.filter(task=>task.lane===laneName);title.textContent=t(laneName);count.textContent=number(items.length);header.append(title,count);lane.appendChild(header);
    if(!items.length){const empty=el('div','lane-empty');empty.textContent=t('emptyLane');lane.appendChild(empty);}else{
      let shown=Math.min(items.length,10);const renderCards=()=>{lane.querySelectorAll('.task-card,.show-more').forEach(node=>node.remove());for(const task of items.slice(0,shown)){const card=el('details','task-card'),summary=el('summary'),taskTitle=el('span','task-title'),meta=el('span','task-meta'),detail=el('div','task-detail');taskTitle.textContent=task.title;meta.textContent=[task.statusRaw||task.status,task.datedAt].filter(Boolean).join(' · ');summary.append(taskTitle,meta);if(task.body){const body=el('p');body.textContent=task.body;detail.appendChild(body);}if(task.plan){const plan=el('p');plan.textContent=task.plan;detail.appendChild(plan);}for(const [key,value] of [['rawStatus',task.statusRaw||task.status],['recorded',task.datedAt],['source',task.srcPath]])if(value){const row=el('div'),label=el('strong'),code=el('code');label.textContent=t(key)+': ';code.textContent=value;row.append(label,code);detail.appendChild(row);}card.append(summary,detail);lane.appendChild(card);}if(shown<items.length){const more=el('button','secondary-button show-more');more.type='button';more.textContent=t('showAll',{count:number(items.length)});more.onclick=()=>{shown=items.length;renderCards();};lane.appendChild(more);}};renderCards();
    }board.appendChild(lane);
  }
  wrap.appendChild(board);m.appendChild(wrap);
}

function assistantContext(){
  const openTasks=DATA.kanban.filter(task=>task.lane!=='done').slice(0,12).map(({title,lane,statusRaw,datedAt,srcPath})=>({title,lane,statusRaw,datedAt,srcPath}));
  const failures=(DATA.tables.failures?.rows||[]).slice(0,5);
  const tableName=selectedTable&&DATA.tables[selectedTable]?selectedTable:'';
  const selected=tableName?{name:tableName,guide:tableGuide(tableName),rows:DATA.tables[tableName].rows.slice(0,3)}:null;
  return {project:S.project,generatedAt:DATA.generatedAt,summary:{tasks:S.tasks,failures:S.failures,brokenLinks:S.brokenLinks,indexedFiles:S.indexedFiles,totalFiles:S.totalFiles},laneCounts:DATA.workSummary.laneCounts,openTasks,failures,selectedDataset:selected};
}

function assistantView(m){
  head(m,'assistantTitle','assistantSub');
  const shell=el('div','assistant-shell'),disclosure=el('section','assistant-disclosure'),dTitle=el('strong'),dText=el('span');dTitle.textContent=t('assistantDisclosureTitle');dText.textContent=t('assistantDisclosure');disclosure.append(dTitle,dText);shell.appendChild(disclosure);
  if(!ASSISTANT_MODE){const card=el('section','card'),empty=emptyState('assistantUnavailable','assistantUnavailableHint'),command=el('div','static-command'),code=el('code'),copy=el('button','secondary-button');code.textContent='$Qdashboard --assistant';copy.type='button';copy.textContent=t('copyCommand');copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);copy.textContent=t('copied');announce(t('copied'));}catch{copy.textContent=t('copyCommand');}};command.append(code,copy);empty.appendChild(command);card.appendChild(empty);shell.appendChild(card);m.appendChild(shell);return;}
  const status=el('div','assistant-status'),spinner=el('span','spinner'),statusText=el('span');statusText.textContent=t('asking');status.append(spinner,statusText);shell.appendChild(status);
  const chat=el('div','chat');chat.setAttribute('aria-live','polite');shell.appendChild(chat);
  const suggestions=el('div','suggestions'),composer=el('form','composer'),input=el('textarea'),foot=el('div','composer-foot'),provider=el('select','select provider'),send=el('button','primary-action'),error=el('div','assistant-error');input.placeholder=t('questionPlaceholder');input.maxLength=2000;input.setAttribute('aria-label',t('questionPlaceholder'));provider.setAttribute('aria-label',t('provider'));send.type='submit';send.textContent=t('send');for(const [value,label] of [['claude','Claude'],['codex','Codex']]){const option=document.createElement('option');option.value=value;option.textContent=label;provider.appendChild(option);}foot.append(provider,send);composer.append(input,foot,error);shell.append(suggestions,composer);m.appendChild(shell);
  for(const key of ['suggestAttention','suggestPaused','suggestEvidence']){const button=el('button','suggestion');button.type='button';button.textContent=t(key);button.onclick=()=>{input.value=button.textContent;input.focus();};suggestions.appendChild(button);}
  const setBusy=busy=>{input.disabled=provider.disabled=send.disabled=busy;send.textContent=t(busy?'asking':'send');status.innerHTML='';if(busy){status.appendChild(el('span','spinner'));}const label=el('span');label.textContent=t(busy?'asking':'assistantReady');status.appendChild(label);};
  fetch('/api/status',{headers:{'X-QE-Dashboard-Token':ASSISTANT_TOKEN}}).then(async response=>{if(!response.ok)throw new Error((await response.json()).error);return response.json();}).then(info=>{[...provider.options].forEach(option=>{option.disabled=!info.providers[option.value];});const available=[...provider.options].find(option=>!option.disabled);status.innerHTML='';if(available){provider.value=available.value;statusText.textContent=t('assistantReady');status.appendChild(statusText);}else{statusText.textContent=t('assistantNoProvider');status.appendChild(statusText);input.disabled=provider.disabled=send.disabled=true;}}).catch(err=>{status.innerHTML='';statusText.textContent=err.message||t('assistantFailed');status.appendChild(statusText);input.disabled=provider.disabled=send.disabled=true;});
  composer.onsubmit=async event=>{event.preventDefault();const question=input.value.trim();if(!question)return;error.textContent='';const userMessage=el('div','message user');userMessage.textContent=question;chat.appendChild(userMessage);setBusy(true);try{const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json','X-QE-Dashboard-Token':ASSISTANT_TOKEN},body:JSON.stringify({provider:provider.value,question,locale,context:assistantContext()})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||t('assistantFailed'));const answer=el('div','message assistant'),label=el('span','sr-only'),body=el('div','md');label.textContent=t('assistant');body.innerHTML=md(payload.answer);answer.append(label,body);chat.appendChild(answer);input.value='';answer.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(err){error.textContent=(err.message||t('assistantFailed'))+' '+t('assistantFailed');}finally{setBusy(false);input.disabled=false;provider.disabled=false;send.disabled=false;input.focus();}};
}

function documents(m){
  head(m,'documentsTitle','documentsSub');
  const kinds=[...new Set(DATA.docs.map(d=>d.kind))];
  let kf='', q='';
  const wrap=el('div');
  const rowEl=el('div','row'),field=el('label','field grow'),fieldLabel=el('span','field-label');fieldLabel.textContent=t('searchDocuments');
  const search=el('input','search');search.type='search';search.placeholder=t('searchDocuments');search.oninput=e=>{q=e.target.value.toLocaleLowerCase(LOCALE_TAG[locale]);draw();};field.append(fieldLabel,search);
  const chips=el('div','chips');
  chips.setAttribute('role','group');chips.setAttribute('aria-label',t('filterByKind'));const mk=(label,val)=>{const c=el('button','chip');c.type='button';c.textContent=label;c.setAttribute('aria-pressed',String(kf===val));c.onclick=()=>{kf=kf===val?'':val;draw();};return c;};
  chips.appendChild(mk(t('all'),''));kinds.forEach(k=>chips.appendChild(mk(k,k)));rowEl.append(field,chips);wrap.appendChild(rowEl);
  const resultMeta=el('div','results-meta'),holder=el('div');wrap.append(resultMeta,holder);m.appendChild(wrap);
  function draw(){
    [...chips.children].forEach((c,idx)=>{const val=idx===0?'':kinds[idx-1];c.setAttribute('aria-pressed',kf===val);});
    holder.innerHTML='';
    const items=DATA.docs.filter(d=>(!kf||d.kind===kf)&&(!q||(d.title+' '+d.path).toLocaleLowerCase(LOCALE_TAG[locale]).includes(q)));resultMeta.textContent=t('resultsCount',{count:number(items.length)});
    if(!items.length){holder.appendChild(emptyState('noMatchingDocs','noMatchingDocsHint',()=>{q='';kf='';search.value='';draw();search.focus();}));return;}
    const card=el('div','card');const list=el('div','list');
    for(const d of items){const it=el('button','item');it.type='button';
      it.innerHTML='<span class="badge b-'+d.kind+'">'+d.kind+'</span><span class="ttl">'+escape2(d.title)+'</span>'+(d.status?'<span class="st '+d.status+'">'+d.status+'</span>':'')+'<span class="path">'+escape2(d.path)+'</span>';
      it.onclick=()=>reader(d);list.appendChild(it);}
    card.appendChild(list);holder.appendChild(card);
  }
  function reader(d){
    holder.innerHTML='';resultMeta.textContent='';const r=el('article','reader');
    const h=el('div','reader-head'),back=el('button','back'),path=el('span','path'),badge=el('span','badge b-'+d.kind);back.type='button';back.textContent='← '+t('backToDocuments');back.onclick=()=>{draw();search.focus();};path.textContent=d.path;badge.textContent=d.kind;
    h.append(back,path,badge);r.appendChild(h);
    const body=el('div','md');body.innerHTML=md(d.text);r.appendChild(body);holder.appendChild(r);
  }
  draw();
}
function escape2(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function tableGuide(name){
  const exact={task_log:['guideTaskLog','guideTaskLogUse'],sessions:['guideSessions','guideSessionsUse'],failures:['guideFailures','guideFailuresUse'],file_index:['guideFileIndex','guideFileIndexUse'],qe_files:['guideQeFiles','guideQeFilesUse'],wiki_pages:['guideWikiPages','guideWikiPagesUse'],wiki_links:['guideWikiLinks','guideWikiLinksUse']};
  if(exact[name])return {purpose:t(exact[name][0]),use:t(exact[name][1])};
  if(name.startsWith('lifecycle_'))return {purpose:t('guideLifecycle'),use:t('guideLifecycleUse')};
  if(name.startsWith('process_controller_'))return {purpose:t('guideProcess'),use:t('guideProcessUse')};
  if(/projection|debt/.test(name))return {purpose:t('guideProjection'),use:t('guideProjectionUse')};
  return {purpose:t('guideGeneric'),use:t('guideGenericUse')};
}

function database(m){
  head(m,'databaseTitle','databaseSub');
  const names=Object.keys(DATA.tables).sort();
  let active2=preferredTable&&DATA.tables[preferredTable]?preferredTable:(names.find(n=>DATA.tables[n].total>0)||names[0]),q='';preferredTable='';
  const rowEl=el('div','row'),tableField=el('label','field'),tableLabel=el('span','field-label'),select=el('select','select'),searchField=el('label','field grow'),searchLabel=el('span','field-label'),search=el('input','search');
  selectedTable=active2;tableLabel.textContent=t('chooseTable');select.setAttribute('aria-label',t('chooseTable'));for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name+' ('+number(DATA.tables[name].total)+')';select.appendChild(option);}select.value=active2;select.onchange=event=>{active2=event.target.value;selectedTable=active2;q='';search.value='';drawBody();};tableField.append(tableLabel,select);
  searchLabel.textContent=t('filterRows');search.type='search';search.placeholder=t('filterRows');search.oninput=event=>{q=event.target.value.toLocaleLowerCase(LOCALE_TAG[locale]);drawBody();};searchField.append(searchLabel,search);rowEl.append(tableField,searchField);m.appendChild(rowEl);
  const guide=el('section','guide'),guideName=el('div'),guideCopy=el('div','guide-use'),nameLabel=el('div','guide-name'),guideTitle=el('h2'),guidePurpose=el('p'),useLabel=el('strong'),guideUse=el('p');guideTitle.textContent=t('tablePurpose');useLabel.textContent=t('tableUse');guideName.append(nameLabel,guideTitle,guidePurpose);guideCopy.append(useLabel,guideUse);guide.append(guideName,guideCopy);m.appendChild(guide);
  const meta=el('div','tbl-meta');m.appendChild(meta);
  const holder=el('div');m.appendChild(holder);
  function drawBody(){
    const table=DATA.tables[active2],explanation=tableGuide(active2);nameLabel.textContent=active2;guidePurpose.textContent=explanation.purpose;guideUse.textContent=explanation.use;meta.textContent=t(table.shown<table.total?'tableMetaCapped':'tableMeta',{table:active2,total:number(table.total),shown:number(table.shown),columns:number(table.cols.length)});
    holder.innerHTML='';
    if(!table.rows.length){holder.appendChild(emptyState('emptyTable','emptyTableHint'));return;}
    let rows=table.rows;if(q)rows=rows.filter(row=>JSON.stringify(row).toLocaleLowerCase(LOCALE_TAG[locale]).includes(q));
    if(!rows.length){holder.appendChild(emptyState('noMatchingRows','noMatchingRowsHint',()=>{q='';search.value='';drawBody();search.focus();}));announce(t('resultsCount',{count:0}));return;}
    const card=el('div','card');const tw=el('div','tablewrap');tw.tabIndex=0;tw.setAttribute('role','region');tw.setAttribute('aria-label',meta.textContent);
    let html='<table><caption class="sr-only">'+escape2(meta.textContent)+'</caption><thead><tr>'+table.cols.map(column=>'<th scope="col">'+escape2(column)+'</th>').join('')+'</tr></thead><tbody>';
    for(const row of rows.slice(0,400)){html+='<tr>'+table.cols.map(column=>{let value=row[column];value=value==null?'':String(value);const full=value;if(value.length>160)value=value.slice(0,160)+'…';return '<td title="'+escape2(full).replace(/"/g,'&#34;')+'">'+escape2(value)+'</td>';}).join('')+'</tr>';}
    html+='</tbody></table>';tw.innerHTML=html;card.appendChild(tw);holder.appendChild(card);if(rows.length>400){const more=el('div','tbl-meta');more.textContent=t('moreRows',{count:number(rows.length-400)});holder.appendChild(more);}announce(t('resultsCount',{count:number(rows.length)}));
  }
  drawBody();
}

function tree(m){
  head(m,'treeTitle','treeSub',{files:number(S.totalFiles),indexed:number(S.indexedFiles)});
  const card=el('div','card');card.style.padding='10px 12px';const box=el('div','tree');
  function node(n,depth){
    const wrap=el('div','tnode');
    const pct=n.files?Math.round(n.indexed/n.files*100):0;
    const hasChildren=Boolean(n.dirs&&n.dirs.length),row=el(hasChildren?'button':'div','trow');if(hasChildren)row.type='button';
    const open=depth<1;
    row.innerHTML='<span class="caret" style="transform:rotate('+(open?90:0)+'deg)">'+(hasChildren?'▶':'&nbsp;')+'</span>'+
      '<span class="tname"><b>'+escape2(n.name)+'</b>'+(n.skipped?' <span class="skip">('+t('notIndexed')+')</span>':'')+'</span>'+
      '<span class="tw">'+t('filesCount',{count:number(n.files)})+'</span>'+
      (n.skipped?'':'<span class="bar"><i style="width:'+pct+'%"></i></span><span class="pct">'+pct+'%</span>');
    wrap.appendChild(row);
    let kids=null;
    if(hasChildren){
      kids=el('div','tchildren');kids.style.display=open?'block':'none';
      n.dirs.forEach(d=>kids.appendChild(node(d,depth+1)));
      wrap.appendChild(kids);
      row.setAttribute('aria-expanded',String(open));row.setAttribute('aria-label',t(open?'collapseFolder':'expandFolder',{name:n.name}));
      row.onclick=()=>{const visible=kids.style.display!=='none';kids.style.display=visible?'none':'block';row.querySelector('.caret').style.transform='rotate('+(visible?0:90)+'deg)';row.setAttribute('aria-expanded',String(!visible));row.setAttribute('aria-label',t(visible?'expandFolder':'collapseFolder',{name:n.name}));};
    }
    return wrap;
  }
  box.appendChild(node(DATA.tree,0));card.appendChild(box);m.appendChild(card);
}

window.addEventListener('hashchange',()=>{const id=location.hash.slice(1)||'overview';if(views[id]&&id!==active){active=id;buildNav();paint();}});
applyStaticTranslations();buildNav();paint();
`;

// ---- 6. Write ---------------------------------------------------------------
const json = JSON.stringify(DATA).replace(/</g, '\\u003c');
writeFileSync(OUT, renderHtml(json, summary));
console.log(`qe-inspector: wrote ${relative(ROOT, OUT)}  (${tableNames.length} tables, ${docs.length} docs, ${summary.totalFiles} files)`);
