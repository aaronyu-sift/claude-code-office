import { writeFileSync } from 'node:fs';
import { Vox, hash } from './lib.mjs';
import { makePalette, desk, chair, worker, plant, tree, shelf, sofa, cooler, lamp, rug, wallPiece, bush, bench, lampPost, groundPatch } from './models.mjs';

const p = makePalette();
const W = 96, D = 64;
const d = new Vox(p, 'diorama');
// grass island
d.put(groundPatch(p, W + 70, D + 60, 3), -40, -36, 0);
// path of stones to the room's front corner
for (let i = 0; i < 9; i++) d.box(W / 2 - 4 + (i % 2) * 3, -34 + i * 4, 0, W / 2 + 3 + (i % 2) * 3, -31 + i * 4, 1, (x, y, z) => p.m('tile', 2 + (hash(x, y, 2) > 0.6 ? 1 : 0)));
// floor (checker carpet), z -2..0
d.box(0, 0, -2, W, D, 0, (x, y, z) => (z === -2 ? p.m('woodDark', 1) : p.m('carpetTeal', ((x >> 3) + (y >> 3)) % 2 ? 2 : 3)));
d.box(-2, -2, -2, 0, D + 2, 0, p.m('trim', 1)).box(0, -2, -2, W + 2, 0, 0, p.m('trim', 1));    // threshold lines on the front and west edges
// walls
d.put(wallPiece(p, 32, 'plain'), 0, D, 0).put(wallPiece(p, 32, 'window'), 32, D, 0).put(wallPiece(p, 32, 'window'), 64, D, 0);
for (const [y0, kind] of [[0, 'plain'], [22, 'poster'], [44, 'clock']]) d.put(wallPiece(p, y0 === 44 ? 20 : 22, kind), 0, y0, 0, 1);
// corner post
d.box(-2, D, 0, 0, D + 2, 30, p.m('trim', 2));
// furniture
d.put(shelf(p), 3, D - 6, 0);
const seat = (x, y, w) => { d.put(desk(p), x, y, 0).put(chair(p), x + 9, y - 14, 0).put(w, x + 9, y - 14, 0); };
seat(32, D - 16, worker(p, { shirt: 'shirtB', hair: 'hairBlond', skin: 'skin1', hairStyle: 'long' }));
seat(64, D - 16, worker(p, { shirt: 'shirtA', hair: 'hairBlack', skin: 'skin2', hairStyle: 'tuft', typing: 1 }));
d.put(rug(p, 40, 22), 28, 4, 0);
d.put(sofa(p), 14, 6, 0, 1);
d.box(34, 10, 0, 50, 18, 5, p.m('wood', 2)).box(34, 10, 5, 50, 18, 6, p.m('deskTop', 3));
d.put(plant(p, 'tall'), W - 6, D - 8, 0).put(plant(p, 'flower'), 8, 26, 0).put(cooler(p), W - 14, D - 11, 0).put(lamp(p), 8, 46, 0);
d.put(plant(p, 'bushy'), W - 8, 6, 0);
// outside
d.put(tree(p, 1), -22, 40, 0).put(tree(p, 2), W + 24, 52, 0).put(tree(p, 3), W + 20, -4, 0);
for (const [x, y, s] of [[-12, 4, 1], [-14, 24, 2], [10, -12, 3], [W + 8, 20, 4], [60, -14, 5], [W / 2 + 22, -10, 6]]) d.put(bush(p, s), x, y, 0);
d.put(bench(p), 14, -16, 0).put(lampPost(p), W + 6, 6, 0).put(lampPost(p), W / 2 - 14, -26, 0);
for (let i = 0; i < 26; i++) { const x = -36 + Math.floor(hash(i, 1, 7) * (W + 66)), y = -30 + Math.floor(hash(i, 2, 7) * (D + 54)); if (x > -4 && x < W + 4 && y > -4 && y < D + 4) continue; d.box(x, y, 0, x + 2, y + 2, 2, p.m(['flowerP', 'flowerY'][i % 2], 2)); }
writeFileSync(new URL('./models/diorama.json', import.meta.url), JSON.stringify(d.json()));
console.log('voxels', d.v.size);
