// The progress bar of a chat's task list as a DOM element: the bar (done, doing, blocked, not started), a line of text under it and the item being
// worked on (or the next one to start) with how long it has been running. The numbers and texts come from progress.js; the colours and sizes from
// the `.cco-prog` rules in app.css (the colours of the glass cards). Every string of the data goes in with textContent, never as markup.
//
//   const bar = progressBarEl(agent.progress, { now: store.now() });      // null when the chat has no list: nothing to show
//   if (bar) card.append(bar);        // or bar.outerHTML where a card is built from a string; the running time carries data-since, which the page ticker keeps current
//
// options: now (ms, the page's clock: store.now()), text (false: only the bar, for a small label; its aria-valuetext still says everything)
import { t as msg } from './i18n.js';
import { fmtShort } from './util.js';
import { progressSegments, progressLabel, currentItem, runningMs, toMs } from './progress.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function progressBarEl(progress, { now = Date.now(), text = true } = {}) {
  const { total, segments } = progressSegments(progress);
  if (!total) return null;
  const label = progressLabel(progress, msg);
  const root = el('div', 'cco-prog');
  const track = el('div', 'cco-prog-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(total));
  track.setAttribute('aria-valuenow', String(segments[0].n));
  track.setAttribute('aria-valuetext', label);
  track.setAttribute('aria-label', msg('progress.aria', { topic: String(progress.topic || '').trim() || label }));
  for (const s of segments) {
    if (!s.n) continue;
    const seg = el('i', 'cco-prog-seg ' + s.kind);
    seg.style.width = (s.frac * 100).toFixed(2) + '%';
    seg.dataset.n = String(s.n);
    track.append(seg);
  }
  root.append(track);
  if (!text) return root;
  const line = el('div', 'cco-prog-text', label);
  line.setAttribute('aria-hidden', 'true');                                  // the bar's aria-valuetext says the same
  root.append(line);
  const cur = currentItem(progress);
  if (cur) {
    const { item, kind } = cur;
    const row = el('div', 'cco-prog-now');
    row.dataset.kind = kind;
    row.append(el('span', 'k', msg(kind === 'doing' ? 'progress.now' : 'progress.next')), ' ');          // (the spaces only matter to copy and paste and to a screen reader)
    if (item.id) row.append(el('b', 'id', item.id), ' ');
    const title = el('span', 't', item.title || '');
    if (item.title) title.title = item.title;
    row.append(title);
    const ran = runningMs(item, now);
    if (ran !== null) {
      const clock = el('span', 'el', fmtShort(ran));
      clock.dataset.since = String(toMs(item.doingSince));
      clock.dataset.fmt = 'short';
      row.append(' ', clock);
    }
    root.append(row);
  }
  return root;
}
