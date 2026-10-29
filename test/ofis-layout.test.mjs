import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_ROOMS, MAX_ROOMS, MIN_ROWS, BASE_CLS, MAX_CLS, VACANT_CLS, SHRINK_MS, CAP, COLS, CELL_W, ROOM_D, GAP, WALL_T, roomW,
  minRoomsFrom, perRowFor, vlayout, buildingPlan, classFor, nextClass, createSlots,
} from '../public/js/ofis-layout.js';

const chat = (i, order = i) => ({ id: 'chat-' + String(i).padStart(3, '0'), order });
const chats = (n, from = 0) => Array.from({ length: n }, (_, i) => chat(from + i));
const rect = c => `${c.slot}:${c.X},${c.Z},${c.W},${c.D},${c.door},${c.hall}`;
const overlap = (a, b) => a.X < b.X + b.W + WALL_T && a.X + a.W + WALL_T > b.X && a.Z < b.Z + b.D + WALL_T && a.Z + a.D + WALL_T > b.Z;

// ---------------------------------------------------------------- the minimum

test('minimum: ten rooms, laid out as two rows of five with a hall between them', () => {
  assert.equal(MIN_ROOMS, 10);
  assert.equal(MIN_ROWS, 2);
  assert.equal(perRowFor(MIN_ROOMS), 5);
  const P = buildingPlan(MIN_ROWS, perRowFor(MIN_ROOMS));
  assert.equal(P.cells.length, MIN_ROOMS);
  assert.equal(P.halls.length, 1);
  assert.equal(P.halls[0].open, false);
  assert.deepEqual(P.rows.map(r => r.door), ['front', 'back']);
  assert.deepEqual([...new Set(P.cells.map(c => c.row))], [0, 1]);
});

test('minimum: ?rooms=N changes it (a whole number from 2 to the maximum); anything else keeps the default', () => {
  assert.equal(minRoomsFrom('?scene=3d'), MIN_ROOMS);
  assert.equal(minRoomsFrom('?scene=3d&rooms=6'), 6);
  assert.equal(minRoomsFrom('rooms=2'), 2);
  assert.equal(minRoomsFrom(`?rooms=${MAX_ROOMS}`), MAX_ROOMS);
  for (const bad of ['?rooms=1', '?rooms=0', '?rooms=-4', `?rooms=${MAX_ROOMS + 1}`, '?rooms=ten', '?rooms=6.5', '?rooms=', '?rooms=0x10']) assert.equal(minRoomsFrom(bad), MIN_ROOMS, bad);
  assert.equal(minRoomsFrom(undefined), MIN_ROOMS);
  assert.equal(minRoomsFrom('?rooms=bad', 7), 7);
  assert.equal(perRowFor(6), 3);
  assert.equal(perRowFor(7), 4, 'an odd minimum gets one vacant office more');
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

test('capacity: every office is a fixed cell as wide as the largest class, so a room grows inside it', () => {
  assert.equal(CELL_W, roomW(MAX_CLS));
  assert.ok(roomW(BASE_CLS) < CELL_W, 'the base room leaves room for the extra desk columns');
  for (const c of buildingPlan(3, 5).cells) assert.equal(c.W, CELL_W);
});

test('capacity: a room grows at once and shrinks only after SHRINK_MS and when the figures fit', () => {
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

test('building: offices never overlap, and the same plan comes out every time', () => {
  for (const [rows, perRow] of [[2, 5], [3, 5], [4, 5], [5, 5], [2, 3], [6, 4], [3, 1]]) {
    const P = buildingPlan(rows, perRow);
    assert.equal(P.cells.length, rows * perRow);
    for (let i = 0; i < P.cells.length; i++) for (let j = i + 1; j < P.cells.length; j++) assert.ok(!overlap(P.cells[i], P.cells[j]), `${rows}x${perRow}: cells ${i} and ${j} overlap`);
    for (const c of P.cells) assert.ok(c.X >= 0 && c.X + c.W <= P.width + 1e-9, 'inside the building width');
    assert.equal(JSON.stringify(P), JSON.stringify(buildingPlan(rows, perRow)));
  }
});

test('building: appending rows moves no earlier office, door or row', () => {
  const perRow = 5;
  for (let rows = MIN_ROWS; rows < 9; rows++) {
    const a = buildingPlan(rows, perRow), b = buildingPlan(rows + 1, perRow);
    assert.equal(b.width, a.width, 'the width does not change');
    assert.deepEqual(b.cells.slice(0, a.cells.length).map(rect), a.cells.map(rect), `${rows} -> ${rows + 1} rows`);
    assert.deepEqual(b.rows.slice(0, a.rows.length), a.rows);
  }
});

test('building: a slot depends on its own row and column only', () => {
  const P = buildingPlan(4, 5);
  for (const c of P.cells) {
    assert.equal(c.row, Math.floor(c.slot / 5));
    assert.equal(c.col, c.slot % 5);
    assert.equal(c.X, c.col * (CELL_W + GAP));
  }
  assert.equal(P.cells[0].Z, 0);
  assert.equal(vlayout(4).rows[2].z, P.cells[10].Z);
});

test('building: reserved space at the start of a row (a local add-on) shifts only that row', () => {
  const plain = buildingPlan(3, 5), lead = buildingPlan(3, 5, { 1: 7 });
  assert.equal(lead.width, plain.width + 7);
  for (let i = 0; i < plain.cells.length; i++) assert.equal(lead.cells[i].X, plain.cells[i].X + (plain.cells[i].row === 1 ? 7 : 0));
});

// ---------------------------------------------------------------- slots

test('slots: new chats take the lowest free slot, oldest chat first', () => {
  const S = createSlots();
  const r = S.update([chat(2, 30), chat(0, 10), chat(1, 20)], 0);
  assert.deepEqual([...r.slotOf.entries()].sort(), [['chat-000', 0], ['chat-001', 1], ['chat-002', 2]].sort());
  assert.equal(r.rows, MIN_ROWS);
  assert.equal(r.size, MIN_ROOMS);
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

test('slots: up to MIN_ROOMS chats the building does not grow; the next chat appends a row and leaves the first ten slots alone', () => {
  const S = createSlots();
  for (let n = 0; n <= MIN_ROOMS; n++) {
    const r = S.update(chats(n), n * 100);
    assert.equal(r.rows, MIN_ROWS, `${n} chats`);
    assert.equal(r.grew, false);
  }
  const ten = S.update(chats(MIN_ROOMS), 5000).slotOf;
  const r = S.update(chats(MIN_ROOMS + 1), 6000);
  assert.equal(r.grew, true);
  assert.equal(r.rows, MIN_ROWS + 1);
  assert.equal(r.size, MIN_ROOMS + perRowFor(MIN_ROOMS), 'a whole row of offices is appended');
  assert.equal(r.slotOf.get('chat-010'), MIN_ROOMS, 'the 11th chat is in the first appended office');
  for (const [id, s] of ten) assert.equal(r.slotOf.get(id), s);
  const cells10 = buildingPlan(MIN_ROWS, 5).cells, cells11 = buildingPlan(r.rows, 5).cells;
  assert.deepEqual(cells11.slice(0, cells10.length).map(rect), cells10.map(rect), 'the first ten offices are where they were');
});

test('slots: an appended row is kept until it has stood empty for SHRINK_MS, then it goes', () => {
  const S = createSlots();
  S.update(chats(12), 0);
  assert.equal(S.rows, 3);
  let r = S.update(chats(10), 1000);
  assert.equal(r.rows, 3, 'not at once');
  assert.equal(r.shrank, false);
  r = S.update(chats(10), 1000 + SHRINK_MS - 1);
  assert.equal(r.rows, 3);
  r = S.update(chats(11), 1000 + SHRINK_MS);
  assert.equal(r.rows, 3, 'a chat back in the row: it stays');
  r = S.update(chats(10), 2000 + SHRINK_MS);
  r = S.update(chats(10), 2000 + 2 * SHRINK_MS + 1);
  assert.equal(r.rows, MIN_ROWS);
  assert.equal(r.shrank, true);
});

test('slots: the building never shrinks under a chat: the last row stays while any chat sits in it', () => {
  const S = createSlots();
  const all = chats(12);
  S.update(all, 0);
  const without = all.filter(c => c.id !== 'chat-010');       // slot 10 free, slot 11 still used
  let r = S.update(without, 10);
  r = S.update(without, 10 + 10 * SHRINK_MS);
  assert.equal(r.rows, 3);
  assert.equal(r.slotOf.get('chat-011'), 11);
});

test('slots: the saved slots bring every chat back to its office after a reload', () => {
  const live = chats(9);
  const S = createSlots();
  S.update(live, 0);
  const open = live.filter(c => !['chat-000', 'chat-003'].includes(c.id));
  const was = S.update(open, 10).slotOf;
  const saved = JSON.parse(JSON.stringify(S.toJSON()));
  assert.equal(saved.perRow, 5);
  const back = createSlots({ saved }).update([...open].reverse(), 20).slotOf;
  assert.deepEqual([...back.entries()].sort(), [...was.entries()].sort());
  // without the saved slots the chats close ranks: that is all a reload can know
  const plain = createSlots().update(open, 20).slotOf;
  assert.notDeepEqual([...plain.entries()].sort(), [...was.entries()].sort());
});

test('slots: saved slots made for another row size, or in conflict, are not trusted blindly', () => {
  const list = chats(4);
  const other = createSlots({ minRooms: 6, saved: { v: 1, perRow: 5, slots: { 'chat-000': 7, 'chat-001': 2 } } }).update(list, 0).slotOf;
  assert.deepEqual([...other.values()].sort(), [0, 1, 2, 3], 'a different row size: ignored');
  const clash = createSlots({ saved: { v: 1, perRow: 5, slots: { 'chat-000': 3, 'chat-001': 3, 'chat-002': -1, 'chat-003': 1.5 } } }).update(list, 0).slotOf;
  assert.equal(new Set(clash.values()).size, 4, 'no two chats in one office');
  assert.equal(clash.get('chat-000'), 3);
  for (const bad of [null, undefined, 'x', 5, { slots: 3 }, { perRow: 5, slots: null }]) assert.equal(createSlots({ saved: bad }).update(list, 0).slotOf.size, 4);
});

test('slots: a remembered slot beyond the building is honoured only when this many chats need that many offices', () => {
  const saved = { v: 1, perRow: 5, slots: { 'chat-000': 12, 'chat-005': 11 } };
  const few = createSlots({ saved }).update(chats(1), 0);
  assert.equal(few.slotOf.get('chat-000'), 0, 'one chat does not bring a row back');
  assert.equal(few.rows, MIN_ROWS);
  const many = createSlots({ saved }).update(chats(12), 0);
  assert.equal(many.slotOf.get('chat-005'), 11, 'twelve chats need three rows: the remembered office is in them');
  assert.equal(many.rows, 3);
  assert.equal(new Set(many.slotOf.values()).size, 12);
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
  assert.equal(r.rows, MIN_ROWS);
});

test('slots: a woken chat whose remembered office is outside the building takes the lowest free office', () => {
  const S = createSlots();
  S.update(chats(12), 0);                                  // three rows, chat-011 in slot 11
  const nine = chats(9);
  S.update(nine, 10);                                      // chats 9, 10 and 11 fall asleep
  S.update(nine, 10 + SHRINK_MS + 1);                      // the third row has stood empty long enough: it goes
  assert.equal(S.rows, MIN_ROWS);
  const r = S.update([...nine, chat(11)], 20 + SHRINK_MS);
  assert.equal(r.slotOf.get('chat-011'), 9, 'ten chats fit the ten offices: no row comes back for it');
  assert.equal(r.rows, MIN_ROWS);
});

test('slots: a woken chat that makes the crowd too big for the offices gets its old office back in the row that returns', () => {
  const S = createSlots();
  S.update(chats(12), 0);
  const ten = chats(10);
  S.update(ten, 10);
  S.update(ten, 10 + SHRINK_MS + 1);
  assert.equal(S.rows, MIN_ROWS);
  const r = S.update([...ten, chat(11)], 20 + SHRINK_MS);
  assert.equal(r.slotOf.get('chat-011'), 11);
  assert.equal(r.rows, 3);
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
    assert.equal(r.rows, MIN_ROWS, `${min} chats fit the smallest building`);
    assert.ok(r.size >= min && r.size <= min + 1, 'an odd minimum has one vacant office more');
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
    const perRow = perRowFor(min);
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
      assert.ok(r.rows >= MIN_ROWS);
      if (prev) {
        if (r.grew) assert.ok(live.size > prev.size, `step ${step}: the building grew with ${live.size} chats for ${prev.size} offices`);
        for (const [id, s] of prev.slotOf) if (r.slotOf.has(id)) assert.equal(r.slotOf.get(id), s, `${id} moved at step ${step}`);
        const a = buildingPlan(prev.rows, perRow).cells, b = buildingPlan(r.rows, perRow).cells, n = Math.min(a.length, b.length);
        assert.deepEqual(b.slice(0, n).map(rect), a.slice(0, n).map(rect), `an office moved at step ${step}`);
      }
      prev = r;
    }
  }
});
