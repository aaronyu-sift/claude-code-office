// Models for the pixel scene beyond the style proof in models.mjs: floor tiles, wall pieces, desk states, people in poses.
// Axes as in lib.mjs: x east, y north, z up. Objects face -y unless noted; seated people face +y (toward their desk).
import { Vox, hash } from './lib.mjs';
import { desk, bush, tree } from './models.mjs';

// ---- floors: 16 x 16 voxel tiles, slab z -2..0 (one tile = one 24 x 12 px diamond in the isometric view) ----------
export function floorTile(p, kind, variant = 0) {
  const v = new Vox(p, 'floor_' + kind + variant);
  const side = p.m('woodDark', 1);
  if (kind === 'carpet') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return side;
      const check = ((x >> 3) + (y >> 3) + variant) % 2;
      const n = hash(x, y, 1 + variant);
      return p.m('carpetN', check ? 3 : 2) - (n > 0.86 ? 1 : 0);
    });
  } else if (kind === 'wood') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return side;
      const plank = Math.floor((y + variant * 2) / 4), n = hash(plank, Math.floor(x / 8) + variant, 3);
      if ((y + variant * 2) % 4 === 0) return p.m('plank', 1);
      return p.m('plank', n > 0.66 ? 3 : n > 0.25 ? 2 : 1 + (x % 8 === 0 ? 0 : 1));
    });
  } else if (kind === 'tile') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return side;
      if (x % 8 === 0 || y % 8 === 0) return p.m('tile', 1);
      return p.m('tile', ((x >> 3) + (y >> 3)) % 2 ? 3 : 2);
    });
  } else if (kind === 'grass') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return p.m('soil', 1);
      const n = hash(x, y, variant, 5);
      return p.m('grass', n > 0.93 ? 3 : n > 0.14 ? 2 : 1);
    });
    // a few tufts and flowers on some variants
    const tufts = [[3, 4], [11, 9], [6, 13], [13, 2]];
    if (variant === 1) for (const [x, y] of tufts) v.box(x, y, 0, x + 1, y + 1, 1, p.m('leaf', 3));
    if (variant === 2) tufts.forEach(([x, y], i) => v.box(x, y, 0, x + 1, y + 1, 1, p.m(['flowerP', 'flowerY', 'flowerW', 'flowerB'][i], 3)));
  } else if (kind === 'checker') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return side;
      return ((x >> 2) + (y >> 2)) % 2 ? p.m('kb', hash(x, y, 2) > 0.9 ? 2 : 3) : p.m('metalDark', hash(x, y, 3) > 0.9 ? 1 : 2);
    });
  } else if (kind === 'hall' || kind === 'gold' || kind === 'teal') {
    const base = kind === 'teal' ? 'carpetTeal' : 'carpetGold', other = kind === 'teal' ? 'carpetGold' : 'carpetTeal';
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return side;
      const n = hash(x, y, 4 + variant);
      if (kind === 'hall') { const e = Math.min(x, 15 - x); return e < 2 ? p.m(other, 1) : e === 3 || e === 4 ? p.m('carpetGold', 3) : p.m('carpetTeal', n > 0.88 ? 3 : 2); }
      const dia = (Math.abs(x - 8) + Math.abs(y - 8)) % 8 === 0;
      return p.m(base, dia ? 3 : n > 0.9 ? 3 : 2);
    });
  } else if (kind === 'path') {
    v.box(0, 0, -2, 16, 16, 0, (x, y, z) => {
      if (z === -2) return p.m('soil', 1);
      const cx = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 6), cy = Math.floor(y / 5);
      const edge = (x + (Math.floor(y / 5) % 2) * 3) % 6 === 0 || y % 5 === 0;
      if (edge) return p.m('stone', 0);
      const n = hash(cx, cy, 7);
      return p.m('stone', n > 0.7 ? 3 : n > 0.3 ? 2 : 1);
    });
  }
  return v;
}

// ---- walls: along +x, 2 thick, inner face toward -y; the scene rotates a piece for the west wall ------------------
export function wallPiece(p, kind = 'plain', len = 32) {
  const v = new Vox(p, 'wall_' + kind);
  const H = kind === 'low' ? 7 : 30;
  const wn = n => p.m('wallN', n), tr = n => p.m('trim', n);
  v.box(0, 0, 0, len, 2, H, (x, y, z) => {
    if (z >= H - 1) return tr(3);                                         // cap
    if (kind === 'low') return wn(z < 2 ? 1 : 2);
    if (z < 3) return wn(1);                                              // baseboard
    if (z === 10) return tr(2);                                           // chair rail
    if (z < 10) return wn(x % 8 < 1 ? 1 : 2);                             // wainscot panels
    return wn(x % 6 === 0 ? 3 : 2);                                       // wallpaper stripe
  });
  if (kind === 'window') {
    const x0 = (len >> 1) - 8;
    v.box(x0 - 1, 0, 11, x0 + 17, 2, 27, tr(3));
    v.box(x0, 0, 12, x0 + 16, 2, 26, (x, y, z) => p.m('screen', y === 0 ? (z > 22 ? 3 : z > 17 ? 2 : 1) : 1));
    v.box(x0 + 7, 0, 12, x0 + 9, 1, 26, tr(3)).box(x0, 0, 18, x0 + 16, 1, 20, tr(3));
    v.box(x0 - 2, 0, 9, x0 + 18, 3, 11, tr(2));                           // sill
  } else if (kind === 'posterA' || kind === 'posterB') {
    const x0 = (len >> 1) - 5, cols = { posterA: ['bkR', 'bkB', 'bkY', 'bkG'], posterB: ['bkP', 'bkO', 'bkB', 'bkY'] }[kind] || ['bkG', 'bkR', 'bkP', 'bkO'];
    v.box(x0 - 1, 0, 13, x0 + 11, 1, 27, tr(3));
    v.box(x0, 0, 14, x0 + 10, 1, 26, (x, y, z) => p.m(cols[(Math.floor((x - x0) / 5) + Math.floor((z - 14) / 6)) % 4], (x + z) % 7 === 0 ? 3 : 2));
  } else if (kind === 'clock') {
    const cx = len >> 1;
    for (let x = cx - 5; x <= cx + 5; x++) for (let z = 14; z <= 24; z++) {
      const d = (x - cx) ** 2 + (z - 19) ** 2;
      if (d <= 26) v.set(x, 0, z, d > 19 ? p.m('woodDark', 2) : p.m('trim', 3));
    }
    v.box(cx, 0, 19, cx + 1, 1, 23, p.m('rubber', 0)).box(cx, 0, 19, cx + 3, 1, 20, p.m('rubber', 0));
  } else if (kind === 'door') {
    const x0 = (len >> 1) - 7;
    v.box(x0 - 2, 0, 0, x0 + 16, 2, 26, tr(3));
    v.box(x0, 0, 0, x0 + 14, 1, 24, (x, y, z) => { const panel = (z > 2 && z < 11 || z > 13 && z < 22) && x > x0 + 1 && x < x0 + 12; return p.m('wood', panel ? 3 : 2); });
    v.box(x0 + 10, -1, 11, x0 + 12, 0, 13, p.m('steel', 3));
    v.box(x0 + 1, 0, 22, x0 + 13, 1, 24, p.m('glass', 1));
  } else if (kind === 'posterC') {
    const x0 = (len >> 1) - 9;
    v.box(x0 - 1, 0, 14, x0 + 19, 1, 26, p.m('woodDark', 2));
    v.box(x0, 0, 15, x0 + 18, 1, 25, (x, y, z) => { const hill = 19 + Math.floor(3 * Math.sin((x - x0) / 3)); return z > hill ? p.m('glass', 2) : z > hill - 3 ? p.m('leaf', 2) : p.m('leaf2', 1); });
    v.box(x0 + 11, 0, 21, x0 + 14, 1, 24, p.m('flowerY', 3));
  } else if (kind === 'notice') {
    const x0 = (len >> 1) - 9;
    v.box(x0 - 1, 0, 12, x0 + 19, 1, 26, p.m('woodDark', 2));
    v.box(x0, 0, 13, x0 + 18, 1, 25, (x, y, z) => p.m('cork', hash(x, z, 5) > 0.7 ? 3 : 2));
    for (const [nx, nz, c] of [[x0 + 2, 19, 'paper'], [x0 + 7, 15, 'flowerY'], [x0 + 12, 20, 'flowerP'], [x0 + 5, 21, 'flowerB'], [x0 + 13, 15, 'paper']]) { v.box(nx, -1, nz, nx + 4, 0, nz + 4, p.m(c, 2)); v.set(nx + 1, -1, nz + 3, p.m('mug', 2)); }
  } else if (kind === 'shelfwall') {
    v.box(1, -2, 0, len - 1, 2, 28, p.m('woodDark', 2));
    const books = ['bkR', 'bkB', 'bkG', 'bkY', 'bkP', 'bkO'];
    for (const z of [2, 10, 18]) {
      v.box(2, -2, z, len - 2, 0, z + 7, p.m('woodDark', 0));
      let x = 3;
      while (x < len - 4) { const bw = 1 + Math.floor(hash(x, z, 3) * 2.5), h = 4 + Math.floor(hash(x, z, 4) * 3), bk = books[Math.floor(hash(x, z, 5) * books.length)]; if (hash(x, z, 6) > 0.15) v.box(x, -2, z, x + bw, 0, z + h, (X, Y, Z) => p.m(bk, Z === z + h - 1 ? 2 : 1)); x += bw + (hash(x, z, 7) > 0.85 ? 1 : 0); }
    }
    v.box(0, -2, 26, len, 2, 29, p.m('woodDark', 3));
  } else if (kind === 'glass') {
    v.box(0, 0, 3, len, 2, 30, (x, y, z) => { if (z >= 29 || x % 16 < 1) return p.m('trim', 3); if (z < 10) return wn(z === 9 ? 3 : 2); return p.m('glass', y === 0 && (x + z) % 9 === 0 ? 2 : 1); });
  } else if (kind === 'windowB') {
    for (const x0 of [4, 19]) {
      v.box(x0 - 1, 0, 11, x0 + 9, 2, 28, tr(3));
      v.box(x0, 0, 12, x0 + 8, 2, 27, (x, y, z) => ((x - x0 - 3.5) ** 2 / 20 + (z > 22 ? (z - 22) ** 2 / 20 : 0) > 1 && z > 22 ? 0 : p.m('screen', y === 0 ? (z > 22 ? 3 : z > 17 ? 2 : 1) : 1)));
      v.box(x0 + 3, 0, 12, x0 + 5, 1, 27, tr(3));
    }
    v.box(2, 0, 9, 30, 3, 11, tr(2));
  } else if (kind === 'sconce') {
    const cx = len >> 1;
    v.box(cx - 1, -1, 17, cx + 1, 0, 24, p.m('steel', 2));
    v.cyl(cx, -2, 22, 27, 2.6, (x, y, z) => p.m('paper', z > 25 ? 3 : 2));
    v.box(cx - 1, -2, 20, cx + 1, -1, 22, p.m('carpetGold', 3));
  } else if (kind === 'whiteboard') {
    const x0 = 3;
    v.box(x0 - 1, 0, 12, len - 2, 1, 26, p.m('steel', 2));
    v.box(x0, 0, 13, len - 3, 1, 25, (x, y, z) => {
      const line = z % 4 === 0 && hash(Math.floor(x / 3), z, 2) > 0.3 && x < len - 8 - (z % 8);
      return line ? p.m(['bkB', 'bkR', 'bkG'][Math.floor(z / 4) % 3], 2) : p.m('boardWhite', 2);
    });
    v.box(x0 + 2, 0, 12, x0 + 9, 2, 13, p.m('steel', 3));                  // tray
  }
  return v;
}
export function pillar(p) {
  const v = new Vox(p, 'wall_cap');
  v.box(0, 0, 0, 2, 2, 30, (x, y, z) => (z >= 28 ? p.m('carpetGold', 3) : z < 3 ? p.m('wallN', 1) : p.m('trim', z === 12 ? 1 : 2)));
  v.box(-1, -1, 28, 3, 3, 30, p.m('carpetGold', 2));
  return v;
}
export function cornerPost(p) {
  const v = new Vox(p, 'wall_corner');
  v.box(0, 0, 0, 2, 2, 30, (x, y, z) => (z >= 29 ? p.m('trim', 3) : z < 3 ? p.m('wallN', 1) : p.m('wallN', 2)));
  return v;
}

// ---- desks with a screen state: on (code), idle (waiting for you), off (asleep) -----------------------------------
export function deskState(p, state = 'on') {
  const v = desk(p, { props: false });
  v.name = 'desk_' + state;
  for (let x = 9; x < 23; x++) for (let z = 18; z < 30; z++) {
    if (state === 'idle') v.set(x, 6, z, p.m('screen', (z === 24 && x > 10 && x < 14) || (z === 22 && x > 10 && x < 19) ? 2 : 1));
    else if (state === 'off') v.set(x, 6, z, p.m('screenOff', (x - 9) + (z - 18) === 6 || (x - 9) + (z - 18) === 7 ? 2 : (x + z) % 9 === 0 ? 1 : 0));
  }
  if (state === 'off') { v.set(16, 1, 13, 0); v.box(21, 2, 12, 22, 3, 14, p.m('steel', 3)); }
  return v;
}

// a wider desk for the main agent: two screens, a plant and a nameplate
export function chiefDesk(p, state = 'on') {
  const v = new Vox(p, 'deskchief_' + state);
  const top = p.m('deskTop', 2), edge = p.m('deskTop', 3), wood = p.m('wood', 2), dark = p.m('woodDark', 2);
  v.box(0, 0, 10, 44, 16, 12, (x, y, z) => (z === 10 ? p.m('woodDark', 2) : y === 0 || x === 0 || x === 43 ? edge : top));
  v.box(1, 1, 0, 11, 15, 10, wood);
  for (const [z0, z1] of [[1, 5], [6, 9]]) { v.box(1, 0, z0, 11, 1, z1, dark); v.box(4, -1, (z0 + z1) >> 1, 8, 0, ((z0 + z1) >> 1) + 1, p.m('steel', 3)); }
  v.box(41, 1, 0, 43, 4, 10, dark).box(41, 12, 0, 43, 15, 10, dark).box(11, 14, 3, 41, 15, 10, p.m('woodDark', 1));
  for (const x0 of [14, 29]) {
    v.box(x0 + 3, 7, 12, x0 + 9, 11, 13, p.m('plastic', 2)).box(x0 + 5, 8, 13, x0 + 7, 10, 18, p.m('plastic', 1));
    v.box(x0 - 1, 8, 17, x0 + 15, 10, 31, p.m('plastic', 2));
    for (let x = x0; x < x0 + 14; x++) for (let z = 18; z < 30; z++) {
      let m;
      if (state === 'off') m = p.m('screenOff', (x - x0) + (z - 18) === 6 ? 2 : 0);
      else if (state === 'idle') m = p.m('screen', (z === 24 && x > x0 + 1 && x < x0 + 5) ? 2 : 1);
      else m = p.m('screen', (z % 3 === 0) && hash(Math.floor(x / 3), z, x0) > 0.28 && x < x0 + 12 - Math.floor(hash(z, 4) * 5) ? (hash(z, 9) > 0.6 ? 3 : 2) : 1);
      v.set(x, 7, z, m);
    }
  }
  v.box(12, 1, 12, 28, 5, 13, (x, y) => p.m('kb', (x + y) % 2 === 0 ? 2 : 3));
  v.cyl(40, 12, 12, 14, 2.2, p.m('pot', 2)).ellipsoid(40, 12, 17, 3, 3, 3.6, (x, y, z) => p.m(hash(x, y, z, 4) > 0.8 ? 'leafLight' : z > 17 ? 'leaf' : 'leaf2', z > 17 ? 3 : 2));
  v.box(18, 0, 10, 26, 1, 12, p.m('carpetGold', 2));                      // nameplate
  return v;
}

// a swivel chair with a low back, so the person on it shows above the backrest; the seat is 10 x 10, the back at y 0..2
export function officeChair(p, color = 'chairSlate') {
  const v = new Vox(p, 'chair');
  const c = n => p.m(color, n), r = n => p.m('rubber', n), s = n => p.m('steel', n);
  v.box(0, 0, 6, 10, 10, 9, (x, y, z) => (z === 8 ? c(3) : c(2)));
  v.box(1, 0, 9, 9, 2, 16, (x, y, z) => (z >= 15 ? c(3) : c(2)));
  v.box(0, 1, 9, 1, 8, 12, c(1)).box(9, 1, 9, 10, 8, 12, c(1));
  v.cyl(5, 5, 2, 6, 1, s(2));
  v.box(1, 4, 1, 9, 6, 2, r(1)).box(4, 1, 1, 6, 9, 2, r(1));
  for (const [x, y] of [[0, 5], [9, 5], [5, 0], [5, 9]]) v.set(x, y, 0, r(0));
  return v;
}

// ---- people: a seated worker with the chair, facing +y ------------------------------------------------------------
export const APPEARANCES = [
  { skin: 'skin1', hair: 'hairBrown', shirt: 'shirtA', hairStyle: 'short' },
  { skin: 'skin2', hair: 'hairBlond', shirt: 'shirtB', hairStyle: 'long' },
  { skin: 'skin3', hair: 'hairBlack', shirt: 'shirtC', hairStyle: 'tuft' },
  { skin: 'skin4', hair: 'hairRed', shirt: 'shirtD', hairStyle: 'long' },
  { skin: 'skin2', hair: 'hairBlack', shirt: 'shirtE', hairStyle: 'short' },
  { skin: 'skin1', hair: 'hairGrey', shirt: 'shirtB', hairStyle: 'tuft' },
];
export const POSES = ['typeA', 'typeB', 'wait', 'sleep', 'relax', 'think'];   // seated; `stand` is a separate model without the chair

export function seatedWorker(p, ap, pose, chairColor = 'chairSlate') {
  const { skin, hair, shirt, hairStyle } = ap;
  const v = new Vox(p, 'worker');
  v.put(officeChair(p, chairColor), 0, 0, 0);
  const sk = n => p.m(skin, n), sh = n => p.m(shirt, n), hr = n => p.m(hair, n), pa = n => p.m('pants', n);
  const hy = pose === 'sleep' ? 3 : pose === 'relax' ? -1 : 0, hz = pose === 'sleep' ? -4 : pose === 'relax' ? 1 : 0;
  // legs
  v.box(2, 3, 9, 4, 10, 12, pa(2)).box(6, 3, 9, 8, 10, 12, pa(2));
  v.box(2, 9, 2, 4, 11, 9, pa(1)).box(6, 9, 2, 8, 11, 9, pa(1));
  v.box(2, 9, 0, 4, 12, 2, p.m('rubber', 1)).box(6, 9, 0, 8, 12, 2, p.m('rubber', 1));
  // torso (leans forward a little when asleep)
  const lean = pose === 'sleep' ? 1 : 0;
  v.box(1, 2 + lean, 12, 9, 7 + lean, 22, (x, y, z) => (z >= 20 ? sh(3) : sh(2)));
  // arms
  const armsTo = (lift, lift2) => {
    v.box(0, 3, 17, 1, 6, 21, sh(1)).box(9, 3, 17, 10, 6, 21, sh(1));
    v.box(0, 6, 15 + lift, 2, 11, 18 + lift, sh(1)).box(8, 6, 15 + lift2, 10, 11, 18 + lift2, sh(1));
    v.box(0, 10, 15 + lift, 2, 12, 17 + lift, sk(2)).box(8, 10, 15 + lift2, 10, 12, 17 + lift2, sk(2));
  };
  if (pose === 'typeA') armsTo(0, 1);
  else if (pose === 'typeB') armsTo(1, 0);
  else if (pose === 'wait') {
    v.box(0, 3, 17, 1, 6, 21, sh(1)).box(0, 6, 15, 2, 11, 18, sh(1)).box(0, 10, 15, 2, 12, 17, sk(2));
    v.box(9, 3, 17, 11, 6, 22, sh(1)).box(10, 3, 22, 12, 6, 31, sh(1)).box(10, 3, 31, 12, 6, 35, sk(2));   // raised arm and hand
  } else if (pose === 'sleep') {
    v.box(0, 4, 13, 2, 8, 20, sh(1)).box(8, 4, 13, 10, 8, 20, sh(1)).box(1, 7, 12, 3, 9, 14, sk(2)).box(7, 7, 12, 9, 9, 14, sk(2));   // arms down in the lap
  } else if (pose === 'think') {
    v.box(0, 3, 17, 1, 6, 21, sh(1)).box(0, 6, 15, 2, 11, 18, sh(1)).box(0, 10, 15, 2, 12, 17, sk(2));                              // left hand on the keyboard
    v.box(9, 3, 17, 11, 6, 24, sh(1)).box(6, 5, 23, 11, 8, 26, sh(1)).box(4, 7, 22, 8, 10, 25, sk(2));                              // right hand at the chin
  } else if (pose === 'relax') {
    v.box(-1, 3, 17, 1, 6, 24, sh(1)).box(9, 3, 17, 11, 6, 24, sh(1));                                                                // elbows out
    v.box(0, 2, 24, 3, 5, 27, sh(1)).box(7, 2, 24, 10, 5, 27, sh(1)).box(2, 1, 27, 5, 4, 29, sk(2)).box(5, 1, 27, 8, 4, 29, sk(2));  // hands behind the head
  }
  // big head with a face on the +y side
  v.ellipsoid(5, 4.5 + hy, 27 + hz, 5.6, 5, 5.2, (x, y, z, d) => sk(d > 0.7 ? 2 : 3));
  const fy = Math.round(9 + hy), fz = 27 + hz;
  if (pose !== 'sleep') {
    v.set(3, fy, fz, p.m('eye', 0)).set(7, fy, fz, p.m('eye', 0)).set(3, fy, fz - 1, p.m('eye', 0)).set(7, fy, fz - 1, p.m('eye', 0));
  } else {
    v.set(3, fy, fz - 1, p.m('eye', 0)).set(4, fy, fz - 1, p.m('eye', 0)).set(6, fy, fz - 1, p.m('eye', 0)).set(7, fy, fz - 1, p.m('eye', 0));   // closed eyes
  }
  v.set(2, fy, fz - 2, p.m('blush', 0)).set(8, fy, fz - 2, p.m('blush', 0)).set(5, fy, fz - 3, p.m('eye', 1));
  // hair
  const hyc = 3.5 + hy, hzc = 29.5 + hz;
  const front = (x, y, z) => y > 7 + hy && z < 29 + hz;
  if (hairStyle === 'short') v.ellipsoid(5, hyc, hzc, 5.9, 5.4, 4.2, (x, y, z, d) => (front(x, y, z) ? 0 : hr(d > 0.6 ? 1 : 2)));
  else if (hairStyle === 'long') {
    v.ellipsoid(5, hyc, hzc - 0.5, 6.2, 5.6, 4.6, (x, y, z, d) => (front(x, y, z) ? 0 : hr(d > 0.6 ? 1 : 2)));
    v.box(-1, 0 + hy, 20 + hz, 1, 5 + hy, 29 + hz, hr(1)).box(9, 0 + hy, 20 + hz, 11, 5 + hy, 29 + hz, hr(1)).box(0, 0 + hy, 21 + hz, 10, 2 + hy, 29 + hz, hr(1));
  } else {
    v.ellipsoid(5, hyc + 0.5, hzc, 5.8, 5.2, 3.6, (x, y, z) => (front(x, y, z) ? 0 : hr(2)));
    v.box(4, 3 + hy, 33 + hz, 7, 6 + hy, 36 + hz, hr(3));
  }
  return v;
}

// a standing person, facing +y at facing 0 (baked at 4 facings)
export function standingWorker(p, ap) {
  const { skin, hair, shirt, hairStyle } = ap;
  const v = new Vox(p, 'stand');
  const sk = n => p.m(skin, n), sh = n => p.m(shirt, n), hr = n => p.m(hair, n), pa = n => p.m('pants', n);
  v.box(2, 3, 2, 4, 7, 13, pa(2)).box(6, 3, 2, 8, 7, 13, pa(2));
  v.box(2, 2, 0, 4, 8, 2, p.m('rubber', 1)).box(6, 2, 0, 8, 8, 2, p.m('rubber', 1));
  v.box(1, 2, 13, 9, 8, 24, (x, y, z) => (z >= 22 ? sh(3) : sh(2)));
  v.box(-1, 3, 12, 1, 7, 23, sh(1)).box(9, 3, 12, 11, 7, 23, sh(1));
  v.box(-1, 3, 10, 1, 7, 12, sk(2)).box(9, 3, 10, 11, 7, 12, sk(2));
  v.ellipsoid(5, 4.5, 29, 5.6, 5, 5.2, (x, y, z, d) => sk(d > 0.7 ? 2 : 3));
  v.set(3, 9, 29, p.m('eye', 0)).set(7, 9, 29, p.m('eye', 0)).set(3, 9, 28, p.m('eye', 0)).set(7, 9, 28, p.m('eye', 0));
  v.set(2, 9, 27, p.m('blush', 0)).set(8, 9, 27, p.m('blush', 0)).set(5, 9, 26, p.m('eye', 1));
  const front = (x, y, z) => y > 7 && z < 31;
  if (hairStyle === 'short') v.ellipsoid(5, 3.5, 31.5, 5.9, 5.4, 4.2, (x, y, z, d) => (front(x, y, z) ? 0 : hr(d > 0.6 ? 1 : 2)));
  else if (hairStyle === 'long') {
    v.ellipsoid(5, 3.5, 31, 6.2, 5.6, 4.6, (x, y, z, d) => (front(x, y, z) ? 0 : hr(d > 0.6 ? 1 : 2)));
    v.box(-1, 0, 22, 1, 5, 31, hr(1)).box(9, 0, 22, 11, 5, 31, hr(1)).box(0, 0, 23, 10, 2, 31, hr(1));
  } else {
    v.ellipsoid(5, 4, 31.5, 5.8, 5.2, 3.6, (x, y, z) => (front(x, y, z) ? 0 : hr(2)));
    v.box(4, 3, 35, 7, 6, 38, hr(3));
  }
  return v;
}

// ---- outdoors -----------------------------------------------------------------------------------------------------
export function pine(p) {
  const v = new Vox(p, 'pine');
  v.cyl(0, 0, 0, 8, 2, (x, y, z) => p.m('bark', x < 0 ? 3 : x > 0 ? 1 : 2));
  [[7, 9, 7], [12, 7, 7], [17, 5.5, 7], [22, 3.5, 6]].forEach(([z, r, h], i) => {
    for (let k = 0; k < h; k++) {
      const rr = r * (1 - k / (h + 1.5));
      v.cyl(0, 0, Math.round(z + k), Math.round(z + k) + 1, rr, (x, y, zz) => { const n = hash(x, y, zz, 8 + i), lit = x < 0 ? 0.1 : 0; return p.m('leafPine', n + lit > 0.85 ? 3 : k > h * 0.55 ? 3 : n > 0.3 ? 2 : 1); });
    }
  });
  return v;
}
export function flowerbed(p, seed = 1) {
  const v = new Vox(p, 'flowerbed');
  v.box(0, 0, 0, 24, 8, 4, (x, y, z) => (x < 1 || x > 22 || y < 1 || y > 6 ? p.m('stone', z > 2 ? 3 : 2) : p.m('soil', 1)));
  for (let x = 2; x < 22; x += 2) for (let y = 2; y < 7; y += 2) {
    const n = hash(x, y, seed);
    v.box(x, y, 4, x + 1, y + 1, 5 + Math.floor(n * 2), p.m('leaf', 2));
    v.set(x, y, 6 + Math.floor(n * 2), p.m(['flowerP', 'flowerY', 'flowerW', 'flowerB'][Math.floor(hash(y, x, seed) * 4)], 3));
  }
  return v;
}
export function rock(p, seed = 1) {
  const v = new Vox(p, 'rock');
  v.ellipsoid(0, 0, 3, 5 + seed % 2, 4, 3.4, (x, y, z) => p.m('rock', z > 4 ? 3 : hash(x, y, z, seed) > 0.7 ? 1 : 2));
  v.ellipsoid(5, 2, 2, 3, 2.6, 2.2, (x, y, z) => p.m('rock', z > 3 ? 3 : 2));
  return v;
}
export function coffeeTable(p) {
  const v = new Vox(p, 'table');
  v.box(0, 0, 8, 22, 12, 10, (x, y, z) => (z === 9 ? p.m('deskTop', 3) : p.m('wood', 2)));
  for (const [x, y] of [[1, 1], [19, 1], [1, 9], [19, 9]]) v.box(x, y, 0, x + 2, y + 2, 8, p.m('woodDark', 2));
  v.cyl(6, 6, 10, 13, 1.6, p.m('mug', 2)).cyl(15, 5, 10, 11, 2.4, p.m('paper', 3));
  return v;
}
export { bush, tree };
