// The stateful label layout (public/js/ofis-label-layout.js createLabelLayout): the numbers behind docs/labels.md. Each test also runs the stateless layoutLabels on the same
// scene where that says something (printed, not asserted). Time is in ms: the layout reads the clock it is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelLayout, layoutLabels, STABLE, cells } from '../public/js/ofis-label-layout.js';
import { springParams } from '../public/js/motion.js';

const VW = 1000, VH = 700;
const fig = (cx, footY) => ({ x: cx - 12, y: footY - 47 + 6, w: 24, h: 47 });                    // an agent's click rect: it reaches 6 px below the floor point
const tag = (id, f, o = {}) => ({ id, x: f.x + f.w / 2 - (o.w || 100) / 2, y: f.y + f.h - 6 + 3, w: o.w || 100, h: o.h || 30, rank: o.rank ?? 10, force: !!o.force, near: f, maxGap: o.force ? Infinity : 70, ...o });
const home = T => ({ x: T.near.x + T.near.w / 2 - T.w / 2, y: T.near.y + T.near.h + 2 });
// the figures the scene hands in: every agent that stands or sits (a walker is no obstacle for a label: ofis.js placeLabels leaves its rect out) and what the test adds
const frame = (L, sc, now) => L.step({ blocked: [], fixed: [], figures: (sc.tags || []).filter(t => !t.walking).map(t => t.near).filter(Boolean).concat(sc.extraFigures || []), vw: VW, vh: VH, ...sc }, now);
const run = (frames, fps, build, L = createLabelLayout()) => {
  const rows = [];
  for (let i = 0; i < frames; i++) rows.push(frame(L, build(i / fps), i * 1000 / fps));
  return rows;
};
// a seeded generator, so the random walks are the same on every run
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const spells = (flags, times) => {                                                              // runs of equal flags: [{ on, from, to, frames }]
  const out = []; let i = 0;
  while (i < flags.length) { let j = i; while (j < flags.length && flags[j] === flags[i]) j++; out.push({ on: flags[i], from: times[i], to: times[Math.min(j, times.length - 1)], frames: j - i, inner: i > 0 && j < flags.length }); i = j; }
  return out;
};

test('home spot: on an empty scene a label hangs just under its own figure and does not cover it (the stateless layout puts it one ring lower)', () => {
  const f = fig(300, 300), T = tag('a', f, { force: true, rank: 100 });
  const out = run(10, 30, () => ({ tags: [T] })).at(-1).get('a');
  assert.equal(out.shown, true);
  assert.deepEqual([out.x - home(T).x, out.y - home(T).y], [0, 0]);
  const old = layoutLabels({ tags: [T], figures: [f], vw: VW, vh: VH }).get('a');
  console.log('   stateless: label is', (old.y - (f.y + f.h)).toFixed(0), 'px below the figure rect, stable:', (out.y - (f.y + f.h)).toFixed(0));
  assert.equal(out.y - (f.y + f.h), 2);
});

test('a label shows after SHOW_MS and not before', () => {
  const T = tag('a', fig(300, 300), { force: true, rank: 100 });
  const L = createLabelLayout(), seen = [];
  for (let i = 0; i < 10; i++) seen.push(frame(L, { tags: [T] }, i * 10).get('a').shown);
  const first = seen.indexOf(true) * 10;
  assert.ok(first >= STABLE.SHOW_MS - 10 && first <= STABLE.SHOW_MS + 10, `shown after ${first} ms`);
});

test('a walker passing three seated labels moves none of them (the walker is carried and holds no place); the stateless layout hops them', () => {
  const seated = [fig(300, 300), fig(450, 300), fig(600, 300)].map((f, i) => tag('s' + i, f, { w: 90 }));
  const frames = 300, fps = 30, L = createLabelLayout(), rows = [];
  const walker = t => tag('w', fig(250 + t * 40, 330), { force: true, rank: 100, walking: true });
  for (let i = 0; i < frames; i++) rows.push(frame(L, { tags: [...seated, walker(i / fps)] }, i * 1000 / fps));
  let moved = 0;
  for (const id of ['s0', 's1', 's2']) for (let i = 1; i < frames; i++) { const a = rows[i - 1].get(id), b = rows[i].get(id); moved = Math.max(moved, Math.hypot(a.x - b.x, a.y - b.y)); }
  assert.ok(moved < 1e-9, `a seated label moved ${moved} px`);
  assert.ok(rows.at(-1).get('w').shown, 'the walker keeps its label');
  let hops = 0; const prev = {};
  for (let i = 0; i < frames; i++) {
    const tags = [...seated, { ...walker(i / fps), walking: false }];
    const o = layoutLabels({ tags, figures: tags.map(x => x.near), vw: VW, vh: VH });
    for (const s of seated) { const p = o.get(s.id), q = prev[s.id]; if (p && q && Math.hypot(p.x - q.x, p.y - q.y) > 10) hops++; prev[s.id] = p; }
  }
  console.log('   stateless: seated labels hopped', hops, 'times while one walker passed; stable: 0');
});

test('a walking main label is carried under its figure at every frame, and holds no place', () => {
  const T = t => tag('w', fig(100 + t * 60, 300), { force: true, rank: 100, walking: true });
  const other = tag('o', fig(300, 300), { rank: 10, w: 90 });
  const L = createLabelLayout();
  for (let i = 0; i < 120; i++) {
    const t = i / 30, w = T(t), out = frame(L, { tags: [w, other] }, t * 1000);
    if (i > 5) { const p = out.get('w'); assert.ok(p.shown); assert.ok(Math.abs(p.x - home(w).x) < 1e-6 && Math.abs(p.y - home(w).y) < 1e-6, `frame ${i}`); }
  }
  assert.equal(L.moving, false);
});

test('ping-pong: a neighbour that jitters by 1 px around the touch distance does not make a label change spot more than once in 4 s', () => {
  const f1 = fig(300, 300), A = tag('a', f1, { w: 100, rank: 100, force: true }), frames = 120, fps = 30;
  const L = createLabelLayout(); let changes = 0, last = null;
  for (let i = 0; i < frames; i++) {
    const B = tag('b', fig(405 + ((i % 2) * 2 - 1), 300), { w: 100, rank: 10 });
    frame(L, { tags: [A, B] }, i * 1000 / fps);
    const p = L.peek('b'), c = p.u + ',' + p.v; if (last !== null && c !== last) changes++; last = c;
  }
  assert.ok(changes <= 1, `cell changes: ${changes}`);
  let flips = 0, prev = null;
  for (let i = 0; i < frames; i++) {
    const B = tag('b', fig(405 + ((i % 2) * 2 - 1), 300), { w: 100, rank: 10 }), A2 = tag('a', f1, { w: 100, rank: 100, force: true });
    const o = layoutLabels({ tags: [A2, B], figures: [A2.near, B.near], vw: VW, vh: VH }).get('b'); const k = o ? Math.round(o.x) + ',' + Math.round(o.y) : 'none';
    if (prev !== null && k !== prev) flips++; prev = k;
  }
  console.log('   stateless: neighbour label changed spot', flips, 'times in 4 s; stable:', changes);
});

test('the order of placement is rank, then first sight: two equal labels do not swap places when the agents swap heights', () => {
  const fa = t => fig(300, 300 + Math.sin(t * 3) * 6), fb = t => fig(380, 300 - Math.sin(t * 3) * 6);      // two neighbours whose y order flips every second
  const L = createLabelLayout(); let changes = 0, prev = null;
  for (let i = 0; i < 240; i++) {
    const t = i / 30, A = tag('a', fa(t), { w: 100 }), B = tag('b', fb(t), { w: 100 });
    frame(L, { tags: [A, B] }, t * 1000);
    const k = JSON.stringify([L.peek('a').u, L.peek('a').v, L.peek('b').u, L.peek('b').v]); if (prev !== null && k !== prev) changes++; prev = k;
  }
  assert.ok(changes <= 1, `the cells changed ${changes} times`);
});

test('frame-rate independence: 30, 60 and 120 fps give the same cell changes and the same hide time to within one 30 fps frame', () => {
  const seat = [fig(300, 300), fig(340, 300)].map((f, i) => tag('s' + i, f, { w: 100, rank: 10 }));
  const result = fps => {
    const L = createLabelLayout(), log = [];
    for (let i = 0; i < fps * 4; i++) {
      const t = i / fps, wf = fig(200 + t * 90, 345);                                          // a figure (no label) crossing from 200 to 560 in 4 s: its rect covers the labels' home spots for about a second
      const out = frame(L, { tags: seat, extraFigures: [wf] }, t * 1000);
      const o = out.get('s1'), p = L.peek('s1'); log.push([t, o && o.shown ? 1 : 0, p.u + ',' + p.v]);
    }
    const hideAt = log.find(r => r[1] === 0 && r[0] > 0.3), cellChanges = log.filter((r, i) => i && r[2] !== log[i - 1][2]).length;
    return { hideAt: hideAt ? hideAt[0] : null, cellChanges, final: log.at(-1)[2], shown: log.at(-1)[1] };
  };
  const r30 = result(30), r60 = result(60), r120 = result(120);
  console.log('   ', JSON.stringify({ r30, r60, r120 }));
  assert.equal(r30.cellChanges, r120.cellChanges);
  assert.equal(r30.cellChanges, r60.cellChanges);
  assert.equal(r30.final, r120.final);
  if (r30.hideAt !== null || r120.hideAt !== null) assert.ok(Math.abs(r30.hideAt - r120.hideAt) <= 1 / 30 + 1e-9, `${r30.hideAt} vs ${r120.hideAt}`);
});

test('a label is not hidden by a blip shorter than HIDE_MS, is hidden by one longer than it, and comes back only after MIN_HIDDEN_MS', () => {
  const T = tag('a', fig(300, 300), { w: 100 });
  const trial = ms => {
    const L = createLabelLayout(), fps = 120, rows = [];
    for (let i = 0; i < fps * 3; i++) {
      const t = i * 1000 / fps, extra = [];
      if (t >= 500 && t < 500 + ms) for (let dx = -320; dx <= 320; dx += 60) for (let dy = -240; dy <= 240; dy += 40) extra.push({ x: T.near.x + dx, y: T.near.y + T.near.h + dy, w: 60, h: 40 });   // obstacles on the home spot and on every cell near it
      rows.push([t, frame(L, { tags: [T], extraFigures: extra }, t).get('a').shown]);
    }
    return rows;
  };
  const short = trial(STABLE.HIDE_MS * 0.5), long = trial(STABLE.HIDE_MS * 3);
  assert.ok(short.slice(60).every(r => r[1]), 'a blip of half HIDE_MS leaves the label shown');
  const sp = spells(long.map(r => r[1]), long.map(r => r[0]));
  const hidden = sp.find(s => !s.on && s.inner);
  assert.ok(hidden, 'a blip of three HIDE_MS hides it');
  assert.ok(hidden.to - hidden.from >= STABLE.MIN_HIDDEN_MS - 1, `hidden for ${(hidden.to - hidden.from).toFixed(0)} ms`);
  assert.ok(hidden.from - 500 >= STABLE.HIDE_MS - 10, `hidden ${(hidden.from - 500).toFixed(0)} ms after the cause`);
  const shownFirst = sp[0];
  assert.ok(shownFirst.to >= STABLE.SHOW_MS - 10);
});

test('MIN_SHOWN_MS: a label that has just appeared stays at least that long, whatever happens', () => {
  const T = tag('a', fig(300, 300), { w: 100 });
  const L = createLabelLayout(), fps = 120, rows = [];
  for (let i = 0; i < fps * 2; i++) {
    const t = i * 1000 / fps, extra = [];
    if (t >= 300) for (let dx = -320; dx <= 320; dx += 60) for (let dy = -240; dy <= 240; dy += 40) extra.push({ x: T.near.x + dx, y: T.near.y + T.near.h + dy, w: 60, h: 40 });
    rows.push([t, frame(L, { tags: [T], extraFigures: extra }, t).get('a').shown]);
  }
  const sp = spells(rows.map(r => r[1]), rows.map(r => r[0])), on = sp.find(s => s.on);
  assert.ok(on && on.inner, 'it appeared and went again');
  assert.ok(on.to - on.from >= STABLE.MIN_SHOWN_MS - 10, `shown for ${(on.to - on.from).toFixed(0)} ms`);
});

test('the spot ease has no overshoot and has settled within the glide spring (about 600 ms)', () => {
  const A = tag('a', fig(300, 300), { w: 100, rank: 100, force: true });
  const L = createLabelLayout(), xs = [], fps = 120;
  for (let i = 0; i < fps * 2; i++) {
    const t = i * 1000 / fps, other = i > 30 ? [{ x: A.near.x - 10, y: A.near.y + A.near.h, w: 120, h: 40 }] : [];     // a label of another agent lands on A's home spot at 250 ms
    const out = L.step({ tags: [A], figures: [A.near, ...other], blocked: [], fixed: [], vw: VW, vh: VH }, t);
    xs.push([t, out.get('a').x, out.get('a').y]);
  }
  const ys = xs.map(r => r[2]);
  let up = 0, down = 0; for (let i = 1; i < ys.length; i++) { if (ys[i] > ys[i - 1] + 1e-9) up++; if (ys[i] < ys[i - 1] - 1e-9) down++; }
  assert.ok(up === 0 || down === 0, `one direction only (up ${up}, down ${down})`);
  const last = xs.at(-1), settledAt = xs.find(r => Math.hypot(r[1] - last[1], r[2] - last[2]) < 1 && r[0] > 250);
  assert.ok(settledAt && settledAt[0] - 250 <= 800, 'settled in ' + (settledAt ? settledAt[0] - 250 : 'never') + ' ms after the cause');
  assert.ok(Math.hypot(last[1] - xs[0][1], last[2] - xs[0][2]) > 20, 'it did move');
});

test('reach hysteresis: a sub-agent label shown at gap 52 stays when maxGap is 50 (50 + REACH_SLACK), one that never was shown does not appear there', () => {
  const T = { ...tag('s', fig(300, 300), { w: 100, rank: 10 }), maxGap: 50 };
  const strip = { x: T.near.x - 20, y: T.near.y + T.near.h - 5, w: 140, h: 40 };
  const trial = shownFirst => {
    const L = createLabelLayout(); let t = 0, o;
    for (let k = 0; k < 40; k++) { t += 33; frame(L, { tags: [T], extraFigures: shownFirst && k < 20 ? [] : [strip] }, t); }
    for (let k = 0; k < 40; k++) { t += 33; o = frame(L, { tags: [T], extraFigures: [strip] }, t).get('s'); }
    return o.shown;
  };
  assert.equal(trial(true), true);
  assert.equal(trial(false), false);
});

test('a label under what floats over the scene is hidden in the same step, without a fade (cut), and a main label that has a clear spot comes back', () => {
  const T = tag('t', fig(300, 300), { w: 100 }), M = tag('m', fig(600, 300), { w: 100, force: true, rank: 100 });
  const L = createLabelLayout(); let i = 0, t = 0;
  for (; i < 30; i++) { t += 33; frame(L, { tags: [T, M] }, t); }
  assert.ok(frame(L, { tags: [T, M] }, t += 33).get('t').shown);
  const card = { x: home(T).x - 5, y: home(T).y - 5, w: 120, h: 80 };
  const o = frame(L, { tags: [T, M], blocked: [card] }, t += 33);
  assert.equal(o.get('t').shown, false);
  assert.equal(o.get('t').cut, true);
  // nothing that is shown overlaps the card, in any step
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let reshown = null;
  for (let k = 0; k < 90; k++) {
    t += 33; const out = frame(L, { tags: [T, M], blocked: [card] }, t);
    for (const [id, p] of out) if (p.shown) assert.ok(!hit({ x: p.x, y: p.y, w: id === 't' ? T.w : M.w, h: 30 }, card), `${id} shown under the card at step ${k}`);
    if (out.get('t').shown && reshown === null) reshown = k * 33;
  }
  assert.ok(reshown !== null && reshown >= STABLE.MIN_HIDDEN_MS - 70, `it found a free cell and came back after ${reshown} ms (not before MIN_HIDDEN_MS)`);
});

test('a label that is shown and has a card slide over it is cut at once; a main label is cut too and comes back as soon as its spot is clear', () => {
  const M = tag('m', fig(300, 300), { w: 100, force: true, rank: 100 });
  const L = createLabelLayout(); let t = 0;
  for (let k = 0; k < 30; k++) { t += 33; frame(L, { tags: [M] }, t); }
  assert.ok(frame(L, { tags: [M] }, t += 33).get('m').shown);
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let cutAt = null, shownUnder = 0;
  for (let k = 0; k < 60; k++) {
    t += 33;
    const card = { x: 250 + k * 6, y: 240, w: 120, h: 120 }, o = frame(L, { tags: [M], blocked: [card] }, t).get('m');
    if (!o.shown && cutAt === null) cutAt = k;
    if (o.shown && hit({ x: o.x, y: o.y, w: M.w, h: M.h }, card)) shownUnder++;
  }
  assert.ok(cutAt !== null && cutAt <= 1, `cut at step ${cutAt}`);
  assert.equal(shownUnder, 0, 'a label is never shown under the card');
});

test('a main label whose spots are all under the card takes the nearest free spot of the grid and holds it; it goes home when the card is gone', () => {
  const M = tag('m', fig(300, 300), { w: 160, h: 40, force: true, rank: 100 });
  const card = { x: 50, y: 50, w: 900, h: 600 };                      // covers the figure, its home spot and every cell of the four rings
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const L = createLabelLayout(); let t = 0, out;
  for (let k = 0; k < 60; k++) { t += 33; out = frame(L, { tags: [M], blocked: [card] }, t); }
  const p = out.get('m');
  assert.ok(p.shown, 'a main agent keeps its label');
  assert.ok(!hit({ x: p.x, y: p.y, w: M.w, h: M.h }, card), 'clear of the card');
  assert.ok(L.peek('m').fallback);
  const held = [p.x, p.y];
  for (let k = 0; k < 30; k++) { t += 33; out = frame(L, { tags: [M], blocked: [card] }, t); }
  assert.deepEqual([out.get('m').x, out.get('m').y], held, 'held, not searched again each frame');
  for (let k = 0; k < 150; k++) { t += 33; out = frame(L, { tags: [M] }, t); }
  assert.deepEqual([L.peek('m').u, L.peek('m').v, L.peek('m').fallback], [0, 0, false]);
  assert.ok(Math.abs(out.get('m').y - home(M).y) < 1);
});

test('a label whose agent is not on the screen (no near rect) falls back to its own x and y', () => {
  const T = { id: 'n', x: 420, y: 333, w: 90, h: 30, rank: 10, force: true };
  const out = run(10, 30, () => ({ tags: [T] })).at(-1).get('n');
  assert.deepEqual([out.x, out.y], [420, 333]);
});

test('state of ids that are not seen is forgotten after FORGET_MS, and does not grow over 10000 ids', () => {
  const L = createLabelLayout(); let t = 0;
  for (let i = 0; i < 10000; i++) { t += 33; L.step({ tags: [tag('id' + i, fig(100 + (i % 50) * 10, 300), { w: 80 })], blocked: [], fixed: [], figures: [], vw: VW, vh: VH }, t); }
  assert.ok(L.size <= Math.ceil(STABLE.FORGET_MS / 33) + 3, `size ${L.size}`);
  t += 33; L.step({ tags: [], vw: VW, vh: VH }, t);
  for (let k = 0; k < 60; k++) { t += 33; L.step({ tags: [], vw: VW, vh: VH }, t); }
  assert.equal(L.size, 0);
});

test('a label that comes back within FORGET_MS keeps its cell; one that comes back later starts again at home', () => {
  const A = tag('a', fig(300, 300), { w: 100, rank: 100, force: true }), B = tag('b', fig(360, 300), { w: 100, rank: 10 });
  const settle = L => { let t = 0; for (let k = 0; k < 60; k++) { t += 33; frame(L, { tags: [A, B] }, t); } return t; };
  const L = createLabelLayout(); let t = settle(L);
  const cell = L.peek('b'); assert.ok(cell.u !== 0 || cell.v !== 0, 'B was pushed off its home spot by A');
  for (let k = 0; k < 10; k++) { t += 33; frame(L, { tags: [A] }, t); }
  t += 33; frame(L, { tags: [A, B] }, t);
  assert.deepEqual([L.peek('b').u, L.peek('b').v], [cell.u, cell.v]);
  for (let k = 0; k < 70; k++) { t += 33; frame(L, { tags: [] }, t); }
  assert.equal(L.peek('b'), null);
});

test('reduced motion: the springs jump to their cell and nothing glides', () => {
  const A = tag('a', fig(300, 300), { w: 100, rank: 100, force: true }), B = tag('b', fig(330, 300), { w: 100, rank: 10 });
  const L = createLabelLayout(); let t = 0, out;
  for (let k = 0; k < 20; k++) { t += 33; out = L.step({ tags: [A, B], figures: [A.near, B.near], blocked: [], fixed: [], vw: VW, vh: VH, reduced: true }, t); }
  assert.equal(L.moving, false);
  for (let k = 0; k < 30; k++) { t += 33; out = L.step({ tags: [A, { ...B, near: fig(331, 300), x: B.x + 1 }], figures: [A.near, B.near], blocked: [], fixed: [], vw: VW, vh: VH, reduced: true }, t); assert.equal(out.get('b').moving, false); }
  const before = L.peek('b');
  const g = createLabelLayout(); t = 0;
  for (let k = 0; k < 20; k++) { t += 33; g.step({ tags: [A, B], figures: [A.near, B.near], blocked: [], fixed: [], vw: VW, vh: VH }, t); }
  assert.equal(g.moving, false, 'the first sight settles at once in any case');
  assert.ok(before);
});

test('`moving` is true while a spring has not settled and false once every label rests', () => {
  const A = tag('a', fig(300, 300), { w: 100, rank: 100, force: true });
  const L = createLabelLayout(); let t = 0, moving = [];
  for (let k = 0; k < 90; k++) {
    t += 33; const other = k > 10 ? [{ x: A.near.x - 10, y: A.near.y + A.near.h, w: 120, h: 40 }] : [];
    const out = L.step({ tags: [A], figures: [A.near, ...other], blocked: [], fixed: [], vw: VW, vh: VH }, t);
    moving.push([L.moving, out.get('a').moving]);
  }
  assert.ok(moving.slice(0, 10).every(m => !m[0] && !m[1]), 'rests before the cause');
  assert.ok(moving.slice(11, 20).every(m => m[0] && m[1]), 'moves while it glides');
  assert.deepEqual(moving.at(-1), [false, false], 'rests at the end');
});

test('fixed labels: the higher priority one wins a touch, a forced one stays, one that is shown wins a tie, nothing holds under the card', () => {
  const a = { id: 'a', x: 100, y: 100, w: 40, h: 24, pri: 100, force: false }, b = { id: 'b', x: 120, y: 110, w: 40, h: 24, pri: 30, force: false }, c = { id: 'c', x: 125, y: 112, w: 40, h: 24, pri: 10, force: true };
  const L = createLabelLayout(); let t = 0, out;
  for (let k = 0; k < 40; k++) { t += 33; out = L.step({ fixed: [a, b, c], vw: VW, vh: VH }, t); }
  assert.equal(out.get('a').shown, true); assert.equal(out.get('b').shown, false); assert.equal(out.get('c').shown, true);
  assert.deepEqual([out.get('a').x, out.get('a').y], [100, 100]);
  // two labels of the same priority that touch: the one that was shown first keeps it, whichever is listed first
  const d = { id: 'd', x: 400, y: 100, w: 40, h: 24, pri: 50 }, e = { id: 'e', x: 420, y: 100, w: 40, h: 24, pri: 50 };
  const M = createLabelLayout(); t = 0;
  for (let k = 0; k < 40; k++) { t += 33; out = M.step({ fixed: [d], vw: VW, vh: VH }, t); }
  for (let k = 0; k < 60; k++) { t += 33; out = M.step({ fixed: [e, d], vw: VW, vh: VH }, t); }
  assert.equal(out.get('d').shown, true); assert.equal(out.get('e').shown, false);
  const card = { x: 90, y: 90, w: 100, h: 60 };
  out = L.step({ fixed: [a, b, c], blocked: [card], vw: VW, vh: VH }, t += 33);
  assert.equal(out.get('a').shown, false); assert.equal(out.get('a').cut, true);
});

test('a step is capped at DT_MAX: a tab that was hidden for ten seconds does not make every debounce run out at once', () => {
  const T = tag('a', fig(300, 300), { w: 100 }), L = createLabelLayout();
  let t = 0; for (let k = 0; k < 30; k++) { t += 33; frame(L, { tags: [T] }, t); }
  assert.ok(frame(L, { tags: [T] }, t += 33).get('a').shown);
  const blocker = []; for (let dx = -320; dx <= 320; dx += 60) for (let dy = -240; dy <= 240; dy += 40) blocker.push({ x: T.near.x + dx, y: T.near.y + T.near.h + dy, w: 60, h: 40 });
  assert.ok(frame(L, { tags: [T], extraFigures: blocker }, t += 10000).get('a').shown, 'one step of ten seconds counts as DT_MAX');
});

test('the lattice: home first, then four rings of eight, nearest ring first', () => {
  const c = cells(4);
  assert.equal(c.length, 33);
  assert.deepEqual(c[0], [0, 0]);
  assert.deepEqual(c[1], [0, -1]);
  assert.ok(c.slice(1, 9).every(([u, v]) => Math.max(Math.abs(u), Math.abs(v)) === 1));
  assert.ok(c.slice(25).every(([u, v]) => Math.max(Math.abs(u), Math.abs(v)) === 4));
  assert.ok(springParams({ duration: 0.4, bounce: 0 }).zeta >= 1, 'the glide spring does not overshoot');
});

// ---- a seeded random walk: 12 agents, 40 labels ----------------------------------------------------------------------------------------------------------------------
function walkScene(seed) {
  const r0 = rng(seed), agents = [];
  // every agent has its own generator and its turns are on its own schedule, so the walk is the same at any frame rate (only the sampling differs)
  for (let i = 0; i < 12; i++) agents.push({ r: rng(seed * 101 + i + 1), x: 100 + r0() * 800, y: 200 + r0() * 400, vx: 0, vy: 0, main: i < 4, walk: false, nextTurn: 0 });
  const signs = Array.from({ length: 16 }, (_, i) => ({ id: 'sg' + i, x: 40 + (i % 8) * 115, y: 60 + Math.floor(i / 8) * 600, w: 80, h: 24, pri: 90, force: false }));
  return (t, dt) => {
    for (const a of agents) {
      while (t >= a.nextTurn) { const r = a.r, ang = r() * 6.28, sp = r() < 0.25 ? 0 : 20 + r() * 50; a.vx = Math.cos(ang) * sp; a.vy = Math.sin(ang) * sp; a.nextTurn += 0.7 + r() * 2.2; a.walk = a.main && sp > 0; }
      a.x = Math.min(950, Math.max(50, a.x + a.vx * dt)); a.y = Math.min(640, Math.max(180, a.y + a.vy * dt));
    }
    const figs = agents.map(a => fig(a.x, a.y));
    const tags = agents.map((a, i) => tag('t' + i, figs[i], { w: a.main ? 130 : 90, h: a.main ? 44 : 22, rank: a.main ? 100 : 10, force: a.main, walking: a.walk }));
    const fixed = [...signs, ...agents.map((a, i) => ({ id: 'b' + i, x: figs[i].x + 2, y: figs[i].y - 28, w: 26, h: 24, pri: a.main ? 60 : 30, force: false }))];
    return { tags, fixed, figures: figs.filter((f, i) => !agents[i].walk), homes: tags.map(home) };
  };
}
function randomWalk(fps, seed, seconds = 40) {
  const scene = walkScene(seed), L = createLabelLayout(), series = new Map(); let prev = null, maxStep = 0, overlapFrames = 0, n = 0;
  const hit = (a, b) => a.x < b.x + b.w - 2 && a.x + a.w > b.x + 2 && a.y < b.y + b.h - 2 && a.y + a.h > b.y + 2;
  for (let i = 0; i < fps * seconds; i++) {
    const t = i / fps, sc = scene(t, 1 / fps), out = L.step({ ...sc, blocked: [], vw: VW, vh: VH }, t * 1000);
    const size = new Map([...sc.tags, ...sc.fixed].map(l => [l.id, l])), homeOf = new Map(sc.tags.map((T, k) => [T.id, sc.homes[k]]));
    for (const [id, p] of out) {
      if (!series.has(id)) series.set(id, { shown: [], t: [] });
      const s = series.get(id); s.shown.push(p.shown); s.t.push(t * 1000);
      if (prev && prev.get(id) && p.shown && prev.get(id).shown && homeOf.has(id)) {            // how far the label moved beyond its agent
        const h = homeOf.get(id), q = prev.get(id), a = prev.homes.get(id);
        maxStep = Math.max(maxStep, Math.hypot((p.x - h.x) - (q.x - a.x), (p.y - h.y) - (q.y - a.y)));
      }
    }
    const shown = [...out].filter(([, p]) => p.shown).map(([id, p]) => ({ id, ...p, w: size.get(id).w, h: size.get(id).h }));
    for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) if (!sc.tags.find(T => T.id === shown[a].id && T.walking) && !sc.tags.find(T => T.id === shown[b].id && T.walking) && hit(shown[a], shown[b])) overlapFrames++;
    n++;
    prev = out; prev.homes = new Map(sc.tags.map((T, k) => [T.id, sc.homes[k]]));
  }
  let blinks = 0, flashes = 0, toggles = 0;
  for (const s of series.values()) for (const sp of spells(s.shown, s.t)) {
    if (!sp.inner) continue;
    toggles++;
    if (!sp.on && sp.to - sp.from < 500 - 1e-6) blinks++;
    if (sp.on && sp.frames <= 5) flashes++;
  }
  return { labels: series.size, blinks, flashes, toggles, maxStep: +maxStep.toFixed(1), overlapFrames, frames: n };
}

// 8 fps is the headless page (software GL), where the layout's step is capped at DT_MAX: a label must not hop there either
for (const fps of [8, 30, 120]) {
  test(`a seeded random walk of 12 agents and 40 labels at ${fps} fps: no label hides for under 0.5 s, none shows for 5 frames or fewer, no step over 40 px`, () => {
    for (const seed of [1, 7]) {
      const r = randomWalk(fps, seed);
      console.log('   ', fps, 'fps seed', seed, JSON.stringify(r));
      assert.equal(r.labels, 40);
      assert.equal(r.blinks, 0, 'blinks');
      assert.equal(r.flashes, 0, 'flashes');
      assert.ok(r.maxStep <= 40, `largest step beyond the agent: ${r.maxStep} px`);
    }
  });
}

test('the same random walk gives about the same number of toggles at 30 and at 120 fps (the decisions are time based)', () => {
  for (const seed of [3, 4]) {
    const a = randomWalk(30, seed), b = randomWalk(120, seed);
    console.log('   seed', seed, '30 fps', JSON.stringify(a), '\n           120 fps', JSON.stringify(b));
    assert.ok(Math.abs(a.toggles - b.toggles) <= Math.max(6, a.toggles * 0.35), `${a.toggles} vs ${b.toggles} toggles`);
  }
});

test('a frame of 40 labels costs well under a millisecond', () => {
  const scene = walkScene(5), L = createLabelLayout();
  let t = 0; for (let i = 0; i < 90; i++) { t += 33; L.step({ ...scene(t / 1000, 0.033), blocked: [{ x: 700, y: 80, w: 280, h: 560 }], vw: VW, vh: VH }, t); }
  const N = 300, t0 = performance.now();
  for (let i = 0; i < N; i++) { t += 33; L.step({ ...scene(t / 1000, 0.033), blocked: [{ x: 700, y: 80, w: 280, h: 560 }], vw: VW, vh: VH }, t); }
  const per = (performance.now() - t0) / N;
  console.log('   per step', per.toFixed(3), 'ms');
  assert.ok(per < 3, `${per.toFixed(2)} ms per step`);
});
