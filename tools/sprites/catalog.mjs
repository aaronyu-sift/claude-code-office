// The sprite catalog of the pixel scene: one entry per manifest id.
//   fp      footprint box [x, y, w, d] in model voxels; the sprite's pivot is the centre of this box on the ground,
//           and the scene places objects by it (so layout.js and the manifest must agree, see test/manifest.test.mjs)
//   h       height in voxels (people about 38, walls 30)
//   facings quarter turns baked (1, 2 or 4); a model that is only ever seen from one side bakes one
//   flat    drawn without outline and ambient occlusion (floors, rugs)
import { makePalette, plant, tree, shelf, sofa, cooler, lamp, rug, bush, bench, lampPost } from './models.mjs';
import { officeChair, floorTile, wallPiece, cornerPost, pillar, deskState, chiefDesk, seatedWorker, standingWorker, APPEARANCES, POSES, pine, flowerbed, rock, coffeeTable } from './props.mjs';
import * as D from './decor.mjs';

export { makePalette, APPEARANCES, POSES };

export const SPRITES = [];
// o.anchors: points on the model [{ k: 'monitor' | 'lamp' | 'window' | 'led' | 'steam', at: [x, y, z] (model voxels), r: radius in px, s: strength }]; the atlas
// build projects them for every facing, so the scene can light them at night or animate them without knowing the view
const add = (id, cat, fp, h, facings, make, o = {}) => SPRITES.push({ id, cat, fp, h, facings, make, tags: o.tags || [], flat: !!o.flat, anchors: o.anchors || [] });

// floors (16 x 16 tiles)
for (const [id, kind, variant] of [['floor_felt_a', 'carpet', 0], ['floor_felt_b', 'carpet', 1], ['floor_wood', 'wood', 0], ['floor_tile', 'tile', 0],
  ['floor_path', 'path', 0], ['floor_grass_a', 'grass', 0], ['floor_grass_b', 'grass', 1], ['floor_grass_c', 'grass', 2],
  ['floor_checker', 'checker', 0], ['floor_hall', 'hall', 0], ['floor_gold', 'gold', 0], ['floor_teal', 'teal', 0]]) {
  add(id, 'floor', [0, 0, 16, 16], 0, 1, p => floorTile(p, kind, variant), { flat: true, tags: [kind, ...(kind === 'carpet' || kind === 'wood' ? ['tint'] : [])] });
}

// walls (32 long, 2 thick): facing 0 is a north wall, facing 1 a west wall
for (const [id, kind] of [['wall_plain', 'plain'], ['wall_window', 'window'], ['wall_poster_a', 'posterA'], ['wall_poster_b', 'posterB'], ['wall_clock', 'clock'], ['wall_whiteboard', 'whiteboard'],
  ['wall_door', 'door'], ['wall_poster_c', 'posterC'], ['wall_notice', 'notice'], ['wall_shelf', 'shelfwall'], ['wall_glass', 'glass'], ['wall_window_b', 'windowB'], ['wall_sconce', 'sconce']]) {
  const anchors = kind === 'window' ? [{ k: 'window', at: [16, 0, 19], r: 13 }] : kind === 'windowB' ? [{ k: 'window', at: [8, 0, 19.5], r: 9 }, { k: 'window', at: [23, 0, 19.5], r: 9 }] : kind === 'sconce' ? [{ k: 'lamp', at: [16, -2, 24], r: 10 }] : [];
  add(id, 'wall', [0, 0, 32, 2], 30, 2, p => wallPiece(p, kind), { tags: ['tint', ...(anchors.length ? ['lit'] : [])], anchors });
}
add('wall_low', 'wall', [0, 0, 32, 2], 7, 2, p => wallPiece(p, 'low'), { tags: ['tint', 'low'] });
add('wall_corner', 'wall', [0, 0, 2, 2], 30, 1, p => cornerPost(p), { tags: ['tint'] });
add('wall_cap', 'wall', [0, 0, 2, 2], 30, 1, p => pillar(p), { tags: ['tint'] });

// furniture
const screen = (s, at) => (s === 'off' ? [] : [{ k: 'monitor', at, r: 7, s: s === 'on' ? 1 : 0.55 }]);
for (const s of ['on', 'idle', 'off']) add('desk_' + s, 'furniture', [0, 0, 28, 14], 32, 1, p => deskState(p, s), { tags: ['desk', s, ...(s === 'off' ? [] : ['lit'])], anchors: screen(s, [15.5, 6, 23.5]) });
for (const s of ['on', 'idle', 'off']) add('deskchief_' + s, 'furniture', [0, 0, 44, 16], 32, 1, p => chiefDesk(p, s), { tags: ['desk', 'chief', s, ...(s === 'off' ? [] : ['lit'])], anchors: [...screen(s, [21, 7, 24]), ...screen(s, [36, 7, 24])] });
add('chair', 'furniture', [0, 0, 10, 10], 20, 1, p => officeChair(p));
add('sofa', 'furniture', [0, 0, 30, 12], 18, 2, p => sofa(p));
add('shelf', 'furniture', [0, 0, 20, 6], 37, 2, p => shelf(p));
add('cooler', 'furniture', [0, 0, 8, 8], 28, 1, p => cooler(p));
add('lamp', 'furniture', [-3, -3, 6, 6], 33, 1, p => lamp(p), { tags: ['lit'], anchors: [{ k: 'lamp', at: [0, 0, 29], r: 14 }] });
add('table', 'furniture', [0, 0, 22, 12], 13, 1, p => coffeeTable(p));
add('rug_a', 'furniture', [0, 0, 32, 20], 1, 1, p => rug(p, 32, 20), { flat: true });
add('rug_b', 'furniture', [0, 0, 24, 24], 1, 1, p => rug(p, 24, 24, 'carpetTeal', 'carpetGold'), { flat: true });
add('rug_c', 'furniture', [0, 0, 24, 24], 1, 1, p => D.rugRound(p, 12), { flat: true });
add('sofa_b', 'furniture', [0, 0, 24, 11], 17, 2, p => D.loveseat(p));
add('armchair', 'furniture', [0, 0, 14, 13], 19, 2, p => D.armchair(p));
add('shelf_b', 'furniture', [0, 0, 18, 6], 28, 2, p => D.lowBookcase(p));
add('cabinet', 'furniture', [0, 0, 10, 8], 22, 2, p => D.cabinet(p));
add('printer', 'furniture', [0, 0, 14, 10], 11, 1, p => D.printer(p), { tags: ['lit'], anchors: [{ k: 'led', at: [4, -1, 8], r: 3 }] });
add('coffeemachine', 'furniture', [0, 0, 12, 8], 19, 1, p => D.coffeeMachine(p), { tags: ['lit', 'steam'], anchors: [{ k: 'led', at: [3.5, -1, 12.5], r: 3 }, { k: 'steam', at: [5, -1, 20], r: 4 }] });
add('serverrack', 'furniture', [0, 0, 12, 10], 40, 2, p => D.serverRack(p), { tags: ['lit'], anchors: [[3, 5], [8, 17], [4, 29]].map(([x, z]) => ({ k: 'led', at: [x, -1, z], r: 3 })) });
add('whiteboardstand', 'furniture', [0, -2, 22, 7], 36, 2, p => D.whiteboardStand(p));
add('lockers', 'furniture', [0, 0, 24, 8], 34, 2, p => D.lockers(p));
add('trashbin', 'furniture', [0, 0, 6, 6], 9, 1, p => D.trashBin(p));
add('reception', 'furniture', [0, 0, 36, 14], 24, 2, p => D.reception(p));
add('desk_standing', 'furniture', [0, 0, 24, 12], 33, 2, p => D.standingDesk(p), { tags: ['lit'], anchors: [{ k: 'monitor', at: [13, 4.5, 29.5], r: 6 }] });
add('desk_l', 'furniture', [0, 0, 36, 26], 28, 4, p => D.lDesk(p), { tags: ['lit'], anchors: [{ k: 'monitor', at: [21, 6, 23], r: 7 }] });

// desk props: small things that stand on a desk, a table or a counter (the scene lifts them to the surface)
const PROP = {
  laptop: [[0, 0, 10, 7], 8, { tags: ['lit'], anchors: [{ k: 'monitor', at: [5, 5, 5], r: 4 }] }], mug_a: [[0, 0, 3, 3], 4], mug_b: [[0, 0, 3, 3], 4], plant: [[0, 0, 5, 5], 8], lamp: [[0, 0, 4, 4], 11, { tags: ['lit'], anchors: [{ k: 'lamp', at: [2, 2, 9], r: 8 }] }],
  papers: [[0, 0, 7, 6], 4], figurine: [[0, 0, 3, 3], 7], headphones: [[0, 0, 7, 4], 6], stickies: [[0, 0, 5, 5], 3], books: [[0, 0, 6, 4], 5], snack: [[0, 0, 5, 5], 3],
  tablet: [[0, 0, 6, 4], 2], frame: [[0, 0, 4, 2], 6], pens: [[0, 0, 3, 3], 7], cactus: [[0, 0, 4, 4], 8],
};
for (const [k, [fp, h, o = {}]] of Object.entries(PROP)) add('prop_' + k, 'deskprop', fp, h, 1, p => D.propModels[k](p), { tags: ['prop', ...(o.tags || [])], anchors: o.anchors });

// people: a worker on a chair, 6 appearances x 5 poses (typeA and typeB alternate while working)
APPEARANCES.forEach((ap, i) => {
  for (const pose of POSES) add(`worker_${i}_${pose}`, 'people', [0, 0, 10, 10], 38, 1, p => seatedWorker(p, ap, pose), { tags: ['worker', pose] });
  add(`worker_${i}_stand`, 'people', [0, 0, 10, 10], 38, 4, p => standingWorker(p, ap), { tags: ['worker', 'stand'] });
});

// plants and outdoors
add('plant_bushy', 'plant', [-5, -5, 10, 10], 24, 1, p => plant(p, 'bushy'));
add('plant_tall', 'plant', [-5, -5, 10, 10], 30, 1, p => plant(p, 'tall'));
add('plant_flower', 'plant', [-5, -5, 10, 10], 22, 1, p => plant(p, 'flower'));
for (const [k, fp, h] of [['hanging', [-3, -4, 12, 8], 30], ['cactus', [-5, -5, 10, 10], 24], ['bonsai', [-6, -3, 13, 7], 22], ['fern', [-6, -6, 12, 12], 18], ['palm', [-6, -6, 12, 12], 34],
  ['succulent', [-4, -4, 8, 8], 11], ['snake', [-5, -5, 10, 10], 24], ['monstera', [-6, -6, 12, 12], 28], ['orchid', [-4, -4, 12, 8], 20]]) add('plant_' + k, 'plant', fp, h, 1, p => D.plantModels[k](p), { tags: ['sway'] });
add('tree_a', 'tree', [-4, -4, 8, 8], 36, 1, p => tree(p, 1));
add('tree_b', 'tree', [-4, -4, 8, 8], 36, 1, p => tree(p, 2));
add('pine', 'tree', [-4, -4, 8, 8], 30, 1, p => pine(p));
add('tree_oak', 'tree', [-4, -4, 8, 8], 36, 1, p => D.treeModels.oak(p), { tags: ['sway'] });
add('tree_birch', 'tree', [-4, -4, 8, 8], 36, 1, p => D.treeModels.birch(p), { tags: ['sway'] });
add('tree_cypress', 'tree', [-4, -4, 8, 8], 41, 1, p => D.treeModels.cypress(p), { tags: ['sway'] });
add('bush_a', 'bush', [-9, -5, 18, 10], 12, 1, p => bush(p, 1), { tags: ['sway'] });
add('bush_b', 'bush', [-9, -5, 18, 10], 12, 1, p => bush(p, 2), { tags: ['sway'] });
add('bush_c', 'bush', [-7, -6, 14, 12], 12, 1, p => D.roundBush(p), { tags: ['sway'] });
add('bush_d', 'bush', [-7, -6, 14, 12], 12, 1, p => D.floweringBush(p), { tags: ['sway'] });
add('hedge_a', 'hedge', [0, 0, 32, 6], 12, 2, p => D.hedge(p, 32, 'hedge_a'));
add('hedge_b', 'hedge', [0, 0, 16, 6], 12, 2, p => D.hedge(p, 16, 'hedge_b'));
add('flowerbed', 'flowerbed', [0, 0, 24, 8], 10, 2, p => flowerbed(p, 1));
for (const [k, fp, h, f] of [['b', [0, 0, 16, 16], 8, 1], ['c', [0, 0, 32, 8], 10, 2], ['d', [0, 0, 24, 8], 12, 2]]) add('flowerbed_' + k, 'flowerbed', fp, h, f, p => D.flowerbedModel(p, k));
add('tuft_a', 'tuft', [-2, -2, 5, 5], 5, 1, p => D.tuft(p, 1), { tags: ['sway'] });
add('tuft_b', 'tuft', [-2, -2, 5, 5], 6, 1, p => D.tuft(p, 2), { tags: ['sway'] });
add('rock', 'rock', [-6, -4, 14, 10], 7, 1, p => rock(p, 1));
add('rock_b', 'rock', [-8, -5, 16, 10], 5, 1, p => D.rockModel(p, 'b'));
add('rock_c', 'rock', [-4, -4, 12, 8], 12, 1, p => D.rockModel(p, 'c'));
add('rock_d', 'rock', [-7, -6, 14, 12], 7, 1, p => D.rockModel(p, 'd'));
add('bench', 'outdoor', [0, 0, 26, 7], 16, 2, p => bench(p));
add('lamppost', 'outdoor', [-3, -3, 7, 7], 38, 1, p => lampPost(p), { tags: ['lit'], anchors: [{ k: 'lamp', at: [0, 0, 35], r: 18 }] });
add('picnictable', 'outdoor', [0, 0, 28, 18], 14, 2, p => D.picnicTable(p));
add('fence_a', 'outdoor', [0, 0, 32, 2], 12, 2, p => D.fence(p, 'a'));
add('fence_b', 'outdoor', [0, 0, 32, 2], 14, 2, p => D.fence(p, 'b'));
add('signpost', 'outdoor', [-8, -2, 17, 4], 24, 2, p => D.signpost(p));
add('bikerack', 'outdoor', [0, 0, 20, 6], 10, 2, p => D.bikeRack(p));
add('fountain', 'outdoor', [-12, -12, 24, 24], 22, 1, p => D.fountain(p));
add('pond', 'outdoor', [0, 0, 48, 40], 1, 1, p => D.pond(p), { flat: true });
add('stones', 'outdoor', [0, 0, 16, 16], 1, 1, p => D.steppingStones(p), { flat: true });
add('planter', 'outdoor', [0, 0, 14, 8], 17, 2, p => D.planter(p));
add('well', 'outdoor', [-8, -6, 17, 12], 30, 1, p => D.well(p));
add('shed', 'outdoor', [0, 0, 28, 24], 30, 2, p => D.shed(p), { tags: ['lit'], anchors: [{ k: 'window', at: [22, -2, 12], r: 9 }] });
add('mailbox', 'outdoor', [-3, -3, 7, 6], 20, 2, p => D.mailbox(p));

// ---- Goal 4: seasons -------------------------------------------------------------------------------------------------------------------------
// Outdoor sprites get baked variants `<id>@spring|autumn|winter` (summer is the plain sprite; see seasons.mjs for how they are made). A
// variant exists only where it differs from the plain sprite. The scene asks for `<id>@<season>` and falls back to the plain id.
import { seasonPalette, snowCaps, bareTree, remap, strip, groundSpring, groundAutumn, pathWinter, birdBath, pumpkins, leafPile, snowman } from './seasons.mjs';
add('birdbath', 'outdoor', [-7, -7, 14, 14], 14, 1, p => birdBath(p));
add('pumpkins', 'outdoor', [-7, -7, 14, 14], 10, 1, p => pumpkins(p));
add('leafpile', 'outdoor', [-7, -7, 14, 14], 7, 1, p => leafPile(p));
add('snowman', 'outdoor', [-7, -7, 14, 14], 25, 1, p => snowman(p));

const BASE = new Map(SPRITES.map(s => [s.id, s]));
let n = 0;
// post(v, palette, seed) turns the model built with the season's palette into the variant; tags: replace the plain sprite's tags (a bare tree does not sway)
function variant(id, season, post, o = {}) {
  const b = BASE.get(id), seed = ++n;
  SPRITES.push({ ...b, id: `${id}@${season}`, tags: o.tags || b.tags, make: () => { const pal = seasonPalette(season), v = b.make(pal); return post ? post(v, pal, seed) : v; } });
}
const noSway = id => BASE.get(id).tags.filter(t => t !== 'sway');
const caps = o => (v, pal, seed) => snowCaps(v, pal, { seed, ...o });

for (const id of ['tree_a', 'tree_b', 'tree_oak', 'tree_birch', 'pine', 'tree_cypress']) {
  variant(id, 'spring'); variant(id, 'autumn');
  if (id === 'pine' || id === 'tree_cypress') variant(id, 'winter', caps({ prob: 0.85, lift: 0.55 }));
  else variant(id, 'winter', (v, pal, seed) => bareTree(v, pal, seed), { tags: noSway(id) });
}
for (const id of ['bush_a', 'bush_b', 'bush_c', 'bush_d', 'hedge_a', 'hedge_b', 'tuft_a', 'tuft_b']) {
  variant(id, 'spring'); variant(id, 'autumn'); variant(id, 'winter', caps({ prob: id.startsWith('tuft') ? 0.6 : 0.74, lift: 0.4 }));
}
for (const id of ['flowerbed', 'flowerbed_b', 'flowerbed_c', 'flowerbed_d']) {
  variant(id, 'spring'); variant(id, 'autumn'); variant(id, 'winter', caps({ prob: 0.9, keep: ['flower'], keepProb: 0.35 }));
}
for (const id of ['rock', 'rock_b', 'rock_c', 'rock_d', 'bench', 'lamppost']) variant(id, 'winter', caps({ prob: 0.95, lift: 0.5 }));
for (const id of ['floor_grass_a', 'floor_grass_b', 'floor_grass_c']) {
  variant(id, 'spring', (v, pal, seed) => groundSpring(v, pal, seed)); variant(id, 'autumn', (v, pal, seed) => groundAutumn(v, pal, seed)); variant(id, 'winter');
}
variant('floor_path', 'autumn', (v, pal, seed) => groundAutumn(v, pal, seed)); variant('floor_path', 'winter', (v, pal) => pathWinter(v, pal));
variant('pond', 'winter', (v, pal, seed) => snowCaps(strip(remap(v, pal, 'water', 'ice'), pal, ['leaf', 'flowerP', 'flowerW']), pal, { prob: 0.45, lift: 0, seed }));
