// What makes an office of the 3D scene its own: draws the plan of ofis-arrange.js into the room's static batch (tables and seats, laptops and monitors, windows, lamps, candles, a
// whiteboard in the project's colour, a wall of plants, a server rack ...) and runs the light of its lamps and windows. A vacant office is drawn from the same plan as an occupied
// one: the furniture is a property of the slot, and the lights are the only difference (off). The decisions (which arrangement and style, what stands where) are in ofis-arrange.js
// and ofis-styles.js, the numbers of the light in ofis-light.js; this file only draws.
//
//   const decor = createDecor({ atmosphere })
//   decor.beginBuild()                                    at the start of every rebuild of the building
//   decor.furnish({ B, kit, X, Z, W, D, plan, style, theme, color, rng, roomId, slot, screens })     one office, into its Batch (screens(desc) gets every monitor and laptop screen)
//   decor.setLit(slot, on, instant)                       the light of a slot's room: on while a chat is in it (a vacant office is furnished the same, with the lights off)
//   decor.finish(group)                                   the three instanced meshes of the building: window panes, bulbs and flames, glows and pools of light
//   decor.update(T, dt)                                   each frame: the lights come on at dusk, flicker a little, the panes follow the sky
//   decor.floorMaterial(pattern)                          the material of a style's floor (a pattern texture times the floor's vertex colours)
//
// No real light is added to the scene: a lamp is an emissive bulb, a glow sprite and a pool of light on the floor (additive), so the cost does not depend on the number of
// rooms (three more draw calls for the whole building) and the shaders do not change when a room is added or selected.
import * as THREE from 'three';
import { makePalette } from './ofis-rig.js';
import { STYLES, MODEL_SIZE, SCALE, paletteSpec, footprint, TONES, shadeHex } from './ofis-styles.js';
import { levels, flicker, paneColour, createFollower, createSwitches } from './ofis-light.js';
import { rot } from './ofis-geom.js';
import { CYCLE } from './motion.js';

const VIEW = new THREE.Vector3(1, 0.9, 1).normalize();              // the camera's direction (ofis.js VIEW): glow sprites face it
const FRAME = { study: '#6b4630', lab: '#e9eef3', garden: '#f3efe6', library: '#3d2a1e', studio: '#fbfaf6', cafe: '#fff4dc' };
const lumOf = hex => { const n = parseInt(hex.slice(1, 7), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
// A table has to read against the floor it stands on: a wood about as light as the floor is lifted on a dark floor and darkened on a light one, until the two differ by `gap` in lightness.
export function against(col, floor, gap = 0.2) {
  const up = lumOf(floor) < 0.5;
  for (let t = 0; t <= 0.6; t += 0.05) { const c = t ? shadeHex(col, up ? t : -t) : col; if (Math.abs(lumOf(c) - lumOf(floor)) >= gap) return c; }
  return shadeHex(col, up ? 0.6 : -0.6);
}
const GLOW_GAIN = 0.8, POOL_GAIN = 0.55;                            // how much of a tone's colour a glow and a pool add at full night

// ------------------------------------------------------------ floor patterns (grey, multiplied with the floor's vertex colours)

export const FLOOR_TILE = 1.2;                                      // metres one pattern texture covers
function rnd(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const grey = (g, v) => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); g.fillStyle = `rgb(${c},${c},${c})`; };
const PATTERNS = {
  planks(g, S) {                                                    // 4 planks of 0.3 m across, each with its own tone and a butt joint
    const r = rnd(21), pw = S / 4;
    for (let i = 0; i < 4; i++) {
      let y = 0;
      while (y < S) {
        const len = S * (0.35 + r() * 0.5);
        grey(g, 0.84 + r() * 0.16); g.fillRect(i * pw, y, pw, Math.min(len, S - y));
        grey(g, 0.6); g.fillRect(i * pw, y, pw, 2);
        y += len;
      }
      grey(g, 0.62); g.fillRect(i * pw, 0, 2, S);
    }
  },
  tile(g, S) {                                                      // 2 x 2 tiles of 0.6 m with grout
    const r = rnd(33), n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { grey(g, 0.9 + r() * 0.1); g.fillRect(i * t, j * t, t, t); }
    grey(g, 0.6);
    for (let i = 0; i < n; i++) { g.fillRect(i * t, 0, 3, S); g.fillRect(0, i * t, S, 3); }
  },
  checker(g, S) {                                                   // 2 x 2 squares of 0.6 m, one a shade darker than the other (the floor's own colour does the rest)
    const n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { grey(g, (i + j) % 2 ? 0.62 : 1); g.fillRect(i * t, j * t, t, t); }
  },
  grass(g, S) {                                                     // soft blotches, and a few light flecks
    const r = rnd(5);
    grey(g, 0.94); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) { grey(g, 0.84 + r() * 0.16); g.beginPath(); g.arc(r() * S, r() * S, 4 + r() * 16, 0, 7); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1; }
    for (let i = 0; i < 40; i++) { grey(g, 1); g.fillRect(r() * S, r() * S, 2, 3); }
  },
  parquet(g, S) {                                                   // basket weave: 0.6 m blocks of two planks, turning from block to block
    const r = rnd(8), n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const horiz = (i + j) % 2 === 0;
      for (let k = 0; k < 2; k++) {
        grey(g, 0.82 + r() * 0.18);
        if (horiz) g.fillRect(i * t, j * t + k * t / 2, t, t / 2); else g.fillRect(i * t + k * t / 2, j * t, t / 2, t);
        grey(g, 0.58);
        if (horiz) g.fillRect(i * t, j * t + k * t / 2, t, 2); else g.fillRect(i * t + k * t / 2, j * t, 2, t);
      }
    }
  },
};

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(255,255,255,.55)'); rg.addColorStop(0.65, 'rgba(255,255,255,.14)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// ------------------------------------------------------------ the decor

export function createDecor({ atmosphere, aniso = 4 } = {}) {
  const follower = createFollower({ atmosphere, turnMs: CYCLE.turn });
  const switches = createSwitches();                                 // the light of every slot's room (0..1), kept across rebuilds of the building
  const palettes = new Map(), floorMats = new Map(), floorTex = new Map();
  const toneColour = {};
  for (const [k, hex] of Object.entries(TONES)) toneColour[k] = new THREE.Color(hex);
  const quat = (() => {                                              // a flat quad's normal toward the camera
    const z = VIEW.clone(), x = new THREE.Vector3(0, 1, 0).cross(z).normalize(), y = z.clone().cross(x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  })();
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();

  let build = null;                                                  // what this rebuild collected: { panes, lights }
  let live = null;                                                   // the meshes of the building as built: { panes, bulbs, glows, ... }

  const stylePal = (st, role) => {
    const k = st.id + ':' + role;
    let p = palettes.get(k);
    if (!p) palettes.set(k, p = makePalette(paletteSpec(st, role)));
    return p;
  };

  return {
    follower,
    floorMaterial(pattern) {
      if (!PATTERNS[pattern]) return null;
      let m = floorMats.get(pattern);
      if (!m) {
        const S = 256, cv = document.createElement('canvas');
        cv.width = cv.height = S;
        PATTERNS[pattern](cv.getContext('2d'), S);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        floorTex.set(pattern, t);
        floorMats.set(pattern, m = new THREE.MeshLambertMaterial({ vertexColors: true, map: t }));
      }
      return m;
    },
    beginBuild() { build = { panes: [], lights: [], rooms: new Map() }; },

    // one occupied office. ctx: { B (the Batch), kit ({ GEO, PAL, PK, AS, POSTERS, BOOKS, POLISH, shade }), X, Z, W, D, plan, style, theme, color (the chat's colour), rng, top (chief desk height), roomId }
    furnish(ctx) {
      const { B, kit, X, Z, plan, style: st, theme, color, rng: r, roomId, slot, screens } = ctx;
      const { GEO, PAL, PK, AS, POSTERS, BOOKS, shade } = kit;
      const b = (x, y, z, w, h, d, col, ry) => B.box(X + x, y, Z + z, w, h, d, col, ry);
      const pt = (geo, x, y, z, sx, sy, sz, col, ry, rx, rz) => B.put(geo, X + x, y, Z + z, sx, sy, sz, col, ry, rx, rz);
      const frame = FRAME[st.id] || '#f3efe6';
      const palFor = it => {
        if (it.m === 'pottedPlant') return { pal: PAL.pottedFloor, pk: 'pf' };
        if (it.m === 'plantSmall2' || it.m === 'plantSmall3') return it.y > 0.3 ? { pal: PAL.potDesk, pk: 'desk' } : { pal: PAL.potFloor, pk: 'floor' };
        const role = it.role || 'fabric';
        return { pal: stylePal(st, role), pk: st.id + role };
      };
      // a pack model, or a box of its size when the file is not there
      const model = it => {
        const s = it.s ?? SCALE, { pal, pk } = palFor(it), y = it.k === 'rug' ? 0.022 : it.y || 0;
        if (B.model(it.m, X + it.x, y, Z + it.z, { ry: it.ry || 0, s, pal, pk })) return;
        const [w, d] = footprint(it), h = MODEL_SIZE[it.m][1] * s;
        if (it.k === 'rug') b(it.x, 0.018, it.z, w, 0.012, d, st.pack.fabric);
        else if (it.k === 'lamp') { b(it.x, y + h / 2, it.z, 0.04, h, 0.04, st.pack.metal); b(it.x, y + h * 0.86, it.z, w * 1.7, h * 0.28, d * 1.7, st.pack.shade); }
        else {
          const col = /sofa|chair|bench|stool|pillow/i.test(it.m) ? st.pack.fabric : /plant/i.test(it.m) ? '#5f9a5a' : st.pack.wood;
          b(it.x, y + h / 2, it.z, w, h, d, col, it.ry || 0);
        }
      };
      // a box of a wall piece: a = along the wall, y, t = out of the wall, along / h / thick = its sizes; wall 'n' (z = 0) or 'w' (x = 0)
      const wbox = (wall, a, y, t, along, h, thick, col) => (wall === 'n' ? b(a, y, t, along, h, thick, col) : b(t, y, a, thick, h, along, col));
      const pane = (wall, a, y, w, h, extra = {}) => build.panes.push({ x: X + (wall === 'n' ? a : 0.03), y, z: Z + (wall === 'n' ? 0.03 : a), ry: wall === 'n' ? 0 : Math.PI / 2, w, h, wall, room: roomId, slot, style: st.id, ...extra });
      const rb = (x, y, z, w, h, d, rr, col, ry) => B.rbox(X + x, y, Z + z, w, h, d, rr, col, ry);
      const tris0 = B.i.length / 3;

      for (const it of plan.items) {
        switch (it.k) {
          case 'm': case 'lamp': case 'rug': model(it); break;
          case 'table': {                                            // a table the pack has no model for: a rounded slab on legs of its own kind (ofis-arrange.js)
            const col = against(st.pack.wood, theme.floor), leg = shade(st.pack.metal, -0.28), top = it.h, ry = it.ry || 0, under = shade(col, -0.3);
            const at = (lx, lz) => { const [dx, dz] = rot(lx, lz, ry); return [it.x + dx, it.z + dz]; };
            if (it.shape === 'ell') {
              pt(GEO.cyl, it.x, top - 0.025, it.z, it.w, 0.05, it.d, col, ry);
              pt(GEO.cyl, it.x, top - 0.06, it.z, it.w - 0.08, 0.025, it.d - 0.08, under, ry);
              for (const sg of [-1, 1]) {
                const [px, pz] = at(sg * it.w * 0.2, 0);
                pt(GEO.cyl, px, (top - 0.08) / 2, pz, 0.14, top - 0.08, 0.14, leg);
                pt(GEO.cyl, px, 0.02, pz, 0.62, 0.04, 0.5, leg, ry);
              }
            } else {
              rb(it.x, top - 0.025, it.z, it.w, 0.05, it.d, 0.02, col, ry);
              b(it.x, top - 0.062, it.z, it.w - 0.08, 0.025, it.d - 0.08, under, ry);
              if (it.legs === 'bar') {                              // two posts on a foot rail
                for (const sg of [-1, 1]) { const [px, pz] = at(sg * (it.w / 2 - 0.45), 0); pt(GEO.cyl, px, (top - 0.05) / 2, pz, 0.1, top - 0.05, 0.1, leg); pt(GEO.cyl, px, 0.02, pz, 0.5, 0.04, 0.5, leg); }
                b(it.x, 0.22, it.z + 0, it.w - 0.9, 0.035, 0.035, shade(leg, 0.2), ry);
              } else {                                              // trestle: an end panel on each side and a stretcher
                for (const sg of [-1, 1]) { const [px, pz] = at(sg * (it.w / 2 - 0.12), 0); b(px, (top - 0.05) / 2, pz, 0.055, top - 0.05, it.d - 0.16, leg, ry); }
                b(it.x, top * 0.35, it.z, it.w - 0.3, 0.04, 0.05, leg, ry);
              }
            }
            break;
          }
          case 'set': {                                              // a laptop, or a monitor with its keyboard and mouse, in front of a seat; `seat` is its seat's id (undefined: nobody uses that seat)
            const ry = it.ry, fx = Math.sin(ry), fz = Math.cos(ry), seat = it.seat, kind = seat === 'chef' ? 'chef' : 'slot', idx = seat === 'chef' ? 0 : (seat == null ? -1 : seat);
            const rq = ry - Math.PI / 2, nx = Math.cos(rq), nz = -Math.sin(rq);          // the screen's normal, toward the person
            if (it.kind === 'laptop') {
              const s = it.s;
              model({ k: 'm', m: 'laptop', x: it.x, z: it.z, y: it.y, ry, s, role: 'fabric' });
              if (screens) screens({ x: X + it.x - 0.075 * s * fx + nx * 0.006, y: it.y + 0.0875 * s, z: Z + it.z - 0.075 * s * fz + nz * 0.006, ry: rq, rx: -0.42, w: 0.2 * s, h: 0.115 * s, kind, slot: idx });
            } else {
              const sc = it.w / 0.379, top = it.y;
              if (B.model('screen', X + it.x, top, Z + it.z, { ry, s: sc })) {
                if (screens) screens({ x: X + it.x + nx * (0.016 * sc + 0.004), y: top + 0.1715 * sc, z: Z + it.z + nz * (0.016 * sc + 0.004), ry: rq, rx: -0.1, w: 0.355 * sc, h: 0.21 * sc, kind, slot: idx });
              } else {
                b(it.x, top + 0.02, it.z, 0.2, 0.02, 0.24, st.pack.metal, ry);
                b(it.x - nx * 0.02, top + 0.13, it.z - nz * 0.02, 0.04, 0.22, 0.05, st.pack.metal, ry);
                b(it.x, top + 0.31, it.z, 0.05, 0.38, it.w, '#2a2f3a', ry);
                if (screens) screens({ x: X + it.x + nx * 0.027, y: top + 0.31, z: Z + it.z + nz * 0.027, ry: rq, w: it.w - 0.06, h: 0.32, kind, slot: idx });
              }
              const kx = it.x + fx * 0.3, kz = it.z + fz * 0.3;
              if (B.model('keyboard', X + kx, top, Z + kz, { ry, s: 1.4 })) B.model('mouse', X + kx + Math.cos(ry) * 0.27 + fx * 0.02, top, Z + kz - Math.sin(ry) * 0.27 + fz * 0.02, { ry, s: 1.4 });
              else b(kx, top + 0.012, kz, 0.4, 0.022, 0.15, '#e8ebf0', ry);
            }
            break;
          }
          case 'cluster': {                                          // the coffee corner: a fridge, and a cabinet with a coffee machine on it, along the west wall
            const ry = Math.PI / 2;
            model({ k: 'm', m: 'kitchenFridgeSmall', x: 0.3, z: it.z - 0.42, y: 0, ry, s: 1.6, role: 'fabric' });
            model({ k: 'm', m: 'kitchenCabinet', x: 0.42, z: it.z + 0.5, y: 0, ry, s: 1.6, role: 'fabric' });
            model({ k: 'm', m: 'kitchenCoffeeMachine', x: 0.42, z: it.z + 0.5, y: 0.72, ry, s: 1.5, role: 'fabric' });
            break;
          }
          case 'candle': {
            for (let i = 0; i < it.n; i++) {
              const off = it.n === 1 ? 0 : -it.spread / 2 + i * it.spread / (it.n - 1);
              b(it.x, it.y + 0.05, it.z + off, 0.04, 0.1, 0.04, '#f4ecd8');
              b(it.x, it.y + 0.005, it.z + off, 0.1, 0.012, 0.1, shade(st.pack.metal, -0.1));
            }
            break;
          }
          case 'bulbs': {
            const n = it.n;
            for (let i = 0; i < n - 1; i++) {
              const t0 = i / (n - 1), t1 = (i + 1) / (n - 1), sg = t => Math.sin(t * Math.PI) * it.sag;
              const x0 = it.a[0] + (it.b[0] - it.a[0]) * t0, x1 = it.a[0] + (it.b[0] - it.a[0]) * t1;
              const y0 = it.a[1] - sg(t0), y1 = it.a[1] - sg(t1);
              pt(GEO.unit, (x0 + x1) / 2, (y0 + y1) / 2, it.a[2], Math.hypot(x1 - x0, y1 - y0) + 0.01, 0.012, 0.012, '#3a3f4a', 0, 0, Math.atan2(y1 - y0, x1 - x0));
            }
            break;
          }
          case 'win': {
            const w = it.w, h = it.h, c = it.c, y0 = it.y0;
            wbox(it.wall, c, y0 + h - 0.035, 0.045, w, 0.07, 0.09, frame);
            wbox(it.wall, c, y0 + 0.035, 0.045, w, 0.07, 0.09, frame);
            wbox(it.wall, c - w / 2 + 0.035, y0 + h / 2, 0.045, 0.07, h, 0.09, frame);
            wbox(it.wall, c + w / 2 - 0.035, y0 + h / 2, 0.045, 0.07, h, 0.09, frame);
            const bars = Math.max(1, Math.round(w / 1.1) - 1);
            for (let i = 0; i < bars; i++) wbox(it.wall, c + (i + 1 - (bars + 1) / 2) * w / (bars + 1), y0 + h / 2, 0.05, 0.035, h - 0.14, 0.05, frame);
            wbox(it.wall, c, y0 + h / 2, 0.05, w - 0.14, 0.035, 0.05, frame);
            wbox(it.wall, c, y0 - 0.02, 0.1, w + 0.18, 0.045, 0.2, shade(frame, -0.06));
            if (it.curtain) {
              for (const sg of [-1, 1]) wbox(it.wall, c + sg * (w / 2 + 0.14), y0 + h / 2 + 0.06, 0.09, 0.26, h + 0.34, 0.1, it.curtain);
              wbox(it.wall, c, y0 + h + 0.2, 0.1, w + 0.7, 0.025, 0.025, '#4a3a2a');
            }
            pane(it.wall, c, y0 + h / 2, w - 0.1, h - 0.1, { kind: 'window' });
            break;
          }
          case 'screen': {
            const sw = it.w, sh = it.h;
            wbox(it.wall, it.c, it.y, 0.03, sw + 0.1, sh + 0.1, 0.05, '#1d222c');
            pane(it.wall, it.c, it.y, sw, sh, { kind: 'screen', tone: it.tone });
            break;
          }
          case 'wb': {
            const w = it.w || 1.6, wall = it.wall, c = it.c, yc = it.y != null ? it.y : 1.44;
            wbox(wall, c, yc, 0.03, w, 0.76, 0.04, '#c9ced7');
            wbox(wall, c, yc, 0.055, w - 0.1, 0.68, 0.02, '#fbfbfd');
            wbox(wall, c, yc - 0.37, 0.08, w - 0.4, 0.03, 0.06, '#b7bcc7');
            wbox(wall, c, yc + 0.3, 0.068, w - 0.14, 0.08, 0.012, color || '#5b9bd5');             // the project's colour along the top
            const ink = ['#3b6fd1', '#d8484a', '#2f9e6a'];
            for (let i = 0; i < 3; i++) {
              const len = 0.3 + r() * (w - 0.8) * 0.8;
              wbox(wall, c - w / 2 + 0.2 + len / 2, yc + 0.12 - i * 0.12, 0.068, len, 0.024, 0.01, ink[i % 3]);
            }
            if (it.menu) for (let i = 0; i < 3; i++) wbox(wall, c + w / 2 - 0.3, yc + 0.12 - i * 0.12, 0.068, 0.2, 0.024, 0.01, '#e8a33d');
            else {
              const notes = ['#ffd766', '#ff9fb2', '#8fd3ff', '#b5ec8e'];
              for (let i = 0; i < 3; i++) wbox(wall, c + w / 2 - 0.2 - (i & 1) * 0.2, yc - 0.03 - (i >> 1) * 0.2, 0.068, 0.14, 0.14, 0.01, notes[(i + (r() * 4 | 0)) % 4]);
            }
            break;
          }
          case 'pics': {
            for (let i = 0; i < it.n; i++) {
              const a = it.c + (i - (it.n - 1) / 2) * 0.5, bg = POSTERS[(r() * POSTERS.length) | 0], fg = POSTERS[(r() * POSTERS.length) | 0], hh = 0.5 + (i % 2) * 0.12;
              wbox(it.wall, a, 1.58, 0.03, 0.42, hh, 0.04, '#2d313b');
              wbox(it.wall, a, 1.58, 0.052, 0.35, hh - 0.07, 0.01, bg);
              wbox(it.wall, a, 1.52, 0.06, 0.2, 0.1, 0.008, shade(fg, 0.2));
            }
            break;
          }
          case 'clock': {
            const x = it.c;
            pt(GEO.cyl, x, 1.55, 0.035, 0.38, 0.04, 0.38, '#2d313b', 0, Math.PI / 2);
            pt(GEO.cyl, x, 1.55, 0.058, 0.32, 0.01, 0.32, '#fbfbf7', 0, Math.PI / 2);
            b(x, 1.6, 0.066, 0.018, 0.1, 0.006, '#23252d');
            b(x + 0.04, 1.55, 0.066, 0.08, 0.016, 0.006, '#23252d');
            break;
          }
          case 'sconce': {                                           // a bracket and an open shade; the bulb is in front of it
            wbox(it.wall, it.c, it.y, 0.045, 0.08, 0.28, 0.09, st.pack.metal);
            wbox(it.wall, it.c, it.y - 0.05, 0.14, 0.2, 0.12, 0.2, shade(st.pack.shade, -0.12));
            break;
          }
          case 'shelf': {                                            // the bookshelf (the pack's, stretched) and its books
            const bz = it.z;
            let rows = [0, 1, 2].map(k => ({ y: 0.05 + k * 0.515, gap: 0.5 }));
            const pk = st.id + 'shelf';
            if (B.model('shelf', X + 0.19, 0, Z + bz, { ry: Math.PI / 2, fx: 1.375, fy: 2.025, fz: 1.44, pal: stylePal(st, 'fabric'), pk })) {
              const tops = AS.boardTops(AS.bake(PK.shelf, stylePal(st, 'fabric'), pk).geo).map(y => y * 2.025);
              if (tops.length >= 2) rows = tops.slice(0, -1).map((y, i) => ({ y, gap: tops[i + 1] - y }));
            } else {
              b(0.03, 0.8, bz, 0.04, 1.6, 1.1, st.pack.wood);
              b(0.2, 0.8, bz - 0.53, 0.36, 1.6, 0.04, st.pack.wood);
              b(0.2, 0.8, bz + 0.53, 0.36, 1.6, 0.04, st.pack.wood);
              for (const y of [0.03, 0.54, 1.06, 1.58]) b(0.2, y, bz, 0.36, 0.04, 1.1, st.pack.wood);
            }
            for (const row of rows) {
              let z = bz - 0.49;
              while (z < bz + 0.45) {
                const bw = 0.05 + r() * 0.05, bh = Math.min(0.26 + r() * 0.14, row.gap - 0.08);
                if (r() < 0.12) { z += 0.08; continue; }
                b(0.19, row.y + bh / 2, z + bw / 2, 0.24, bh, bw, BOOKS[(r() * BOOKS.length) | 0]);
                z += bw + 0.008;
              }
            }
            break;
          }
          case 'plantwall': {                                        // boards on the west wall with pots and leaves
            for (let lv = 0; lv < 3; lv++) {
              const y = 0.55 + lv * 0.5;
              b(0.2, y, it.z, 0.34, 0.04, 1.3, st.pack.wood);
              b(0.06, y - 0.12, it.z - 0.55, 0.04, 0.2, 0.04, st.pack.metal); b(0.06, y - 0.12, it.z + 0.55, 0.04, 0.2, 0.04, st.pack.metal);
              for (let k = 0; k < 3; k++) {
                const z = it.z - 0.42 + k * 0.42, key = (lv + k) % 2 ? 'plantSmall2' : 'plantSmall3';
                if (!B.model(key, X + 0.2, y + 0.02, Z + z, { s: 1.5, ry: r() * 6, pal: PAL.potFloor, pk: 'floor' })) {
                  pt(GEO.pot, 0.2, y + 0.1, z, 0.14, 0.14, 0.14, '#c8704a');
                  pt(GEO.ico, 0.2, y + 0.25, z, 0.22, 0.2, 0.22, '#5aa85a', r() * 3);
                }
              }
              for (const dz of [-0.5, 0.45]) pt(GEO.ico, 0.22, y - 0.1, it.z + dz, 0.2, 0.26, 0.2, '#63b25c', r() * 3);
            }
            break;
          }
          case 'rack': {
            b(it.x, 0.875, it.z, 0.55, 1.75, 0.75, '#262b35');
            b(it.x + 0.285, 0.875, it.z, 0.02, 1.62, 0.68, '#39404f');
            for (let i = 0; i < 6; i++) b(it.x + 0.3, 0.3 + i * 0.22, it.z - 0.08, 0.012, 0.07, 0.5, '#171a21');
            b(it.x, 1.77, it.z, 0.57, 0.03, 0.77, '#4a505d');
            break;
          }
          case 'printer': {
            b(it.x, 0.34, it.z, 0.5, 0.68, 0.56, '#d9d2c3');
            b(it.x, 0.8, it.z, 0.46, 0.2, 0.5, '#e9edf2');
            b(it.x, 0.915, it.z, 0.44, 0.03, 0.48, '#c9ced7');
            b(it.x + 0.28, 0.74, it.z, 0.14, 0.02, 0.36, '#ffffff');
            b(it.x + 0.2, 0.7, it.z - 0.12, 0.012, 0.012, 0.1, '#2f9e6a');
            break;
          }
          default: break;
        }
      }
      // the light sources of the plan, in the building's coordinates
      for (const l of plan.lights) build.lights.push({ ...l, x: X + l.x, z: Z + l.z, room: roomId, slot, style: st.id });
      // verification only: what this office drew (the plan's items by kind, model and place, a hash of them, the triangles it added): a vacant office and the same slot occupied must match
      const drawn = plan.items.map(it => [it.k, it.m || it.shape || it.kind || '', +(it.x || 0).toFixed(2), +(it.z || 0).toFixed(2), +(it.ry || 0).toFixed(2), it.seat == null ? '' : it.seat].join(':'));
      let h = 0x811c9dc5;
      for (const ch of drawn.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
      build.rooms.set(roomId, { style: st.id, slot, windows: plan.windows.length, lights: plan.lights.length, items: drawn.length, sig: h.toString(16), tris: B.i.length / 3 - tris0, models: [...new Set(plan.items.map(i => i.m).filter(Boolean))].sort(), arrangement: plan.look ? plan.look.work + '+' + plan.look.soft : null });
    },

    // the light of a slot's room: on while a chat is in it, off while nobody is (ofis.js lightsFor). The number eases over SWITCH_MS (ofis-light.js createSwitches)
    setLit(slot, on, instant = false) { switches.set(slot, on, performance.now(), instant || follower.reduced); },
    litOf: slot => switches.get(slot),
    get switches() { return switches; },

    // the three instanced meshes of the building (panes, bulbs and flames, glows and pools): one draw call each
    finish(g) {
      const { panes, lights } = build;
      const out = { panes: null, bulbs: null, glows: null, lights: [], poolAt: [], paneList: panes, builtAt: performance.now() };
      const own = (mesh, ...parts) => { mesh.frustumCulled = false; mesh.userData.dispose = () => { parts.forEach(p => p.dispose()); mesh.dispose(); }; g.add(mesh); return mesh; };
      if (panes.length) {
        const geo = new THREE.PlaneGeometry(1, 1), mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const im = new THREE.InstancedMesh(geo, mat, panes.length);
        panes.forEach((p, i) => {
          _q.setFromEuler(_e.set(0, p.ry, 0));
          im.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.w, p.h, 1)));
          im.setColorAt(i, _c.set('#000000'));
        });
        im.instanceMatrix.needsUpdate = true;
        out.panes = own(im, geo, mat);
        out.paneKey = '';
      }
      // bulbs and flames: a small low-poly ball per source that shows itself (a lamp's bulb is inside its shade; the glow does the rest)
      const showers = lights.filter(l => l.kind !== 'screen');
      if (showers.length) {
        const geo = new THREE.IcosahedronGeometry(1, 1), mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const im = new THREE.InstancedMesh(geo, mat, showers.length);
        showers.forEach((l, i) => {
          const rad = l.kind === 'candle' ? 0.03 : l.kind === 'sconce' ? 0.07 : l.kind === 'led' ? 0.022 : l.kind === 'bulb' ? 0.045 : 0.06;
          im.setMatrixAt(i, _m.compose(_p.set(l.x, l.y, l.z), _q.identity(), _s.set(rad, rad * (l.kind === 'candle' ? 1.7 : 1), rad)));
          im.setColorAt(i, _c.set('#000000'));
        });
        im.instanceMatrix.needsUpdate = true;
        out.bulbs = own(im, geo, mat);
        out.bulbOf = showers;
      }
      // glows (a sprite that faces the camera) and pools (flat on the floor, or on the table the source stands on)
      const quads = [];
      for (const l of lights) {
        quads.push({ l, kind: 'glow' });
        if (l.pool > 0) quads.push({ l, kind: 'pool' });
      }
      if (quads.length) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const im = new THREE.InstancedMesh(geo, mat, quads.length);
        im.renderOrder = 6;
        quads.forEach(({ l, kind }, i) => {
          if (kind === 'glow') {
            const k = l.kind === 'screen' ? 1.0 : 1;
            im.setMatrixAt(i, _m.compose(_p.set(l.x, l.y, l.z).addScaledVector(VIEW, 0.14), quat, _s.set(l.r * 2 * k, l.r * 2 * k, 1)));
          } else {
            const onFloor = l.floorY < 0.1;
            const s = l.pool * 2 * (onFloor ? 1 : 0.8);
            im.setMatrixAt(i, _m.compose(_p.set(l.x, onFloor ? 0.03 : l.floorY + 0.012, l.z), flat, _s.set(s, s, 1)));
          }
          im.setColorAt(i, _c.set('#000000'));
        });
        im.instanceMatrix.needsUpdate = true;
        out.glows = own(im, geo, mat);
        out.quads = quads;
      }
      out.lights = lights;
      live = out;
      live.lastK = -1; live.lastKey = '';
      this.update(performance.now() / 1000, 0, true);
    },

    // each frame (T seconds): follow the sky and the night and the switch of every room, set the colour of every bulb, glow, pool and pane; only what changed goes to the GPU
    update(T, dt, force = false) {
      if (!live) return;
      if (dt) follower.step(dt);
      const moved = switches.step(performance.now());
      const v = follower.v, k = v[0], reduced = follower.reduced;
      const paneKey = v.map(x => x.toFixed(3)).join() + '|' + switches.key();
      const lit = slot => switches.get(slot);
      if (live.panes && (force || paneKey !== live.paneKey)) {
        live.paneKey = paneKey;
        const cache = new Map();
        live.paneList.forEach((p, i) => {
          const pw = lit(p.slot);
          if (p.kind === 'screen') { const lv = levels('screen', k), t = toneColour[p.tone || 'cyan']; _c.copy(t).multiplyScalar(lv.bulb * 0.85 * pw); }
          else {
            const ck = p.style + ':' + pw.toFixed(3);
            let c = cache.get(ck);
            if (!c) cache.set(ck, c = paneColour(v, STYLES[p.style] && STYLES[p.style].sky, pw));
            _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
          }
          live.panes.setColorAt(i, _c);
        });
        live.panes.instanceColor.needsUpdate = true;
      }
      if (live.bulbs) {
        live.bulbOf.forEach((l, i) => {
          const pw = lit(l.slot), lv = levels(l.kind, k), f = pw > 0 ? flicker(T, { kind: l.kind, phase: l.phase, reduced }) : 1;
          _c.copy(toneColour[l.tone] || toneColour.warm).multiplyScalar(lv.bulb * f * pw);
          live.bulbs.setColorAt(i, _c);
        });
        live.bulbs.instanceColor.needsUpdate = true;
      }
      if (live.glows) {
        live.quads.forEach(({ l, kind }, i) => {
          const pw = lit(l.slot), lv = levels(l.kind, k), f = pw > 0 ? flicker(T, { kind: l.kind, phase: l.phase, reduced }) : 1;
          const amount = kind === 'glow' ? lv.glow * GLOW_GAIN : lv.pool * POOL_GAIN * (l.floorY < 0.1 ? 1 : 0.6);
          _c.copy(toneColour[l.tone] || toneColour.warm).multiplyScalar(amount * f * pw);
          live.glows.setColorAt(i, _c);
        });
        live.glows.instanceColor.needsUpdate = true;
      }
      live.lastK = k;
      return moved;
    },

    // verification only: what the building shows right now
    stats() {
      if (!live) return null;
      const k = follower.k;
      return {
        k: +k.toFixed(3), reduced: follower.reduced,
        lit: Object.fromEntries([...new Set(live.lights.map(l => l.slot))].map(sl => [sl, +switches.get(sl).toFixed(3)])),
        litTarget: Object.fromEntries([...new Set(live.lights.map(l => l.slot))].map(sl => [sl, switches.target(sl)])),
        panes: live.paneList.length, windows: live.paneList.filter(p => p.kind === 'window').length, screens: live.paneList.filter(p => p.kind === 'screen').length,
        lights: live.lights.length, bulbs: live.bulbs ? live.bulbs.count : 0, glows: live.glows ? live.glows.count : 0,
        rooms: build ? Object.fromEntries([...build.rooms]) : {},
        byRoom: live.lights.reduce((o, l) => { (o[l.room] = o[l.room] || []).push(l.kind); return o; }, {}),
        windowsByRoom: live.paneList.reduce((o, p) => { if (p.kind === 'window') o[p.room] = (o[p.room] || 0) + 1; return o; }, {}),
        // what each room's first lamp and first window show now (the colour that went to the GPU), and where the lamp stands: the QA reads them next to the picture
        lampAt: live.lights.reduce((o, l) => { if (l.kind === 'lamp' && !o[l.room]) o[l.room] = { x: l.x, y: l.y, z: l.z }; return o; }, {}),
        lampGlow: live.quads ? live.quads.reduce((o, { l, kind }, i) => {
          if (l.kind === 'lamp' && kind === 'glow' && !(l.room in o)) { const a = live.glows.instanceColor.array; o[l.room] = +Math.max(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]).toFixed(4); }
          return o;
        }, {}) : {},
        paneRGB: live.panes ? live.paneList.reduce((o, p, i) => {
          if (p.kind === 'window' && !o[p.room]) { const a = live.panes.instanceColor.array; o[p.room] = [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]].map(v => +v.toFixed(3)); }
          return o;
        }, {}) : {},
        glowNow: live.quads ? live.quads.map((q, i) => { const a = live.glows.instanceColor.array; return Math.max(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); }) : [],
        glowKinds: live.quads ? live.quads.map(q => q.l.kind + ':' + q.kind) : [],
      };
    },
    // verification only: hide the living part (to compare pictures with and without it): all of it, or only the panes, or only the lights (bulbs, flames, glows and pools)
    setVisible(on, part) {
      if (!live) return;
      const parts = part === 'panes' ? [live.panes] : part === 'lights' ? [live.bulbs, live.glows] : [live.panes, live.bulbs, live.glows];
      for (const m of parts) if (m) m.visible = !!on;
    },
    get live() { return live; },
    get collected() { return build; },
  };
}
