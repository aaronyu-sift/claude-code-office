// Pure layout of the pixel office: agents in, rooms with furniture, desk slots and label points out. No DOM, no sprites, no randomness
// (positions come from hashes of ids and tile coordinates), so the same input always gives the same office and tests can run in Node.
//
// World units are voxels (16 per tile); x east, y north (away from the camera). A room's interior is [x, x + w] x [y, y + d]; its tall
// walls stand just outside the north (y + d) and west (x - 2) edges, low walls (7 high) on the south and east. Rooms keep their
// order: room k only depends on rooms 0..k, so an agent that appears is appended and nobody before it moves.
import { fpSize, deskId } from './ids.js';

export const G = Object.freeze({
  TILE: 16, GAP: 16, WALL_T: 2, WALL_H: 30, LOW_H: 7,
  DEPTH: 160,                      // interior depth: 3 rows of desks, 40 apart, and a 48 deep entrance (door and mat)
  CHIEF_W: 48,                     // the main agent's corner (wood floor, sofa, shelf)
  CHIEF_SEAT: 10,                  // x of the main agent's chair in the room: seated figures overlap on screen when two seats are
  COL_W: 48, ROW_P: 40,            //   about 8 voxels from the same sight line, so the pitches of the desk grid are chosen with
  EAST: 16,                        //   test/occlusion in tools/qa (at most 15 percent of an agent hidden)
  ROWS: 3, FRONT: 32,
  ROW_MAX: 560,                    // widest a row of rooms may get before the next room starts a new row (behind it)
  COLS: [1, 2, 4],                 // desk columns per room class, 3 desks per column
  SHADOW: 44,                      // how far a tall wall hides the ground behind it (along the sight line), in voxels
  MARGIN: 48,                      // grass around the building
});
// widths are multiples of 32 so the wall pieces tile exactly
export const roomWidth = cls => Math.ceil((G.CHIEF_W + G.COLS[cls] * G.COL_W + G.EAST) / 32) * 32;
export const roomCap = cls => G.COLS[cls] * G.ROWS;

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const item = (id, x, y, facing = 0, extra = {}) => {
  const [w, d] = fpSize(id, facing);
  return { id, x, y, z: 0, w, d, facing, ...extra };
};
// an item whose footprint is centred on (cx, cy)
const itemAt = (id, cx, cy, facing = 0, extra = {}) => {
  const [w, d] = fpSize(id, facing);
  return item(id, Math.round(cx - w / 2), Math.round(cy - d / 2), facing, extra);
};

const NORTH_KINDS = ['wall_window', 'wall_poster_a', 'wall_plain', 'wall_window', 'wall_whiteboard', 'wall_poster_b', 'wall_window', 'wall_clock'];
const WEST_KINDS = ['wall_poster_b', 'wall_window', 'wall_plain', 'wall_clock'];

// Rooms of the agents, in the given order. agents: [{ id, cls, project, color }]
export function layoutOffice(agents) {
  const rooms = [];
  let cx = 0, cy = 0, rowCount = 0;
  for (const a of agents) {
    const cls = a.cls | 0;
    const w = roomWidth(cls), d = G.DEPTH;
    if (rowCount && cx + w > G.ROW_MAX) { cx = 0; cy += G.DEPTH + G.GAP; rowCount = 0; }
    rooms.push({ id: a.id, cls, project: a.project, color: a.color, x: cx, y: cy, w, d, cap: roomCap(cls), seed: hashStr(String(a.id)) });
    cx += w + G.GAP; rowCount++;
  }
  for (const r of rooms) buildRoom(r, rooms);

  // building and island bounds
  let bx1 = 0, by1 = 0;
  for (const r of rooms) { bx1 = Math.max(bx1, r.x + r.w); by1 = Math.max(by1, r.y + r.d); }
  const building = rooms.length ? { x0: 0, y0: 0, x1: bx1, y1: by1 } : { x0: 0, y0: 0, x1: 96, y1: G.DEPTH };
  const outdoor = buildOutdoor(rooms, building);
  const bounds = { ...outdoor.island, zTop: 40 };
  return { rooms, shelf: [], building, outdoor, bounds };
}

function rectsOverlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
const roomRect = r => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.d });

function buildRoom(r, rooms) {
  const { x: ox, y: oy, w: W, d: D } = r;
  const others = rooms.filter(o => o !== r).map(roomRect);
  const hid = G.SHADOW;
  // a tall wall would hide the room behind it, so it is only tall when nothing stands in its shadow
  const northShadow = { x0: ox - hid, x1: ox + W, y0: oy + D, y1: oy + D + hid };
  const westShadow = { x0: ox - hid, x1: ox, y0: oy, y1: oy + D + hid };
  r.walls = { north: others.some(o => rectsOverlap(o, northShadow)) ? 'low' : 'tall', west: others.some(o => rectsOverlap(o, westShadow)) ? 'low' : 'tall' };

  const items = r.items = [];
  const floor = r.floor = [];

  // floors: wood in the chief's corner, carpet elsewhere, tile at the door
  const doorX0 = 32, doorX1 = 64;
  for (let tx = 0; tx < W / G.TILE; tx++) for (let ty = 0; ty < D / G.TILE; ty++) {
    const lx = tx * G.TILE, ly = ty * G.TILE;
    let id = (tx + ty) % 2 ? 'floor_felt_b' : 'floor_felt_a';
    if (lx < G.CHIEF_W) id = 'floor_wood';
    if (lx >= doorX0 && lx < doorX1 && ly < G.FRONT) id = 'floor_tile';
    floor.push(item(id, ox + lx, oy + ly, 0, { layer: 'floor', tint: id !== 'floor_tile' }));
  }

  // walls
  const nPieces = W / 32, wPieces = D / 32;
  for (let i = 0; i < nPieces; i++) {
    const id = r.walls.north === 'low' ? 'wall_low' : NORTH_KINDS[(r.seed % 5 + i * 3) % NORTH_KINDS.length];
    items.push(item(id, ox + 32 * i, oy + D, 0, { layer: 'stand', tint: true, wall: 'north' }));
  }
  for (let j = 0; j < wPieces; j++) {
    const id = r.walls.west === 'low' ? 'wall_low' : WEST_KINDS[(r.seed % 3 + j) % WEST_KINDS.length];
    items.push(item(id, ox - G.WALL_T, oy + 32 * j, 1, { layer: 'stand', tint: true, wall: 'west' }));
  }
  items.push(item('wall_corner', ox - G.WALL_T, oy + D, 0, { layer: 'stand', tint: true, wall: 'corner' }));
  for (let i = 0; i < nPieces; i++) {
    if (i === 1) continue;                                                       // the door
    items.push(item('wall_low', ox + 32 * i, oy - G.WALL_T, 0, { layer: 'stand', tint: true, wall: 'south' }));
  }
  for (let j = 0; j < wPieces; j++) items.push(item('wall_low', ox + W, oy + 32 * j, 1, { layer: 'stand', tint: true, wall: 'east' }));
  r.door = { x0: ox + doorX0, x1: ox + doorX1, y: oy };

  // desks: slot 0 is the main agent's desk, then the columns of subagent desks, filled from the back row forward
  const slots = r.slots = [];
  const chiefDesk = { x: ox + 2, y: oy + D - 18 }, [cdw, cdd] = fpSize('deskchief_on');
  slots.push({ index: 0, kind: 'chief', desk: { x: chiefDesk.x, y: chiefDesk.y, w: cdw, d: cdd }, seat: { x: ox + G.CHIEF_SEAT, y: chiefDesk.y - 14, w: 10, d: 10 } });
  let n = 1;
  for (let c = 0; c < G.COLS[r.cls]; c++) {
    for (const row of [2, 1, 0]) {
      const dx = ox + G.CHIEF_W + G.COL_W * c + ((G.COL_W - 28) >> 1), dy = oy + D - 32 - G.ROW_P * (2 - row);
      slots.push({ index: n++, kind: 'sub', desk: { x: dx, y: dy, w: 28, d: 14 }, seat: { x: dx + 9, y: dy - 14, w: 10, d: 10 } });
    }
  }
  // the pivot of the figure and where the label hangs: above the main agent's head
  const chiefSeat = slots[0].seat;
  r.label = { x: chiefSeat.x + 5, y: chiefSeat.y + 5, z: 46 };
  r.chiefPos = { x: chiefSeat.x + 5, y: chiefSeat.y + 5 };

  // furniture that is always there (the desks are drawn from the slots, with the agent's state)
  items.push(itemAt('sofa', ox + 6, oy + 70, 1, { layer: 'stand' }));
  items.push(itemAt('shelf', ox + 3, oy + 106, 1, { layer: 'stand' }));
  items.push(item('rug_a', ox + 14, oy + 66, 0, { layer: 'floor' }));
  items.push(item('table', ox + 18, oy + 70, 0, { layer: 'stand' }));
  items.push(itemAt('plant_tall', ox + 8, oy + 8, 0, { layer: 'stand' }));
  items.push(itemAt('plant_flower', ox + W - 8, oy + 80, 0, { layer: 'stand' }));
  items.push(item('cooler', ox + W - 12, oy + D - 10, 0, { layer: 'stand' }));
  items.push(itemAt('lamp', ox + W - 8, oy + 20, 0, { layer: 'stand' }));
  r.items = items.filter(i => i.layer === 'stand').concat(items.filter(i => i.layer === 'floor'));
  r.deskItems = slots.map(s => ({ chief: s.kind === 'chief', id: deskId(s.kind === 'chief', 'off'), x: s.desk.x, y: s.desk.y }));
}

// Grass island, stone streets between and around the rooms, trees and bushes. Trees only stand on the far sides (north, west), where
// they cannot hide a room; the near sides get low things.
function buildOutdoor(rooms, b) {
  const M = G.MARGIN, T = G.TILE;
  const island = { x0: b.x0 - M, y0: b.y0 - M, x1: b.x1 + M, y1: b.y1 + M };
  const rects = rooms.map(roomRect);
  const dist = (tx, ty) => {            // distance in tiles to the nearest room's interior (0 = inside)
    const cx = tx * T, cy = ty * T;
    let best = Infinity;
    for (const r of rects) {
      const dx = Math.max(r.x0 - (cx + T), cx - r.x1, 0) / T, dy = Math.max(r.y0 - (cy + T), cy - r.y1, 0) / T;
      best = Math.min(best, Math.max(dx, dy));
    }
    return best;
  };
  const tiles = [], items = [];
  for (let tx = island.x0 / T; tx < island.x1 / T; tx++) for (let ty = island.y0 / T; ty < island.y1 / T; ty++) {
    const dd = dist(tx, ty);
    if (dd === 0) continue;                                          // inside a room: its own floor
    let id = 'floor_path';
    if (dd > 1) { const n = hash2(tx, ty, 11); id = n > 0.9 ? 'floor_grass_c' : n > 0.62 ? 'floor_grass_b' : 'floor_grass_a'; }
    tiles.push({ id, x: tx * T, y: ty * T });
  }
  // a bench and two lamp posts on the south side, in front of the building, then decoration on grass cells at least two tiles from every room
  const mid = Math.round((b.x0 + b.x1) / 2);
  const placed = [];
  const place = it => {
    const box = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d };
    if (placed.some(o => rectsOverlap(o, box))) return;
    placed.push(box); items.push(it);
  };
  place(itemAt('bench', mid, b.y0 - 40, 0, { layer: 'stand' }));
  place(itemAt('lamppost', b.x0 + 8, b.y0 - 28, 0, { layer: 'stand' }));
  place(itemAt('lamppost', b.x1 - 8, b.y0 - 28, 0, { layer: 'stand' }));
  for (let tx = island.x0 / T + 1; tx < island.x1 / T - 1; tx++) for (let ty = island.y0 / T + 1; ty < island.y1 / T - 1; ty++) {
    if (dist(tx, ty) < 2) continue;
    const n = hash2(tx, ty, 29), cx = tx * T + T / 2, cy = ty * T + T / 2;
    const far = cy > b.y1 || cx < b.x0 - T;                          // behind or left of the building: trees allowed
    const near = cy < b.y0 || cx > b.x1;                              // in front of or right of it: low things only
    if (n > 0.9 && far && !near) place(itemAt(['tree_a', 'tree_b', 'pine'][Math.floor(hash2(tx, ty, 3) * 3)], cx, cy, 0, { layer: 'stand' }));
    else if (n > 0.82 && n <= 0.9) place(itemAt(hash2(tx, ty, 5) > 0.5 ? 'bush_a' : 'bush_b', cx, cy, 0, { layer: 'stand' }));
    else if (n > 0.78 && n <= 0.82) place(itemAt('rock', cx, cy, 0, { layer: 'stand' }));
    else if (n > 0.75 && n <= 0.78) place(itemAt('flowerbed', cx, cy, 0, { layer: 'stand' }));
  }
  return { island, tiles, items };
}
