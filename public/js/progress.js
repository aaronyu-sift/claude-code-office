// Task progress of a chat: what the bar and its text say, from the `progress` object the server puts on a main agent (shape and limits: docs/progress.md).
// Pure logic, no DOM and no page imports, so node tests it; progress-bar.js draws it. Everything here accepts a missing or odd object and answers "nothing".

export const SEGMENTS = ['done', 'doing', 'blocked', 'rest'];          // the bar, from the left; `rest` is what has not been started
const PRIO_RANK = { high: 0, med: 1, low: 2, none: 3 };

// English texts, used when no translator is given. The page passes its own `t` (i18n.js); lang/en.js holds the same keys and a test keeps both equal.
export const TEXT_EN = {
  'progress.done': '{done} of {total} done',
  'progress.doing': '{n} doing',
  'progress.blocked': '{n} blocked',
  'progress.aria': 'Progress: {topic}',
  'progress.now': 'Now',
  'progress.next': 'Next',
};
const tEn = (key, p) => (p ? TEXT_EN[key].replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? String(p[k]) : m)) : TEXT_EN[key]);

const whole = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// The four parts of the bar. Fractions add up to 1 whatever the numbers are: when the three counts are more than the total, the total grows to them.
// A chat without a list (no object, total 0) has total 0 and every fraction 0.
export function progressSegments(p) {
  const done = whole(p && p.done), doing = whole(p && p.doing), blocked = whole(p && p.blocked);
  const total = Math.max(whole(p && p.total), done + doing + blocked);
  const n = { done, doing, blocked, rest: total - done - doing - blocked };
  return { total, segments: SEGMENTS.map(kind => ({ kind, n: n[kind], frac: total ? n[kind] / total : 0 })) };
}

// "7 of 12 done · 2 doing · 1 blocked": the parts that are zero are left out; '' when there is no list.
export function progressLabel(p, t = tEn) {
  const { total, segments } = progressSegments(p);
  if (!total) return '';
  const n = k => segments.find(s => s.kind === k).n;
  const parts = [t('progress.done', { done: n('done'), total })];
  if (n('doing')) parts.push(t('progress.doing', { n: n('doing') }));
  if (n('blocked')) parts.push(t('progress.blocked', { n: n('blocked') }));
  return parts.join(' · ');
}

// ids like S2, S10, S1.2, S1.10 in the order a person reads them: runs of digits as numbers
export function compareIds(a, b) {
  const x = String(a == null ? '' : a).split(/(\d+)/), y = String(b == null ? '' : b).split(/(\d+)/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (i % 2) { const d = Number(x[i]) - Number(y[i]); if (d) return d; continue; }          // odd parts are the digit runs
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

// The item to show: the first one being worked on (in list order), else the next one to start: the open item with the highest priority, then the lowest id.
// Returns { item, kind: 'doing' | 'next' } or null (nothing open, or only blocked items).
export function currentItem(p) {
  const items = p && Array.isArray(p.items) ? p.items.filter(it => it && typeof it === 'object') : [];
  const doing = items.find(it => it.status === 'doing');
  if (doing) return { item: doing, kind: 'doing' };
  const todo = items.map((it, i) => ({ it, i })).filter(x => x.it.status === 'todo')
    .sort((a, b) => (PRIO_RANK[a.it.prio] ?? 3) - (PRIO_RANK[b.it.prio] ?? 3) || compareIds(a.it.id, b.it.id) || a.i - b.i)[0];
  return todo ? { item: todo.it, kind: 'next' } : null;
}

// a time the server sends (epoch ms) or an ISO string, as epoch ms; null otherwise
export function toMs(v) {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// How long an item has been running: ms since its `doingSince` at `now`, never negative; null for an item that is not being worked on or has no start.
export function runningMs(item, now) {
  const since = item && item.status === 'doing' ? toMs(item.doingSince) : null;
  return since === null || !Number.isFinite(now) ? null : Math.max(0, now - since);
}
