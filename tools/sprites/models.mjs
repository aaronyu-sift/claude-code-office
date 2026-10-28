import { Pal, Vox, hash } from './lib.mjs';

export function makePalette() {
  const p = new Pal();
  p.outline = '#2a1f3d';
  // wood and furniture
  p.add('wood', '#e3a45e').add('woodDark', '#a2653a').add('deskTop', '#f2cf93');
  p.add('steel', '#b3bdd0').add('plastic', '#4a5272').add('kb', '#eef2fa');
  p.add('screen', null, { colors: ['#1c6fc0', '#3fb8f5', '#9fe8ff', '#ffffff'], emissive: true, mid: 1 });
  p.add('mug', '#ef5b50').add('coffee', '#6b4128', { n: 3, mid: 1 }).add('paper', '#fdf9ef');
  p.add('chairBlue', '#4f86ee').add('rubber', '#2d3148', { n: 3, mid: 1 });
  // people
  p.add('skin1', '#f7cfaa', { shift: 0.5 }).add('skin2', '#dc9f70', { shift: 0.5 }).add('skin3', '#9a6340', { shift: 0.5 });
  p.add('hairBrown', '#5a3524', { shift: 0.5 }).add('hairBlond', '#f2c75c', { shift: 0.15 }).add('hairBlack', '#2a2a40').add('hairRed', '#cf5a30', { shift: 0.4 });
  p.add('shirtA', '#f2705f').add('shirtB', '#4cc0a8').add('shirtC', '#f5b73c').add('shirtD', '#7a6ee0').add('shirtE', '#e66fb0');
  p.add('pants', '#44507a').add('eye', '#241c34', { n: 2, mid: 0 }).add('blush', '#ff8f8f', { n: 2, mid: 0 });
  // plants and nature
  p.add('leaf', '#5cbc4c', { material: 'follaje' }).add('leaf2', '#38a05a', { material: 'follaje' }).add('leafLight', '#9bdc54', { material: 'follaje' });
  p.add('pot', '#e5764c').add('soil', '#5b3b2a', { n: 3, mid: 1 }).add('trunk', '#a56f40').add('flowerP', '#f27fb4', { material: 'follaje' }).add('flowerY', '#ffd84a', { material: 'follaje' });
  p.add('grass', '#86d35e', { material: 'follaje' });
  // books
  for (const [n, c] of [['bkR', '#e8564d'], ['bkB', '#4a7be0'], ['bkG', '#43b26f'], ['bkY', '#f4c542'], ['bkP', '#9b6ae0'], ['bkO', '#f08a38']]) p.add(n, c, { n: 4, mid: 1 });
  // rooms
  p.add('wallCream', '#f7e6c4').add('trim', '#fff6e2').add('carpetTeal', '#43b8ae').add('carpetGold', '#f4b84c').add('tile', '#e9eef5');
  return p;
}

export function desk(p) {
  const v = new Vox(p, 'desk');
  const top = p.m('deskTop', 2), edge = p.m('deskTop', 3), wood = p.m('wood', 2), dark = p.m('woodDark', 2), darker = p.m('woodDark', 1);
  // top slab with a lighter front edge
  v.box(0, 0, 10, 28, 14, 12, (x, y, z) => (z === 10 ? p.m('woodDark', 2) : y === 0 || x === 0 || x === 27 ? edge : top));
  // drawer unit (left) with two drawers and handles
  v.box(1, 1, 0, 10, 13, 10, wood);
  for (const [z0, z1] of [[1, 5], [6, 9]]) {
    v.box(1, 0, z0, 10, 1, z1, dark);
    v.box(4, -1, (z0 + z1) >> 1, 7, 0, ((z0 + z1) >> 1) + 1, p.m('steel', 3));
  }
  // right legs
  v.box(25, 1, 0, 27, 3, 10, dark).box(25, 11, 0, 27, 13, 10, dark);
  // back panel between the legs
  v.box(10, 12, 3, 25, 13, 10, darker);
  // monitor: base, neck, frame, screen with fake code lines
  v.box(13, 6, 12, 19, 10, 13, p.m('plastic', 2)).box(15, 7, 13, 17, 9, 18, p.m('plastic', 1));
  v.box(8, 7, 17, 24, 9, 31, p.m('plastic', 2));
  for (let x = 9; x < 23; x++) for (let z = 18; z < 30; z++) {
    const line = (z % 3 === 0) && hash(Math.floor(x / 3), z, 1) > 0.28 && x > 9 + (z % 2) * 2 && x < 22 - Math.floor(hash(z, 4) * 7);
    v.set(x, 6, z, p.m('screen', line ? (hash(z, 9) > 0.6 ? 3 : 2) : 1));
  }
  // keyboard, mouse, mug, papers
  v.box(9, 1, 12, 23, 5, 13, (x, y) => p.m('kb', (x + y) % 2 === 0 ? 2 : 3));
  v.box(25, 2, 12, 27, 5, 13, p.m('kb', 1));
  v.cyl(3, 11, 12, 16, 1.7, p.m('mug', 2)).set(5, 11, 14, p.m('mug', 1)).set(5, 11, 13, p.m('mug', 1));
  v.cyl(3, 11, 15, 16, 1.2, p.m('coffee', 1));
  v.box(2, 5, 12, 8, 9, 13, p.m('paper', 2)).box(3, 6, 13, 9, 10, 14, p.m('paper', 3));
  return v;
}

export function chair(p, color = 'chairBlue') {
  const v = new Vox(p, 'chair');
  const c = n => p.m(color, n), r = n => p.m('rubber', n), s = n => p.m('steel', n);
  v.box(0, 0, 6, 10, 10, 9, (x, y, z) => (z === 8 ? c(3) : c(2)));
  v.box(1, 0, 9, 9, 2, 20, (x, y, z) => (z >= 18 ? c(3) : c(2)));
  v.box(0, 0, 9, 1, 8, 13, c(1)).box(9, 0, 9, 10, 8, 13, c(1));       // armrests
  v.cyl(5, 5, 2, 6, 1, s(2));
  v.box(1, 4, 1, 9, 6, 2, r(1)).box(4, 1, 1, 6, 9, 2, r(1));
  for (const [x, y] of [[0, 5], [9, 5], [5, 0], [5, 9]]) v.set(x, y, 0, r(0));
  return v;
}

// a seated worker, built in the chair's frame (facing +y, toward the desk)
export function worker(p, o = {}) {
  const { skin = 'skin1', hair = 'hairBrown', shirt = 'shirtA', hairStyle = 'short', typing = 0 } = o;
  const v = new Vox(p, 'worker');
  const sk = n => p.m(skin, n), sh = n => p.m(shirt, n), hr = n => p.m(hair, n), pa = n => p.m('pants', n);
  // thighs forward over the seat, shins down
  v.box(2, 3, 9, 4, 10, 12, pa(2)).box(6, 3, 9, 8, 10, 12, pa(2));
  v.box(2, 9, 2, 4, 11, 9, pa(1)).box(6, 9, 2, 8, 11, 9, pa(1));
  v.box(2, 9, 0, 4, 12, 2, p.m('rubber', 1)).box(6, 9, 0, 8, 12, 2, p.m('rubber', 1));
  // torso
  v.box(1, 2, 12, 9, 7, 22, (x, y, z) => (z >= 20 ? sh(3) : sh(2)));
  // arms to the keyboard
  const lift = typing ? 1 : 0;
  v.box(0, 3, 17, 1, 6, 21, sh(1)).box(9, 3, 17, 10, 6, 21, sh(1));
  v.box(0, 6, 15 + lift, 2, 11, 18 + lift, sh(1)).box(8, 6, 15 + (1 - lift), 10, 11, 18 + (1 - lift), sh(1));
  v.box(0, 10, 15 + lift, 2, 12, 17 + lift, sk(2)).box(8, 10, 15 + (1 - lift), 10, 12, 17 + (1 - lift), sk(2));
  // big head, Two-Point proportions
  v.ellipsoid(5, 4.5, 27, 5.6, 5, 5.2, (x, y, z, d) => sk(d > 0.7 ? 2 : 3));
  // face on the +y side
  v.set(3, 9, 27, p.m('eye', 0)).set(7, 9, 27, p.m('eye', 0)).set(3, 9, 26, p.m('eye', 0)).set(7, 9, 26, p.m('eye', 0));
  v.set(2, 9, 25, p.m('blush', 0)).set(8, 9, 25, p.m('blush', 0));
  v.set(5, 9, 24, p.m('eye', 1));
  // hair
  if (hairStyle === 'short') {
    v.ellipsoid(5, 3.5, 29.5, 5.9, 5.4, 4.2, (x, y, z, d) => (y > 7 && z < 29 ? 0 : hr(d > 0.6 ? 1 : 2)));
  } else if (hairStyle === 'long') {
    v.ellipsoid(5, 3.5, 29, 6.2, 5.6, 4.6, (x, y, z, d) => (y > 7 && z < 29 ? 0 : hr(d > 0.6 ? 1 : 2)));
    v.box(-1, 0, 20, 1, 5, 29, hr(1)).box(9, 0, 20, 11, 5, 29, hr(1)).box(0, 0, 21, 10, 2, 29, hr(1));
  } else if (hairStyle === 'tuft') {
    v.ellipsoid(5, 4, 29.5, 5.8, 5.2, 3.6, (x, y, z, d) => (y > 7 && z < 29 ? 0 : hr(2)));
    v.box(4, 3, 33, 7, 6, 36, hr(3));
  }
  return v;
}

export function plant(p, kind = 'bushy') {
  const v = new Vox(p, 'plant');
  v.cyl(0, 0, 0, 3, 3.6, p.m('pot', 2)).cyl(0, 0, 3, 5, 4.2, (x, y, z) => p.m('pot', z === 4 ? 3 : 2));
  v.cyl(0, 0, 5, 6, 3.4, p.m('soil', 1));
  const leafAt = (cx, cy, cz, rx, ry, rz, seed) => v.ellipsoid(cx, cy, cz, rx, ry, rz, (x, y, z, d) => {
    const n = hash(x, y, z, seed);
    const up = (z - cz) / rz, lit = x < cx ? 0.12 : 0;           // light comes from the left
    const t = up + lit + (n - 0.5) * 0.9;
    return p.m(n > 0.9 ? 'leafLight' : t > 0.35 ? 'leaf' : 'leaf2', t > 0.35 ? 3 : t > -0.2 ? 2 : 1);
  });
  if (kind === 'bushy') {
    leafAt(0, 0, 10, 5.5, 5.5, 4.8, 1); leafAt(-3, 1, 14, 4, 4, 3.8, 2); leafAt(3, -1, 15, 4, 4, 4, 3); leafAt(0, 1, 19, 3.5, 3.5, 3.4, 4);
  } else if (kind === 'tall') {
    v.cyl(0, 0, 6, 17, 0.9, p.m('trunk', 2));
    leafAt(0, 0, 22, 5, 5, 5.5, 5); leafAt(-4, 0, 17, 3.5, 3.5, 3, 6); leafAt(4, 1, 18, 3.5, 3.5, 3, 7);
  } else if (kind === 'flower') {
    leafAt(0, 0, 9, 5, 5, 3.4, 8);
    for (const [x, y, z, c] of [[-3, 0, 13, 'flowerP'], [2, 2, 14, 'flowerY'], [3, -2, 12, 'flowerP'], [-1, -3, 12, 'flowerY'], [0, 1, 15, 'flowerP']]) v.box(x, y, z, x + 2, y + 2, z + 2, p.m(c, 2)).set(x, y, z + 1, p.m(c, 3));
  }
  return v;
}

export function tree(p, seed = 1) {
  const v = new Vox(p, 'tree');
  v.cyl(0, 0, 0, 14, 2.4, (x, y, z) => p.m('trunk', x < 0 ? 3 : x > 0 ? 1 : 2));
  v.cyl(0, 0, 0, 2, 3.4, p.m('trunk', 1));
  const blob = (cx, cy, cz, r, s) => v.ellipsoid(cx, cy, cz, r, r, r * 0.92, (x, y, z, d) => {
    const n = hash(x, y, z, s + seed);
    const t = (z - cz) / r + (x < cx ? 0.15 : -0.05) + (n - 0.5) * 0.8;
    return p.m(n > 0.93 ? 'leafLight' : t > 0.3 ? 'leaf' : 'leaf2', t > 0.3 ? 3 : t > -0.25 ? 2 : 1);
  });
  blob(0, 0, 22, 9, 1); blob(-6, 2, 18, 6.5, 2); blob(6, -1, 19, 6.5, 3); blob(1, 5, 18, 6, 4); blob(-1, -5, 19, 6, 5); blob(0, 0, 29, 6, 6);
  return v;
}

export function shelf(p) {
  const v = new Vox(p, 'shelf');
  const w = n => p.m('woodDark', n);
  v.box(0, 0, 0, 20, 6, 36, w(2));
  for (const z of [1, 10, 19, 28]) {
    v.box(1, 0, z, 19, 5, z + 8, w(0));                   // dark inside
    let x = 2;
    const books = ['bkR', 'bkB', 'bkG', 'bkY', 'bkP', 'bkO'];
    while (x < 17) {
      const bw = 1 + Math.floor(hash(x, z, 3) * 2.5), h = 5 + Math.floor(hash(x, z, 4) * 3);
      const bk = books[Math.floor(hash(x, z, 5) * books.length)];
      if (hash(x, z, 6) > 0.12) v.box(x, 0, z, x + bw, 4, z + h, (X, Y, Z) => p.m(bk, Z === z + h - 1 ? 2 : 1));
      x += bw + (hash(x, z, 7) > 0.8 ? 1 : 0);
    }
  }
  v.box(0, 0, 35, 20, 6, 37, w(3));
  return v;
}

export function sofa(p, color = 'shirtD') {
  const v = new Vox(p, 'sofa'), c = n => p.m(color, n);
  v.box(0, 0, 3, 30, 12, 8, (x, y, z) => c(z === 7 ? 3 : 2));                  // seat
  v.box(0, 8, 8, 30, 12, 18, (x, y, z) => c(z >= 17 ? 3 : 2));                // back
  v.box(0, 0, 3, 4, 12, 12, c(1)).box(26, 0, 3, 30, 12, 12, c(1));            // arms
  for (const x of [1, 28]) v.box(x, 1, 0, x + 2, 3, 3, p.m('woodDark', 1)).box(x, 9, 0, x + 2, 11, 3, p.m('woodDark', 1));
  v.box(5, 0, 7, 15, 8, 9, c(3)).box(15, 0, 7, 25, 8, 9, c(3));              // cushions
  return v;
}
export function cooler(p) {
  const v = new Vox(p, 'cooler');
  v.box(0, 0, 0, 8, 8, 14, p.m('kb', 2)).box(1, -1, 3, 4, 0, 5, p.m('screen', 1)).box(4, -1, 3, 7, 0, 5, p.m('mug', 2));
  v.cyl(4, 4, 14, 26, 3.6, (x, y, z) => p.m('screen', z > 22 ? 2 : 1)); v.cyl(4, 4, 26, 28, 2, p.m('screen', 2));
  v.box(2, 2, 0, 6, 6, 1, p.m('steel', 1));
  return v;
}
export function lamp(p) {
  const v = new Vox(p, 'lamp');
  v.cyl(0, 0, 0, 2, 3, p.m('steel', 1)).cyl(0, 0, 2, 26, 0.8, p.m('steel', 2));
  v.cyl(0, 0, 26, 33, 4, (x, y, z) => p.m('trim', z > 31 ? 3 : 2)); v.cyl(0, 0, 25, 26, 3, p.m('carpetGold', 3));
  return v;
}
export function rug(p, w = 26, d = 18, a = 'carpetGold', b = 'carpetTeal') {
  const v = new Vox(p, 'rug');
  v.box(0, 0, 0, w, d, 1, (x, y) => { const e = Math.min(x, y, w - 1 - x, d - 1 - y); return p.m(e < 2 ? b : a, e === 0 ? 1 : 2); });
  return v;
}
export function wallPiece(p, len, kind = 'plain', axis = 'x') {
  // wall along +x, 2 thick, 30 tall; the inner face looks toward -y
  const v = new Vox(p, 'wall');
  v.box(0, 0, 0, len, 2, 30, (x, y, z) => (z < 3 ? p.m('trim', 2) : z >= 29 ? p.m('trim', 3) : p.m('wallCream', 2)));
  if (kind === 'window') {
    const x0 = Math.floor(len / 2) - 7;
    v.box(x0 - 1, 0, 11, x0 + 15, 2, 27, p.m('trim', 3));
    v.box(x0, 0, 12, x0 + 14, 2, 26, (x, y, z) => p.m('screen', y === 0 ? (z > 21 ? 3 : 2) : 1));
    v.box(x0 + 6, 0, 12, x0 + 8, 1, 26, p.m('trim', 3)).box(x0, 0, 18, x0 + 14, 1, 20, p.m('trim', 3));
    v.box(x0 - 2, 0, 10, x0 + 16, 3, 11, p.m('trim', 2));
  } else if (kind === 'poster') {
    const x0 = Math.floor(len / 2) - 4;
    v.box(x0 - 1, 0, 12, x0 + 9, 1, 26, p.m('trim', 3));
    v.box(x0, 0, 13, x0 + 8, 1, 25, (x, y, z) => p.m(['bkR', 'bkB', 'bkY', 'bkG'][(Math.floor((x - x0) / 4) + Math.floor((z - 13) / 6)) % 4], 2));
  } else if (kind === 'clock') {
    const cx = Math.floor(len / 2);
    v.cyl(cx, 0, 18, 19, 0, p.m('trim', 3));
    for (let x = cx - 4; x <= cx + 4; x++) for (let z = 15; z <= 24; z++) if ((x - cx) ** 2 + (z - 19.5) ** 2 <= 20) v.set(x, 0, z, p.m('trim', (x - cx) ** 2 + (z - 19.5) ** 2 > 14 ? 3 : 1));
    v.box(cx, 0, 19, cx + 1, 1, 23, p.m('rubber', 0)).box(cx, 0, 19, cx + 3, 1, 20, p.m('rubber', 0));
  }
  return v;
}
export function bush(p, seed = 1) {
  const v = new Vox(p, 'bush');
  const blob = (cx, cy, cz, r, s) => v.ellipsoid(cx, cy, cz, r * 1.15, r, r * 0.85, (x, y, z) => { const n = hash(x, y, z, s + seed), t = (z - cz) / r + (x < cx ? 0.12 : 0) + (n - 0.5) * 0.8; return p.m(n > 0.94 ? 'leafLight' : t > 0.25 ? 'leaf' : 'leaf2', t > 0.25 ? 3 : t > -0.25 ? 2 : 1); });
  blob(0, 0, 4, 5, 1); blob(-5, 1, 3, 4, 2); blob(5, 0, 3, 4, 3);
  return v;
}
export function bench(p) {
  const v = new Vox(p, 'bench');
  v.box(0, 0, 6, 26, 7, 8, p.m('wood', 2)).box(0, 5, 8, 26, 7, 16, (x, y, z) => p.m('wood', z % 4 === 3 ? 1 : 2));
  for (const x of [2, 22]) v.box(x, 1, 0, x + 2, 6, 6, p.m('rubber', 1));
  return v;
}
export function lampPost(p) {
  const v = new Vox(p, 'lamppost');
  v.cyl(0, 0, 0, 3, 2.4, p.m('rubber', 1)).cyl(0, 0, 3, 30, 1, p.m('rubber', 2));
  v.box(-3, -3, 30, 4, 4, 36, (x, y, z) => p.m('carpetGold', z > 33 ? 3 : 2)); v.box(-3, -3, 36, 4, 4, 38, p.m('rubber', 2));
  return v;
}
export function groundPatch(p, w, d, seed = 1) {
  const v = new Vox(p, 'ground');
  v.box(0, 0, -3, w, d, 0, (x, y, z) => p.m(z === -1 ? 'woodDark' : 'trunk', z === -1 ? 1 : 0));
  v.box(0, 0, -1, w, d, 0, (x, y) => { const n = hash(x, y, 0, seed); return p.m(n > 0.92 ? 'leafLight' : 'grass', n > 0.55 ? 3 : n > 0.18 ? 2 : 1); });
  return v;
}
