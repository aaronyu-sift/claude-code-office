// Sprite ids the pixel scene uses, with their footprints [x, y, w, d] in model voxels (the box the sprite's pivot is the centre of).
// The table itself is generated (footprints.js, from tools/sprites/catalog.mjs); test/manifest.test.mjs checks that it matches public/pixel/manifest.json.
import { FOOTPRINTS, FLAT_IDS } from './footprints.js';

// Spots of the garden whose content depends on the season. The layout keeps a 16 x 16 spot; the scene draws `by[season]` there, or nothing
// when the season has no entry (season.js `spriteFor`). Every sprite named here has a footprint inside the spot.
export const SEASONAL_SLOTS = {
  seasonal_a: { fp: [-8, -8, 16, 16], by: { spring: 'birdbath', summer: 'birdbath', autumn: 'pumpkins', winter: 'snowman' } },
  seasonal_b: { fp: [-8, -8, 16, 16], by: { autumn: 'leafpile' } },
};
export const FP = { ...FOOTPRINTS };
for (const [id, s] of Object.entries(SEASONAL_SLOTS)) FP[id] = s.fp;
export const POSES = ['typeA', 'typeB', 'wait', 'sleep', 'relax', 'think'];     // seated poses; every appearance also has a `stand` figure (4 facings, no chair)
export const APPEARANCES = 6;

export const workerId = (appearance, pose) => `worker_${appearance}_${pose}`;
export const deskId = (chief, state) => `${chief ? 'deskchief' : 'desk'}_${state}`;
export const FLAT = new Set(FLAT_IDS);                    // pieces drawn on the ground layer (rugs, the pond, stepping stones)
export const isFloor = id => id.startsWith('floor_') || FLAT.has(id);

// footprint box size after `facing` quarter turns
export function fpSize(id, facing = 0) {
  const f = FP[id];
  if (!f) throw new Error('unknown sprite id ' + id);
  return facing % 2 ? [f[3], f[2]] : [f[2], f[3]];
}
