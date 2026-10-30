// What makes an occupied office of the 3D scene its own: draws the plan of ofis-styles.js into the room's static batch (windows, furniture, lamps, candles, a whiteboard in
// the project's colour, a wall of plants, a server rack ...) and runs the light of its lamps and windows. The decisions (which style, what stands where) are in ofis-styles.js,
// the numbers of the light in ofis-light.js; this file only draws.
//
//   const decor = createDecor({ atmosphere })
//   decor.beginBuild()                                    at the start of every rebuild of the building
//   decor.furnish({ B, kit, X, Z, W, D, plan, style, theme, color, rng, top, roomId })     one occupied office, into its Batch
//   decor.furnishVacant({ B, X, Z, W })                   a vacant office: one window with a dark pane (nobody is there, the light is off)
//   decor.finish(group)                                   the three instanced meshes of the building: window panes, bulbs and flames, glows and pools of light
//   decor.update(T, dt)                                   each frame: the lights come on at dusk, flicker a little, the panes follow the sky
//   decor.floorMaterial(pattern)                          the material of a style's floor (a pattern texture times the floor's vertex colours)
//
// No real light is added to the scene: a lamp is an emissive bulb, a glow sprite and a pool of light on the floor (additive), so the cost does not depend on the number of
// rooms (three more draw calls for the whole building) and the shaders do not change when a room is added or selected.
import * as THREE from 'three';
import { makePalette } from './ofis-rig.js';
import { STYLES, MODEL_SIZE, SCALE, paletteSpec, footprint, TONES, DOOR_BACK_W } from './ofis-styles.js';
import { levels, flicker, paneColour, createFollower } from './ofis-light.js';
import { CYCLE } from './motion.js';

const VIEW = new THREE.Vector3(1, 0.9, 1).normalize();              // the camera's direction (ofis.js VIEW): glow sprites face it
const FRAME = { study: '#6b4630', lab: '#e9eef3', garden: '#f3efe6', library: '#3d2a1e', studio: '#fbfaf6', cafe: '#fff4dc' };
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
      const { B, kit, X, Z, plan, style: st, color, rng: r, roomId } = ctx;
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
        const s = it.s ?? SCALE, { pal, pk } = palFor(it), y = it.k === 'rug' ? 0.022 : it.y;
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
      const pane = (wall, a, y, w, h, extra = {}) => build.panes.push({ x: X + (wall === 'n' ? a : 0.03), y, z: Z + (wall === 'n' ? 0.03 : a), ry: wall === 'n' ? 0 : Math.PI / 2, w, h, wall, room: roomId, style: st.id, ...extra });

      for (const it of plan.items) {
        switch (it.k) {
          case 'm': case 'lamp': case 'rug': model(it); break;
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
      for (const l of plan.lights) build.lights.push({ ...l, x: X + l.x, z: Z + l.z, room: roomId, style: st.id });
      build.rooms.set(roomId, { style: st.id, windows: plan.windows.length, lights: plan.lights.length });
    },

    // a vacant office: a window with a dark pane, no light (nobody is there)
    furnishVacant({ B, X, Z, W, door }) {
      const c = Math.min(W - 2.2, 8.4), w = 1.1, h = 0.95, y0 = 1.0, fr = '#e9ecef';
      const b = (x, y, z, ww, hh, d, col) => B.box(X + x, y, Z + z, ww, hh, d, col);
      if (door === 'back' && c + w / 2 > W - 1 - DOOR_BACK_W / 2 - 0.1) return;
      b(c, y0 + h - 0.035, 0.045, w, 0.07, 0.09, fr); b(c, y0 + 0.035, 0.045, w, 0.07, 0.09, fr);
      b(c - w / 2 + 0.035, y0 + h / 2, 0.045, 0.07, h, 0.09, fr); b(c + w / 2 - 0.035, y0 + h / 2, 0.045, 0.07, h, 0.09, fr);
      b(c, y0 + h / 2, 0.05, 0.035, h - 0.14, 0.05, fr);
      build.panes.push({ x: X + c, y: y0 + h / 2, z: Z + 0.03, ry: 0, w: w - 0.1, h: h - 0.1, wall: 'n', room: 'vacant', style: 'vacant', kind: 'dark' });
    },

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

    // each frame (T seconds): follow the sky and the night, set the colour of every bulb, glow, pool and pane; only what changed goes to the GPU
    update(T, dt, force = false) {
      if (!live) return;
      if (dt) follower.step(dt);
      const v = follower.v, k = v[0], reduced = follower.reduced;
      const paneKey = v.map(x => x.toFixed(3)).join();
      if (live.panes && (force || paneKey !== live.paneKey)) {
        live.paneKey = paneKey;
        const cache = new Map();
        live.paneList.forEach((p, i) => {
          if (p.kind === 'dark') _c.setRGB(0.10, 0.13, 0.19, THREE.SRGBColorSpace).multiplyScalar(1 - 0.35 * k);
          else if (p.kind === 'screen') { const lv = levels('screen', k), t = toneColour[p.tone || 'cyan']; _c.copy(t).multiplyScalar(lv.bulb * 0.85); }
          else {
            let c = cache.get(p.style);
            if (!c) cache.set(p.style, c = paneColour(v, STYLES[p.style] && STYLES[p.style].sky));
            _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
          }
          live.panes.setColorAt(i, _c);
        });
        live.panes.instanceColor.needsUpdate = true;
      }
      if (live.bulbs) {
        live.bulbOf.forEach((l, i) => {
          const lv = levels(l.kind, k), f = flicker(T, { kind: l.kind, phase: l.phase, reduced });
          _c.copy(toneColour[l.tone] || toneColour.warm).multiplyScalar(lv.bulb * f);
          live.bulbs.setColorAt(i, _c);
        });
        live.bulbs.instanceColor.needsUpdate = true;
      }
      if (live.glows) {
        live.quads.forEach(({ l, kind }, i) => {
          const lv = levels(l.kind, k), f = flicker(T, { kind: l.kind, phase: l.phase, reduced });
          const amount = kind === 'glow' ? lv.glow * GLOW_GAIN : lv.pool * POOL_GAIN * (l.floorY < 0.1 ? 1 : 0.6);
          _c.copy(toneColour[l.tone] || toneColour.warm).multiplyScalar(amount * f);
          live.glows.setColorAt(i, _c);
        });
        live.glows.instanceColor.needsUpdate = true;
      }
      live.lastK = k;
    },

    // verification only: what the building shows right now
    stats() {
      if (!live) return null;
      const k = follower.k;
      return {
        k: +k.toFixed(3), reduced: follower.reduced,
        panes: live.paneList.length, windows: live.paneList.filter(p => p.kind === 'window').length, screens: live.paneList.filter(p => p.kind === 'screen').length,
        lights: live.lights.length, bulbs: live.bulbs ? live.bulbs.count : 0, glows: live.glows ? live.glows.count : 0,
        rooms: build ? Object.fromEntries([...build.rooms]) : {},
        byRoom: live.lights.reduce((o, l) => { (o[l.room] = o[l.room] || []).push(l.kind); return o; }, {}),
        windowsByRoom: live.paneList.reduce((o, p) => { if (p.kind === 'window') o[p.room] = (o[p.room] || 0) + 1; return o; }, {}),
      };
    },
    // verification only: hide the whole living part (to compare pictures with and without it)
    setVisible(on) { if (!live) return; for (const m of [live.panes, live.bulbs, live.glows]) if (m) m.visible = !!on; },
    get live() { return live; },
    get collected() { return build; },
  };
}
