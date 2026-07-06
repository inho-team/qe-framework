// learnings.mjs — cross-session learning memory engine (Qlearn / Phase 6).
//
// Learnings are a superset of mistakes: type = mistake | convention | gotcha |
// decision, each with a severity and a time-decayed relevance score so the
// session-start injection can surface the most relevant top-N rather than an
// ever-growing flat list. Pure functions take `now` (ms) so ranking/decay is
// deterministic and testable. The Qmistake registry (.qe/MISTAKE.md) is left
// untouched and coexists.

const DAY_MS = 86_400_000;
export const HALF_LIFE_DAYS = 30; // relevance halves every 30 days without reinforcement
const SEVERITY_WEIGHT = { critical: 3, important: 2, info: 1 };
export const VALID_TYPES = ['mistake', 'convention', 'gotcha', 'decision'];
export const VALID_SEVERITIES = ['critical', 'important', 'info'];

export const LEARNINGS_HEADER = [
  '# Learning Registry',
  '',
  '> Cross-session learnings (mistakes, conventions, gotchas, decisions).',
  '> Ranked by time-decayed relevance and injected top-N at session start.',
  '> Managed by /Qlearn. Do not hand-edit ids.',
  '',
  '---',
  '',
].join('\n');

function fieldFrom(block, label) {
  const m = block.match(new RegExp(`^-\\s*\\*\\*${label}\\*\\*:\\s*(.+)$`, 'im'));
  return m ? m[1].trim() : null;
}

function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Parse a learnings.md document into structured entries.
export function parseLearnings(content) {
  if (!content) return [];
  const parts = content.split(/^### /m).slice(1); // drop preamble before first entry
  const entries = [];
  for (const raw of parts) {
    const block = `### ${raw}`;
    const head = raw.split('\n', 1)[0];
    const idMatch = head.match(/^([A-Za-z]+\d+):\s*(.*)$/);
    const id = idMatch ? idMatch[1] : head.trim();
    const title = idMatch ? idMatch[2].trim() : '';
    const resolved = /\[RESOLVED\]/i.test(head);
    const type = (fieldFrom(block, 'Type') || 'mistake').toLowerCase();
    const severity = (fieldFrom(block, 'Severity') || 'info').toLowerCase();
    entries.push({
      id,
      title,
      type: VALID_TYPES.includes(type) ? type : 'mistake',
      severity: VALID_SEVERITIES.includes(severity) ? severity : 'info',
      date: parseDate(fieldFrom(block, 'Date')),
      reinforced: parseDate(fieldFrom(block, 'Reinforced')),
      learning: fieldFrom(block, 'Learning') || title,
      context: fieldFrom(block, 'Context'),
      resolved,
    });
  }
  return entries;
}

// Time-decayed relevance score for one entry. Resolved entries score 0.
export function decayScore(entry, now = Date.now()) {
  if (!entry || entry.resolved) return 0;
  const anchor = Math.max(entry.reinforced || 0, entry.date || 0);
  const ageDays = anchor ? Math.max(0, (now - anchor) / DAY_MS) : HALF_LIFE_DAYS; // undated = half-relevant
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const weight = SEVERITY_WEIGHT[entry.severity] || 1;
  return weight * decay;
}

// Return the top-N active learnings ranked by decayed relevance (desc).
export function topLearnings(content, n = 5, now = Date.now()) {
  return parseLearnings(content)
    .filter((e) => !e.resolved)
    .map((e) => ({ entry: e, score: decayScore(e, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, n))
    .map(({ entry, score }) => ({ ...entry, score }));
}

function nextId(entries) {
  const nums = entries.map((e) => Number(String(e.id).replace(/\D/g, ''))).filter(Number.isFinite);
  const max = nums.length ? Math.max(...nums) : 0;
  return `L${String(max + 1).padStart(3, '0')}`;
}

function isoDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

// Append a new learning entry, creating the header if the document is empty.
export function addLearning(content, { type = 'mistake', severity = 'important', title = '', learning = '', context = '' }, now = Date.now()) {
  const base = content && content.trim() ? content.replace(/\s*$/, '\n') : LEARNINGS_HEADER;
  const entries = parseLearnings(base);
  const id = nextId(entries);
  const safeType = VALID_TYPES.includes(type) ? type : 'mistake';
  const safeSeverity = VALID_SEVERITIES.includes(severity) ? severity : 'info';
  const entry = [
    `### ${id}: ${title || '(untitled)'}`,
    `- **Type**: ${safeType}`,
    `- **Severity**: ${safeSeverity}`,
    `- **Date**: ${isoDate(now)}`,
    `- **Learning**: ${learning || title}`,
    ...(context ? [`- **Context**: ${context}`] : []),
    '',
    '---',
    '',
  ].join('\n');
  return { id, content: `${base}\n${entry}` };
}

// Identify prunable entries (resolved, or decayed below `threshold`). Dry-run by
// default: returns the surviving document plus the removed entries without side
// effects until the caller opts to apply it.
export function pruneLearnings(content, { now = Date.now(), threshold = 0.1 } = {}) {
  const entries = parseLearnings(content);
  const removed = entries.filter((e) => e.resolved || decayScore(e, now) < threshold);
  const kept = entries.filter((e) => !removed.includes(e));
  const removedIds = new Set(removed.map((e) => e.id));
  // Rebuild the document keeping the header and surviving blocks in order.
  const headerEnd = content.indexOf('\n### ');
  const header = headerEnd >= 0 ? content.slice(0, headerEnd + 1) : LEARNINGS_HEADER;
  const blocks = content.split(/^### /m).slice(1)
    .map((raw) => ({ id: (raw.match(/^([A-Za-z]+\d+):/) || [])[1], text: `### ${raw}` }))
    .filter((b) => b.id && !removedIds.has(b.id))
    .map((b) => b.text.replace(/\s*$/, '\n'));
  const rebuilt = `${header.replace(/\s*$/, '\n')}\n${blocks.join('\n')}`;
  return { kept, removed, content: rebuilt };
}
