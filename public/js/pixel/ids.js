// Sprite ids the pixel scene uses, with their footprints [x, y, w, d] in model voxels (the box the sprite's pivot is the centre of).
// The table itself is generated (footprints.js, from tools/sprites/catalog.mjs); test/manifest.test.mjs checks that it matches public/pixel/manifest.json.
import { FOOTPRINTS, FLAT_IDS } from './footprints.js';

export const FP = { ...FOOTPRINTS };
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
