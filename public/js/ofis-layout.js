// Stable layout of the 3D office: the decisions behind it, with no WebGL and no DOM so that node can test them (test/ofis-layout.test.mjs).
// ofis.js draws what this file decides.
//
//   The building is laid out for MIN_ROOMS chats from the first frame: two rows of MIN_ROOMS / 2 offices with a hall between them. An office
//   with no chat is a vacant office. A chat takes the lowest free office (its slot) and keeps it until the chat closes, so nobody else's
//   office moves when chats come and go. Every office is a fixed cell, CELL_W wide, the width of the largest room class: a room builds its
//   desks inside the cell and the rest of the cell is a lounge, so a chat whose sub-agents outgrow its desks (BASE_CLS to MAX_CLS) grows in
//   place and no wall of any other room moves.
//   Only more chats than offices expand the building: a whole row of offices is appended after the last row (earlier rows keep their place),
//   and the row goes away again after SHRINK_MS without a chat in it.
//
// To change the minimum: MIN_ROOMS below, or `?rooms=N` on the page address (2 to MAX_ROOMS), for example `/?scene=3d&rooms=6#ofis`.

export const MIN_ROOMS = 10;             // chats the building is laid out for; an odd number gives one vacant office more
export const MAX_ROOMS = 60;             // the largest `?rooms=` accepted
export const MIN_ROWS = 2;               // rows of the smallest building (a back row and a front row, a hall between them)
export const BASE_CLS = 1;               // room class every office is built with (6 desks): a chat with up to that many sub-agents never changes its room
export const MAX_CLS = 2;                // the class a room grows to when sub-agents outgrow BASE_CLS (12 desks); more show as "+N" on the sign
export const VACANT_CLS = BASE_CLS;      // the class a vacant office is furnished with
export const SHRINK_MS = 60e3;           // a bigger class, or an appended row, is given up after this long without need

// ------------------------------------------------------------ dimensions (1 unit is about 1 meter)

export const WALL_T = 0.16;
export const ROOM_D = 6.8, CHEF_W = 3.2, COL_W = 2.1, FRONT_M = 1.0, GAP = 1.5;
export const HALL_D = 5.0, HALL_OPEN_D = 3.6, HALL_GAP = 0.18;     // depth of the hall between two rows / of the open hall in front of a last row
export const COLS = [1, 2, 4];                                      // room class → desk columns (3 desks per column)
export const CAP = COLS.map(c => c * 3);                            // desks (sub-agents) per class: 3, 6 and 12
export const roomW = cls => CHEF_W + COLS[cls] * COL_W + FRONT_M;   // the room as wide as its desks need
export const CELL_W = roomW(MAX_CLS);                               // every office takes this much of its row

// `?rooms=N` of a page address (search string), else the default; anything that is not a whole number from 2 to MAX_ROOMS is ignored
export function minRoomsFrom(search, dflt = MIN_ROOMS) {
  const v = new URLSearchParams(search || '').get('rooms');
  const n = v != null && /^\d+$/.test(v) ? Number(v) : NaN;
  return n >= 2 && n <= MAX_ROOMS ? n : dflt;
}
export const perRowFor = minRooms => Math.max(1, Math.ceil(minRooms / MIN_ROWS));

// ------------------------------------------------------------ rows and halls

// Rows are paired and the hall between them serves both: the back row's door is in its low front wall, the front row's door is the glass door
// in its back wall. A leftover last row has its hall in front (the building's facade). Adding a row never moves the rows before it.
export function vlayout(r) {
  const rows = [], halls = [];
  let z = 0;
  for (let i = 0; i < r; i += 2) {
    if (i) z += GAP;
    rows.push({ z, door: 'front', hall: halls.length });
    const hz = z + ROOM_D + HALL_GAP;
    if (i + 1 < r) {
      halls.push({ z0: hz, z1: hz + HALL_D, open: false, lane: hz + 1.75 });
      rows.push({ z: hz + HALL_D + WALL_T, door: 'back', hall: halls.length - 1 });
      z = hz + HALL_D + WALL_T + ROOM_D;
    } else {
      halls.push({ z0: hz, z1: hz + HALL_OPEN_D, open: true, lane: hz + HALL_OPEN_D * 0.55 });
      z = hz + HALL_OPEN_D;
    }
  }
  return { rows, halls, d: z };
}

// The building for `rowCount` rows of `perRow` offices. Slot s is in row floor(s / perRow), column s % perRow, so the rows fill one after the other
// and a slot's rectangle depends on its own row and column only. leads: { row: space reserved at the start of that row } (local add-on areas).
export function buildingPlan(rowCount, perRow, leads = {}) {
  const V = vlayout(rowCount);
  const lead = r => leads[r] || 0;
  const cells = [];
  let width = 0;
  for (let r = 0; r < rowCount; r++) {
    width = Math.max(width, lead(r) + perRow * CELL_W + (perRow - 1) * GAP);
    for (let c = 0; c < perRow; c++) {
      cells.push({ slot: r * perRow + c, row: r, col: c, X: lead(r) + c * (CELL_W + GAP), Z: V.rows[r].z, W: CELL_W, D: ROOM_D, door: V.rows[r].door, hall: V.rows[r].hall });
    }
  }
  return { cells, rows: V.rows, halls: V.halls, width, depth: V.d, rowCount, perRow };
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

// saved: what toJSON() returned before (the page keeps it in localStorage), used only when it was made for the same row size.
// Without it the slots are derived from the chats alone: the oldest chat (order, then id) takes slot 0, the next one slot 1, and so on, so
// the same chats give the same offices after a reload.
export function createSlots({ minRooms = MIN_ROOMS, saved = null } = {}) {
  const perRow = perRowFor(minRooms);
  const slotOf = new Map();
  const hint = saved && saved.perRow === perRow && saved.slots && typeof saved.slots === 'object' ? saved.slots : {};
  let rows = MIN_ROWS, lowSince = 0;

  return {
    perRow,
    get rows() { return rows; },
    get size() { return rows * perRow; },
    // chats: [{ id, order }] (every live chat). Returns { slotOf: Map id → slot, rows, size, grew, shrank }.
    update(chats, nowMs) {
      const live = new Set(chats.map(c => c.id));
      for (const id of [...slotOf.keys()]) if (!live.has(id)) slotOf.delete(id);
      const used = new Set(slotOf.values());
      const fresh = chats.filter(c => !slotOf.has(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const c of fresh) {
        let s = hint[c.id];
        if (!Number.isInteger(s) || s < 0 || used.has(s)) { s = 0; while (used.has(s)) s++; }
        slotOf.set(c.id, s);
        used.add(s);
      }
      const top = used.size ? Math.max(...used) : -1;
      const need = Math.max(MIN_ROWS, Math.floor(top / perRow) + 1);
      const was = rows;
      if (need > rows) { rows = need; lowSince = 0; }
      else if (need < rows) {
        if (!lowSince) lowSince = nowMs;
        if (nowMs - lowSince > SHRINK_MS) { rows = need; lowSince = 0; }
      } else lowSince = 0;
      return { slotOf: new Map(slotOf), rows, size: rows * perRow, grew: rows > was, shrank: rows < was };
    },
    toJSON() { return { v: 1, perRow, slots: Object.fromEntries(slotOf) }; },
  };
}
