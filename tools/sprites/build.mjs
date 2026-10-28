import { writeFileSync } from 'node:fs';
import { makePalette, desk, chair, worker, plant, tree, shelf } from './models.mjs';
const p = makePalette();
const out = (v) => writeFileSync(new URL('./models/' + v.name + '.json', import.meta.url), JSON.stringify(v.json()));
const seated = new (await import('./lib.mjs')).Vox(p, 'seat1');
// a chair with a worker on it, in front of a desk (desk's front edge at y=0; chair behind it at y=-14)
seated.put(chair(p), 9, -14, 0).put(worker(p, { shirt: 'shirtB', hair: 'hairBlond', skin: 'skin1', hairStyle: 'long' }), 9, -14, 0).put(desk(p), 0, 0, 0);
for (const v of [desk(p), chair(p), worker(p), plant(p, 'bushy'), plant(p, 'tall'), plant(p, 'flower'), tree(p), shelf(p), seated]) out(v);
console.log('models written');
