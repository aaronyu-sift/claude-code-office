// Stable layout of the 3D office: the decisions behind it, with no WebGL and no DOM so that node can test them (test/ofis-layout.test.mjs).
// ofis.js draws what this file decides.
//
//   The building is an X: a bar of four bays across the middle and one bay north and one south of its centre, so that on the screen (the camera
//   looks along a world diagonal) it is a cross whose arms run into the four corners instead of a thin diagonal strip. A bay is two offices that
//   share a hall, [office | hall | office], one cell wide (CELL_W); the bays of one row of the building share one hall that runs along x, and
//   every hall is entered from the street side (the right end of the building), so the arms' halls have a short paved path across the lawn to it.
//   The building is laid out for MIN_ROOMS chats from the first frame. An office with no chat is a vacant office. A chat takes the lowest free
//   office (its slot) and keeps it until the chat closes or falls asleep (it is on the shelf then), and gets it back on waking if it is still free,
//   so nobody else's office moves when chats come and go. Every office is a fixed cell, CELL_W wide, the width of the largest room class: a room
//   builds its desks inside the cell and the rest of the cell is a lounge, so a chat whose sub-agents outgrow its desks (BASE_CLS to MAX_CLS)
//   grows in place and no wall of any other room moves.
//   The hub of the X (the second office of the bar's centre) is reserved for a lounge that is furnished later: it is a cell of the plan with no
//   slot, drawn as an open plaza until then.
//   Only more chats than offices expand the building, one bay (two offices) at a time, in a fixed order that keeps the shape compact: first the
//   two arms widen to the width of the bar (north and south, left to right, a hexagon of 3 + 4 + 3 bays), then a row of four bays is added north
//   and south, then a row of three, and so on, so earlier offices keep their place and only the halls of the rows that gain a bay grow. A bay
//   goes away again after SHRINK_MS without a chat in it.
//
// To change the minimum: MIN_ROOMS below, or `?rooms=N` on the page address (2 to MAX_ROOMS), for example `/?scene=3d&rooms=6#ofis`.

export const MIN_ROOMS = 10;             // chats the building is laid out for (an even number gives one vacant office more: bays are two offices and the hub is the lounge)
export const MAX_ROOMS = 60;             // the largest `?rooms=` accepted
export const BASE_CLS = 1;               // room class every office is built with (6 desks): a chat with up to that many sub-agents never changes its room
export const MAX_CLS = 2;                // the class a room grows to when sub-agents outgrow BASE_CLS (12 desks); more show as "+N" on the sign.
                                         // It sets the size of every office: MAX_CLS = BASE_CLS makes the cells 8.4 wide instead of 12.6 (the map fills the window
                                         // about 30 percent better) and rooms then never grow
export const VACANT_CLS = BASE_CLS;      // the class a vacant office is furnished with
export const SHRINK_MS = 60e3;           // a bigger class, or an added bay, is given up after this long without need
export const LAYOUT_ID = 'x1';           // the arrangement slots were made for: a slot is an office of this shape, so slots saved for another one are not used

// ------------------------------------------------------------ dimensions (1 unit is about 1 meter)

export const WALL_T = 0.16;
export const ROOM_D = 6.8, CHEF_W = 3.2, COL_W = 2.1, FRONT_M = 1.0, GAP = 1.5;
export const HALL_D = 5.0, HALL_GAP = 0.18;                         // depth of the hall between the two offices of a bay
export const COLS = [1, 2, 4];                                      // room class → desk columns (3 desks per column)
export const CAP = COLS.map(c => c * 3);                            // desks (sub-agents) per class: 3, 6 and 12
export const roomW = cls => CHEF_W + COLS[cls] * COL_W + FRONT_M;   // the room as wide as its desks need
export const CELL_W = roomW(MAX_CLS);                               // every office takes this much of its row
export const PITCH = CELL_W + GAP;                                  // one bay along x
export const PAIR_D = ROOM_D + HALL_GAP + HALL_D + WALL_T + ROOM_D; // the depth of a bay: office, hall, office
export const PITCH_Z = PAIR_D + GAP;                                // one row of the building along z
export const LANE_OFF = 1.75;                                       // the walking line in a hall, from the hall's back edge
export const PLINTH_M = 0.7;                                        // the paving around the rooms, beside the outer walls
const mm = v => Math.round(v * 1000) / 1000;

// `?rooms=N` of a page address (search string), else the default; anything that is not a whole number from 2 to MAX_ROOMS is ignored
export function minRoomsFrom(search, dflt = MIN_ROOMS) {
  const v = new URLSearchParams(search || '').get('rooms');
  const n = v != null && /^\d+$/.test(v) ? Number(v) : NaN;
  return n >= 2 && n <= MAX_ROOMS ? n : dflt;
}

// ------------------------------------------------------------ bays: the order the building is built in

// A bay is [k, c]: row k of the building (0 is the bar, negative rows are north, positive rows south) and column c in bays (halves for the rows
// that sit between two columns of the bar). The first six are the X; the next four widen its arms; after that rows of four and three bays are
// added north and south alternately, a bay at a time from the middle outwards.
const HEAD = [[0, 1], [0, 2], [-1, 1.5], [1, 1.5], [0, 0], [0, 3], [-1, 0.5], [1, 0.5], [-1, 2.5], [1, 2.5]];
const ROW_COLS = { 4: [1, 2, 0, 3], 3: [1.5, 0.5, 2.5] };
export function bayAt(i) {
  if (i < HEAD.length) return HEAD[i];
  let j = i - HEAD.length, k = 2;
  for (;; k++) {
    const cols = ROW_COLS[k % 2 ? 3 : 4];
    if (j < 2 * cols.length) return [(j % 2 ? 1 : -1) * k, cols[j >> 1]];
    j -= 2 * cols.length;
  }
}
// The second office of the second bay of the bar is the hub of the X. It is reserved for a lounge: a cell without a chat slot.
export const LOUNGE_SITE = 3;
// bays hold two offices (sites 2i and 2i + 1); the lounge takes one site of the second bay on
export const officesIn = bays => Math.max(0, 2 * bays - (bays >= 2 ? 1 : 0));
export const baysForOffices = n => Math.max(1, n < 2 ? 1 : Math.ceil((n + 1) / 2));
export const baysFor = minRooms => baysForOffices(minRooms);
export const siteOfSlot = s => (s < LOUNGE_SITE ? s : s + 1);
export const baysForSlot = s => (siteOfSlot(s) >> 1) + 1;           // the bays that must exist for this slot's office to exist

// ------------------------------------------------------------ the building

// The building of `bays` bays: the offices by slot (rectangles that depend on the slot only), the lounge cell, the halls (one per row of the
// building, numbered in the order the rows first appear: the bar's is hall 0, the reception's), the plinth (the paved rectangles under it, one per
// row) and the bounds. Adding a bay never moves an office: only the hall and plinth of its row grow.
// leads: { first, last } = width of a local add-on area (public/local/ofis-extras.js) that opens onto the bar's hall from its left end, on the
// back row's side ('first') and the front row's side ('last'); the bar's hall is made longer to reach it.
export function buildingPlan(bays, leads = {}) {
  const halls = [], hallOfRow = new Map(), all = [];
  for (let i = 0; i < bays; i++) {
    const [k, c] = bayAt(i), zr = mm((k + 1) * PITCH_Z), x0 = mm(c * PITCH), x1 = mm(x0 + CELL_W);
    let hi = hallOfRow.get(k);
    if (hi === undefined) {
      const z0 = mm(zr + ROOM_D + HALL_GAP);
      hi = halls.length;
      hallOfRow.set(k, hi);
      halls.push({ row: k, z0, z1: mm(z0 + HALL_D), open: false, lane: mm(z0 + LANE_OFF), x0, x1, zr, bays: 0 });
    }
    const h = halls[hi];
    h.x0 = Math.min(h.x0, x0); h.x1 = Math.max(h.x1, x1); h.bays++;
    for (const side of ['back', 'front']) {
      all.push({ site: 2 * i + (side === 'back' ? 0 : 1), bay: i, side, row: k, col: c, X: x0, Z: side === 'back' ? zr : mm(zr + ROOM_D + HALL_GAP + HALL_D + WALL_T), W: CELL_W, D: ROOM_D,
        door: side === 'back' ? 'front' : 'back', hall: hi });
    }
  }
  const cells = [];
  let lounge = null;
  for (const c of all) {
    if (c.site === LOUNGE_SITE) lounge = { ...c, slot: -1, lounge: true };
    else cells.push({ ...c, slot: cells.length });
  }
  // add-on areas of the local module: left of the bar, the bar's hall reaches them
  const areas = [];
  if (halls.length && (leads.first || leads.last)) {
    const bar = halls[0], w = Math.max(leads.first || 0, leads.last || 0);
    for (const [key, side] of [['first', 'back'], ['last', 'front']]) {
      if (!leads[key]) continue;
      areas.push({ key, x: mm(bar.x0 - GAP - leads[key]), z: side === 'back' ? bar.zr : mm(bar.zr + ROOM_D + HALL_GAP + HALL_D + WALL_T), w: leads[key], door: side === 'back' ? 'front' : 'back', hall: 0 });
    }
    bar.x0 = mm(bar.x0 - GAP - w);
  }
  // the paved rectangles under the building: x as far as the halls go, z half a gap beyond the offices so that rows above and below meet exactly
  const plinth = halls.map(h => ({ x0: mm(h.x0 - WALL_T - PLINTH_M), x1: mm(h.x1 + WALL_T + PLINTH_M), z0: mm(h.zr - GAP / 2), z1: mm(h.zr + PAIR_D + GAP / 2), hall: halls.indexOf(h) }));
  const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const r of plinth) { bounds.x0 = Math.min(bounds.x0, r.x0); bounds.x1 = Math.max(bounds.x1, r.x1); bounds.z0 = Math.min(bounds.z0, r.z0); bounds.z1 = Math.max(bounds.z1, r.z1); }
  const inner = { x0: Math.min(...halls.map(h => h.x0)), x1: Math.max(...halls.map(h => h.x1)), z0: Math.min(...halls.map(h => h.zr)), z1: Math.max(...halls.map(h => h.zr + PAIR_D)) };
  return { cells, lounge, halls, areas, plinth, bounds, width: inner.x1, depth: inner.z1, inner, bays, size: cells.length };
}

// ------------------------------------------------------------ projection of the building (the camera of ofis.js, for the numbers behind the layout)

const hyp = Math.hypot;
const VIEW = [1, 0.9, 1].map(v => v / hyp(1, 0.9, 1));
const RIGHT = [1 / hyp(1, 1), 0, -1 / hyp(1, 1)];
const UP = (() => { const c = [VIEW[1] * RIGHT[2] - VIEW[2] * RIGHT[1], VIEW[2] * RIGHT[0] - VIEW[0] * RIGHT[2], VIEW[0] * RIGHT[1] - VIEW[1] * RIGHT[0]]; const l = hyp(...c); return c.map(v => v / l); })();
export const WALL_TOP = 2.2 + 0.7, FLOOR_LOW = -0.5;                // the heights the fit frames: from below the floor to above the walls
// where a ground point (x, z) at height y is on the screen, in metres along the camera's right and up axes
export const projectPoint = (x, y, z) => [x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2], x * UP[0] + y * UP[1] + z * UP[2]];
// the box the fit frames: the plinth rectangles' corners, from the floor to above the walls (the same as projBounds in ofis.js)
export function projectedBox(rects) {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const r of rects) for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) for (const y of [FLOOR_LOW, WALL_TOP]) {
    const [a, b] = projectPoint(x, y, z);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  return { a0, a1, b0, b1, w: a1 - a0, h: b1 - b0 };
}
// the ground area the rectangles cover once (they may touch but never overlap), as it is on the screen, in square metres
export function projectedArea(rects) {
  const J = Math.abs(RIGHT[0] * UP[2] - RIGHT[2] * UP[0]);
  const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((p, q) => p - q), zs = [...new Set(rects.flatMap(r => [r.z0, r.z1]))].sort((p, q) => p - q);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (rects.some(r => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)) area += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
  }
  return area * J;
}
// the zoom the automatic view takes (ofis.js fit): the box in what is left of the window after the padding (the bar on top, the shelf card at the right)
export function fitZoom(box, vw, vh, { top = 80, right = 24, bottom = 16, left = 18, min = 3, max = 70 } = {}) {
  return Math.min(max, Math.max(min, Math.min((vw - left - right) / box.w, (vh - top - bottom) / box.h)));
}

// ------------------------------------------------------------ desk capacity of a room

// The class that fits `demand` desks (working sub-agents, seated or on their way): at least BASE_CLS, at most MAX_CLS.
export function classFor(demand) {
  for (let c = BASE_CLS; c < MAX_CLS; c++) if (demand <= CAP[c]) return c;
  return MAX_CLS;
}

// A room grows at once and shrinks only after SHRINK_MS of lower demand (and once the figures present fit the smaller class).
// st: { cls, low } (cls null = new room); returns the new state.
export function nextClass(st, want, have, nowMs, instant = false) {
  if (instant || st.cls == null) return { cls: want, low: 0 };
  if (want > st.cls) return { cls: want, low: 0 };
  if (want < st.cls) {
    const low = st.low || nowMs;
    if (nowMs - low > SHRINK_MS && have <= CAP[want]) return { cls: want, low: 0 };
    return { cls: st.cls, low };
  }
  return { cls: st.cls, low: 0 };
}

// ------------------------------------------------------------ slots: which chat has which office

const MEMORY = 400;                      // chats whose last slot is remembered (the newest ones)

// Which chats get an office is the caller's rule: an asleep chat is on the shelf and a closed one is gone, so neither is in the list, and both
// give their slot back. The slot each chat last had is remembered: a chat that wakes (or a session that is resumed) gets it back if it is still
// free, otherwise the lowest free slot. saved: what toJSON() returned before (the page keeps it in localStorage), used only when it was made for
// this arrangement of offices (LAYOUT_ID). Without it the slots are derived from the chats alone: the oldest chat (order, then id) takes slot 0,
// the next one slot 1, and so on, so the same chats give the same offices after a reload.
export function createSlots({ minRooms = MIN_ROOMS, saved = null } = {}) {
  const minBays = baysFor(minRooms);
  const slotOf = new Map();
  const memory = new Map();              // chat id → the slot it last had (oldest first)
  if (saved && saved.layout === LAYOUT_ID && saved.slots && typeof saved.slots === 'object') {
    for (const [id, s] of Object.entries(saved.slots)) if (Number.isInteger(s) && s >= 0) memory.set(id, s);
  }
  const remember = (id, s) => {
    memory.delete(id);
    memory.set(id, s);
    if (memory.size > MEMORY) memory.delete(memory.keys().next().value);
  };
  let bays = minBays, lowSince = 0;

  return {
    minBays,
    get bays() { return bays; },
    get size() { return officesIn(bays); },
    // chats: [{ id, order }] (every chat that has an office). Returns { slotOf: Map id → slot, bays, size, grew, shrank }.
    update(chats, nowMs) {
      const live = new Set(chats.map(c => c.id));
      for (const id of [...slotOf.keys()]) if (!live.has(id)) slotOf.delete(id);          // the slot is remembered, not kept: someone else may take it
      const used = new Set(slotOf.values());
      // a remembered slot is only honoured inside the building as it will be: the offices it has, or as many as this many chats need
      const limit = Math.max(officesIn(bays), officesIn(baysForOffices(chats.length)));
      const fresh = chats.filter(c => !slotOf.has(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const c of fresh) {
        let s = memory.get(c.id);
        if (!Number.isInteger(s) || s >= limit || used.has(s)) { s = 0; while (used.has(s)) s++; }
        slotOf.set(c.id, s);
        used.add(s);
        remember(c.id, s);
      }
      const top = used.size ? Math.max(...used) : -1;
      const need = Math.max(minBays, top >= 0 ? baysForSlot(top) : 0);
      const was = bays;
      if (need > bays) { bays = need; lowSince = 0; }
      else if (need < bays) {
        if (!lowSince) lowSince = nowMs;
        if (nowMs - lowSince > SHRINK_MS) { bays = need; lowSince = 0; }
      } else lowSince = 0;
      return { slotOf: new Map(slotOf), bays, size: officesIn(bays), grew: bays > was, shrank: bays < was };
    },
    toJSON() { return { v: 2, layout: LAYOUT_ID, slots: Object.fromEntries(memory) }; },
  };
}
