// The sprite catalog of the pixel scene: one entry per manifest id.
//   fp      footprint box [x, y, w, d] in model voxels; the sprite's pivot is the centre of this box on the ground,
//           and the scene places objects by it (so layout.js and the manifest must agree, see test/manifest.test.mjs)
//   h       height in voxels (people about 38, walls 30)
//   facings quarter turns baked (1, 2 or 4); a model that is only ever seen from one side bakes one
//   flat    drawn without outline and ambient occlusion (floors, rugs)
import { makePalette, plant, tree, shelf, sofa, cooler, lamp, rug, bush, bench, lampPost } from './models.mjs';
import { officeChair, floorTile, wallPiece, cornerPost, deskState, chiefDesk, seatedWorker, APPEARANCES, POSES, pine, flowerbed, rock, coffeeTable } from './props.mjs';

export { makePalette, APPEARANCES, POSES };

export const SPRITES = [];
const add = (id, cat, fp, h, facings, make, o = {}) => SPRITES.push({ id, cat, fp, h, facings, make, tags: o.tags || [], flat: !!o.flat });

// floors (16 x 16 tiles)
for (const [id, kind, variant] of [['floor_felt_a', 'carpet', 0], ['floor_felt_b', 'carpet', 1], ['floor_wood', 'wood', 0], ['floor_tile', 'tile', 0],
  ['floor_path', 'path', 0], ['floor_grass_a', 'grass', 0], ['floor_grass_b', 'grass', 1], ['floor_grass_c', 'grass', 2]]) {
  add(id, 'floor', [0, 0, 16, 16], 0, 1, p => floorTile(p, kind, variant), { flat: true, tags: [kind, ...(kind === 'carpet' || kind === 'wood' ? ['tint'] : [])] });
}

// walls (32 long, 2 thick): facing 0 is a north wall, facing 1 a west wall
for (const [id, kind] of [['wall_plain', 'plain'], ['wall_window', 'window'], ['wall_poster_a', 'posterA'], ['wall_poster_b', 'posterB'], ['wall_clock', 'clock'], ['wall_whiteboard', 'whiteboard']]) {
  add(id, 'wall', [0, 0, 32, 2], 30, 2, p => wallPiece(p, kind), { tags: ['tint'] });
}
add('wall_low', 'wall', [0, 0, 32, 2], 7, 2, p => wallPiece(p, 'low'), { tags: ['tint', 'low'] });
add('wall_corner', 'wall', [0, 0, 2, 2], 30, 1, p => cornerPost(p), { tags: ['tint'] });

// furniture
for (const s of ['on', 'idle', 'off']) add('desk_' + s, 'furniture', [0, 0, 28, 14], 32, 1, p => deskState(p, s), { tags: ['desk', s] });
for (const s of ['on', 'idle', 'off']) add('deskchief_' + s, 'furniture', [0, 0, 44, 16], 32, 1, p => chiefDesk(p, s), { tags: ['desk', 'chief', s] });
add('chair', 'furniture', [0, 0, 10, 10], 20, 1, p => officeChair(p));
add('sofa', 'furniture', [0, 0, 30, 12], 18, 2, p => sofa(p));
add('shelf', 'furniture', [0, 0, 20, 6], 37, 2, p => shelf(p));
add('cooler', 'furniture', [0, 0, 8, 8], 28, 1, p => cooler(p));
add('lamp', 'furniture', [-3, -3, 6, 6], 33, 1, p => lamp(p));
add('table', 'furniture', [0, 0, 22, 12], 13, 1, p => coffeeTable(p));
add('rug_a', 'furniture', [0, 0, 32, 20], 1, 1, p => rug(p, 32, 20), { flat: true });
add('rug_b', 'furniture', [0, 0, 24, 24], 1, 1, p => rug(p, 24, 24, 'carpetTeal', 'carpetGold'), { flat: true });

// people: a worker on a chair, 6 appearances x 5 poses (typeA and typeB alternate while working)
APPEARANCES.forEach((ap, i) => {
  for (const pose of POSES) add(`worker_${i}_${pose}`, 'people', [0, 0, 10, 10], 38, 1, p => seatedWorker(p, ap, pose), { tags: ['worker', pose] });
});

// plants and outdoors
add('plant_bushy', 'plant', [-5, -5, 10, 10], 24, 1, p => plant(p, 'bushy'));
add('plant_tall', 'plant', [-5, -5, 10, 10], 30, 1, p => plant(p, 'tall'));
add('plant_flower', 'plant', [-5, -5, 10, 10], 22, 1, p => plant(p, 'flower'));
add('tree_a', 'tree', [-4, -4, 8, 8], 36, 1, p => tree(p, 1));
add('tree_b', 'tree', [-4, -4, 8, 8], 36, 1, p => tree(p, 2));
add('pine', 'tree', [-4, -4, 8, 8], 30, 1, p => pine(p));
add('bush_a', 'outdoor', [-9, -5, 18, 10], 12, 1, p => bush(p, 1));
add('bush_b', 'outdoor', [-9, -5, 18, 10], 12, 1, p => bush(p, 2));
add('bench', 'outdoor', [0, 0, 26, 7], 16, 2, p => bench(p));
add('lamppost', 'outdoor', [-3, -3, 7, 7], 38, 1, p => lampPost(p));
add('flowerbed', 'outdoor', [0, 0, 24, 8], 10, 2, p => flowerbed(p, 1));
add('rock', 'outdoor', [-6, -4, 14, 10], 7, 1, p => rock(p, 1));
