// The pixel office view: same interface as the old three.js view (createOfis): { show, hide, update }.
// It owns the DOM (canvas, labels, summary, zoom buttons), turns the store into rooms and seated agents, and wires input to the scene.
import { t as msg } from '../i18n.js';
import { esc, fmtShort } from '../util.js';
import { projectionByName } from './projection.js';
import { loadAtlas } from './atlas.js';
import { layoutOffice, roomCap, hashStr } from './layout.js';
import { APPEARANCES } from './ids.js';
import { createScene } from './scene.js';
import { createScheduler } from './anim.js';
import { createLabelLayer, placeLabels } from './labels.js';
import { fitZoom, stepZoom, centerPan, clampPan, zoomAbout } from './input.js';

const FIT_ICON = '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';
const DONE_MS = 4500;                 // a finished subagent stays at its desk this long
const MIN_TARGET = 24;                // smallest click target around an agent, in CSS px
const clipTxt = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function shortDesc(s) {
  const d = String(s.desc || s.atype || msg('agent.sub')).trim().replace(/\s+/g, ' ');
  if (d.length <= 18) return d;
  let out = '';
  for (const w of d.split(' ')) { const nx = out ? out + ' ' + w : w; if (nx.length > 18) break; out = nx; }
  return (out || d.slice(0, 16) + '…').replace(/[\s:;,.\-–—]+$/, '');
}

export function createPixelOffice(root, ctx, opts = {}) {
  const { store } = ctx;
  const proj = projectionByName(opts.proj || 'iso');
  root.dataset.scene = 'pixel';
  root.innerHTML =
    '<div class="of-stage"><canvas></canvas></div><div class="of-layer"></div>' +
    '<div class="of-hud"><div class="of-sum"></div></div>' +
    '<div class="of-ctl">' +
    `<button type="button" data-z="in" title="${esc(msg('of.zoomIn'))}">+</button>` +
    `<button type="button" data-z="out" title="${esc(msg('of.zoomOut'))}">−</button>` +
    `<button type="button" data-z="fit" title="${esc(msg('of.fit'))}">${FIT_ICON}</button></div>` +
    '<div class="of-empty" hidden></div>';
  const stage = root.querySelector('.of-stage'), canvas = stage.querySelector('canvas');
  const layer = root.querySelector('.of-layer'), sumEl = root.querySelector('.of-sum'), emptyEl = root.querySelector('.of-empty');
  const g = canvas.getContext('2d', { alpha: false });
  const labels = createLabelLayer(layer);

  let atlas = null, scene = null, visible = false, loadFailed = false;
  let layout = null, layoutSig = '', lastItems = [];
  const view = { zoom: 2, panX: 0, panY: 0, w: 1, h: 1, dpr: 1 };
  let autoFit = true, labelsDirty = true, lastBuildMs = 0;
  const frameTimes = [];                      // JS ms of the last frames (QA reads the 95th percentile)
  const order = new Map();                    // main id -> first-seen sequence (rooms keep their order)
  const roomState = new Map();                // main id -> { cls, low }
  const seats = new Map();                    // sub id -> { roomId, slot, doneAt }
  let expiry = 0, hoverId = null, seq = 0;

  // ---------------------------------------------------------- scheduler
  const sched = createScheduler({
    draw(t, anim) {
      if (!scene) return;
      const t0 = performance.now();
      scene.draw(g, view, t, anim);
      if (labelsDirty) { labelsDirty = false; placeLabelsNow(); }
      frameTimes.push(performance.now() - t0);
      if (frameTimes.length > 400) frameTimes.shift();
    },
    isHidden: () => document.hidden || !visible,
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  document.addEventListener('visibilitychange', () => sched.wake());
  const redraw = (withLabels = true) => { if (withLabels) labelsDirty = true; sched.requestFrame(); };

  // ---------------------------------------------------------- store -> rooms and seats
  function mains() {
    const list = store.mains();
    for (const a of [...list].sort((p, q) => (p.started || 0) - (q.started || 0) || (p.id < q.id ? -1 : 1))) if (!order.has(a.id)) order.set(a.id, seq++);
    for (const id of order.keys()) if (!list.some(a => a.id === id)) order.delete(id);
    return list.sort((p, q) => order.get(p.id) - order.get(q.id));
  }

  function syncRooms() {
    const list = mains();
    const nowMs = performance.now();
    const items = [];
    for (const m of list) {
      let st = roomState.get(m.id);
      if (!st) roomState.set(m.id, st = { cls: null, low: 0 });
      let have = 0;
      for (const s of seats.values()) if (s.roomId === m.id) have++;
      let queued = 0;
      for (const s of store.subsOf(m.id)) if (s.status === 'working' && !seats.has(s.id)) queued++;
      const demand = have + queued;
      const want = demand <= 3 ? 0 : demand <= 6 ? 1 : 2;
      if (st.cls == null || want > st.cls) { st.cls = want; st.low = 0; }
      else if (want < st.cls) {
        if (!st.low) st.low = nowMs;
        if (nowMs - st.low > 60e3 && have <= roomCap(want)) { st.cls = want; st.low = 0; }
      } else st.low = 0;
      items.push({ id: m.id, cls: st.cls, project: m.project, color: m.color });
    }
    for (const id of roomState.keys()) if (!list.some(m => m.id === id)) roomState.delete(id);
    const sig = items.map(i => `${i.id}:${i.cls}:${i.color}`).join('|');
    if (sig !== layoutSig || !layout) {
      layoutSig = sig;
      lastItems = items;
      const t0 = performance.now();
      layout = layoutOffice(items);
      scene.setLayout(layout);
      lastBuildMs = performance.now() - t0;
      if (autoFit) fit(false);
      else clampView();
    }
  }

  function syncSeats() {
    const nowMs = performance.now();
    const rooms = new Map(layout.rooms.map(r => [r.id, r]));
    for (const [id, s] of [...seats]) {                                     // gone, or the room shrank below the seat
      const room = rooms.get(s.roomId), a = store.agents.get(id);
      if (!room || !a || s.slot > room.cap) seats.delete(id);
    }
    let anyDone = 0;
    for (const room of layout.rooms) {
      const taken = new Set([...seats.values()].filter(s => s.roomId === room.id).map(s => s.slot));
      let overflow = 0;
      for (const sub of store.subsOf(room.id)) {
        let seat = seats.get(sub.id);
        if (!seat) {
          if (sub.status !== 'working') continue;
          let slot = 1;
          while (slot <= room.cap && taken.has(slot)) slot++;
          if (slot > room.cap) { overflow++; continue; }
          seats.set(sub.id, seat = { roomId: room.id, slot, doneAt: 0 });
          taken.add(slot);
        }
        if (sub.status === 'working') seat.doneAt = 0;
        else if (!seat.doneAt) seat.doneAt = nowMs;
        if (seat.doneAt) {
          if (nowMs - seat.doneAt > DONE_MS) { seats.delete(sub.id); taken.delete(seat.slot); } else anyDone = Math.max(anyDone, DONE_MS - (nowMs - seat.doneAt));
        }
      }
      room.overflow = overflow;
    }
    clearTimeout(expiry);
    if (anyDone) expiry = setTimeout(sync, anyDone + 60);

    const actors = [];
    for (const room of layout.rooms) {
      const m = store.agents.get(room.id);
      if (!m) continue;
      actors.push({ roomId: room.id, slot: 0, id: room.id, main: true, status: m.status, ap: hashStr(room.id) % APPEARANCES });
    }
    for (const [id, s] of seats) {
      const a = store.agents.get(id);
      if (a) actors.push({ roomId: s.roomId, slot: s.slot, id, main: false, status: a.status, ap: hashStr(id) % APPEARANCES });
    }
    scene.setActors(actors);
    sched.setActive('typing', actors.some(a => a.status === 'working'));
    sched.setActive('attention', actors.some(a => a.main && (a.status === 'waiting' || a.status === 'ask')));
  }

  // ---------------------------------------------------------- labels
  function mainLabel(room, a) {
    const wait = a.status === 'waiting' || a.status === 'ask';
    const chip = wait ? `<span class="of-chip w">${esc(msg(a.status === 'ask' ? 'of.chipAsk' : 'of.chipWait'))} · <span data-since="${a.since}" data-fmt="short">${fmtShort(store.now() - a.since)}</span></span>` : '';
    const more = room.overflow ? `<span class="of-chip">+${room.overflow}</span>` : '';
    const doing = a.status === 'working' && a.doing ? `<span class="px-doing">${esc(a.doing.n)} · ${esc(clipTxt(a.doing.l, 46))}</span>` : '';
    const say = a.say ? `<span class="px-say ${a.say.dir}">${a.say.dir === 'in' ? '← ' : '→ '}${esc(clipTxt(a.say.text, 56))}</span>` : '';
    const name = a.name || a.title || a.project;
    return `<div class="px-top"><span class="sw" style="background:${esc(a.color)}"></span><span class="px-proj">${esc(a.project)}</span>${chip}${more}</div>` +
      `<div class="px-name">${esc(name)}</div>${doing}${say}`;
  }
  function updateLabels() {
    const live = new Set();
    for (const room of layout.rooms) {
      const a = store.agents.get(room.id);
      if (!a) continue;
      live.add(room.id);
      labels.set(room.id, mainLabel(room, a), `px-main ${a.status}`, { room, main: true, wait: a.status === 'waiting' || a.status === 'ask' });
    }
    for (const [id, s] of seats) {
      const a = store.agents.get(id), room = layout.rooms.find(r => r.id === s.roomId);
      if (!a || !room) continue;
      live.add(id);
      labels.set(id, `<span class="sw" style="background:${esc(a.color)}"></span>${esc(shortDesc(a))}`, `px-sub ${a.status}`, { room, slot: s.slot, main: false });
    }
    for (const id of labels.ids()) if (!live.has(id)) labels.drop(id);
    labelsDirty = true;
  }
  function placeLabelsNow() {
    if (!scene || !layout) return;
    const { zoom, panX, panY, dpr } = view, vw = view.w / dpr, vh = view.h / dpr;
    const items = [], by = new Map();
    for (const id of labels.ids()) {
      const L = labels.get(id), ex = L.extra;
      if (!ex) continue;
      let vx, vy;
      if (ex.main) [vx, vy] = scene.toVirtual(ex.room.label.x, ex.room.label.y, ex.room.label.z);
      else {
        if (zoom < 3) { labels.hide(L); continue; }
        const slot = ex.room.slots[ex.slot], box = slot.seat;
        [vx, vy] = scene.toVirtual(box.x + box.w / 2, box.y + box.d / 2, 46);
      }
      const ax = (vx * zoom + panX) / dpr, ay = (vy * zoom + panY) / dpr;
      if (ax < -200 || ax > vw + 200 || ay < -200 || ay > vh + 200) { labels.hide(L); continue; }
      labels.measure(L);
      items.push({ id, ax, ay, w: L.w, h: L.h, pri: ex.main ? (ex.wait ? 120 : 100) : 10, force: ex.main });
      by.set(id, L);
    }
    // the figures are obstacles: a label may not hide an agent (at least 24 x 24 px around its centre, the click target)
    const obstacles = [];
    for (const id of scene.figureIds()) {
      const f = scene.figureInfo(id);
      if (!f) continue;
      const w = Math.max(f.w * zoom / dpr, MIN_TARGET), h = Math.max(f.h * zoom / dpr, MIN_TARGET);
      obstacles.push({ x: (f.cx * zoom + panX) / dpr - w / 2, y: (f.cy * zoom + panY) / dpr - h / 2, w, h });
    }
    const res = placeLabels(items, vw, vh, 6, 3, obstacles);
    for (const [id, L] of by) {
      const p = res.get(id);
      if (p && (p.ok || L.extra.main)) labels.show(L, p.x, p.y); else labels.hide(L);
    }
  }

  // ---------------------------------------------------------- summary
  function renderSum() {
    const c = ctx.counts();
    const n = layout ? layout.rooms.length : 0;
    const people = c.working + c.subs;
    sumEl.innerHTML = `<span>${msg('of.rooms', { n, b: `<b>${n}</b>` })}</span><span class="sep">·</span><span>${msg('of.working', { n: people, b: `<b>${people}</b>` })}</span><span class="sep">·</span>` +
      (c.waiting ? `<span class="w">${msg('of.waiting', { n: c.waiting, b: `<b>${c.waiting}</b>` })}</span>` : `<span>${esc(msg('of.nobody'))}</span>`);
    if (loadFailed) { emptyEl.hidden = false; emptyEl.textContent = msg('of.noAtlas'); return; }
    emptyEl.hidden = !store.ready || n > 0;
    if (store.ready && !n) emptyEl.textContent = msg('of.empty');
  }

  // ---------------------------------------------------------- camera
  function clampView() {
    if (!scene) return;
    [view.panX, view.panY] = clampPan([view.panX, view.panY], scene.bounds, view.zoom, view.w, view.h);
  }
  function fit(draw = true) {
    if (!scene || !scene.layout) return;
    const b = scene.fitBox;
    view.zoom = fitZoom(b.x1 - b.x0, b.y1 - b.y0, view.w, view.h, 6 * view.dpr);
    [view.panX, view.panY] = centerPan(b, view.zoom, view.w, view.h);
    if (draw) redraw();
  }
  function setZoom(z, px, py) {
    if (z === view.zoom) return;
    [view.panX, view.panY] = zoomAbout([view.panX, view.panY], view.zoom, z, px, py);
    view.zoom = z;
    autoFit = false;
    clampView();
    redraw();
  }
  function resize() {
    const r = root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w === view.w && h === view.h && dpr === view.dpr) return;
    view.w = w; view.h = h; view.dpr = dpr;
    canvas.width = w; canvas.height = h;
    if (autoFit) fit(false); else clampView();
    redraw();
  }
  new ResizeObserver(() => { if (visible) resize(); }).observe(root);

  // ---------------------------------------------------------- picking, hover, click
  const toVirtual = (cx, cy) => [(cx * view.dpr - view.panX) / view.zoom, (cy * view.dpr - view.panY) / view.zoom];
  function pickAt(cx, cy) {
    if (!scene || !layout) return null;
    const [vx, vy] = toVirtual(cx, cy);
    const hit = scene.pick(vx, vy, (MIN_TARGET / 2) * view.dpr / view.zoom);
    if (hit) return { t: 'agent', id: hit.id };
    const room = scene.roomAt(vx, vy);
    return room ? { t: 'room', id: room } : null;
  }
  function tipHtml(a) {
    const t = store.now();
    const head = a.kind === 'main'
      ? `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.project)}<span class="of-tn">${esc(a.name || '')}</span></div>${a.title ? `<div class="m">${esc(a.title)}</div>` : ''}`
      : `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.desc || a.atype || msg('agent.sub'))}</div><div class="m">${esc(a.project)} · ${esc(msg('of.subTip'))}${a.atype ? ' · ' + esc(a.atype) : ''}</div>`;
    return `<div class="of-tip">${head}<div class="of-tp">${ctx.statusPill(a, t)}</div>${ctx.activityHtml(a, t)}</div>`;
  }
  function setHover(id) {
    if (id === hoverId) return;
    hoverId = id;
    scene.setHover(id);
    redraw(false);
  }
  function clearHover() { ctx.tip.hide(); stage.classList.remove('hover'); if (scene && hoverId) setHover(null); }
  function hoverAt(e) {
    const r = root.getBoundingClientRect();
    const lab = e.target && e.target.closest ? e.target.closest('.px-l[data-id]') : null;
    let h = null;
    if (lab && root.contains(lab)) h = { t: 'agent', id: lab.dataset.id };
    else h = pickAt(e.clientX - r.left, e.clientY - r.top);
    stage.classList.toggle('hover', !!h);
    const a = h && h.t === 'agent' && store.agents.get(h.id);
    if (a) { ctx.tip.show(tipHtml(a), e.clientX, e.clientY); setHover(h.id); }
    else { ctx.tip.hide(); setHover(null); }
  }

  const ptrs = new Map();
  let drag = null, pinch = null, clickTimer = 0, wheelAcc = 0;
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.of-ctl')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, target: e.target };
    else if (ptrs.size === 2) {
      const [p1, p2] = [...ptrs.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z: view.zoom, done: false };
      if (drag) drag.moved = true;
    }
    try { root.setPointerCapture(e.pointerId); } catch { /* unavailable */ }
  });
  root.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [p1, p2] = [...ptrs.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, r = root.getBoundingClientRect();
      if (!pinch.done && (d / pinch.d > 1.3 || d / pinch.d < 0.77)) {
        pinch.done = true;
        setZoom(stepZoom(view.zoom, d > pinch.d ? 1 : -1), ((p1.x + p2.x) / 2 - r.left) * view.dpr, ((p1.y + p2.y) / 2 - r.top) * view.dpr);
      }
      return;
    }
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { drag.moved = true; stage.classList.add('drag'); ctx.tip.hide(); clearHover(); }
      if (drag.moved) {
        view.panX += Math.round((e.clientX - drag.lx) * view.dpr); view.panY += Math.round((e.clientY - drag.ly) * view.dpr);
        drag.lx = e.clientX; drag.ly = e.clientY;
        autoFit = false;
        clampView();
        redraw();
      }
      return;
    }
    if (e.pointerType === 'mouse') hoverAt(e);
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) {
      const d = drag;
      drag = null;
      stage.classList.remove('drag');
      if (!d.moved && e.type === 'pointerup') click(e, d.target);
    }
  };
  root.addEventListener('pointerup', endPtr);
  root.addEventListener('pointercancel', endPtr);
  root.addEventListener('pointerleave', () => { if (!drag) clearHover(); });

  function click(e, target) {
    const lab = target && target.closest ? target.closest('.px-l[data-id]') : null;
    if (lab && root.contains(lab)) { ctx.tip.hide(); ctx.openDrawer(lab.dataset.id); return; }
    const r = root.getBoundingClientRect();
    const h = pickAt(e.clientX - r.left, e.clientY - r.top);
    if (!h) return;
    if (h.t === 'agent') { ctx.tip.hide(); ctx.openDrawer(h.id); return; }
    // a single click on empty floor opens the main agent of the room; wait briefly so a double click can reset the view instead
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { ctx.tip.hide(); ctx.openDrawer(h.id); }, 240);
  }
  root.addEventListener('dblclick', e => {
    if (e.target.closest('.of-ctl')) return;
    clearTimeout(clickTimer);
    autoFit = true;
    fit();
  });
  root.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    ctx.tip.hide();
    if (Math.abs(wheelAcc) < 60) return;
    const dir = wheelAcc < 0 ? 1 : -1;
    wheelAcc = 0;
    const r = root.getBoundingClientRect();
    setZoom(stepZoom(view.zoom, dir), (e.clientX - r.left) * view.dpr, (e.clientY - r.top) * view.dpr);
  }, { passive: false });
  root.querySelector('.of-ctl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z === 'fit') { autoFit = true; fit(); }
    else setZoom(stepZoom(view.zoom, b.dataset.z === 'in' ? 1 : -1), view.w / 2, view.h / 2);
  });

  // ---------------------------------------------------------- sync
  let errLogged = false, frozen = false;
  function sync() {
    if (frozen) return;
    try {
      if (!scene) { renderSum(); return; }
      if (!store.ready) { renderSum(); return; }
      syncRooms();
      syncSeats();
      updateLabels();
      renderSum();
      redraw();
    } catch (err) {
      if (!errLogged) { errLogged = true; root.dataset.error = String((err && err.message) || err); console.error('Office (pixel):', err); }
    }
  }

  loadAtlas(proj.name).then(a => {
    atlas = a;
    scene = createScene({ atlas, proj });
    if (visible) { resize(); sync(); }
  }).catch(err => { loadFailed = true; console.error('Office (pixel): atlas', err); renderSum(); });

  // read-only state for verification: document.querySelector('#view-ofis').__pixel
  root.__pixel = {
    get zoom() { return view.zoom; }, get dpr() { return view.dpr; }, get size() { return [view.w, view.h]; }, get autoFit() { return autoFit; },
    get pan() { return [view.panX, view.panY]; }, get proj() { return proj.name; }, get buildMs() { return +lastBuildMs.toFixed(2); },
    get stats() { return { ...sched.stats }; }, resetStats() { sched.resetStats(); frameTimes.length = 0; },
    get active() { return sched.activeSources; }, get pending() { return sched.pending; },
    get counts() { return scene ? scene.counts : null; },
    get effects() { return scene ? scene.effects : null; },
    get layout() { return layout; },
    frameP95() { if (!frameTimes.length) return 0; const s = [...frameTimes].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(3); },
    get frames() { return frameTimes.length; },
    figures() { return scene ? scene.figureIds() : []; },
    agentCss(id) {
      const f = scene && scene.figureInfo(id);
      if (!f) return null;
      return { x: (f.cx * view.zoom + view.panX) / view.dpr, y: (f.cy * view.zoom + view.panY) / view.dpr, w: f.w * view.zoom / view.dpr, h: f.h * view.zoom / view.dpr, main: f.main, status: f.status, sprite: f.sprite };
    },
    labelRects() {
      const base = root.getBoundingClientRect(), out = [];
      for (const id of labels.ids()) {
        const L = labels.get(id), r = L.el.getBoundingClientRect(), nm = L.el.querySelector('.px-name');
        out.push({ id, main: !!(L.extra && L.extra.main), shown: L.shown, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, name: nm ? nm.textContent : null, text: L.el.textContent });
      }
      return out;
    },
    pickAt(cx, cy) { return pickAt(cx, cy); },
    occlusion(id) { return scene ? scene.occlusion(id) : null; },
    occlusionInfo(id) { return scene ? scene.occlusionInfo(id) : null; },
    setZoom(z) { setZoom(z, view.w / 2, view.h / 2); }, fit() { autoFit = true; fit(); },
    redraw() { redraw(); },
    // QA only: hold the scene still (no data sync, so labels and figures stay where they are) while a test clicks around
    freeze(on) { frozen = !!on; if (!on) sync(); },
    // rebuild the layout and the static layer from scratch and return the time it took (QA)
    rebuild() { const t0 = performance.now(); layout = layoutOffice(lastItems); scene.setLayout(layout); return +(performance.now() - t0).toFixed(2); },
  };

  return {
    show() {
      visible = true;
      resize();
      sync();
      sched.wake();
    },
    hide() {
      visible = false;
      clearTimeout(clickTimer);
      clearTimeout(expiry);
      ctx.tip.hide();
    },
    update() { if (visible) sync(); },
  };
}
