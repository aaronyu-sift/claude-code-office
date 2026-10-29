// Pure layout of the pixel office: agents in, rooms with furniture, desk slots and label points out. No DOM, no sprites, no randomness
// (positions come from hashes of ids and tile coordinates), so the same input always gives the same office and tests can run in Node.
//
// World units are voxels (16 per tile); x east, y north (away from the camera). A room's interior is [x, x + w] x [y, y + d]; its tall
// walls stand just outside the north (y + d) and west (x - 2) edges, low walls (7 high) on the south and east. Rooms keep their
// order: room k only depends on rooms 0..k, so an agent that appears is appended and nobody before it moves.
import { fpSize, deskId, FP, isFloor } from './ids.js';

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
  MARGIN: 80,                      // grass around the building (the garden island)
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

// Room themes (by project name, so every chat of a project looks alike): the wall pieces, the furniture of the corners and the desk props.
// Colours come from the project colour at runtime (walls and carpets are tinted), the theme chooses what stands where.
export const THEMES = ['library', 'lounge', 'lab', 'studio'];
const NORTH_KINDS = {
  library: ['wall_shelf', 'wall_window', 'wall_shelf', 'wall_clock', 'wall_sconce', 'wall_window'],
  lounge: ['wall_window_b', 'wall_poster_a', 'wall_window', 'wall_sconce', 'wall_poster_c', 'wall_window_b'],
  lab: ['wall_whiteboard', 'wall_window', 'wall_notice', 'wall_clock', 'wall_door', 'wall_window'],
  studio: ['wall_poster_c', 'wall_window_b', 'wall_glass', 'wall_poster_b', 'wall_window', 'wall_sconce'],
};
const WEST_KINDS = {
  library: ['wall_shelf', 'wall_window', 'wall_poster_c', 'wall_sconce', 'wall_plain'],
  lounge: ['wall_poster_b', 'wall_window_b', 'wall_plain', 'wall_poster_c', 'wall_clock'],
  lab: ['wall_notice', 'wall_window', 'wall_whiteboard', 'wall_plain', 'wall_glass'],
  studio: ['wall_poster_a', 'wall_window', 'wall_sconce', 'wall_poster_c', 'wall_glass'],
};
const NO_TINT = new Set(['wall_shelf', 'wall_glass', 'wall_door']);
// furniture, [id, cx, cy, facing] in room coordinates; `W` is the room width. A piece that does not fit is skipped, in order.
const NOOK = {
  library: W => [['armchair', 9, 70, 1], ['shelf', 3, 106, 1], ['rug_c', 30, 74, 0], ['shelf_b', W - 5, 100, 3], ['shelf_b', W - 5, 72, 3], ['plant_bonsai', W - 12, 44, 0], ['shelf_b', 70, 152, 0],
    ['plant_tall', 8, 8, 0], ['lamp', 14, 92, 0], ['plant_fern', W - 10, 22, 0], ['cabinet', W - 8, 128, 3]],
  lounge: W => [['sofa', 6, 70, 1], ['rug_b', 28, 72, 0], ['table', 29, 74, 0], ['sofa_b', W - 7, 78, 3], ['coffeemachine', W - 10, 116, 3], ['plant_monstera', 12, 22, 0], ['plant_palm', W - 12, 30, 0],
    ['armchair', 20, 44, 0], ['lamp', 8, 96, 0], ['trashbin', W - 8, 100, 0], ['plant_hanging', 8, 128, 0]],
  lab: W => [['serverrack', 6, 66, 1], ['serverrack', 6, 80, 1], ['whiteboardstand', 30, 88, 0], ['printer', W - 8, 70, 3], ['lockers', W - 5, 100, 3], ['cabinet', W - 7, 50, 3], ['trashbin', 14, 40, 0],
    ['plant_snake', 8, 12, 0], ['plant_succulent', W - 10, 20, 0], ['cabinet', 80, 152, 0], ['lamp', 36, 118, 0]],
  studio: W => [['desk_standing', 28, 72, 0], ['rug_c', 28, 64, 0], ['armchair', 8, 90, 1], ['plant_hanging', 6, 108, 0], ['reception', W - 22, 24, 0], ['plant_snake', W - 8, 54, 0],
    ['shelf_b', W - 5, 90, 3], ['plant_cactus', 8, 12, 0], ['trashbin', W - 8, 76, 0], ['lamp', 36, 112, 0], ['plant_orchid', 20, 22, 0]],
};
// small things on the surface of a desk: [id] in order of preference; the spots are boxes on the desk top, [x, y, w, d] in desk coordinates
const PROPS = {
  library: ['prop_books', 'prop_lamp', 'prop_papers', 'prop_mug_b', 'prop_frame', 'prop_pens'],
  lounge: ['prop_mug_a', 'prop_snack', 'prop_headphones', 'prop_figurine', 'prop_plant', 'prop_cactus'],
  lab: ['prop_tablet', 'prop_stickies', 'prop_pens', 'prop_papers', 'prop_lamp', 'prop_mug_a'],
  studio: ['prop_frame', 'prop_cactus', 'prop_figurine', 'prop_plant', 'prop_headphones', 'prop_stickies'],
};
const SUB_SPOTS = [[22, 8, 6, 5], [1, 4, 8, 6]], CHIEF_SPOTS = [[2, 4, 8, 6], [30, 1, 10, 6]];
export const DESK_TOP = 12, TABLE_TOP = 10;

// Rooms of the agents, in the given order. agents: [{ id, cls, project, color }]
export function layoutOffice(agents) {
  const rooms = [];
  let cx = 0, cy = 0, rowCount = 0;
  for (const a of agents) {
    const cls = a.cls | 0;
    const w = roomWidth(cls), d = G.DEPTH;
    if (rowCount && cx + w > G.ROW_MAX) { cx = 0; cy += G.DEPTH + G.GAP; rowCount = 0; }
    rooms.push({ id: a.id, cls, project: a.project, color: a.color, x: cx, y: cy, w, d, cap: roomCap(cls), seed: hashStr(String(a.id)), theme: THEMES[hashStr(String(a.project)) % THEMES.length] });
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
  const { x: ox, y: oy, w: W, d: D, theme } = r;
  const others = rooms.filter(o => o !== r).map(roomRect);
  const hid = G.SHADOW;
  // a tall wall would hide the room behind it, so it is only tall when nothing stands in its shadow
  const northShadow = { x0: ox - hid, x1: ox + W, y0: oy + D, y1: oy + D + hid };
  const westShadow = { x0: ox - hid, x1: ox, y0: oy, y1: oy + D + hid };
  r.walls = { north: others.some(o => rectsOverlap(o, northShadow)) ? 'low' : 'tall', west: others.some(o => rectsOverlap(o, westShadow)) ? 'low' : 'tall' };

  const items = r.items = [];
  const floor = r.floor = [];

  // floors: the chief's corner and the base differ by theme, tile at the door; project-tinted carpets and wood
  const doorX0 = 32, doorX1 = 64;
  for (let tx = 0; tx < W / G.TILE; tx++) for (let ty = 0; ty < D / G.TILE; ty++) {
    const lx = tx * G.TILE, ly = ty * G.TILE;
    let id = theme === 'lab' ? 'floor_tile' : theme === 'studio' ? 'floor_wood' : (tx + ty) % 2 ? 'floor_felt_b' : 'floor_felt_a';
    if (lx < G.CHIEF_W && theme !== 'lab') id = 'floor_wood';
    if (theme === 'lounge' && lx >= W - 32 && ly >= D - 80) id = 'floor_checker';              // the kitchenette
    if (lx >= doorX0 && lx < doorX1 && ly < G.FRONT) id = 'floor_tile';
    floor.push(item(id, ox + lx, oy + ly, 0, { layer: 'floor', tint: id === 'floor_felt_a' || id === 'floor_felt_b' || id === 'floor_wood' }));
  }

  // walls
  const nPieces = W / 32, wPieces = D / 32, nk = NORTH_KINDS[theme], wk = WEST_KINDS[theme];
  for (let i = 0; i < nPieces; i++) {
    const id = r.walls.north === 'low' ? 'wall_low' : nk[(r.seed % nk.length + i * 3) % nk.length];
    items.push(item(id, ox + 32 * i, oy + D, 0, { layer: 'stand', tint: !NO_TINT.has(id), wall: 'north' }));
  }
  for (let j = 0; j < wPieces; j++) {
    const id = r.walls.west === 'low' ? 'wall_low' : wk[(r.seed % wk.length + j) % wk.length];
    items.push(item(id, ox - G.WALL_T, oy + 32 * j, 1, { layer: 'stand', tint: !NO_TINT.has(id), wall: 'west' }));
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
  // the pivot of the figure and where the label hangs: above the main agent's head, the marker and the balloon (so the "!" is never covered)
  const chiefSeat = slots[0].seat;
  r.label = { x: chiefSeat.x + 5, y: chiefSeat.y + 5, z: 62 };
  r.chiefPos = { x: chiefSeat.x + 5, y: chiefSeat.y + 5 };

  // furniture: placed in the order of the theme, whatever does not fit or would stand in a sight line is skipped. Seated agents keep a free
  // zone to the south and east of their chair (the camera looks from there), and the way from the door stays open.
  const blocked = [{ x0: ox + 30, y0: oy, x1: ox + 66, y1: oy + 46 }];
  for (const s of slots) {
    blocked.push({ x0: s.desk.x, y0: s.desk.y, x1: s.desk.x + s.desk.w, y1: s.desk.y + s.desk.d });
    blocked.push({ x0: s.seat.x - 6, y0: s.seat.y - 22, x1: s.seat.x + s.seat.w + 16, y1: s.seat.y + s.seat.d + 2 });
  }
  const put = (id, cx, cy, facing = 0, extra = {}) => {
    const it = itemAt(id, ox + cx, oy + cy, facing, { layer: isFloor(id) ? 'floor' : 'stand', ...extra });
    const b = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d };
    if (b.x0 < ox || b.y0 < oy || b.x1 > ox + W || b.y1 > oy + D) return false;
    if (it.layer === 'stand' && blocked.some(o => rectsOverlap(o, b))) return false;
    if (it.layer === 'stand') blocked.push(b);
    items.push(it);
    return true;
  };
  put('cooler', W - 12, D - 10, 0);
  for (const [id, cx, cy, f] of NOOK[theme](W)) put(id, cx, cy, f);
  put('lamp', W - 8, 20, 0);
  r.items = items.filter(i => i.layer === 'stand').concat(items.filter(i => i.layer === 'floor'));

  // props on the desks (attached to the desk when drawn, so they always stand on its surface)
  r.props = [];
  const list = PROPS[theme];
  for (const s of slots) {
    const spots = s.kind === 'chief' ? CHIEF_SPOTS : SUB_SPOTS;
    const used = new Set();
    spots.forEach(([sx, sy, sw, sd], k) => {
      if (k > 0 && hash2(r.seed % 997, s.index, 7 + k) < 0.3) return;               // not every spot holds something
      for (let t = 0; t < list.length; t++) {
        const id = list[(Math.floor(hash2(r.seed % 997, s.index, 3 + k) * list.length) + t) % list.length];
        const [w, d] = fpSize(id);
        if (used.has(id) || w > sw || d > sd) continue;
        used.add(id);
        r.props.push({ id, x: s.desk.x + sx, y: s.desk.y + sy, z: DESK_TOP, w, d, facing: 0, slot: s.index });
        break;
      }
    });
  }
  r.deskItems = slots.map(s => ({ chief: s.kind === 'chief', id: deskId(s.kind === 'chief', 'off'), x: s.desk.x, y: s.desk.y }));
}

// Grass island: a stone street around the building, then a garden. In front (south) and to the east only low things stand, because they
// are nearer to the camera and could hide a room; trees, sheds and wells stand on the far sides (north, west). Everything is placed with
// an overlap check, in a fixed order, from hashes of tile coordinates.
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
  const placed = [];
  const clear = rects.map(r => ({ x0: r.x0 - 8, y0: r.y0 - 8, x1: r.x1 + 8, y1: r.y1 + 8 }));
  const place = (id, cx, cy, facing = 0, need = 0) => {                // need: tiles of grass the piece wants between it and a room
    const it = itemAt(id, cx, cy, facing, { layer: isFloor(id) ? 'floor' : 'stand' });
    const box = { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.d };
    if (box.x0 < island.x0 + 2 || box.y0 < island.y0 + 2 || box.x1 > island.x1 - 2 || box.y1 > island.y1 - 2) return false;
    const pad = need * T;
    if (clear.some(o => rectsOverlap({ x0: o.x0 - pad, y0: o.y0 - pad, x1: o.x1 + pad, y1: o.y1 + pad }, box))) return false;
    if (placed.some(o => rectsOverlap(o, box))) return false;
    placed.push(box); items.push(it);
    return true;
  };
  const mx = Math.round((b.x0 + b.x1) / 2), my = Math.round((b.y0 + b.y1) / 2), S = b.y0, E = b.x1, N = b.y1, Wst = b.x0;
  // the front garden (south): a fountain in the middle, beds, benches, lamp posts, the bike rack near the door
  place('fountain', mx, S - 58, 0, 1);
  place('flowerbed_c', mx - 66, S - 56, 0, 1); place('flowerbed_c', mx + 66, S - 56, 0, 1);
  place('bench', mx - 34, S - 46, 0, 1); place('bench', mx + 34, S - 46, 0, 1);
  place('lamppost', Wst + 10, S - 28, 0); place('lamppost', E - 10, S - 28, 0); place('lamppost', mx - 40, S - 66, 0, 1); place('lamppost', mx + 40, S - 66, 0, 1);
  place('bikerack', Wst + 56, S - 50, 0, 1);
  place('planter', Wst + 40, S - 36, 0, 1); place('planter', Wst + 84, S - 36, 0, 1);
  place('signpost', Wst - 14, S - 40, 0, 1); place('mailbox', Wst - 34, S - 48, 0, 1);
  place('hedge_a', mx - 110, S - 70, 0, 1); place('hedge_a', mx + 110, S - 70, 0, 1);
  // the east side: a pond with stepping stones, the picnic table
  place('pond', E + 50, my, 0, 1); place('stones', E + 40, my + 34, 0, 1); place('flowerbed_b', E + 56, my - 44, 0, 1);
  place('picnictable', E + 58, my + 66, 1, 1);
  place('hedge_a', E + 66, S - 28, 1, 1);
  // the far sides (north, west): trees, the well, the shed, fences along the edge
  place('shed', E - 20, N + 54, 0, 1); place('well', Wst - 40, my + 40, 0, 1);
  place('picnictable', Wst - 52, my - 40, 1, 1);
  for (let x = island.x0 + 18; x < island.x1 - 40; x += 32) place('fence_a', x + 16, island.y1 - 8, 0);
  for (let y = island.y0 + 50; y < island.y1 - 60; y += 32) place('fence_a', island.x0 + 8, y + 16, 1);
  const TREES = ['tree_a', 'tree_oak', 'pine', 'tree_birch', 'tree_b', 'tree_cypress'];
  let k = 0;
  for (let tx = island.x0 / T + 1; tx < island.x1 / T - 1; tx++) for (let ty = island.y0 / T + 1; ty < island.y1 / T - 1; ty++) {
    if (dist(tx, ty) < 2) continue;
    const n = hash2(tx, ty, 29), cx = tx * T + T / 2, cy = ty * T + T / 2;
    const far = cy > b.y1 || cx < b.x0 - T;                          // behind or left of the building: trees allowed
    const near = cy < b.y0 || cx > b.x1;                              // in front of or right of it: low things only
    if (n > 0.86 && far && !near) place(TREES[(k++ + Math.floor(hash2(tx, ty, 3) * 6)) % TREES.length], cx, cy, 0, 1);
    else if (n > 0.76 && n <= 0.84) place(['bush_a', 'bush_b', 'bush_c', 'bush_d'][Math.floor(hash2(tx, ty, 5) * 4)], cx, cy, 0, 1);
    else if (n > 0.70 && n <= 0.74) place(['rock', 'rock_b', 'rock_c', 'rock_d'][Math.floor(hash2(tx, ty, 6) * 4)], cx, cy, 0, 1);
    else if (n > 0.66 && n <= 0.70) place(['flowerbed', 'flowerbed_d', 'flowerbed_b'][Math.floor(hash2(tx, ty, 7) * 3)], cx, cy, 0, 1);
    else if (n > 0.50 && n <= 0.60) place(hash2(tx, ty, 8) > 0.5 ? 'tuft_a' : 'tuft_b', cx, cy, 0, 1);
  }
  return { island, tiles, items };
}
