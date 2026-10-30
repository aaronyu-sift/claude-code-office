// The look of an occupied office in the 3D scene: six room styles, which style a project gets, and the plan of one room (what stands where, its windows
// and its light sources). Pure: no three.js, no DOM, so node can test it (test/ofis-styles.test.mjs). ofis-decor.js draws the plan, ofis.js calls both.
//
//   STYLES / STYLE_IDS               study, lab, garden, library, studio, cafe: floor, wall tint, palette of the pack models, furniture and lights
//   assignStyles(projects, pinned)   the style of every project: a pure function of the set of projects (all different while there are six or fewer, then
//                                    the least used, never next to the same style when a neighbour map is given); a project that has a style keeps it
//   neighbourSlots(slot, perRow)     the offices next to an office (same row, and across the hall)
//   planRoom(styleId, ctx)           { items, windows, lights, zones, lounge }: the items of the room in room coordinates (x east, z south; the walls are x = 0
//                                    and z = 0), ctx = { cls, door, W, D, rowsZ }; nothing in it stands on a desk, a chair, a walking lane or another item
//   floorColour / wallColour / paletteSpec   the colours a style gives a room (project theme + style)
//
// The desks, the chief's corner, the door and the sign are not the style's business: they come from ofis-layout.js and buildRoom.
import { hash, parseHex } from './util.js';
import { CHEF_W, COL_W, COLS, ROOM_D } from './ofis-layout.js';

export const STYLE_IDS = ['study', 'lab', 'garden', 'library', 'studio', 'cafe'];
export const ROWS_Z = [1.6, 3.4, 5.2];                 // the rows of sub-agent desks (ofis.js has the same numbers; ctx.rowsZ overrides them)
export const WALL_H = 2.2;
export const SIGN_X = [0.35, 6.05];                    // the sign on the north wall (ofis.js: signX0 .. 0.3 + 5.4 + margin)
export const DOOR_BACK_W = 1.1;                        // the glass door of a back-row office, as wide as its frame, centred on W - 1
export const WIN_Y = [0.95, 2.05];                     // a window sits between the wainscot and the top rail of the wall

// ------------------------------------------------------------ colours

const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const mixHex = (a, b, t) => { const p = parseHex(a), q = parseHex(b); return '#' + [0, 1, 2].map(i => hex2(p[i] + (q[i] - p[i]) * t)).join(''); };
export const shadeHex = (c, t) => mixHex(c, t > 0 ? '#ffffff' : '#000000', Math.abs(t));

// the light of a source, by tone: the colour of its bulb and glow (linear-ish 0..1 triples are made in ofis-light.js)
export const TONES = {
  warm: '#ffc77a', candle: '#ffae52', cool: '#cfe6ff', led: '#8fffc0', cyan: '#7fe3ff', rose: '#ff9fb2', gold: '#ffd766', green: '#b5ec8e', sky: '#8fd3ff',
};

// Each style: floor (colour, pattern of the floor texture, how much of the project's own floor colour shows), wall (a tint mixed into the project's wall colour),
// pack (the colours of the pack models: wood, upholstery, the lamp's shade, metal), items (see ITEM KINDS below).
const m = (m, x, z, o = {}) => ({ k: 'm', m, x, z, ...o });                      // a pack model standing on the floor (or on `y`)
const lamp = (m, x, z, o = {}) => ({ k: 'lamp', m, x, z, tone: 'warm', ...o });   // a pack lamp with its light
const win = (wall, c, w, h, y0, o = {}) => ({ k: 'win', wall, c, w, h, y0, ...o });

export const STYLES = {
  study: {
    id: 'study', name: 'Warm wood study',
    floor: { hex: '#a4744a', pattern: 'planks', theme: 0.1 }, wall: { tint: '#d9a56e', mix: 0.4 }, wain: -0.3,
    pack: { wood: '#a8693a', fabric: '#8f3f35', fabric2: '#c9a24e', shade: '#f5dfae', metal: '#c9a24e', accent: '#7a2f2a' },
    items: [
      win('n', 8.0, 1.1, 1.0, 1.0, { curtain: '#8f3f35' }), win('n', 10.0, 1.1, 1.0, 1.0, { curtain: '#8f3f35' }),
      { k: 'clock', wall: 'n', c: 6.55 },
      { k: 'pics', wall: 'w', c: 3.4, n: 3 },
      { k: 'shelf', x: 0.21, z: 5.32 },
      m('sideTableDrawers', 0.38, 1.4, { ry: Math.PI / 2 }),
      lamp('lampRoundTable', 0.38, 1.4, { y: 0.65, s: 1.4, on: true }),
      m('pottedPlant', 0.5, 0.45, { s: 1.9 }),
      m('loungeChairRelax', 2.35, 5.45, { ry: 0 }),
      lamp('lampRoundFloor', 1.4, 5.95),
      { k: 'rug', m: 'rugRounded', x: 10.0, z: 3.4, s: 2.4, role: 'fabric', lounge: true },
      m('loungeSofa', 11.65, 3.4, { ry: -Math.PI / 2, role: 'fabric', lounge: true }),
      m('tableCoffee', 10.2, 3.4, { ry: Math.PI / 2, lounge: true }),
      { k: 'candle', x: 10.2, z: 3.1, y: 0.4, n: 2, spread: 0.45, lounge: true, on: true },
      m('books', 10.2, 3.7, { y: 0.4, s: 1.8, ry: 0.4, lounge: true, on: true }),
      m('loungeChair', 10.2, 1.85, { ry: 0, role: 'fabric', lounge: true }),
      m('loungeChair', 10.2, 4.95, { ry: Math.PI, role: 'fabric', lounge: true }),
      lamp('lampRoundFloor', 11.95, 1.5, { lounge: true }),
      m('pillow', 11.65, 2.95, { y: 0.35, s: 1.7, ry: -Math.PI / 2, role: 'fabric2', lounge: true, on: true }),
    ],
  },
  lab: {
    id: 'lab', name: 'Cool tech lab',
    floor: { hex: '#8da2b6', pattern: 'tile', theme: 0.1 }, wall: { tint: '#cdd9e6', mix: 0.55 }, wain: 0.05,
    pack: { wood: '#d9d2c3', fabric: '#4c627a', fabric2: '#7fb6d6', shade: '#e4f1ff', metal: '#a8b4c4', accent: '#4c627a' },
    items: [
      win('n', 8.3, 1.4, 0.95, 1.0), win('n', 10.4, 1.4, 0.95, 1.0),
      { k: 'screen', wall: 'n', c: 6.7, y: 1.4, w: 1.15, h: 0.7, tone: 'cyan' },
      { k: 'wb', wall: 'w', c: 3.4, w: 1.6 },
      { k: 'rack', x: 0.4, z: 5.3 },
      { k: 'printer', x: 0.38, z: 1.4 },
      m('pottedPlant', 0.5, 0.45, { s: 1.7 }),
      lamp('lampSquareFloor', 2.0, 6.0, { tone: 'cool' }),
      m('plantSmall2', 2.4, 0.7, { s: 2.0 }),
      m('table', 9.6, 2.5, { lounge: true }),
      m('laptop', 9.4, 2.5, { y: 0.56, s: 1.0, lounge: true, on: true, ry: 0 }),
      m('table', 9.6, 4.5, { lounge: true }),
      m('laptop', 9.9, 4.5, { y: 0.56, s: 1.0, lounge: true, on: true, ry: Math.PI }),
      m('stoolBar', 9.2, 3.35, { lounge: true }),
      m('stoolBar', 10.1, 3.35, { lounge: true }),
      { k: 'rug', m: 'rugSquare', x: 10.9, z: 3.4, s: 2.4, role: 'fabric2', lounge: true },
      m('loungeDesignSofa', 11.95, 3.4, { ry: -Math.PI / 2, role: 'fabric', lounge: true }),
      m('speaker', 11.95, 1.6, { s: 1.7, lounge: true }),
      m('speaker', 11.95, 5.2, { s: 1.7, lounge: true }),
    ],
  },
  garden: {
    id: 'garden', name: 'Garden room',
    floor: { hex: '#7db36c', pattern: 'grass', theme: 0.1 }, wall: { tint: '#bcdca2', mix: 0.5 }, wain: -0.1,
    pack: { wood: '#c9b37a', fabric: '#6f9a62', fabric2: '#e8d9a8', shade: '#fff0c4', metal: '#9aa68a', accent: '#4f9a5a' },
    items: [
      win('n', 8.0, 1.3, 1.0, 0.95), win('n', 10.3, 1.3, 1.0, 0.95),
      win('w', 3.4, 1.8, 0.95, 1.0),
      { k: 'bulbs', a: [6.3, 2.12, 0.13], b: [11.0, 2.12, 0.13], n: 9, sag: 0.12, tone: 'multi' },
      { k: 'plantwall', x: 0.22, z: 5.45 },
      m('pottedPlant', 0.5, 0.45, { s: 2.0 }),
      m('pottedPlant', 1.5, 0.4, { s: 1.6 }),
      m('pottedPlant', 1.2, 6.3, { s: 1.7 }),
      lamp('lampRoundFloor', 2.0, 6.1),
      { k: 'rug', m: 'rugRound', x: 10.0, z: 3.4, s: 2.6, role: 'fabric', lounge: true },
      m('tableRound', 10.0, 3.4, { lounge: true }),
      { k: 'candle', x: 10.0, z: 3.4, y: 0.62, n: 3, spread: 0.3, lounge: true, on: true },
      m('plantSmall2', 10.25, 3.55, { y: 0.62, s: 1.6, lounge: true, on: true }),
      m('loungeChair', 8.55, 3.4, { ry: Math.PI / 2, role: 'fabric', lounge: true }),
      m('loungeChair', 11.45, 3.4, { ry: -Math.PI / 2, role: 'fabric', lounge: true }),
      m('loungeSofaLong', 10.0, 1.7, { ry: 0, role: 'fabric', lounge: true }),
      m('pottedPlant', 12.0, 5.3, { s: 1.9, lounge: true }),
      m('pottedPlant', 7.95, 5.5, { s: 1.6, lounge: true }),
      m('plantSmall3', 8.25, 1.35, { s: 1.8, lounge: true }),
    ],
  },
  library: {
    id: 'library', name: 'Library',
    floor: { hex: '#74492f', pattern: 'parquet', theme: 0.08 }, wall: { tint: '#6f8f7a', mix: 0.55 }, wain: -0.35,
    pack: { wood: '#6b4630', fabric: '#355c4a', fabric2: '#8f3f35', shade: '#f7e6b8', metal: '#b08d4a', accent: '#355c4a' },
    items: [
      win('n', 9.0, 0.9, 1.1, 0.95, { curtain: '#355c4a' }),
      { k: 'sconce', wall: 'n', c: 7.4, y: 1.55, tone: 'warm' }, { k: 'sconce', wall: 'n', c: 10.6, y: 1.55, tone: 'warm' },
      { k: 'clock', wall: 'n', c: 6.55 },
      { k: 'shelf', x: 0.21, z: 1.4 }, { k: 'shelf', x: 0.21, z: 3.4 }, { k: 'shelf', x: 0.21, z: 5.32 },
      m('pottedPlant', 0.5, 0.45, { s: 1.6 }),
      m('loungeChairRelax', 2.35, 5.45, { ry: 0, role: 'fabric' }),
      lamp('lampSquareFloor', 1.4, 5.95),
      { k: 'rug', m: 'rugRectangle', x: 10.1, z: 3.4, s: 2.6, role: 'fabric2', lounge: true },
      m('tableCoffee', 10.1, 3.4, { ry: Math.PI / 2, lounge: true }),
      m('books', 10.1, 3.1, { y: 0.4, s: 1.8, lounge: true, on: true, ry: 0.2 }),
      { k: 'candle', x: 10.1, z: 3.7, y: 0.4, n: 1, spread: 0, lounge: true, on: true },
      m('loungeChair', 10.1, 1.9, { ry: 0, role: 'fabric', lounge: true }),
      m('loungeChair', 10.1, 4.9, { ry: Math.PI, role: 'fabric', lounge: true }),
      m('bookcaseOpenLow', 12.0, 3.4, { ry: -Math.PI / 2, lounge: true, s: 1.9, fp: [0.5, 1.5] }),
    ],
  },
  studio: {
    id: 'studio', name: 'Minimal studio',
    floor: { hex: '#d8c3a0', pattern: 'planks', theme: 0.05 }, wall: { tint: '#f0ebe0', mix: 0.7 }, wain: -0.05,
    pack: { wood: '#e0cfae', fabric: '#d8d2c6', fabric2: '#9ab0c4', shade: '#fff6dc', metal: '#b9bec7', accent: '#9ab0c4' },
    items: [
      win('n', 9.0, 2.6, 1.0, 0.95),
      { k: 'wb', wall: 'n', c: 6.95, w: 1.4, y: 1.45 },
      win('w', 3.4, 1.8, 1.05, 0.95),
      m('pottedPlant', 0.5, 0.45, { s: 2.2 }),
      m('bookcaseOpenLow', 0.3, 5.35, { ry: Math.PI / 2, s: 1.9 }),
      m('plantSmall3', 0.3, 5.15, { y: 0.78, s: 1.6, on: true }),
      lamp('lampRoundFloor', 1.5, 6.2, { s: 1.0 }),
      { k: 'rug', m: 'rugRound', x: 10.0, z: 3.4, s: 2.8, role: 'fabric', lounge: true },
      m('loungeDesignSofa', 11.7, 3.4, { ry: -Math.PI / 2, role: 'fabric2', lounge: true }),
      m('loungeChairRelax', 9.4, 2.0, { ry: 0, role: 'fabric', lounge: true }),
      m('sideTable', 8.4, 2.0, { s: 1.3, lounge: true, fp: [0.7, 0.3] }),
      lamp('lampRoundTable', 8.4, 2.0, { y: 0.5, s: 1.2, lounge: true, on: true }),
      m('tableCoffeeGlass', 10.2, 3.4, { ry: Math.PI / 2, lounge: true }),
    ],
  },
  cafe: {
    id: 'cafe', name: 'Coffee corner',
    floor: { hex: '#cdbb98', pattern: 'checker', theme: 0.05 }, wall: { tint: '#f0b765', mix: 0.5 }, wain: -0.2,
    pack: { wood: '#a8703f', fabric: '#c85f4a', fabric2: '#2f3541', shade: '#ffe3a8', metal: '#8b929f', accent: '#c85f4a' },
    items: [
      win('n', 8.0, 1.2, 1.0, 1.0), win('n', 10.2, 1.2, 1.0, 1.0),
      { k: 'wb', wall: 'w', c: 3.4, w: 1.6, menu: true },
      { k: 'bulbs', a: [6.3, 2.12, 0.13], b: [11.0, 2.12, 0.13], n: 8, sag: 0.1, tone: 'warm' },
      m('coatRackStanding', 0.45, 0.42, { s: 1.5 }),
      m('kitchenFridgeSmall', 0.35, 1.0, { ry: Math.PI / 2, s: 1.6 }),
      m('kitchenCabinet', 0.42, 1.72, { ry: Math.PI / 2, s: 1.6 }),
      m('kitchenCoffeeMachine', 0.42, 1.72, { y: 0.72, s: 1.5, ry: Math.PI / 2, on: true }),
      m('pottedPlant', 0.5, 6.2, { s: 1.6 }),
      lamp('lampSquareFloor', 2.0, 6.0),
      m('tableRound', 9.0, 2.4, { lounge: true }),
      m('stoolBar', 8.2, 2.4, { lounge: true }), m('stoolBar', 9.8, 2.4, { lounge: true }),
      { k: 'candle', x: 9.0, z: 2.4, y: 0.62, n: 1, spread: 0, lounge: true, on: true },
      m('tableRound', 9.0, 4.6, { lounge: true }),
      m('stoolBar', 8.2, 4.6, { lounge: true }), m('stoolBar', 9.8, 4.6, { lounge: true }),
      { k: 'candle', x: 9.0, z: 4.6, y: 0.62, n: 1, spread: 0, lounge: true, on: true },
      m('benchCushion', 12.0, 2.4, { ry: -Math.PI / 2, s: 2.0, role: 'fabric', lounge: true }),
      m('benchCushion', 12.0, 4.6, { ry: -Math.PI / 2, s: 2.0, role: 'fabric', lounge: true }),
    ],
  },
};

// ------------------------------------------------------------ the pack models: their size (x, y, z in the file's own units; test/ofis-styles.test.mjs reads them back from the files)

export const SCALE = 1.7;                       // the scale of the furniture in the scene: a desk is 1.2 m long, a sofa 1.7 m
export const MODEL_SIZE = {
  lampRoundFloor: [0.15, 0.86, 0.18], lampRoundTable: [0.15, 0.31, 0.18], lampSquareFloor: [0.12, 0.86, 0.12], lampSquareTable: [0.12, 0.29, 0.12],
  loungeSofa: [0.98, 0.46, 0.41], loungeSofaLong: [0.98, 0.46, 0.82], loungeChair: [0.49, 0.46, 0.41], loungeChairRelax: [0.49, 0.63, 0.67],
  loungeDesignSofa: [1.12, 0.40, 0.41], stoolBar: [0.27, 0.43, 0.23], benchCushion: [0.40, 0.46, 0.20],
  tableCoffee: [0.66, 0.23, 0.40], tableCoffeeGlass: [0.66, 0.23, 0.40], tableRound: [0.69, 0.37, 0.80], table: [0.84, 0.33, 0.45], sideTable: [0.53, 0.38, 0.22],
  sideTableDrawers: [0.53, 0.38, 0.39], bookcaseOpenLow: [0.40, 0.40, 0.25], coatRackStanding: [0.27, 0.77, 0.27],
  kitchenCoffeeMachine: [0.27, 0.30, 0.33], kitchenFridgeSmall: [0.43, 0.60, 0.32], kitchenCabinet: [0.43, 0.45, 0.48],
  speaker: [0.15, 0.64, 0.15], laptop: [0.60, 0.37, 0.55],
  pottedPlant: [0.25, 0.54, 0.29], plantSmall2: [0.19, 0.28, 0.19], plantSmall3: [0.17, 0.29, 0.20],
  books: [0.15, 0.10, 0.09], pillow: [0.23, 0.22, 0.09], rugRound: [0.92, 0.01, 0.92], rugRectangle: [1.57, 0.01, 0.92], rugRounded: [1.57, 0.01, 0.92], rugSquare: [0.90, 0.01, 0.92],
};

// ------------------------------------------------------------ which style a project gets

const N = STYLE_IDS.length;
// styles: Map project -> style index. `pinned` (project -> index) is kept as it is: a chat does not change its room's style while the page is open.
// New projects, in the order of their hash (so the result depends on the set of projects and not on who arrived first), take the style their hash
// points at, or the next one that is free: with six projects or fewer no two share a style. With more, a style is reused where it is used least and,
// when `neighbours` (project -> projects next to it) is given, where no neighbour has it. A greedy pass over offices that have at most three
// neighbours always finds a style a neighbour does not have, so two offices next to each other differ whatever the number of chats.
export function assignStyles(projects, pinned = new Map(), neighbours = null) {
  const out = new Map();
  const keys = [...new Set(projects)];
  for (const p of keys) if (pinned.has(p)) out.set(p, pinned.get(p));
  const fresh = keys.filter(p => !out.has(p)).sort((a, b) => hash(a) - hash(b) || (a < b ? -1 : a > b ? 1 : 0));
  const use = new Array(N).fill(0);
  for (const v of out.values()) use[v]++;
  for (const p of fresh) {
    const pref = hash(p) % N, near = new Set(((neighbours && neighbours.get(p)) || []).map(q => out.get(q)).filter(v => v != null));
    let pick = -1;
    if (use.some(u => u === 0)) { for (let i = 0; i < N && pick < 0; i++) if (use[(pref + i) % N] === 0) pick = (pref + i) % N; }
    else {
      let best = Infinity;
      for (let i = 0; i < N; i++) {
        const s = (pref + i) % N, cost = (near.has(s) ? 1000 : 0) + use[s];
        if (cost < best) { best = cost; pick = s; }
      }
    }
    out.set(p, pick);
    use[pick]++;
  }
  return out;
}
// the offices next to an office: the ones left and right of it in its row, and the one across the hall (rows are paired: 0 with 1, 2 with 3, ...)
export function neighbourSlots(slot, perRow) {
  const row = Math.floor(slot / perRow), col = slot % perRow, out = [];
  if (col > 0) out.push(slot - 1);
  if (col < perRow - 1) out.push(slot + 1);
  out.push((row ^ 1) * perRow + col);
  return out;
}
// the planned offices as a list of { project, slot }: every project's neighbours (the projects of the offices next to its own)
export function neighbourMap(list, perRow) {
  const bySlot = new Map(list.map(it => [it.slot, it.project]));
  const out = new Map();
  for (const it of list) out.set(it.project, neighbourSlots(it.slot, perRow).map(s => bySlot.get(s)).filter(p => p != null && p !== it.project));
  return out;
}

// ------------------------------------------------------------ colours a style gives a room

export const styleIndex = id => STYLE_IDS.indexOf(id);
export const styleAt = i => STYLES[STYLE_IDS[((i % N) + N) % N]];
// project theme { wall, floor } -> the room's wall and floor colours
export const wallColour = (theme, st) => mixHex(theme.wall, st.wall.tint, st.wall.mix);
export const floorColour = (theme, st) => mixHex(st.floor.hex, theme.floor, st.floor.theme);
// the colours of the pack models in a style, by the pack's material names; role 'fabric' (the default) or 'fabric2' picks which upholstery colour 'carpet' takes
export function paletteSpec(st, role = 'fabric') {
  const p = st.pack, up = role === 'fabric2' ? p.fabric2 : p.fabric;
  return {
    byName: {
      wood: p.wood, woodDark: shadeHex(p.wood, -0.28), metal: p.metal, metalLight: shadeHex(p.metal, 0.3), metalMedium: '#4a505d', metalDark: '#2a2f3a',
      carpet: up, carpetDarker: shadeHex(up, -0.22), carpetBlue: up, carpetWhite: '#efe9dc', lamp: p.shade, glass: '#bfe0ec',
      plant: '#5f9a5a', _defaultMat: shadeHex(p.wood, -0.2),
    },
  };
}

// ------------------------------------------------------------ the plan of one room

// ITEM KINDS (x east, z south, y up, all in metres from the room's back corner):
//   m / lamp / rug   a pack model (m = file key) at x, z with ry (0: front to +z, PI/2: to +x, PI: to -z, -PI/2: to -x), scale s (SCALE), height y, palette
//                    role ('fabric' | 'fabric2'); a lamp also gives light (tone), a rug lies flat
//   candle           n candles around x, z on a table of height y (spread: distance between them)
//   bulbs            a string of small lights from a to b with a sag
//   win              a window in wall 'n' (north) or 'w' (west), centre c along the wall, w by h, sill at y0, optional curtains
//   screen           a lit panel on a wall (tone), wb: a whiteboard with the project's colour (menu: the cafe's board), pics: framed pictures, clock, sconce: a wall light
//   shelf / plantwall / rack / printer   the bookshelf with books, a wall of potted plants, a server rack with lights, a printer on a stand (procedural pieces)
// flags: lounge (only when the room has its lounge corner, which is where the 12-desk room has its last desk columns), on (stands on something else), fp ([w, d] footprint
// when it is not the model's), h (height of a tall piece, metres)
const FP = { shelf: [0.42, 1.16, 1.65], plantwall: [0.4, 1.4, 1.7], rack: [0.55, 0.75, 1.75], printer: [0.6, 0.9, 1.0] };   // [w (x), d (z), height]; centred on x, z

export function footprint(it) {
  if (it.fp) return it.fp;
  if (it.k === 'm' || it.k === 'lamp' || it.k === 'rug') {
    const sz = MODEL_SIZE[it.m], s = it.s ?? SCALE, w = sz[0] * s, d = sz[2] * s, c = Math.abs(Math.cos(it.ry || 0)), n = Math.abs(Math.sin(it.ry || 0));
    return [w * c + d * n, w * n + d * c];
  }
  if (FP[it.k]) return [FP[it.k][0], FP[it.k][1]];
  return [0.1, 0.1];
}
export function heightOf(it) {
  if (it.h != null) return it.h;
  if (FP[it.k]) return FP[it.k][2];
  if (it.k === 'm' || it.k === 'lamp') return MODEL_SIZE[it.m][1] * (it.s ?? SCALE) + (it.y || 0);
  return 0;
}
export const rectOf = it => { const [w, d] = footprint(it); return [it.x - w / 2, it.x + w / 2, it.z - d / 2, it.z + d / 2]; };
export const hit = (a, b, gap = 0) => a[0] < b[1] - gap && a[1] > b[0] + gap && a[2] < b[3] - gap && a[3] > b[2] + gap;

const LOUNGE_MIN = 1.5;                                          // the old rule of buildRoom: the lounge needs this much width
export function loungeOf(W, cls) {
  const x0 = CHEF_W + COLS[cls] * COL_W + 0.3, x1 = W - 0.3;
  return x1 - x0 >= LOUNGE_MIN ? { x0, x1 } : null;
}
// what a room's furniture must keep clear: the chief's desks and chair, every column of sub-agent desks with its chair, the aisles between the columns, and the strip
// along the wall with the door that the newcomers walk on (ofis.js pathFor)
export function zonesOf({ cls, door, W = 12.6, D = ROOM_D }) {
  const zones = [
    { id: 'chief desk', r: [0.45, 1.5, 2.1, 4.7] },
    { id: 'chief chair', r: [1.45, 2.6, 2.8, 4.0] },
  ];
  for (let c = 0; c < COLS[cls]; c++) {
    const ax = CHEF_W + c * COL_W;
    zones.push({ id: `desks ${c}`, r: [ax + 0.05, ax + 1.68, 0.95, 5.85] });
    zones.push({ id: `aisle ${c}`, r: [ax + 1.68, ax + COL_W + 0.05, 0.3, D - 0.3] });
  }
  zones.push(door === 'front' ? { id: 'lane south', r: [CHEF_W + 1.65, W, D - 1.0, D] } : { id: 'lane north', r: [CHEF_W + 1.65, W, 0, 0.95] });
  return zones;
}

const WALL_BOX = {                                               // [a0, a1, y0, y1] of a wall piece along its wall
  win: it => { const e = it.curtain ? 0.28 : 0.04; return [it.c - it.w / 2 - e, it.c + it.w / 2 + e, it.y0, it.y0 + it.h]; },
  screen: it => [it.c - it.w / 2, it.c + it.w / 2, it.y - it.h / 2, it.y + it.h / 2],
  wb: it => [it.c - (it.w || 1.6) / 2, it.c + (it.w || 1.6) / 2, it.y != null ? it.y - 0.38 : 1.06, it.y != null ? it.y + 0.38 : 1.82],
  pics: it => [it.c - 0.75, it.c + 0.75, 1.3, 1.9],
  clock: it => [it.c - 0.22, it.c + 0.22, 1.33, 1.77],
  sconce: it => [it.c - 0.14, it.c + 0.14, it.y - 0.18, it.y + 0.18],
};
const wallOf = it => it.wall || 'w';
// every wall piece of a plan, as { wall, a0, a1, y0, y1, it }
export function wallBoxes(items) {
  const out = [];
  for (const it of items) {
    if (!WALL_BOX[it.k]) continue;
    const [a0, a1, y0, y1] = WALL_BOX[it.k](it);
    out.push({ wall: wallOf(it), a0, a1, y0, y1, it });
  }
  return out;
}
// does a tall floor piece stand in front of (or behind) a window of its wall
export function floorBlocksWindow(f, w) {
  const h = heightOf(f);
  if (h <= w.y0) return false;
  const r = rectOf(f);
  return w.wall === 'w' ? r[0] < 0.8 && r[2] < w.a1 && r[3] > w.a0 : r[2] < 0.8 && r[0] < w.a1 && r[1] > w.a0;
}

const DESK_LAMP = { study: 'lampRoundTable', lab: 'lampSquareTable', garden: 'lampRoundTable', library: 'lampRoundTable', studio: 'lampRoundTable', cafe: 'lampSquareTable' };
const DESK_LAMP_TONE = { lab: 'cool' };
export const CHIEF_LAMP = { x: 0.62, z: 2.36, s: 1.4 };            // the lamp on the chief's desk; its height is the desk top (ofis.js)

// the plan of a room: ctx = { cls, door ('front' | 'back'), W, D, top (height of the chief's desk) }
const FLOOR_KINDS = new Set(['m', 'lamp', 'rug', 'candle', 'shelf', 'plantwall', 'rack', 'printer']);
const planCache = new Map();
export function planRoom(styleId, ctx) {
  const st = STYLES[styleId];
  if (!st) throw new Error('no such style: ' + styleId);
  const { cls, door, W = 12.6, D = ROOM_D, top = 0.65 } = ctx;
  const key = [styleId, cls, door, W, D, top].join('|');
  if (planCache.has(key)) return planCache.get(key);
  const lounge = loungeOf(W, cls), dropped = [];
  const keep = it => {
    if (it.lounge && !lounge) { dropped.push([it, 'no lounge']); return false; }
    if (it.k === 'win' || it.k === 'clock' || it.k === 'sconce' || it.k === 'pics') {
      const len = wallOf(it) === 'n' ? W : D, [a0, a1] = WALL_BOX[it.k](it);
      if (a0 < 0.15 || a1 > len - 0.15) { dropped.push([it, 'off the wall']); return false; }
      if (wallOf(it) === 'n' && door === 'back' && a1 > W - 1 - DOOR_BACK_W / 2 - 0.1 && a0 < W - 1 + DOOR_BACK_W / 2 + 0.1) { dropped.push([it, 'over the door']); return false; }
    }
    if (it.k === 'bulbs' && (it.b[0] > W - 0.3 || (door === 'back' && it.b[0] > W - 1 - DOOR_BACK_W / 2))) { dropped.push([it, 'over the door']); return false; }
    return true;
  };
  const items = [{ k: 'lamp', m: DESK_LAMP[styleId], x: CHIEF_LAMP.x, z: CHIEF_LAMP.z, y: top, s: CHIEF_LAMP.s, on: true, chief: true, tone: DESK_LAMP_TONE[styleId] || 'warm' },
    ...st.items.filter(keep).map(it => ({ ...it }))];
  // every office has a window and a light, whatever its style or cell: a style that lost its windows gets one on the west wall above the chief's desks
  if (!items.some(it => it.k === 'win')) items.push(win('w', 3.4, 1.4, 1.0, 1.0));
  for (let i = 0; i < items.length; i++) { items[i].id = `${styleId}-${i}`; if (items[i].y == null && FLOOR_KINDS.has(items[i].k)) items[i].y = 0; }     // wall pieces have a height of their own (or a fixed one)
  const plan = { style: styleId, items, windows: items.filter(it => it.k === 'win'), lights: lightsOf(items, styleId), zones: zonesOf({ cls, door, W, D }), lounge, dropped, W, D, cls, door };
  planCache.set(key, plan);
  return plan;
}

// ------------------------------------------------------------ the light sources of a plan

// r: the glow (metres); pool: the light on the floor around it (0 = none); floorY: the height of what it stands on
const LIGHT_OF = {
  lamp: it => ({ kind: 'lamp', x: it.x, z: it.z, y: (it.y || 0) + MODEL_SIZE[it.m][1] * (it.s ?? SCALE) * 0.78, tone: it.tone || 'warm', r: it.y ? 0.42 : 0.62, pool: it.y ? 0.85 : 1.5, floorY: it.y || 0 }),
  sconce: it => (it.wall === 'n' ? { kind: 'sconce', x: it.c, z: 0.27, y: it.y, tone: it.tone || 'warm', r: 0.55, pool: 0, floorY: 0 } : { kind: 'sconce', x: 0.27, z: it.c, y: it.y, tone: it.tone || 'warm', r: 0.55, pool: 0, floorY: 0 }),
  screen: it => (it.wall === 'n' ? { kind: 'screen', x: it.c, z: 0.1, y: it.y, tone: it.tone || 'cyan', r: 0.95, pool: 0, floorY: 0 } : { kind: 'screen', x: 0.1, z: it.c, y: it.y, tone: it.tone || 'cyan', r: 0.95, pool: 0, floorY: 0 }),
};
const BULB_TONES = ['warm', 'rose', 'gold', 'sky', 'green'];
export function lightsOf(items, styleId = '') {
  const out = [];
  const add = l => out.push({ ...l, id: out.length, phase: (hash(styleId + ':' + out.length) % 1000) / 1000 });
  for (const it of items) {
    if (LIGHT_OF[it.k]) add(LIGHT_OF[it.k](it));
    else if (it.k === 'candle') {
      for (let i = 0; i < it.n; i++) {
        const a = it.n === 1 ? 0 : -it.spread / 2 + i * it.spread / (it.n - 1);
        add({ kind: 'candle', x: it.x, z: it.z + a, y: it.y + 0.13, tone: 'candle', r: 0.3, pool: 0.5, floorY: it.y });
      }
    } else if (it.k === 'bulbs') {
      for (let i = 0; i < it.n; i++) {
        const t = it.n === 1 ? 0.5 : i / (it.n - 1), sag = Math.sin(t * Math.PI) * it.sag;
        add({ kind: 'bulb', x: it.a[0] + (it.b[0] - it.a[0]) * t, z: it.a[2] + (it.b[2] - it.a[2]) * t, y: it.a[1] + (it.b[1] - it.a[1]) * t - sag, tone: it.tone === 'multi' ? BULB_TONES[i % BULB_TONES.length] : it.tone, r: 0.2, pool: 0, floorY: 0 });
      }
    } else if (it.k === 'rack') {
      for (let i = 0; i < 4; i++) add({ kind: 'led', x: it.x + 0.3, z: it.z + (i % 2 ? 0.14 : -0.14), y: 0.7 + Math.floor(i / 2) * 0.45, tone: 'led', r: 0.1, pool: 0, floorY: 0 });
    }
  }
  return out;
}
