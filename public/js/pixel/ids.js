// Sprite ids the pixel scene uses, with their footprints [x, y, w, d] in model voxels (the box the sprite's pivot is the centre of).
// test/manifest.test.mjs checks that every id here exists in public/pixel/manifest.json with the same footprint, and the other way round.

export const FP = {
  floor_felt_a: [0, 0, 16, 16], floor_felt_b: [0, 0, 16, 16], floor_wood: [0, 0, 16, 16], floor_tile: [0, 0, 16, 16], floor_path: [0, 0, 16, 16],
  floor_grass_a: [0, 0, 16, 16], floor_grass_b: [0, 0, 16, 16], floor_grass_c: [0, 0, 16, 16],
  wall_plain: [0, 0, 32, 2], wall_window: [0, 0, 32, 2], wall_poster_a: [0, 0, 32, 2], wall_poster_b: [0, 0, 32, 2], wall_clock: [0, 0, 32, 2],
  wall_whiteboard: [0, 0, 32, 2], wall_low: [0, 0, 32, 2], wall_corner: [0, 0, 2, 2],
  desk_on: [0, 0, 28, 14], desk_idle: [0, 0, 28, 14], desk_off: [0, 0, 28, 14],
  deskchief_on: [0, 0, 44, 16], deskchief_idle: [0, 0, 44, 16], deskchief_off: [0, 0, 44, 16],
  chair: [0, 0, 10, 10], sofa: [0, 0, 30, 12], shelf: [0, 0, 20, 6], cooler: [0, 0, 8, 8], lamp: [-3, -3, 6, 6], table: [0, 0, 22, 12],
  rug_a: [0, 0, 32, 20], rug_b: [0, 0, 24, 24],
  plant_bushy: [-5, -5, 10, 10], plant_tall: [-5, -5, 10, 10], plant_flower: [-5, -5, 10, 10],
  tree_a: [-4, -4, 8, 8], tree_b: [-4, -4, 8, 8], pine: [-4, -4, 8, 8],
  bush_a: [-9, -5, 18, 10], bush_b: [-9, -5, 18, 10], bench: [0, 0, 26, 7], lamppost: [-3, -3, 7, 7], flowerbed: [0, 0, 24, 8], rock: [-6, -4, 14, 10],
};
export const POSES = ['typeA', 'typeB', 'wait', 'sleep', 'relax'];
export const APPEARANCES = 6;
for (let a = 0; a < APPEARANCES; a++) for (const p of POSES) FP[`worker_${a}_${p}`] = [0, 0, 10, 10];

export const workerId = (appearance, pose) => `worker_${appearance}_${pose}`;
export const deskId = (chief, state) => `${chief ? 'deskchief' : 'desk'}_${state}`;
export const FLAT = new Set(['rug_a', 'rug_b']);           // furniture drawn on the ground layer
export const isFloor = id => id.startsWith('floor_') || FLAT.has(id);

// footprint box size after `facing` quarter turns
export function fpSize(id, facing = 0) {
  const f = FP[id];
  if (!f) throw new Error('unknown sprite id ' + id);
  return facing % 2 ? [f[3], f[2]] : [f[2], f[3]];
}
