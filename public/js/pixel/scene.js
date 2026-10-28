// Draws the pixel office. Two parts: a cached ground layer (grass, streets, floors, rugs: thousands of tiles drawn once per layout) and
// the upright sprites (walls, furniture, desks, workers, trees), sorted back to front once and drawn on every frame that is needed,
// culled to the view. Status effects (marker, balloons, light beam) are drawn on top in code.
//
// The scene works in virtual pixels (zoom 1). The camera is a whole-number zoom plus a pan in device pixels, so every sprite lands on
// the pixel grid and is scaled by an integer with nearest-neighbour sampling.
import { screenBounds } from './projection.js';
import { drawMarker, drawBalloon, drawBeam, drawRing } from './effects.js';
import { workerId, deskId } from './ids.js';
import { depthSort } from './depth.js';

const WALL_TINT = 0.45, FLOOR_TINT = 0.32;
const BG = '#0e1320';

export function deskState(a) {
  if (!a) return 'off';
  return a.status === 'working' ? 'on' : a.status === 'waiting' || a.status === 'ask' || a.status === 'done' ? 'idle' : 'off';
}
export function poseOf(a, t, anim) {
  switch (a.status) {
    case 'working': return anim && Math.floor(t / 300) % 2 ? 'typeB' : 'typeA';
    case 'waiting': case 'ask': return 'wait';
    case 'done': return 'relax';
    default: return 'sleep';
  }
}

export function createScene({ atlas, proj }) {
  const img = atlas.image;
  let layout = null, ground = null, gx = 0, gy = 0, bounds = { x0: 0, y0: 0, x1: 1, y1: 1 }, fitBox = bounds;
  let entries = [], figs = [], roomById = new Map(), sortMs = 0;
  const actors = new Map();                     // `${roomId}:${slot}` -> { id, main, status, ap, name, since }
  let hoverId = null;

  // ---- sprite sources: where to take pixels from and where to put them (integers), computed once per sprite and pivot
  function src(id, facing, px, py, tint, strength) {
    const s = atlas.sprite(id, facing);
    if (!s) return null;
    const [rx, ry, rw, rh] = s.rect;
    const dx = Math.round(px - s.px), dy = Math.round(py - s.py);
    if (tint) {
      const t = atlas.tinted(id, facing, tint, strength);
      return { c: t.canvas, sx: 0, sy: 0, w: rw, h: rh, dx, dy };
    }
    return { c: img, sx: rx, sy: ry, w: rw, h: rh, dx, dy };
  }
  const put = (g, s) => g.drawImage(s.c, s.sx, s.sy, s.w, s.h, s.dx, s.dy, s.w, s.h);

  const centre = (it) => proj.toScreen(it.x + it.w / 2, it.y + it.d / 2, 0);

  function setLayout(L) {
    layout = L;
    roomById = new Map(L.rooms.map(r => [r.id, r]));
    const b = L.bounds;
    const sb = screenBounds(proj, b.x0, b.y0, b.x1, b.y1, b.zTop || 40);
    bounds = { x0: Math.floor(sb.x0), y0: Math.floor(sb.y0), x1: Math.ceil(sb.x1), y1: Math.ceil(sb.y1) };
    // what "fit" has to show: the building with a little grass, and headroom for the labels of the back row
    const bd = L.building, m = 24;
    const fb = screenBounds(proj, bd.x0 - m, bd.y0 - m, bd.x1 + m, bd.y1 + m, 48);
    fitBox = { x0: Math.floor(fb.x0), y0: Math.floor(fb.y0) - 10, x1: Math.ceil(fb.x1), y1: Math.ceil(fb.y1) };

    // ground layer
    gx = bounds.x0 - 8; gy = bounds.y0 - 8;
    const gw = bounds.x1 - bounds.x0 + 16, gh = bounds.y1 - bounds.y0 + 16;
    ground = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(gw, gh) : Object.assign(document.createElement('canvas'), { width: gw, height: gh });
    const g = ground.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(-gx, -gy);
    const flat = [];
    for (const t of L.outdoor.tiles) flat.push({ ...t, w: 16, d: 16, facing: 0, order: 0 });
    for (const r of L.rooms) {
      for (const f of r.floor) flat.push({ ...f, tint: f.tint ? r.color : null, order: 1 });
      for (const it of r.items) if (it.layer === 'floor') flat.push({ ...it, tint: null, order: 2 });
    }
    flat.sort((p, q) => p.order - q.order || (p.x + p.w - p.y) - (q.x + q.w - q.y) || p.x - q.x);
    for (const f of flat) {
      const [px, py] = centre(f);
      const s = src(f.id, f.facing, px, py, f.tint, FLOOR_TINT);
      if (s) put(g, s);
    }

    // upright sprites
    const list = [];
    const addStatic = (it, tint) => {
      const [px, py] = centre(it);
      const s = src(it.id, it.facing, px, py, tint, WALL_TINT);
      if (!s) return;
      const fp = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d };
      list.push({ kind: 's', id: it.id, s, fp, key: proj.depthKey(fp, 0), x0: s.dx, y0: s.dy, x1: s.dx + s.w, y1: s.dy + s.h });
    };
    for (const r of L.rooms) {
      for (const it of r.items) if (it.layer === 'stand') addStatic(it, it.tint ? r.color : null);
      for (const slot of r.slots) {
        for (const kind of ['d', 'c']) {
          const box = kind === 'd' ? slot.desk : slot.seat;
          const [px, py] = proj.toScreen(box.x + box.w / 2, box.y + box.d / 2, 0);
          const fp = { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.d };
          list.push({
            kind, room: r, slot, cache: new Map(), px, py, fp, key: proj.depthKey(fp, 0),
            x0: Math.round(px) - 40, y0: Math.round(py) - 56, x1: Math.round(px) + 40, y1: Math.round(py) + 14,
          });
        }
      }
    }
    for (const it of L.outdoor.items) addStatic(it, null);
    const t0 = performance.now();
    entries = depthSort(list.map(e => ({ ...e, bb: e, ref: e })), proj).map(w => w.ref);
    sortMs = performance.now() - t0;
    rebuildFigures();
  }

  // ---- actors (who sits where and what they do), set by index.js
  function setActors(list) {
    actors.clear();
    for (const a of list) actors.set(a.roomId + ':' + a.slot, a);
    rebuildFigures();
  }
  function rebuildFigures() {
    figs = [];
    if (!layout) return;
    for (const e of entries) {
      if (e.kind !== 'c') continue;
      const a = actors.get(e.room.id + ':' + e.slot.index);
      if (a) figs.push({ id: a.id, main: !!a.main, roomId: e.room.id, slot: e.slot.index, seat: e, actor: a, desk: null });
    }
    for (const e of entries) {
      if (e.kind !== 'd') continue;
      const f = figs.find(x => x.roomId === e.room.id && x.slot === e.slot.index);
      if (f) f.desk = e;
    }
  }
  const actorOf = e => actors.get(e.room.id + ':' + e.slot.index);

  function dynSrc(e, a, t, anim) {
    let id;
    if (e.kind === 'd') id = deskId(e.slot.kind === 'chief', deskState(a));
    else id = a ? workerId(a.ap, poseOf(a, t, anim)) : 'chair';
    let s = e.cache.get(id);
    if (s === undefined) { s = src(id, 0, e.px, e.py, null, 0); s && (s.id = id); e.cache.set(id, s || null); }
    return s;
  }

  // ---- drawing
  function draw(g, view, t, anim) {
    const { zoom, panX, panY, w, h } = view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);
    if (!layout) return;
    g.setTransform(zoom, 0, 0, zoom, panX, panY);
    const vx0 = -panX / zoom, vy0 = -panY / zoom, vx1 = (w - panX) / zoom, vy1 = (h - panY) / zoom;
    g.drawImage(ground, gx, gy);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.x1 < vx0 || e.x0 > vx1 || e.y1 < vy0 || e.y0 > vy1) continue;
      if (e.kind === 's') { put(g, e.s); continue; }
      const s = dynSrc(e, actorOf(e), t, anim);
      if (s) put(g, s);
    }
    // effects
    for (let i = 0; i < figs.length; i++) {
      const f = figs[i], a = f.actor, e = f.seat;
      const cx = Math.round(e.px), fy = Math.round(e.py);
      if (cx < vx0 - 40 || cx > vx1 + 40 || fy < vy0 || fy > vy1 + 90) continue;
      const wait = a.status === 'waiting' || a.status === 'ask';
      if (f.id === hoverId) drawRing(g, cx, fy + 2);
      if (wait && a.main) drawBeam(g, cx, fy + 2, 64, anim ? 0.5 + 0.5 * Math.sin(t / 420) : 1);
    }
    for (let i = 0; i < figs.length; i++) {
      const f = figs[i], a = f.actor, e = f.seat;
      const cx = Math.round(e.px), fy = Math.round(e.py);
      if (cx < vx0 - 40 || cx > vx1 + 40 || fy < vy0 || fy > vy1 + 90) continue;
      const wait = a.status === 'waiting' || a.status === 'ask';
      const bob = wait && anim ? Math.round(Math.sin(t / 230) * 2) : 0;
      const headTop = fy - 40;
      if (a.main) {
        const top = headTop - 15 + bob;
        drawMarker(g, cx, top, a.status === 'ask' ? 'waiting' : a.status);
        if (wait) drawBalloon(g, cx, top - 1, 'wait', a.status === 'ask' ? '?' : '!');
        else if (a.status === 'dormant') drawBalloon(g, cx, top - 1, 'zz');
      } else if (a.status === 'done') drawBalloon(g, cx, headTop - 1, 'done');
      else if (a.status === 'stale') drawBalloon(g, cx, headTop - 1, 'zz');
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- picking and geometry for the input and label code
  function pick(vx, vy, minHalf) {
    // 1. a pixel of an agent's own sprite (nearest first), 2. the minimum target around the agent (a thumb or a trackpad needs more
    // than 15 px), closest centre first, 3. a pixel of the desk of a seated agent: the guaranteed target of one agent wins over the
    // desk of its neighbour
    let best = null, bestKey = -Infinity, deskHit = null, deskKey = -Infinity, near = null, nearD = Infinity;
    for (const f of figs) {
      const e = f.seat, s = dynSrc(e, f.actor, 0, false);
      if (s) {
        const lx = vx - s.dx, ly = vy - s.dy;
        if (lx >= 0 && ly >= 0 && lx < s.w && ly < s.h && atlas.alphaAt(s.id, 0, lx, ly) > 24) { if (e.key >= bestKey) { best = f; bestKey = e.key; } continue; }
        const dx = Math.abs(vx - (s.dx + s.w / 2)), dy = Math.abs(vy - (s.dy + s.h / 2));
        if (dx <= minHalf && dy <= minHalf && dx + dy < nearD) { near = f; nearD = dx + dy; }
      }
      if (f.desk) {
        const d = dynSrc(f.desk, f.actor, 0, false);
        if (d) { const lx = vx - d.dx, ly = vy - d.dy; if (lx >= 0 && ly >= 0 && lx < d.w && ly < d.h && atlas.alphaAt(d.id, 0, lx, ly) > 24 && f.desk.key >= deskKey) { deskHit = f; deskKey = f.desk.key; } }
      }
    }
    const hit = best || near || deskHit;
    return hit ? { id: hit.id, main: hit.main, roomId: hit.roomId, slot: hit.slot } : null;
  }
  function roomAt(vx, vy) {
    if (!layout) return null;
    const [x, y] = proj.toGround(vx, vy, 0);
    for (const r of layout.rooms) if (x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.d + 2) return r.id;
    return null;
  }
  // virtual px of a world point
  const toVirtual = (x, y, z = 0) => proj.toScreen(x, y, z);

  // Fraction of an agent's sprite that later sprites cover, and which sprites do it (QA only: allocates canvases).
  function occlusionInfo(id, t = 0) {
    const f = figs.find(x => x.id === id);
    if (!f) return null;
    const own = f.seat, a = f.actor;
    const s = dynSrc(own, a, t, false);
    if (!s) return null;
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(s.c, s.sx, s.sy, s.w, s.h, 0, 0, s.w, s.h);
    const count = () => { const d = g.getImageData(0, 0, s.w, s.h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++; return n; };
    const total = count();
    g.globalCompositeOperation = 'destination-out';
    const from = entries.indexOf(own) + 1, by = [];
    let left = total;
    for (let i = from; i < entries.length; i++) {
      const e = entries[i];
      const o = e.kind === 's' ? e.s : dynSrc(e, actorOf(e), t, false);
      if (!o || o.dx >= s.dx + s.w || o.dx + o.w <= s.dx || o.dy >= s.dy + s.h || o.dy + o.h <= s.dy) continue;
      g.drawImage(o.c, o.sx, o.sy, o.w, o.h, o.dx - s.dx, o.dy - s.dy, o.w, o.h);
      const now = count();
      if (now < left) { by.push({ id: o.id || (e.kind === 's' ? e.id : e.kind), kind: e.kind, covered: left - now }); left = now; }
    }
    return { fraction: total ? 1 - left / total : 0, total, by };
  }
  const occlusion = (id, t = 0) => { const r = occlusionInfo(id, t); return r ? r.fraction : null; };

  return {
    setLayout, setActors, draw, pick, roomAt, toVirtual, occlusion, occlusionInfo,
    setHover(id) { hoverId = id; },
    get bounds() { return bounds; },
    get fitBox() { return fitBox; },
    get sortMs() { return +sortMs.toFixed(2); },
    get layout() { return layout; },
    get counts() { return { entries: entries.length, figures: figs.length, ground: layout ? layout.outdoor.tiles.length : 0 }; },
    figureInfo(id, t = 0) {
      const f = figs.find(x => x.id === id);
      if (!f) return null;
      const s = dynSrc(f.seat, f.actor, t, false);
      return { id, roomId: f.roomId, slot: f.slot, main: f.main, status: f.actor.status, cx: s.dx + s.w / 2, cy: s.dy + s.h / 2, x0: s.dx, y0: s.dy, w: s.w, h: s.h, px: f.seat.px, py: f.seat.py };
    },
    figureIds() { return figs.map(f => f.id); },
  };
}
