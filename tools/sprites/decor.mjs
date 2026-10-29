// Goal 2 models: more furniture, desk props, plants, trees, bushes, hedges, flower beds, rocks and outdoor pieces.
// Same frame as the other model files: x east, y north, z up, front faces -y. Footprints and heights are declared in catalog.mjs.
import { Vox, hash } from './lib.mjs';

// ---------------------------------------------------------------------------------------------------------------- furniture
export function loveseat(p, color = 'shirtB') {
  const v = new Vox(p, 'sofa_b'), c = n => p.m(color, n);
  v.box(0, 0, 3, 24, 11, 8, (x, y, z) => c(z === 7 ? 3 : 2));
  v.box(0, 7, 8, 24, 11, 17, (x, y, z) => c(z >= 16 ? 3 : 2));
  v.box(0, 0, 3, 3, 11, 13, c(1)).box(21, 0, 3, 24, 11, 13, c(1));
  for (const x of [1, 21]) v.box(x, 1, 0, x + 2, 3, 3, p.m('woodDark', 1)).box(x, 8, 0, x + 2, 10, 3, p.m('woodDark', 1));
  v.box(4, 0, 7, 12, 6, 9, c(3)).box(12, 0, 7, 20, 6, 9, c(3));
  v.box(17, 4, 9, 21, 7, 14, p.m('flowerY', 2)).box(17, 4, 13, 21, 7, 14, p.m('flowerY', 3));
  return v;
}
export function armchair(p, color = 'shirtC') {
  const v = new Vox(p, 'armchair'), c = n => p.m(color, n);
  v.box(0, 0, 3, 14, 13, 8, (x, y, z) => c(z === 7 ? 3 : 2));
  v.box(0, 9, 8, 14, 13, 19, (x, y, z) => c(z >= 18 ? 3 : 2));
  v.box(0, 0, 3, 3, 13, 12, c(1)).box(11, 0, 3, 14, 13, 12, c(1));
  for (const [x, y] of [[1, 1], [11, 1], [1, 10], [11, 10]]) v.box(x, y, 0, x + 2, y + 2, 3, p.m('woodDark', 1));
  v.box(3, 0, 7, 11, 8, 9, c(3));
  return v;
}
export function rugRound(p, r = 12) {
  const v = new Vox(p, 'rug_round');
  for (let x = 0; x < 2 * r; x++) for (let y = 0; y < 2 * r; y++) {
    const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
    if (d > r) continue;
    const ring = d > r - 2 ? 'carpetTeal' : d > r - 5 ? 'carpetGold' : d > r - 7 ? 'carpetTeal' : 'carpetGold';
    v.set(x, y, 0, p.m(ring, d > r - 2 ? 1 : 2));
  }
  return v;
}
export function lowBookcase(p) {
  const v = new Vox(p, 'shelf_b'), w = n => p.m('woodDark', n);
  v.box(0, 0, 0, 18, 6, 22, w(2));
  const books = ['bkR', 'bkB', 'bkG', 'bkY', 'bkP', 'bkO'];
  for (const z of [1, 8, 15]) {
    v.box(1, 0, z, 17, 5, z + 6, w(0));
    let x = 2;
    while (x < 15) { const bw = 1 + Math.floor(hash(x, z, 13) * 2.5), h = 4 + Math.floor(hash(x, z, 14) * 2), bk = books[Math.floor(hash(x, z, 15) * 6)]; if (hash(x, z, 16) > 0.15) v.box(x, 0, z, x + bw, 4, z + h, (X, Y, Z) => p.m(bk, Z === z + h - 1 ? 2 : 1)); x += bw; }
  }
  v.box(0, 0, 21, 18, 6, 22, w(3));
  v.cyl(13, 3, 22, 24, 2, p.m('pot', 2)).ellipsoid(13, 3, 27, 3.2, 3.2, 3.2, (x, y, z) => p.m(hash(x, y, z, 4) > 0.8 ? 'leafLight' : z > 27 ? 'leaf' : 'leaf2', z > 27 ? 3 : 2));
  return v;
}
export function cabinet(p) {
  const v = new Vox(p, 'cabinet');
  v.box(0, 0, 0, 10, 8, 22, (x, y, z) => p.m('steel', z === 21 ? 3 : x === 0 ? 1 : 2));
  for (const z of [7, 14]) v.box(0, 0, z, 10, 1, z + 1, p.m('steel', 0));
  for (const z of [3, 10, 17]) { v.box(3, -1, z, 7, 0, z + 2, p.m('steel', 3)); v.box(2, 0, z - 1, 8, 1, z, p.m('steel', 1)); }
  return v;
}
export function printer(p) {
  const v = new Vox(p, 'printer');
  v.box(1, 1, 0, 3, 9, 5, p.m('woodDark', 2)).box(11, 1, 0, 13, 9, 5, p.m('woodDark', 2));
  v.box(0, 0, 5, 14, 10, 10, (x, y, z) => p.m('kb', z === 9 ? 3 : y === 0 ? 2 : 1));
  v.box(2, 0, 7, 12, 1, 8, p.m('plastic', 1));                               // paper slot
  v.box(8, -1, 8, 12, 0, 10, p.m('screen', 1));                              // little display
  v.box(2, 1, 10, 12, 8, 11, p.m('paper', 3));                               // paper on top
  v.set(4, -1, 8, p.m('ledG', 1));
  return v;
}
export function coffeeMachine(p) {
  const v = new Vox(p, 'coffeemachine');
  v.box(0, 0, 0, 12, 8, 9, (x, y, z) => p.m('woodDark', z === 8 ? 3 : y === 0 ? 2 : 1));
  v.box(2, 1, 9, 9, 7, 19, (x, y, z) => p.m('plastic', z > 17 ? 3 : y === 1 ? 2 : 1));
  v.box(3, 0, 12, 8, 1, 17, p.m('steel', 2)).box(4, -1, 10, 7, 0, 12, p.m('steel', 3));
  v.cyl(5, 2, 9, 12, 1.6, p.m('coffee', 1)).box(3, -1, 12, 4, 0, 13, p.m('ledR', 1)).box(7, -1, 12, 8, 0, 13, p.m('ledG', 1));
  v.cyl(10, 4, 9, 12, 1.4, p.m('mug', 2));
  return v;
}
export function serverRack(p) {
  const v = new Vox(p, 'serverrack');
  v.box(0, 0, 0, 12, 10, 40, (x, y, z) => p.m('rubber', z === 39 || z === 0 ? 2 : x === 0 ? 1 : 1));
  for (let z = 3; z < 37; z += 4) {
    v.box(1, -1, z, 11, 0, z + 3, p.m('metalDark', z % 8 === 3 ? 2 : 1));
    for (let x = 2; x < 10; x += 2) if (hash(x, z, 21) > 0.35) v.set(x, -1, z + 1, p.m(hash(x, z, 22) > 0.85 ? 'ledR' : 'ledG', 1));
    v.box(7, -1, z + 2, 10, 0, z + 3, p.m('plastic', 1));
  }
  return v;
}
export function whiteboardStand(p) {
  const v = new Vox(p, 'whiteboardstand');
  v.box(0, 0, 14, 22, 2, 36, p.m('steel', 2));
  v.box(1, -1, 15, 21, 0, 35, (x, y, z) => { const line = z % 4 === 0 && hash(Math.floor(x / 3), z, 31) > 0.3 && x < 17 - (z % 8); return line ? p.m(['bkB', 'bkR', 'bkG'][Math.floor(z / 4) % 3], 2) : p.m('boardWhite', 2); });
  for (const x of [2, 18]) { v.box(x, 0, 0, x + 2, 2, 14, p.m('steel', 1)); v.box(x - 1, -2, 0, x + 3, 5, 1, p.m('steel', 1)); }
  v.box(4, -2, 14, 18, 0, 15, p.m('steel', 3));
  return v;
}
export function lockers(p) {
  const v = new Vox(p, 'lockers');
  const cols = ['chairBlue', 'shirtB', 'chairBlue', 'shirtB'];
  cols.forEach((c, i) => {
    v.box(i * 6, 0, 0, i * 6 + 6, 8, 34, (x, y, z) => p.m(c, x % 6 === 0 ? 1 : z > 32 ? 3 : 2));
    v.box(i * 6 + 1, -1, 22, i * 6 + 5, 0, 25, p.m(c, 1));                       // vents
    for (let z = 23; z < 25; z++) v.box(i * 6 + 2, -1, z, i * 6 + 4, 0, z + 1, p.m(c, 0));
    v.box(i * 6 + 4, -1, 14, i * 6 + 5, 0, 17, p.m('steel', 3));
  });
  return v;
}
export function trashBin(p) {
  const v = new Vox(p, 'trashbin');
  v.cyl(3, 3, 0, 8, 2.8, (x, y, z) => p.m('metalDark', z > 6 ? 3 : x < 3 ? 1 : 2));
  v.cyl(3, 3, 8, 9, 3.2, p.m('steel', 2));
  return v;
}
export function reception(p) {
  const v = new Vox(p, 'reception');
  v.box(0, 0, 0, 36, 14, 18, (x, y, z) => (y === 0 ? p.m('wood', x % 6 === 0 ? 1 : 2) : p.m('woodDark', 1)));
  v.box(0, 0, 18, 36, 14, 21, (x, y, z) => p.m('deskTop', y === 0 || x === 0 ? 3 : 2));
  v.box(0, 6, 21, 36, 14, 24, p.m('wood', 2));                                  // raised back ledge
  v.cyl(8, 3, 21, 22, 2.4, p.m('steel', 3)).box(7, 2, 22, 9, 4, 23, p.m('mug', 2));    // bell
  v.box(18, 4, 21, 28, 8, 22, p.m('paper', 3));
  v.cyl(31, 9, 24, 26, 2, p.m('pot', 2)).ellipsoid(31, 9, 29, 3, 3, 3.4, (x, y, z) => p.m(hash(x, y, z, 6) > 0.8 ? 'leafLight' : z > 29 ? 'leaf' : 'leaf2', z > 29 ? 3 : 2));
  return v;
}
export function standingDesk(p) {
  const v = new Vox(p, 'desk_standing');
  v.box(0, 0, 24, 24, 12, 26, (x, y, z) => (z === 24 ? p.m('woodDark', 2) : y === 0 || x === 0 ? p.m('deskTop', 3) : p.m('deskTop', 2)));
  for (const x of [2, 20]) { v.box(x, 3, 0, x + 2, 9, 24, p.m('steel', 2)); v.box(x - 1, 1, 0, x + 3, 11, 1, p.m('steel', 1)); }
  v.box(8, 5, 26, 18, 8, 33, p.m('plastic', 2)).box(9, 4, 27, 17, 5, 32, p.m('screen', 1));    // laptop screen facing -y
  v.box(8, 1, 26, 18, 6, 27, p.m('kb', 3));
  v.cyl(3, 9, 26, 29, 1.6, p.m('mug', 2));
  return v;
}
export function lDesk(p) {
  const v = new Vox(p, 'desk_l');
  const top = (x, y, z) => (z === 10 ? p.m('woodDark', 2) : y === 0 || x === 0 ? p.m('deskTop', 3) : p.m('deskTop', 2));
  v.box(0, 0, 10, 36, 12, 12, top).box(0, 12, 10, 14, 26, 12, top);
  for (const [x, y] of [[1, 1], [33, 1], [1, 23], [11, 23], [33, 9], [11, 9]]) v.box(x, y, 0, x + 2, y + 2, 10, p.m('woodDark', 2));
  v.box(14, 12, 3, 33, 13, 10, p.m('woodDark', 1));
  v.box(16, 5, 12, 26, 8, 13, p.m('plastic', 2)).box(19, 6, 13, 23, 7, 18, p.m('plastic', 1)).box(14, 6, 18, 28, 8, 28, p.m('plastic', 2));
  v.box(15, 5, 19, 27, 6, 27, (x, y, z) => p.m('screen', hash(x, z, 41) > 0.7 ? 2 : 1));
  v.box(4, 14, 12, 10, 20, 13, p.m('paper', 2)).cyl(6, 22, 12, 17, 1.8, p.m('pot', 2));
  return v;
}

// ------------------------------------------------------------------------------------------------------------- desk props
// built on the surface (z 0 = the desktop); layout puts them on a desk, a table or a counter
export const propModels = {
  laptop(p) {
    const v = new Vox(p, 'prop_laptop');
    v.box(0, 0, 0, 10, 7, 1, p.m('steel', 2)).box(1, 1, 1, 9, 4, 2, p.m('kb', 3));
    v.box(0, 6, 1, 10, 7, 8, p.m('steel', 1)).box(1, 5, 2, 9, 6, 7, p.m('screen', 1));
    return v;
  },
  mug_a(p) { const v = new Vox(p, 'prop_mug_a'); v.cyl(1, 1, 0, 4, 1.6, p.m('mug', 2)).set(3, 1, 2, p.m('mug', 1)).cyl(1, 1, 3, 4, 1.1, p.m('coffee', 1)); return v; },
  mug_b(p) { const v = new Vox(p, 'prop_mug_b'); v.cyl(1, 1, 0, 4, 1.6, (x, y, z) => p.m(z === 2 ? 'chairBlue' : 'paper', 2)).set(3, 1, 2, p.m('paper', 1)).cyl(1, 1, 3, 4, 1.1, p.m('coffee', 2)); return v; },
  plant(p) {
    const v = new Vox(p, 'prop_plant');
    v.cyl(2, 2, 0, 3, 2, p.m('pot', 2));
    v.ellipsoid(2, 2, 5, 2.8, 2.8, 2.4, (x, y, z) => p.m(hash(x, y, z, 7) > 0.8 ? 'leafLight' : z > 5 ? 'leaf' : 'leaf2', z > 5 ? 3 : 2));
    return v;
  },
  lamp(p) {
    const v = new Vox(p, 'prop_lamp');
    v.cyl(2, 2, 0, 1, 2.2, p.m('steel', 1)).box(2, 2, 1, 3, 3, 9, p.m('steel', 2)).box(0, 1, 9, 4, 4, 11, (x, y, z) => p.m('carpetGold', z > 9 ? 3 : 2));
    v.box(1, 1, 8, 3, 3, 9, p.m('paper', 3));
    return v;
  },
  papers(p) { const v = new Vox(p, 'prop_papers'); v.box(0, 0, 0, 6, 5, 1, p.m('paper', 2)).box(1, 1, 1, 7, 6, 2, p.m('paper', 3)).box(2, 2, 2, 7, 5, 3, p.m('paper', 2)); v.box(3, 3, 3, 5, 4, 4, p.m('bkB', 2)); return v; },
  figurine(p) {
    const v = new Vox(p, 'prop_figurine');
    v.box(0, 0, 0, 3, 3, 1, p.m('steel', 1)).box(0, 0, 1, 3, 3, 4, p.m('flowerB', 2)).ellipsoid(1, 1, 5.4, 1.8, 1.8, 1.6, p.m('shirtC', 3));
    v.set(0, -1, 5, p.m('eye', 0)).set(2, -1, 5, p.m('eye', 0));
    return v;
  },
  headphones(p) {
    const v = new Vox(p, 'prop_headphones');
    v.box(0, 0, 0, 2, 4, 3, p.m('plastic', 1)).box(5, 0, 0, 7, 4, 3, p.m('plastic', 1));
    v.box(0, 1, 3, 7, 3, 5, p.m('plastic', 2)).box(1, 1, 5, 6, 3, 6, p.m('plastic', 3));
    v.box(0, -1, 1, 2, 0, 2, p.m('mug', 2)).box(5, -1, 1, 7, 0, 2, p.m('mug', 2));
    return v;
  },
  stickies(p) {
    const v = new Vox(p, 'prop_stickies');
    v.box(0, 0, 0, 3, 3, 1, p.m('flowerY', 2)).box(2, 1, 1, 5, 4, 2, p.m('flowerP', 2)).box(1, 2, 2, 4, 5, 3, p.m('flowerB', 2));
    return v;
  },
  books(p) {
    const v = new Vox(p, 'prop_books');
    v.box(0, 0, 0, 6, 4, 2, p.m('bkR', 2)).box(0, 0, 2, 6, 4, 4, p.m('bkB', 2)).box(1, 0, 4, 6, 3, 5, p.m('bkG', 2));
    v.box(0, -1, 0, 6, 0, 2, p.m('paper', 2)).box(0, -1, 2, 6, 0, 4, p.m('paper', 3));
    return v;
  },
  snack(p) {
    const v = new Vox(p, 'prop_snack');
    v.cyl(2, 2, 0, 1, 2.6, p.m('paper', 3)); v.ellipsoid(2, 2, 1.6, 1.6, 1.6, 1, p.m('coffee', 2)); v.set(2, 2, 2, p.m('paper', 3));
    return v;
  },
  tablet(p) { const v = new Vox(p, 'prop_tablet'); v.box(0, 0, 0, 6, 4, 1, p.m('plastic', 2)).box(1, 0, 1, 5, 3, 2, p.m('screen', 1)); return v; },
  frame(p) {
    const v = new Vox(p, 'prop_frame');
    v.box(0, 0, 0, 4, 1, 6, p.m('woodDark', 2)).box(1, -1, 1, 3, 0, 5, (x, y, z) => p.m(z > 3 ? 'screen' : 'leaf', z > 3 ? 2 : 2));
    v.box(0, 1, 0, 4, 2, 1, p.m('woodDark', 1));
    return v;
  },
  pens(p) {
    const v = new Vox(p, 'prop_pens');
    v.cyl(1, 1, 0, 4, 1.7, p.m('metalDark', 2));
    v.set(0, 1, 5, p.m('mug', 2)).set(1, 0, 6, p.m('chairBlue', 2)).set(2, 1, 5, p.m('flowerY', 2)).set(1, 1, 4, p.m('shirtB', 2));
    return v;
  },
  cactus(p) {
    const v = new Vox(p, 'prop_cactus');
    v.cyl(2, 2, 0, 2, 1.8, p.m('pot', 2));
    v.cyl(2, 2, 2, 6, 1.1, p.m('cactusG', 2)).box(0, 2, 3, 1, 3, 5, p.m('cactusG', 3)).box(3, 2, 4, 4, 3, 6, p.m('cactusG', 1)).set(2, 2, 6, p.m('flowerP', 3));
    return v;
  },
};

// ---------------------------------------------------------------------------------------------------------------- plants
// potted plants share a pot at the origin, like models.plant
function pot(v, p, r = 3.6, h = 5) {
  v.cyl(0, 0, 0, 3, r, p.m('pot', 2)).cyl(0, 0, 3, h, r + 0.6, (x, y, z) => p.m('pot', z === h - 1 ? 3 : 2));
  v.cyl(0, 0, h, h + 1, r - 0.2, p.m('soil', 1));
}
const leafMat = (p, cz, rz, seed) => (x, y, z) => {
  const n = hash(x, y, z, seed), t = (z - cz) / rz + (n - 0.5) * 0.9;
  return p.m(n > 0.9 ? 'leafLight' : t > 0.3 ? 'leaf' : 'leaf2', t > 0.3 ? 3 : t > -0.2 ? 2 : 1);
};
export const plantModels = {
  hanging(p) {
    const v = new Vox(p, 'plant_hanging');
    v.cyl(0, 0, 0, 2, 3, p.m('steel', 1)).cyl(0, 0, 2, 27, 0.8, p.m('steel', 2)).box(0, -1, 26, 5, 1, 27, p.m('steel', 2));
    v.cyl(5, 0, 21, 26, 2.8, p.m('pot', 2)).cyl(5, 0, 25, 26, 3.2, p.m('pot', 3));
    v.ellipsoid(5, 0, 27, 4, 3.6, 2.6, leafMat(p, 27, 2.6, 3));
    for (const [x, y, len] of [[2, -1, 9], [7, 1, 12], [5, -2, 6], [3, 1, 7]]) for (let z = 0; z < len; z++) v.set(x + (z % 3 === 0 ? 1 : 0), y, 21 - z, p.m(z % 4 === 3 ? 'leafLight' : 'leaf2', z % 2 ? 2 : 3));
    return v;
  },
  cactus(p) {
    const v = new Vox(p, 'plant_cactus'); pot(v, p, 3.2, 4);
    v.cyl(0, 0, 5, 20, 2.2, (x, y, z) => p.m('cactusG', x < 0 ? 3 : z > 18 ? 3 : x > 1 ? 1 : 2));
    v.box(-5, -1, 11, -2, 1, 13, p.m('cactusG', 2)).box(-5, -1, 13, -3, 1, 18, p.m('cactusG', 3));
    v.box(2, -1, 9, 5, 1, 11, p.m('cactusG', 2)).box(4, -1, 11, 6, 1, 16, p.m('cactusG', 2));
    v.box(-1, -1, 20, 1, 1, 22, p.m('flowerP', 3));
    for (let z = 7; z < 19; z += 3) v.set(-2, -2, z, p.m('paper', 3)).set(2, -2, z + 1, p.m('paper', 3));
    return v;
  },
  bonsai(p) {
    const v = new Vox(p, 'plant_bonsai');
    v.box(-6, -3, 0, 7, 4, 2, p.m('woodDark', 2)).box(-5, -2, 2, 6, 3, 5, p.m('stone', 2)).box(-4, -2, 5, 5, 3, 6, p.m('soil', 1));
    v.cyl(0, 0, 5, 12, 1.3, p.m('trunk', 2)).box(-3, 0, 10, 0, 1, 12, p.m('trunk', 2)).box(1, 0, 8, 4, 1, 10, p.m('trunk', 2));
    for (const [x, z, r, s] of [[-4, 14, 4.6, 1], [4, 12, 3.8, 2], [0, 17, 4.2, 3]]) v.ellipsoid(x, 0, z, r, r * 0.9, r * 0.7, leafMat(p, z, r * 0.7, s));
    return v;
  },
  fern(p) {
    const v = new Vox(p, 'plant_fern'); pot(v, p);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      for (let t = 1; t <= 9; t++) { const x = Math.cos(a) * t * 0.9, y = Math.sin(a) * t * 0.9, z = 6 + t * 1.3 - t * t * 0.07; v.box(x - 0.5, y - 0.5, z, x + 1, y + 1, z + 1, p.m(t > 6 ? 'leafLight' : t % 2 ? 'leaf' : 'leaf2', t > 6 ? 3 : 2)); }
    }
    return v;
  },
  palm(p) {
    const v = new Vox(p, 'plant_palm'); pot(v, p);
    v.cyl(0, 0, 5, 27, 1.2, (x, y, z) => p.m('trunk', (z % 4 === 0 ? 1 : x < 0 ? 3 : 2)));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      for (let t = 1; t <= 8; t++) { const x = Math.cos(a) * t * 0.95, y = Math.sin(a) * t * 0.95, z = 28 + Math.round(2 - t * t * 0.06); v.box(x - 0.5, y - 0.5, z, x + 1.5, y + 1.5, z + 1, p.m(t > 5 ? 'leaf' : 'leaf2', t > 5 ? 3 : 2)); }
    }
    v.set(0, 0, 29, p.m('leafLight', 3));
    return v;
  },
  succulent(p) {
    const v = new Vox(p, 'plant_succulent'); pot(v, p, 3, 4);
    for (let k = 0; k < 3; k++) {
      const r = 3.6 - k * 1.1;
      v.ellipsoid(0, 0, 6 + k * 1.6, r, r, 1.4, (x, y, z) => p.m(k === 2 ? 'leafLight' : k === 1 ? 'leaf' : 'leaf2', (x + y + z) % 3 ? 3 : 2));
    }
    v.box(-1, -1, 9, 1, 1, 10, p.m('flowerP', 3));
    return v;
  },
  snake(p) {
    const v = new Vox(p, 'plant_snake'); pot(v, p, 3.4, 5);
    for (const [x, y, h] of [[0, 0, 22], [-2, 1, 18], [2, 0, 20], [1, -2, 15], [-1, -2, 13], [-3, -1, 11]]) {
      for (let z = 5; z < h; z++) v.box(x, y, z, x + 2, y + 1, z + 1, p.m(z > h - 4 ? 'leafLight' : x < 0 ? 'leaf' : 'leaf2', z % 5 === 0 ? 1 : 3 - (z > h - 4 ? 0 : 1)));
    }
    return v;
  },
  monstera(p) {
    const v = new Vox(p, 'plant_monstera'); pot(v, p, 4, 5);
    v.cyl(0, 0, 5, 14, 0.8, p.m('leaf2', 1));
    for (const [x, z, rx, rz, s] of [[-5, 14, 5, 3.4, 1], [5, 17, 5.4, 3.6, 2], [0, 22, 5, 3.6, 3], [-3, 9, 4, 2.8, 4], [4, 10, 4.2, 2.8, 5]]) {
      v.ellipsoid(x, 0, z, rx, 1.8, rz, (X, Y, Z, d) => (hash(X, Z, s) > 0.9 && d > 0.3 ? 0 : p.m(Z > z ? 'leafLight' : X < x ? 'leaf' : 'leaf2', Z > z ? 3 : 2)));
    }
    return v;
  },
  orchid(p) {
    const v = new Vox(p, 'plant_orchid'); pot(v, p, 3, 4);
    v.box(0, 0, 4, 1, 1, 12, p.m('leaf2', 2)).box(1, 0, 12, 4, 1, 15, p.m('leaf2', 2)).box(3, 0, 15, 5, 1, 17, p.m('leaf2', 2));
    v.ellipsoid(0, 0, 6, 4.4, 1.6, 1.6, p.m('leaf', 2));
    for (const [x, z] of [[-1, 12], [2, 15], [4, 17], [5, 15], [3, 12]]) { v.box(x, -1, z, x + 3, 1, z + 2, p.m('flowerW', 3)); v.set(x + 1, -1, z, p.m('flowerP', 2)); }
    return v;
  },
};

// ----------------------------------------------------------------------------------------------------------------- trees
function blobTree(p, o) {
  const { name, seed, trunk = 'trunk', h = 14, blobs, leafMain = 'leaf', leafDark = 'leaf2', bark } = o;
  const v = new Vox(p, name);
  v.cyl(0, 0, 0, h, 2.2, (x, y, z) => p.m(trunk, bark ? (hash(x, y, z, 9) > 0.78 ? 0 : x < 0 ? 3 : 2) : x < 0 ? 3 : x > 0 ? 1 : 2));
  v.cyl(0, 0, 0, 2, 3.2, p.m(trunk, 1));
  for (const [i, [cx, cy, cz, r]] of blobs.entries()) {
    v.ellipsoid(cx, cy, cz, r, r, r * 0.92, (x, y, z) => {
      const n = hash(x, y, z, seed + i), t = (z - cz) / r + (x < cx ? 0.15 : -0.05) + (n - 0.5) * 0.8;
      return p.m(n > 0.93 ? 'leafLight' : t > 0.3 ? leafMain : leafDark, t > 0.3 ? 3 : t > -0.25 ? 2 : 1);
    });
  }
  return v;
}
export const treeModels = {
  oak: p => blobTree(p, { name: 'tree_oak', seed: 20, h: 13, blobs: [[0, 0, 22, 10], [-8, 2, 18, 7], [8, -1, 19, 7], [1, 7, 18, 6.5], [-1, -7, 19, 6.5], [0, 0, 30, 6.5], [-6, -5, 25, 5], [6, 5, 26, 5]] }),
  birch: p => blobTree(p, { name: 'tree_birch', seed: 30, trunk: 'paper', bark: true, h: 20, leafMain: 'leafLight', blobs: [[0, 0, 27, 7], [-5, 2, 23, 5.5], [5, -1, 24, 5.5], [0, 4, 31, 4.6], [-1, -4, 22, 4.6]] }),
  cypress(p) {
    const v = new Vox(p, 'tree_cypress');
    v.cyl(0, 0, 0, 5, 1.6, p.m('bark', 2));
    for (let z = 4; z < 40; z++) { const r = Math.max(1, 4.6 * Math.sin(((z - 3) / 38) * Math.PI) ** 0.7 + 0.8); v.cyl(0, 0, z, z + 1, r, (x, y, zz) => { const n = hash(x, y, zz, 41); return p.m('leafPine', x < 0 && n > 0.4 ? 3 : n > 0.82 ? 3 : n > 0.3 ? 2 : 1); }); }
    return v;
  },
};

// -------------------------------------------------------------------------------------------- bushes, hedges, beds, rocks
export function roundBush(p, seed = 3) {
  const v = new Vox(p, 'bush_c');
  v.ellipsoid(0, 0, 6, 7, 6, 6, (x, y, z) => { const n = hash(x, y, z, seed), t = (z - 6) / 6 + (x < 0 ? 0.12 : 0) + (n - 0.5) * 0.7; return p.m(n > 0.94 ? 'leafLight' : t > 0.25 ? 'leaf' : 'leaf2', t > 0.25 ? 3 : t > -0.2 ? 2 : 1); });
  return v;
}
export function floweringBush(p, seed = 4) {
  const v = roundBush(p, seed);
  v.name = 'bush_d';
  for (let k = 0; k < 16; k++) {
    const a = hash(k, 1, seed) * Math.PI * 2, b = hash(k, 2, seed) * 1.2 + 0.1, x = Math.round(Math.cos(a) * 6 * Math.cos(b)), y = Math.round(Math.sin(a) * 5 * Math.cos(b)), z = Math.round(6 + 5.5 * Math.sin(b));
    v.box(x, y, z, x + 2, y + 2, z + 2, p.m(['flowerP', 'flowerY', 'flowerR', 'flowerW'][k % 4], 3));
  }
  return v;
}
export function hedge(p, len = 32, name = 'hedge_a') {
  const v = new Vox(p, name);
  v.box(0, 0, 0, len, 6, 12, (x, y, z) => {
    const n = hash(x, y, z, 51), top = z > 9 ? 0.3 : 0, edge = x === 0 || x === len - 1 || y === 0 ? -0.15 : 0;
    return p.m(n > 0.92 ? 'leafLight' : 'hedgeG', n + top + edge > 0.7 ? 3 : n + edge > 0.25 ? 2 : 1);
  });
  v.box(0, 0, 11, len, 6, 12, (x, y, z) => (hash(x, y, z, 52) > 0.35 ? p.m('hedgeG', 3) : 0));
  return v;
}
export function flowerbedModel(p, kind) {
  const v = new Vox(p, 'flowerbed_' + kind);
  const cols = { b: ['flowerR', 'flowerO', 'flowerY'], c: ['flowerR', 'flowerW', 'flowerR', 'flowerY'], d: ['flowerB', 'flowerP', 'flowerW'] }[kind];
  if (kind === 'b') {                                                         // round bed
    const R = 8;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
      const d = Math.hypot(x + 0.5 - R, y + 0.5 - R);
      if (d > R) continue;
      if (d > R - 1.6) { v.box(x, y, 0, x + 1, y + 1, 3, p.m('stone', hash(x, y, 61) > 0.5 ? 3 : 2)); continue; }
      v.box(x, y, 0, x + 1, y + 1, 2, p.m('soil', 1));
      if ((x + y) % 2 === 0) { const n = hash(x, y, 62); v.box(x, y, 2, x + 1, y + 1, 3 + Math.floor(n * 2), p.m('leaf', 2)); v.set(x, y, 4 + Math.floor(n * 2), p.m(cols[Math.floor(hash(y, x, 63) * cols.length)], 3)); }
    }
    return v;
  }
  const L = kind === 'c' ? 32 : 24;
  v.box(0, 0, 0, L, 8, kind === 'd' ? 6 : 3, (x, y, z) => (x < 1 || x > L - 2 || y < 1 || y > 6 ? (kind === 'd' ? p.m('wood', z % 3 === 2 ? 1 : 2) : p.m('stone', z > 1 ? 3 : 2)) : p.m('soil', 1)));
  const z0 = kind === 'd' ? 6 : 3;
  for (let x = 2; x < L - 2; x += 2) for (let y = 2; y < 7; y += 2) {
    const n = hash(x, y, 64);
    v.box(x, y, z0, x + 1, y + 1, z0 + 1 + Math.floor(n * 2), p.m('leaf', 2));
    v.set(x, y, z0 + 2 + Math.floor(n * 2), p.m(cols[Math.floor(hash(y, x, 65) * cols.length)], 3));
  }
  return v;
}
export function tuft(p, seed = 1) {
  const v = new Vox(p, 'tuft_' + seed);
  for (let k = 0; k < 9; k++) {
    const x = Math.round(hash(k, 1, seed) * 4 - 2), y = Math.round(hash(k, 2, seed) * 4 - 2), h = 3 + Math.floor(hash(k, 3, seed) * 3);
    for (let z = 0; z < h; z++) v.set(x, y, z, p.m(z === h - 1 ? 'leafLight' : 'leaf', z === h - 1 ? 3 : 2));
  }
  if (seed === 2) for (const [x, y, c] of [[-2, 1, 'flowerY'], [2, -1, 'flowerW']]) v.set(x, y, 5, p.m(c, 3));
  return v;
}
export function rockModel(p, kind) {
  const v = new Vox(p, 'rock_' + kind);
  const mat = (cz, r, s) => (x, y, z) => p.m('rock', z > cz + r * 0.35 ? 3 : hash(x, y, z, s) > 0.72 ? 1 : 2);
  if (kind === 'b') { v.ellipsoid(0, 0, 2, 8, 5, 2.6, mat(2, 2.6, 71)); v.ellipsoid(-6, 2, 1.4, 3, 2.4, 1.6, mat(1, 1.6, 72)); }
  else if (kind === 'c') { v.ellipsoid(0, 0, 6, 4, 3.6, 6, mat(6, 6, 73)); v.ellipsoid(5, 1, 2.4, 3, 2.8, 2.4, mat(2, 2.4, 74)); }
  else { for (const [x, y, z, r, s] of [[0, 0, 2.6, 3.4, 75], [-5, 2, 2, 2.6, 76], [4, 3, 1.8, 2.4, 77], [1, -4, 1.6, 2.2, 78], [-2, -3, 1.4, 1.8, 79]]) v.ellipsoid(x, y, z, r, r * 0.85, r * 0.8, mat(z, r, s)); }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------- outdoor
export function picnicTable(p) {
  const v = new Vox(p, 'picnictable');
  v.box(0, 5, 10, 28, 13, 12, (x, y, z) => p.m('wood', z === 11 ? 3 : y % 4 === 0 ? 1 : 2));
  for (const y of [0, 14]) v.box(0, y, 5, 28, y + 4, 7, p.m('wood', y ? 1 : 3));
  for (const x of [3, 23]) { v.box(x, 5, 0, x + 2, 13, 10, p.m('woodDark', 2)); v.box(x, 1, 0, x + 2, 3, 6, p.m('woodDark', 1)); v.box(x, 15, 0, x + 2, 17, 6, p.m('woodDark', 1)); }
  return v;
}
export function fence(p, kind = 'a') {
  const v = new Vox(p, 'fence_' + kind);
  if (kind === 'a') {
    v.box(0, 0, 3, 32, 1, 5, p.m('trim', 2)).box(0, 0, 8, 32, 1, 10, p.m('trim', 2));
    for (let x = 1; x < 32; x += 4) v.box(x, 0, 0, x + 2, 1, 12, (X, Y, Z) => p.m('trim', Z > 10 ? 3 : X === x ? 3 : 2)).set(x, 0, 12, p.m('trim', 3)).set(x + 1, 0, 12, p.m('trim', 3));
  } else {
    for (const x of [0, 15, 30]) v.box(x, 0, 0, x + 2, 2, 14, (X, Y, Z) => p.m('wood', Z > 12 ? 3 : 2));
    for (const z of [4, 9]) v.box(0, 0, z, 32, 1, z + 2, p.m('wood', 2)).box(0, 1, z, 32, 2, z + 1, p.m('woodDark', 1));
  }
  return v;
}
export function signpost(p) {
  const v = new Vox(p, 'signpost');
  v.cyl(0, 0, 0, 24, 1.1, p.m('woodDark', 2));
  v.box(-8, -1, 17, 7, 1, 22, (x, y, z) => p.m('wood', z === 21 || x > 5 ? 3 : 2)).box(5, -1, 17, 9, 1, 22, p.m('wood', 3));
  v.box(-6, -2, 18, 3, -1, 20, p.m('paper', 3));
  v.box(-7, -1, 11, 6, 1, 15, p.m('wood', 2)).box(-8, -1, 11, -6, 1, 15, p.m('wood', 3));
  return v;
}
export function bikeRack(p) {
  const v = new Vox(p, 'bikerack');
  for (const x of [1, 6, 11, 16]) { v.box(x, 0, 0, x + 1, 1, 2, p.m('metalDark', 2)); for (let z = 2; z < 9; z++) v.set(x, 0, z, p.m('metalDark', 2)); v.box(x, 0, 8, x + 1, 5, 9, p.m('metalDark', 3)); v.box(x, 5, 2, x + 1, 6, 9, p.m('metalDark', 2)); }
  // one bike, wheels in the x-z plane
  for (const cx of [4, 14]) for (let x = cx - 4; x <= cx + 4; x++) for (let z = 0; z <= 8; z++) { const d = Math.hypot(x - cx, z - 4); if (d <= 4.2 && d > 3.1) v.set(x, 2, z, p.m('rubber', 1)); }
  v.box(4, 2, 4, 14, 3, 5, p.m('chairBlue', 2)).box(8, 2, 4, 9, 3, 9, p.m('chairBlue', 2)).box(7, 2, 9, 11, 3, 10, p.m('rubber', 2)).box(13, 2, 5, 14, 3, 10, p.m('steel', 2));
  return v;
}
export function fountain(p) {
  const v = new Vox(p, 'fountain');
  v.cyl(0, 0, 0, 5, 12, (x, y, z) => p.m('stone', z === 4 ? 3 : Math.hypot(x, y) > 10.5 ? 1 : 2));
  v.cyl(0, 0, 3, 5, 10.4, p.m('water', 1));
  v.cyl(0, 0, 5, 6, 10, (x, y, z) => p.m('water', hash(x, y, 81) > 0.85 ? 3 : 2));
  v.cyl(0, 0, 5, 13, 2, p.m('stone', 2)).cyl(0, 0, 11, 14, 6, p.m('stone', 3)).cyl(0, 0, 13, 15, 5, p.m('water', 2));
  v.cyl(0, 0, 14, 22, 0.8, p.m('water', 3));
  for (const [x, y] of [[0, 3], [3, 0], [0, -3], [-3, 0]]) for (let z = 15; z > 10; z--) v.set(x * (1 + (15 - z) * 0.3), y * (1 + (15 - z) * 0.3), z, p.m('water', 3));
  return v;
}
export function pond(p) {
  const v = new Vox(p, 'pond');
  for (let x = 0; x < 48; x++) for (let y = 0; y < 40; y++) {
    const d = Math.hypot((x + 0.5 - 24) / 23, (y + 0.5 - 20) / 19);
    if (d > 1) continue;
    if (d > 0.9) { v.set(x, y, 0, p.m('stone', hash(x, y, 91) > 0.5 ? 3 : 2)); continue; }
    v.set(x, y, 0, p.m('water', hash(x, y, 92) > 0.93 ? 3 : d > 0.72 ? 1 : (x + y) % 6 === 0 ? 2 : 1));
  }
  for (const [x, y] of [[12, 26], [30, 14], [20, 20], [34, 26], [16, 12]]) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a * a + b * b <= 1) v.set(x + a, y + b, 1, p.m('leaf', 3));
  v.set(30, 15, 2, p.m('flowerP', 3)).set(20, 20, 2, p.m('flowerW', 3)).set(34, 26, 2, p.m('flowerP', 3));
  return v;
}
export function steppingStones(p) {
  const v = new Vox(p, 'stones');
  for (const [cx, cy, r, s] of [[3, 3, 3, 1], [9, 7, 3.2, 2], [4, 12, 2.8, 3], [13, 13, 2.4, 4]]) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) if (Math.hypot(x - cx, y - cy) <= r) v.set(x, y, 0, p.m('stone', hash(x, y, s) > 0.7 ? 3 : 2));
  }
  return v;
}
export function planter(p) {
  const v = new Vox(p, 'planter');
  v.box(0, 0, 0, 14, 8, 8, (x, y, z) => p.m('woodDark', z === 7 ? 3 : x % 5 === 0 ? 1 : 2));
  v.box(1, 1, 8, 13, 7, 9, p.m('soil', 1));
  v.ellipsoid(7, 4, 12, 6, 3.4, 3.6, (x, y, z) => p.m(hash(x, y, z, 95) > 0.8 ? 'leafLight' : z > 12 ? 'leaf' : 'leaf2', z > 12 ? 3 : 2));
  for (const [x, z, c] of [[3, 13, 'flowerR'], [7, 15, 'flowerY'], [11, 13, 'flowerP'], [5, 11, 'flowerW']]) v.box(x, 2, z, x + 2, 4, z + 2, p.m(c, 3));
  return v;
}
export function well(p) {
  const v = new Vox(p, 'well');
  v.cyl(0, 0, 0, 9, 6.5, (x, y, z) => p.m('stone', z === 8 ? 3 : Math.hypot(x, y) > 5.2 ? 1 : 2));
  v.cyl(0, 0, 7, 9, 4.6, p.m('water', 1)).cyl(0, 0, 8, 9, 3.8, p.m('rubber', 0));
  for (const x of [-6, 5]) v.box(x, -1, 9, x + 2, 1, 24, p.m('woodDark', 2));
  v.box(-6, -1, 22, 7, 1, 24, p.m('woodDark', 3));
  for (let k = 0; k < 6; k++) v.box(-8 + k, -3, 24 + k, 9 - k, 3, 25 + k, (x, y, z) => p.m('roof', (x + z) % 4 === 0 ? 1 : 2));
  v.cyl(0, 0, 17, 22, 0.6, p.m('rubber', 2)).box(-1, -1, 15, 2, 2, 17, p.m('woodDark', 1));
  return v;
}
export function shed(p) {
  const v = new Vox(p, 'shed');
  v.box(0, 0, 0, 28, 24, 20, (x, y, z) => p.m('wood', (x % 4 === 0 || x === 27) ? 1 : z < 2 ? 1 : 2));
  for (let k = 0; k < 10; k++) { const y0 = Math.round(-3 + k * 1.5), y1 = Math.round(27 - k * 1.5); v.box(-2, y0, 20 + k, 30, y1, 21 + k, (x, y, z) => p.m('roof', (x + k) % 5 === 0 ? 1 : 2)); }
  v.box(4, -1, 0, 14, 0, 16, p.m('woodDark', 2)).box(5, -2, 1, 13, -1, 15, (x, y, z) => p.m('wood', (z === 8 || x === 9) ? 1 : 2));
  v.box(11, -3, 7, 12, -2, 9, p.m('steel', 3));
  v.box(18, -1, 7, 26, 0, 16, p.m('trim', 3)).box(19, -2, 8, 25, -1, 15, (x, y, z) => p.m('screen', z > 12 ? 3 : 2)).box(21, -2, 8, 23, -1, 15, p.m('trim', 3));
  return v;
}
export function mailbox(p) {
  const v = new Vox(p, 'mailbox');
  v.cyl(0, 0, 0, 12, 1, p.m('woodDark', 2));
  v.box(-3, -2, 12, 4, 3, 17, (x, y, z) => p.m('chairBlue', z > 15 ? 3 : x > 2 ? 1 : 2));
  v.box(-3, -3, 12, 4, -2, 15, p.m('chairBlue', 1)).box(3, -1, 16, 4, 0, 20, p.m('mug', 2)).box(3, -1, 19, 6, 0, 20, p.m('mug', 2));
  return v;
}
