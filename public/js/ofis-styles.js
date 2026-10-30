// The look of an office in the 3D scene: six room styles (their colours, the wall pieces, the props and the accents they dress an arrangement with), the pack models' sizes and the
// plan's light sources. Pure: no three.js, no DOM, so node can test it (test/ofis-styles.test.mjs). Which style, which arrangement and where everything stands is ofis-arrange.js,
// ofis-decor.js draws it.
//
//   STYLES / STYLE_IDS               study, lab, garden, library, studio, cafe: floor, wall tint, palette of the pack models, wall pieces, props, accents
//   neighbourSlots(slot, cells)      the offices next to an office in the building plan (across the hall, along it, across the lawn between two rows)
//   floorColour / wallColour / paletteSpec   the colours a style gives a room (the slot's theme + style)
//   MODEL_SIZE / SEAT_TOP / footprint / heightOf / wallBoxes / lightsOf   what the arrangements and the dressing need to place things and to know their light
import { hash, parseHex } from './util.js';

export const STYLE_IDS = ['study', 'lab', 'garden', 'library', 'studio', 'cafe'];

// ------------------------------------------------------------ colours

const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const mixHex = (a, b, t) => { const p = parseHex(a), q = parseHex(b); return '#' + [0, 1, 2].map(i => hex2(p[i] + (q[i] - p[i]) * t)).join(''); };
export const shadeHex = (c, t) => mixHex(c, t > 0 ? '#ffffff' : '#000000', Math.abs(t));

// the light of a source, by tone: the colour of its bulb and glow (linear-ish 0..1 triples are made in ofis-light.js)
export const TONES = {
  warm: '#ffc77a', candle: '#ffae52', cool: '#cfe6ff', led: '#8fffc0', cyan: '#7fe3ff', rose: '#ff9fb2', gold: '#ffd766', green: '#b5ec8e', sky: '#8fd3ff',
};

// Each style: floor (colour, pattern of the floor texture, how much of the project's own floor colour shows), wall (a tint mixed into the project's wall colour),
// pack (the colours of the pack models: wood, upholstery, the lamp's shade, metal), walls (the pieces that hang on a wall; see ITEM KINDS below). The floor furniture is
// the arrangement's (ofis-arrange.js) and the style's props (DRESSING below).
const win = (wall, c, w, h, y0, o = {}) => ({ k: 'win', wall, c, w, h, y0, ...o });

export const STYLES = {
  study: {
    id: 'study', name: 'Warm wood study',
    floor: { hex: '#a4744a', pattern: 'planks', theme: 0.1 }, wall: { tint: '#d9a56e', mix: 0.4 }, wain: -0.3,
    pack: { wood: '#a8693a', fabric: '#8f3f35', fabric2: '#c9a24e', shade: '#f5dfae', metal: '#c9a24e', accent: '#7a2f2a' },
    walls: [
      win('n', 8.0, 1.1, 1.0, 1.0, { curtain: '#8f3f35' }), win('n', 10.0, 1.1, 1.0, 1.0, { curtain: '#8f3f35' }),
      { k: 'clock', wall: 'n', c: 6.55 },
      { k: 'pics', wall: 'w', c: 3.4, n: 3 },
    ],
  },
  lab: {
    id: 'lab', name: 'Cool tech lab',
    floor: { hex: '#8da2b6', pattern: 'tile', theme: 0.1 }, wall: { tint: '#cdd9e6', mix: 0.55 }, wain: 0.05,
    pack: { wood: '#d9d2c3', fabric: '#4c627a', fabric2: '#7fb6d6', shade: '#e4f1ff', metal: '#a8b4c4', accent: '#4c627a' },
    walls: [
      win('n', 8.3, 1.4, 0.95, 1.0), win('n', 10.4, 1.4, 0.95, 1.0),
      { k: 'screen', wall: 'n', c: 6.7, y: 1.4, w: 1.15, h: 0.7, tone: 'cyan' },
      { k: 'wb', wall: 'w', c: 3.4, w: 1.6 },
    ],
  },
  garden: {
    id: 'garden', name: 'Garden room',
    floor: { hex: '#7db36c', pattern: 'grass', theme: 0.1 }, wall: { tint: '#bcdca2', mix: 0.5 }, wain: -0.1,
    pack: { wood: '#c9b37a', fabric: '#6f9a62', fabric2: '#e8d9a8', shade: '#fff0c4', metal: '#9aa68a', accent: '#4f9a5a' },
    walls: [
      win('n', 8.0, 1.3, 1.0, 0.95), win('n', 10.3, 1.3, 1.0, 0.95),
      win('w', 3.4, 1.8, 0.95, 1.0),
      { k: 'bulbs', a: [6.3, 2.12, 0.13], b: [11.0, 2.12, 0.13], n: 9, sag: 0.12, tone: 'multi' },
    ],
  },
  library: {
    id: 'library', name: 'Library',
    floor: { hex: '#74492f', pattern: 'parquet', theme: 0.08 }, wall: { tint: '#6f8f7a', mix: 0.55 }, wain: -0.35,
    pack: { wood: '#6b4630', fabric: '#355c4a', fabric2: '#8f3f35', shade: '#f7e6b8', metal: '#b08d4a', accent: '#355c4a' },
    walls: [
      win('n', 9.0, 0.9, 1.1, 0.95, { curtain: '#355c4a' }),
      { k: 'sconce', wall: 'n', c: 7.4, y: 1.55, tone: 'warm' }, { k: 'sconce', wall: 'n', c: 10.6, y: 1.55, tone: 'warm' },
      { k: 'clock', wall: 'n', c: 6.55 },
    ],
  },
  studio: {
    id: 'studio', name: 'Minimal studio',
    floor: { hex: '#d8c3a0', pattern: 'planks', theme: 0.05 }, wall: { tint: '#f0ebe0', mix: 0.7 }, wain: -0.05,
    pack: { wood: '#e0cfae', fabric: '#d8d2c6', fabric2: '#9ab0c4', shade: '#fff6dc', metal: '#b9bec7', accent: '#9ab0c4' },
    walls: [
      win('n', 9.0, 2.6, 1.0, 0.95),
      { k: 'wb', wall: 'n', c: 6.95, w: 1.4, y: 1.45 },
      win('w', 3.4, 1.8, 1.05, 0.95),
    ],
  },
  cafe: {
    id: 'cafe', name: 'Coffee corner',
    floor: { hex: '#cdbb98', pattern: 'checker', theme: 0.05 }, wall: { tint: '#f0b765', mix: 0.5 }, wain: -0.2,
    pack: { wood: '#a8703f', fabric: '#c85f4a', fabric2: '#2f3541', shade: '#ffe3a8', metal: '#8b929f', accent: '#c85f4a' },
    walls: [
      win('n', 8.0, 1.2, 1.0, 1.0), win('n', 10.2, 1.2, 1.0, 1.0),
      { k: 'wb', wall: 'w', c: 3.4, w: 1.6, menu: true },
      { k: 'bulbs', a: [6.3, 2.12, 0.13], b: [11.0, 2.12, 0.13], n: 8, sag: 0.1, tone: 'warm' },
    ],
  },
};

// What a style adds to an arrangement of furniture (ofis-arrange.js dress): `props` are placed one by one where they fit (at: against the west wall, in a corner, beside the soft part,
// against any wall or anywhere; a prop that fits nowhere is left out), `with` rides on the prop (a lamp on a side table), `accents` stand on the soft part's table. The wall pieces
// (windows, clock, pictures, boards, sconces, the string of bulbs) are the `walls` above.
const P = (m, at, o = {}) => ({ m, at, ...o });
const T = (m, o = {}) => ({ m, ...o });
const KITCHEN = { k: 'cluster', kind: 'kitchen', at: 'wallW', x: 0.45, fp: [0.75, 1.7], h: 1.0 };
export const DRESSING = {
  study: {
    props: [{ k: 'shelf', at: 'wallW', x: 0.21 }, P('sideTableDrawers', 'wallW', { with: [{ m: 'lampRoundTable', y: 0.65, s: 1.4, lamp: true }] }), P('pottedPlant', 'corner', { s: 1.9 }), P('lampRoundFloor', 'soft', { lamp: true }), P('pottedPlant', 'any', { s: 1.5 })],
    accents: [{ k: 'candle', n: 2, spread: 0.3 }, T('books', { s: 1.8, ry: 0.4, dz: 0.18 })],
  },
  lab: {
    props: [{ k: 'rack', at: 'wallW', x: 0.4 }, { k: 'printer', at: 'wallW', x: 0.38 }, P('pottedPlant', 'corner', { s: 1.7 }), P('lampSquareFloor', 'soft', { lamp: true, tone: 'cool' }), P('plantSmall2', 'any', { s: 2.0 }), P('speaker', 'soft', { s: 1.7 }), P('speaker', 'soft', { s: 1.7 })],
    accents: [],
  },
  garden: {
    props: [{ k: 'plantwall', at: 'wallW', x: 0.22 }, P('pottedPlant', 'corner', { s: 2.0 }), P('pottedPlant', 'any', { s: 1.6 }), P('pottedPlant', 'corner', { s: 1.7 }), P('lampRoundFloor', 'soft', { lamp: true }), P('plantSmall3', 'soft', { s: 1.8 })],
    accents: [{ k: 'candle', n: 3, spread: 0.3 }, T('plantSmall2', { s: 1.6, dz: 0.2 })],
  },
  library: {
    props: [{ k: 'shelf', at: 'wallW', x: 0.21 }, { k: 'shelf', at: 'wallW', x: 0.21 }, { k: 'shelf', at: 'wallW', x: 0.21 }, P('bookcaseOpenLow', 'wall', { s: 1.9 }), P('pottedPlant', 'corner', { s: 1.6 }), P('lampSquareFloor', 'soft', { lamp: true })],
    accents: [T('books', { s: 1.8, ry: 0.2, dz: -0.15 }), { k: 'candle', n: 1, spread: 0, dz: 0.2 }],
  },
  studio: {
    props: [P('bookcaseOpenLow', 'wallW', { s: 1.9, with: [{ m: 'plantSmall3', y: 0.76, s: 1.6 }] }), P('pottedPlant', 'corner', { s: 2.2 }), P('lampRoundFloor', 'soft', { lamp: true, s: 1.0 }), P('sideTable', 'soft', { s: 1.3, with: [{ m: 'lampRoundTable', y: 0.5, s: 1.2, lamp: true }] })],
    accents: [T('plantSmall3', { s: 1.6 })],
  },
  cafe: {
    props: [KITCHEN, P('coatRackStanding', 'corner', { s: 1.5 }), P('pottedPlant', 'corner', { s: 1.6 }), P('lampSquareFloor', 'soft', { lamp: true })],
    accents: [{ k: 'candle', n: 1, spread: 0 }],
  },
};
for (const id of STYLE_IDS) Object.assign(STYLES[id], DRESSING[id]);

// ------------------------------------------------------------ the pack models: their size (x, y, z in the file's own units; test/ofis-styles.test.mjs reads them back from the files)

export const SCALE = 1.7;                       // the scale of the furniture in the scene: a desk is 1.2 m long, a sofa 1.7 m
export const MODEL_SIZE = {
  lampRoundFloor: [0.15, 0.86, 0.18], lampRoundTable: [0.15, 0.31, 0.18], lampSquareFloor: [0.12, 0.86, 0.12], lampSquareTable: [0.12, 0.29, 0.12],
  loungeSofa: [0.98, 0.46, 0.41], loungeSofaLong: [0.98, 0.46, 0.82], loungeChair: [0.49, 0.46, 0.41], loungeChairRelax: [0.49, 0.63, 0.67],
  loungeDesignSofa: [1.12, 0.40, 0.41], stoolBar: [0.27, 0.43, 0.23], benchCushion: [0.40, 0.46, 0.20],
  tableCoffee: [0.66, 0.23, 0.40], tableCoffeeGlass: [0.66, 0.23, 0.40], tableRound: [0.69, 0.37, 0.80], table: [0.84, 0.33, 0.45], sideTable: [0.53, 0.38, 0.22],
  sideTableDrawers: [0.534, 0.384, 0.222], bookcaseOpenLow: [0.40, 0.40, 0.25], coatRackStanding: [0.27, 0.77, 0.27],
  kitchenCoffeeMachine: [0.24, 0.303, 0.304], kitchenFridgeSmall: [0.43, 0.6, 0.292], kitchenCabinet: [0.43, 0.45, 0.45],
  speaker: [0.15, 0.64, 0.15], laptop: [0.60, 0.37, 0.55],
  pottedPlant: [0.212, 0.595, 0.241], plantSmall2: [0.19, 0.28, 0.19], plantSmall3: [0.17, 0.29, 0.20],
  desk: [0.734, 0.384, 0.392], screen: [0.393, 0.294, 0.104], keyboard: [0.282, 0.028, 0.118], mouse: [0.05, 0.024, 0.085],
  books: [0.15, 0.10, 0.09], pillow: [0.23, 0.22, 0.09], rugRound: [0.92, 0.01, 0.92], rugRectangle: [1.57, 0.01, 0.92], rugRounded: [1.57, 0.01, 0.92], rugSquare: [0.90, 0.01, 0.92],
};

// the height of the part of a seat model a person sits on, in the file's own units (times the model's scale it is where the hip rests, plus the pad of the figure)
export const SEAT_TOP = { loungeChair: 0.23, loungeChairRelax: 0.23, loungeSofa: 0.23, loungeSofaLong: 0.23, loungeDesignSofa: 0.23, benchCushion: 0.24, stoolBar: 0.435 };

// ------------------------------------------------------------ the offices next to an office

const N = STYLE_IDS.length;
// The offices next to an office in the building plan (ofis-layout.js buildingPlan: cells with slot, bay, side, row and col): the other office of its bay
// (across the hall), the offices of the same side in the bays next to it along the same hall, and the offices that face it across the lawn between two
// rows of the building (the front offices of one row and the back offices of the row south of it, where their columns overlap). That is at most five.
export function neighbourSlots(slot, cells) {
  const me = cells.find(c => c.slot === slot);
  if (!me) return [];
  const out = [];
  for (const c of cells) {
    if (c.slot === slot) continue;
    if (c.bay === me.bay) out.push(c.slot);
    else if (c.row === me.row && c.side === me.side && Math.abs(c.col - me.col) <= 1.0001) out.push(c.slot);
    else if (Math.abs(c.col - me.col) < 1 && ((c.row === me.row + 1 && me.side === 'front' && c.side === 'back') || (c.row === me.row - 1 && me.side === 'back' && c.side === 'front'))) out.push(c.slot);
  }
  return out;
}
// ------------------------------------------------------------ colours a style gives a room

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

// ------------------------------------------------------------ the pieces of a room and their light

// ITEM KINDS (x east, z south, y up, all in metres from the room's back corner):
//   m / lamp / rug   a pack model (m = file key) at x, z with ry (0: front to +z, PI/2: to +x, PI: to -z, -PI/2: to -x), scale s (SCALE), height y, palette
//                    role ('fabric' | 'fabric2'); a lamp also gives light (tone), a rug lies flat
//   candle           n candles around x, z on a table of height y (spread: distance between them)
//   bulbs            a string of small lights from a to b with a sag
//   win              a window in wall 'n' (north) or 'w' (west), centre c along the wall, w by h, sill at y0, optional curtains
//   screen           a lit panel on a wall (tone), wb: a whiteboard with the project's colour (menu: the cafe's board), pics: framed pictures, clock, sconce: a wall light
//   shelf / plantwall / rack / printer   the bookshelf with books, a wall of potted plants, a server rack with lights, a printer on a stand (procedural pieces)
// flags: on (stands on something else), fp ([w, d] footprint when it is not the model's), h (height of a tall piece, metres)
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
// the floor rectangle [x0, x1, z0, z1] of a piece, and whether two such rectangles overlap (less a gap): the lounge on the plaza (lounge-plan.js) plans its furniture with them
export const rectOf = it => { const [w, d] = footprint(it); return [it.x - w / 2, it.x + w / 2, it.z - d / 2, it.z + d / 2]; };
export const hit = (a, b, gap = 0) => a[0] < b[1] - gap && a[1] > b[0] + gap && a[2] < b[3] - gap && a[3] > b[2] + gap;
export function wallBoxes(items) {
  const out = [];
  for (const it of items) {
    if (!WALL_BOX[it.k]) continue;
    const [a0, a1, y0, y1] = WALL_BOX[it.k](it);
    out.push({ wall: wallOf(it), a0, a1, y0, y1, it });
  }
  return out;
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
