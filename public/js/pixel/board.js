// The board of a room in the pixel scene: a plate that stands on top of the room's back (north) wall and carries the CHAT NAME in big letters. The project
// folder is a small line in its bottom-right corner, shown only when the setting `project` is on (settings.js; off by default); a board never has more words
// than that. A waiting chat adds a chip (your turn, needs an answer) at the top-right edge, a room whose subagents do not all fit adds "+N".
//
// The board is HTML (crisp text over the canvas) laid on the wall's plane: in the isometric view the wall runs down to the right, so the plate is sheared to
// the wall's slope (the projection says how much), in the front view it is straight. Its size follows the zoom like the wall does, but its letters never get
// smaller than they can be read (boardFonts), and a board that would be narrower than MIN_W is not drawn. The words come from board-text.js, so the 3D scene's
// plaque says the same.
//
// Pointer: a board takes no pointer events (the scene's own picking asks `hit`): a click on it is a click on the room's main agent, a drag still pans, the wheel
// still zooms. It gives way to labels: it is hidden while it would touch a label of an agent (labels are placed first, `place` gets their rectangles).
// Motion (docs/motion.md, kind "surface that only fades"): it fades in and out with its room, nothing travels or scales; under reduced motion the fade is shorter.
//
// Pure parts (tested without a browser): boardFonts, boardFrame, frameCorners, frameStrips, frameHit, quadHitsRect.
import { esc } from '../util.js';
import { boardName, boardProject, boardBadges } from '../board-text.js';
import { DUR } from '../motion.js';
import { G } from './layout.js';

export const BOARD = Object.freeze({
  SHARE: 0.84,                   // the board is this much of the wall's width on screen ...
  EM_MAX: 18,                    // ... but at most this many of its own letter heights wide
  MIN_W: 64,                     // CSS px: narrower than this it is not drawn (the label of the agent says the same)
  MIN_FONT: 12, MAX_FONT: 30,    // CSS px of the chat name
  SINK: 2,                       // voxels: the plate stands this far down into the wall's top edge, so it reads as mounted on it
});

// Type sizes in CSS px for a scale (CSS px per virtual px of the scene: zoom / dpr). The name grows with the room and stops at MAX_FONT; the small text is
// never bigger than 0.75 of the name (the project folder, the chips).
export function boardFonts(scale) {
  const name = Math.min(BOARD.MAX_FONT, Math.max(BOARD.MIN_FONT, Math.round(8 * scale)));
  return { name, small: Math.max(9, Math.round(name * 0.62)) };
}

// Where a board hangs. `room` is a room of the layout ({ x, y, w, d, walls }), `proj` the projection, `at(x, y, z)` the position in CSS px of a point of the
// world, `scale` CSS px per virtual px. The bottom centre of the plate is `(ax, ay)`; `tan` is the slope of the wall on screen (0 in the front view).
export function boardFrame(room, proj, at, scale) {
  const zTop = (room.walls && room.walls.north === 'tall' ? G.WALL_H : G.LOW_H) - BOARD.SINK;
  const y = room.y + room.d + G.WALL_T / 2;
  const [ax, ay] = at(room.x + room.w / 2, y, zTop);
  const wall = Math.abs(at(room.x + room.w, y, zTop)[0] - at(room.x, y, zTop)[0]);
  const fonts = boardFonts(scale);
  const w = Math.min(wall * BOARD.SHARE, fonts.name * BOARD.EM_MAX);
  const [sx0, sy0] = proj.toScreen(0, 0, 0), [sx1, sy1] = proj.toScreen(1, 0, 0);
  const tan = sx1 === sx0 ? 0 : (sy1 - sy0) / (sx1 - sx0);
  return { ax, ay, w, tan, fonts, ok: w >= BOARD.MIN_W };
}

// the four corners of a board of height h: bottom-left, bottom-right, top-right, top-left
export function frameCorners(f, h) {
  const k = (f.w / 2) * f.tan;
  return [[f.ax - f.w / 2, f.ay - k], [f.ax + f.w / 2, f.ay + k], [f.ax + f.w / 2, f.ay - h + k], [f.ax - f.w / 2, f.ay - h - k]];
}
// the board as `n` vertical strips, each a rectangle { x, y, w, h } around its part of the plate (the box of the whole sheared plate is mostly empty)
export function frameStrips(f, h, n = 6) {
  const out = [], sw = f.w / n;
  for (let i = 0; i < n; i++) {
    const x0 = f.ax - f.w / 2 + i * sw, x1 = x0 + sw, ya = f.ay + (x0 - f.ax) * f.tan, yb = f.ay + (x1 - f.ax) * f.tan;
    const top = Math.min(ya, yb) - h, bottom = Math.max(ya, yb);
    out.push({ x: x0, y: top, w: sw, h: bottom - top });
  }
  return out;
}
// is the point (x, y) on the board
export function frameHit(f, h, x, y) {
  const lx = x - f.ax, ly = y - f.ay - lx * f.tan;
  return Math.abs(lx) <= f.w / 2 && ly <= 0 && ly >= -h;
}
// does a convex quadrilateral touch a rectangle { x, y, w, h } (with `pad` px to spare), by the separating axis rule
export function quadHitsRect(q, r, pad = 0) {
  const x0 = r.x - pad, x1 = r.x + r.w + pad, y0 = r.y - pad, y1 = r.y + r.h + pad;
  if (Math.max(...q.map(p => p[0])) < x0 || Math.min(...q.map(p => p[0])) > x1 || Math.max(...q.map(p => p[1])) < y0 || Math.min(...q.map(p => p[1])) > y1) return false;
  for (let i = 0; i < 4; i++) {                                                            // the sides of the quadrilateral as axes
    const a = q[i], b = q[(i + 1) % 4], nx = a[1] - b[1], ny = b[0] - a[0];
    if (!nx && !ny) continue;
    let qmin = Infinity, qmax = -Infinity, rmin = Infinity, rmax = -Infinity;
    for (const p of q) { const d = p[0] * nx + p[1] * ny; qmin = Math.min(qmin, d); qmax = Math.max(qmax, d); }
    for (const p of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const d = p[0] * nx + p[1] * ny; rmin = Math.min(rmin, d); rmax = Math.max(rmax, d); }
    if (qmax < rmin || rmax < qmin) return false;
  }
  return true;
}

// DOM side: one element per room, content set only when it changed, size measured only when it changed.
export function createBoardLayer(layer, { msg, project = false }) {
  const box = document.createElement('div');
  box.className = 'px-board-layer';
  layer.prepend(box);                                           // before the labels, so every label is above every board
  const boards = new Map();                                     // room id -> { el, key, entry, frame, h, shown, dirty }
  let showProject = !!project;

  const html = e => {
    const name = boardName(e), proj = showProject ? boardProject(e) : '';
    const chips = boardBadges(e.status, e.overflow).map(b => `<span class="pb-badge ${b.kind}">${esc(b.key ? msg(b.key) : b.text)}</span>`).join('');
    return `${chips ? `<span class="pb-badges">${chips}</span>` : ''}<div class="pb-name">${esc(name || msg('of.session'))}</div>${proj ? `<div class="pb-proj">${esc(proj)}</div>` : ''}`;
  };
  const stateOf = e => (e.status === 'waiting' || e.status === 'ask' ? e.status : e.status === 'dormant' ? 'dormant' : 'idle');

  function hide(B) { if (B.shown) { B.shown = false; B.el.classList.remove('on'); } }

  let last = [];
  const api = {
    // entries: [{ id, name, title, project, color, status, overflow }] for the rooms that exist now
    sync(entries) {
      last = entries;
      const live = new Set();
      for (const e of entries) {
        live.add(e.id);
        let B = boards.get(e.id);
        if (!B) {
          const el = document.createElement('div');
          el.dataset.id = e.id;
          box.appendChild(el);
          boards.set(e.id, B = { el, key: '', cls: '', color: '', frame: null, h: 0, shown: false, dirty: true });
        }
        const key = html(e);
        if (B.key !== key) { B.el.innerHTML = key; B.key = key; B.chips = boardBadges(e.status, e.overflow).length > 0; B.dirty = true; }
        const cls = `px-board ${stateOf(e)}`;
        if (B.cls !== cls) { B.el.className = cls + (B.shown ? ' on' : ''); B.cls = cls; }
        if (B.color !== e.color) { B.el.style.setProperty('--bc', e.color || ''); B.color = e.color; }
      }
      for (const [id, B] of [...boards]) {
        if (live.has(id)) continue;
        boards.delete(id);
        B.el.classList.remove('on');
        setTimeout(() => B.el.remove(), DUR.fast + 60);                  // gone from the page once the fade is over
      }
    },
    setProject(on) {
      if (showProject === !!on) return;
      showProject = !!on;
      api.sync(last);                                           // every board is written again, with or without its small line
    },
    get project() { return showProject; },
    // Step 1, before the labels are placed. Lay every board on its wall: rooms: the layout's rooms; proj: the projection; at(x, y, z): CSS px of a world
    // point; scale: CSS px per virtual px; view: { w, h } in CSS px. Returns the rectangles the labels should keep clear of (a few strips along each board that
    // can be seen, since a sheared plate is badly described by one box).
    layout({ rooms, proj, at, scale, view }) {
      const out = [];
      for (const B of boards.values()) B.frame = null;
      for (const room of rooms) {
        const B = boards.get(room.id);
        if (!B) continue;
        const f = boardFrame(room, proj, at, scale);
        if (!f.ok) continue;
        const px = `${f.fonts.name}px`, w = Math.round(f.w);
        if (B.el.style.fontSize !== px || B.w !== w) {
          B.el.style.fontSize = px;
          B.el.style.setProperty('--pb-s', `${f.fonts.small}px`);
          B.el.style.width = `${w}px`;
          B.w = w;
          B.dirty = true;
        }
        if (B.dirty) { B.h = B.el.offsetHeight; B.dirty = false; }
        const up = B.chips ? Math.max(0, Math.round(1.55 * f.fonts.small - 0.12 * f.fonts.name)) : 0;        // the chips stand out of the top edge
        const frame = { ...f, w: B.w }, quad = frameCorners(frame, B.h + up), xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
        if (Math.max(...xs) < 0 || Math.min(...xs) > view.w || Math.max(...ys) < 0 || Math.min(...ys) > view.h) continue;
        B.frame = frame;
        B.quad = quad;
        B.up = up;
        out.push(...frameStrips(frame, B.h + up));
      }
      return out;
    },
    // Step 2, after the labels are placed. A board shows unless it would touch a label: avoid: rectangles { x, y, w, h } of the labels on screen.
    settle(avoid = []) {
      for (const B of boards.values()) {
        if (!B.frame || avoid.some(r => quadHitsRect(B.quad, r, 2))) { hide(B); continue; }
        const f = B.frame;
        B.el.style.transform = `translate(${(f.ax - B.w / 2).toFixed(1)}px,${f.ay.toFixed(1)}px) translateY(-100%) skewY(${Math.atan(f.tan).toFixed(4)}rad)`;
        if (!B.shown) { B.shown = true; B.el.classList.add('on'); }
      }
    },
    // the id of the room whose board is under the point (CSS px of the area), or null
    hit(x, y) {
      for (const [id, B] of boards) if (B.shown && B.frame && frameHit(B.frame, B.h + B.up, x, y)) return id;
      return null;
    },
    hideAll() { for (const B of boards.values()) hide(B); },
    ids() { return [...boards.keys()]; },
    get(id) { return boards.get(id); },
  };
  return api;
}
