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

const tables = {};
for (const name of tableNames) {
  const total = db.prepare(`select count(*) c from "${name}"`).get().c;
  const rows = db.prepare(`select * from "${name}" limit ${ROW_CAP}`).all();
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

const DATA = { summary, tables, docs, tree, generatedNote: 'Regenerate: node scripts/qe-inspector.mjs' };

// ---- 5. Emit HTML (write happens at the end, after CSS/JS are defined) -----
function renderHtml(dataJson, s) {
  return `<meta charset="utf-8">
<title>QE Inspector — ${esc(s.project)}</title>
<style>${CSS}</style>
<div id="app" data-loading="1">
  <aside id="side">
    <div class="brand"><span class="dot"></span><div><b>QE Inspector</b><small>${esc(s.project)}${s.qeVersion ? ' · v' + esc(s.qeVersion) : ''}</small></div></div>
    <nav id="nav"></nav>
    <div class="side-foot"><small>SQLite index · schema ${esc(String(s.schemaVersion))}</small><small class="muted">node scripts/qe-inspector.mjs</small></div>
  </aside>
  <main id="main"></main>
</div>
<script>const DATA=${dataJson};${JS}</script>`;
}

function esc(x) {
  return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// CSS ------------------------------------------------------------------------
const CSS = String.raw`
:root{
  --bg:#f5f7fa; --surface:#ffffff; --surface-2:#eef1f6; --ink:#1a1d23; --muted:#5b6472; --faint:#8a93a3;
  --line:#e0e5ec; --accent:#3b6ef0; --accent-weak:#e7edfd;
  --good:#1a9d6b; --warn:#c98a13; --crit:#d6453d; --info:#3b6ef0;
  --radius:9px; --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e1218; --surface:#161b23; --surface-2:#1d2430; --ink:#e6e9ef; --muted:#9aa4b4; --faint:#6b7688;
  --line:#26303d; --accent:#5b8bff; --accent-weak:#18233b; --good:#3ecf8e; --warn:#e0a83a; --crit:#f0665d; --info:#5b8bff;
}}
:root[data-theme="dark"]{
  --bg:#0e1218; --surface:#161b23; --surface-2:#1d2430; --ink:#e6e9ef; --muted:#9aa4b4; --faint:#6b7688;
  --line:#26303d; --accent:#5b8bff; --accent-weak:#18233b; --good:#3ecf8e; --warn:#e0a83a; --crit:#f0665d; --info:#5b8bff;
}
:root[data-theme="light"]{
  --bg:#f5f7fa; --surface:#ffffff; --surface-2:#eef1f6; --ink:#1a1d23; --muted:#5b6472; --faint:#8a93a3;
  --line:#e0e5ec; --accent:#3b6ef0; --accent-weak:#e7edfd; --good:#1a9d6b; --warn:#c98a13; --crit:#d6453d; --info:#3b6ef0;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
#app{display:grid;grid-template-columns:250px 1fr;min-height:100vh}
#side{background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{display:flex;gap:10px;align-items:center;padding:18px 18px 14px}
.brand b{font-size:15px;letter-spacing:-.01em;display:block}
.brand small{color:var(--muted);font-size:11.5px}
.dot{width:11px;height:11px;border-radius:3px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-weak);flex:none}
#nav{display:flex;flex-direction:column;gap:2px;padding:8px 10px;flex:1;overflow:auto}
#nav button{all:unset;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 11px;border-radius:7px;color:var(--muted);cursor:pointer;font-weight:530;font-size:13.5px}
#nav button:hover{background:var(--surface-2);color:var(--ink)}
#nav button[aria-current="true"]{background:var(--accent-weak);color:var(--accent)}
#nav .grp{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);padding:14px 11px 5px;font-weight:640}
#nav .cnt{font-family:var(--mono);font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}
.side-foot{padding:12px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:3px}
.side-foot small{font-size:11px;color:var(--muted);font-family:var(--mono)}
.side-foot .muted{color:var(--faint)}
#main{padding:26px 30px 60px;max-width:1100px;overflow:hidden}
h1.page{font-size:21px;letter-spacing:-.02em;margin:0 0 3px;text-wrap:balance}
.sub{color:var(--muted);margin:0 0 22px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:26px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 15px}
.tile .k{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.tile .v{font-size:26px;font-weight:680;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:5px}
.tile .v small{font-size:13px;color:var(--faint);font-weight:500}
.tile.stripe{border-left:3px solid var(--accent)}
.tile.good{border-left:3px solid var(--good)} .tile.warn{border-left:3px solid var(--warn)} .tile.crit{border-left:3px solid var(--crit)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.search{flex:1;min-width:180px;background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:8px 11px;color:var(--ink);font-family:var(--sans);font-size:13px}
.search:focus{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{all:unset;cursor:pointer;padding:5px 10px;border-radius:20px;font-size:12px;font-weight:560;color:var(--muted);background:var(--surface);border:1px solid var(--line)}
.chip[aria-pressed="true"]{background:var(--accent);color:#fff;border-color:var(--accent)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.list{display:flex;flex-direction:column}
.item{all:unset;display:flex;gap:12px;align-items:baseline;padding:11px 15px;border-bottom:1px solid var(--line);cursor:pointer}
.item:last-child{border-bottom:0}
.item:hover{background:var(--surface-2)}
.item .ttl{font-weight:560;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .path{font-family:var(--mono);font-size:11px;color:var(--faint)}
.badge{font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:5px;text-transform:uppercase;letter-spacing:.03em;font-family:var(--mono)}
.b-task{background:var(--accent-weak);color:var(--accent)} .b-checklist{background:#efe7fd;color:#7a3ed6}
.b-analysis{background:#e7f6ef;color:var(--good)} .b-supervise{background:#fdeede;color:var(--warn)}
.b-contract{background:#e6f2fb;color:#2b7fc4} .b-handoff{background:var(--surface-2);color:var(--muted)} .b-plan{background:var(--surface-2);color:var(--muted)}
:root[data-theme="dark"] .b-checklist{background:#2a2140;color:#c4a5ff} :root[data-theme="dark"] .b-analysis{background:#123026}
:root[data-theme="dark"] .b-supervise{background:#332612} :root[data-theme="dark"] .b-contract{background:#12293b}
@media (prefers-color-scheme:dark){.b-checklist{background:#2a2140;color:#c4a5ff}.b-analysis{background:#123026}.b-supervise{background:#332612}.b-contract{background:#12293b}}
.st{font-size:11px;font-weight:600;font-family:var(--mono);padding:2px 6px;border-radius:5px;background:var(--surface-2);color:var(--muted)}
.st.completed,.st.done{color:var(--good)} .st.pending{color:var(--warn)} .st.in-progress{color:var(--accent)}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--surface-2);color:var(--muted);font-weight:620;font-size:11px;text-transform:uppercase;letter-spacing:.04em;z-index:1}
td{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink)}
tr:hover td{background:var(--surface-2)}
.tbl-meta{color:var(--muted);font-size:12px;margin:2px 0 14px;font-family:var(--mono)}
.reader{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:8px 4px}
.reader-head{display:flex;gap:10px;align-items:center;padding:8px 16px 12px;border-bottom:1px solid var(--line);margin-bottom:8px}
.reader-head .path{font-family:var(--mono);font-size:11.5px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis}
.back{all:unset;cursor:pointer;color:var(--accent);font-weight:560;font-size:13px}
.md{padding:4px 20px 22px;max-width:74ch}
.md h1,.md h2,.md h3{letter-spacing:-.015em;line-height:1.25;margin:1.4em 0 .5em;text-wrap:balance}
.md h1{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:.3em} .md h2{font-size:17px} .md h3{font-size:14.5px;color:var(--muted);text-transform:none}
.md p{margin:.6em 0} .md ul,.md ol{margin:.5em 0;padding-left:1.4em} .md li{margin:.2em 0}
.md code{font-family:var(--mono);font-size:.86em;background:var(--surface-2);padding:1.5px 5px;border-radius:4px}
.md pre{background:var(--surface-2);padding:12px 14px;border-radius:8px;overflow-x:auto} .md pre code{background:none;padding:0}
.md blockquote{border-left:3px solid var(--accent);margin:.7em 0;padding:.1em 0 .1em 14px;color:var(--muted)}
.md table{margin:.8em 0} .md th,.md td{white-space:normal;font-family:var(--sans)} .md td{font-family:var(--sans)}
.md a{color:var(--accent)} .md hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
.tree{font-family:var(--mono);font-size:12.5px}
.tnode{padding:2px 0}
.trow{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer}
.trow:hover{background:var(--surface-2)}
.tname{flex:1} .tname b{font-family:var(--sans);font-weight:600}
.tw{color:var(--faint)} .caret{width:12px;display:inline-block;color:var(--faint);transition:transform .12s}
.tchildren{margin-left:16px;border-left:1px solid var(--line);padding-left:6px}
.bar{height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden;width:70px;flex:none}
.bar>i{display:block;height:100%;background:var(--good)}
.pct{color:var(--muted);font-size:11px;width:34px;text-align:right;font-variant-numeric:tabular-nums}
.skip{color:var(--faint);font-style:italic}
.themetgl{all:unset;cursor:pointer;color:var(--muted);font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:7px}
.themetgl:hover{color:var(--ink);border-color:var(--accent)}
.empty{color:var(--muted);padding:30px;text-align:center}
@media(max-width:720px){#app{grid-template-columns:1fr}#side{position:static;height:auto;flex-direction:row;flex-wrap:wrap}#nav{flex-direction:row;flex-wrap:wrap}}
`;

// JS -------------------------------------------------------------------------
const JS = String.raw`
const $=(s,r=document)=>r.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const app=$('#app'); app.removeAttribute('data-loading');
// theme
const root=document.documentElement;
function toggleTheme(){const cur=root.getAttribute('data-theme')|| (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');root.setAttribute('data-theme',cur==='dark'?'light':'dark');}
// markdown (escape-first, minimal, safe)
function mdEsc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function md(src){
  const lines=src.replace(/\r\n/g,'\n').split('\n'); let out=[],i=0;
  const inline=t=>mdEsc(t)
    .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g,'$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[\[([^\]]+)\]\]/g,'<code>[[$1]]</code>');
  while(i<lines.length){
    let l=lines[i];
    if(/^\`\`\`/.test(l)){let buf=[];i++;while(i<lines.length&&!/^\`\`\`/.test(lines[i]))buf.push(lines[i++]);i++;out.push('<pre><code>'+mdEsc(buf.join('\n'))+'</code></pre>');continue;}
    if(/^\s*$/.test(l)){i++;continue;}
    let h=l.match(/^(#{1,4})\s+(.*)/);if(h){out.push('<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>');i++;continue;}
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
const views={
  overview:{label:'Overview',grp:'',render:overview},
  documents:{label:'Documents',grp:'Content',cnt:DATA.docs.length,render:documents},
  database:{label:'Database',grp:'Content',cnt:S.tables,render:database},
  tree:{label:'.qe Tree',grp:'Content',cnt:S.totalFiles,render:tree},
};
let active='overview';
function buildNav(){
  const nav=$('#nav');nav.innerHTML='';let grp=null;
  for(const [id,v] of Object.entries(views)){
    if(v.grp!==grp){grp=v.grp;if(grp)nav.appendChild(el('div','grp',grp));}
    const b=el('button');b.innerHTML='<span>'+v.label+'</span>'+(v.cnt!=null?'<span class="cnt">'+v.cnt+'</span>':'');
    b.setAttribute('aria-current',id===active);b.onclick=()=>{active=id;buildNav();paint();};nav.appendChild(b);
  }
}
function paint(){const m=$('#main');m.innerHTML='';views[active].render(m);m.scrollTop=0;window.scrollTo(0,0);}
function head(m,title,sub){m.appendChild(el('h1','page',title));if(sub){const p=el('p','sub');p.textContent=sub;m.appendChild(p);}
  const tgl=el('button','themetgl','◐ theme');tgl.onclick=toggleTheme;tgl.style.cssFloat='right';tgl.style.marginTop='-40px';m.appendChild(tgl);}

function tile(k,v,small,cls){const t=el('div','tile '+(cls||''));t.innerHTML='<div class="k">'+k+'</div><div class="v">'+v+(small?' <small>'+small+'</small>':'')+'</div>';return t;}

function overview(m){
  head(m,'QE state overview',DATA.generatedNote);
  const pct=S.totalFiles?Math.round(S.indexedFiles/S.totalFiles*100):0;
  const t=el('div','tiles');
  t.append(
    tile('Files in .qe',S.totalFiles.toLocaleString(),'','stripe'),
    tile('Indexed',S.indexedFiles.toLocaleString(),pct+'%','good'),
    tile('DB tables',S.tables,'','stripe'),
    tile('Task log rows',S.tasks,''),
    tile('Specs',S.specs,''),
    tile('Checklists',S.checklists,''),
    tile('Failures',S.failures,'',S.failures?'warn':''),
    tile('Wiki pages',S.wikiPages,''),
    tile('Broken links',S.brokenLinks,'',S.brokenLinks?'crit':'good'),
  );
  m.appendChild(t);
  const c=el('div','card');const list=el('div','list');
  const rows=[['Documents','Rendered Spec / Verify / Supervise / Analysis',DATA.docs.length+' docs','documents'],
    ['Database','Browse every table in qe.db',S.tables+' tables','database'],
    ['.qe Tree','Folder tree · what is indexed',S.totalFiles+' files','tree']];
  for(const [ttl,desc,cnt,id] of rows){const it=el('button','item');it.innerHTML='<span class="ttl">'+ttl+'</span><span class="path">'+desc+'</span><span class="cnt">'+cnt+'</span>';it.onclick=()=>{active=id;buildNav();paint();};list.appendChild(it);}
  c.appendChild(list);m.appendChild(c);
}

function documents(m){
  head(m,'Documents',DATA.docs.length+' rendered · Spec, Verify, Supervise, Analysis');
  const kinds=[...new Set(DATA.docs.map(d=>d.kind))];
  let kf='', q='';
  const wrap=el('div');
  const rowEl=el('div','row');
  const search=el('input','search');search.placeholder='Search title or path…';search.oninput=e=>{q=e.target.value.toLowerCase();draw();};
  const chips=el('div','chips');
  const mk=(lbl,val)=>{const c=el('button','chip');c.textContent=lbl;c.setAttribute('aria-pressed',kf===val);c.onclick=()=>{kf=kf===val?'':val;draw();};return c;};
  chips.appendChild(mk('all',''));kinds.forEach(k=>chips.appendChild(mk(k,k)));
  rowEl.append(search,chips);wrap.appendChild(rowEl);
  const holder=el('div');wrap.appendChild(holder);m.appendChild(wrap);
  function draw(){
    [...chips.children].forEach((c,idx)=>{const val=idx===0?'':kinds[idx-1];c.setAttribute('aria-pressed',kf===val);});
    holder.innerHTML='';
    const items=DATA.docs.filter(d=>(!kf||d.kind===kf)&&(!q||(d.title+d.path).toLowerCase().includes(q)));
    if(!items.length){holder.appendChild(el('div','empty','No matching documents.'));return;}
    const card=el('div','card');const list=el('div','list');
    for(const d of items){const it=el('button','item');
      it.innerHTML='<span class="badge b-'+d.kind+'">'+d.kind+'</span><span class="ttl">'+escape2(d.title)+'</span>'+(d.status?'<span class="st '+d.status+'">'+d.status+'</span>':'')+'<span class="path">'+escape2(d.path)+'</span>';
      it.onclick=()=>reader(d);list.appendChild(it);}
    card.appendChild(list);holder.appendChild(card);
  }
  function reader(d){
    holder.innerHTML='';const r=el('div','reader');
    const h=el('div','reader-head');const back=el('button','back','← all documents');back.onclick=draw;
    h.append(back,el('span','path',escape2(d.path)),el('span','badge b-'+d.kind,d.kind));r.appendChild(h);
    const body=el('div','md');body.innerHTML=md(d.text);r.appendChild(body);holder.appendChild(r);
  }
  draw();
}
function escape2(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function database(m){
  head(m,'Database',S.tables+' tables in qe.db · read-only');
  const names=Object.keys(DATA.tables).sort();
  let active2=names.find(n=>DATA.tables[n].total>0)||names[0], q='';
  const chips=el('div','chips');chips.style.marginBottom='14px';
  names.forEach(n=>{const c=el('button','chip');c.innerHTML=n+' <span style="opacity:.6">'+DATA.tables[n].total+'</span>';c.onclick=()=>{active2=n;q='';draw();};chips.appendChild(c);});
  m.appendChild(chips);
  const rowEl=el('div','row');const search=el('input','search');search.placeholder='Filter rows…';search.oninput=e=>{q=e.target.value.toLowerCase();drawBody();};rowEl.appendChild(search);m.appendChild(rowEl);
  const meta=el('div','tbl-meta');m.appendChild(meta);
  const holder=el('div');m.appendChild(holder);
  function draw(){[...chips.children].forEach((c,idx)=>c.setAttribute('aria-pressed',names[idx]===active2));search.value='';drawBody();}
  function drawBody(){
    const t=DATA.tables[active2];meta.textContent=active2+' — '+t.total+' rows'+(t.shown<t.total?' (showing first '+t.shown+')':'')+' · '+t.cols.length+' cols';
    holder.innerHTML='';
    if(!t.rows.length){holder.appendChild(el('div','empty','Empty table.'));return;}
    let rows=t.rows;if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
    const card=el('div','card');const tw=el('div','tablewrap');
    let html='<table><thead><tr>'+t.cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>';
    for(const r of rows.slice(0,400)){html+='<tr>'+t.cols.map(c=>{let v=r[c];v=v==null?'':String(v);const full=v;if(v.length>160)v=v.slice(0,160)+'…';return '<td title="'+escape2(full).replace(/"/g,'&#34;')+'">'+escape2(v)+'</td>';}).join('')+'</tr>';}
    html+='</tbody></table>';tw.innerHTML=html;card.appendChild(tw);holder.appendChild(card);
    if(rows.length>400)holder.appendChild(el('div','tbl-meta','… '+(rows.length-400)+' more filtered rows not shown'));
  }
  draw();
}

function tree(m){
  head(m,'.qe tree',S.totalFiles.toLocaleString()+' files · '+S.indexedFiles.toLocaleString()+' indexed into the store');
  const card=el('div','card');card.style.padding='10px 12px';const box=el('div','tree');
  function node(n,depth){
    const wrap=el('div','tnode');
    const pct=n.files?Math.round(n.indexed/n.files*100):0;
    const row=el('div','trow');
    const open=depth<1;
    row.innerHTML='<span class="caret" style="transform:rotate('+(open?90:0)+'deg)">'+(n.dirs&&n.dirs.length?'▶':'&nbsp;')+'</span>'+
      '<span class="tname"><b>'+escape2(n.name)+'</b>'+(n.skipped?' <span class="skip">(not indexed)</span>':'')+'</span>'+
      '<span class="tw">'+n.files+' files</span>'+
      (n.skipped?'':'<span class="bar"><i style="width:'+pct+'%"></i></span><span class="pct">'+pct+'%</span>');
    wrap.appendChild(row);
    let kids=null;
    if(n.dirs&&n.dirs.length){
      kids=el('div','tchildren');kids.style.display=open?'block':'none';
      n.dirs.forEach(d=>kids.appendChild(node(d,depth+1)));
      wrap.appendChild(kids);
      row.style.cursor='pointer';
      row.onclick=()=>{const vis=kids.style.display!=='none';kids.style.display=vis?'none':'block';row.querySelector('.caret').style.transform='rotate('+(vis?0:90)+'deg)';};
    }
    return wrap;
  }
  box.appendChild(node(DATA.tree,0));card.appendChild(box);m.appendChild(card);
}

buildNav();paint();
`;

// ---- 6. Write ---------------------------------------------------------------
const json = JSON.stringify(DATA).replace(/</g, '\\u003c');
writeFileSync(OUT, renderHtml(json, summary));
console.log(`qe-inspector: wrote ${relative(ROOT, OUT)}  (${tableNames.length} tables, ${docs.length} docs, ${summary.totalFiles} files)`);
