// How the rooms of the 3D office are furnished: eight work arrangements and three soft ones, and how two of them make one room. Pure (no three.js, no DOM), so node can test it
// (test/ofis-arrange.test.mjs). ofis-decor.js draws what this file decides and ofis.js walks the people along the routes it finds.
//
//   WORK_IDS / SOFT_IDS     the named plans. Work: communal (a long table with seats on both sides), rounds (three round tables), oval (one big oval table), bench (a long bench desk along the
//                           window wall), kidney (a curved desk of three pieces), ell (an L-shaped desk), pods (small pairs of desks that face each other, at angles) and bar (a high table with
//                           stools). Soft: corner (sofas and chairs round a coffee table), ring (lounge chairs round a low table) and booths (two benches that face across a low table, and stools)
//   composeRoom(spec)       a work part and a soft part put into one room by a template: { ok, problems, pieces, seats, chef, tops, obstacles, router, ... }
//   planRoom(look, ctx)     the whole plan of one office: the arrangement and what its style dresses it with (windows, lamps, plants, shelves ...), the light sources and every walk
//   looksAll(cells)         the look of every office of a building plan, a function of the slot and of the offices around it: { style, theme, work, soft, seed }. No two neighbours share a style,
//                           a colour theme or a work arrangement, and the first offices all differ. Nothing is stored: the same slot is the same room on every load, whoever sits in it
//
// A seat is { id ('chef' or 0..11 in the order they are filled), kind ('desk' | 'lounge' | 'stool'), x, z (where the hip goes), facing (a heading), hip (its height), piece (the furniture
// it sits in), stand (where a person stops before sitting down), approach (the points from just inside the door to `stand`: clear of furniture) }. Every room has 12 seats besides the chat's
// own, whatever its class: the class only says how many are in use (the first CAP[cls] of them).
import { hash } from './util.js';
import { MODEL_SIZE, SEAT_TOP, STYLE_IDS, STYLES, neighbourSlots, lightsOf, wallBoxes, heightOf } from './ofis-styles.js';
import { CELL_W, ROOM_D, CAP } from './ofis-layout.js';
import { polyOf, bboxOf, polyGap, createRouter, headingVec, quarter, rot } from './ofis-geom.js';
import { TABLE } from './ofis-arrange-table.js';

const PI = Math.PI;
export const W = CELL_W, D = ROOM_D;
export const DOOR_X = Math.round((W - 1.0) * 1000) / 1000;                                    // the door of an office is 1 m from its east end
// `inner` is the first point inside (where the walks start), `out` the point in the hall in front of the door
export const DOOR = { front: { out: [DOOR_X, D + 0.45], inner: [DOOR_X, D - 0.55] }, back: { out: [DOOR_X, -0.75], inner: [DOOR_X, 0.55] } };
export const SEATS = CAP[CAP.length - 1];                         // sub-agent seats in every room: the most a class asks for (12)
export const TABLE_H = 0.65;                                      // the height of a work table's top (the pack's desk is 0.653)
export const WORK_IDS = ['communal', 'rounds', 'oval', 'bench', 'kidney', 'ell', 'pods', 'bar'];
export const SOFT_IDS = ['corner', 'ring', 'booths'];
export const THEMES_N = 8;                                        // wall and floor colour themes (ofis.js THEMES)
const CHAIR_S = 1.5, LOUNGE_S = 1.7, STOOL_S = 1.4;

const r3 = v => Math.round(v * 1000) / 1000;
const along = (x, z, h, d) => [x + Math.sin(h) * d, z + Math.cos(h) * d];
const BACK_FIRST = ['back', 'left', 'right', 'front'], FRONT_FIRST = ['front', 'left', 'right', 'back'], SIDE_FIRST = ['left', 'right', 'back', 'front'];

// ------------------------------------------------------------ pieces

// The size of a piece on the floor, as a shape for ofis-geom.js, or null when nothing walks around it (a rug, a thing that stands on another thing)
export function shapeOf(it) {
  if (it.on || it.k === 'rug' || it.k === 'set' || it.k === 'candle' || it.k === 'win') return null;
  if (it.k === 'table') return it.shape === 'ell' ? { t: 'ell', x: it.x, z: it.z, rx: it.w / 2, rz: it.d / 2, ry: it.ry || 0 } : { t: 'box', x: it.x, z: it.z, w: it.w, d: it.d, ry: it.ry || 0 };
  if (it.k === 'm' || it.k === 'lamp') {
    const z = MODEL_SIZE[it.m], s = it.s || 1.7, w = it.fp ? it.fp[0] : z[0] * s, d = it.fp ? it.fp[1] : z[2] * s;
    if (it.m === 'tableRound') return { t: 'ell', x: it.x, z: it.z, rx: w / 2, rz: d / 2, ry: it.ry || 0 };
    return { t: 'box', x: it.x, z: it.z, w, d, ry: it.ry || 0 };
  }
  if (it.k === 'shelf' || it.k === 'plantwall' || it.k === 'rack' || it.k === 'printer') { const [w, d] = SHELF_FP[it.k]; return { t: 'box', x: it.x, z: it.z, w, d, ry: 0 }; }
  if (it.k === 'cluster') return { t: 'box', x: it.x, z: it.z, w: it.fp[0], d: it.fp[1], ry: 0 };
  return null;
}
// [x (out of the west wall), z (along it)] of the procedural pieces, as ofis-styles.js FP has them
const SHELF_FP = { shelf: [0.42, 1.16], plantwall: [0.4, 1.4], rack: [0.55, 0.75], printer: [0.6, 0.9] };
export const heightOfPiece = it => {
  if (it.k === 'table') return it.h;
  if (it.k === 'cluster') return it.h || 0.9;
  if (it.k === 'm' || it.k === 'lamp') return MODEL_SIZE[it.m][1] * (it.s || 1.7) + (it.y || 0);
  return heightOf(it);
};
const isTable = p => p.k === 'table' || p.top != null;
const polyOfPiece = (p, n = 16) => { const s = shapeOf(p); return s ? polyOf(s, n) : null; };

function builder() {
  const b = { pieces: [], seats: [], tops: [], windows: [], n: 0, seatN: 0 };
  b.add = it => { it.id = it.id || `${it.k === 'm' ? it.m : it.k}${b.n++}`; b.pieces.push(it); return it; };
  b.seat = o => { const s = { key: 'k' + b.seatN++, ...o }; b.seats.push(s); return s; };
  // a seat model that a person sits in: the model is a piece, the seat is where the hip goes
  b.chair = (hx, hz, facing, o = {}) => {
    const m = o.m || 'loungeChair', s = o.s || CHAIR_S, f = headingVec(facing), kind = o.kind || 'desk';
    const piece = b.add({ k: 'm', m, x: r3(hx - f[0] * 0.03), z: r3(hz - f[1] * 0.03), ry: r3(facing), s, role: o.role || 'fabric', seatOf: true });
    return b.seat({ kind, x: r3(hx), z: r3(hz), facing: r3(facing), hip: r3(SEAT_TOP[m] * s + 0.065), piece: piece.id, pref: o.pref || (kind === 'lounge' ? FRONT_FIRST : BACK_FIRST) });
  };
  // a laptop on a table in front of a seat (d metres from the hip along its facing), its keys toward the person
  b.laptop = (seat, d, top, s = 1.3) => {
    const [x, z] = along(seat.x, seat.z, seat.facing, d);
    const piece = b.add({ k: 'set', kind: 'laptop', x: r3(x), z: r3(z), y: top, ry: r3(seat.facing + PI), s, seat: seat.key });
    seat.set = piece.id;
    return piece;
  };
  // a monitor with its keyboard and mouse on a desk in front of a seat
  b.monitor = (seat, d, top, w = 0.62) => {
    const [x, z] = along(seat.x, seat.z, seat.facing, d);
    const piece = b.add({ k: 'set', kind: 'monitor', x: r3(x), z: r3(z), y: top, ry: r3(seat.facing + PI), w, seat: seat.key });
    seat.set = piece.id;
    return piece;
  };
  return b;
}

// ------------------------------------------------------------ the work arrangements (each in a frame of its own: u east, v south; composeRoom turns and places it)

const WORK = {
  communal(b) {                                                    // a long table with five seats on each side
    const H = TABLE_H;
    b.add({ k: 'table', shape: 'rect', x: 0, z: 0, w: 4.8, d: 0.95, ry: 0, h: H, legs: 'trestle' });
    const us = [-1.9, -0.95, 0, 0.95, 1.9], S = [], N = [];
    for (const u of us) { const s = b.chair(u, 0.78, PI); b.laptop(s, 0.56, H); S.push(s); }
    for (const u of us) { const s = b.chair(u, -0.78, 0); b.laptop(s, 0.56, H); N.push(s); }
    b.tops = [{ x: 0, z: 0, y: H }];
    return { chef: S[1], order: [N[3], S[3], N[1], S[0], S[4], N[0], N[2], S[2], N[4]] };
  },
  rounds(b) {                                                      // three round tables in a triangle, three or four chairs each
    const H = 0.624, seats = [];
    [[-1.9, -1.0, 3], [1.9, -1.0, 3], [0, 1.7, 4]].forEach(([x, z, n], ti) => {
      b.add({ k: 'm', m: 'tableRound', x, z, ry: 0, s: 1.7, role: 'wood', top: H, grp: 't' + ti });
      const out = Math.atan2(x, z - 0.1);
      (n === 3 ? [-1.15, 0, 1.15] : [-1.55, -0.52, 0.52, 1.55]).forEach(da => {
        const a = out + da, hx = x + Math.sin(a) * 0.98, hz = z + Math.cos(a) * 0.98, s = b.chair(hx, hz, Math.atan2(x - hx, z - hz));
        b.laptop(s, 0.5, H, 1.2);
        seats.push(s);
      });
    });
    b.tops = [];
    return { chef: seats[1], order: [seats[4], seats[7], seats[2], seats[8], seats[0], seats[5], seats[3], seats[9], seats[6]] };
  },
  oval(b) {                                                        // one big oval table, chairs all round it
    const rx = 2.0, rz = 0.95, H = TABLE_H, seats = [];
    b.add({ k: 'table', shape: 'ell', x: 0, z: 0, w: rx * 2, d: rz * 2, ry: 0, h: H, legs: 'pedestal2' });
    const around = (px, pz) => {                                   // a seat on the outward normal of the ellipse's edge
      const nx = px / (rx * rx), nz = pz / (rz * rz), l = Math.hypot(nx, nz), ux = nx / l, uz = nz / l;
      const hx = px + ux * 0.4, hz = pz + uz * 0.4, s = b.chair(hx, hz, Math.atan2(-ux, -uz));
      b.laptop(s, 0.5, H);
      seats.push(s);
    };
    for (const sg of [1, -1]) for (const u of [-1.3, -0.43, 0.43, 1.3]) around(u, sg * rz * Math.sqrt(1 - (u / rx) ** 2));
    around(rx, 0); around(-rx, 0);
    b.tops = [{ x: 0, z: 0, y: H }];
    return { chef: seats[1], order: [seats[6], seats[5], seats[2], seats[7], seats[0], seats[4], seats[3], seats[8], seats[9]] };
  },
  bench(b) {                                                       // a long bench desk along the window wall (the wall is v = 0): six seats along it
    const L = 5.6, H = TABLE_H, seats = [];
    b.add({ k: 'table', shape: 'rect', x: 0, z: 0.05 + 0.4, w: L, d: 0.8, ry: 0, h: H, legs: 'trestle' });
    for (let i = 0; i < 7; i++) { const s = b.chair(-2.4 + i * 0.8, 1.22, PI); b.monitor(s, 0.74, H); seats.push(s); }
    b.tops = [];
    b.windows = [-2.0, -0.67, 0.67, 2.0].map(u => ({ along: u, w: 1.1, h: 0.95, y0: 1.15 }));
    return { chef: seats[3], order: [seats[5], seats[1], seats[6], seats[2], seats[4], seats[0]], anchor: { wall: 'w', rot: 1 } };
  },
  kidney(b) {                                                      // a curved desk of three slabs at an angle to each other, seats inside and outside the curve
    const R = 3.4, H = TABLE_H, seats = [];
    [-0.55, 0, 0.55].forEach((phi, i) => {
      const px = R * Math.sin(phi), pz = R * (1 - Math.cos(phi)), tx = Math.cos(phi), tz = Math.sin(phi), inx = -Math.sin(phi), inz = Math.cos(phi);
      b.add({ k: 'table', shape: 'rect', x: r3(px), z: r3(pz), w: 1.7, d: 0.8, ry: r3(-phi), h: H, legs: 'trestle', grp: 'kid' });
      const s = b.chair(px + inx * 0.8, pz + inz * 0.8, PI - phi); b.monitor(s, 0.7, H); seats.push(s);          // inside the curve (south at the middle, where the seats crowd): one in the middle of the slab
      for (const t of [-0.42, 0.42]) {                                                                         // outside it (north at the middle), two
        const s2 = b.chair(px - inx * 0.8 + tx * t, pz - inz * 0.8 + tz * t, -phi); b.monitor(s2, 0.7, H); seats.push(s2);
      }
    });
    b.tops = [];
    return { chef: seats[3], order: [seats[2], seats[6], seats[0], seats[7], seats[4], seats[1], seats[8], seats[5]] };
  },
  ell(b) {                                                         // an L-shaped desk: a long leg and a shorter one at a right angle
    const H = TABLE_H, seats = [];
    b.add({ k: 'table', shape: 'rect', x: 0, z: 0, w: 3.8, d: 0.8, ry: 0, h: H, legs: 'trestle', grp: 'ell' });
    b.add({ k: 'table', shape: 'rect', x: 1.5, z: 2.15, w: 0.8, d: 3.5, ry: 0, h: H, legs: 'trestle', grp: 'ell' });
    const row = (list, facing, d) => list.forEach(([x, z]) => { const s = b.chair(x, z, facing); b.monitor(s, d, H); seats.push(s); });
    row([[-1.4, -0.95], [-0.5, -0.95], [0.4, -0.95], [1.3, -0.95]], 0, 0.72);       // 0..3 north of the long leg, facing south
    row([[-1.4, 0.95], [-0.5, 0.95]], PI, 0.72);                                      // 4..5 south of it
    row([[2.45, 1.1], [2.45, 2.0], [2.45, 2.9]], -PI / 2, 0.72);                      // 6..8 east of the short leg, facing west
    row([[0.55, 1.6], [0.55, 2.6]], PI / 2, 0.72);                                    // 9..10 west of it, facing east
    b.tops = [];
    return { chef: seats[4], order: [seats[6], seats[1], seats[9], seats[3], seats[7], seats[5], seats[0], seats[8], seats[10], seats[2]] };
  },
  pods(b) {                                                        // pairs of desks that face each other, each pair at an angle of its own
    const H = 0.634, seats = [];
    [[-2.0, -1.0, 0.1], [1.1, -1.2, 0.55], [-1.3, 1.3, -0.4], [1.8, 1.2, 0.95]].forEach(([cx, cz, a], i) => {
      const at = (u, v) => { const [dx, dz] = rot(u, v, a); return [cx + dx, cz + dz]; };
      for (const sg of [-1, 1]) {
        const [dx, dz] = at(0, sg * 0.4);
        b.add({ k: 'm', m: 'desk', x: r3(dx), z: r3(dz), ry: r3((sg < 0 ? PI : 0) + a), s: 1.7, role: 'wood', top: H, grp: 'pod' + i });
        const [hx, hz] = at(0, sg * 1.18), s = b.chair(hx, hz, (sg < 0 ? 0 : PI) + a);
        b.monitor(s, 0.62, H, 0.58);
        seats.push(s);
      }
    });
    b.tops = [];
    return { chef: seats[0], order: [seats[3], seats[4], seats[6], seats[1], seats[5], seats[2], seats[7]] };
  },
  bar(b) {                                                         // a high table, stools on both sides and at the ends
    const L = 4.6, H = 0.96, seats = [];
    b.add({ k: 'table', shape: 'rect', x: 0, z: 0, w: L, d: 0.8, ry: 0, h: H, legs: 'bar' });
    const stool = (x, z, f, pref) => { const s = b.chair(x, z, f, { m: 'stoolBar', s: STOOL_S, kind: 'stool', pref }); b.laptop(s, 0.62, H); seats.push(s); };
    for (const u of [-1.65, -0.55, 0.55, 1.65]) stool(u, 0.8, PI, BACK_FIRST);
    for (const u of [-1.65, -0.55, 0.55, 1.65]) stool(u, -0.8, 0, BACK_FIRST);
    for (const sg of [-1, 1]) stool(sg * 2.75, 0, sg > 0 ? -PI / 2 : PI / 2, SIDE_FIRST);
    b.tops = [{ x: 0, z: 0, y: H }];
    return { chef: seats[1], order: [seats[6], seats[2], seats[5], seats[0], seats[9], seats[3], seats[4], seats[8], seats[7]] };
  },
};

// ------------------------------------------------------------ the soft arrangements

const SOFT = {
  corner(b) {                                                      // two sofas that face each other across a coffee table, a lounge chair at each end, on a rug
    const H = 0.391, seats = [];
    b.add({ k: 'rug', m: 'rugRounded', x: 0, z: 0, ry: 0, s: 2.4, role: 'fabric2' });
    b.add({ k: 'm', m: 'tableCoffee', x: 0, z: 0, ry: 0, s: 1.7, role: 'wood', top: H });
    const SOFA_S = 1.9;
    const sofaN = b.add({ k: 'm', m: 'loungeSofa', x: 0, z: -1.38, ry: 0, s: SOFA_S, role: 'fabric', seatOf: true });
    const sofaS = b.add({ k: 'm', m: 'loungeDesignSofa', x: 0, z: 1.38, ry: PI, s: SOFA_S, role: 'fabric2', seatOf: true });
    const hipN = r3(SEAT_TOP.loungeSofa * SOFA_S + 0.065), hipS = r3(SEAT_TOP.loungeDesignSofa * SOFA_S + 0.065);
    const sit = (x, z, facing, piece, hip) => seats.push(b.seat({ kind: 'lounge', x, z, facing, hip, piece: piece.id, pref: FRONT_FIRST }));
    for (const u of [-0.62, 0, 0.62]) sit(u, -1.4, 0, sofaN, hipN);
    for (const u of [-0.7, 0, 0.7]) sit(u, 1.4, PI, sofaS, hipS);
    seats.push(b.chair(-1.55, 0, PI / 2, { s: LOUNGE_S, kind: 'lounge' }));
    seats.push(b.chair(1.55, 0, -PI / 2, { m: 'loungeChairRelax', s: LOUNGE_S, kind: 'lounge', role: 'fabric2' }));
    b.laptop(seats[1], 1.15, H, 1.1);
    b.tops = [{ x: 0, z: 0, y: H }];
    b.sofas = [sofaN, sofaS];
    return { order: [seats[6], seats[0], seats[7], seats[4], seats[2], seats[5], seats[1], seats[3]] };
  },
  ring(b) {                                                        // seven lounge chairs round a low round table, on a round rug
    const H = 0.444, seats = [];
    b.add({ k: 'rug', m: 'rugRound', x: 0, z: 0, ry: 0, s: 3.2, role: 'fabric' });
    b.add({ k: 'm', m: 'tableRound', x: 0, z: 0, ry: 0, s: 1.2, role: 'wood', top: H });
    for (let i = 0; i < 7; i++) {
      const a = 0.3 + i * 2 * PI / 7, hx = Math.sin(a) * 1.4, hz = Math.cos(a) * 1.4;
      seats.push(b.chair(hx, hz, Math.atan2(-hx, -hz), { m: i === 2 ? 'loungeChairRelax' : 'loungeChair', s: LOUNGE_S, kind: 'lounge', role: i % 2 ? 'fabric2' : 'fabric' }));
    }
    b.laptop(seats[0], 1.0, H, 1.0);
    b.tops = [{ x: 0, z: 0, y: H }];
    return { order: [seats[0], seats[4], seats[2], seats[6], seats[1], seats[5], seats[3]] };
  },
  booths(b) {                                                      // two benches of three seats that face each other across a low table, and a stool at each end
    const H = 0.58, seats = [];
    b.add({ k: 'rug', m: 'rugRectangle', x: 0, z: 0, ry: 0, s: 2.6, role: 'fabric2' });
    b.add({ k: 'table', shape: 'rect', x: 0, z: 0, w: 2.7, d: 0.8, ry: 0, h: H, legs: 'trestle' });
    for (const sg of [-1, 1]) for (const u of [-0.92, 0, 0.92]) {
      seats.push(b.chair(u, sg * 1.12, sg < 0 ? 0 : PI, { m: 'benchCushion', s: 2.2, kind: 'lounge', role: sg < 0 ? 'fabric' : 'fabric2', pref: FRONT_FIRST }));
    }
    for (const sg of [-1, 1]) seats.push(b.chair(sg * 2.05, 0, sg > 0 ? -PI / 2 : PI / 2, { m: 'stoolBar', s: 1.2, kind: 'stool', pref: SIDE_FIRST }));
    b.laptop(seats[1], 0.8, H, 1.1);
    b.tops = [{ x: 0, z: 0, y: H }];
    return { order: [seats[1], seats[4], seats[0], seats[5], seats[2], seats[3], seats[6], seats[7]] };
  },
};

// ------------------------------------------------------------ parts: built once, turned and placed

const partCache = new Map();
export function buildPart(kind, id) {
  const key = kind + ':' + id;
  if (partCache.has(key)) return partCache.get(key);
  const b = builder();
  const r = (kind === 'work' ? WORK : SOFT)[id](b);
  const part = { kind, id, pieces: b.pieces, seats: b.seats, tops: b.tops, windows: b.windows || [], sofas: (b.sofas || []).map(p => p.id), chef: r.chef ? r.chef.key : null, order: r.order.map(s => s.key), anchor: r.anchor || null };
  partCache.set(key, part);
  return part;
}

// turn a part by `q` quarter turns about its origin and move that to (ox, oz); everything it holds comes with it, with ids made unique by `tag`
function placePart(part, q, ox, oz, tag) {
  const th = quarter(q), pre = tag + ':';
  const P = (x, z) => { const [dx, dz] = rot(x, z, th); return [r3(ox + dx), r3(oz + dz)]; };
  const pieces = part.pieces.map(p => {
    const [x, z] = P(p.x, p.z), o = { ...p, id: pre + p.id, x, z };
    if (p.ry !== undefined) o.ry = r3(p.ry + th);
    if (p.seat) o.seat = pre + p.seat;
    if (p.grp) o.grp = pre + p.grp;
    return o;
  });
  const seats = part.seats.map(s => { const [x, z] = P(s.x, s.z); return { ...s, key: pre + s.key, x, z, facing: r3(s.facing + th), piece: pre + s.piece, set: s.set ? pre + s.set : undefined }; });
  const tops = part.tops.map(t => { const [x, z] = P(t.x, t.z); return { ...t, x, z }; });
  const windows = part.windows.map(w => { const [x, z] = P(w.along, 0); return { ...w, x, z }; });
  return { ...part, pieces, seats, tops, windows, byKey: new Map(seats.map(s => [s.key, s])), chef: part.chef ? pre + part.chef : null, order: part.order.map(k => pre + k), sofas: part.sofas.map(k => pre + k), th, q };
}

// the box a part covers on the floor (the corners of its solid pieces)
function extentOf(pieces) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pieces) {
    const poly = polyOfPiece(p);
    if (!poly) continue;
    const bb = bboxOf(poly);
    x0 = Math.min(x0, bb.x0); x1 = Math.max(x1, bb.x1); z0 = Math.min(z0, bb.z0); z1 = Math.max(z1, bb.z1);
  }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0 };
}
const extentCache = new Map();
export function extentFor(kind, id, q) {
  const k = `${kind}:${id}:${((q % 4) + 4) % 4}`;
  if (!extentCache.has(k)) extentCache.set(k, extentOf(placePart(buildPart(kind, id), q, 0, 0, 'x').pieces));
  return extentCache.get(k);
}

// ------------------------------------------------------------ templates

// A template is [rw, rs, wx, wz, sx, sz]: how many quarter turns the work part and the soft part are turned, and where the north-west corner of the box each covers is (metres from the
// room's back corner). A bench is anchored to the west wall whatever the template says about x. ofis-arrange-table.js holds the templates that work for every pair (found by
// tools/arrange-pick.mjs, which tries a few hundred of them for each pair and keeps the three with the widest aisles).
const MARGIN = 0.35, GAP = 0.6, X0 = MARGIN, X1 = W - MARGIN, Z0 = 0.35, Z1 = D - 0.35;

function lay(workId, softId, tpl) {
  const [rwT, rs, wxT, wz, sx, sz] = tpl;
  const wp = buildPart('work', workId), sp = buildPart('soft', softId);
  const rw = wp.anchor ? wp.anchor.rot : rwT, wx = wp.anchor ? 0.07 : wxT;
  const ew = extentFor('work', workId, rw), es = extentFor('soft', softId, rs);
  const e = 1e-6;
  if (wx < X0 - e - (wp.anchor ? 0.3 : 0) || wx + ew.w > X1 + e || wz < Z0 - e || wz + ew.d > Z1 + e || sx < X0 - e || sx + es.w > X1 + e || sz < Z0 - e || sz + es.d > Z1 + e) return null;
  if (Math.max(wx - (sx + es.w), sx - (wx + ew.w), wz - (sz + es.d), sz - (wz + ew.d)) < GAP) return null;
  const work = placePart(wp, rw, wx - ew.x0, wz - ew.z0, 'w'), soft = placePart(sp, rs, sx - es.x0, sz - es.z0, 's');
  return { work, soft, ew: { x0: wx, z0: wz, x1: wx + ew.w, z1: wz + ew.d }, es: { x0: sx, z0: sz, x1: sx + es.w, z1: sz + es.d } };
}

// ------------------------------------------------------------ composing a room

export const FOYER = door => (door === 'front' ? [[W - 2.1, D - 1.1], [W, D - 1.1], [W, D], [W - 2.1, D]] : [[W - 2.1, 0], [W, 0], [W, 1.1], [W - 2.1, 1.1]]);
const SIGN_ZONE = [[0, 0], [6.3, 0], [6.3, 1.3], [0, 1.3]];     // in front of the sign on the north wall: nothing tall stands there
export const STAND = 0.8;                                        // how far from the hip a person stops before they sit down

function obstaclesOf(pieces) {
  const out = [];
  for (const p of pieces) { const poly = polyOfPiece(p); if (poly) out.push({ id: p.id, poly, piece: p }); }
  return out;
}
// What does not belong together: outside the room, in the foyer, tall in front of the sign, two things touching (a seat tucked under its table is fine)
function geometryProblems(obstacles, door) {
  const out = [], fo = FOYER(door);
  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i], bb = bboxOf(a.poly);
    if (bb.x0 < 0.05 || bb.z0 < 0.05 || bb.x1 > W - 0.05 || bb.z1 > D - 0.05) out.push(`${a.id} leaves the room`);
    if (polyGap(a.poly, fo) < 0.05) out.push(`${a.id} is in the foyer`);
    if (heightOfPiece(a.piece) > 1.0 && polyGap(a.poly, SIGN_ZONE) < 0.05) out.push(`${a.id} stands in front of the sign`);
    for (let j = i + 1; j < obstacles.length; j++) {
      const c = obstacles[j];
      if (a.piece.grp && a.piece.grp === c.piece.grp) continue;
      if ((a.piece.seatOf && isTable(c.piece)) || (c.piece.seatOf && isTable(a.piece))) continue;
      if (polyGap(a.poly, c.poly) < 0.03) out.push(`${a.id} touches ${c.id}`);
    }
  }
  return out;
}

// the stand point and the walk to it for one seat, or null: the first of the seat's preferred sides (in front, behind, left, right of the hip) where a person can stand clear of
// everything, reached from the door by a walk that touches nothing
function routeSeat(s, router, tree) {
  const f = headingVec(s.facing), own = new Set([s.piece]);
  const dirs = { front: f, back: [-f[0], -f[1]], left: [f[1], -f[0]], right: [-f[1], f[0]] };
  for (const name of s.pref || BACK_FIRST) {
    const d = dirs[name], c = [r3(s.x + d[0] * STAND), r3(s.z + d[1] * STAND)];
    if (!router.free(c[0], c[1]) || !tree.reach(c[0], c[1]) || !router.lineClear(c, [s.x, s.z], own, 0.1)) continue;
    const path = tree.path(c);
    if (path) return { stand: c, standFrom: name, approach: path.map(p => [r3(p[0]), r3(p[1])]) };
  }
  return null;
}

// What is arranged, before anything is walked: a work part and a soft part placed by a template, or the reason they cannot be ({ ok: false, problems })
function arrange({ work: workId, soft: softId, tpl, door }) {
  const L = lay(workId, softId, tpl);
  if (!L) return { ok: false, problems: ['does not fit'], door };
  const { work, soft } = L;
  const pieces = [...work.pieces, ...soft.pieces], obstacles = obstaclesOf(pieces);
  const problems = geometryProblems(obstacles, door);
  if (problems.length) return { ok: false, problems, pieces, obstacles, door };
  return {
    ok: true, problems, door, work, soft, pieces, obstacles, tpl, workId, softId,
    windows: work.windows.map(w => ({ k: 'win', wall: 'w', c: r3(w.z), w: w.w, h: w.h, y0: w.y0, bench: true })),
    tops: [...work.tops.map(t => ({ ...t, part: 'work' })), ...soft.tops.map(t => ({ ...t, part: 'soft' }))],
    boxes: { work: L.ew, soft: L.es },
  };
}

// Walk every seat of an arrangement from the door, with `extra` obstacles (the dressing) as well. Seats nobody can reach stay in the room as furniture. The chat's own seat is the
// arrangement's own when it can be reached, else the first work seat that can; the others are filled in order, work and soft mixed two to one, so the first three sub-agents are not
// all at a desk. -> { router, tree, chef, seats (SEATS of them: id, stand, approach), spare (reachable, unused), blocked (no way in), problems }
function route(arr, extra = []) {
  const door = arr.door, obstacles = [...arr.obstacles, ...extra], router = createRouter({ W, D, obstacles }), tree = router.tree(DOOR[door].inner), problems = [];
  const walked = new Map();
  for (const s of [...arr.work.seats, ...arr.soft.seats]) walked.set(s.key, routeSeat(s, router, tree));
  const ok = s => walked.get(s.key);
  const wOrder = arr.work.order.map(k => arr.work.byKey.get(k)), sOrder = arr.soft.order.map(k => arr.soft.byKey.get(k));
  const chefSeat = [arr.work.byKey.get(arr.work.chef), ...wOrder].find(s => s && ok(s));
  if (!chefSeat) problems.push('no work seat has a way in');
  const w = wOrder.filter(s => s !== chefSeat && ok(s)), so = sOrder.filter(ok), order = [];
  for (let i = 0, j = 0, n = 0; (i < w.length || j < so.length) && order.length < SEATS; n++) {
    if (j < so.length && (n % 3 === 2 || i >= w.length)) order.push(so[j++]); else order.push(w[i++]);
  }
  if (order.length < SEATS) problems.push(`only ${order.length} seats with a way in`);
  const full = (s, id) => ({ ...s, id, ...ok(s) });
  const used = new Set([chefSeat, ...order].filter(Boolean));
  const all = [...arr.work.seats, ...arr.soft.seats];
  return {
    router, tree, problems, chef: chefSeat ? full(chefSeat, 'chef') : null, seats: order.map((s, i) => full(s, i)),
    spare: all.filter(s => ok(s) && !used.has(s)), blocked: all.filter(s => !ok(s)),
  };
}

// The pieces to draw: the sets (a laptop, a monitor with its keyboard) belong to the seat they are in front of, by that seat's id (undefined: nobody uses that seat)
function piecesWith(arr, rt) {
  const idOf = new Map([rt.chef, ...rt.seats].filter(Boolean).map(s => [s.key, s.id]));
  return arr.pieces.map(p => (p.k === 'set' ? { ...p, seat: idOf.get(p.seat) } : p));
}

// A work part and a soft part in one room, walked: { ok, problems, pieces, seats, chef, tops, windows, obstacles, router, ... }
export function composeRoom(spec) {
  const arr = arrange(spec);
  if (!arr.ok) return arr;
  const rt = route(arr);
  return {
    ok: rt.problems.length === 0, problems: rt.problems, door: arr.door, pieces: piecesWith(arr, rt), seats: rt.seats, chef: rt.chef, spare: rt.spare, blocked: rt.blocked,
    obstacles: arr.obstacles, router: rt.router, tree: rt.tree, windows: arr.windows, tops: arr.tops, sofas: arr.soft.sofas,
    work: { id: arr.workId, th: arr.work.th, box: arr.boxes.work }, soft: { id: arr.softId, th: arr.soft.th, box: arr.boxes.soft }, tpl: arr.tpl,
  };
}

// ------------------------------------------------------------ the dressing: what a style adds to an arrangement

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffled = (list, r) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// the half extents of a piece (its bounding box about its own centre) when turned by ry
function halfOf(it, ry) {
  const s = shapeOf({ ...it, on: false, x: 0, z: 0, ry }), bb = bboxOf(polyOf(s || { t: 'box', x: 0, z: 0, w: 0.2, d: 0.2, ry: 0 }, 16));
  return [bb.x1, bb.z1];
}
// candidate spots (x, z, ry) for a prop that stands against a wall, in a corner, near the soft part or anywhere
function spotsFor(it, at, ctx) {
  const out = [], g = 0.08;
  const wallW = ry => { const [hx] = halfOf(it, ry); for (let z = 0.7; z <= D - 0.6; z += 0.55) out.push([it.x != null ? it.x : hx + g, z, ry]); };
  const wallN = ry => { const [, hz] = halfOf(it, ry); for (let x = 0.7; x <= W - 0.6; x += 0.55) out.push([x, hz + g, ry]); };
  const wallE = ry => { const [hx] = halfOf(it, ry); for (let z = 0.7; z <= D - 0.6; z += 0.55) out.push([W - hx - g, z, ry]); };
  const wallS = ry => { const [, hz] = halfOf(it, ry); for (let x = 0.7; x <= W - 0.6; x += 0.55) out.push([x, D - hz - g, ry]); };
  if (at === 'wallW') wallW(PI / 2);
  else if (at === 'wallN') wallN(0);
  else if (at === 'wall') { wallW(PI / 2); wallN(0); wallE(-PI / 2); wallS(PI); }
  else if (at === 'corner') {
    const [hx, hz] = halfOf(it, 0), m = 0.12;
    out.push([hx + m, hz + m, 0], [W - hx - m, hz + m, 0], [hx + m, D - hz - m, 0], [W - hx - m, D - hz - m, 0]);
  } else if (at === 'soft') {
    const b = ctx.soft.box, [hx, hz] = halfOf(it, 0), m = 0.25;
    const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    out.push([b.x0 - hx - m, b.z0 + hz, 0], [b.x0 - hx - m, b.z1 - hz, 0], [b.x1 + hx + m, b.z0 + hz, 0], [b.x1 + hx + m, b.z1 - hz, 0],
      [mx, b.z0 - hz - m, 0], [mx, b.z1 + hz + m, 0], [b.x0 - hx - m, mz, 0], [b.x1 + hx + m, mz, 0],
      [b.x0 + hx, b.z0 - hz - m, 0], [b.x1 - hx, b.z0 - hz - m, 0], [b.x0 + hx, b.z1 + hz + m, 0], [b.x1 - hx, b.z1 + hz + m, 0]);
  } else for (let x = 1.0; x <= W - 1.0; x += 0.8) for (let z = 1.0; z <= D - 1.0; z += 0.8) out.push([x, z, 0]);
  return out;
}

// the dressing of a room: the wall pieces of the style, then its props where they fit, in the order of its list
function dress(base, door, style, rand) {
  const items = [];
  const placed = base.obstacles.map(o => ({ poly: o.poly, id: o.id }));
  const walls = [];                                              // wall boxes already taken: { wall, a0, a1, y0, y1 }
  const fo = FOYER(door);
  const wallOk = it => {
    const [bx] = wallBoxes([it]);
    if (!bx) return true;
    const len = bx.wall === 'n' ? W : D;
    if (bx.a0 < 0.15 || bx.a1 > len - 0.15) return false;
    if (bx.wall === 'n' && door === 'back' && bx.a1 > DOOR_X - 0.65 && bx.a0 < DOOR_X + 0.65) return false;
    for (const o of walls) if (o.wall === bx.wall && o.a0 < bx.a1 + 0.1 && o.a1 > bx.a0 - 0.1 && o.y0 < bx.y1 && o.y1 > bx.y0) return false;
    return true;
  };
  const takeWall = it => {
    if (it.k === 'bulbs') { if (it.b[0] > W - 0.3 || (door === 'back' && it.b[0] > DOOR_X - 0.65)) return false; items.push(it); return true; }
    if (!wallOk(it)) return false;
    for (const bx of wallBoxes([it])) walls.push(bx);
    items.push(it);
    return true;
  };
  for (const w of base.windows) takeWall({ ...w });                // the arrangement's windows first (a bench stands against them), then the style's own wall pieces
  for (const it of STYLES[style].walls) takeWall({ ...it });
  if (!items.some(it => it.k === 'win')) takeWall({ k: 'win', wall: 'w', c: 3.4, w: 1.4, h: 1.0, y0: 1.0 }) || takeWall({ k: 'win', wall: 'n', c: 9.0, w: 1.2, h: 1.0, y0: 1.0 });
  const blocksWall = (it, bb) => {
    const h = heightOfPiece(it);
    for (const bx of walls) {
      if (h <= bx.y0) continue;
      const near = bx.wall === 'w' ? bb.x0 < 0.9 : bb.z0 < 0.9;
      const a0 = bx.wall === 'w' ? bb.z0 : bb.x0, a1 = bx.wall === 'w' ? bb.z1 : bb.x1;
      if (near && a0 < bx.a1 && a1 > bx.a0) return true;
    }
    return false;
  };
  const free = (it, poly) => {
    const bb = bboxOf(poly);
    if (bb.x0 < 0.1 || bb.z0 < 0.1 || bb.x1 > W - 0.1 || bb.z1 > D - 0.1) return false;
    if (polyGap(poly, fo) < 0.15) return false;
    if (heightOfPiece(it) > 1.0 && polyGap(poly, SIGN_ZONE) < 0.05) return false;
    for (const o of placed) if (polyGap(poly, o.poly) < 0.12) return false;
    return !blocksWall(it, bb);
  };
  const props = [];                                              // { it, withs }: a prop and what stands on it
  for (const p of STYLES[style].props || []) {
    for (const [x, z, ry] of shuffled(spotsFor(p, p.at || 'any', base), rand)) {
      const it = { ...p, k: p.k || (p.lamp ? 'lamp' : 'm'), x: r3(x), z: r3(z), ry: p.ry != null ? p.ry : ry, y: p.y || 0 };
      if (it.k === 'lamp') it.tone = p.tone || 'warm';
      const poly = polyOfPiece(it);
      if (!poly || !free(it, poly)) continue;
      placed.push({ poly, id: 'prop' });
      it.id = `prop${props.length}`;
      props.push({ it, withs: (p.with || []).map((c, i) => ({ ...c, k: c.k || (c.lamp ? 'lamp' : 'm'), tone: c.tone || 'warm', x: it.x, z: it.z, on: true, id: `${it.id}-${i}` })) });
      break;                                                     // a prop that fits nowhere is left out
    }
  }
  return { items, props };
}

// ------------------------------------------------------------ the plan of one office

// a template for a pair of parts at random, on a grid of 5 cm (null when the two do not fit the room at that turn)
export function sampleTemplate(workId, softId, rand) {
  const wp = buildPart('work', workId), rw = wp.anchor ? wp.anchor.rot : (rand() * 4) | 0, rs = (rand() * 4) | 0;
  const ew = extentFor('work', workId, rw), es = extentFor('soft', softId, rs);
  const pos = (lo, hi) => (hi < lo ? null : Math.round((lo + rand() * (hi - lo)) / 0.05) * 0.05);
  const wx = wp.anchor ? 0.07 : pos(X0, X1 - ew.w), wz = pos(Z0, Z1 - ew.d);
  if (wx == null || wz == null) return null;
  // the soft part anywhere that leaves a gap to the work part's box
  const free = [];
  for (let x = X0; x <= X1 - es.w + 1e-6; x += 0.25) for (let z = Z0; z <= Z1 - es.d + 1e-6; z += 0.25) {
    if (Math.max(wx - (x + es.w), x - (wx + ew.w), wz - (z + es.d), z - (wz + ew.d)) >= GAP + 0.1) free.push([x, z]);
  }
  if (!free.length) return null;
  const [sx, sz] = free[(rand() * free.length) | 0];
  return [rw, rs, r3(wx), r3(wz), r3(sx), r3(sz)];
}

const planCache = new Map();
// look: { style (id), work (id), soft (id), seed }; ctx: { door }. -> { ok, problems, items (everything drawn), seats, chef, obstacles, router, lights, windows, ... }: the arrangement of the
// slot's work and soft parts at a template of the table (the first that works, from the one the seed picks), dressed by the style
export function planRoom(look, ctx) {
  const { door } = ctx, key = [look.style, look.work, look.soft, look.seed, door].join('|');
  if (planCache.has(key)) return planCache.get(key);
  let arr = null, rt = null;
  const attempt = tpl => {
    const a = arrange({ work: look.work, soft: look.soft, tpl, door });
    if (!a.ok) return false;
    const r = route(a);
    if (r.problems.length) return false;
    arr = a; rt = r;
    return true;
  };
  const list = TABLE[`${look.work}:${look.soft}:${door}`] || [];
  for (let i = 0; i < list.length && !arr; i++) attempt(list[(look.seed + i) % list.length]);
  if (!arr) {                                                    // not in the table (a new arrangement not yet picked): look for one
    const rand = rng(look.seed);
    for (let i = 0; i < 300 && !arr; i++) { const tpl = sampleTemplate(look.work, look.soft, rand); if (tpl) attempt(tpl); }
  }
  if (!arr) { const out = { ok: false, problems: [`no template fits ${look.work} with ${look.soft}`], look, items: [], lights: [], windows: [], door }; planCache.set(key, out); return out; }
  // the dressing, as much as leaves everybody a way in
  const d = dress({ obstacles: arr.obstacles, windows: arr.windows, soft: { box: arr.boxes.soft } }, door, look.style, rng(look.seed ^ 0x9e3779b9));
  const propObstacles = props => obstaclesOf(props.flatMap(p => [p.it, ...p.withs]));
  let props = d.props, rt2 = route(arr, propObstacles(props));
  while (props.length && (rt2.problems.length || rt2.seats.length < rt.seats.length)) { props = props.slice(0, -1); rt2 = route(arr, propObstacles(props)); }
  const accents = [], softTop = arr.tops.find(t => t.part === 'soft');
  for (const a of softTop ? STYLES[look.style].accents || [] : []) accents.push({ ...a, k: a.k || 'm', x: r3(softTop.x + (a.dx || 0)), z: r3(softTop.z + (a.dz || 0)), y: softTop.y + 0.005, on: true, id: `acc${accents.length}` });
  const items = [...piecesWith(arr, rt2), ...d.items, ...props.flatMap(p => [p.it, ...p.withs]), ...accents];
  const out = {
    ok: rt2.problems.length === 0, problems: rt2.problems, look, door, items, seats: rt2.seats, chef: rt2.chef, spare: rt2.spare, blocked: rt2.blocked,
    obstacles: [...arr.obstacles, ...propObstacles(props)], router: rt2.router, tree: rt2.tree, tops: arr.tops, sofas: arr.soft.sofas, props: props.map(p => p.it),
    windows: items.filter(it => it.k === 'win'), lights: lightsOf(items, look.style), work: { id: arr.workId, th: arr.work.th, box: arr.boxes.work }, soft: { id: arr.softId, th: arr.soft.th, box: arr.boxes.soft }, tpl: arr.tpl, W, D,
  };
  planCache.set(key, out);
  return out;
}

// ------------------------------------------------------------ the looks of a building

// For every office of a plan (its cells: slot, bay, side, row, col), in slot order: the style, the colour theme and the work arrangement that no lower-numbered neighbour has, the one used
// least so far, ties by the hash of the slot. An office has at most five neighbours and there are six styles, eight themes and eight arrangements, so two offices next to each other never
// share one, and the first offices all differ. A later office cannot change an earlier one: a slot looks the same however the building grows.
const looksCache = new WeakMap();
export function looksAll(cells) {
  if (looksCache.has(cells)) return looksCache.get(cells);
  const slots = cells.map(c => c.slot).filter(s => s != null && s >= 0).sort((a, b) => a - b);
  const out = new Map(), use = { style: new Array(STYLE_IDS.length).fill(0), theme: new Array(THEMES_N).fill(0), work: new Array(WORK_IDS.length).fill(0), soft: new Array(SOFT_IDS.length).fill(0) };
  // the choice for one slot: not what a lower neighbour has (banned), not a combination an earlier office already has (avoid), then the one used least, then the one its hash points at
  const pick = (n, banned, uses, pref, avoid = () => false) => {
    let best = -1, bc = Infinity;
    for (let i = 0; i < n; i++) { const v = (pref + i) % n; if (banned.has(v)) continue; const c = (avoid(v) ? 1e4 : 0) + uses[v] * 100 + i; if (c < bc) { bc = c; best = v; } }
    if (best < 0) best = pref % n;                               // cannot happen with at most five lower neighbours
    uses[best]++;
    return best;
  };
  const pairs = new Set(), triples = new Set();                  // (style, work) and (style, work, soft) as they are taken: no two offices read the same until all 144 looks are used
  for (const slot of slots) {
    const lower = neighbourSlots(slot, cells).filter(s => s < slot).map(s => out.get(s)).filter(Boolean);
    const style = pick(STYLE_IDS.length, new Set(lower.map(l => l.style)), use.style, hash('style:' + slot));
    const theme = pick(THEMES_N, new Set(lower.map(l => l.theme)), use.theme, hash('theme:' + slot));
    const work = pick(WORK_IDS.length, new Set(lower.map(l => l.work)), use.work, hash('work:' + slot), v => pairs.has(style + ':' + v));
    pairs.add(style + ':' + work);
    const soft = pick(SOFT_IDS.length, new Set(), use.soft, hash('soft:' + slot), v => triples.has(style + ':' + work + ':' + v));
    triples.add(style + ':' + work + ':' + soft);
    out.set(slot, { slot, style, theme, work, soft, seed: hash('seed:' + slot) });
  }
  looksCache.set(cells, out);
  return out;
}
// the look of one slot with the names in place of the indexes (what planRoom takes)
export const lookOf = l => ({ ...l, style: STYLE_IDS[l.style], work: WORK_IDS[l.work], soft: SOFT_IDS[l.soft] });
