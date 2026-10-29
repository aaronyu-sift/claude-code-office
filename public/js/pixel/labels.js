// Text labels of the pixel scene: crisp DOM text over the canvas. Every main agent gets a label with its full chat name; the labels
// are placed by a declutter pass that tries a few spots around each anchor and takes the first one that touches no label placed before.

// Greedy word wrap that never cuts text: a word longer than a line is broken, nothing is replaced by an ellipsis.
// Width is counted in cells (full-width characters and emoji count 2).
export function cellWidth(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff))) return 2;
  return 1;
}
export function wrapText(text, maxCells) {
  const lines = [];
  let line = '', w = 0;
  const push = () => { if (line) lines.push(line); line = ''; w = 0; };
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const ww = [...word].reduce((s, ch) => s + cellWidth(ch), 0);
    if (w && w + 1 + ww <= maxCells) { line += ' ' + word; w += 1 + ww; continue; }
    push();
    if (ww <= maxCells) { line = word; w = ww; continue; }
    for (const ch of word) {                                                       // a word wider than a line
      const cw = cellWidth(ch);
      if (w + cw > maxCells) push();
      line += ch; w += cw;
    }
  }
  push();
  return lines.length ? lines : [''];
}

// Declutter: items [{ id, ax, ay, w, h, pri, force }] in view px, anchor = bottom centre of the preferred spot (the label sits above it).
// Returns Map id -> { x, y, ok }. Higher pri is placed first; a label that fits nowhere without touching another is `ok: false` unless
// it is `force`d (main agents), in which case it takes the least bad spot. `obstacles` are rects [{ x, y, w, h }] (the figures of the
// agents) that a label should not cover: covering one costs less than touching another label, so labels give way to each other first.
// `taken` are rects [{ x, y, w, h }] that are in place already (the three.js scene's balloons and cards): labels keep clear of them like of a label placed before, they
// are neither moved nor in the result.
const RING = [[0, -1], [1, 0], [-1, 0], [1, -1], [-1, -1], [0, 1], [1, 1], [-1, 1]];
export function placeLabels(items, vw, vh, gap = 6, pad = 3, obstacles = [], taken = []) {
  const order = [...items].sort((a, b) => b.pri - a.pri || a.ay - b.ay || (a.id < b.id ? -1 : 1));
  const placed = taken.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })), out = new Map();
  const hit = (x, y, w, h) => {
    let area = 0;
    for (const p of placed) { const ox = Math.min(x + w, p.x + p.w) - Math.max(x, p.x) + pad, oy = Math.min(y + h, p.y + p.h) - Math.max(y, p.y) + pad; if (ox > 0 && oy > 0) area += ox * oy * 4; }
    for (const p of obstacles) { const ox = Math.min(x + w, p.x + p.w) - Math.max(x, p.x), oy = Math.min(y + h, p.y + p.h) - Math.max(y, p.y); if (ox > 0 && oy > 0) area += ox * oy; }
    return area;
  };
  for (const it of order) {
    const { ax, ay, w, h } = it;
    // the spot above the anchor first, then rings of spots around it, nearest first
    const cands = [[ax - w / 2, ay - h - gap]];
    for (let k = 1; k <= 7; k++) {
      for (const [ux, uy] of RING) cands.push([ax - w / 2 + ux * k * (w * 0.55 + 2), ay - h - gap + uy * k * (h * 0.75 + 2)]);
      if (k === 1) cands.push([ax - w / 2, ay + gap], [ax + gap, ay - h / 2], [ax - w - gap, ay - h / 2]);
    }
    let best = null;
    for (const [cx, cy] of cands) {
      const x = Math.min(vw - w - 4, Math.max(4, cx)), y = Math.min(vh - h - 4, Math.max(4, cy));
      const area = hit(x, y, w, h);
      if (area === 0) { best = { x, y, area }; break; }
      if (!best || area < best.area) best = { x, y, area };
    }
    const ok = best.area === 0;
    if (!ok && !it.force) { out.set(it.id, { x: best.x, y: best.y, ok: false }); continue; }
    placed.push({ x: best.x, y: best.y, w, h });
    out.set(it.id, { x: best.x, y: best.y, ok });
  }
  return out;
}

// DOM side: one element per label id, content set only when it changed, size measured once per change.
export function createLabelLayer(layer) {
  const els = new Map();
  return {
    set(id, html, cls, extra) {
      let L = els.get(id);
      if (!L) {
        const el = document.createElement('div');
        el.className = 'px-l';
        el.style.visibility = 'hidden';
        el.dataset.id = id;
        layer.appendChild(el);
        els.set(id, L = { el, html: '', cls: '', w: 0, h: 0, dirty: true, shown: false });
      }
      if (L.html !== html) { L.el.innerHTML = html; L.html = html; L.dirty = true; }
      if (L.cls !== cls) { L.el.className = 'px-l ' + cls; L.cls = cls; L.dirty = true; }
      L.extra = extra;
      return L;
    },
    measure(L) { if (L.dirty) { const w = L.el.offsetWidth; if (w) { L.w = w; L.h = L.el.offsetHeight; L.dirty = false; } } return L; },
    show(L, x, y) {
      L.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      if (!L.shown) { L.shown = true; L.el.style.visibility = 'visible'; }
    },
    hide(L) { if (L.shown) { L.shown = false; L.el.style.visibility = 'hidden'; } },
    drop(id) { const L = els.get(id); if (L) { L.el.remove(); els.delete(id); } },
    ids() { return [...els.keys()]; },
    get(id) { return els.get(id); },
    clear() { for (const L of els.values()) L.el.remove(); els.clear(); },
  };
}
