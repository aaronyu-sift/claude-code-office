import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_ROOMS, MAX_ROOMS, BASE_CLS, MAX_CLS, VACANT_CLS, SHRINK_MS, CAP, COLS, CELL_W, ROOM_D, GAP, WALL_T, HALL_D, HALL_GAP, PITCH, PITCH_Z, PAIR_D, PLINTH_M, LANE_OFF, LAYOUT_ID, LOUNGE_SITE, roomW,
  minRoomsFrom, bayAt, officesIn, baysFor, baysForOffices, baysForSlot, siteOfSlot, buildingPlan, projectPoint, projectedBox, projectedArea, fitZoom, classFor, nextClass, createSlots,
} from '../public/js/ofis-layout.js';

const chat = (i, order = i) => ({ id: 'chat-' + String(i).padStart(3, '0'), order });
const chats = (n, from = 0) => Array.from({ length: n }, (_, i) => chat(from + i));
const rect = c => `${c.slot}:${c.X},${c.Z},${c.W},${c.D},${c.door},${c.hall}`;
const overlap = (a, b) => a.X < b.X + b.W + WALL_T && a.X + a.W + WALL_T > b.X && a.Z < b.Z + b.D + WALL_T && a.Z + a.D + WALL_T > b.Z;
const BAYS = baysFor(MIN_ROOMS);
const everything = P => [...P.cells, ...(P.lounge ? [P.lounge] : [])];

// the building before the X: one hall, two rows of five offices, one plinth around all of it (what the fit framed, and what it covered)
const OLD = [{ x0: -WALL_T - PLINTH_M, x1: 5 * PITCH - GAP + WALL_T + PLINTH_M, z0: -WALL_T - PLINTH_M, z1: PAIR_D + WALL_T + PLINTH_M }];
const WINDOWS = [[1440, 900], [1920, 1080], [1280, 800], [1100, 700]];

// ---------------------------------------------------------------- the minimum

test('minimum: ten chats, laid out as an X of six bays: a bar of four with one bay north and one south of its centre', () => {
  assert.equal(MIN_ROOMS, 10);
  assert.equal(BAYS, 6);
  const P = buildingPlan(BAYS);
  assert.equal(P.cells.length, officesIn(BAYS));
  assert.ok(P.cells.length >= MIN_ROOMS && P.cells.length <= MIN_ROOMS + 1, 'the minimum, or one vacant office more (bays hold two offices)');
  assert.equal(P.cells.length + 1, 2 * BAYS, 'two offices per bay, one of them the lounge');
  assert.deepEqual(P.halls.map(h => h.row), [0, -1, 1], 'the bar is hall 0 (the reception), then the north arm, then the south arm');
  assert.deepEqual(P.halls.map(h => h.bays), [4, 1, 1]);
  assert.ok(P.halls.every(h => h.open === false));
  assert.deepEqual([...new Set(P.cells.map(c => c.door))].sort(), ['back', 'front']);
});

test('minimum: ?rooms=N changes it (a whole number from 2 to the maximum); anything else keeps the default', () => {
  assert.equal(minRoomsFrom('?scene=3d'), MIN_ROOMS);
  assert.equal(minRoomsFrom('?scene=3d&rooms=6'), 6);
  assert.equal(minRoomsFrom('rooms=2'), 2);
  assert.equal(minRoomsFrom(`?rooms=${MAX_ROOMS}`), MAX_ROOMS);
  for (const bad of ['?rooms=1', '?rooms=0', '?rooms=-4', `?rooms=${MAX_ROOMS + 1}`, '?rooms=ten', '?rooms=6.5', '?rooms=', '?rooms=0x10']) assert.equal(minRoomsFrom(bad), MIN_ROOMS, bad);
  assert.equal(minRoomsFrom(undefined), MIN_ROOMS);
  assert.equal(minRoomsFrom('?rooms=bad', 7), 7);
});

test('minimum: every minimum from 2 to the maximum is laid out with its offices, the lounge, and at most one vacant office more', () => {
  for (let n = 2; n <= MAX_ROOMS; n++) {
    const bays = baysFor(n), P = buildingPlan(bays);
    assert.ok(P.cells.length >= n && P.cells.length <= n + 1, `${n} chats: ${P.cells.length} offices`);
    assert.equal(P.cells.length, officesIn(bays));
    assert.ok(P.lounge, `${n} chats: the hub is reserved`);
    assert.equal(baysForOffices(P.cells.length), bays, 'the offices of a building need exactly its bays');
  }
});

test('shape: the X is symmetric left to right and top to bottom, and its arms and bar are about as long', () => {
  const P = buildingPlan(BAYS), bar = P.halls[0], north = P.halls[1], south = P.halls[2];
  const centre = (bar.x0 + bar.x1) / 2;
  for (const h of [north, south]) assert.ok(Math.abs((h.x0 + h.x1) / 2 - centre) < 1e-6, 'an arm is centred over the bar');
  assert.equal(north.x1 - north.x0, CELL_W);
  assert.ok(Math.abs(bar.x1 - bar.x0 - (3 * PITCH + CELL_W)) < 1e-6);
  assert.equal(south.zr - bar.zr, bar.zr - north.zr, 'the arms are the same distance from the bar');
  const widthAlongX = bar.x1 - bar.x0, lengthAlongZ = south.zr + PAIR_D - north.zr;
  assert.ok(Math.abs(widthAlongX - lengthAlongZ) / lengthAlongZ < 0.12, `the bar is ${widthAlongX.toFixed(1)} long and the arms together ${lengthAlongZ.toFixed(1)}: an X, not a long strip`);
  // mirror: every office has a partner at the mirrored x, in the same row and on the same side, except where the lounge takes one
  const mid = 2 * centre - CELL_W;
  const key = c => `${c.row}/${c.side}/${(+c.X).toFixed(3)}`;
  const keys = new Set(everything(P).map(key));
  for (const c of everything(P)) assert.ok(keys.has(`${c.row}/${c.side}/${(mid - c.X).toFixed(3)}`), `${key(c)} has no mirror`);
});

test('shape: the hub is a cell with no slot, at the centre of the bar, with the door of the bar hall', () => {
  const P = buildingPlan(BAYS), L = P.lounge, bar = P.halls[0];
  assert.equal(L.slot, -1);
  assert.equal(L.lounge, true);
  assert.equal(L.site, LOUNGE_SITE);
  assert.equal(L.hall, 0);
  assert.equal(L.W, CELL_W);
  assert.equal(L.D, ROOM_D);
  assert.ok(L.X > bar.x0 + CELL_W && L.X + L.W < bar.x1, 'between the bar\'s two end bays: the middle of the X');
  assert.ok(!P.cells.some(c => c.site === LOUNGE_SITE), 'no office has the hub');
  assert.ok(P.cells.every(c => !overlap(c, L)), 'the offices and the hub do not overlap');
});

// ---------------------------------------------------------------- capacity of a room

test('capacity: a room is built for BASE_CLS (6 desks) and a chat with a few sub-agents never changes it', () => {
  assert.deepEqual(COLS.map(c => c * 3), CAP);
  assert.ok(CAP[BASE_CLS] >= 6, 'six desks or more from the start');
  for (let demand = 0; demand <= CAP[BASE_CLS]; demand++) assert.equal(classFor(demand), BASE_CLS, `${demand} sub-agents`);
  assert.equal(classFor(CAP[BASE_CLS] + 1), MAX_CLS, 'one more than the desks grows the room');
  assert.equal(classFor(CAP[MAX_CLS]), MAX_CLS);
  assert.equal(classFor(CAP[MAX_CLS] + 5), MAX_CLS, 'beyond the largest room the rest shows as +N on the sign');
  assert.ok(VACANT_CLS <= MAX_CLS && VACANT_CLS >= 0);
});

test('capacity: every office is a fixed cell as wide as the largest class, so a room grows inside it', { skip: MAX_CLS === BASE_CLS && 'MAX_CLS = BASE_CLS: rooms cannot grow' }, () => {
  assert.equal(CELL_W, roomW(MAX_CLS));
  assert.ok(roomW(BASE_CLS) < CELL_W, 'the base room leaves room for the extra desk columns');
  for (const c of everything(buildingPlan(8))) assert.equal(c.W, CELL_W);
});

test('capacity: a room grows at once and shrinks only after SHRINK_MS and when the figures fit', { skip: MAX_CLS === BASE_CLS && 'MAX_CLS = BASE_CLS: rooms cannot grow' }, () => {
  let st = { cls: null, low: 0 };
  st = nextClass(st, BASE_CLS, 0, 1000);
  assert.deepEqual(st, { cls: BASE_CLS, low: 0 });
  st = nextClass(st, MAX_CLS, 8, 2000);
  assert.deepEqual(st, { cls: MAX_CLS, low: 0 }, 'grows at once');
  st = nextClass(st, BASE_CLS, 2, 3000);
  assert.deepEqual(st, { cls: MAX_CLS, low: 3000 }, 'the clock starts');
  st = nextClass(st, BASE_CLS, 2, 3000 + SHRINK_MS - 1);
  assert.equal(st.cls, MAX_CLS, 'not yet');
  st = nextClass(st, BASE_CLS, CAP[BASE_CLS] + 1, 3000 + SHRINK_MS + 5000);
  assert.equal(st.cls, MAX_CLS, 'more figures than the smaller room has desks');
  st = nextClass(st, MAX_CLS, 8, 3000 + SHRINK_MS + 6000);
  assert.deepEqual(st, { cls: MAX_CLS, low: 0 }, 'demand came back: the clock resets');
  st = nextClass(st, BASE_CLS, 2, 100000);
  st = nextClass(st, BASE_CLS, 2, 100000 + SHRINK_MS + 1);
  assert.deepEqual(st, { cls: BASE_CLS, low: 0 }, 'shrinks');
  assert.deepEqual(nextClass({ cls: MAX_CLS, low: 5 }, BASE_CLS, 0, 6, true), { cls: BASE_CLS, low: 0 }, 'instant');
});

// ---------------------------------------------------------------- the building

test('building: offices, hub and halls never overlap, and the same plan comes out every time', () => {
  for (let bays = 1; bays <= 31; bays++) {
    const P = buildingPlan(bays), all = everything(P);
    assert.equal(P.cells.length, officesIn(bays));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${bays} bays: cells ${all[i].site} and ${all[j].site} overlap`);
    for (const c of all) {
      const h = P.halls[c.hall];
      assert.ok(c.X >= h.x0 - 1e-9 && c.X + c.W <= h.x1 + 1e-9, 'an office is inside the length of its hall');
      const hallOverlaps = c.Z < h.z1 + WALL_T && c.Z + c.D > h.z0 - HALL_GAP;
      assert.equal(hallOverlaps && c.Z + c.D > h.z0 && c.Z < h.z1, false, 'no office lies on its hall');
      if (c.door === 'front') assert.ok(Math.abs(c.Z + c.D + HALL_GAP - h.z0) < 1e-6, 'a door in the low front wall opens onto the hall below it');
      else assert.ok(Math.abs(h.z1 + WALL_T - c.Z) < 1e-6, 'a door in the back wall opens onto the hall above it');
    }
    for (const h of P.halls) { assert.ok(h.lane > h.z0 && h.lane < h.z1); assert.equal(h.z1 - h.z0, HALL_D); assert.ok(Math.abs(h.lane - h.z0 - LANE_OFF) < 1e-9); }
    for (let i = 0; i < P.halls.length; i++) for (let j = i + 1; j < P.halls.length; j++) assert.ok(P.halls[i].z1 + WALL_T <= P.halls[j].z0 - HALL_GAP || P.halls[j].z1 + WALL_T <= P.halls[i].z0 - HALL_GAP, 'two halls never share a strip');
    assert.equal(JSON.stringify(P), JSON.stringify(buildingPlan(bays)));
  }
});

test('building: every hall is entered from the right: nothing of the building lies beyond the right end, and the plinth meets exactly row to row', () => {
  for (let bays = 1; bays <= 31; bays++) {
    const P = buildingPlan(bays);
    for (const h of P.halls) assert.ok(h.x1 <= P.width + 1e-9);
    assert.ok(P.halls.some(h => h.x1 === P.width), 'some hall reaches the right edge');
    for (let i = 0; i < P.plinth.length; i++) for (let j = i + 1; j < P.plinth.length; j++) {
      const a = P.plinth[i], b = P.plinth[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      assert.ok(ox <= 1e-9 || oz <= 1e-9, `${bays} bays: the plinth of hall ${i} overlaps the one of hall ${j}`);
    }
    for (const c of everything(P)) {
      const r = P.plinth[c.hall];
      assert.ok(c.X - WALL_T >= r.x0 && c.X + c.W + WALL_T <= r.x1 && c.Z - WALL_T >= r.z0 && c.Z + c.D + WALL_T <= r.z1, 'an office and its walls stand on the plinth');
    }
    assert.ok(P.bounds.x0 <= P.inner.x0 - WALL_T && P.bounds.x1 >= P.width + WALL_T && P.bounds.z1 >= P.depth + WALL_T);
  }
});

test('building: adding a bay moves no earlier office, door, hub or hall, it only lengthens the hall of its row', () => {
  for (let bays = 1; bays < 31; bays++) {
    const a = buildingPlan(bays), b = buildingPlan(bays + 1);
    const was = a.cells.length;
    if (bays === 1) continue;                                          // the hub appears with the second bay: slots of the first bay stay
    assert.deepEqual(b.cells.slice(0, was).map(rect), a.cells.map(rect), `${bays} -> ${bays + 1} bays`);
    assert.equal(rect({ ...b.lounge, slot: -1 }), rect({ ...a.lounge, slot: -1 }), 'the hub stays');
    a.halls.forEach((h, i) => {
      const g = b.halls[i];
      assert.equal(g.row, h.row); assert.equal(g.z0, h.z0); assert.equal(g.z1, h.z1); assert.equal(g.lane, h.lane);
      assert.ok(g.x0 <= h.x0 && g.x1 >= h.x1, 'a hall only gets longer');
    });
    assert.equal(b.halls.length - a.halls.length === 0 || b.halls.length - a.halls.length === 1, true, 'at most one new hall');
    assert.deepEqual(b.halls.slice(0, a.halls.length).map(h => h.row), a.halls.map(h => h.row), 'halls keep their numbers');
  }
});

test('building: the reception (hall 0, the bar) keeps its left end, its place and its lane from the X on; it only grows to the right, and not before the hexagon is full', () => {
  const x = buildingPlan(BAYS).halls[0];
  for (let bays = BAYS; bays <= 40; bays++) {
    const bar = buildingPlan(bays).halls[0], area = buildingPlan(bays, { first: 7, last: 5 });
    for (const f of ['row', 'z0', 'z1', 'lane', 'zr', 'x0', 'open']) assert.equal(bar[f], x[f], `${bays} bays: ${f}`);
    assert.ok(bar.x1 >= x.x1, `${bays} bays: the bar only gets longer, to the right`);
    assert.equal(area.areas[0].x, buildingPlan(BAYS, { first: 7, last: 5 }).areas[0].x, `${bays} bays: the add-on areas stay where they were`);
    if (bays <= 10) assert.deepEqual(bar, { ...x, bays: bar.bays }, `${bays} bays: the hexagon leaves the bar as it is`);
  }
});

test('building: a slot depends on its own bay only; sites come in bays of two and the hub takes one', () => {
  const P = buildingPlan(10);
  P.cells.forEach((c, s) => {
    assert.equal(c.slot, s);
    assert.equal(c.site, siteOfSlot(s));
    assert.equal(c.bay, c.site >> 1);
    const [k, col] = bayAt(c.bay);
    assert.equal(c.row, k); assert.equal(c.col, col);
    assert.ok(Math.abs(c.X - col * PITCH) < 1e-6);
    assert.equal(c.side, c.site % 2 ? 'front' : 'back');
    assert.ok(baysForSlot(s) <= 10);
  });
  assert.equal(siteOfSlot(LOUNGE_SITE - 1), LOUNGE_SITE - 1);
  assert.equal(siteOfSlot(LOUNGE_SITE), LOUNGE_SITE + 1, 'the slot after the hub skips it');
  assert.equal(baysForSlot(officesIn(7) - 1), 7, 'the last office of seven bays needs the seventh');
  // the sequence of bays never repeats a place and each bay touches the building so far
  // (past the table of fixed bays, 40 of them, the bar goes on to the right: that is tested too)
  const seen = new Set();
  for (let i = 0; i < 100; i++) { const [k, c] = bayAt(i), key = k + '/' + c; assert.ok(!seen.has(key), 'bay ' + i + ' repeats ' + key); seen.add(key); }
  for (let i = 1; i < 100; i++) {
    const [k, c] = bayAt(i);
    const near = [...Array(i).keys()].some(j => { const [k2, c2] = bayAt(j); return (k2 === k && Math.abs(c2 - c) === 1) || (Math.abs(k2 - k) === 1 && Math.abs(c2 - c) <= 0.5); });
    assert.ok(near, `bay ${i} at row ${k}, column ${c} is joined to the building`);
    // every row stays whole (one hall per row: its bays touch), and the bar never grows to its left
    const row = [...Array(i + 1).keys()].map(bayAt).filter(([k2]) => k2 === k).map(([, c2]) => c2).sort((p, q) => p - q);
    assert.ok(row.every((c2, n) => !n || Math.abs(c2 - row[n - 1] - 1) < 1e-9), `bay ${i}: row ${k} has a gap: ${row}`);
    if (k === 0) assert.ok(c >= 0, 'the bar grows to the right only');
  }
});

// the building before the X grown a row of five offices at a time: the plinth around its two-row blocks (a row left over has an open hall of 3.6 m)
const oldRows = cells => {
  const rows = cells / 5, pairs = Math.ceil(rows / 2), depth = pairs * PAIR_D + (pairs - 1) * GAP - (rows % 2 ? PAIR_D - (ROOM_D + HALL_GAP + 3.6) : 0);
  return [{ x0: -WALL_T - PLINTH_M, x1: 5 * PITCH - GAP + WALL_T + PLINTH_M, z0: -WALL_T - PLINTH_M, z1: depth + WALL_T + PLINTH_M }];
};

test('growth: at every size the building fits the window better than the two rows of before did for as many chats, and never gets thin', () => {
  for (let bays = BAYS; bays <= 31; bays++) {
    const P = buildingPlan(bays), cells = Math.max(10, Math.ceil(P.cells.length / 5) * 5);
    const was = fitZoom(projectedBox(oldRows(cells)), 1440, 900), now = fitZoom(projectedBox(P.plinth), 1440, 900);
    assert.ok(now >= was * 1.05, `${bays} bays (${P.cells.length} offices): zoom ${was.toFixed(1)} -> ${now.toFixed(1)}`);
    const b = projectedBox(P.plinth);
    assert.ok(b.w / b.h > 1.3 && b.w / b.h < 2.4, `${bays} bays: the box is ${(b.w / b.h).toFixed(2)} wide for 1 high`);
  }
});

test('building: reserved space for a local add-on lengthens the bar\'s hall and puts the area outside its left end', () => {
  const plain = buildingPlan(BAYS), lead = buildingPlan(BAYS, { first: 7, last: 5 });
  assert.equal(lead.halls[0].x0, plain.halls[0].x0 - GAP - 7);
  assert.deepEqual(lead.cells.map(rect), plain.cells.map(rect), 'no office moves');
  assert.equal(lead.areas.length, 2);
  const [first, last] = lead.areas;
  assert.equal(first.key, 'first'); assert.equal(first.door, 'front'); assert.equal(first.x, plain.halls[0].x0 - GAP - 7); assert.equal(first.z, plain.halls[0].zr);
  assert.equal(last.key, 'last'); assert.equal(last.door, 'back');
  assert.ok(lead.plinth[0].x0 < plain.plinth[0].x0, 'the plinth reaches them');
  assert.equal(buildingPlan(BAYS).areas.length, 0);
});

// ---------------------------------------------------------------- the screen

test('screen: a point on +x goes to the right and down, a point on +z to the left and down, as the camera of the scene does', () => {
  const o = projectPoint(0, 0, 0), px = projectPoint(10, 0, 0), pz = projectPoint(0, 0, 10), py = projectPoint(0, 10, 0);
  assert.ok(px[0] > o[0] && px[1] < o[1], 'x: right and down');
  assert.ok(pz[0] < o[0] && pz[1] < o[1], 'z: left and down');
  assert.ok(py[0] === o[0] && py[1] > o[1], 'y: straight up');
});

test('screen: the X fits the window at least 15 percent bigger than two rows of five did, and fills the window better', () => {
  const was = projectedBox(OLD), now = projectedBox(buildingPlan(BAYS).plinth);
  const wasArea = projectedArea(OLD), nowArea = projectedArea(buildingPlan(BAYS).plinth);
  for (const [w, h] of WINDOWS) {
    for (const shelf of [0, 322]) {
      const opts = { right: Math.max(24, shelf) }, before = fitZoom(was, w, h, opts), after = fitZoom(now, w, h, opts);
      assert.ok(after >= before * 1.15, `${w}x${h}${shelf ? ' with the shelf card' : ''}: zoom ${before.toFixed(1)} -> ${after.toFixed(1)} (${((after / before - 1) * 100).toFixed(0)} percent)`);
      assert.ok(nowArea * after * after / (w * h) >= 1.35 * wasArea * before * before / (w * h), `${w}x${h}: the building covers 35 percent more of the window`);
    }
  }
  const z = fitZoom(now, 1440, 900);
  assert.ok(nowArea * z * z / (1440 * 900) >= 0.4, 'the building covers at least 40 percent of a 1440 x 900 window');
  assert.ok(nowArea / (now.w * now.h) >= 0.5, 'and at least half of the box that is framed');
  assert.ok(now.w / now.h > 1.5 && now.w / now.h < 1.8, `the box is ${(now.w / now.h).toFixed(2)} wide for 1 high: between 16:10 (1.6) and 16:9 (1.78)`);
});

test('screen: the footprint is what the fit frames: the box of the plinth rectangles, not the box around the whole plan', () => {
  const P = buildingPlan(BAYS), b = P.bounds, tight = projectedBox(P.plinth), loose = projectedBox([b]);
  assert.ok(tight.w < loose.w && tight.h < loose.h, 'the arms leave the corners of the plan out of the frame');
  assert.ok(tight.w * tight.h < 0.8 * loose.w * loose.h);
});

// ---------------------------------------------------------------- slots

test('slots: new chats take the lowest free slot, oldest chat first', () => {
  const S = createSlots();
  const r = S.update([chat(2, 30), chat(0, 10), chat(1, 20)], 0);
  assert.deepEqual([...r.slotOf.entries()].sort(), [['chat-000', 0], ['chat-001', 1], ['chat-002', 2]].sort());
  assert.equal(r.bays, BAYS);
  assert.equal(r.size, officesIn(BAYS));
});

test('slots: the same chats get the same slots whatever order they arrive in (a reload)', () => {
  const list = chats(7);
  const a = createSlots().update(list, 0).slotOf, b = createSlots().update([...list].reverse(), 0).slotOf;
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  const tie = createSlots().update([{ id: 'b', order: 5 }, { id: 'a', order: 5 }], 0).slotOf;
  assert.equal(tie.get('a'), 0, 'the same start time falls back to the id');
  assert.equal(tie.get('b'), 1);
});

test('slots: a chat keeps its slot while others come and go; a closed chat frees its slot for the next newcomer', () => {
  const S = createSlots();
  let r = S.update(chats(3), 0);
  const first = new Map(r.slotOf);
  r = S.update(chats(7), 1000);
  for (const [id, s] of first) assert.equal(r.slotOf.get(id), s, id + ' moved when four chats arrived');
  const before = new Map(r.slotOf);
  const open = chats(7).filter(c => !['chat-001', 'chat-004'].includes(c.id));
  r = S.update(open, 2000);
  for (const c of open) assert.equal(r.slotOf.get(c.id), before.get(c.id), c.id + ' moved when two chats closed');
  assert.equal(r.slotOf.has('chat-001'), false);
  r = S.update([...open, chat(20, 99)], 3000);
  assert.equal(r.slotOf.get('chat-020'), 1, 'the newcomer takes the lowest free slot');
  r = S.update([...open, chat(20, 99), chat(21, 100)], 4000);
  assert.equal(r.slotOf.get('chat-021'), 4, 'then the next free one');
  r = S.update([...open, chat(20, 99), chat(21, 100), chat(22, 101)], 5000);
  assert.equal(r.slotOf.get('chat-022'), 7, 'then the first slot after the last used one');
});

test('slots: up to the offices of the minimum the building does not grow; the next chat adds a bay and leaves every earlier slot alone', () => {
  const S = createSlots(), offices = officesIn(BAYS);
  for (let n = 0; n <= offices; n++) {
    const r = S.update(chats(n), n * 100);
    assert.equal(r.bays, BAYS, `${n} chats`);
    assert.equal(r.grew, false);
  }
  const full = S.update(chats(offices), 5000).slotOf;
  const r = S.update(chats(offices + 1), 6000);
  assert.equal(r.grew, true);
  assert.equal(r.bays, BAYS + 1);
  assert.equal(r.size, offices + 2, 'a bay is two offices');
  assert.equal(r.slotOf.get('chat-' + String(offices).padStart(3, '0')), offices, 'the next chat is in the first new office');
  for (const [id, s] of full) assert.equal(r.slotOf.get(id), s);
  const before = buildingPlan(BAYS).cells, after = buildingPlan(r.bays).cells;
  assert.deepEqual(after.slice(0, before.length).map(rect), before.map(rect), 'the offices of the minimum are where they were');
});

test('slots: an added bay is kept until it has stood empty for SHRINK_MS, then it goes', () => {
  const S = createSlots(), offices = officesIn(BAYS);
  S.update(chats(offices + 2), 0);
  assert.equal(S.bays, BAYS + 1);
  let r = S.update(chats(offices), 1000);
  assert.equal(r.bays, BAYS + 1, 'not at once');
  assert.equal(r.shrank, false);
  r = S.update(chats(offices), 1000 + SHRINK_MS - 1);
  assert.equal(r.bays, BAYS + 1);
  r = S.update(chats(offices + 1), 1000 + SHRINK_MS);
  assert.equal(r.bays, BAYS + 1, 'a chat back in the bay: it stays');
  r = S.update(chats(offices), 2000 + SHRINK_MS);
  r = S.update(chats(offices), 2000 + 2 * SHRINK_MS + 1);
  assert.equal(r.bays, BAYS);
  assert.equal(r.shrank, true);
});

test('slots: the building never shrinks under a chat: the last bay stays while any chat sits in it', () => {
  const S = createSlots(), offices = officesIn(BAYS);
  const all = chats(offices + 2);
  S.update(all, 0);
  const without = all.filter(c => c.id !== 'chat-' + String(offices).padStart(3, '0'));       // the first new office is free, the second is still used
  let r = S.update(without, 10);
  r = S.update(without, 10 + 10 * SHRINK_MS);
  assert.equal(r.bays, BAYS + 1);
  assert.equal(r.slotOf.get('chat-' + String(offices + 1).padStart(3, '0')), offices + 1);
});

test('slots: the saved slots bring every chat back to its office after a reload', () => {
  const live = chats(9);
  const S = createSlots();
  S.update(live, 0);
  const open = live.filter(c => !['chat-000', 'chat-003'].includes(c.id));
  const was = S.update(open, 10).slotOf;
  const saved = JSON.parse(JSON.stringify(S.toJSON()));
  assert.equal(saved.layout, LAYOUT_ID);
  const back = createSlots({ saved }).update([...open].reverse(), 20).slotOf;
  assert.deepEqual([...back.entries()].sort(), [...was.entries()].sort());
  // without the saved slots the chats close ranks: that is all a reload can know
  const plain = createSlots().update(open, 20).slotOf;
  assert.notDeepEqual([...plain.entries()].sort(), [...was.entries()].sort());
});

test('slots: saved slots made for another arrangement (the two rows of before), or in conflict, are not trusted blindly', () => {
  const list = chats(4);
  const rows = createSlots({ saved: { v: 1, perRow: 5, slots: { 'chat-000': 7, 'chat-001': 2 } } }).update(list, 0).slotOf;
  assert.deepEqual([...rows.values()].sort(), [0, 1, 2, 3], 'the slots of the two rows: ignored');
  const clash = createSlots({ saved: { v: 2, layout: LAYOUT_ID, slots: { 'chat-000': 3, 'chat-001': 3, 'chat-002': -1, 'chat-003': 1.5 } } }).update(list, 0).slotOf;
  assert.equal(new Set(clash.values()).size, 4, 'no two chats in one office');
  assert.equal(clash.get('chat-000'), 3);
  for (const bad of [null, undefined, 'x', 5, { slots: 3 }, { layout: LAYOUT_ID, slots: null }, { layout: 'other', slots: { 'chat-000': 3 } }]) assert.equal(createSlots({ saved: bad }).update(list, 0).slotOf.size, 4);
});

test('slots: a remembered slot beyond the building is honoured only when this many chats need that many offices', () => {
  const offices = officesIn(BAYS), saved = { v: 2, layout: LAYOUT_ID, slots: { 'chat-000': offices + 3, 'chat-005': offices + 2 } };
  const few = createSlots({ saved }).update(chats(1), 0);
  assert.equal(few.slotOf.get('chat-000'), 0, 'one chat does not bring a bay back');
  assert.equal(few.bays, BAYS);
  const many = createSlots({ saved }).update(chats(offices + 4), 0);
  assert.equal(many.slotOf.get('chat-005'), offices + 2, 'this many chats need the bays: the remembered office is in them');
  assert.equal(new Set(many.slotOf.values()).size, offices + 4);
  assert.ok(many.bays > BAYS);
});

test('slots: a chat that falls asleep (goes to the shelf) frees its office; it gets it back on waking if it is still free', () => {
  const S = createSlots();
  const all = chats(6);
  let r = S.update(all, 0);
  assert.equal(r.slotOf.get('chat-002'), 2);
  const asleep = all.filter(c => c.id !== 'chat-002');
  r = S.update(asleep, 1000);
  assert.equal(r.slotOf.has('chat-002'), false, 'no room while asleep');
  for (const c of asleep) assert.equal(r.slotOf.get(c.id), Number(c.id.slice(5)), 'nobody else moved');
  r = S.update(all, 2000);
  assert.equal(r.slotOf.get('chat-002'), 2, 'back in its own office');
});

test('slots: a chat that wakes to find its office taken gets the lowest free slot', () => {
  const S = createSlots();
  const all = chats(6);
  S.update(all, 0);
  const asleep = all.filter(c => c.id !== 'chat-002');
  S.update(asleep, 1000);
  let r = S.update([...asleep, chat(50, 500)], 2000);
  assert.equal(r.slotOf.get('chat-050'), 2, 'a newcomer takes the freed office');
  r = S.update([...asleep, chat(50, 500), chat(2)], 3000);
  assert.equal(r.slotOf.get('chat-050'), 2, 'and keeps it');
  assert.equal(r.slotOf.get('chat-002'), 6, 'the sleeper takes the lowest free slot');
  assert.equal(r.bays, BAYS);
});

test('slots: a woken chat whose remembered office is outside the building takes the lowest free office', () => {
  const S = createSlots(), offices = officesIn(BAYS);
  S.update(chats(offices + 2), 0);                          // one bay more, the last chat in the last office
  const fit = chats(offices);
  S.update(fit, 10);                                        // the two chats of the new bay fall asleep
  S.update(fit, 10 + SHRINK_MS + 1);                        // the bay has stood empty long enough: it goes
  assert.equal(S.bays, BAYS);
  const r = S.update([...fit.slice(0, offices - 1), chat(offices + 1)], 20 + SHRINK_MS);
  assert.equal(r.slotOf.get('chat-' + String(offices + 1).padStart(3, '0')), offices - 1, 'a free office in the building takes it: no bay comes back for it');
  assert.equal(r.bays, BAYS);
});

test('slots: a woken chat that makes the crowd too big for the offices gets its old office back in the bay that returns', () => {
  const S = createSlots(), offices = officesIn(BAYS);
  S.update(chats(offices + 2), 0);
  const fit = chats(offices);
  S.update(fit, 10);
  S.update(fit, 10 + SHRINK_MS + 1);
  assert.equal(S.bays, BAYS);
  const r = S.update([...fit, chat(offices + 1)], 20 + SHRINK_MS);
  assert.equal(r.slotOf.get('chat-' + String(offices + 1).padStart(3, '0')), offices + 1);
  assert.equal(r.bays, BAYS + 1);
});

test('slots: only the newest few hundred chats are remembered', () => {
  const S = createSlots();
  for (let i = 0; i < 600; i++) { S.update([chat(i)], i); S.update([], i + 0.5); }
  const n = Object.keys(S.toJSON().slots).length;
  assert.ok(n <= 400 && n >= 100, `${n} remembered`);
});

test('slots: the smallest and the largest minimum both lay out', () => {
  for (const min of [2, 3, MAX_ROOMS]) {
    const S = createSlots({ minRooms: min });
    const r = S.update(chats(min), 0);
    assert.equal(r.bays, baysFor(min), `${min} chats fit the smallest building`);
    assert.ok(r.size >= min && r.size <= min + 1, 'a bay is two offices and the hub takes one: at most one vacant office more');
    assert.equal(S.update(chats(r.size), 5).grew, false, 'a chat for every office does not expand it');
    assert.equal(S.update(chats(r.size + 1), 10).grew, true, `chat ${r.size + 1} expands it`);
  }
});

// ---------------------------------------------------------------- the whole rule, on random days

test('stability: over thousands of random arrivals and departures nothing that stays ever moves', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (const min of [10, 6, 3]) {
    const S = createSlots({ minRooms: min });
    let live = new Map(), gone = [], nextId = 0, now = 0, prev = null;
    for (let step = 0; step < 4000; step++) {
      now += Math.floor(rnd() * 20000);
      if (rnd() < 0.55 && live.size < 4 * min) {
        if (gone.length && rnd() < 0.3) { const [id, order] = gone.splice(Math.floor(rnd() * gone.length), 1)[0]; live.set(id, order); }       // a sleeper wakes
        else live.set('c' + nextId, nextId++);
      } else if (live.size) { const ids = [...live.keys()], id = ids[Math.floor(rnd() * ids.length)]; gone.push([id, live.get(id)]); live.delete(id); }
      const r = S.update([...live].map(([id, order]) => ({ id, order })), now);
      assert.equal(new Set(r.slotOf.values()).size, live.size, 'one office per chat');
      for (const s of r.slotOf.values()) assert.ok(s >= 0 && s < r.size, 'every chat has an office in the building');
      assert.ok(r.bays >= baysFor(min));
      if (prev) {
        if (r.grew) assert.ok(live.size > prev.size, `step ${step}: the building grew with ${live.size} chats for ${prev.size} offices`);
        for (const [id, s] of prev.slotOf) if (r.slotOf.has(id)) assert.equal(r.slotOf.get(id), s, `${id} moved at step ${step}`);
        const a = buildingPlan(prev.bays).cells, b = buildingPlan(r.bays).cells, n = Math.min(a.length, b.length);
        assert.deepEqual(b.slice(0, n).map(rect), a.slice(0, n).map(rect), `an office moved at step ${step}`);
      }
      prev = r;
    }
  }
});
