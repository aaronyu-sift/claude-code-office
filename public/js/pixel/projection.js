// Projections of the pixel scene. The world is measured in voxels: x east, y north (away from the camera), z up.
// One tile is 16 voxels. A projection maps a world point to a pixel of the virtual (zoom 1) canvas and back, says
// which wall sides face the camera, how to order sprites and what the view needs from the layout (which sides of the building are
// near the camera, what a tall wall hides, what must stay free in front of a seat), so no other module has to branch on the view.
//
// The numbers here are also what tools/sprites/atlas.ts hands to the VoxPix camera, so sprites and scene agree:
//   iso:   yaw -45, elevation 30, 2:1 diamonds, 16 voxels = 12 px along each ground axis, 1 voxel of height = h px.
//   front: oblique camera (y 0.75, z 1): a tile is 16 x 12 px, walls rise straight up.

export const TILE = 16;

const ISO_PPU = 0.75 / Math.SQRT1_2;          // 12 px per tile along the x axis of the screen: a clean 24 x 12 px diamond per tile
const ISO_H = ISO_PPU;                         // pixels per voxel of height (VoxPix default z scale)

// quarter turns of an object, counter-clockwise seen from above: facing k rotates the model by k * 90 degrees
export const FACINGS = 4;

function make(def) {
  const { a, b, c, d, h } = def.m;             // sx = a x + b y ; sy = c x + d y - h z
  const det = a * d - b * c;
  return Object.freeze({
    name: def.name,
    tile: def.tile,                            // [width, height] in px of one ground tile (the diamond's bounding box)
    wallSides: def.wallSides,                  // sides whose walls face the camera, drawn tall (the others stay low)
    nearSides: def.nearSides,                  // sides of the building towards the camera: only low things stand there
    farSides: def.farSides,                    // sides where tall things (trees, sheds) cannot hide a room
    layout: def.layout,                        // numbers of the layout engine that depend on the view: { rowMax, depth, rowPitch }
    wallShadow: def.wallShadow,                // (side, room {x, y, w, d}, reach) -> ground box {x0, y0, x1, y1} a tall wall on that side hides
    sightZone: def.sightZone,                  // (seat {x, y, w, d}) -> ground box in front of a seat that stays free of furniture
    render: def.render,                        // camera parameters for tools/sprites (VoxPix)
    toScreen(x, y, z = 0) { return [a * x + b * y, c * x + d * y - h * z]; },
    toGround(sx, sy, z = 0) {
      const t = sy + h * z;
      return [(d * sx - b * t) / det, (a * t - c * sx) / det];
    },
    // Painter's order for upright sprites: bigger key = nearer to the camera = drawn later.
    // `fp` is the footprint box {x0, y0, x1, y1} in voxels.
    depthKey: def.depthKey,
    // Pairwise order of two disjoint footprint boxes: -1 if `a` is farther than `b` (draw it first), 1 if nearer, 0 if the view
    // does not order them (they never overlap on screen, or the axes disagree).
    behind: def.behind,
    facingYaw(k) { return def.render.yaw + 90 * (((k % FACINGS) + FACINGS) % FACINGS); },
    // the box a footprint takes after k quarter turns about its centre
    rotateFootprint(w, dd, k) { return k % 2 ? [dd, w] : [w, dd]; },
  });
}

export const ISO = make({
  name: 'iso',
  tile: [24, 12],
  m: { a: 0.75, b: 0.75, c: 0.375, d: -0.375, h: ISO_H },
  wallSides: ['north', 'west'],
  nearSides: ['south', 'east'],
  farSides: ['north', 'west'],
  layout: { rowMax: 560, depth: 160, rowPitch: 40 },
  // the camera looks towards the north-west: a tall wall hides the ground behind it, `reach` voxels to the north and to the west
  wallShadow(side, r, reach) {
    return side === 'north' ? { x0: r.x - reach, y0: r.y + r.d, x1: r.x + r.w, y1: r.y + r.d + reach } : { x0: r.x - reach, y0: r.y, x1: r.x, y1: r.y + r.d + reach };
  },
  // seated agents are seen from the south-east: keep the strip to the south and to the east of the chair clear
  sightZone(s) { return { x0: s.x - 6, y0: s.y - 22, x1: s.x + s.w + 16, y1: s.y + s.d + 2 }; },
  render: { yaw: -45, elevation: 30, ppu: ISO_PPU, oblique: null },
  // nearest corner of the footprint first (x1 - y0), then the far corner, then height
  depthKey(fp, z = 0) { return (fp.x1 - fp.y0) * 1000 + (fp.x0 - fp.y1) + z * 0.01; },
  // far is -x and +y: a box west of another is farther, a box north of it is farther
  behind(a, b) {
    const x = a.x1 <= b.x0 ? -1 : b.x1 <= a.x0 ? 1 : 0, y = a.y0 >= b.y1 ? -1 : b.y0 >= a.y1 ? 1 : 0;
    if (x * y < 0) return 0;
    return Math.sign(x + y);
  },
});

export const FRONT = make({
  name: 'front',
  tile: [16, 12],
  m: { a: 1, b: 0, c: 0, d: -0.75, h: 1 },
  wallSides: ['north'],
  nearSides: ['south'],
  farSides: ['north', 'west', 'east'],
  // walls rise straight up and the rows of desks stack on screen: more depth between the rows keeps a monitor from covering the agent behind it
  layout: { rowMax: 720, depth: 192, rowPitch: 58 },
  // the camera looks straight north: a tall north wall hides the strip behind it; the west and east walls are seen edge-on (never tall)
  wallShadow(side, r, reach) { return { x0: r.x, y0: r.y + r.d, x1: r.x + r.w, y1: r.y + r.d + reach }; },
  // seated agents are seen from the south: keep the strip in front of the chair clear
  sightZone(s) { return { x0: s.x - 4, y0: s.y - 34, x1: s.x + s.w + 4, y1: s.y + s.d + 2 }; },
  render: { yaw: 0, elevation: 30, ppu: 1, oblique: { y: 0.75, z: 1 } },
  depthKey(fp, z = 0) { return -fp.y0 * 1000 + (fp.x0 - fp.y1) * 0.001 + z * 0.01; },
  behind(a, b) { return a.y0 >= b.y1 ? -1 : b.y0 >= a.y1 ? 1 : 0; },
});

export const PROJECTIONS = { iso: ISO, front: FRONT };
export const projectionByName = name => PROJECTIONS[name] || ISO;

// Pixel bounds of a box of the world [x0, x1] x [y0, y1] x [0, zTop]: where its eight corners land.
export function screenBounds(proj, x0, y0, x1, y1, zTop = 0, zBottom = 0) {
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [zBottom, zTop]) {
    const [sx, sy] = proj.toScreen(x, y, z);
    if (sx < sx0) sx0 = sx; if (sx > sx1) sx1 = sx;
    if (sy < sy0) sy0 = sy; if (sy > sy1) sy1 = sy;
  }
  return { x0: sx0, y0: sy0, x1: sx1, y1: sy1, w: sx1 - sx0, h: sy1 - sy0 };
}
