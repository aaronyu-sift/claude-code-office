// Draws the pixel office. Two parts: a cached ground layer (grass, streets, floors, rugs, and the landscape far beyond the garden with its trees,
// bushes and rocks: tens of thousands of tiles and sprites drawn once per layout) and the upright sprites of the building and the garden (walls,
// furniture, desks, workers, trees), sorted back to front once and drawn on every frame that is needed, culled to the view. Status effects (marker,
// balloons, light beam) are drawn on top in code. There is no sky: the ground covers the whole world (layout.js `world`) and the view stays inside it.
//
// The scene works in virtual pixels (zoom 1). The camera is a whole-number zoom plus a pan in device pixels, so every sprite lands on
// the pixel grid and is scaled by an integer with nearest-neighbour sampling.
import { screenBounds } from './projection.js';
import { drawMarker, drawBalloon, drawBeam, drawRing, drawBubble, drawSteam, drawButterfly, drawBird } from './effects.js';
import { glowSprite, GLOW } from './lighting.js';
import { workerId, deskId, isFloor } from './ids.js';
import { depthSort } from './depth.js';
import { spriteFor } from './season.js';

const WALL_TINT = 0.45, FLOOR_TINT = 0.32;
const newCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

export function deskState(a) {
  if (!a) return 'off';
  return a.status === 'working' ? 'on' : a.status === 'waiting' || a.status === 'ask' || a.status === 'done' ? 'idle' : 'off';
}
export function poseOf(a, t, anim) {
  switch (a.status) {
    case 'working': return a.thinking ? 'think' : anim && Math.floor(t / 300) % 2 ? 'typeB' : 'typeA';
    case 'waiting': case 'ask': return 'wait';
    case 'done': return 'relax';
    default: return 'sleep';
  }
}

export function createScene({ atlas, proj }) {
  // what the last draw() put on screen (QA reads it through the `effects` getter)
  const fx = { beams: 0, markers: 0, waitBalloons: 0, zzBalloons: 0, doneBalloons: 0, rings: 0, bubbles: 0, steam: 0, butterflies: 0, birds: 0, swayed: 0, lights: {} };
  const img = atlas.image;
  const headRise = Math.round(-proj.toScreen(0, 0, 37.7)[1]);     // px from a seated figure's pivot to the top of its head (40 isometric, 38 front)
  let layout = null, groundOut = null, groundIn = null, groundOutT = null, gx = 0, gy = 0, gix = 0, giy = 0, bounds = { x0: 0, y0: 0, x1: 1, y1: 1 }, fitBox = bounds, world = bounds;
  let baseColour = [96, 150, 70], outerDrawn = 0, outerDropped = 0;
  let entries = [], figs = [], roomById = new Map(), sortMs = 0, outdoorKey = '', pendingLight = null, ambientPts = { flowers: [], trees: [] };
  const actors = new Map();                     // `${roomId}:${slot}` -> { id, main, status, ap, name, since }
  let hoverId = null, quiet = false;             // quiet: draw no status effects (QA measures the light on the figures alone)
  // The season only changes which sprites the garden is drawn with (baked variants, season.js); the layout is the same in every season.
  let season = 'summer', lastLight = null;
  const animals = { butterflies: true, birds: true };            // the view turns them off in winter and in rain, snow and fog
  const seasonal = { drawn: 0, variants: 0, slots: 0 };         // what the last layout put in the garden (QA reads it)
  const rid = id => spriteFor(id, season, atlas.has);

  // ---- sprite sources: where to take pixels from and where to put them (integers), computed once per sprite and pivot
  function src(id, facing, px, py, tint, strength) {
    const s = atlas.sprite(id, facing);
    if (!s) return null;
    const [rx, ry, rw, rh] = s.rect;
    const dx = Math.round(px - s.px), dy = Math.round(py - s.py);
    if (tint) {
      const t = atlas.tinted(id, facing, tint, strength);
      return { c: t.canvas, sx: 0, sy: 0, w: rw, h: rh, dx, dy, anchors: atlas.anchors(id, facing) };
    }
    return { c: img, sx: rx, sy: ry, w: rw, h: rh, dx, dy, anchors: atlas.anchors(id, facing) };
  }
  const put = (g, s) => g.drawImage(s.c, s.sx, s.sy, s.w, s.h, s.dx, s.dy, s.w, s.h);

  const centre = (it) => proj.toScreen(it.x + it.w / 2, it.y + it.d / 2, it.z || 0);

  function setLayout(L, light = null) {
    layout = L;
    roomById = new Map(L.rooms.map(r => [r.id, r]));
    const b = L.bounds;
    const sb = screenBounds(proj, b.x0, b.y0, b.x1, b.y1, b.zTop || 40);
    bounds = { x0: Math.floor(sb.x0), y0: Math.floor(sb.y0), x1: Math.ceil(sb.x1), y1: Math.ceil(sb.y1) };
    // what "fit" has to show: the building with a little grass, and headroom for the labels of the back row
    const bd = L.building, m = 24;
    const fb = screenBounds(proj, bd.x0 - m, bd.y0 - m, bd.x1 + m, bd.y1 + m, 48);
    fitBox = { x0: Math.floor(fb.x0), y0: Math.floor(fb.y0) - 10, x1: Math.ceil(fb.x1), y1: Math.ceil(fb.y1) };

    // ground layers: the landscape and the garden (grass, street, pond, far trees) and the room floors (carpets, rugs) on two canvases, so the
    // landscape can be darker at night. The first covers the whole world (and the overhang of sprites at its edge), the second only the building.
    world = { ...L.world };
    const OVER = 64, ob = screenBounds(proj, bd.x0 - 16, bd.y0 - 16, bd.x1 + 16, bd.y1 + 16, 0);
    gx = world.x0 - OVER; gy = world.y0 - OVER;
    gix = Math.floor(ob.x0) - 4; giy = Math.floor(ob.y0) - 4;
    const layer = (ox, oy, w, h) => { const c = newCanvas(w, h), g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.translate(-ox, -oy); return [c, g]; };
    let gOut, gIn;
    [groundOut, gOut] = layer(gx, gy, world.x1 - world.x0 + 2 * OVER, world.y1 - world.y0 + 2 * OVER);
    [groundIn, gIn] = layer(gix, giy, Math.ceil(ob.x1) + 4 - gix, Math.ceil(ob.y1) + 4 - giy);
    groundOutT = null;
    const outFlat = [], inFlat = [];
    seasonal.drawn = seasonal.variants = seasonal.slots = 0;
    for (const t of L.outdoor.tiles) outFlat.push({ ...t, id: rid(t.id), w: 16, d: 16, facing: 0, order: 0 });
    for (const t of L.outer.tiles) outFlat.push({ ...t, id: rid(t.id), w: 16, d: 16, facing: 0, order: 0 });
    for (const it of L.outdoor.items) if (it.layer === 'floor') outFlat.push({ ...it, id: rid(it.id), tint: null, order: 2 });
    for (const r of L.rooms) {
      for (const f of r.floor) inFlat.push({ ...f, tint: f.tint ? r.color : null, order: 1 });
      for (const it of r.items) if (it.layer === 'floor') inFlat.push({ ...it, tint: null, order: 2 });
    }
    for (const [flat, g] of [[outFlat, gOut], [inFlat, gIn]]) {
      flat.sort((p, q) => p.order - q.order || (p.x + p.w - p.y) - (q.x + q.w - q.y) || p.x - q.x);
      for (const f of flat) {
        const [px, py] = centre(f);
        const s = src(f.id, f.facing, px, py, f.tint, FLOOR_TINT);
        if (s) put(g, s);
      }
    }
    outdoorKey = '';
    pendingLight = lastLight = light;
    for (const f of outFlat) if (f.id && f.id.includes('@')) seasonal.variants++;

    // upright sprites
    const list = [];
    const make = (it, tint, outdoor = false) => {
      const id = outdoor ? rid(it.id) : it.id;                     // garden pieces are drawn in the season's variant (or not at all)
      if (!id) return null;
      const [px, py] = centre(it);
      const s = src(id, it.facing, px, py, tint, WALL_TINT);
      if (!s) return null;
      const fp = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d };
      const tags = atlas.sprite(id, it.facing).def.tags;
      if (outdoor) { seasonal.drawn++; if (id.includes('@') || id !== it.id) seasonal.variants++; if (id !== it.id) seasonal.slots++; }
      return { kind: 's', id, facing: it.facing, s, fp, key: proj.depthKey(fp, 0), x0: s.dx, y0: s.dy, x1: s.dx + s.w, y1: s.dy + s.h, outdoor, sway: tags.includes('sway'), phase: ((it.x * 7 + it.y * 13) & 15) / 16 * 6.28 };
    };
    const addStatic = (it, tint, outdoor = false) => { const e = make(it, tint, outdoor); if (e) list.push(e); };
    ambientPts = { flowers: [], trees: [] };
    for (const r of L.rooms) {
      for (const it of r.items) if (it.layer === 'stand') addStatic(it, it.tint ? r.color : null);
      const deskEntry = new Map();
      for (const slot of r.slots) {
        for (const kind of ['d', 'c']) {
          const box = kind === 'd' ? slot.desk : slot.seat;
          const [px, py] = proj.toScreen(box.x + box.w / 2, box.y + box.d / 2, 0);
          const fp = { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.d };
          const e = {
            kind, room: r, slot, cache: new Map(), px, py, fp, key: proj.depthKey(fp, 0),
            x0: Math.round(px) - 40, y0: Math.round(py) - 56, x1: Math.round(px) + 40, y1: Math.round(py) + 14,
          };
          if (kind === 'd') { e.kids = []; deskEntry.set(slot.index, e); }
          list.push(e);
        }
      }
      // props stand on the desk: drawn right after it, never sorted on their own
      for (const pr of r.props || []) { const e = make(pr, null), parent = deskEntry.get(pr.slot); if (e && parent) parent.kids.push(e); }
    }
    for (const it of L.outdoor.items) {
      if (it.layer === 'floor') continue;
      addStatic(it, null, true);
      const [sx, sy] = centre(it);
      if (/^flowerbed|^bush_d|^planter/.test(it.id) && ambientPts.flowers.length < 4) ambientPts.flowers.push([sx, sy - 8]);
      else if (/^tree_|^pine/.test(it.id) && ambientPts.trees.length < 2) ambientPts.trees.push([sx, sy - 40]);
    }
    const t0 = performance.now();
    entries = [];
    for (const w of depthSort(list.map(e => ({ ...e, bb: e, ref: e })), proj)) { entries.push(w.ref); if (w.ref.kids) for (const k of w.ref.kids) entries.push(k); }
    sortMs = performance.now() - t0;
    bakeOuter(L, gOut);
    baseColour = grassColour();
    rebuildFigures();
    if (pendingLight) retint(pendingLight); else groundOutT = null;
  }

  // The landscape beyond the garden is baked into the ground canvas: each piece goes where its picture touches no sprite of the garden or the building
  // (a piece that would have to be sorted in among them is dropped), then flat pieces first and the rest from far to near.
  function bakeOuter(L, g) {
    const CELL = 128, grid = new Map(), cellKey = (cx, cy) => cx * 65599 + cy;
    for (const e of entries) {
      for (let cx = Math.floor(e.x0 / CELL); cx <= Math.floor(e.x1 / CELL); cx++) for (let cy = Math.floor(e.y0 / CELL); cy <= Math.floor(e.y1 / CELL); cy++) {
        const k = cellKey(cx, cy);
        let a = grid.get(k);
        if (!a) grid.set(k, a = []);
        a.push(e);
      }
    }
    const touches = r => {
      for (let cx = Math.floor(r.x0 / CELL); cx <= Math.floor(r.x1 / CELL); cx++) for (let cy = Math.floor(r.y0 / CELL); cy <= Math.floor(r.y1 / CELL); cy++) {
        const a = grid.get(cellKey(cx, cy));
        if (a) for (const e of a) if (e.x0 < r.x1 && e.x1 > r.x0 && e.y0 < r.y1 && e.y1 > r.y0) return true;
      }
      return false;
    };
    const list = [];
    outerDropped = 0;
    for (const it of L.outer.items) {
      const id = rid(it.id);
      if (!id) continue;
      const [px, py] = centre(it), s = src(id, it.facing, px, py, null, 0);
      if (!s) continue;
      const flat = isFloor(it.id);
      if (!flat && touches({ x0: s.dx - 2, y0: s.dy - 2, x1: s.dx + s.w + 2, y1: s.dy + s.h + 2 })) { outerDropped++; continue; }
      list.push({ s, flat, key: proj.depthKey({ x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d }, 0) });
    }
    list.sort((p, q) => q.flat - p.flat || p.key - q.key);
    for (const e of list) put(g, e.s);
    outerDrawn = list.length;
  }
  // the average colour of the grass in this season: what shows where the ground canvas does not reach (a view larger than the world at every zoom level)
  function grassColour() {
    const s = atlas.sprite(rid('floor_grass_a') || 'floor_grass_a', 0);
    if (!s) return baseColour;
    const [rx, ry, rw, rh] = s.rect, c = newCanvas(rw, rh), cg = c.getContext('2d', { willReadFrequently: true });
    cg.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);
    const d = cg.getImageData(0, 0, rw, rh).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : baseColour;
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
  // Re-tint for a new time of day: the garden ground is copied once with the garden tint laid over it and the shaded copies of garden sprites
  // are dropped (they are made again on demand). Returns the time it took in ms. `light` is { roomStr, outStr, lights, phase } or null.
  function retint(light) {
    const t0 = performance.now();
    lastLight = light;
    atlas.clearShades();
    for (const e of entries) e.shKey = null;
    if (groundOut && light && light.outStr) {
      if (!groundOutT || groundOutT.width !== groundOut.width || groundOutT.height !== groundOut.height) groundOutT = newCanvas(groundOut.width, groundOut.height);
      const g2 = groundOutT.getContext('2d');
      g2.globalCompositeOperation = 'copy';
      g2.drawImage(groundOut, 0, 0);
      g2.globalCompositeOperation = 'source-atop';
      g2.fillStyle = light.outStr;
      g2.fillRect(0, 0, groundOut.width, groundOut.height);
      g2.globalCompositeOperation = 'source-over';
    } else groundOutT = null;
    return performance.now() - t0;
  }

  const ICON = { edit: 'pencil', shell: 'terminal', web: 'magnifier', read: 'book', think: 'brain', agent: 'team' };
  const visible = (e, vx0, vy0, vx1, vy1) => !(e.x1 < vx0 || e.x0 > vx1 || e.y1 < vy0 || e.y0 > vy1);
  function swayPut(g, s, t, phase) {
    const off = Math.round(Math.sin(t / 650 + phase) * 1.2);
    if (!off) return put(g, s);
    const ht = Math.round(s.h * 0.6);
    g.drawImage(s.c, s.sx, s.sy, s.w, ht, s.dx + off, s.dy, s.w, ht);
    g.drawImage(s.c, s.sx, s.sy + ht, s.w, s.h - ht, s.dx, s.dy + ht, s.w, s.h - ht);
    fx.swayed++;
  }

  // light: { roomStr, outStr, lights, phase } from lighting (null = plain daylight)
  function draw(g, view, t, anim, light = null) {
    const { zoom, panX, panY, w, h } = view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);                                          // the stage behind it is the colour of the grass
    fx.beams = fx.markers = fx.waitBalloons = fx.zzBalloons = fx.doneBalloons = fx.rings = fx.bubbles = fx.steam = fx.butterflies = fx.birds = fx.swayed = 0;
    fx.lights = {};
    if (!layout) return;
    g.setTransform(zoom, 0, 0, zoom, panX, panY);
    const vx0 = -panX / zoom, vy0 = -panY / zoom, vx1 = (w - panX) / zoom, vy1 = (h - panY) / zoom;
    // only the part of each ground canvas that is in the view (the world is large: a whole-canvas draw would be scaled and clipped every frame)
    for (const [c, ox, oy] of [[groundOutT || groundOut, gx, gy], [groundIn, gix, giy]]) {
      const sx = Math.max(0, Math.floor(vx0 - ox)), sy = Math.max(0, Math.floor(vy0 - oy)), ex = Math.min(c.width, Math.ceil(vx1 - ox)), ey = Math.min(c.height, Math.ceil(vy1 - oy));
      if (ex > sx && ey > sy) g.drawImage(c, sx, sy, ex - sx, ey - sy, ox + sx, oy + sy, ex - sx, ey - sy);
    }
    const outStr = light && light.outStr;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!visible(e, vx0, vy0, vx1, vy1)) continue;
      if (e.kind === 's') {
        let s = e.s;
        if (e.outdoor && outStr) {                                    // garden pieces get the garden tint (cached per tint)
          if (e.shKey !== outStr) { const sh = atlas.shaded(e.id, e.facing, outStr); e.shKey = outStr; e.sh = sh ? { c: sh.canvas, sx: 0, sy: 0, w: sh.w, h: sh.h, dx: e.s.dx, dy: e.s.dy } : e.s; }
          s = e.sh;
        }
        if (anim && e.sway) swayPut(g, s, t, e.phase); else put(g, s);
        continue;
      }
      const a = actorOf(e);
      // the light of a waiting agent shines behind its figure and behind everything nearer, so it never washes out the sprite
      if (e.kind === 'c' && a && a.main && (a.status === 'waiting' || a.status === 'ask')) fx.beams++, drawBeam(g, Math.round(e.px), Math.round(e.py) + 2, 64, anim ? 0.5 + 0.5 * Math.sin(t / 420) : 1);
      const s = dynSrc(e, a, t, anim);
      if (s) put(g, s);
    }
    // the tint of the time of day over the rooms and everything in them (transparent pixels stay transparent)
    if (light && light.roomStr) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = light.roomStr;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.setTransform(zoom, 0, 0, zoom, panX, panY);
    }
    // lit windows, lamps and monitors (additive), after dark; steam and the small animals while the scene animates
    const lights = light ? light.lights : 0;
    if (lights > 0.02 || anim) {
      const lit = lights > 0.02;
      if (lit) g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!visible(e, vx0, vy0, vx1, vy1)) continue;
        const s = e.kind === 's' ? e.s : e.kind === 'd' ? dynSrc(e, actorOf(e), t, anim) : null;
        if (!s || !s.anchors) continue;
        for (const an of s.anchors) {
          if (an.k === 'steam') continue;
          if (!lit) continue;
          const G = GLOW[an.k];
          if (!G) continue;
          const flick = an.k === 'monitor' && anim ? 0.92 + 0.08 * Math.sin(t / 170 + (s.dx % 7)) : 1;
          const alpha = Math.min(1, lights * G.k * (an.s == null ? 1 : an.s) * flick);
          if (alpha <= 0.02) continue;
          const gs = glowSprite(an.k, an.r);
          g.globalAlpha = alpha;
          g.drawImage(gs.canvas, Math.round(s.dx + an.x - gs.r), Math.round(s.dy + an.y - gs.r));
          fx.lights[an.k] = (fx.lights[an.k] || 0) + 1;
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      if (anim) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.kind !== 's' || !e.s.anchors || !visible(e, vx0, vy0, vx1, vy1)) continue;
          for (const an of e.s.anchors) if (an.k === 'steam') { drawSteam(g, e.s.dx + an.x, e.s.dy + an.y, t); fx.steam++; }
        }
        if (!light || (lights < 0.5 && light.phase !== 'night')) {
          if (animals.butterflies) ambientPts.flowers.forEach(([bx, by], i) => {
            const x = bx + Math.round(Math.cos(t / 1300 + i * 1.7) * 16), y = by + Math.round(Math.sin(t / 900 + i * 2.3) * 8);
            if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;
            drawButterfly(g, x, y, t, i); fx.butterflies++;
          });
          if (animals.birds) ambientPts.trees.forEach(([bx, by], i) => {
            const x = bx + Math.round(Math.cos(t / 2100 + i * 3) * 26), y = by + Math.round(Math.sin(t / 1700 + i * 2) * 10);
            if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;
            drawBird(g, x, y, t); fx.birds++;
          });
        }
      }
    }
    // effects
    for (let i = 0; i < figs.length && !quiet; i++) {
      const f = figs[i], e = f.seat;
      const cx = Math.round(e.px), fy = Math.round(e.py);
      if (cx < vx0 - 40 || cx > vx1 + 40 || fy < vy0 || fy > vy1 + 90) continue;
      if (f.id === hoverId) { fx.rings++; drawRing(g, cx, fy + 2); }
    }
    for (let i = 0; i < figs.length && !quiet; i++) {
      const f = figs[i], a = f.actor, e = f.seat;
      const cx = Math.round(e.px), fy = Math.round(e.py);
      if (cx < vx0 - 40 || cx > vx1 + 40 || fy < vy0 || fy > vy1 + 90) continue;
      const wait = a.status === 'waiting' || a.status === 'ask';
      const bob = wait && anim ? Math.round(Math.sin(t / 230) * 2) : 0;
      const headTop = fy - headRise;
      if (a.main) {
        const top = headTop - 15 + bob;
        fx.markers++;
        drawMarker(g, cx, top, a.status === 'ask' ? 'waiting' : a.status);
        if (wait) { fx.waitBalloons++; drawBalloon(g, cx, top - 1, 'wait', a.status === 'ask' ? '?' : '!'); }
        else if (a.status === 'dormant') { fx.zzBalloons++; drawBalloon(g, cx, top - 1, 'zz'); }
      } else if (a.status === 'done') { fx.doneBalloons++; drawBalloon(g, cx, headTop - 1, 'done'); }
      else if (a.status === 'stale') { fx.zzBalloons++; drawBalloon(g, cx, headTop - 1, 'zz'); }
      // one thought bubble per working agent, icon only; at far zoom only agents that wait for you keep their bubble
      if (a.status === 'working' && a.act && zoom >= (a.main ? 2 : 3)) { fx.bubbles++; drawBubble(g, cx + 15, headTop + 3, a.thinking ? 'brain' : ICON[a.act] || 'brain'); }
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
    setQuiet(on) { quiet = !!on; },
    retint,
    // draw the garden in another season (the layout stays); `light` is the current light of the scene, for the garden's night tint
    setSeason(next, light = lastLight) { if (next === season) return false; season = next; if (layout) setLayout(layout, light); return true; },
    get season() { return season; },
    setAnimals(butterflies, birds) { animals.butterflies = !!butterflies; animals.birds = !!birds; },
    get seasonal() { return { season, ...seasonal }; },
    get bounds() { return bounds; },
    get world() { return world; },
    // the colour of the grass at the time of day: the stage colour behind the canvas, for a view larger than the world
    stageColour(light = lastLight) {
      const m = light && light.outStr ? /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(light.outStr) : null, a = m ? +m[4] : 0;
      return baseColour.map((v, i) => Math.round(v * (1 - a) + (m ? +m[i + 1] : 0) * a));
    },
    get outer() { return { drawn: outerDrawn, dropped: outerDropped }; },
    get fitBox() { return fitBox; },
    get effects() { return { ...fx }; },
    get sortMs() { return +sortMs.toFixed(2); },
    get layout() { return layout; },
    get counts() { return { entries: entries.length, figures: figs.length, ground: layout ? layout.outdoor.tiles.length + layout.outer.tiles.length : 0 }; },
    figureInfo(id, t = 0) {
      const f = figs.find(x => x.id === id);
      if (!f) return null;
      const s = dynSrc(f.seat, f.actor, t, false);
      return { id, roomId: f.roomId, slot: f.slot, main: f.main, status: f.actor.status, sprite: s.id, cx: s.dx + s.w / 2, cy: s.dy + s.h / 2, x0: s.dx, y0: s.dy, w: s.w, h: s.h, px: f.seat.px, py: f.seat.py };
    },
    figureIds() { return figs.map(f => f.id); },
  };
}
