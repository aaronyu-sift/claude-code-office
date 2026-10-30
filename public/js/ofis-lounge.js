// The lounge of the 3D office: an open pavilion on the plaza in the hub of the X, with a freestanding message wall and the agents that talk, fed by the server's read-only chat
// bridge (GET /api/lounge, or the built-in demo with ?lounge=demo). The pure parts are lounge-plan.js (where everything stands), lounge-model.js (what the wall, the people and
// the signs say), lounge-paint.js (the picture on the wall), lounge-source.js (the poll) and lounge-card.js (the card); this file puts them into the scene of ofis.js.
//
//   const lounge = createLounge(host)
//   lounge.build({ g, B, c, rng })   in every rebuild of the building, where the old round bed of the plaza was: the pavilion goes into the building's one batch `B` (no draw call of its
//                                    own, and the occlusion baked into the batch reaches it), the wall's face and the strip of light are two meshes, then the pick boxes; the lights of
//                                    its lamps and candles go through ofis-decor.js. The face of the wall is drawn only while the board has something to say (see `boardShown`)
//   lounge.step(dt, T)               every frame: the poll's conditions, the view, the wall's picture, the pulse, the people
//   lounge.touch()                   the Office's chats changed: the people are tied to them again
//   lounge.show() / hide()           the Office view is shown or hidden (the poll runs only while it is shown, the tab is visible and the lounge is on the screen)
//   lounge.click(pick) / hover(pick) / openCard(from) / closeCard() / tipHtml(key) / people() / snapshot() / setVisible(on)
//
// host: { scene, camera, root, area, store, settings, decor, KIT, size() -> [w, h], project(x, y, z) -> [px, py] in the scene's box, bounds() -> the card's bounds,
//         hitBox(g, x, y, z, w, h, d), mkLabel, setLabel, dropLabel, person: { make(id, shirt), anim(c, dt, T), remove(c) },
//         sessionInfo(id), openAgent(id), closeAgentCard(), search, tex (shared textures) }
import * as THREE from 'three';
import { t as msg } from './i18n.js';
import { esc } from './util.js';
import { DUR, EASE, LOOP, SPRING, Spring, wave } from './motion.js';
import { LOUNGE_STYLE, loungePlan } from './lounge-plan.js';
import { buildView, normalizePayload, LIMITS } from './lounge-model.js';
import { paintWall, CANVAS, cubicBezier } from './lounge-paint.js';
import { createPoller, createDemoSource, fetchReader, sourceFromQuery, POLL_MS } from './lounge-source.js';
import { createLoungeCard } from './lounge-card.js';

const PLANKS = ['#b98a5c', '#c4966a', '#b08256'];
const ACCENT = { ok: new THREE.Color('#8fb0ff'), quiet: new THREE.Color('#8fb0ff'), off: new THREE.Color('#a9b3d6'), warn: new THREE.Color('#fab219') };
const TALK_MS = 20e3;                                      // someone who posted in the last 20 seconds talks with its hands
const VIEW_MS = 1000;                                      // the view (ages, who is in the lounge) is made again every second at the most
const easeOut = cubicBezier(EASE.out);

export function createLounge(host) {
  const { scene, store, decor, settings } = host;
  const src = sourceFromQuery(host.search != null ? host.search : (typeof location !== 'undefined' ? location.search : ''));
  const mode = () => { const m = settings && typeof settings.get === 'function' ? settings.get('lounge') : null; return m === 'names' || m === 'off' ? m : 'text'; };
  const reducedNow = () => !!(decor.follower && decor.follower.reduced);

  // ---- the data and the view
  let data = null, status = 'none', lastOkMs = null, view = null, viewAt = -1e9, dirty = true, visible = false, lastOn = false;
  const clockNow = () => (src.source === 'demo' ? Date.now() : store.now());
  const sessionIds = () => { try { return store.mains().map(a => a.id); } catch { return []; } };
  const read = src.source === 'demo' ? createDemoSource({ now: Date.now, sessions: sessionIds }) : fetchReader({ baseURI: typeof document !== 'undefined' ? document.baseURI : undefined });
  // an answer of the poll. A failed one (an error, a timeout, a reply that is not JSON) keeps the last good data and when it was: the view says "not answering" and dims old posts, it never says "off"
  function onData(res) {
    status = res.status;
    if (res.status === 'ok') { data = normalizePayload(res.payload); lastOkMs = clockNow(); }
    else if (res.status === 'nofile') { data = normalizePayload({ state: { state: 'off', reason: 'no endpoint' } }); lastOkMs = null; }
    dirty = true;
  }
  const poller = createPoller({ read, now: () => performance.now(), canPoll: () => canPoll(), onData });
  function makeView() {
    const pending = src.source === 'live' && status === 'none';                          // nothing has answered yet: a dark panel, not a sign that says "off"
    return buildView(data, { now: clockNow(), mode: pending ? 'off' : mode(), source: src.source, t: msg, sessionInfo: host.sessionInfo, status, lastOkMs });
  }

  // ---- where it stands
  let cell = null, plan = null, group = null, boardMesh = null, strip = null, built = { tris: 0, lights: 0, builds: 0 };
  const boardBox = () => {
    if (!cell) return null;
    const b = plan.board;
    return { x0: cell.X + b.cu - b.w / 2, x1: cell.X + b.cu + b.w / 2, y0: b.y0 - 0.08, y1: b.y0 + b.h + 0.08, z: cell.Z + b.cv };
  };
  // the wall on the screen, in the coordinates of the Office view (the card is placed there)
  function anchor() {
    const bb = boardBox();
    if (!bb) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [bb.x0, bb.x1]) for (const y of [bb.y0, bb.y1]) {
      const [px, py] = host.project(x, y, bb.z);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const a = host.area.getBoundingClientRect(), r = host.root.getBoundingClientRect();
    return { x: a.left - r.left + x0, y: a.top - r.top + y0, w: x1 - x0, h: y1 - y0, kind: 'scene' };
  }
  const onScreen = () => {
    const bb = boardBox();
    if (!bb) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const [vw, vh] = host.size();
    for (const x of [bb.x0, bb.x1]) for (const y of [bb.y0, bb.y1]) { const [px, py] = host.project(x, y, bb.z); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    return x1 > 0 && x0 < vw && y1 > 0 && y0 < vh;
  };
  function canPoll() {
    return visible && !(typeof document !== 'undefined' && document.hidden) && mode() !== 'off' && onScreen();
  }

  // ---- the card
  const card = createLoungeCard({ root: host.root, msg, anchor, bounds: () => host.bounds(), onOpen: () => host.closeAgentCard() });

  // ---- the wall: one canvas, one texture, painted again only when the view says its picture changed
  const cv = Object.assign(document.createElement('canvas'), { width: CANVAS.w, height: CANVAS.h });
  cv.__lounge = true;                                                                    // QA: the wall's canvas
  const g2d = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = host.anisotropy || 4;
  const boardMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
  const stripTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 64;
    const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 8, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const stripMat = new THREE.MeshBasicMaterial({ map: stripTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const painted = { key: '', seqs: new Set(), texts: [], scale: 1, rows: [], count: 0, anim: null, night: -1 };
  let pulse = 0;
  function paint(progress = 1, added = null) {
    const night = decor.follower ? decor.follower.k : 0;
    const out = paintWall(g2d, view, { progress, added, night });
    tex.needsUpdate = true;
    painted.texts = out.texts; painted.scale = out.scale; painted.rows = out.rows; painted.count++; painted.night = night;
    return out;
  }
  function updateWall(T) {
    const night = decor.follower ? decor.follower.k : 0;
    if (view.key !== painted.key) {
      const rows = view.wall.rows, first = painted.key === '';
      const added = !first && !reducedNow() && view.state === 'ok' ? new Set(rows.filter(r => !painted.seqs.has(r.seq) && r.seq != null).map(r => r.seq)) : new Set();
      painted.key = view.key; painted.seqs = new Set(rows.map(r => r.seq));
      if (added.size) painted.anim = { t0: T, added }; else { painted.anim = null; paint(1, null); return; }
    }
    if (painted.anim) {
      const p = Math.min(1, ((T - painted.anim.t0) * 1000) / DUR.slow);
      paint(easeOut(p), painted.anim.added);
      if (p >= 1) { painted.anim = null; paint(1, null); }
    } else if (Math.abs(night - painted.night) > 0.02) paint(1, null);                   // the panel is a little brighter at night
  }

  // ---- the people
  const folk = new Map();                                                                 // key -> { key, c, seat, pop (Spring), label, out, name, session }
  const peopleList = () => [...folk.values()];
  function freeSeat() {
    const used = new Set(peopleList().map(p => p.seatId));
    return plan.seats.find(s => !used.has(s.id)) || null;
  }
  function addPerson(p) {
    const seat = freeSeat();
    if (!seat) return;
    const c = host.person.make('lounge:' + p.key, /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#7d8597');
    c.mode = seat.pose === 'sit' ? 'seated' : 'stand';
    c.sit = c.mode === 'seated' ? 1 : 0;
    c.heading = c.th = seat.ry;
    c.force = { pose: 'idle', th: seat.ry, scale: 0.001, still: false };
    c.hit.userData.pick = { t: 'lounger', key: p.key };
    const label = host.mkLabel('of-lpl', 36, 'down', 2, 20);
    const P = { key: p.key, c, seatId: seat.id, pop: new Spring(SPRING.build, 0).to(1), label, out: false, name: p.name, session: p.session, color: p.color };
    if (reducedNow()) P.pop.jump(1);
    folk.set(p.key, P);
  }
  function syncPeople() {
    const want = new Map(view.people.map(p => [p.key, p]));
    for (const [k, P] of folk) if (!want.has(k) && !P.out) { P.out = true; P.pop.to(0); }
    for (const p of view.people) {
      const P = folk.get(p.key);
      if (!P) addPerson(p);
      else if (P.out) { P.out = false; P.pop.to(1); }
      if (P) { P.name = p.name; P.session = p.session; P.seenMs = p.seenMs; P.sessionName = p.sessionName; }
    }
  }
  function stepPeople(dt, T) {
    for (const [k, P] of [...folk]) {
      const c = P.c;
      if (reducedNow()) P.pop.jump(P.out ? 0 : 1); else P.pop.step(dt);
      const s = P.pop.value;
      if (P.out && s < 0.03) { host.person.remove(c); host.dropLabel(P.label); folk.delete(k); continue; }
      const seat = plan.seats.find(x => x.id === P.seatId) || plan.seats[0];            // by name: a cell of another width has its own plan
      c.root.position.set(cell.X + seat.u, plan.deck.h + seat.lift, cell.Z + seat.v);
      c.force.scale = Math.max(0.001, Math.min(1.15, s));
      c.force.still = reducedNow();
      c.force.pose = P.seenMs != null && P.seenMs < TALK_MS ? 'talk' : 'idle';
      c.force.th = seat.ry;
      host.person.anim(c, dt, T);
      P.label.want = mode() !== 'off' && !P.out && s > 0.9;
      P.label.pos.set(c.root.position.x, 0, c.root.position.z);
      host.setLabel(P.label, `<div class="of-lp"><i style="background:${esc(P.color)}"></i>${esc(P.name)}</div>`);
      P.label.el.dataset.lounger = P.key;
    }
  }

  // ---- the sign over the wall: the way to the card from the keyboard, and the line that says what the board is doing
  let sign = null, signHtml = '';
  function updateSign() {
    if (!cell) return;
    if (!sign) {
      sign = host.mkLabel('of-loungel', 86, 'up', 4, 0);
      sign.el.dataset.lounge = '1';
      sign.el.tabIndex = 0;
      sign.el.setAttribute('role', 'button');
      sign.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openCard(sign.el); } });
    }
    const b = plan.board, show = mode() !== 'off';
    sign.want = show;
    sign.pos.set(cell.X + b.cu, b.y0 + b.h + 0.34, cell.Z + b.cv);
    // the sign is the one surface that is readable at every zoom (the wall's own text needs about four times the fit zoom): it carries the newest post when there is one
    const line = view.sign.latest || view.sign.text;
    const html = `<div class="of-lsign ${esc(view.sign.tone)}"><i></i><b>${esc(view.sign.title)}</b><span>${esc(line)}</span></div>`;
    if (html !== signHtml) { signHtml = html; host.setLabel(sign, html); sign.el.setAttribute('aria-label', `${view.sign.title}: ${line}. ${msg('lounge.open')}`); sign.el.title = msg('lounge.open'); }
  }

  // ---- the strip of light under the wall: the ambient pulse of the posts of the last minute
  function stepPulse(T) {
    const night = decor.follower ? decor.follower.k : 0;
    const on = view.state === 'ok' || view.state === 'unsupported' || view.state === 'failed';
    const base = view.state === 'ok' ? (view.quiet ? 0.08 : 0.16) : view.state === 'unsupported' || view.state === 'failed' ? 0.12 : 0;
    const level = view.state === 'ok' ? view.activity.level : 0;
    const amp = level * 0.55;
    const v = on ? base + (reducedNow() ? amp : amp * (0.62 + 0.38 * wave(T * 1000, LOOP.slow))) : 0;
    pulse = v * (1 + 0.6 * night);
    if (strip) {
      const col = ACCENT[view.sign.tone] || ACCENT.ok;
      stripMat.color.copy(col).multiplyScalar(pulse);
      strip.visible = pulse > 0.003 && visibleParts;
    }
  }

  // the face of the wall is drawn only while the board has something to show: posts, a quiet board, an unsupported one, or one that does not answer. A board that is off (no endpoint, no
  // --chat-db, the setting off, or nothing has answered yet) keeps its dark frame, which is in the batch, and says so in the sign over it and in the card: a lounge with nothing to say
  // adds no draw call to the building
  const boardShown = () => !!view && (view.state === 'ok' || view.state === 'unsupported' || view.state === 'failed');

  // ---- the build
  let visibleParts = true, parts = [];                                                  // parts: everything the lounge added to the building group (not the invisible boxes that are clicked)
  function build({ g, B, c, rng }) {
    const first = g.children.length, t0 = B.i.length / 3;
    cell = c; plan = loungePlan(c.W, c.D);
    const { deck, board: b } = plan, X = c.X, Z = c.Z;
    // the deck: planks of three tones on a dark base, with a low lip all round
    const dw = deck.u1 - deck.u0, dd = deck.v1 - deck.v0, dcx = X + (deck.u0 + deck.u1) / 2, dcz = Z + (deck.v0 + deck.v1) / 2;
    B.box(dcx, 0.00675, dcz, dw, 0.0135, dd, '#7a5535');
    const n = Math.max(2, Math.round(dd / 0.32)), pw = dd / n;
    for (let k = 0; k < n; k++) B.box(dcx, deck.h / 2, Z + deck.v0 + pw * (k + 0.5), dw, deck.h, pw - 0.014, PLANKS[(k * 7 + (k >> 1)) % PLANKS.length]);
    for (const s of [0, 1]) {
      B.box(dcx, 0.02, Z + (s ? deck.v1 : deck.v0), dw + 0.1, 0.04, 0.06, '#6d4c33');
      B.box(X + (s ? deck.u1 : deck.u0), 0.02, dcz, 0.06, 0.04, dd + 0.1, '#6d4c33');
    }
    // the wall: a dark frame, two posts with a beam and caps, feet
    const bx = X + b.cu, bz = Z + b.cv, top = b.y0 + b.h;
    B.box(bx, b.y0 + b.h / 2, bz, b.w + 0.16, b.h + 0.16, b.t, '#262b38');
    for (const s of [-1, 1]) {
      const px = bx + s * (b.w / 2 + 0.22);
      B.box(px, (top + 0.3) / 2, bz, 0.16, top + 0.3, 0.22, '#6d4c33');
      B.box(px, top + 0.32, bz, 0.26, 0.05, 0.3, '#4f3724');
      B.box(px, 0.04, bz, 0.42, 0.05, 0.52, '#4a505d');
    }
    B.box(bx, top + 0.2, bz, b.w + 0.7, 0.07, 0.14, '#6d4c33');
    decor.furnish({ B, kit: host.KIT, X, Z, W: c.W, D: c.D, plan: { items: plan.items, lights: plan.lights, windows: [] }, style: LOUNGE_STYLE, theme: { wall: '#cdd1d8', floor: '#9aa5b3' }, color: null, rng, top: 0.75, roomId: 'lounge' });
    const tris = B.i.length / 3 - t0;                                                     // what the pavilion put into the building's batch
    // the face of the wall, and the strip of light under it
    boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), boardMat);
    boardMesh.position.set(bx, b.y0 + b.h / 2, bz + b.t / 2 + 0.004);
    boardMesh.userData.own = true;
    g.add(boardMesh);
    strip = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 0.9, 0.34), stripMat);
    strip.position.set(bx, 0.27, bz + b.t / 2 + 0.03);
    strip.renderOrder = 6; strip.userData.own = true; strip.frustumCulled = false;
    g.add(strip);
    // what a click or a hover hits: the wall and the deck
    host.hitBox(g, bx, b.y0 + b.h / 2, bz + 0.1, b.w + 0.5, b.h + 0.3, 0.7).userData.pick = { t: 'lounge' };
    host.hitBox(g, dcx, 0.03, dcz, dw, 0.06, dd).userData.pick = { t: 'lounge' };
    parts = g.children.slice(first).filter(m => !m.userData.pick);
    for (const m of parts) if (m !== strip && m !== boardMesh) m.visible = visibleParts;
    group = g;
    built = { tris: tris + 4 + plan.lights.reduce((s, l) => s + 80 + 2 + (l.pool > 0 ? 2 : 0), 0), staticTris: tris, lights: plan.lights.length, builds: built.builds + 1 };
    painted.key = ''; painted.anim = null; sign = sign && sign.el.isConnected ? sign : null; signHtml = '';
    dirty = true;
    return { tris: built.tris };
  }

  // ---- every frame
  function step(dt, T) {
    if (!cell) return;
    const t = performance.now();
    if (!view || dirty || t - viewAt > VIEW_MS) { viewAt = t; dirty = false; view = makeView(); syncPeople(); if (card.isOpen) card.update(view); updateSign(); }
    const on = canPoll();
    if (on !== lastOn) { lastOn = on; poller.kick(); }
    updateWall(T);
    stepPulse(T);
    if (boardMesh) boardMesh.visible = visibleParts && boardShown();
    stepPeople(dt, T);
    card.place();
  }

  // ---- the card and the clicks
  function openCard(from = null) {
    if (!cell) return false;
    if (!view) view = makeView();
    return card.open(view, from);
  }
  const closeCard = () => card.close();
  function click(h) {
    if (h.t === 'lounger') {
      const P = folk.get(h.key);
      if (P && P.session) { host.openAgent(P.session); return true; }
    }
    return openCard(null);
  }
  function tipHtml(key) {
    const P = folk.get(key);
    if (!P) return '';
    const where = P.session ? msg('lounge.person', { name: P.name, chat: P.sessionName || P.session }) : '';
    return `<div class="of-tip"><div class="h"><span class="sq" style="background:${esc(P.color)}"></span>${esc(P.name)}</div>${where ? `<div class="m">${esc(where)}</div>` : ''}</div>`;
  }
  const hoverPos = key => { const P = folk.get(key); return P ? P.c.root.position : null; };

  // ---- show, hide, settings
  if (settings && typeof settings.on === 'function') settings.on('lounge', () => { dirty = true; poller.kick(); if (mode() === 'off') card.close(); });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { poller.kick(); lastOn = canPoll(); });
  poller.start();

  function show() { visible = true; dirty = true; lastOn = canPoll(); poller.kick(); }
  function hide() { visible = false; card.close(); poller.kick(); lastOn = false; }
  // verification only: hide the lounge to measure it (everything, or only the people, or only the pavilion with its wall and strip)
  function setVisible(on, part) {
    const v = !!on;
    if (part !== 'people') { visibleParts = v; for (const m of parts) m.visible = v && (m === strip ? pulse > 0.003 : m === boardMesh ? boardShown() : true); }
    if (part !== 'building') for (const P of folk.values()) P.c.root.visible = v;
  }

  // ---- verification only
  // answer the poll by hand: the QA churns people through the lounge without waiting for the 3 second cadence (the same path as a real answer)
  const feed = payload => onData({ status: 'ok', http: 200, payload });
  // cheap (the snapshot reads the canvas back): is a post fading in, and how often the wall was painted
  const paintState = () => ({ animating: !!painted.anim, count: painted.count });

  // ---- verification only (root.__ofis3d.lounge): what the lounge shows and costs right now
  function inkCount() {
    const d = g2d.getImageData(0, 0, CANVAS.w, CANVAS.h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 || d[i + 1] > 150 || d[i + 2] > 150) n++;
    return n;
  }
  function snapshot() {
    return {
      mode: mode(), source: src.source, state: view ? view.state : null, status, sign: view ? view.sign : null, quiet: view ? view.quiet : null, stale: view ? view.stale : null,
      wall: view ? view.wall.rows.map(r => ({ seq: r.seq, chip: r.chip, who: r.who, lines: r.lines, age: r.age })) : [],
      people: peopleList().map(P => ({ key: P.key, name: P.name, session: P.session, seat: P.seatId, pose: P.c.force.pose, out: P.out, scale: +P.c.force.scale.toFixed(3), x: +P.c.root.position.x.toFixed(2), z: +P.c.root.position.z.toFixed(2), label: P.label.shown, labelText: P.label.el.textContent })),
      paint: { count: painted.count, texts: painted.texts, scale: painted.scale, rows: painted.rows.length, animating: !!painted.anim, key: painted.key },
      ink: inkCount(), canvas: { w: CANVAS.w, h: CANVAS.h },
      poll: { requests: poller.stats.requests, starts: [...poller.stats.starts], lastStatus: poller.stats.lastStatus, armed: poller.armed, inflight: poller.inflight, canPoll: canPoll(), pollMs: POLL_MS, why: { visible, hidden: typeof document !== 'undefined' && document.hidden, mode: mode(), onScreen: cell ? onScreen() : false } },
      boardVisible: !!(boardMesh && boardMesh.visible), activity: view ? view.activity : null, pulse: +pulse.toFixed(4), stripVisible: !!(strip && strip.visible), reduced: reducedNow(),
      card: card.read(), signLabel: sign ? { shown: sign.shown, want: sign.want, text: sign.el.textContent, tabIndex: sign.el.tabIndex, role: sign.el.getAttribute('role'), label: sign.el.getAttribute('aria-label') } : null,
      built, cell: cell ? { X: cell.X, Z: cell.Z, W: cell.W, D: cell.D } : null, onScreen: cell ? onScreen() : false, visibleParts,
      lights: plan ? plan.lights.length : 0, seats: plan ? plan.seats.length : 0, viewKey: view ? view.key : null, limits: LIMITS,
    };
  }

  return {
    build, step, show, hide, setVisible, snapshot, click, openCard, closeCard, tipHtml, hoverPos, feed, paintState,
    // the building has no hub cell (a layout without a lounge): nothing is drawn and nothing is polled
    clear() { if (!cell) return; cell = null; for (const [k, P] of [...folk]) { host.person.remove(P.c); host.dropLabel(P.label); folk.delete(k); } if (sign) sign.want = false; card.close(); poller.kick(); },
    touch() { dirty = true; },
    get cardOpen() { return card.isOpen; },
    get cardEl() { return card.el; },
    people: () => peopleList().map(P => P.c),
    peopleCount: () => folk.size,
    get polls() { return poller.stats; },
    get active() { return !!cell; },
  };
}
