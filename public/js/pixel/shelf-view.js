// The shelf lane of the Office view: a column beside the scene (never over it) with one row per chat that has no room (shelf.js decides which):
// a small sleeping or leaning pixel figure, the full chat name, the project and "closed 12m ago". It scrolls on its own, a click opens the details
// panel, and it can be folded away (a tab at the edge of the scene brings it back). Rows are kept by id, so a refresh keeps the scroll position
// and the focus; the times are refreshed every 20 s while the view is on screen, and nothing runs otherwise.
import { workerId, APPEARANCES } from './ids.js';
import { hashStr } from './layout.js';
import { poseOf } from './shelf.js';

const KEY = 'ajan-ofisi.shelf';          // 'open' or 'closed': the visitor's last choice (without one, the lane starts folded in a window narrower than NARROW)
const REFRESH_MS = 20e3;
const NARROW = 760;

export function createShelfView({ root, area, msg, fmtShort, now, open, storage = null }) {
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const pref = () => { try { return storage && storage.getItem(KEY); } catch { return null; } };
  let collapsed = pref() ? pref() === 'closed' : window.innerWidth < NARROW;         // the window, as the media query below: the view itself can be hidden (width 0) while it is built
  let atlas = null, atlasSeq = 0, entries = [], visible = false, timer = 0;
  const rows = new Map();                                    // id -> { li, fig, name, meta, when, sw, figKey }

  const count = el('span', { className: 'sh-count' });
  const list = el('ol', { className: 'sh-list' });
  const hideBtn = el('button', { type: 'button', className: 'sh-hide', textContent: '›', onclick: () => setCollapsed(true) });
  const host = el('aside', { className: 'of-shelf', hidden: true }, el('header', { className: 'sh-head' }, el('h3', { className: 'sh-title' }), count, hideBtn), list);
  const tab = el('button', { type: 'button', className: 'of-shelf-tab', hidden: true, onclick: () => setCollapsed(false) });
  root.append(host);
  area.append(tab);

  function setCollapsed(on) {
    collapsed = on;
    try { if (storage) storage.setItem(KEY, on ? 'closed' : 'open'); } catch { /* storage disabled */ }
    paint();
  }
  const countText = n => msg('shelf.count', { n });
  const whenText = e => msg(e.kind === 'closed' ? 'shelf.closed' : 'shelf.idle', { t: fmtShort(Math.max(0, now() - e.at)) });

  function paint() {
    const n = entries.length;
    host.hidden = !n || collapsed;
    tab.hidden = !n || !collapsed;
    root.dataset.shelf = !n ? 'none' : collapsed ? 'collapsed' : 'open';
    host.querySelector('.sh-title').textContent = msg('shelf.title');
    count.textContent = countText(n);
    hideBtn.title = msg('shelf.hide');
    hideBtn.setAttribute('aria-label', msg('shelf.hide'));
    host.setAttribute('aria-label', msg('shelf.title'));
    tab.textContent = `${msg('shelf.show')} · ${n}`;
    tab.title = msg('shelf.showTip');
  }

  function drawFigure(row, e) {
    if (!atlas) return;
    const id = workerId(hashStr(e.id) % APPEARANCES, poseOf(e)), key = id + '#' + atlasSeq;
    if (row.figKey === key) return;
    const s = atlas.sprite(id, 0);
    if (!s) return;
    const [, , w, h] = s.rect, c = row.fig;
    c.width = w; c.height = h;                                // native size: one sprite pixel is one CSS pixel (two device pixels on a sharp screen)
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    atlas.draw(g, id, 0, s.px, s.py);
    row.figKey = key;
  }

  function makeRow(e) {
    const fig = el('canvas', { className: 'sh-fig' });
    const name = el('span', { className: 'sh-name' }), sw = el('i', { className: 'sh-sw' }), proj = el('span', { className: 'sh-proj' }), when = el('span', { className: 'sh-when' });
    const btn = el('button', { type: 'button', className: 'sh-item', onclick: () => open(e.id) }, fig, el('span', { className: 'sh-txt' }, name, el('span', { className: 'sh-meta' }, sw, proj, when)));
    const li = el('li', {}, btn);
    const row = { li, btn, fig, name, proj, when, sw, figKey: '' };
    rows.set(e.id, row);
    return row;
  }

  function update(next) {
    entries = next;
    const ids = new Set(next.map(e => e.id));
    for (const [id, row] of [...rows]) if (!ids.has(id)) { row.li.remove(); rows.delete(id); }
    next.forEach((e, i) => {
      const row = rows.get(e.id) || makeRow(e);
      row.li.dataset.id = e.id; row.li.dataset.kind = e.kind;
      row.btn.onclick = () => open(e.id);
      if (row.name.textContent !== e.name) row.name.textContent = e.name;
      if (row.proj.textContent !== e.project) row.proj.textContent = e.project;
      row.sw.style.background = e.color || '#7d8597';
      const w = whenText(e);
      if (row.when.textContent !== w) row.when.textContent = w;
      row.btn.title = [e.name, e.title && e.title !== e.name ? e.title : '', e.project].filter(Boolean).join('\n');
      row.btn.setAttribute('aria-label', msg('shelf.open', { name: e.name }));
      drawFigure(row, e);
      const here = list.children[i];
      if (here !== row.li) list.insertBefore(row.li, here || null);              // only a row that is out of place moves
    });
    paint();
  }

  function refreshTimes() {
    for (const e of entries) { const row = rows.get(e.id); if (row) { const w = whenText(e); if (row.when.textContent !== w) row.when.textContent = w; } }
  }
  function arm() {
    clearInterval(timer);
    timer = 0;
    if (visible && entries.length) timer = setInterval(() => { if (!document.hidden) refreshTimes(); }, REFRESH_MS);
  }

  return {
    update(next) { update(next); arm(); },
    setAtlas(a) { atlas = a; atlasSeq++; for (const e of entries) { const row = rows.get(e.id); if (row) drawFigure(row, e); } },
    setVisible(on) { visible = on; if (on) refreshTimes(); arm(); },
    get collapsed() { return collapsed; },
    setCollapsed,
    // QA: what the lane shows (read-only)
    read() {
      const r = host.getBoundingClientRect(), lr = list.getBoundingClientRect();
      return {
        mode: root.dataset.shelf, hidden: host.hidden, tabHidden: tab.hidden, tab: tab.textContent, title: host.querySelector('.sh-title').textContent, count: count.textContent,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height }, listRect: { x: lr.left, y: lr.top, w: lr.width, h: lr.height },
        scroll: { top: list.scrollTop, height: list.scrollHeight, client: list.clientHeight, overflowY: getComputedStyle(list).overflowY },
        rows: [...list.children].map(li => {
          const b = li.firstElementChild, f = li.querySelector('canvas'), nm = li.querySelector('.sh-name'), rr = b.getBoundingClientRect();
          let ink = 0;
          if (f && f.width > 1) { const d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) ink++; }
          return { id: li.dataset.id, kind: li.dataset.kind, name: nm.textContent, project: li.querySelector('.sh-proj').textContent, when: li.querySelector('.sh-when').textContent,
            figure: f ? { w: f.width, h: f.height, ink } : null, rect: { x: rr.left, y: rr.top, w: rr.width, h: rr.height }, label: b.getAttribute('aria-label') };
        }),
      };
    },
    destroy() { clearInterval(timer); host.remove(); tab.remove(); },
  };
}
