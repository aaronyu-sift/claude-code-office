// Office: a 3D isometric office in the spirit of Game Dev Tycoon.
// Every live session is a room; the main agent is the room's chief, subagents are the staff at the desks.
// The scene is drawn with three.js. Signs, name tags and balloons live in an HTML layer so they stay crisp.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { catColor, hash, esc, icon, fmtShort } from './util.js';
import { t as msg } from './i18n.js';
import { labelParts, labelHtml } from './office-labels.js';
import { createEnv } from './ofis-env.js';
import { createDecor } from './ofis-decor.js';
import { STYLE_IDS, assignStyles, neighbourMap, planRoom, styleAt, wallColour, floorColour } from './ofis-styles.js';
import { createAtmosphere } from './office-atmosphere.js';
import { createOfficeSettings, officeQuery } from './office-settings.js';
import { LOOP, wave } from './motion.js';
import { createOfisUi } from './ofis-ui.js';
import { layoutLabels } from './ofis-label-layout.js';
import * as AS from './ofis-assets.js';
import * as PL from './ofis-polish.js';
import { makePalette, PALETTES, chooseOutfit, poseBones } from './ofis-rig.js';
import { isShelved } from './pixel/shelf.js';
import { WALK, STAND_S, TURN_S, arrivalPlan, pathLength, stepWalk, turnBack, repath, routeSig } from './ofis-arrive.js';
import {
  WALL_T, ROOM_D, CHEF_W, COL_W, FRONT_M, GAP, HALL_D, HALL_GAP, PLINTH_M, COLS, CAP, roomW,
  VACANT_CLS, minRoomsFrom, buildingPlan, classFor, nextClass, createSlots,
} from './ofis-layout.js';
import { boardName, boardProject, boardBadges, fitName } from './board-text.js';
import { projectOn, onProjectChange } from './board-setting.js';

// Models (ofis-assets.js has loaded them before this module runs): a piece that did not load is missing from PK and the procedural shape
// below is drawn in its place. POLISH is the procedural polish: occlusion baked into the room batch, a noise floor, tone mapping, contact
// shadows and the extra detail of the procedural pieces (drawers, five-star chairs, keys, ears and shoes).
const PK = AS.packs.models;
const POLISH = AS.look.polish;
const PAL = Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, makePalette(v)]));

// ------------------------------------------------------------ dimensions (1 unit ≈ 1 meter)

const WALL_H = 2.2, LOW_H = 0.3;
const SIGN_H = 1.24, SIGN_Y = 1.5;       // room sign on the wall (center height)
const SIGN_HTML_BELOW = 19;               // below this zoom, an HTML fallback sign replaces the wall text
const SUB_LABEL_REACH = 70;               // px a sub-agent's label may be from its agent: farther away it would read as another agent's
const SIGN_PX = 288;                      // sign texture height in pixels (for crisp text)
const SIGN_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const SIGN_FONT_D = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const ROWS_Z = [1.6, 3.4, 5.2];
const LANE_Z = 0.55;
const DOOR_W = 0.9, DOOR_H = 1.72;
const FRAME_MS = 1000 / 30;
const VIEW = new THREE.Vector3(1, 0.9, 1).normalize();
const LIGHT = new THREE.Vector3(0.55, 1, 0.8).normalize();
const YELLOW = '#fab219';

// ------------------------------------------------------------ colors

const THEMES = [
  { wall: '#d8654f', floor: '#4ea394' }, // brick + turquoise
  { wall: '#e8974f', floor: '#4f93ab' }, // orange + teal
  { wall: '#e6cf9f', floor: '#5aa877' }, // beige + green
  { wall: '#86b4cc', floor: '#c9a978' }, // sky + sand
  { wall: '#d98ea4', floor: '#4fa3a0' }, // rose + turquoise
  { wall: '#b6a3db', floor: '#5fb08c' }, // lavender + mint
  { wall: '#cf7b5c', floor: '#5b8fb8' }, // terracotta + blue
  { wall: '#a9c98f', floor: '#8f9fb0' }, // sage + gray
];
const VACANT_THEME = { wall: '#cdd1d8', floor: '#9aa5b3' };    // an office nobody uses: quiet grey
const VACANT_DESKS = 3;                                        // bare desks in a vacant office (the chief's two come on top)
const SKINS = ['#f3cfb0', '#e7b590', '#cf9670', '#b07650', '#86573a', '#f7dcc6'];
const HAIRS = ['#2b211c', '#4c3528', '#7d5130', '#c08f4f', '#1c1d24', '#8a8f9c', '#a8432f', '#e0c890'];
const PANTS = ['#35405a', '#3e5a86', '#4a4f5c', '#5c4a3e', '#2f3440'];
const BOOKS = ['#d6604d', '#e8a33d', '#4f86c6', '#5aa469', '#8e6bbf', '#e07a9a', '#3f4a5a', '#e9d8b4'];
const POSTERS = ['#f2c14e', '#5b9bd5', '#e8735a', '#6cc3a0', '#9d7fd8', '#f29fb5'];
const WOOD = '#c8935c', WOOD_D = '#9c6d42', METAL = '#4a505d', BEZEL = '#2a2f3a', CHAIR = '#3d4350', CHAIR_S = '#505869';
const SCR_OFF = '#141820', SCR_IDLE = '#5b6d8e', SCR_DONE = '#3f7a5e';

const FIT_ICON = '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>';

// ------------------------------------------------------------ small helpers

const _c = new THREE.Color(), _w = new THREE.Color('#ffffff'), _k = new THREE.Color('#000000');
function shade(hex, t) {
  _c.set(hex).lerp(t > 0 ? _w : _k, Math.abs(t));
  return '#' + _c.getHexString();
}
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function angTo(a, b, k) {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ shared geometries

const GEO = {
  unit: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  pot: new THREE.CylinderGeometry(0.5, 0.36, 1, 12),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  head: new THREE.SphereGeometry(0.25, 22, 16),
  hair: new THREE.SphereGeometry(0.268, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
  bun: new THREE.SphereGeometry(0.11, 12, 10),
  eye: new THREE.SphereGeometry(0.032, 8, 6),
  hand: new THREE.SphereGeometry(0.062, 10, 8),
  torso: new RoundedBoxGeometry(0.44, 0.46, 0.28, 2, 0.1),
  hairLong: new RoundedBoxGeometry(0.46, 0.4, 0.13, 2, 0.06),
  arm: new THREE.CapsuleGeometry(0.066, 0.2, 4, 8).translate(0, -0.165, 0),
  leg: new THREE.CapsuleGeometry(0.078, 0.25, 4, 8).translate(0, -0.2, 0),
  band: new THREE.TorusGeometry(0.278, 0.022, 6, 22, Math.PI),
  cup: new THREE.CylinderGeometry(0.078, 0.078, 0.07, 14).rotateZ(Math.PI / 2),
  mic: new THREE.BoxGeometry(0.022, 0.022, 0.2),
  seat: new RoundedBoxGeometry(0.54, 0.09, 0.52, 2, 0.035),
  back: new RoundedBoxGeometry(0.52, 0.7, 0.1, 2, 0.045),
  arm2: new RoundedBoxGeometry(0.06, 0.05, 0.36, 1, 0.02),
  post: new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8),
  base: new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12),
  hit: new THREE.BoxGeometry(0.64, 1.55, 0.64).translate(0, 0.78, 0),
  screen: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.52, 0.66, 48).rotateX(-Math.PI / 2),
  hover: new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2),
  lamp: new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  beam: (() => {
    const g = new THREE.CylinderGeometry(0.55, 0.95, 6, 28, 6, true).translate(0, 3, 0);
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const k = Math.pow(1 - p.getY(i) / 6, 1.8); col.push(k, k, k); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })(),
};
GEO.smile = new THREE.TorusGeometry(0.04, 0.0085, 5, 10, Math.PI);
const SHARED = new Set(Object.values(GEO));
// what ofis-decor.js draws with: the shared shapes, the palettes, the models, and this file's small helpers and colour lists
const KIT = { GEO, PAL, PK, AS, POSTERS, BOOKS, shade };
const roundedCache = new Map();
function rounded(w, h, d, r) {
  const key = [w, h, d, r].map(v => v.toFixed(3)).join('|');
  let g = roundedCache.get(key);
  if (!g) { roundedCache.set(key, g = new RoundedBoxGeometry(w, h, d, 2, r)); g.userData.rkey = key; }
  return g;
}

// ------------------------------------------------------------ batch that merges the static scene into one mesh

const _m = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _s2 = new THREE.Vector3();

class Batch {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; this.rg = []; }
  add(geo, m, color) {
    _c.set(color);
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    _nm.getNormalMatrix(m);
    if (POLISH) {     // remember each piece's size: the occlusion pass leaves big flat pieces (walls) alone, their few vertices cannot hold it
      if (!geo.boundingBox) geo.computeBoundingBox();
      const sz = geo.boundingBox.getSize(_v), sc = _s2.setFromMatrixScale(m);
      this.rg.push([this.v, this.v + pos.count, Math.max(sz.x * sc.x, sz.y * sc.y, sz.z * sc.z)]);
    }
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(_c.r, _c.g, _c.b);
    }
    if (geo.index) { const a = geo.index.array; for (let k = 0; k < a.length; k++) this.i.push(this.v + a[k]); }
    else for (let k = 0; k < pos.count; k++) this.i.push(this.v + k);
    this.v += pos.count;
  }
  put(geo, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(geo, _m, color);
  }
  box(x, y, z, w, h, d, color, ry = 0) { this.put(GEO.unit, x, y, z, w, h, d, color, ry); }
  rbox(x, y, z, w, h, d, r, color, ry = 0) { this.put(rounded(w, h, d, r), x, y, z, 1, 1, 1, color, ry); }
  // A baked pack model (ofis-assets.js) with its own vertex colours. o: { s | h (scale, or target height), fx fy fz (extra stretch), ry,
  // pal (a palette of PAL), pk (tells two palettes of one model apart) }. Returns its size, or null when the piece did not load or
  // cannot be baked: the caller then builds the procedural shape.
  model(key, x, y, z, o = {}) {
    const src = PK[key];
    if (!src) return null;
    const b = AS.bake(src, o.pal || PAL.furniture, o.pk || '');
    if (!b) return null;
    const sc = o.h ? o.h / b.size.y : (o.s || 1), fx = o.fx || 1, fy = o.fy || 1, fz = o.fz || 1;
    _q.setFromEuler(_e.set(0, o.ry || 0, 0));
    _m.compose(_p.set(x, y, z), _q, _s.set(sc * fx, sc * fy, sc * fz));
    const col = b.geo.attributes.color, pos = b.geo.attributes.position, nor = b.geo.attributes.normal;
    if (POLISH) this.rg.push([this.v, this.v + pos.count, Math.max(b.size.x * sc * fx, b.size.y * sc * fy, b.size.z * sc * fz)]);
    _nm.getNormalMatrix(_m);
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(_m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(col.getX(k), col.getY(k), col.getZ(k));
    }
    const ix = b.geo.index.array;
    for (let k = 0; k < ix.length; k++) this.i.push(this.v + ix[k]);
    this.v += pos.count;
    return { w: b.size.x * sc * fx, h: b.size.y * sc * fy, d: b.size.z * sc * fz, sc };
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------ textures (drawn on a canvas in grayscale; color comes from the material)

function canvasTex(size, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = size[0]; cv.height = size[1];
  draw(cv.getContext('2d'), cv.width, cv.height);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function drawCarpet(g, w, h) {
  const r = rng(7);
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const v = 214 + ((r() * 40) | 0);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * w, r() * h, 1.6, 1.6);
  }
  g.fillStyle = 'rgba(0,0,0,.09)';
  g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
}
function drawTile(g, w, h) {
  const r = rng(11);
  const n = 2, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 238 + ((r() * 12) | 0);
    g.fillStyle = `rgb(${v},${v},${v - 3})`;
    g.fillRect(i * s, j * s, s, s);
  }
  g.fillStyle = 'rgba(0,0,0,.13)';
  for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, 2, h); g.fillRect(0, i * s, w, 2); }
}
function drawScreen(g, w, h) {
  const r = rng(3);
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, 9);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 9, 22, h - 9);
  for (let i = 0; i < 9; i++) {
    const y = 16 + i * 7;
    g.fillStyle = '#c8c8c8'; g.fillRect(4, y, 12, 3);
    const ind = (r() * 3 | 0) * 6;
    g.fillStyle = r() < 0.35 ? '#ffffff' : '#e4e4e4';
    g.fillRect(28 + ind, y, 18 + r() * 70, 3);
  }
}

// ------------------------------------------------------------ layout: fixed offices (ofis-layout.js decides where everything goes)

// The building is laid out for MIN_ROOMS chats from the start: rooms and halls come from buildingPlan, a chat sits in its own sticky slot,
// and the offices nobody uses are vacant offices. See ofis-layout.js for the rules and `rebuild` below for how they are drawn.

// ------------------------------------------------------------ view

// opts: { settings (office-settings.js: time, season, weather, hemisphere, shelf), atmosphere (office-atmosphere.js: the clock, season and weather of the surroundings) };
// without them the scene follows the local clock and the address
export function createOfis(root, ctx, opts = {}) {
  const { store } = ctx;
  // the scene (`area`: pointer, wheel and size belong to it) and the column beside it (`.of-side`: the shelf card, ofis-ui.js, with the zoom buttons right under it), as in
  // the pixel scene; the scene spans the whole view and the card, the buttons and the page's bar float over it
  root.innerHTML =
    '<div class="of-area">' +
    '<div class="of-stage"></div><div class="of-layer"></div>' +
    '<div class="of-hud"><div class="of-sum"></div></div>' +
    '<div class="of-empty" hidden></div></div>' +
    '<div class="of-side"><div class="of-ctl">' +
    `<button type="button" data-z="in" title="${esc(msg('of.zoomIn'))}">+</button>` +
    `<button type="button" data-z="out" title="${esc(msg('of.zoomOut'))}">−</button>` +
    `<button type="button" data-z="fit" title="${esc(msg('of.fit'))}">${FIT_ICON}</button></div></div>`;
  const area = root.querySelector('.of-area');
  const stage = root.querySelector('.of-stage');
  const layer = root.querySelector('.of-layer');
  const sumEl = root.querySelector('.of-sum');
  const emptyEl = root.querySelector('.of-empty');

  // Software WebGL (SwiftShader / llvmpipe, e.g. headless Chrome or a VM without a GPU) draws on the CPU
  // and can saturate several cores; detect it once and fall back to a low-power profile.
  const SOFTWARE_GL = (() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch { return false; }
  })();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !SOFTWARE_GL, alpha: true, powerPreference: 'default' });
  } catch {
    emptyEl.hidden = false;
    emptyEl.textContent = msg('of.noWebgl');
    return { show() {}, hide() {}, update() {} };
  }
  renderer.setPixelRatio(SOFTWARE_GL ? 1 : Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  // Shadows are re-rendered only when the scene changes (see sync) and every few frames, not every frame.
  renderer.shadowMap.enabled = !SOFTWARE_GL;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  if (POLISH) { renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0; }   // gentle: keeps the flat colours, rolls off the highlights
  stage.appendChild(renderer.domElement);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const TEX = {
    carpet: canvasTex([128, 128], drawCarpet),
    tile: canvasTex([128, 128], drawTile),
    screen: canvasTex([128, 80], drawScreen, false),
    glow: canvasTex([64, 64], (g, w, h) => {
      const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.35, 'rgba(255,255,255,.45)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }, false),
  };
  TEX.carpet.anisotropy = TEX.tile.anisotropy = aniso;

  const MAT = {
    stat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    screen: new THREE.MeshBasicMaterial({ map: TEX.screen }),
    slab: new THREE.MeshLambertMaterial({ color: '#ddd6c8', map: TEX.tile }),
    glass: new THREE.MeshLambertMaterial({ color: '#c4e9f5', transparent: true, opacity: 0.42, depthWrite: false }),
    ovl: new THREE.MeshBasicMaterial({ color: '#0a0f28', transparent: true, opacity: 0.5, depthWrite: false }),
    hover: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    signSide: new THREE.MeshLambertMaterial({ color: '#1b1f28' }),
    hall: new THREE.MeshLambertMaterial({ color: '#f2ede3', map: TEX.tile }),
  };
  if (POLISH) {
    TEX.blob = PL.softBlobTexture();
    MAT.blob = new THREE.MeshBasicMaterial({ map: TEX.blob, color: '#1d2b3a', transparent: true, opacity: 0.3, depthWrite: false });
    GEO.blobPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    SHARED.add(GEO.blobPlane);
  }
  const matCache = new Map();
  const mat = hex => {
    let m = matCache.get(hex);
    if (!m) matCache.set(hex, m = new THREE.MeshLambertMaterial({ color: hex }));
    return m;
  };
  const floorMats = new Map();
  const floorMat = hex => {
    let m = floorMats.get(hex);
    if (!m) floorMats.set(hex, m = new THREE.MeshLambertMaterial({ color: hex, map: TEX.carpet }));
    return m;
  };

  // door leaf: all doors share the same geometry
  const doorGeo = (() => {
    const B = new Batch(), w = DOOR_W - 0.04, h = DOOR_H - 0.03, t = 0.05, f = 0.07, col = '#f2f4f7';
    B.box(f / 2, h / 2, 0, f, h, t, col);
    B.box(w - f / 2, h / 2, 0, f, h, t, col);
    B.box(w / 2, h - f / 2, 0, w, f, t, col);
    B.box(w / 2, 0.1, 0, w, 0.2, t, col);
    B.box(w - 0.16, 0.95, 0.045, 0.04, 0.3, 0.04, '#8b929f');
    B.box(w - 0.16, 0.95, -0.045, 0.04, 0.3, 0.04, '#8b929f');
    return B.build();
  })();
  const glassGeo = new THREE.BoxGeometry(DOOR_W - 0.04 - 0.14, DOOR_H - 0.03 - 0.27, 0.02).translate((DOOR_W - 0.04) / 2, 0.2 + (DOOR_H - 0.03 - 0.27) / 2, 0);

  // ---------------------------------------------------------- scene, lights, camera

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#fffaf0', '#8d8478', 1.9);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 50, 700);
  const R = new THREE.Vector3(1, 0, -1).normalize();
  const U = new THREE.Vector3().crossVectors(VIEW, R).normalize();
  const focus = new THREE.Vector3();
  let camA = 0, camB = 0, zoom = 30, zMin = 4, zMax = 90, vw = 1, vh = 1;
  let autoFit = true;
  let lim = { a0: -1e9, a1: 1e9, b0: -1e9, b1: 1e9 };

  function applyCam() {
    camA = clamp(camA, lim.a0, lim.a1);
    camB = clamp(camB, lim.b0, lim.b1);
    camera.left = -vw / 2; camera.right = vw / 2; camera.top = vh / 2; camera.bottom = -vh / 2;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    focus.copy(R).multiplyScalar(camA).addScaledVector(U, camB);
    camera.position.copy(focus).addScaledVector(VIEW, 300);
    camera.up.set(0, 1, 0);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    ui.syncZoom(zoom, zMin, zMax);
  }

  const hoverRing = new THREE.Mesh(GEO.hover, MAT.hover);
  hoverRing.visible = false;
  hoverRing.renderOrder = 3;
  scene.add(hoverRing);
  // the agent whose card is open keeps the ring that the hover gives, as in the pixel scene (ofis-ui.js says which agent)
  const selRing = new THREE.Mesh(GEO.hover, MAT.hover);
  selRing.visible = false;
  selRing.renderOrder = 3;
  scene.add(selRing);
  let selectedId = null;

  // surroundings (street, river, woods, mountains): laid out around world.bounds in applyBounds, animated in step
  const atmosphere = opts.atmosphere || createAtmosphere({ settings: createOfficeSettings({ overrides: officeQuery(typeof location === 'undefined' ? '' : location.search) }) });
  const env = createEnv({ scene, camera, lights: { hemi, sun }, lightDir: LIGHT, softwareGL: SOFTWARE_GL, fitBox: () => projBounds(), atmosphere });
  // what makes an occupied office its own: its style's furniture, windows and lamps, and the light of the lamps and windows (ofis-decor.js; it follows the same atmosphere as the surroundings)
  const decor = createDecor({ atmosphere, aniso });

  // ---------------------------------------------------------- state

  let visible = false, raf = 0, lastT = 0, resized = true, instantNext = true;
  let floorJobs = [], rebuildMs = 0;
  const world = { group: null, rooms: new Map(), pick: [], screens: [], screenMesh: null, bounds: null, sig: '' };
  const roomState = new Map();   // session id → { cls, low }
  // sticky offices: chat → slot (see ofis-layout.js). The slots are kept in localStorage so a reload gives every chat the same office.
  const MIN_ROOMS_NOW = minRoomsFrom(typeof location !== 'undefined' ? location.search : '');
  const SLOTS_KEY = 'cco.office.slots';
  const slots = createSlots({ minRooms: MIN_ROOMS_NOW, saved: (() => { try { return JSON.parse(localStorage.getItem(SLOTS_KEY)); } catch { return null; } })() });
  let slotsSaved = '';
  let fitKey = '';               // the building the camera was last fitted to: only a different building refits an automatic view
  let fits = 0;                  // how many times a building change refitted the view (verification only)
  let builds = 0;                // how many times the building was built (verification only)
  const chars = new Map();       // agent id → character
  const labels = new Set();
  let labelSeq = 0;
  const signs = new Map();       // session id → sign label
  const themeOf = new Map();     // project → theme index; open projects get distinct colors when possible
  const styleOf = new Map();     // chat id → room style index (ofis-styles.js): the style a room has, kept while the page is open
  let extras = null;             // optional local decoration module { mod, w }
  const extraLabels = [];
  const extraFrame = [];
  const extraMats = [];
  const extraPointer = [];       // pointer hooks of the local module (api.onPointer), per build like extraFrame
  const extraFigs = [];          // people created by the local module (api.figures), per build
  const doorWalkers = [];        // x, z pairs from api.openDoorsNear for this frame; cleared after stepRooms
  // ?arrive=calm: a page load, a scene switch or a rebuilt building sends everybody who is already in the data in at the normal pace (ofis-arrive.js hurries a big queue so that
  // all are in their seat within about 10 seconds)
  const CALM_LOAD = /[?&]arrive=calm(?:&|$)/.test(typeof location !== 'undefined' ? location.search : '');
  const REC = { on: false, ev: [] };   // verification only (root.__ofis.rec): every figure's creation, removal and place on every frame
  let shakeAmp = 0;              // camera shake strength in screen pixels (api.shake); decays every frame
  let activeTool = null;         // exclusive interaction mode of a local add-on (api.setTool); kept across builds
  const toolFns = [];            // api.onToolChange listeners, per build like extraFrame
  const gRay = new THREE.Raycaster(), gNdc = new THREE.Vector2(), gPlane = new THREE.Plane(), gUp = new THREE.Vector3(0, 1, 0);
  const gV1 = new THREE.Vector3(), gV2 = new THREE.Vector3(), gV3 = new THREE.Vector3(), gBox = new THREE.Box3();
  // the floating interface shared with the pixel scene (ofis-ui.js): the card beside a clicked agent, the shelf card and the zoom buttons
  const ui = createOfisUi({
    root, area, ctx, camera, size: () => [vw, vh], charOf: id => chars.get(id),
    setSelected: id => { selectedId = id; },
    onShelfFirst: () => { if (visible && autoFit) fit(); },
  });

  function assignThemes(list, cells) {
    const live = [];
    for (const it of list) {
      const a = store.agents.get(it.id);
      const p = (a && a.project) || it.id;
      if (!live.includes(p)) live.push(p);
    }
    const used = new Set(live.filter(p => themeOf.has(p)).map(p => themeOf.get(p)));
    for (const p of live) {
      if (themeOf.has(p)) continue;
      let t = hash(p) % THEMES.length;
      for (let i = 0; i < THEMES.length && used.has(t); i++) t = (t + 1) % THEMES.length;
      themeOf.set(p, t);
      used.add(t);
    }
    // the same for the room style, but per chat, not per project: chats started from the same folder (all of them, for someone who works from home) must not
    // all get the same style. The chat's own pick (a hash of its id), a free one when it is taken, and never the style of the office next to it (ofis-styles.js assignStyles)
    for (const [k, i] of assignStyles(list.map(it => it.id), styleOf, neighbourMap(list.map(it => ({ project: it.id, slot: it.slot })), cells))) styleOf.set(k, i);
  }

  // ---------------------------------------------------------- label layer

  function mkLabel(cls, pri, mode, gap, minZoom = 0) {
    const el = document.createElement('div');
    el.className = 'of-l ' + cls;
    el.style.zIndex = String(pri);
    el.style.visibility = 'hidden';
    layer.appendChild(el);
    const L = { el, pri, mode, gap, minZoom, pos: new THREE.Vector3(), want: true, shown: false, html: '', dirty: true, w: 0, h: 0, force: false, uid: 'l' + (++labelSeq), agent: false, rank: 0 };
    labels.add(L);
    return L;
  }
  function setLabel(L, html, id, pri) {
    if (L.html !== html) { L.el.innerHTML = html; L.html = html; L.dirty = true; }
    if (id !== undefined && L.el.dataset.id !== id) L.el.dataset.id = id;
    if (pri !== undefined && L.pri !== pri) { L.pri = pri; L.el.style.zIndex = String(pri); }
  }
  function dropLabel(L) { if (!L) return; L.el.remove(); labels.delete(L); }
  function showLabel(L, on) {
    if (L.shown === on) return;
    L.shown = on;
    L.el.style.visibility = on ? 'visible' : 'hidden';
  }

  // The labels of the agents (`agent`) may leave their spot for a free one near their agent; every other label keeps its spot and is dropped when it touches a label of higher
  // priority; nothing is drawn under the card or the shelf (ofis-label-layout.js).
  const PV = new THREE.Vector3();
  function placeLabels() {
    const s = clamp(zoom / 38, 0.74, 1);
    const fixed = [], tags = [], byId = new Map();
    for (const L of labels) {
      if (!L.want || L.off || zoom < L.minZoom || (L.maxZoom && zoom >= L.maxZoom)) { showLabel(L, false); continue; }
      // the label under a main agent says the project and the chip at every zoom (office-labels.js): the HTML sign for the far zoom would say it twice
      if (L.sign === undefined) L.sign = L.el.classList.contains('of-signl');
      if (L.sign) { const m = chars.get(L.el.dataset.id); if (m && m.tag.want && !m.tag.off) { showLabel(L, false); continue; } }
      if (L.dirty) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; L.dirty = false; }
      PV.copy(L.pos).project(camera);
      const sx = (PV.x + 1) / 2 * vw, sy = (1 - PV.y) / 2 * vh;
      const k = L.force ? Math.max(s, 0.9) : s;
      const w = L.w * k, h = L.h * k;
      const x = sx - w / 2;
      const y = L.mode === 'up' ? sy - h - L.gap * k : L.mode === 'mid' ? sy - h / 2 : sy + L.gap * k;
      if (x > vw + 4 || x + w < -4 || y > vh + 4 || y + h < -4) { showLabel(L, false); continue; }
      L.k = k;
      byId.set(L.uid, L);
      (L.agent ? tags : fixed).push({ id: L.uid, x, y, w, h, pri: L.pri, rank: L.rank, force: L.force, maxGap: L.force ? Infinity : SUB_LABEL_REACH });
    }
    const figs = ui.figureRects(chars.keys());
    for (const T of tags) { const L = byId.get(T.id); T.near = figs.get(L.charId); }
    const shown = layoutLabels({ fixed, tags, blocked: ui.blocked(), figures: [...figs.values()], vw, vh });
    for (const [id, L] of byId) {
      const p = shown.get(id);
      if (!p) { showLabel(L, false); continue; }
      L.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) scale(${L.k.toFixed(3)})`;
      showLabel(L, true);
    }
  }

  // ---------------------------------------------------------- build the rooms

  function disposeWorld() {
    if (!world.group) return;
    scene.remove(world.group);
    world.group.traverse(o => {
      if (o.userData.own && o.geometry && !SHARED.has(o.geometry) && !roundedCache.has(o.geometry.userData.rkey)) o.geometry.dispose();
      if (o.userData.ownMat && o.material) o.material.dispose();
      if (o.userData.dispose) o.userData.dispose();
      if (o.userData.mats) o.userData.mats.forEach(m => m.dispose());
    });
    world.group = null;
  }

  // plan: { rows, slotOf } from syncRooms; list: the chats with a room ({ id, cls, slot }). Every slot without a chat becomes a vacant office.
  function rebuild(list, plan) {
    const t0 = performance.now();
    builds++;
    floorJobs = [];
    disposeWorld();
    decor.beginBuild();
    const g = new THREE.Group();
    world.group = g;
    scene.add(g);
    world.pick = [];
    world.screens = [];
    const oldRooms = world.rooms, oldHalls = world.halls || [], oldEntry = world.entryX, oldVacant = world.vacant || [];
    world.rooms = new Map();
    world.vacant = [];
    world.vacantSigns = [];
    for (const L of extraLabels) dropLabel(L);
    extraLabels.length = 0;
    extraFrame.length = 0;
    extraPointer.length = 0;
    toolFns.length = 0;
    env.resetRoads();
    extraFigs.length = 0;
    extraMats.splice(0).forEach(m => m.dispose());

    // optional local extra areas: 'first' = left end of the bar's hall on the back row's side, 'last' = on the front row's side (they open onto the hall)
    const ex = extras ? extras.areas : [];
    const aFirst = ex.find(x => x.row === 'first'), aLast = ex.find(x => x.row === 'last');
    const P = buildingPlan(plan.bays, { first: aFirst ? aFirst.w : 0, last: aLast ? aLast.w : 0 });
    const bySlot = new Map(list.map(it => [it.slot, it]));
    // every office is a fixed cell: a room is as wide as its cell, the desks of its class fill the left of it and the rest is a lounge
    const items = P.cells.map(c => {
      const it = bySlot.get(c.slot);
      return it ? { ...c, id: it.id, cls: it.cls } : { ...c, id: 'vacant-' + c.slot, cls: VACANT_CLS, vacant: true };
    });
    world.halls = P.halls;
    world.width = P.width;
    world.entryX = world.width + 0.45;
    world.depth = P.depth;
    const areas = world.areaList = [];
    for (const [key, ar] of [['last', aLast], ['first', aFirst]]) {
      const a = ar && P.areas.find(x => x.key === key);
      if (a) areas.push({ ...ar, x: a.x, z: a.z, door: a.door, hall: a.hall });
    }
    assignThemes(list, P.cells);
    const B = new Batch();
    const T = WALL_T;

    // floor slab (corridors) and the building's plinth: one paved rectangle per row of the building (the arms of the X stand on their own), the stone
    // pattern anchored to the world so that it runs on from one rectangle to the next
    world.footprint = P.plinth;
    world.baseBounds = { ...P.bounds };
    for (const r of P.plinth) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const slabGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      const uv = slabGeo.attributes.uv, pos = slabGeo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + cx) / 1.2, (pos.getZ(i) + cz) / 1.2);
      const slab = new THREE.Mesh(slabGeo, MAT.slab);
      slab.position.set(cx, 0, cz);
      slab.receiveShadow = true;
      slab.userData.own = true;
      g.add(slab);
      B.box(cx, -0.23, cz, w, 0.46, d, '#4a5163');
      B.box(cx, -0.012, cz, w + 0.06, 0.02, d + 0.06, '#b9b1a1');
    }

    // an office whose chat has just left is vacant now, but its person may still be walking out of it: its door is a real one (it opens for the person) until the next rebuild
    const roomIds = new Set(list.map(it => it.id));
    const leavingSlots = new Set();
    for (const c of chars.values()) if (!roomIds.has(c.roomId) && c.cell >= 0) leavingSlots.add(c.cell);
    const oldBySlot = new Map([...oldRooms.values(), ...oldVacant].map(r => [r.slot, r]));
    items.forEach(it => {
      const n0 = B.i.length / 3, f0 = floorJobs.length;
      const room = it.vacant ? buildVacant(B, g, it, leavingSlots.has(it.slot)) : buildRoom(B, g, it);
      room.tris = B.i.length / 3 - n0;                        // verification only: the triangles of the office (its floor is added below)
      for (let k = f0; k < floorJobs.length; k++) floorJobs[k].room = room;
      if (it.vacant) {
        const pv = oldBySlot.get(it.slot);
        if (room.doorPivot && pv) room.doorOpen = pv.doorOpen;
        world.vacant.push(room);
        return;
      }
      const prev = oldRooms.get(it.id);
      if (prev) room.doorOpen = prev.doorOpen;
      world.rooms.set(it.id, room);
    });
    world.plan = { bays: P.bays, size: P.size };
    world.lounge = P.lounge;
    if (P.lounge) buildPlaza(B, P.lounge);
    buildHalls(B, g, items, areas);
    addVacantSigns(g);
    decor.finish(g);

    if (POLISH) {
      const occ = PL.makeOcc(B.p, B.i);
      PL.bakeBatchAO(B, occ);
      const quiet = [];                                       // the vacant floors (a coarser grid) share one mesh
      for (const j of floorJobs) {
        const fg = PL.floorMesh(j.X, j.Z, j.W, j.D, j.hex, occ, 0.012, j.quiet ? 0.6 : 0.3);
        if (j.room) j.room.tris += fg.index.count / 3;
        if (j.quiet) { quiet.push(fg); continue; }
        const fm = new THREE.Mesh(fg, (j.pattern && decor.floorMaterial(j.pattern)) || MAT.stat);
        fm.receiveShadow = true; fm.userData.own = true;
        g.add(fm);
      }
      if (quiet.length) {
        const fm = new THREE.Mesh(mergeGeometries(quiet), MAT.stat);
        fm.receiveShadow = true; fm.userData.own = true;
        g.add(fm);
        quiet.forEach(q => q.dispose());
      }
    }
    const stat = new THREE.Mesh(B.build(), MAT.stat);
    stat.castShadow = stat.receiveShadow = true;
    stat.userData.own = true;
    g.add(stat);

    world.lots = [];
    world.fitExtra = [];
    if (extras && items.length) runExtras(g, areas);

    // screens: a single InstancedMesh
    const n = Math.max(1, world.screens.length);
    const sm = new THREE.InstancedMesh(GEO.screen, MAT.screen, n);
    sm.count = world.screens.length;
    world.screens.forEach((s, i) => {
      _q.setFromEuler(_e.set(s.rx || 0, s.ry + Math.PI / 2, 0, 'YXZ'));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.w, s.h, 1));
      sm.setMatrixAt(i, _m);
      sm.setColorAt(i, _c.set(SCR_OFF));
    });
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    sm.frustumCulled = false;
    world.screenMesh = sm;
    g.add(sm);


    // the figures go on from where they stand (reconcileChars): none is seated on the spot or dropped
    reconcileChars(oldRooms, oldHalls, oldEntry);
    for (const [id, L] of signs) if (!world.rooms.has(id)) { dropLabel(L); signs.delete(id); }

    applyBounds();
    rebuildMs = performance.now() - t0;
  }

  // Union of the building and the local lots: camera framing, pan limits and the shadow camera follow it.
  function applyBounds() {
    const b = { ...(world.baseBounds || { x0: -1, x1: 1, z0: -1, z1: 1 }) };
    for (const l of world.lots || []) { b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); b.z0 = Math.min(b.z0, l.z0); b.z1 = Math.max(b.z1, l.z1); }
    world.bounds = b;
    env.layout({ bounds: b, base: world.baseBounds, lots: world.lots || [], entries: (world.halls || []).map(h => h.lane) });
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const rad = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 2;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx, 0, cz).addScaledVector(LIGHT, 80);
    const sc = sun.shadow.camera;
    sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 80 + rad * 2;
    sc.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.shadow.mapSize.setScalar(rad > 34 ? 4096 : 2048);
    if (sun.shadow.map && sun.shadow.map.width !== sun.shadow.mapSize.x) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    computeLimits();
    // only a different building refits an automatic view: a chat or a sub-agent coming and going inside the same building leaves the camera alone
    // (the box the fit frames, which is that of the footprint: a bay added inside the plan's box can change it)
    const pb = projBounds();
    const key = [b.x0, b.x1, b.z0, b.z1, pb.a0, pb.a1, pb.b0, pb.b1, (world.lots || []).length, (world.fitExtra || []).length].map(v => +v.toFixed(2)).join();
    const changed = key !== fitKey;
    fitKey = key;
    if (autoFit && changed) { fits++; fit(); }
  }

  // verification only (tools/qa/office3d-qa.mjs, the QA pictures): what the scene drew, how long a rebuild took, which models are in use, a camera on a point
  root.__ofis3d = {
    get info() { const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures }; },
    get rebuildMs() { return +rebuildMs.toFixed(1); },
    get fits() { return fits; },
    get builds() { return builds; },
    get models() { return { loaded: Object.keys(PK), failed: [...AS.packs.failed.keys()] }; },
    get look() { return { assets: AS.look.assets, polish: POLISH }; },
    figures() { return [...chars.values()].map(c => ({ id: c.id, main: c.main, pack: !!c.pk, shirt: c.shirt, tinted: c.tinted, mode: c.mode, after: c.after, vis: c.root.visible, x: c.root.position.x, z: c.root.position.z })); },
    draw() { renderer.render(scene, camera); return this.info; },
    figureVisible(id, on) { const c = chars.get(id); if (c) c.root.visible = !!on; },
    rebuildNow() { world.sig = ''; sync(); return this.rebuildMs; },
    // the rooms' life (ofis-decor.js): panes, lamps, candles and the light they give right now; the style of every room; the living meshes can be hidden to compare pictures
    get life() { return decor.stats(); },
    lifeVisible(on, part) { decor.setVisible(on, part); },
    styles() { return Object.fromEntries([...world.rooms.keys()].map(id => [id, styleAt(styleOf.get(id) ?? hash(id)).id])); },
    view(x, y, z, zm) { autoFit = false; camA = PV.set(x, y, z).dot(R); camB = PV.dot(U); lim = { a0: -1e9, a1: 1e9, b0: -1e9, b1: 1e9 }; zoom = clamp(zm, 1, 400); applyCam(); return [camA, camB, zoom]; },
    room(id) { const r = world.rooms.get(id) || (world.vacant || []).find(v => v.id === id); return r ? { X: r.X, Z: r.Z, W: r.W, D: r.D } : null; },
    // every office of the building, vacant ones included, in slot order: the stable layout's state (tools/qa/office3d-qa.mjs)
    office() {
      const all = [...world.rooms.values(), ...(world.vacant || [])].sort((a, b) => a.slot - b.slot);
      return { ...world.plan, minRooms: MIN_ROOMS_NOW, entryX: world.entryX, bounds: world.bounds, stubs: world.stubs || [], lounge: world.lounge ? { X: world.lounge.X, Z: world.lounge.Z, W: world.lounge.W, D: world.lounge.D, door: world.lounge.door, hall: world.lounge.hall } : null,
        halls: (world.halls || []).map(h => ({ z0: h.z0, z1: h.z1, lane: h.lane, open: h.open, x0: h.x0, x1: h.x1, row: h.row })),
        slots: all.map(r => ({ slot: r.slot, id: r.vacant ? null : r.id, vacant: r.vacant, tris: r.tris, cls: r.cls, cap: r.cap, X: r.X, Z: r.Z, W: r.W, D: r.D, door: r.door, hall: r.hall })) };
    },
    // the paved rectangles under the building, one per row of it (what the fit frames; tools/qa/office3d-map.mjs measures how much of the window they cover)
    footprint() { return (world.footprint || []).map(r => ({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 })); },
  };

  // Room shell: carpet, back walls (full height), front walls (low cutaway) and the door facing the hall.
  // door === 'back' → glass door in the back-right wall; 'front' → opening in the low front wall.
  // quiet: a vacant office. Same walls, floor and door, but nothing is a mesh of its own: the closed door is part of the batch and the floor
  // joins the other vacant floors in one mesh (a coarser mesh: nobody walks on it).
  function buildShell(B, g, X, Z, W, D, th, door, quiet = false) {
    const T = WALL_T, H = WALL_H;
    const wall = th.wall, wain = shade(wall, th.wain != null ? th.wain : -0.13), rail = shade(wall, 0.5), cap = shade(wall, -0.55), base = shade(wall, -0.38);
    const trim = '#f3efe6';
    const b = (x, y, z, w, hh, d, col, ry) => B.box(X + x, y, Z + z, w, hh, d, col, ry);

    if (POLISH) floorJobs.push({ X, Z, W, D, hex: th.floor, quiet, pattern: th.pattern });       // drawn after the furniture exists (occlusion), with vertex colours
    else {
      const fg = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2);
      const fuv = fg.attributes.uv;
      for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * W, fuv.getY(i) * D);
      const floor = new THREE.Mesh(fg, floorMat(th.floor));
      floor.position.set(X + W / 2, 0.012, Z + D / 2);
      floor.receiveShadow = true;
      floor.userData.own = true;
      g.add(floor);
    }
    b(W / 2, 0.004, D / 2, W + 0.04, 0.008, D + 0.04, shade(th.floor, -0.3));

    // back-left wall (x = 0 plane)
    b(-T / 2, H / 2, (D - T) / 2, T, H, D + T, wall);
    b(-T / 2, H + 0.025, (D - T) / 2, T + 0.03, 0.05, D + T + 0.03, cap);
    b(0.012, 0.43, D / 2, 0.024, 0.86, D, wain);
    b(0.022, 0.875, D / 2, 0.044, 0.045, D, rail);
    b(0.02, 0.05, D / 2, 0.04, 0.1, D, base);

    // back-right wall (z = 0 plane)
    const dx = W - 1.0, dl = dx - DOOR_W / 2, dr = dx + DOOR_W / 2;
    const seg = (x1, x2) => {
      b((x1 + x2) / 2, H / 2, -T / 2, x2 - x1, H, T, wall);
      const i1 = Math.max(0, x1), i2 = x2;
      if (i2 - i1 > 0.05) {
        b((i1 + i2) / 2, 0.43, 0.012, i2 - i1, 0.86, 0.024, wain);
        b((i1 + i2) / 2, 0.875, 0.022, i2 - i1, 0.045, 0.044, rail);
        b((i1 + i2) / 2, 0.05, 0.02, i2 - i1, 0.1, 0.04, base);
      }
    };
    let pivot = null;
    if (door === 'back') {
      seg(-T, dl - 0.06);
      seg(dr + 0.06, W);
      b(dx, (DOOR_H + 0.06 + H) / 2, -T / 2, DOOR_W + 0.12, H - DOOR_H - 0.06, T, wall);
      b(dl - 0.03, DOOR_H / 2, -T / 2, 0.06, DOOR_H + 0.06, T + 0.07, trim);
      b(dr + 0.03, DOOR_H / 2, -T / 2, 0.06, DOOR_H + 0.06, T + 0.07, trim);
      b(dx, DOOR_H + 0.03, -T / 2, DOOR_W + 0.12, 0.06, T + 0.07, trim);
      b(dx, 0.006, -T / 2, DOOR_W, 0.012, T, '#8b8f98');
      if (quiet) {                                                    // a shut door of boxes: a frame and its glass
        b(dx, DOOR_H / 2 + 0.01, -T / 2, DOOR_W - 0.04, DOOR_H - 0.03, 0.05, '#f2f4f7');
        b(dx, DOOR_H / 2 + 0.07, -T / 2 + 0.03, DOOR_W - 0.18, DOOR_H - 0.3, 0.02, '#c4e9f5');
      } else {
        // glass door leaf (hinged on the left, opens inward)
        pivot = new THREE.Group();
        pivot.position.set(X + dl + 0.02, 0.01, Z - T / 2);
        const leaf = new THREE.Mesh(doorGeo, MAT.stat); leaf.castShadow = true;
        const glass = new THREE.Mesh(glassGeo, MAT.glass); glass.renderOrder = 2;
        pivot.add(leaf, glass);
        g.add(pivot);
      }
    } else seg(-T, W);
    b((W - T) / 2, H + 0.025, -T / 2, W + T + 0.03, 0.05, T + 0.03, cap);

    // low front walls (cutaway); with a front door, an opening onto the hall
    b(W + T / 2, LOW_H / 2, D / 2, T, LOW_H, D + 2 * T, wall);
    b(W + T / 2, LOW_H + 0.02, D / 2, T + 0.03, 0.04, D + 2 * T + 0.03, cap);
    const low = (x1, x2) => {
      b((x1 + x2) / 2, LOW_H / 2, D + T / 2, x2 - x1, LOW_H, T, wall);
      b((x1 + x2) / 2, LOW_H + 0.02, D + T / 2, x2 - x1 + 0.03, 0.04, T + 0.03, cap);
    };
    if (door === 'front') {
      low(-T, dl);
      low(dr, W);
      for (const px of [dl - 0.05, dr + 0.05]) b(px, 0.3, D + T / 2, 0.1, 0.6, T + 0.08, trim);
      b(dx, 0.016, D - 0.25, DOOR_W - 0.1, 0.012, 0.5, shade(th.floor, -0.35));
    } else low(-T, W);

    return { pivot, cap, dx, signX0: 0.3, signX1: door === 'back' ? dl - 0.3 : W - 0.75 };
  }

  // A vacant office: the walls, floor, door and sign are the office's own (same places, so nothing moves when a chat takes the slot), the
  // contents are a few bare pieces of the one batch (desks without monitors or chairs, a plant, a sofa) and nothing is a mesh of its own:
  // no door leaf, no sign mesh (addVacantSigns), no pick boxes of desks, overlay, beam or rings (nobody sleeps or waits here). A chat in the
  // slot gets buildRoom's full office. Only its two outer walls block the pointer.
  function buildVacant(B, g, it, open = false) {
    const X = it.X, Z = it.Z, W = it.W, D = ROOM_D, T = WALL_T, H = WALL_H;
    const th = VACANT_THEME;
    const b = (x, y, z, w, hh, d, col, ry) => B.box(X + x, y, Z + z, w, hh, d, col, ry);
    const shell = buildShell(B, g, X, Z, W, D, th, it.door, !open);        // open: a person is still walking out of the office, so its door is a real, hinged one
    decor.furnishVacant({ B, X, Z, W, door: it.door });
    const room = { id: it.id, cls: it.cls, cap: CAP[it.cls], X, Z, W, D, door: it.door, hall: it.hall, slot: it.slot, vacant: true };
    if (open && shell.pivot) Object.assign(room, { doorX: X + shell.dx, doorPt: new THREE.Vector3(X + shell.dx, 0, it.door === 'back' ? Z : Z + D), doorPivot: shell.pivot, doorOpen: 0 });
    const desk = (x, z, dep, len) => {                      // a top and its two end panels
      b(x, 0.6, z, dep, 0.05, len, WOOD);
      b(x - 0.02, 0.29, z - len / 2 + 0.05, dep - 0.1, 0.58, 0.04, WOOD_D);
      b(x - 0.02, 0.29, z + len / 2 - 0.05, dep - 0.1, 0.58, 0.04, WOOD_D);
    };
    const cz = D / 2;
    desk(0.95, cz - 0.58, 0.9, 1.17);
    desk(0.95, cz + 0.58, 0.9, 1.17);
    for (let k = 0; k < VACANT_DESKS; k++) desk(CHEF_W + 0.55, ROWS_Z[k], 0.66, 1.24);
    if (!B.model('plant', X + 0.42, 0, Z + 0.42, { h: 1.0, pal: PAL.potFloor, pk: 'floor', ry: 0 })) {
      B.put(GEO.pot, X + 0.42, 0.19, Z + 0.42, 0.36, 0.38, 0.36, '#c8704a');
      B.put(GEO.ico, X + 0.42, 0.98, Z + 0.42, 0.66, 0.58, 0.66, '#4c9a4f');
    }
    const lx0 = CHEF_W + COLS[it.cls] * COL_W + 0.3, lx1 = W - 0.3, lw = lx1 - lx0;     // the lounge corner of buildRoom: one sofa on its rug
    if (lw >= 1.5) {
      const lz = 3.9, sofa = shade(th.wall, -0.28), sx = lx0 + 0.42;
      b((lx0 + lx1) / 2, 0.018, lz, Math.min(lw - 0.1, 3.4), 0.012, 2.6, '#efe6d2');
      b(sx, 0.26, lz, 0.72, 0.26, 1.8, sofa);
      b(sx - 0.28, 0.56, lz, 0.18, 0.52, 1.8, sofa);
    }
    // the sign: its frame and body are batch boxes, its face is an instance of the shared plate (addVacantSigns)
    const sg0 = shell.signX0, sg1 = shell.signX1;
    const sw = Math.min(sg1 - sg0, 5.4);
    const scx = sg0 + Math.min(sw / 2 + 0.2, (sg1 - sg0) / 2);
    b(scx, SIGN_Y, 0.012, sw + 0.1, SIGN_H + 0.1, 0.024, shell.cap);
    b(scx, SIGN_Y, 0.055, sw, SIGN_H, 0.06, '#1b1f28');
    world.vacantSigns.push({ x: X + scx, y: SIGN_Y, z: Z + 0.0865, w: sw });
    hitBox(g, X - T / 2, H / 2, Z + (D - T) / 2, T, H, D + T).userData.pick = { t: 'block' };
    hitBox(g, X + (W - T) / 2, H / 2, Z - T / 2, W + T, H, T).userData.pick = { t: 'block' };
    return room;
  }

  // The faces of the vacant signs: one blank grey plate (no text: nobody uses the office) painted once per build, drawn as one instanced mesh (one draw call) per sign width.
  function addVacantSigns(g) {
    const byW = new Map();
    for (const s of world.vacantSigns) {
      const k = s.w.toFixed(2);
      if (!byW.has(k)) byW.set(k, []);
      byW.get(k).push(s);
    }
    for (const list of byW.values()) {
      const w = list[0].w, cv = document.createElement('canvas');
      cv.height = SIGN_PX;
      cv.width = Math.min(2048, Math.round(SIGN_PX * w / SIGN_H));
      paintPlaque(cv, { name: '', title: '', color: '#8a93a3', status: '' });
      const g2 = cv.getContext('2d');                      // a veil over it: quiet next to the signs of the chats
      g2.fillStyle = 'rgba(70,76,88,.5)';
      g2.fillRect(0, 0, cv.width, cv.height);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      const geo = new THREE.PlaneGeometry(w, SIGN_H), mat = new THREE.MeshBasicMaterial({ map: tex });
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, _m.makeTranslation(s.x, s.y, s.z)));
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.userData.dispose = () => { geo.dispose(); mat.dispose(); tex.dispose(); im.dispose(); };
      g.add(im);
    }
  }

  function buildRoom(B, g, it) {
    const X = it.X, Z = it.Z, W = it.W, D = ROOM_D, T = WALL_T, H = WALL_H;
    const a = store.agents.get(it.id);
    const key = (a && a.project) || it.id;
    const base = THEMES[themeOf.get(key) ?? (hash(key) % THEMES.length)];
    const style = styleAt(styleOf.get(it.id) ?? hash(it.id));
    const th = { wall: wallColour(base, style), floor: floorColour(base, style), pattern: style.floor.pattern, wain: style.wain };      // the project's colours, tinted by the room's style
    const r = rng(hash(it.id));
    const b = (x, y, z, w, hh, d, col, ry) => B.box(X + x, y, Z + z, w, hh, d, col, ry);
    const rb = (x, y, z, w, hh, d, rr, col, ry) => B.rbox(X + x, y, Z + z, w, hh, d, rr, col, ry);
    const pt = (geo, x, y, z, sx, sy, sz, col, ry, rx, rz) => B.put(geo, X + x, y, Z + z, sx, sy, sz, col, ry, rx, rz);

    const shell = buildShell(B, g, X, Z, W, D, th, it.door);
    const cap = shell.cap;
    const room = {
      id: it.id, cls: it.cls, cap: CAP[it.cls], X, Z, W, D, door: it.door, hall: it.hall, slot: it.slot, vacant: false,
      chefSeat: new THREE.Vector3(X + 1.95, 0, Z + D / 2),
      doorX: X + shell.dx, doorPt: new THREE.Vector3(X + shell.dx, 0, it.door === 'back' ? Z : Z + D),
      doorPivot: shell.pivot,
      slotChar: new Array(CAP[it.cls]).fill(null),
      doorOpen: 0, overflow: 0,
    };

    // ---- chief's corner
    const cz = D / 2;
    // the polished procedural pieces: the same furniture with more shape (edge bands, drawers, a star base with casters, a stand and chin)
    const deskProc = (x, z, len = 1.24, dep = 0.66) => {
      rb(x, 0.6, z, dep, 0.05, len, 0.022, WOOD);
      rb(x, 0.572, z, dep - 0.03, 0.014, len - 0.03, 0.006, shade(WOOD, -0.3));
      b(x - 0.02, 0.29, z - len / 2 + 0.05, dep - 0.1, 0.58, 0.04, WOOD_D);
      b(x - 0.03, 0.29, z + len / 2 - 0.23, dep - 0.12, 0.54, 0.38, WOOD_D);
      for (let i = 0; i < 3; i++) {
        b(x + dep / 2 - 0.06, 0.12 + i * 0.17, z + len / 2 - 0.23, 0.012, 0.15, 0.34, shade(WOOD_D, 0.14));
        b(x + dep / 2 - 0.05, 0.12 + i * 0.17, z + len / 2 - 0.23, 0.016, 0.02, 0.1, '#e8d9b8');
      }
      b(x - dep / 2 + 0.07, 0.37, z, 0.025, 0.4, len - 0.3, shade(WOOD_D, -0.08));
    };
    const chairProc = (sx, z) => {
      pt(GEO.cyl, sx, 0.085, z, 0.08, 0.05, 0.08, METAL);
      for (let k = 0; k < 5; k++) {
        const a = k * Math.PI * 2 / 5 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
        pt(GEO.unit, sx + ca * 0.15, 0.075, z + sa * 0.15, 0.3, 0.03, 0.045, METAL, -a);
        pt(GEO.cyl, sx + ca * 0.28, 0.035, z + sa * 0.28, 0.055, 0.05, 0.055, '#23262e');
      }
      pt(GEO.cyl, sx, 0.26, z, 0.05, 0.34, 0.05, METAL);
      rb(sx, 0.465, z, 0.5, 0.09, 0.5, 0.05, CHAIR_S);
      rb(sx - 0.01, 0.505, z, 0.43, 0.035, 0.43, 0.02, shade(CHAIR_S, 0.14));
      b(sx + 0.22, 0.58, z, 0.06, 0.14, 0.07, METAL);
      rb(sx + 0.26, 0.83, z, 0.08, 0.52, 0.46, 0.04, CHAIR, 0);
      rb(sx + 0.235, 0.83, z, 0.04, 0.4, 0.38, 0.02, shade(CHAIR, 0.14));
      for (const sg of [-1, 1]) { b(sx + 0.1, 0.58, z + sg * 0.27, 0.035, 0.14, 0.035, METAL); rb(sx + 0.04, 0.665, z + sg * 0.27, 0.3, 0.035, 0.06, 0.015, CHAIR); }
    };
    // pack desks (chief: two side by side, staff: one each); `top` is where things stand, whichever desk was built
    let packDesk = false;
    for (const sg of [-1, 1]) packDesk = !!B.model('desk', X + 0.95, 0, Z + cz + sg * 0.6, { ry: Math.PI / 2, s: 1.7 });
    if (!packDesk && POLISH) { deskProc(0.95, cz - 0.58, 1.17, 0.9); deskProc(0.95, cz + 0.58, 1.17, 0.9); }
    else if (!packDesk) {
      rb(0.95, 0.615, cz, 0.9, 0.05, 2.3, 0.02, shade(WOOD, -0.12));
      b(0.95, 0.3, cz - 1.08, 0.8, 0.6, 0.06, WOOD_D);
      b(0.95, 0.3, cz + 1.08, 0.8, 0.6, 0.06, WOOD_D);
      b(0.6, 0.34, cz, 0.04, 0.5, 2.1, WOOD_D);
    }
    const top = { chef: packDesk ? 0.653 : POLISH ? 0.625 : 0.64, slot: packDesk ? 0.634 : POLISH ? 0.625 : 0.6225 };
    const monitor = (x, z, ry, w, kind, slot) => {
      const nx = Math.cos(ry), nz = -Math.sin(ry);
      const sc = w / 0.379;                                   // the pack's screen is 0.379 wide
      if (B.model('screen', X + x, top[kind], Z + z, { ry: ry + Math.PI / 2, s: sc })) {
        world.screens.push({ x: X + x + nx * (0.016 * sc + 0.004), y: top[kind] + 0.1715 * sc, z: Z + z + nz * (0.016 * sc + 0.004), ry, rx: -0.1, w: 0.355 * sc, h: 0.21 * sc, room: it.id, kind, slot });
        return;
      }
      if (POLISH) {
        pt(GEO.cyl, x, 0.652, z, 0.2, 0.018, 0.2, METAL);
        rb(x - nx * 0.02, 0.76, z - nz * 0.02, 0.035, 0.2, 0.07, 0.015, METAL, ry);
        rb(x, 0.98, z, 0.05, 0.38, w, 0.02, BEZEL, ry);
        b(x, 0.8, z, 0.052, 0.025, w - 0.02, '#1d2129', ry);
        world.screens.push({ x: X + x + nx * 0.027, y: 0.995, z: Z + z + nz * 0.027, ry, w: w - 0.07, h: 0.3, room: it.id, kind, slot });
        return;
      }
      b(x, 0.648, z, 0.2, 0.02, 0.24, METAL, ry);
      b(x - nx * 0.02, 0.76, z - nz * 0.02, 0.04, 0.22, 0.05, METAL, ry);
      b(x, 0.97, z, 0.05, 0.38, w, BEZEL, ry);
      world.screens.push({ x: X + x + nx * 0.027, y: 0.975, z: Z + z + nz * 0.027, ry, w: w - 0.06, h: 0.32, room: it.id, kind, slot });
    };
    monitor(0.74, cz - 0.4, -0.22, 0.66, 'chef', 0);
    monitor(0.74, cz + 0.4, 0.22, 0.66, 'chef', 1);
    if (B.model('keyboard', X + 1.18, top.chef, Z + cz, { ry: Math.PI / 2, s: 1.6 })) B.model('mouse', X + 1.2, top.chef, Z + cz + 0.42, { ry: Math.PI / 2, s: 1.5 });
    else if (POLISH) {
      rb(1.2, top.chef + 0.012, cz, 0.18, 0.024, 0.52, 0.009, '#e8ebf0');
      for (let i = -2; i <= 2; i++) b(1.2 + i * 0.03, top.chef + 0.026, cz, 0.014, 0.005, 0.46, '#c4c9d3');
      rb(1.24, top.chef + 0.013, cz + 0.42, 0.065, 0.026, 0.05, 0.013, '#e8ebf0');
    } else {
      b(1.2, 0.652, cz, 0.2, 0.025, 0.56, '#e8ebf0');
      b(1.22, 0.652, cz + 0.46, 0.11, 0.022, 0.07, '#e8ebf0');
    }
    pt(GEO.cyl, 1.15, top.chef + 0.065, cz - 0.86, 0.1, 0.13, 0.1, POSTERS[(r() * POSTERS.length) | 0]);
    const rot = r() * 6;
    if (!B.model('plant', X + 0.78, top.chef, Z + cz + 0.95, { h: 0.3, pal: PAL.potDesk, pk: 'desk', ry: rot })) {
      pt(GEO.pot, 0.78, top.chef + 0.05, cz + 0.95, 0.14, 0.12, 0.14, '#e9e4da');
      pt(GEO.ico, 0.78, top.chef + 0.16, cz + 0.95, 0.2, 0.18, 0.2, '#5aa85a', rot / 2);
    }

    // back-right wall: room sign (project name + session title), with posters and a clock in the space left over
    const sg0 = shell.signX0, sg1 = shell.signX1;
    const sw = Math.min(sg1 - sg0, 5.4), sh = SIGN_H;
    const scx = sg0 + Math.min(sw / 2 + 0.2, (sg1 - sg0) / 2);
    makeSign(g, room, X + scx, SIGN_Y, Z, sw, sh);
    b(scx, SIGN_Y, 0.012, sw + 0.1, sh + 0.1, 0.024, cap);
    // everything else that is not a desk, the sign or the door is the room's style: ofis-styles.js plans it, ofis-decor.js draws it (windows, lamps, furniture, extras)
    const plan = planRoom(style.id, { cls: it.cls, door: it.door, W, D, top: top.chef });
    decor.furnish({ B, kit: KIT, X, Z, W, D, plan, style, theme: th, color: a && a.color, rng: r, top: top.chef, roomId: it.id });

    // subagent desks
    const cols = COLS[it.cls];
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < 3; rr++) {
        const slot = c * 3 + rr;
        const ax = CHEF_W + c * COL_W, z = ROWS_Z[rr];
        if (!B.model('desk', X + ax + 0.55, 0, Z + z, { ry: Math.PI / 2, s: 1.65 })) {
          if (POLISH) deskProc(ax + 0.55, z);
          else {
            rb(ax + 0.55, 0.6, z, 0.64, 0.045, 1.24, 0.018, WOOD);
            b(ax + 0.55, 0.29, z - 0.57, 0.56, 0.58, 0.04, WOOD_D);
            b(ax + 0.55, 0.29, z + 0.57, 0.56, 0.58, 0.04, WOOD_D);
            b(ax + 0.28, 0.34, z, 0.03, 0.46, 1.1, WOOD_D);
          }
        }
        monitor(ax + 0.42, z, 0, 0.58, 'slot', slot);
        if (B.model('keyboard', X + ax + 0.74, top.slot, Z + z - 0.02, { ry: Math.PI / 2, s: 1.4 })) B.model('mouse', X + ax + 0.76, top.slot, Z + z + 0.34, { ry: Math.PI / 2, s: 1.4 });
        else if (POLISH) {
          rb(ax + 0.76, top.slot + 0.012, z, 0.17, 0.022, 0.46, 0.008, '#e8ebf0');
          for (let i = -2; i <= 2; i++) b(ax + 0.76 + i * 0.027, top.slot + 0.024, z, 0.012, 0.004, 0.41, '#c4c9d3');
          rb(ax + 0.78, top.slot + 0.014, z + 0.36, 0.06, 0.024, 0.045, 0.012, '#e8ebf0');
        } else b(ax + 0.76, 0.635, z, 0.18, 0.022, 0.46, '#e8ebf0');
        const item = r(), rot2 = r() * 6;
        if (item < 0.3) pt(GEO.cyl, ax + 0.55, top.slot + 0.06, z + 0.46, 0.09, 0.12, 0.09, POSTERS[(r() * POSTERS.length) | 0]);
        else if (item < 0.5) {
          if (!B.model('plant', X + ax + 0.45, top.slot, Z + z - 0.46, { h: 0.26, pal: PAL.potDesk, pk: 'desk', ry: rot2 })) {
            pt(GEO.pot, ax + 0.45, top.slot + 0.045, z - 0.46, 0.12, 0.1, 0.12, '#e9e4da'); pt(GEO.ico, ax + 0.45, top.slot + 0.145, z - 0.46, 0.17, 0.15, 0.17, '#5aa85a', rot2 / 2);
          }
        } else if (item < 0.7) b(ax + 0.62, top.slot + 0.005, z + 0.42, 0.22, 0.04, 0.3, '#f5f3ee', r() - 0.5);
        // chair (backrest toward +x)
        const sx = ax + 1.2;
        if (!B.model('chair', X + sx + 0.03, 0, Z + z, { ry: -Math.PI / 2, s: 1.76 })) {
          if (POLISH) chairProc(sx, z);
          else {
            pt(GEO.cyl, sx, 0.03, z, 0.52, 0.05, 0.52, METAL);
            pt(GEO.cyl, sx, 0.25, z, 0.06, 0.4, 0.06, METAL);
            rb(sx, 0.46, z, 0.5, 0.09, 0.5, 0.035, CHAIR_S);
            rb(sx + 0.25, 0.78, z, 0.09, 0.58, 0.48, 0.04, CHAIR);
          }
        }
        hitBox(g, X + ax + 0.75, 0.5, Z + z, 1.2, 1.0, 1.3).userData.pick = { t: 'slot', room: it.id, slot };
      }
    }

    // dark overlay (sleeping room), yellow light beam and rings (your turn)
    const ovl = new THREE.Mesh(GEO.unit, MAT.ovl);
    ovl.scale.set(W + 2 * T + 0.06, H + 0.14, D + 2 * T + 0.06);
    ovl.position.set(X + W / 2, (H + 0.14) / 2, Z + D / 2);
    ovl.visible = false; ovl.renderOrder = 4;
    g.add(ovl);
    room.ovl = ovl;

    const beamMat = new THREE.MeshBasicMaterial({ color: YELLOW, vertexColors: true, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(GEO.beam, beamMat);
    beam.position.copy(room.chefSeat); beam.visible = false; beam.renderOrder = 5; beam.userData.ownMat = true;
    g.add(beam);
    room.beam = beam;
    const discMat = new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.32, depthWrite: false });
    const disc = new THREE.Mesh(GEO.disc, discMat);
    disc.position.copy(room.chefSeat).setY(0.03); disc.visible = false; disc.renderOrder = 2; disc.userData.ownMat = true;
    g.add(disc);
    room.disc = disc;
    room.rings = [0, 1].map(() => {
      const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.7, depthWrite: false }));
      m.position.copy(room.chefSeat).setY(0.04); m.visible = false; m.renderOrder = 2; m.userData.ownMat = true;
      g.add(m);
      return m;
    });

    // pick boxes
    const fh = hitBox(g, X + W / 2, 0.03, Z + D / 2, W, 0.06, D);
    fh.userData.pick = { t: 'room', id: it.id };
    const ch = hitBox(g, X + 1.2, 0.5, Z + cz, 1.6, 1.0, 2.4);
    ch.userData.pick = { t: 'agent', id: it.id };
    const w1 = hitBox(g, X - T / 2, H / 2, Z + (D - T) / 2, T, H, D + T);
    w1.userData.pick = { t: 'block' };
    const w2 = hitBox(g, X + (W - T) / 2, H / 2, Z - T / 2, W + T, H, T);
    w2.userData.pick = { t: 'block' };

    return room;
  }

  // ---------------------------------------------------------- hall / lobby

  // The hub of the X is a cell without a chat slot, reserved for a lounge that is furnished later (ofis-layout.js). Until then it is an open plaza:
  // stone paving that runs on from the hall, a low curb on its street side, a row of planters and a round bed with a shrub. All of it is in the one batch.
  function buildPlaza(B, c) {
    const { X, Z, W, D } = c, cx = X + W / 2, cz = Z + D / 2;
    B.box(cx, 0.006, cz, W, 0.012, D, '#d6d0c2');
    B.box(cx, 0.03, Z + D - 0.12, W, 0.06, 0.24, '#b9b1a1');
    for (let k = 0; k < 4; k++) {
      const x = X + W * (0.13 + k * 0.248), z = Z + D - 0.75;
      B.put(GEO.pot, x, 0.24, z, 0.4, 0.48, 0.4, '#d9d2c4');
      B.put(GEO.ico, x, 0.72, z, 0.56, 0.62, 0.56, '#4f9f55', x);
      B.put(GEO.ico, x - 0.04, 1.0, z + 0.04, 0.38, 0.42, 0.38, '#66b35d', x * 2);
    }
    B.put(GEO.cyl, cx, 0.1, cz - 0.4, 2.6, 0.2, 2.6, '#b9b1a1');
    B.put(GEO.cyl, cx, 0.19, cz - 0.4, 2.3, 0.06, 2.3, '#7a5a40');
    B.put(GEO.ico, cx, 0.85, cz - 0.4, 1.5, 1.3, 1.5, '#4f9f55', cx);
    B.put(GEO.ico, cx + 0.2, 1.35, cz - 0.3, 0.9, 0.8, 0.9, '#66b35d', cx * 3);
  }

  function buildHalls(B, g, items, areas) {
    const T = WALL_T, H = WALL_H;
    world.lobby = null;
    world.stubs = [];                                        // the paved paths from the arms' halls to the street (verification: tools/qa/office3d-qa.mjs walks them)
    const endWall = '#e8dcc5', endCap = '#5b4636', endWain = '#b98a5c';
    world.halls.forEach((h, hi) => {
      const lobby = hi === 0;                                // the reception stays in the first hall (the bar of the X): a bay added later never moves it
      const z0 = h.z0, z1 = h.z1, hd = z1 - z0;
      const hx0 = h.x0, Wb = h.x1;                            // this hall runs from hx0 to Wb (the right end of its row, where it is entered)
      // floor: light stone tiles
      const fw = Wb - hx0 + 0.3;
      const fg = new THREE.PlaneGeometry(fw, hd).rotateX(-Math.PI / 2);
      const fuv = fg.attributes.uv;
      for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * fw / 1.1, fuv.getY(i) * hd / 1.1);
      const floor = new THREE.Mesh(fg, MAT.hall);
      floor.position.set(hx0 + fw / 2, 0.01, z0 + hd / 2);
      floor.receiveShadow = true;
      floor.userData.own = true;
      g.add(floor);
      // runner rug (runs left from the entrance)
      const rx0 = hx0 + 0.5, rx1 = Wb + 0.3;
      B.box((rx0 + rx1) / 2, 0.016, h.lane, rx1 - rx0, 0.012, 1.08, '#c9a24e');
      B.box((rx0 + rx1) / 2, 0.02, h.lane, rx1 - rx0 - 0.08, 0.012, 0.94, '#4f7f93');
      // left end wall
      const ez0 = z0 - HALL_GAP, ez1 = z1 + T;
      B.box(hx0 - T / 2, H / 2, (ez0 + ez1) / 2, T, H, ez1 - ez0, endWall);
      B.box(hx0 - T / 2, H + 0.025, (ez0 + ez1) / 2, T + 0.03, 0.05, ez1 - ez0 + 0.03, endCap);
      B.box(hx0 + 0.012, 0.43, (z0 + z1) / 2, 0.024, 0.86, hd, endWain);
      B.box(hx0 + 0.022, 0.875, (z0 + z1) / 2, 0.044, 0.045, hd, '#f3ead9');
      // entrance (right end): doormat and two planters
      B.box(Wb + 0.3, 0.02, h.lane, 0.55, 0.02, 1.3, '#3b3f48');
      for (const dz of [-1.05, 1.05]) {
        const pz = h.lane + dz;
        if (pz < z0 + 0.3 || pz > z1 - 0.3) continue;
        B.put(GEO.pot, Wb - 0.1, 0.24, pz, 0.4, 0.48, 0.4, '#d9d2c4');
        B.put(GEO.ico, Wb - 0.1, 0.72, pz, 0.56, 0.62, 0.56, '#4f9f55', pz);
        B.put(GEO.ico, Wb - 0.14, 1.0, pz + 0.04, 0.38, 0.42, 0.38, '#66b35d', pz * 2);
      }
      // every hall is entered from the street side: a row shorter than the building (an arm of the X) has a paved path across the lawn from its
      // plinth to the street's sidewalk (which starts at the plinth's right edge, ofis-env.js), the same stone and width as that sidewalk
      const px0 = h.x1 + WALL_T + PLINTH_M - 0.05, px1 = world.baseBounds.x1 - 0.05;
      if (px1 - px0 > 0.1) {
        const half = hi === world.halls.length - 1 ? 1.35 : 0.95;                  // the last entrance is the wide one in the environment
        B.box((px0 + px1) / 2, -0.012 - 0.09, h.lane, px1 - px0, 0.18, 2 * half, '#d4d7dc');
        world.stubs.push({ hall: hi, x0: px0, x1: px1, z0: h.lane - half, z1: h.lane + half });
      }

      // furniture along the back edge: keep the doors that open onto the hall clear
      const busy = [];
      for (const it of items) if (it.hall === hi && it.door === 'front') busy.push([it.X + it.W - 1.0 - 0.85, it.X + it.W - 1.0 + 0.85]);
      for (const ar of areas) if (ar.hall === hi && ar.door === 'front') busy.push([ar.x + ar.w - 1.0 - 0.85, ar.x + ar.w - 1.0 + 0.85]);
      let cur = hx0 + 0.35;
      const place = w => {
        let x = cur;
        for (let guard = 0; guard < 50; guard++) {
          const hit = busy.find(([a, b2]) => x < b2 && x + w > a);
          if (!hit) break;
          x = hit[1] + 0.05;
        }
        if (x + w > Wb - 1.4) return null;
        cur = x + w + 0.4;
        return x;
      };
      const bz = z0 + 0.55;
      const plant = x => {
        B.put(GEO.pot, x + 0.3, 0.22, bz, 0.4, 0.44, 0.4, '#c8704a');
        B.put(GEO.ico, x + 0.3, 0.72, bz, 0.62, 0.7, 0.62, '#4c9a4f', x);
        B.put(GEO.ico, x + 0.25, 1.05, bz + 0.05, 0.42, 0.44, 0.42, '#63b25c', x * 2);
      };
      if (lobby) {
        let x;
        if ((x = place(2.5)) != null) {                       // reception desk
          const cx = x + 1.25;
          B.box(cx, 0.5, bz, 2.4, 1.0, 0.62, '#f4f1ea');
          B.box(cx, 0.55, bz + 0.315, 2.2, 0.14, 0.012, '#35596b');
          B.rbox(cx, 1.025, bz, 2.54, 0.05, 0.74, 0.02, '#8a5a3a');
          B.box(cx - 0.55, 1.23, bz - 0.12, 0.5, 0.32, 0.04, BEZEL);
          B.box(cx - 0.55, 1.23, bz - 0.098, 0.44, 0.26, 0.006, '#7fb0e6');
          B.put(GEO.cyl, cx + 0.55, 1.07, bz + 0.12, 0.12, 0.05, 0.12, '#d9b25a');
          B.put(GEO.pot, cx + 0.95, 1.12, bz - 0.1, 0.18, 0.14, 0.18, '#e9e4da');
          B.put(GEO.ico, cx + 0.95, 1.26, bz - 0.1, 0.26, 0.24, 0.26, '#5aa85a', 1);
        }
        if ((x = place(0.6)) != null) plant(x);
        if ((x = place(1.4)) != null) {                       // coffee corner and water cooler
          B.box(x + 0.45, 0.42, bz, 0.9, 0.84, 0.5, '#8a5a3a');
          B.box(x + 0.45, 0.855, bz, 0.94, 0.03, 0.54, '#e9e4da');
          B.box(x + 0.3, 1.12, bz - 0.05, 0.4, 0.5, 0.36, '#2b2f38');
          B.box(x + 0.3, 1.22, bz + 0.135, 0.3, 0.12, 0.01, '#d8484a');
          B.put(GEO.cyl, x + 0.62, 0.92, bz + 0.1, 0.1, 0.1, 0.1, '#f7f4ee');
          B.put(GEO.cyl, x + 0.74, 0.92, bz + 0.02, 0.1, 0.1, 0.1, '#f7f4ee');
          B.box(x + 1.15, 0.42, bz, 0.34, 0.84, 0.34, '#e9edf2');
          B.box(x + 1.15, 0.86, bz, 0.3, 0.04, 0.3, '#cfd5de');
          B.put(GEO.cyl, x + 1.15, 1.07, bz, 0.26, 0.38, 0.26, '#8fd0ee');
        }
        if ((x = place(2.1)) != null) {                       // waiting chairs
          for (let k = 0; k < 3; k++) {
            const sx = x + 0.37 + k * 0.68;
            B.rbox(sx, 0.42, bz + 0.02, 0.62, 0.1, 0.56, 0.04, '#e07a5f');
            B.rbox(sx, 0.72, bz - 0.24, 0.62, 0.52, 0.09, 0.04, '#e07a5f');
          }
          B.box(x + 1.05, 0.2, bz, 2.05, 0.4, 0.5, '#4a505d');
        }
        if ((x = place(0.6)) != null) plant(x);
        // live summary board on the left end wall
        const sz0 = z0 + 0.35, sz1 = h.open ? z1 - 0.35 : z1 - 1.55;
        const sw = Math.min(4.2, sz1 - sz0), sh = 1.1, scz = sz0 + sw / 2, sy = 1.48;
        B.box(hx0 + 0.035, sy, scz, 0.05, sh + 0.14, sw + 0.14, '#1d222c');
        const cv = document.createElement('canvas');
        cv.height = 300; cv.width = Math.round(300 * sw / sh);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const m = new THREE.MeshBasicMaterial({ map: tex });
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), m);
        scr.rotation.y = Math.PI / 2;
        scr.position.set(hx0 + 0.064, sy, scz);
        scr.userData.own = true;
        scr.userData.dispose = () => { m.dispose(); tex.dispose(); };
        g.add(scr);
        world.lobby = { cv, tex, key: '' };
      } else {
        for (let k = 0; k < 8; k++) { const x = place(0.6); if (x == null) break; plant(x); cur += 5.5; }
      }
    });
    drawLobby();
  }

  function drawLobby() {
    const L = world.lobby;
    if (!L) return;
    const c = ctx.counts();
    const n = world.rooms.size;
    const stats = [[c.working + c.subs, msg('of.lobbyWorking'), '#4ade80'], [c.waiting, msg('of.lobbyWaiting'), YELLOW], [n, msg('of.lobbyRooms', { n }), '#a9bbd6']];
    const key = stats.map(x => x[0]).join('|');
    if (L.key === key) return;
    L.key = key;
    const g = L.cv.getContext('2d'), w = L.cv.width, h = L.cv.height;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#16202f'); bg.addColorStop(1, '#0c121c');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    g.fillStyle = '#8ea3c2';
    g.font = `700 ${Math.round(h * 0.11)}px ${SIGN_FONT}`;
    g.textBaseline = 'alphabetic';
    g.fillText(fitText(g, msg('of.lobby'), w - h * 0.28), h * 0.14, h * 0.2);
    const cw = (w - h * 0.2) / 3;
    stats.forEach(([v, label, col], i) => {
      const x = h * 0.14 + i * cw;
      g.fillStyle = col;
      g.font = `800 ${Math.round(h * 0.44)}px ${SIGN_FONT_D}`;
      g.fillText(String(v), x, h * 0.66);
      g.fillStyle = '#d7deea';
      g.font = `600 ${Math.round(h * 0.12)}px ${SIGN_FONT}`;
      g.fillText(fitText(g, label, cw - h * 0.06), x, h * 0.86);
    });
    if (c.waiting) {
      g.strokeStyle = YELLOW;
      g.lineWidth = 8;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
    L.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------- room sign: wall-mounted acrylic plaque

  let projectSub = null;
  function makeSign(g, room, x, y, z, w, h) {
    const cv = document.createElement('canvas');
    cv.height = SIGN_PX;
    cv.width = Math.min(2048, Math.round(SIGN_PX * w / h));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.BoxGeometry(w, h, 0.06);
    const mesh = new THREE.Mesh(geo, [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
    mesh.position.set(x, y, z + 0.055);
    mesh.userData.own = true;
    mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
    mesh.userData.pick = { t: 'agent', id: room.id };
    g.add(mesh);
    world.pick.push(mesh);
    // your-turn lamp: blinks at the sign's top-right corner
    const lamp = new THREE.Mesh(GEO.lamp, new THREE.MeshBasicMaterial({ color: YELLOW }));
    lamp.position.set(x + w / 2 - 0.26, y + h / 2 + 0.005, z + 0.1);
    lamp.userData.ownMat = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: YELLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    halo.position.set(lamp.position.x, lamp.position.y + 0.06, lamp.position.z + 0.08);
    halo.scale.setScalar(1.1);
    halo.userData.ownMat = true;
    halo.renderOrder = 6;
    lamp.visible = halo.visible = false;
    g.add(lamp, halo);
    Object.assign(room, { signCv: cv, signTex: tex, signFace: face, signKey: '', lamp, halo, signPos: new THREE.Vector3(x, y, z + 0.1) });
    (root.__ofisSigns || (root.__ofisSigns = new Map())).set(room.id, cv);                       // verification only: tools/qa/office-board-qa.mjs reads the plaque's pixels
    if (!projectSub) projectSub = onProjectChange(() => { for (const r of world.rooms.values()) r.signKey = ''; refreshLabels(); });       // the setting `project` shows or hides the project folder on every board
  }

  function fitText(g, s, max) {
    if (g.measureText(s).width <= max) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (g.measureText(s.slice(0, mid).trimEnd() + '…').width <= max) lo = mid; else hi = mid - 1;
    }
    return lo ? s.slice(0, lo).trimEnd() + '…' : '';
  }

  function drawSign(room, a) {
    paintPlaque(room.signCv, { name: boardName(a) || msg('of.session'), title: projectOn() ? boardProject(a) : '', color: a.color, status: a.status, overflow: room.overflow });
    room.signTex.needsUpdate = true;
  }

  // Wall sign: dark acrylic plaque in the project color, a colored band, the name big (one line, or two smaller ones) and, only when there is one, a small
  // line in the bottom-right corner (a room's project folder when the setting `project` is on; a caption on a sign of the local plugins).
  function paintPlaque(cv, o) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    const st = o.status || '', wait = st === 'waiting' || st === 'ask';
    const col = o.color || '#9a9a9a';
    g.clearRect(0, 0, w, h);
    // plaque: a dark shade of the project color with a soft sheen at the top
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, shade(col, -0.62));
    bg.addColorStop(1, shade(col, -0.78));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const gl = g.createLinearGradient(0, 0, 0, h * 0.55);
    gl.addColorStop(0, 'rgba(255,255,255,.13)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(0, 0, w, h * 0.55);
    // project-color band and frame
    const band = Math.round(h * 0.11);
    g.fillStyle = col;
    g.fillRect(0, 0, band, h);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(band, 0, 3, h);
    g.lineWidth = wait ? 12 : 7;
    g.strokeStyle = wait ? YELLOW : shade(col, 0.15);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    // screws
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (const [sx, sy] of [[band + 22, 22], [w - 22, 22], [band + 22, h - 22], [w - 22, h - 22]]) {
      g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.fill();
    }
    // top-right badge: your turn / asleep / +N
    let badgeW = 0;
    const badge = (txt, fill, ink) => {
      g.font = `700 ${Math.round(h * 0.15)}px ${SIGN_FONT}`;
      const tw = g.measureText(txt).width, bh = Math.round(h * 0.25), bw = tw + h * 0.16;
      const bx = w - bw - h * 0.12 - badgeW, by = Math.round(h * 0.1);
      g.fillStyle = fill;
      g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
      g.fillStyle = ink;
      g.textBaseline = 'middle';
      g.fillText(txt, bx + h * 0.08, by + bh / 2 + 1);
      badgeW += bw + h * 0.05;
    };
    const BADGE = { wait: [YELLOW, '#1b1405'], ask: [YELLOW, '#1b1405'], sleep: ['rgba(255,255,255,.16)', 'rgba(255,255,255,.75)'], more: ['rgba(255,255,255,.2)', '#ffffff'] };
    for (const b of boardBadges(st, o.overflow)) badge(b.key ? msg(b.key) : b.text, ...BADGE[b.kind]);
    // text: the name is big and may take two lines (it shrinks to fit, the way it always has); the small line sits at the bottom right and is never bigger than the name
    const x0 = band + h * 0.2, right = w - h * 0.14, nameMax = right - x0 - (badgeW ? badgeW + h * 0.06 : 0);
    const small = String(o.title || '').trim();
    const top = h * 0.12, bottom = small ? h * 0.78 : h * 0.88;
    const nameFont = fs => `700 ${fs}px ${SIGN_FONT_D}`;
    const fit = fitName(o.name || '', fs => s => { g.font = nameFont(fs); return g.measureText(s).width; },
      { w: nameMax, h: bottom - top, big: Math.round(h * 0.47), oneMin: Math.round(h * 0.3), twoMin: Math.round(h * 0.2), lead: 1.08 });
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff';
    g.font = nameFont(fit.fs);
    const lead = fit.fs * 1.08, y0 = (top + bottom) / 2 - lead * fit.lines.length / 2 + (lead - fit.fs) / 2 + fit.fs * 0.8;
    fit.lines.forEach((line, i) => g.fillText(line, x0, y0 + i * lead));
    if (small) {
      const sfs = Math.min(Math.round(h * 0.15), Math.round(fit.fs * 0.62));
      g.fillStyle = 'rgba(236,240,247,.78)';
      g.font = `500 ${sfs}px ${SIGN_FONT}`;
      g.textAlign = 'right';
      g.fillText(fitText(g, small, (right - x0) * 0.6), right, h * 0.9);
      g.textAlign = 'left';
    }
  }

  // ---------------------------------------------------------- optional local decorations (not in git)
  // Loaded if local/ofis-extras.js exists next to the page. The module asks for space with `areas`:
  //   [{ id, w, row: 'last' | 'first' }]  → 'last' = start of the last row (bottom-left front corner), 'first' = start of the first row.
  // The layout reserves these areas and calls `decorate(api)`; api.areas[id] draws in that area's local coordinates.

  /**
   * Local plugin contract. `decorate(api)` is called on every rebuild (it may be async); the plugin puts its
   * objects into `api.group`, a lot group or `api.areas[id].group` (never directly into the scene),
   * so they are cleaned up on rebuild. Units match the office: 1 unit ≈ 1 meter, y = 0 is the floor.
   * The camera looks from the +x +z side: on screen +x is down-right, +z down-left, -x up-left, -z up-right.
   *
   * api.THREE, api.scene, api.group, api.unit (=1), api.wallH, api.roomD
   * api.lot({ key, width, depth, side }) → THREE.Group
   *     side: 'front' (+z, bottom-left of the screen) | 'back' (-z, top-right) | 'left' (-x, top-left) | 'right' (+x, bottom-right).
   *     width runs along the edge, depth away from the building. The group is not rotated: local x ∈ [0, size.x], z ∈ [0, size.z]
   *     (group.userData.size; size = {x: width, z: depth} for front/back, {x: depth, z: width} for left/right).
   *     Lots on the same side are laid out next to each other; a ground plinth is drawn; framing and shadows cover them all.
   * api.person({ skin, hair, hairStyle 0-4, shirt, pants, skirt, sleeve, blush, pose }) → figure
   *     pose: 'stand' | 'sit' | 'sleep' | 'salute' | 'wave'; figure.setPose(p), figure.root (you add it to a group).
   *     'sit': hips at y≈0.5 (chair seat ~0.45). 'sleep': lies on its back along the z axis, root.position.y = top of the bed.
   * api.sign(text, { sub, color, width, height }) → wall sign facing +z (Mesh); same style as the office signs.
   * api.nameTag(object3d, text) → office-style name tag below the object (follows it every frame).
   * api.tooltip(object3d, html) → tooltip on hover.
   * api.onFrame(fn) → fn(tSeconds, dt) on every frame.
   * api.batch(group) → { box, rbox, cyl, pot, blob }: vertex-colored geometry merged into one mesh in the group's local space.
   * api.mat(hex) (shared Lambert), api.material(m) (disposed on rebuild), api.palette, api.shade(hex, t),
   * api.fonts, api.geo, api.rounded(w, h, d, r), api.canvasTexture(w, h, draw).
   * api.areas[id]: the areas the module reserved inside the building via `areas` (start of a row; facing the hall).
   *
   * Interaction (for interactive add-ons; everything below is optional and a no-op when unused):
   * api.camera (THREE.OrthographicCamera; zoom = screen pixels per unit), api.renderer (THREE.WebGLRenderer),
   * api.dom: the office view's root element (for overlay UI and cursor classes). Pointer events on elements the module
   *     adds to it bubble into the office handlers (pan, click); stop their propagation to keep them out.
   * api.bounds → { x0, x1, z0, z1 }: ground area of the building and the lots (a copy), or null before the first build.
   * api.footprint → [{ x0, x1, z0, z1 }]: the rectangles that actually have a floor (the building and each lot);
   *     api.bounds is their bounding box, which can include empty corners.
   * api.pickGround(clientX, clientY, y = 0) → THREE.Vector3 where the view ray under that screen point meets the
   *     horizontal plane at height y (world coordinates), or null.
   * api.onPointer(fn) → fn(type, event) with type 'move' | 'click' | 'dblclick' | 'leave' on the office view.
   *     'move' fires for pointer moves that are not a drag; 'click' for a press released without dragging.
   *     Return true to take the event over: the default action (hover tooltip, opening the drawer, resetting the view)
   *     is skipped. Registered per build, like onFrame.
   *     Drags: 'down' on every primary press (a notice). When the press moves past a few pixels, 'dragstart' is asked:
   *     return true to own that drag, and it no longer pans the view; its moves then come as 'drag' and its end as
   *     'drop' (released) or 'cancel'. A press the module did not own ends with 'up' (before any 'click').
   * api.shake(px): shakes the camera by about px screen pixels; decays in about half a second, calls add up.
   * api.wake(): counts as user activity, so the adaptive frame rate stays at full speed (call it while an animation runs).
   * api.figures() → [{ root, hip, upper, head, armL, armR, legL, legR, staff }]: every person in the office right now,
   *     the agents (staff: true) and the people made with api.person / area.person (staff: false). The office sets the
   *     staff poses every frame before onFrame callbacks run, so temporary offsets written in onFrame are safe.
   * api.pickFigure(clientX, clientY) → the person under that screen point (same shape as an api.figures() entry, plus
   *     id for an agent), or null. Tall walls in front hide the people behind them.
   * api.agentScreen(id) → { cx, cy, w, h } | null: where the agent with that id is on the screen, in CSS px from the top left of
   *     the office view (the box api.pickFigure tests, projected; cx, cy is its centre), or null when it is not in the scene.
   *     The card that opens beside a clicked agent (ofis-ui.js) is anchored to it and follows it through pan, zoom and walking.
   * api.seatOf(figure) → { x, z, aisleX, room } for a seated agent: its seat and the walking line in front of the desk
   *     (world coordinates), or null (not an agent, or walking in or out).
   * api.layout() → { width, depth, entryX, halls: [{ z0, z1, lane, x0, x1 }], rooms: [{ id, x0, x1, z0, z1, door, doorX, hall }] }:
   *     the building is an X of rows (ofis-layout.js): its interior lies in x ≤ width, z ≤ depth, and its rows are not all as long as the
   *     building, so read each hall's own length (x0 to x1; x0 is 0 for the bar). Halls run along x; lane is their walking line and each
   *     hall is entered from outside at x = entryX (a paved path joins the shorter ones to it). rooms lists the office rooms and the walled local areas; each one has
   *     its door at x = doorX on the hall side (z0 for door 'back', z1 for 'front'), opening onto halls[hall].
   * api.openDoorsNear(x, z): call it every frame while something walks through a door; the doors near that point open
   *     as they do for the agents.
   * api.fitInclude(object3d | box3): keeps that object (the world corners of its meshes' bounding boxes, read whenever
   *     the view is fitted) inside the "fit" framing and the pan limits, e.g. something floating high above the building.
   *     Registered per build.
   * api.rooms() → [{ id, status, since, center: { x, y, z }, rect: { x0, x1, z0, z1 }, chief, errorAt }]: the rooms of
   *     the current layout, one per live session. status and since come from the store (the same values the signs
   *     show); center is the middle of the room floor and rect its floor area, in world coordinates; chief is the
   *     world position { x, y, z } of the session's main agent character, or null; errorAt is when the newest failed
   *     tool call of the session (its main agent or one of its subagents) ended, or 0. Times are store times in ms,
   *     comparable with api.now().
   * api.now() → the current store time in ms.
   * api.tool → the name of the active exclusive tool (an interaction mode of a local add-on, e.g. one that takes over
   *     clicks), or null.
   * api.setTool(name | null): makes that tool the active one (null: none). Every onToolChange listener is told, so
   *     the other tools can switch themselves off. Kept across rebuilds; also mirrored as data-tool on api.dom.
   * api.onToolChange(fn) → fn(name, prev) whenever the active tool changes. Registered per build, like onFrame.
   *
   * Roads (the surroundings, ofis-env.js; world coordinates, n = -z, s = +z, e = +x, w = -x):
   * api.connectRoad({ x, z, dir: 'n' | 's' | 'e' | 'w' | { x, z }, width = 3.2, key }) → { key, points: [{ x, z }, ...],
   *     junction: { x, z }, width } | null: links a road leaving a lot at the mouth (x, z) to the nearest main road
   *     (junction, curb cut, zebra; trees and decorations keep out). points run from the mouth to the junction on the main
   *     road's centerline. The object is live (updated in place after every layout). Register again on every build.
   * api.roadNetwork() → [[{ x, z }, ...], ...]: main road centerlines; one lane each way, right-hand traffic, lane
   *     centers 1.55 to the right of the centerline.
   * api.onRoadsChange(fn) → fn({ network, roads }) after every layout of the surroundings. Registered per build.
   */
  function runExtras(g, areas) {
    const batches = [];
    const lotCur = { front: 0, back: 0, left: 0, right: 0 };
    const tips = [];
    const people = [];
    const root3 = new THREE.Group();
    g.add(root3);
    const LOT_GAP = 1.4;
    const api = {
      THREE, scene, group: root3, unit: 1, wallH: WALL_H, gap: GAP, roomD: ROOM_D,
      fonts: { text: SIGN_FONT, display: SIGN_FONT_D }, shade, rounded,
      palette: {
        skins: SKINS, hairs: HAIRS, pants: PANTS, wood: WOOD, woodDark: WOOD_D, metal: METAL, chair: CHAIR, chairSeat: CHAIR_S,
        bezel: BEZEL, books: BOOKS, posters: POSTERS, walls: THEMES.map(t => t.wall), floors: THEMES.map(t => t.floor), yellow: YELLOW,
      },
      mat: hex => mat(hex),
      material(m) { extraMats.push(m); return m; },
      geo: { box: GEO.unit, cyl: GEO.cyl, pot: GEO.pot, sphere: GEO.head, ico: GEO.ico, torso: GEO.torso, arm: GEO.arm, leg: GEO.leg, hair: GEO.hair, hairLong: GEO.hairLong, hand: GEO.hand, eye: GEO.eye },
      canvasTexture(w, h, draw) {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        draw(cv.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        extraMats.push(t);
        return t;
      },
      onFrame(fn) { extraFrame.push(fn); },
      batch(group) {
        const B = new Batch();
        batches.push({ B, grp: group || root3 });
        return {
          box: (x, y, z, sx, sy, sz, color, ry = 0) => B.box(x, y, z, sx, sy, sz, color, ry),
          rbox: (x, y, z, sx, sy, sz, r, color, ry = 0) => B.rbox(x, y, z, sx, sy, sz, r, color, ry),
          cyl: (x, y, z, dia, h, color, rx = 0, rz = 0) => B.put(GEO.cyl, x, y, z, dia, h, dia, color, 0, rx, rz),
          pot: (x, y, z, dia, h, color) => B.put(GEO.pot, x, y, z, dia, h, dia, color),
          blob: (x, y, z, sx, sy, sz, color, ry = 0) => B.put(GEO.ico, x, y, z, sx, sy, sz, color, ry),
        };
      },
      lot({ key = '', width = 8, depth = 8, side = 'front' } = {}) {
        const sd = ['front', 'back', 'left', 'right'].includes(side) ? side : 'front';
        const wd = clamp(Number(width) || 8, 1, 80), dp = clamp(Number(depth) || 8, 1, 80);
        const bb = world.baseBounds;
        const cur = lotCur[sd];
        let x0, z0, sx, sz;
        if (sd === 'front') { sx = wd; sz = dp; x0 = bb.x0 + cur; z0 = bb.z1 + LOT_GAP; }
        else if (sd === 'back') { sx = wd; sz = dp; x0 = bb.x0 + cur; z0 = bb.z0 - LOT_GAP - dp; }
        else if (sd === 'right') { sx = dp; sz = wd; x0 = bb.x1 + LOT_GAP; z0 = bb.z0 + cur; }
        else { sx = dp; sz = wd; x0 = bb.x0 - LOT_GAP - dp; z0 = bb.z0 + cur; }
        lotCur[sd] = cur + wd + LOT_GAP;
        // plinth: extends toward the building and half a gap to each side, so the lots and the building form one campus
        const h = LOT_GAP, hh = LOT_GAP / 2;
        let bx0 = x0, bx1 = x0 + sx, bz0 = z0, bz1 = z0 + sz;
        if (sd === 'front') { bz0 -= h; bx0 -= hh; bx1 += hh; }
        else if (sd === 'back') { bz1 += h; bx0 -= hh; bx1 += hh; }
        else if (sd === 'right') { bx0 -= h; bz0 -= hh; bz1 += hh; }
        else { bx1 += h; bz0 -= hh; bz1 += hh; }
        const pw = bx1 - bx0, pd = bz1 - bz0;
        const pg = new THREE.PlaneGeometry(pw, pd).rotateX(-Math.PI / 2);
        const puv = pg.attributes.uv;
        for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * pw / 1.2, puv.getY(i) * pd / 1.2);
        const plane = new THREE.Mesh(pg, MAT.slab);
        plane.position.set((bx0 + bx1) / 2, -0.002, (bz0 + bz1) / 2);
        plane.receiveShadow = true;
        plane.userData.own = true;
        g.add(plane);
        const base = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.46, pd), mat('#4a5163'));
        base.position.set((bx0 + bx1) / 2, -0.235, (bz0 + bz1) / 2);
        base.userData.own = true;
        g.add(base);
        world.lots.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 });
        const grp = new THREE.Group();
        grp.position.set(x0, 0, z0);
        grp.userData.size = { x: sx, z: sz };
        grp.userData.key = key;
        grp.userData.side = sd;
        g.add(grp);
        return grp;
      },
      person(o = {}) {
        const f = buildFigure({
          skin: o.skin || SKINS[0], hair: o.hair || HAIRS[0], style: o.hairStyle ?? o.style ?? 0,
          pants: o.pants || PANTS[0], shirt: o.shirt || '#5b8fb8', sleeve: o.sleeve, skirt: o.skirt, blush: o.blush,
        });
        f.pose = o.pose || 'stand';
        f.ph = Math.random() * 6.28;
        f.setPose = p => { f.pose = p; };
        people.push(f);
        extraFigs.push(f);
        return f;
      },
      sign(text, o = {}) {
        const sh = o.height || SIGN_H;
        const sw = o.width || clamp(1.6 + String(text).length * 0.3, 2.4, 6);
        const cv = document.createElement('canvas');
        cv.height = SIGN_PX; cv.width = Math.min(2048, Math.round(SIGN_PX * sw / sh));
        paintPlaque(cv, { name: String(text), title: o.sub || '', color: o.color || '#5b8fb8' });
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const face = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.06), [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
        mesh.userData.own = true;
        mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
        return mesh;
      },
      nameTag(obj, text) {
        const L = mkLabel('of-tagl', 45, 'down', 3, 12);
        setLabel(L, `<div class="of-tag">${esc(text)}</div>`);
        extraLabels.push(L);
        const wp = new THREE.Vector3();
        extraFrame.push(() => { obj.getWorldPosition(wp); L.pos.copy(wp); L.want = obj.visible !== false; });
        return L;
      },
      tooltip(obj, html) { tips.push([obj, html]); },
      areas: {},
      camera, renderer, dom: root,
      get bounds() { return world.bounds ? { ...world.bounds } : null; },
      get footprint() { return [world.baseBounds, ...(world.lots || [])].filter(Boolean).map(b => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 })); },
      pickGround(cx, cy, y = 0) {
        const r = root.getBoundingClientRect();
        gNdc.set((cx - r.left) / vw * 2 - 1, -((cy - r.top) / vh) * 2 + 1);
        gRay.setFromCamera(gNdc, camera);
        gPlane.set(gUp, -(Number(y) || 0));
        return gRay.ray.intersectPlane(gPlane, new THREE.Vector3());
      },
      onPointer(fn) { if (typeof fn === 'function') extraPointer.push(fn); },
      shake(px) { shakeAmp = clamp(shakeAmp + (Number(px) || 0), 0, 40); },
      wake() { lastInput = performance.now(); },
      figures() {
        const out = [];
        for (const c of chars.values()) out.push({ root: c.root, hip: c.hip, upper: c.upper, head: c.head, armL: c.armL, armR: c.armR, legL: c.legL, legR: c.legR, staff: true });
        for (const f of extraFigs) out.push({ root: f.root, hip: f.hip, upper: f.upper, head: f.head, armL: f.armL, armR: f.armR, legL: f.legL, legR: f.legR, staff: false });
        return out;
      },
      pickFigure(cx, cy) {
        const r = root.getBoundingClientRect();
        gNdc.set((cx - r.left) / vw * 2 - 1, -((cy - r.top) / vh) * 2 + 1);
        gRay.setFromCamera(gNdc, camera);
        // a tall wall in front hides the people behind it
        const walls = world.pick.filter(o => o.userData.pick && o.userData.pick.t === 'block');
        const wh = walls.length ? gRay.intersectObjects(walls, false)[0] : null;
        let best = null, bd = wh ? wh.distance : Infinity;
        const test = (f, staff, id) => {
          if (!f.root.parent || f.root.visible === false) return;
          f.hip.getWorldPosition(gV1);
          const s = f.root.getWorldScale(gV2).y;
          gBox.min.set(gV1.x - 0.34 * s, gV1.y - 0.5 * s, gV1.z - 0.34 * s);
          gBox.max.set(gV1.x + 0.34 * s, gV1.y + 1.1 * s, gV1.z + 0.34 * s);
          if (!gRay.ray.intersectBox(gBox, gV3)) return;
          const d = gV3.distanceTo(gRay.ray.origin);
          if (d < bd) { bd = d; best = { f, staff, id }; }
        };
        for (const c of chars.values()) test(c, true, c.id);
        for (const f of extraFigs) test(f, false, null);
        if (!best) return null;
        const f = best.f;
        return { root: f.root, hip: f.hip, upper: f.upper, head: f.head, armL: f.armL, armR: f.armR, legL: f.legL, legR: f.legR, staff: best.staff, id: best.id };
      },
      agentScreen: id => ui.agentBox(id),
      seatOf(fig) {
        for (const c of chars.values()) {
          if (!fig || c.root !== fig.root) continue;
          const room = world.rooms.get(c.roomId);
          if (!room || c.mode !== 'seated' || c.after === 'gone') return null;
          if (c.main) return { x: room.chefSeat.x, z: room.chefSeat.z, aisleX: room.chefSeat.x + 0.7, room: room.id };
          if (c.slot < 0) return null;
          const s = slotGeom(room, c.slot);
          return { x: s.seat.x, z: s.seat.z, aisleX: s.aisle, room: room.id };
        }
        return null;
      },
      layout() {
        const rooms = [];
        for (const r of world.rooms.values()) rooms.push({ id: r.id, x0: r.X, x1: r.X + r.W, z0: r.Z, z1: r.Z + ROOM_D, door: r.door, doorX: r.doorX, hall: r.hall });
        for (const a of world.areaList || []) {
          if (a.walled) rooms.push({ id: a.id, x0: a.x, x1: a.x + a.w, z0: a.z, z1: a.z + ROOM_D, door: a.door, doorX: a.x + a.w - 1.0, hall: a.hall });
        }
        const halls = (world.halls || []).map(h => ({ z0: h.z0, z1: h.z1, lane: h.lane, x0: h.x0, x1: h.x1 }));
        return { width: world.width || 0, depth: world.depth || 0, entryX: world.entryX || 0, halls, rooms };
      },
      openDoorsNear(x, z) { doorWalkers.push(Number(x) || 0, Number(z) || 0); },
      fitInclude(t) { if (world.group === g && t && (t.isObject3D || t.isBox3)) world.fitExtra.push(t); },
      rooms() {
        const out = [];
        for (const room of world.rooms.values()) {
          const a = store.agents.get(room.id);
          if (!a) continue;
          let errorAt = 0;
          for (const id of [a.id, ...(a.subs || [])]) {
            const evs = (typeof store.events === 'function' && store.events(id)) || [];
            for (let i = evs.length - 1; i >= 0; i--) if (evs[i].x === 1) { errorAt = Math.max(errorAt, evs[i].e || evs[i].s || 0); break; }
          }
          const c = chars.get(room.id), cp = c && c.root.position;
          out.push({
            id: room.id, status: a.status, since: a.since, errorAt,
            center: { x: room.X + room.W / 2, y: 0, z: room.Z + ROOM_D / 2 },
            rect: { x0: room.X, x1: room.X + room.W, z0: room.Z, z1: room.Z + ROOM_D },
            chief: cp ? { x: cp.x, y: cp.y, z: cp.z } : null,
          });
        }
        return out;
      },
      now() { return store.now(); },
      get tool() { return activeTool; },
      setTool(name) {
        const n = name ? String(name) : null;
        if (n === activeTool) return;
        const prev = activeTool;
        activeTool = n;
        if (n) root.dataset.tool = n; else delete root.dataset.tool;
        for (const fn of toolFns.slice()) { try { fn(n, prev); } catch { /* add-on hook */ } }
      },
      onToolChange(fn) { if (typeof fn === 'function') toolFns.push(fn); },
      // connectRoad, roadNetwork, onRoadsChange: roads from the lots to the main street (see ofis-env.js)
      ...env.roadApi(() => ({ base: world.baseBounds, lots: world.lots || [] })),
    };
    for (const ar of areas) api.areas[ar.id] = areaApi(g, ar, batches);

    // subtle idle motion for posed people
    extraFrame.push((T, dt) => {
      const k = Math.min(1, dt * 8);
      for (const f of people) {
        const p = f.pose, ph = f.ph;
        const L = (o, prop, v) => { o[prop] += (v - o[prop]) * k; };
        f.hip.rotation.x = p === 'sleep' ? -Math.PI / 2 : 0;
        f.hip.position.y = p === 'sleep' ? 0.16 : p === 'sit' ? 0.5 : 0.42;
        const legs = p === 'sit' ? -1.5 : 0;
        f.legL.rotation.x = f.legR.rotation.x = legs;
        L(f.upper.rotation, 'x', p === 'sit' ? 0.04 : Math.sin(T * 1.4 + ph) * 0.015);
        L(f.head.rotation, 'x', p === 'sleep' ? 0 : Math.sin(T * 0.9 + ph) * 0.04);
        if (p === 'wave') { L(f.armR.rotation, 'z', -2.45 + Math.sin(T * 8 + ph) * 0.38); L(f.armR.rotation, 'x', -0.25); }
        else if (p === 'salute') { L(f.armR.rotation, 'x', -2.55); L(f.armR.rotation, 'z', 0.75); }
        else if (p === 'sleep') { L(f.armR.rotation, 'x', 0); L(f.armR.rotation, 'z', 0.12); }
        else if (p === 'sit') { L(f.armR.rotation, 'x', -0.55); L(f.armR.rotation, 'z', 0.1); }
        else { L(f.armR.rotation, 'x', Math.sin(T * 1.2 + ph) * 0.05); L(f.armR.rotation, 'z', 0.08); }
        L(f.armL.rotation, 'x', p === 'sit' ? -0.55 : p === 'sleep' ? 0 : Math.sin(T * 1.2 + ph + 1) * 0.05);
        L(f.armL.rotation, 'z', p === 'sleep' ? -0.12 : -0.08);
      }
    });

    const finish = () => {
      if (world.group !== g) return;               // rebuilt in the meantime: drop the stale one
      for (const { B, grp } of batches.splice(0)) {
        if (!B.v) continue;
        const m = new THREE.Mesh(B.build(), MAT.stat);
        m.castShadow = m.receiveShadow = true;
        m.userData.own = true;
        grp.add(m);
      }
      g.updateMatrixWorld(true);
      for (const [obj, html] of tips.splice(0)) {
        if (obj.isMesh) { obj.userData.pick = { t: 'extra', html }; world.pick.push(obj); continue; }
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) continue;
        const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        const hb = hitBox(g, c.x, c.y, c.z, sz.x, sz.y, sz.z);
        hb.userData.pick = { t: 'extra', html };
      }
      applyBounds();
    };
    let ret;
    try { ret = extras.mod.decorate(api); } catch (err) { root.dataset.ekHata = String((err && err.message) || err); }
    if (ret && typeof ret.then === 'function') {
      finish();                                     // show the synchronous part right away
      ret.then(finish, err => { root.dataset.ekHata = String((err && err.message) || err); finish(); });
    } else finish();
  }

  function areaApi(g, ar, batches) {
    const grp = new THREE.Group();
    grp.position.set(ar.x, 0, ar.z);
    g.add(grp);
    const B = new Batch();
    batches.push({ B, grp });
    const own = obj => { obj.userData.own = true; return obj; };
    return {
      id: ar.id, w: ar.w, d: ROOM_D, door: ar.door, doorX: ar.w - 1.0, group: grp, origin: { x: ar.x, z: ar.z },
      // merged static geometry (one draw call, vertex-colored, shadowed)
      box: (x, y, z, sx, sy, sz, color, ry = 0) => B.box(x, y, z, sx, sy, sz, color, ry),
      rbox: (x, y, z, sx, sy, sz, r, color, ry = 0) => B.rbox(x, y, z, sx, sy, sz, r, color, ry),
      cyl: (x, y, z, dia, h, color, rx = 0, rz = 0) => B.put(GEO.cyl, x, y, z, dia, h, dia, color, 0, rx, rz),
      pot: (x, y, z, dia, h, color) => B.put(GEO.pot, x, y, z, dia, h, dia, color),
      blob: (x, y, z, sx, sy, sz, color, ry = 0) => B.put(GEO.ico, x, y, z, sx, sy, sz, color, ry),
      // same shell as the office rooms: carpet, walls, a door facing the hall and an optional wall sign
      shell(o = {}) {
        ar.walled = true;                          // walls and a door: api.layout lists it like a room
        const th = { wall: o.wall || '#e6cf9f', floor: o.floor || '#5aa877' };
        const sh = buildShell(B, grp, 0, 0, ar.w, ROOM_D, th, ar.door);
        if (o.sign) {
          const sw = Math.min(sh.signX1 - sh.signX0, o.sign.width || 5.4), sx = sh.signX0 + sw / 2 + 0.2;
          const cv = document.createElement('canvas');
          cv.height = SIGN_PX; cv.width = Math.min(2048, Math.round(SIGN_PX * sw / SIGN_H));
          paintPlaque(cv, o.sign);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = aniso;
          const face = new THREE.MeshBasicMaterial({ map: tex });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, SIGN_H, 0.06), [MAT.signSide, MAT.signSide, MAT.signSide, MAT.signSide, face, MAT.signSide]);
          mesh.position.set(sx, SIGN_Y, 0.055);
          mesh.userData.own = true;
          mesh.userData.dispose = () => { face.dispose(); tex.dispose(); };
          grp.add(mesh);
          B.box(sx, SIGN_Y, 0.012, sw + 0.1, SIGN_H + 0.1, 0.024, sh.cap);
          sh.signX0 = sx - sw / 2; sh.signX1b = sx + sw / 2;
        }
        return sh;
      },
      // a person in the same style as the office staff; the module sets the pose in its own frame callback
      person(o = {}) {
        const f = buildFigure({
          skin: o.skin || SKINS[0], hair: o.hair || HAIRS[0], style: o.style || 0, pants: o.pants || PANTS[0],
          shirt: o.shirt || '#5b8fb8', sleeve: o.sleeve, skirt: o.skirt, blush: o.blush,
        });
        grp.add(f.root);
        extraFigs.push(f);
        return f;
      },
      add(obj, shadow = true) {
        grp.add(obj);
        obj.traverse(m => { if (m.isMesh) { m.castShadow = shadow; m.receiveShadow = true; if (!m.userData.shared) m.userData.own = true; } });
        return obj;
      },
      canvasPlane(pw, ph, px, draw) {
        const cv = document.createElement('canvas');
        cv.height = px; cv.width = Math.min(2048, Math.round(px * pw / ph));
        draw(cv.getContext('2d'), cv.width, cv.height);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const m = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = own(new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m));
        mesh.userData.dispose = () => { m.dispose(); tex.dispose(); };
        grp.add(mesh);
        return mesh;
      },
      glow(color, size) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        sp.scale.setScalar(size); sp.renderOrder = 6; sp.userData.ownMat = true;
        grp.add(sp);
        return sp;
      },
      beam(color, height, r0, r1, opacity = 0.2) {
        const m = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(GEO.beam, m);
        mesh.scale.set(r1 / 0.95, height / 6, r1 / 0.95);
        mesh.userData.ownMat = true; mesh.renderOrder = 5;
        grp.add(mesh);
        return mesh;
      },
      label(html, x, y, z, o = {}) {
        const L = mkLabel(o.cls || '', o.pri ?? 80, o.mode || 'down', o.gap ?? 4, o.minZoom || 0);
        if (o.maxZoom) L.maxZoom = o.maxZoom;
        L.pos.set(ar.x + x, y, ar.z + z);
        setLabel(L, html);
        extraLabels.push(L);
        return L;
      },
      hover(x, y, z, sx, sy, sz, html) {
        const hb = hitBox(grp, x, y, z, sx, sy, sz);
        hb.userData.pick = { t: 'extra', html };
        return hb;
      },
    };
  }

  function hitBox(g, x, y, z, w, h, d) {
    const m = new THREE.Mesh(GEO.unit, MAT.stat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.visible = false;
    g.add(m);
    world.pick.push(m);
    return m;
  }

  // ---------------------------------------------------------- characters

  function shirtFor(id, base, main) {
    if (main) return base;
    const k = ((hash(id + 'g') % 7) - 3) * 0.1;
    return shade(base, k);
  }

  // Merge the plain meshes of one joint (a figure's head, an arm, a leg, the upper body) into one vertex-coloured mesh: one draw call per
  // part instead of one per piece, however much detail the figure carries. Nested joints are left as they are.
  function mergeMeshes(joint) {
    const meshes = joint.children.filter(m => m.isMesh);
    if (meshes.length < 2) return;
    const B = new Batch();
    for (const m of meshes) { m.updateMatrix(); B.add(m.geometry, m.matrix, m.material.color); joint.remove(m); }
    const mesh = new THREE.Mesh(B.build(), MAT.stat);
    mesh.castShadow = true; mesh.userData.own = true;
    joint.add(mesh);
  }

  // Cute cartoon person: everyone in the office and the local add-ons use the same figure.
  function buildFigure(o) {
    const M = (geo, col, shadow) => { const m = new THREE.Mesh(geo, mat(col)); m.castShadow = !!shadow; return m; };
    const root = new THREE.Group();
    const hip = new THREE.Group(); root.add(hip);
    const mkLeg = x => {
      const leg = new THREE.Group(); leg.position.x = x;
      leg.add(M(GEO.leg, o.pants, true));
      if (POLISH) {
        const shoe = M(rounded(0.15, 0.085, 0.26, 0.04), o.shoe || '#2f3340', true); shoe.position.set(0, -0.375, 0.05); leg.add(shoe);
        const cuff = M(GEO.cyl, shade(o.pants, 0.1)); cuff.scale.set(0.17, 0.035, 0.17); cuff.position.set(0, -0.31, 0); leg.add(cuff);
      }
      mergeMeshes(leg);
      hip.add(leg);
      return leg;
    };
    const legL = mkLeg(0.1), legR = mkLeg(-0.1);
    const upper = new THREE.Group(); hip.add(upper);
    const torso = M(GEO.torso, o.shirt, true); torso.position.y = 0.25; upper.add(torso);
    if (POLISH) { const belt = M(rounded(0.455, 0.05, 0.295, 0.02), shade(o.pants, -0.1)); belt.position.y = 0.31; upper.add(belt); }
    mergeMeshes(upper);
    if (o.skirt) { const sk = M(GEO.pot, o.skirt, true); sk.scale.set(0.5, 0.34, 0.4); sk.rotation.x = Math.PI; sk.position.y = -0.06; hip.add(sk); }
    const mkArm = x => {
      const a = new THREE.Group(); a.position.set(x, 0.42, 0);
      a.add(M(GEO.arm, o.sleeve || o.shirt, true));
      const hand = M(GEO.hand, o.skin); hand.position.y = -0.34; a.add(hand);
      mergeMeshes(a);
      upper.add(a);
      return a;
    };
    const armL = mkArm(0.27), armR = mkArm(-0.27);
    const head = new THREE.Group(); head.position.y = 0.72; upper.add(head);
    head.add(M(GEO.head, o.skin, true));
    const hair = M(GEO.hair, o.hair, true); hair.rotation.x = -0.38; head.add(hair);
    if (o.style === 1) { const bun = M(GEO.bun, o.hair, true); bun.position.set(0, 0.2, -0.17); head.add(bun); }
    if (o.style === 2) { const lh = M(GEO.hairLong, o.hair, true); lh.position.set(0, -0.12, -0.15); head.add(lh); }
    if (o.style === 3) hair.scale.set(1.04, 1.25, 1.04);
    if (o.style === 4) {
      const lh = M(GEO.hairLong, o.hair, true); lh.position.set(0, -0.2, -0.15); lh.scale.set(1.05, 1.35, 1.1); head.add(lh);
      for (const x of [0.2, -0.2]) { const side = M(GEO.hairLong, o.hair, true); side.scale.set(0.2, 1.05, 1.4); side.position.set(x, -0.16, -0.05); head.add(side); }
    }
    for (const x of [0.09, -0.09]) { const e = M(GEO.eye, '#23252d'); e.position.set(x, -0.005, 0.228); head.add(e); }
    if (o.blush) for (const x of [0.14, -0.14]) { const b = M(GEO.eye, '#f09a9a'); b.scale.set(1.3, 0.8, 0.5); b.position.set(x, -0.075, 0.2); head.add(b); }
    if (POLISH) {
      for (const x of [0.247, -0.247]) { const ear = M(GEO.hand, o.skin); ear.scale.set(0.45, 1.0, 0.8); ear.position.set(x, -0.015, 0.0); head.add(ear); }
      const nose = M(GEO.hand, shade(o.skin, -0.07)); nose.scale.setScalar(0.5); nose.position.set(0, -0.045, 0.247); head.add(nose);
      for (const x of [0.09, -0.09]) { const br = M(GEO.unit, o.hair); br.scale.set(0.075, 0.016, 0.014); br.position.set(x, 0.05, 0.232); br.rotation.z = x > 0 ? 0.14 : -0.14; br.rotation.y = x > 0 ? 0.35 : -0.35; head.add(br); }
      const sm = M(GEO.smile, '#9a4a4a'); sm.rotation.z = Math.PI; sm.position.set(0, -0.075, 0.231); head.add(sm);
    }
    mergeMeshes(head);
    return { root, hip, upper, head, armL, armR, legL, legR };
  }

  // A pack person (Kenney Mini Characters, ofis-assets.js): its bones play the old joints. The stand-in joints below are plain objects that
  // animChar moves exactly as before; applyPack copies them to the bones every frame (poseBones in ofis-rig.js turns the pack's T pose into
  // hanging arms).
  const PK_K = 1.6, PK_PIV = 0.176, PK_SEAT = 0.47;   // model scale, hip height in model units, seat height in the scene
  const PK_TOP = 0.484;                                // head top above the hip in model units
  const packKeys = Object.keys(PK).filter(k => /^p\d+$/.test(k));
  function buildPackFigure(h, shirt) {
    const key = chooseOutfit(h, packKeys);
    if (!key) return null;
    try {
      const ch = AS.personInstance(key, shirt);
      const root = new THREE.Group(), holder = new THREE.Group();
      holder.scale.setScalar(PK_K);
      holder.add(ch.root);
      root.add(holder);
      const headHost = new THREE.Group();          // old head units: the chief's headset hangs here
      headHost.scale.setScalar(1.25 / PK_K); headHost.position.set(0, 0.11, 0.0);
      ch.bones.head.add(headHost);
      const J = () => new THREE.Object3D();
      return { root, hip: J(), upper: J(), head: J(), armL: J(), armR: J(), legL: J(), legR: J(), headHost, bones: ch.bones, tinted: ch.tinted };
    } catch (e) {
      AS.warnPiece(key, 'could not be set up (' + ((e && e.message) || e) + ')');
      return null;
    }
  }
  const _pose = { armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, upper: { x: 0 }, head: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 } };
  function applyPack(c) {
    const B = c.pk, j = _pose;
    j.armL.x = c.armL.rotation.x; j.armL.z = c.armL.rotation.z; j.armR.x = c.armR.rotation.x; j.armR.z = c.armR.rotation.z;
    j.upper.x = c.upper.rotation.x; j.head.x = c.head.rotation.x; j.head.z = c.head.rotation.z; j.legL.x = c.legL.rotation.x; j.legR.x = c.legR.rotation.x;
    const p = poseBones(j);
    B.armL.rotation.set(...p.armL); B.armR.rotation.set(...p.armR); B.torso.rotation.set(...p.torso); B.head.rotation.set(...p.head);
    B.legL.rotation.set(...p.legL); B.legR.rotation.set(...p.legR);
    // hip pivot in world units: feet on the floor when standing, seat height when seated, plus the walking bob of the old hip
    const bob = c.hip.position.y - lerp(0.42, 0.5, c.sit);
    c.pivotW = lerp(PK_PIV * PK_K, PK_SEAT, c.sit) + bob;
    B.root.position.y = c.pivotW / PK_K - PK_PIV;
  }

  function makeChar(id, main, shirt) {
    let chairOf = null;
    const h = hash(id);
    const f = buildPackFigure(h, shirt) || buildFigure({ skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 4) % HAIRS.length], style: (h >>> 9) % 4, pants: PANTS[(h >>> 12) % PANTS.length], shirt });
    const { root, hip, upper, head, armL, armR, legL, legR } = f;
    const M = (geo, col, shadow) => { const m = new THREE.Mesh(geo, mat(col)); m.castShadow = !!shadow; return m; };
    if (main) {
      const hs = new Batch();
      hs.put(GEO.band, 0, 0.02, 0, 1, 1, 1, '#2b2f3a');
      for (const x of [0.27, -0.27]) hs.put(GEO.cup, x, 0, 0, 1, 1, 1, '#2b2f3a');
      hs.put(GEO.mic, 0.2, -0.12, 0.13, 1, 1, 1, '#2b2f3a', -0.6);
      hs.put(GEO.hand, 0.13, -0.13, 0.22, 0.45, 0.45, 0.45, '#e24d4d');
      const headset = new THREE.Mesh(hs.build(), MAT.stat);
      headset.userData.own = true;
      (f.headHost || head).add(headset);
      // the chief's chair turns with the person who sits in it, but stays at the desk when the person walks (animChar keeps it at c.seatPos)
      const chair = new THREE.Group(); scene.add(chair);
      chairOf = chair;
      const chairBake = PK.chair && AS.bake(PK.chair, PAL.furniture, '');
      if (chairBake) {
        const cm = new THREE.Mesh(chairBake.geo, MAT.stat);
        cm.scale.setScalar(1.76); cm.position.set(0, 0, -0.03); cm.castShadow = true;
        chair.add(cm);
      } else {
        const cm = (geo, col, x, y, z) => { const m = M(geo, col, true); m.position.set(x, y, z); chair.add(m); return m; };
        cm(GEO.base, METAL, 0, 0.03, 0);
        cm(GEO.post, METAL, 0, 0.24, 0);
        cm(GEO.seat, '#343a46', 0, 0.45, 0);
        cm(GEO.back, '#262a33', 0, 0.86, -0.27);
        cm(GEO.arm2, '#262a33', 0.29, 0.64, 0.02);
        cm(GEO.arm2, '#262a33', -0.29, 0.64, 0.02);
        mergeMeshes(chair);
      }
    }
    if (POLISH) {
      // soft contact shadow under the person and the chair
      const bl = new THREE.Mesh(GEO.blobPlane, MAT.blob);
      bl.position.y = 0.03; bl.scale.set(0.95, 0.95, 1); bl.renderOrder = 1;
      root.add(bl);
    }
    const hit = new THREE.Mesh(GEO.hit, MAT.stat);
    hit.visible = false;
    hit.userData.pick = { t: 'agent', id };
    root.add(hit);
    scene.add(root);
    const c = {
      id, main, root, hip, upper, head, armL, armR, legL, legR, hit, pk: f.bones || null, shirt, tinted: f.tinted ?? null,
      roomId: null, slot: -1, mode: 'seated', path: null, pi: 0, after: null,
      heading: -Math.PI / 2, th: -Math.PI / 2, sit: 1, walkPh: 0, ph: (h % 1000) / 159, doneAt: 0,
      tag: null, bal: null,
      // the walk (ofis-arrive.js): the route from the entrance to the seat, the distance walked on this path and its length, the pace, and the waits before moving:
      // `delay` at the entrance (not drawn yet), `standT` to stand up, `turnT` to turn around; slotWas is the desk it left, chair the chief's own, seatPos where it stands
      route: null, travelled: 0, plen: 0, pace: 1, delay: 0, standT: 0, turnT: 0, slotWas: -1, cell: -1, chair: chairOf, chairYaw: -Math.PI / 2, seatPos: null,
    };
    c.tag = mkLabel('of-tagl', main ? 70 : 40, 'down', 3, main ? 0 : 12);
    c.bal = mkLabel('of-ball', main ? 60 : 30, 'up', 6, main ? 0 : 22);
    c.tag.agent = true;
    c.tag.charId = id;
    c.tag.el.dataset.id = id;
    c.bal.el.dataset.id = id;
    return c;
  }

  // verification only: a figure's life, as root.__ofis.rec reads it
  function note(kind, c) {
    if (REC.on) REC.ev.push({ k: kind, id: c.id, main: c.main, t: performance.now(), x: c.root.position.x, z: c.root.position.z, mode: c.mode, after: c.after, vis: c.root.visible, sit: +c.sit.toFixed(2), pace: c.pace, delay: +c.delay.toFixed(3) });
  }

  // A figure leaves the scene only here, and only at the end of a walk out of the building (animChar), or when it never came in (it was still waiting at the entrance).
  function removeChar(c) {
    note('remove', c);
    scene.remove(c.root);
    c.root.traverse(o => { if (o.userData.own && o.geometry) o.geometry.dispose(); });
    if (c.chair) { scene.remove(c.chair); c.chair.traverse(o => { if (o.userData.own && o.geometry) o.geometry.dispose(); }); }
    dropLabel(c.tag);
    dropLabel(c.bal);
    const room = world.rooms.get(c.roomId);
    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
    chars.delete(c.id);
  }

  function slotGeom(room, slot) {
    const col = Math.floor(slot / 3), row = slot % 3;
    const ax = room.X + CHEF_W + col * COL_W, z = room.Z + ROWS_Z[row];
    return { seat: new THREE.Vector3(ax + 1.15, 0, z), aisle: ax + 1.9, z };
  }
  // A newcomer comes in at the building entrance (right end of the hall), walks along the hall to its room's door and sits at its desk.
  function pathFor(room, slot) {
    const s = slotGeom(room, slot);
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const hall = world.halls[room.hall];
    const lane = hall ? hall.lane : room.Z - 0.9;
    const p = [V(world.entryX, lane), V(room.doorX, lane)];
    if (room.door === 'front') {
      const fz = room.Z + ROOM_D;
      p.push(V(room.doorX, fz + 0.45), V(room.doorX, fz - 0.5), V(s.aisle, fz - 0.5));
    } else {
      p.push(V(room.doorX, room.Z - 0.75), V(room.doorX, room.Z + LANE_Z), V(s.aisle, room.Z + LANE_Z));
    }
    p.push(V(s.aisle, s.z), s.seat.clone());
    return p;
  }
  // The chief's way to the desk: the same door and hall lane, then the aisle beside the chief's seat (api.seatOf says aisleX = seat.x + 0.7), then the seat.
  function pathForChef(room) {
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const hall = world.halls[room.hall];
    const lane = hall ? hall.lane : room.Z - 0.9;
    const seat = room.chefSeat, ax = seat.x + 0.7;
    const p = [V(world.entryX, lane), V(room.doorX, lane)];
    if (room.door === 'front') {
      const fz = room.Z + ROOM_D;
      p.push(V(room.doorX, fz + 0.45), V(room.doorX, fz - 0.5), V(ax, fz - 0.5));
    } else {
      p.push(V(room.doorX, room.Z - 0.75), V(room.doorX, room.Z + LANE_Z), V(ax, room.Z + LANE_Z));
    }
    p.push(V(ax, seat.z), seat.clone());
    return p;
  }
  // the way in for a figure (entrance first, seat last): the chief's, or the sub-agent's at its desk
  const routeFor = (c, room, slot = c.slot) => (c.main ? pathForChef(room) : pathFor(room, slot));

  // ---- The walk. A figure is made at the building entrance and nowhere else, walks in (the chief and the sub-agents alike) and sits. When its job ends it stands up if it was
  // seated and walks the way it came, and is removed at the entrance. One that is still on its way in when the job ends turns around where it stands and walks back out the way
  // it came. The pure parts (the pace, the stagger, the turn, the re-path) are in ofis-arrive.js.
  const headingTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  const faceNext = c => {
    const p = c.path && c.path[c.pi], pos = c.root.position;
    if (p && Math.hypot(p.x - pos.x, p.z - pos.z) > 1e-4) c.th = headingTo(pos, p);
  };
  // `path` begins where the figure stands; `after` is what it does at the end of it: 'sit' (at its seat) or 'gone' (it is removed: the entrance)
  function startWalk(c, path, after) {
    c.path = path; c.pi = 1; c.mode = 'walk'; c.after = after;
    c.travelled = 0; c.plen = pathLength(path); c.standT = c.turnT = 0;
    if (path.length < 2) finishWalk(c);
  }
  function finishWalk(c) {
    const end = c.path && c.path[c.path.length - 1];
    if (end) { c.root.position.x = end.x; c.root.position.z = end.z; }
    c.path = null; c.delay = c.standT = c.turnT = 0;
    c.root.visible = true;
    if (c.after === 'gone') { removeChar(c); return; }
    c.mode = 'seated'; c.after = null; c.th = -Math.PI / 2;
  }
  // A newcomer comes in at the building entrance (right end of the hall), walks along the hall to its room's door and sits at its desk (the chief at the chief's).
  // `plan` is { delay, pace } from arrivalPlan: a figure that has to wait its turn is at the entrance and not drawn until it is released.
  function enter(c, room, plan, route = routeFor(c, room)) {
    c.route = route;
    c.cell = room.slot;
    c.seatPos = route[route.length - 1];
    c.root.position.set(route[0].x, 0, route[0].z);
    c.sit = 0;
    c.heading = c.th = headingTo(route[0], route[1]);
    c.pace = plan ? plan.pace : 1;
    c.delay = plan ? plan.delay : 0;
    c.root.visible = c.delay <= 0;
    startWalk(c, route.slice(), 'sit');
    if (chars.get(c.id) === c) note('create', c);
  }
  // The job is over, or the chat is: a seated figure stands up and walks the way it came, to the entrance
  function leaveRoom(c) {
    const room = world.rooms.get(c.roomId);
    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
    if (c.slot >= 0) c.slotWas = c.slot;
    c.slot = -1;
    const stand = c.sit > 0.5;
    startWalk(c, turnBack(c.route, c.route.length, c.root.position), 'gone');
    if (c.path) c.standT = stand ? STAND_S : 0;
  }
  // The job ends before the figure has reached its seat: it turns around where it stands and walks back the way it came (a figure still waiting at the entrance never
  // showed: it is just not made)
  function turnAround(c) {
    if (c.delay > 0) { removeChar(c); return; }
    const room = world.rooms.get(c.roomId), pos = c.root.position;
    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;
    if (c.slot >= 0) c.slotWas = c.slot;
    c.slot = -1;
    // a walk still on its original path turns back along the points it has passed; one that was re-routed goes back to the entrance along the route
    startWalk(c, c.path[0] === c.route[0] ? turnBack(c.path, c.pi, pos) : repath(c.route, pos, 'entrance'), 'gone');
    if (c.path) c.turnT = TURN_S;
  }
  // The other way round: the figure is on its way out and the chat (or the job) is back. It turns around and walks to its seat again, to the desk it left if that is still free.
  function comeBack(c, room) {
    let slot = -1;
    if (!c.main) {
      slot = c.slotWas >= 0 && c.slotWas < room.cap && !room.slotChar[c.slotWas] ? c.slotWas : room.slotChar.indexOf(null);
      if (slot < 0) return false;
    }
    const route = routeFor(c, room, slot);
    c.slot = slot;
    if (slot >= 0) room.slotChar[slot] = c;
    c.route = route;
    c.seatPos = route[route.length - 1];
    startWalk(c, repath(route, c.root.position, 'seat'), 'sit');
    if (c.path) c.turnT = TURN_S;
    return true;
  }
  // The office of a figure is vacant now (its chat ended or went to the shelf) and the figure is still in it: it walks out, over the route of the office it left as the hall and
  // the entrance are now. Never a vanish; a figure that never left the entrance is just not made.
  function exitVacated(c, old, entryMoved) {
    if (c.delay > 0) { removeChar(c); return; }
    if (c.slot >= 0) c.slotWas = c.slot;
    c.slot = -1;
    const walking = c.mode === 'walk' && c.path, out = walking && c.after === 'gone';
    if (out && !entryMoved) return;
    const pos = c.root.position;
    let path;
    if (old) path = repath(routeFor(c, old, Math.max(0, Math.min(c.slotWas, old.cap - 1))), pos, 'entrance');
    else if (c.route) path = repath(c.route, pos, 'entrance');
    else {                                                // no route known: to the nearest hall lane, then to the entrance
      let lane = pos.z;
      for (const h of world.halls || []) if (lane === pos.z || Math.abs(h.lane - pos.z) < Math.abs(lane - pos.z)) lane = h.lane;
      path = [{ x: pos.x, z: pos.z }, { x: pos.x, z: lane }, { x: world.entryX, z: lane }];
    }
    startWalk(c, path, 'gone');
    if (c.path) { if (!walking) c.standT = STAND_S; else if (!out) c.turnT = TURN_S; }
  }
  // The building was rebuilt (a chat came, left or slept, a room grew, a bay was added): every figure goes on from where it stands, and nobody is dropped or put in a seat at
  // once. A figure on its way keeps its walk when its room, its hall and the entrance did not move; one whose walk changed is re-pathed from where it stands; a seated one whose
  // seat moved gets up and walks to the new seat; one that no longer has a desk walks out; one whose office is vacant now walks out of it (exitVacated).
  function reconcileChars(oldRooms, oldHalls, oldEntry) {
    const spot = (r, halls, entry) => (r ? [r.X, r.Z, r.W, r.door, r.hall, halls[r.hall] && halls[r.hall].lane, entry].join() : '');
    for (const c of [...chars.values()]) {
      const room = world.rooms.get(c.roomId), old = oldRooms.get(c.roomId);
      if (!room) { exitVacated(c, old, oldEntry !== world.entryX || (!!old && spot(old, oldHalls, oldEntry) !== spot(old, world.halls, world.entryX))); continue; }
      const same = !!old && spot(old, oldHalls, oldEntry) === spot(room, world.halls, world.entryX);
      const out = c.after === 'gone', walking = c.mode === 'walk' && c.path;
      if (!c.main && !out && (c.slot < 0 || c.slot >= room.cap || room.slotChar[c.slot])) c.slot = room.slotChar.indexOf(null);
      const noDesk = !c.main && !out && c.slot < 0;
      if (!c.main && !out && c.slot >= 0) room.slotChar[c.slot] = c;
      const slot = c.slot >= 0 ? c.slot : Math.max(0, Math.min(c.slotWas, room.cap - 1));
      const route = routeFor(c, room, slot), pos = c.root.position;
      if (walking && c.delay > 0) {                          // still at the entrance, not drawn: it waits at the (new) entrance
        if (noDesk) removeChar(c); else enter(c, room, { delay: c.delay, pace: c.pace }, route);
        continue;
      }
      const moved = !same || !c.route || routeSig(c.route) !== routeSig(route);
      c.route = route;
      c.cell = room.slot;
      c.seatPos = route[route.length - 1];
      if (noDesk) {                                          // its desk is gone and no other is free: out again
        startWalk(c, repath(route, pos, 'entrance'), 'gone');
        if (c.path) { if (walking) c.turnT = TURN_S; else c.standT = STAND_S; }
        continue;
      }
      if (walking) {
        if (moved) startWalk(c, repath(route, pos, out ? 'entrance' : 'seat'), c.after);
        continue;
      }
      const seat = route[route.length - 1];
      if (Math.hypot(pos.x - seat.x, pos.z - seat.z) > 0.05) {      // its seat moved: it gets up and walks to the new one
        startWalk(c, repath(route, pos, 'seat'), 'sit');
        if (c.path) c.standT = STAND_S;
      }
    }
  }

  // ---------------------------------------------------------- sync with the data

  function syncRooms(instant) {
    const mains = store.mains().filter(a => !isShelved(a));            // an asleep chat has no room: it is on the shelf, and its office is free for another chat
    const nowMs = performance.now();
    // the slot of every chat: a new chat takes the lowest free office, an office stays with its chat; more chats than offices append a row
    const plan = slots.update(mains.map(m => ({ id: m.id, order: m.started || 0 })), nowMs);
    const saved = JSON.stringify(slots.toJSON());
    if (saved !== slotsSaved) { slotsSaved = saved; try { localStorage.setItem(SLOTS_KEY, saved); } catch { /* storage disabled */ } }
    const out = [];
    for (const m of mains) {
      let st = roomState.get(m.id);
      if (!st) roomState.set(m.id, st = { cls: null, low: 0 });
      let have = 0;
      for (const c of chars.values()) if (!c.main && c.roomId === m.id && c.after !== 'gone') have++;
      let queued = 0;
      for (const s of store.subsOf(m.id)) if (s.status === 'working' && !chars.has(s.id)) queued++;
      Object.assign(st, nextClass(st, classFor(have + queued), have, nowMs, instant));
      out.push({ id: m.id, cls: st.cls, slot: plan.slotOf.get(m.id) });
    }
    for (const id of roomState.keys()) if (!mains.some(m => m.id === id)) roomState.delete(id);
    const sig = plan.bays + '|' + out.map(o => o.id + ':' + o.slot + ':' + o.cls).join('|');
    if (sig !== world.sig || !world.group) {
      world.sig = sig;
      rebuild(out, plan);
    }
  }

  function syncChars(instant) {
    const nowMs = performance.now();
    const seen = new Set();
    const born = [];                                    // the figures made in this pass: they all begin at the entrance, one after the other (arrivalPlan)
    for (const room of world.rooms.values()) {
      const m = store.agents.get(room.id);
      if (!m) continue;
      const chef = chars.get(room.id);
      if (!chef) {
        const c = makeChar(room.id, true, m.color);
        c.roomId = room.id;
        chars.set(room.id, c);
        born.push({ c, room });
      } else if (chef.after === 'gone') comeBack(chef, room);            // it was on its way out (the chat ended or slept) and the chat is back
      seen.add(room.id);
      let overflow = 0;
      for (const s of store.subsOf(room.id)) {
        let c = chars.get(s.id);
        if (!c) {
          if (s.status !== 'working') continue;
          const slot = room.slotChar.indexOf(null);
          if (slot < 0) { overflow++; continue; }
          c = makeChar(s.id, false, shirtFor(s.id, m.color, false));
          c.roomId = room.id; c.slot = slot;
          room.slotChar[slot] = c;
          chars.set(s.id, c);
          born.push({ c, room });
        }
        seen.add(s.id);
        if (s.status === 'working') {
          c.doneAt = 0;
          if (c.after === 'gone') comeBack(c, room);                      // the job started again while it was walking out
        } else {
          if (!c.doneAt) c.doneAt = nowMs;
          if (c.mode === 'walk' && c.after === 'sit') { turnAround(c); continue; }       // the job ended before the desk: back out the way it came
        }
        if (c.mode === 'seated' && c.after !== 'gone' && c.doneAt && nowMs - c.doneAt > 4500) leaveRoom(c);
      }
      room.overflow = overflow;
    }
    // everything made in this pass comes in now: the longest walks leave first, each 0.35 s after the one before; a page load (instant) hurries a queue of more than four so that
    // all are seated within about 10 s (?arrive=calm keeps the normal pace)
    if (born.length) {
      for (const b of born) b.route = routeFor(b.c, b.room);
      const plan = arrivalPlan(born.map(b => pathLength(b.route)), { rush: instant && !CALM_LOAD });
      born.forEach((b, i) => enter(b.c, b.room, plan[i], b.route));
    }
    // a figure whose agent is gone from the data (the chat ended, the job is over) is never taken out of the scene on the spot: it walks out, or turns around if it is still coming in
    for (const c of [...chars.values()]) {
      if (seen.has(c.id) || c.after === 'gone') continue;
      if (c.delay > 0) removeChar(c);                                      // still waiting at the entrance: it never showed
      else if (!world.rooms.has(c.roomId)) exitVacated(c, null, true);
      else if (c.mode === 'walk' && c.path) turnAround(c);
      else leaveRoom(c);
    }
  }

  // ---------------------------------------------------------- label contents

  function balloonHtml(a, c) {
    if (!a) return '';
    const st = a.status;
    if (c.main) {
      if (st === 'waiting') return '<div class="of-bal wait">!</div>';
      if (st === 'ask') return '<div class="of-bal wait">?</div>';
      if (st === 'dormant') return '<div class="of-bal zz">Zz</div>';
    } else {
      if (st === 'done') return `<div class="of-bal done">${icon('check')}</div>`;
      if (st !== 'working') return `<div class="of-bal zz">${icon('zz')}</div>`;
    }
    if (st !== 'working') return '';
    const cat = (a.act && a.act.c) || 'think';
    const sm = c.main ? '' : ' sm';
    if (cat === 'think') return `<div class="of-bal think${sm}" style="--c:${catColor('think')}"><i></i><i></i><i></i></div>`;
    return `<div class="of-bal${sm}" style="--c:${catColor(cat)}">${icon(cat)}</div>`;
  }

  function refreshLabels() {
    const t = store.now();
    for (const room of world.rooms.values()) {
      const a = store.agents.get(room.id);
      if (!a) continue;
      const st = a.status;
      const wait = st === 'waiting' || st === 'ask';
      // 3D wall sign: redrawn only when its content changes
      const key = [a.project, a.title, a.name, a.color, st, room.overflow, projectOn()].join('|');
      if (room.signCv && room.signKey !== key) { room.signKey = key; drawSign(room, a); }
      if (room.signFace) room.signFace.color.set(st === 'dormant' ? '#9aa0ab' : '#ffffff');
      // from far away the wall text is unreadable, so a plain HTML fallback sign appears instead
      let L = signs.get(room.id);
      if (!L) { L = mkLabel('of-signl', 90, 'mid', 0); L.maxZoom = SIGN_HTML_BELOW; signs.set(room.id, L); }
      if (room.signPos) L.pos.copy(room.signPos);
      const chip = wait ? `<span class="of-chip w">${esc(msg(st === 'ask' ? 'of.chipAsk' : 'of.chipWait'))} · ${fmtShort(t - a.since)}</span>` : '';
      const sub = projectOn() ? boardProject(a) : '';          // the chat name in bold; the project folder only when the setting is on, small and at the right
      setLabel(L, `<div class="of-sign ${st}"><div class="r1"><span class="sw" style="background:${esc(a.color)}"></span><b>${esc(boardName(a) || msg('of.session'))}</b>${chip}</div>${sub ? `<div class="r2 of-sp">${esc(sub)}</div>` : ''}</div>`, room.id, wait ? 95 : 90);
    }
    for (const c of chars.values()) {
      const a = store.agents.get(c.id);
      if (!a) { c.bal.want = false; continue; }         // on its way out after the job: no balloon about work that is over (the name stays until it is out)
      const wait = c.main && (a.status === 'waiting' || a.status === 'ask');
      // the same text as the pixel scene's label (office-labels.js), with the "what it does" line for sub-agents too
      const room = c.main ? world.rooms.get(c.id) : null;
      const parts = labelParts(a, { main: c.main, overflow: room ? room.overflow || 0 : 0, activity: true });
      setLabel(c.tag, `<div class="px-l ${c.main ? 'px-main' : 'px-sub'} ${a.status}">${labelHtml(parts, { now: t, p: 'px' })}</div>`);
      c.tag.force = c.main;
      c.tag.rank = c.main ? (wait ? 120 : 100) : 10;      // as in the pixel scene: the chats that wait for you first, then the other main agents, then the sub-agents
      const bh = balloonHtml(a, c);
      setLabel(c.bal, bh, undefined, wait ? 100 : c.main ? 60 : a.status === 'done' ? 50 : 30);
      c.bal.want = !!bh;
      c.bal.force = wait;
      c.bal.minZoom = c.main || a.status === 'done' ? 0 : 22;
    }
  }

  function renderSum() {
    drawLobby();
    const c = ctx.counts();
    const n = world.rooms.size;
    const people = c.working + c.subs;
    sumEl.innerHTML = `<span>${msg('of.rooms', { n, b: `<b>${n}</b>` })}</span><span class="sep">·</span><span>${msg('of.working', { n: people, b: `<b>${people}</b>` })}</span><span class="sep">·</span>` +
      (c.waiting ? `<span class="w">${msg('of.waiting', { n: c.waiting, b: `<b>${c.waiting}</b>` })}</span>` : `<span>${esc(msg('of.nobody'))}</span>`);
    emptyEl.hidden = !store.ready || n > 0;
    if (store.ready && !n) emptyEl.textContent = msg('of.empty');
  }

  // ---------------------------------------------------------- frame-by-frame animation

  const tgt = { lx: 0, lz: 0, rx: 0, rz: 0, up: 0, hx: 0, hz: 0 };
  const WK = { x: 0, z: 0, path: null, pi: 0, travelled: 0, plen: 0 };      // a figure's walk, as stepWalk (ofis-arrive.js) takes it
  function animChar(c, dt, T) {
    const a = store.agents.get(c.id);
    const pos = c.root.position;
    let moving = false;

    if (c.mode === 'walk' && c.path) {
      if (c.delay > 0) {                                // waiting at the entrance, not drawn: its turn has not come
        c.delay -= dt;
        if (c.delay <= 0) { c.delay = 0; c.root.visible = true; }
      } else if (c.standT > 0) { c.standT -= dt; faceNext(c); }           // stands up first
      else if (c.turnT > 0) { c.turnT -= dt; faceNext(c); }               // turns around first
      else {
        WK.x = pos.x; WK.z = pos.z; WK.path = c.path; WK.pi = c.pi; WK.travelled = c.travelled; WK.plen = c.plen;
        const r = stepWalk(WK, dt, { pace: c.pace });
        pos.x = WK.x; pos.z = WK.z; c.pi = WK.pi; c.travelled = WK.travelled;
        moving = r.moved > 1e-6;
        c.walkPh += r.moved * (10 / WALK);              // the legs are paced by the distance, so the feet do not slide
        if (r.done) { finishWalk(c); if (!chars.has(c.id)) return; }
        else if (Math.hypot(r.hx, r.hz) > 1e-6) c.th = Math.atan2(r.hx, r.hz);
      }
    }

    let pose = 'idle';
    const st = a ? a.status : 'done';
    const cat = a && a.act ? a.act.c : 'think';
    if (c.mode === 'walk') pose = moving ? 'walk' : 'idle';
    else if (st === 'working') pose = cat === 'think' ? 'think' : 'type';
    else if (c.main && (st === 'waiting' || st === 'ask')) pose = 'wave';
    else if (st === 'dormant') pose = 'sleep';
    if (c.mode === 'seated') c.th = pose === 'wave' ? Math.PI / 4 : -Math.PI / 2;

    c.heading = angTo(c.heading, c.th, Math.min(1, dt * (c.mode === 'walk' ? 12 : 5)));
    c.root.rotation.y = c.heading;
    c.sit = lerp(c.sit, c.mode === 'seated' ? 1 : 0, Math.min(1, dt * 7));

    const ph = c.ph, sw = Math.sin(c.walkPh);
    tgt.lx = tgt.rx = -0.25; tgt.lz = -0.06; tgt.rz = 0.06; tgt.up = 0; tgt.hx = 0; tgt.hz = 0;
    if (pose === 'walk') {
      tgt.lx = sw * 0.55; tgt.rx = -sw * 0.55; tgt.up = 0.05;
    } else if (pose === 'type') {
      tgt.lx = -1.05 + Math.sin(T * 15 + ph) * 0.1; tgt.rx = -1.05 + Math.sin(T * 15 + ph + 2.4) * 0.1;
      tgt.lz = -0.16; tgt.rz = 0.16; tgt.up = 0.12; tgt.hx = 0.1 + Math.sin(T * 2 + ph) * 0.03;
    } else if (pose === 'think') {
      tgt.rx = -2.05; tgt.rz = 0.5; tgt.lx = -0.9; tgt.lz = -0.15; tgt.up = 0.04; tgt.hx = -0.06; tgt.hz = 0.12 + Math.sin(T * 1.3 + ph) * 0.05;
    } else if (pose === 'wave') {
      tgt.rx = -0.25; tgt.rz = -2.45 + Math.sin(T * 8) * 0.38; tgt.lx = -0.3; tgt.up = -0.05; tgt.hx = -0.1; tgt.hz = Math.sin(T * 3) * 0.08;
    } else if (pose === 'sleep') {
      tgt.lx = tgt.rx = -1.35; tgt.lz = -0.4; tgt.rz = 0.4; tgt.up = 0.95 + Math.sin(T * 1.6 + ph) * 0.025; tgt.hx = 0.25;
    } else {
      tgt.up = -0.06; tgt.hx = -0.04 + Math.sin(T * 1.2 + ph) * 0.03; tgt.lx = tgt.rx = -0.45;
    }
    const k = Math.min(1, dt * 10);
    c.armL.rotation.x = lerp(c.armL.rotation.x, tgt.lx, k);
    c.armL.rotation.z = lerp(c.armL.rotation.z, tgt.lz, k);
    c.armR.rotation.x = lerp(c.armR.rotation.x, tgt.rx, k);
    c.armR.rotation.z = lerp(c.armR.rotation.z, tgt.rz, k);
    c.upper.rotation.x = lerp(c.upper.rotation.x, tgt.up, k);
    c.head.rotation.x = lerp(c.head.rotation.x, tgt.hx, k);
    c.head.rotation.z = lerp(c.head.rotation.z, tgt.hz, k);
    const legSwing = pose === 'walk' ? sw * 0.6 : 0;
    c.legL.rotation.x = -1.5 * c.sit + legSwing * (1 - c.sit);
    c.legR.rotation.x = -1.5 * c.sit - legSwing * (1 - c.sit);
    // a walk is information, not decoration: with reduced motion the figure still walks, at the same pace, only without the bounce of its step
    c.hip.position.y = lerp(0.42, 0.5, c.sit) + (pose === 'walk' && !atmosphere.state.reducedMotion ? Math.abs(Math.cos(c.walkPh)) * 0.03 : 0);

    const sc = c.mode === 'walk' ? clamp((world.entryX + 0.15 - pos.x) / 0.9, 0.02, 1) : 1;
    c.root.scale.setScalar(sc);
    c.tag.off = c.bal.off = sc < 0.7 || c.delay > 0;
    if (c.chair) {                                      // the chief's chair stays at the desk, and swivels with whoever sits in it
      if (c.mode === 'seated' && c.sit > 0.5) c.chairYaw = angTo(c.chairYaw, c.heading, Math.min(1, dt * 8));
      const sp = c.seatPos || pos;
      c.chair.position.set(sp.x, 0, sp.z);
      c.chair.rotation.y = c.chairYaw;
    }
    c.tag.pos.set(pos.x, 0, pos.z);
    if (c.pk) applyPack(c);
    c.bal.pos.set(pos.x, c.pk ? c.pivotW + PK_TOP * PK_K + 0.25 : c.hip.position.y + 1.08, pos.z);
  }

  const SC = new THREE.Color();
  function stepScreens(T) {
    const sm = world.screenMesh;
    if (!sm || !sm.count) return;
    world.screens.forEach((s, i) => {
      const room = world.rooms.get(s.room);
      const m = store.agents.get(s.room);
      let col = SCR_OFF, pulse = 1;
      if (s.kind === 'chef') {
        const ch = chars.get(s.room);                                     // the chief's screen is dark until the chief has sat down, as a sub-agent's is
        if (!ch || ch.mode !== 'seated' || ch.sit < 0.85) { col = SCR_OFF; }
        else if (m && m.status === 'working') { col = catColor(m.act ? m.act.c : 'think'); pulse = s.slot ? 0.78 : 0.95 + Math.sin(T * 2.4 + i) * 0.08; }
        else if (m && m.status !== 'dormant') { col = SCR_IDLE; pulse = s.slot ? 0.8 : 1; }
      } else if (room) {
        const c = room.slotChar[s.slot];
        if (c && c.mode === 'seated' && c.sit > 0.85) {
          const a = store.agents.get(c.id);
          if (a && a.status === 'working') { col = catColor(a.act ? a.act.c : 'think'); pulse = 0.92 + Math.sin(T * 2.4 + i * 1.7) * 0.08; }
          else col = SCR_DONE;
        }
      }
      SC.set(col).multiplyScalar(pulse);
      sm.setColorAt(i, SC);
    });
    sm.instanceColor.needsUpdate = true;
  }

  function stepRooms(dt, T) {
    for (const room of world.rooms.values()) {
      const a = store.agents.get(room.id);
      const st = a ? a.status : 'dormant';
      const wait = st === 'waiting' || st === 'ask';
      room.ovl.visible = st === 'dormant';
      room.beam.visible = room.disc.visible = wait;
      room.rings.forEach((m, i) => {
        m.visible = wait;
        if (!wait) return;
        const p = (T * 0.65 + i * 0.5) % 1;
        m.scale.setScalar(1 + p * 1.7);
        m.material.opacity = 0.8 * (1 - p);
      });
      if (room.lamp) room.lamp.visible = room.halo.visible = wait;
      if (wait) {
        room.beam.material.opacity = 0.2 + wave(T * 1000, LOOP.slow) * 0.06;
        room.disc.material.opacity = 0.3 + wave(T * 1000, LOOP.slow) * 0.08;
        if (room.lamp) {
          const blink = 0.5 + 0.5 * wave(T * 1000, LOOP.quick);
          room.halo.material.opacity = 0.35 + 0.65 * blink;
          room.halo.scale.setScalar(0.9 + 0.5 * blink);
          room.lamp.material.color.set(YELLOW).multiplyScalar(0.75 + 0.35 * blink);
        }
      }
      stepDoor(room, dt);
    }
    for (const room of world.vacant || []) stepDoor(room, dt);       // an office whose person is still walking out has a real door
  }

  // The door opens for anybody who walks through it (an agent coming in or going out, the chief included, or a person of a local add-on: api.openDoorsNear)
  function stepDoor(room, dt) {
    if (!room.doorPivot) return;
    let near = false;
    for (const c of chars.values()) {
      if (c.mode !== 'walk' || c.delay > 0) continue;
      const p = c.root.position;
      if (Math.abs(p.x - room.doorPt.x) < 0.9 && Math.abs(p.z - room.doorPt.z) < 1.15) { near = true; break; }
    }
    for (let i = 0; !near && i < doorWalkers.length; i += 2) {
      if (Math.abs(doorWalkers[i] - room.doorPt.x) < 0.9 && Math.abs(doorWalkers[i + 1] - room.doorPt.z) < 1.15) near = true;
    }
    room.doorOpen = lerp(room.doorOpen, near ? 1 : 0, Math.min(1, dt * 6));
    room.doorPivot.rotation.y = -1.35 * room.doorOpen;
  }

  function step(dt, T) {
    for (const c of [...chars.values()]) animChar(c, dt, T);
    if (REC.on) for (const c of chars.values()) { note('frame', c); REC.ev[REC.ev.length - 1].dt = dt; }
    for (const fn of extraFrame) { try { fn(T, dt); } catch { /* decoration frame callback */ } }
    stepScreens(T);
    stepRooms(dt, T);
    decor.update(T, dt);
    doorWalkers.length = 0;
    env.frame(T, dt);
    for (const [id, L] of signs) {
      const room = world.rooms.get(id);
      L.want = !!room;
    }
    if (hover && hover.t === 'agent') {
      const c = chars.get(hover.id);
      if (c) { hoverRing.visible = true; hoverRing.position.set(c.root.position.x, 0.035, c.root.position.z); }
      else hoverRing.visible = false;
    } else hoverRing.visible = false;
    const sel = selectedId && chars.get(selectedId);
    if (sel) { selRing.visible = true; selRing.position.set(sel.root.position.x, 0.035, sel.root.position.z); }
    else selRing.visible = false;
  }

  // ---------------------------------------------------------- camera: fit, pan, zoom

  function projBounds() {
    const b = world.bounds;
    if (!b) return null;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    // the footprint: the paved rectangles under the building (one per row of it) and the local lots, not the box around all of them: the corners
    // between the arms of the X are empty and stay out of the frame
    for (const r of [...(world.footprint || [b]), ...(world.lots || [])]) for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) for (const y of [-0.5, WALL_H + 0.7]) {
      _v.set(x, y, z);
      const pa = _v.dot(R), pb = _v.dot(U);
      a0 = Math.min(a0, pa); a1 = Math.max(a1, pa); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb);
    }
    // objects the local module asked to keep in view (api.fitInclude): the corners of each mesh's own bounding box,
    // transformed to the world, so rotated objects do not inflate the framing
    const put = (box, m) => {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        _v.set(x, y, z);
        if (m) _v.applyMatrix4(m);
        const pa = _v.dot(R), pb = _v.dot(U);
        a0 = Math.min(a0, pa); a1 = Math.max(a1, pa); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb);
      }
    };
    for (const t of world.fitExtra || []) {
      if (t.isBox3) { if (!t.isEmpty()) put(t, null); continue; }
      t.updateWorldMatrix(true, true);
      t.traverse(o => {
        if (!o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox.isEmpty()) put(o.geometry.boundingBox, o.matrixWorld);
      });
    }
    return { a0, a1, b0, b1 };
  }
  function computeLimits() {
    const p = projBounds();
    if (!p) { lim = { a0: -1e9, a1: 1e9, b0: -1e9, b1: 1e9 }; return; }
    lim = p;
  }
  function fit() {
    const p = projBounds();
    if (!p) return;
    const narrow = vw < 640, cov = ui.covered();                     // the bar and the shelf card float over the view: the offices are framed in what they leave free
    const padT = Math.max(narrow ? 52 : 18, cov.top + 8), padB = narrow ? 12 : 16, padL = narrow ? 8 : 18, padR = Math.max(narrow ? 8 : 24, cov.right);
    const zf = Math.min((vw - padL - padR) / (p.a1 - p.a0), (vh - padT - padB) / (p.b1 - p.b0));
    zoom = clamp(zf, 3, 70);
    zMin = Math.min(zoom * 0.7, 8);
    zMax = 110;
    const ox = (padL - padR) / 2, oy = (padB - padT) / 2;
    camA = (p.a0 + p.a1) / 2 - ox / zoom;
    camB = (p.b0 + p.b1) / 2 - oy / zoom;
    applyCam();
  }
  function pan(dx, dy) {
    camA -= dx / zoom;
    camB += dy / zoom;
    autoFit = false;
    applyCam();
  }
  function zoomAt(px, py, z2) {
    z2 = clamp(z2, zMin, zMax);
    if (Math.abs(z2 - zoom) < 1e-4) return;
    const sx = px - vw / 2, sy = vh / 2 - py, k = 1 / zoom - 1 / z2;
    camA += sx * k;
    camB += sy * k;
    zoom = z2;
    autoFit = false;
    applyCam();
  }
  function doResize() {
    vw = Math.max(1, root.clientWidth);
    vh = Math.max(1, root.clientHeight);
    renderer.setSize(vw, vh, false);
    if (autoFit) fit(); else applyCam();
    renderer.shadowMap.needsUpdate = true;
  }
  new ResizeObserver(() => { resized = true; }).observe(root);

  // ---------------------------------------------------------- mouse and touch

  const ray = new THREE.Raycaster();
  const NDC = new THREE.Vector2();
  let hover = null;
  function pickAt(x, y) {
    if (!world.group) return null;
    NDC.set(x / vw * 2 - 1, -(y / vh) * 2 + 1);
    ray.setFromCamera(NDC, camera);
    const objs = world.pick.slice();
    for (const c of chars.values()) if (c.delay <= 0) objs.push(c.hit);       // a figure that still waits at the entrance is not drawn and cannot be clicked
    const hits = ray.intersectObjects(objs, false);
    for (const h of hits) {
      const p = h.object.userData.pick;
      if (!p) continue;
      if (p.t === 'block') return null;
      if (p.t === 'extra') return p;
      if (p.t === 'slot') {
        const room = world.rooms.get(p.room);
        const c = room && room.slotChar[p.slot];
        if (c) return { t: 'agent', id: c.id };
        continue;
      }
      return p;
    }
    return null;
  }

  function tipHtml(a) {
    const t = store.now();
    const head = a.kind === 'main'
      ? `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.project)}<span class="of-tn">${esc(a.name || '')}</span></div>${a.title ? `<div class="m">${esc(a.title)}</div>` : ''}`
      : `<div class="h"><span class="sq" style="background:${esc(a.color)}"></span>${esc(a.desc || a.atype || msg('agent.sub'))}</div><div class="m">${esc(a.project)} · ${esc(msg('of.subTip'))}${a.atype ? ' · ' + esc(a.atype) : ''}</div>`;
    return `<div class="of-tip">${head}<div class="of-tp">${ctx.statusPill(a, t)}</div>${ctx.activityHtml(a, t)}</div>`;
  }

  function hoverAt(e) {
    const r = root.getBoundingClientRect();
    const lab = e.target && e.target.closest ? e.target.closest('.of-l[data-id]') : null;
    let h = null;
    if (lab && root.contains(lab)) h = { t: lab.classList.contains('of-signl') ? 'room' : 'agent', id: lab.dataset.id, label: true };
    else h = pickAt(e.clientX - r.left, e.clientY - r.top);
    hover = h;
    stage.classList.toggle('hover', !!h);
    const id = h && (h.t === 'agent' || h.label) ? h.id : null;
    const a = id && store.agents.get(id);
    if (a) ctx.tip.show(tipHtml(a), e.clientX, e.clientY);
    else if (h && h.t === 'extra' && h.html) ctx.tip.show(h.html, e.clientX, e.clientY);
    else ctx.tip.hide();
  }

  const ptrs = new Map();
  let drag = null, pinch = null, clickTimer = 0;
  area.addEventListener('pointerdown', e => {
    if (e.target.closest('.of-ctl, .of-shelf-tab')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, ext: false, target: e.target };
      emitPointer('down', e);
    } else if (ptrs.size === 2) {
      const [p1, p2] = [...ptrs.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z: zoom };
      if (drag) {
        if (drag.ext) { drag.ext = false; emitPointer('cancel', e); }
        drag.moved = true;
      }
    }
    try { area.setPointerCapture(e.pointerId); } catch { /* unavailable */ }
  });
  area.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [p1, p2] = [...ptrs.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const r = root.getBoundingClientRect();
      zoomAt((p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top, pinch.z * d / pinch.d);
      return;
    }
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
        drag.moved = true;
        // a local module may take the drag over (api.onPointer 'dragstart'); otherwise it pans the view
        if (!pinch && emitPointer('dragstart', e)) drag.ext = true;
        else stage.classList.add('drag');
        ctx.tip.hide();
        hover = null;
      }
      if (drag.ext) { emitPointer('drag', e); return; }
      if (drag.moved) { pan(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY; }
      return;
    }
    if (emitPointer('move', e)) { clearHover(); return; }
    if (e.pointerType === 'mouse') hoverAt(e);
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) {
      const d = drag;
      drag = null;
      stage.classList.remove('drag');
      if (d.ext) { emitPointer(e.type === 'pointerup' ? 'drop' : 'cancel', e); return; }
      emitPointer('up', e);
      if (!d.moved && e.type === 'pointerup') click(e, d.target);
    }
  };
  area.addEventListener('pointerup', endPtr);
  area.addEventListener('pointercancel', endPtr);
  area.addEventListener('pointerleave', e => { emitPointer('leave', e); if (!drag) clearHover(); });

  function clearHover() { hover = null; ctx.tip.hide(); stage.classList.remove('hover'); }
  // local module pointer hooks (api.onPointer): true from any hook means the event was taken over
  function emitPointer(type, e) {
    let used = false;
    for (const fn of extraPointer) { try { if (fn(type, e) === true) used = true; } catch { /* add-on hook */ } }
    return used;
  }

  function click(e, target) {
    if (emitPointer('click', e)) return;
    const lab = target && target.closest ? target.closest('.of-l[data-id]') : null;
    if (lab && root.contains(lab)) { ui.openAgent(lab.dataset.id); return; }
    const r = root.getBoundingClientRect();
    const h = pickAt(e.clientX - r.left, e.clientY - r.top);
    if (!h) { ui.card.close(); return; }                         // empty scene: the card closes
    if (h.t === 'extra') return;
    if (h.t === 'agent') { ui.openAgent(h.id); return; }
    if (h.t === 'room') {
      // a single click on empty floor opens the main agent; wait briefly so a double-click can reset the view
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => ui.openAgent(h.id), 240);
    }
  }
  area.addEventListener('dblclick', e => {
    if (e.target.closest('.of-ctl, .of-shelf-tab')) return;
    if (emitPointer('dblclick', e)) return;
    clearTimeout(clickTimer);
    autoFit = true;
    fit();
  });
  area.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    zoomAt(e.clientX - r.left, e.clientY - r.top, zoom * f);
    ctx.tip.hide();
  }, { passive: false });
  root.querySelector('.of-ctl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z === 'fit') { autoFit = true; fit(); }
    else zoomAt(vw / 2, vh / 2, zoom * (b.dataset.z === 'in' ? 1.3 : 1 / 1.3));
  });

  // ---------------------------------------------------------- loop

  let errLogged = false, frameMs = 0;
  function logOnce(where, err) {
    if (errLogged) return;
    errLogged = true;
    root.dataset.hata = `${where}: ${(err && err.message) || err}`;
    console.error(`Office (${where}):`, err);
  }

  function sync() {
    try {
      ui.sync();
      if (!store.ready) { renderSum(); return; }
      const instant = instantNext;
      syncRooms(instant);
      syncChars(instant);
      instantNext = false;
      refreshLabels();
      renderSum();
      renderer.shadowMap.needsUpdate = true;
    } catch (err) { logOnce('sync', err); }
  }

  // Adaptive frame rate: full speed only while someone is interacting with a focused window;
  // idle, unfocused, slow or software-rendered pages draw far fewer frames.
  let lastInput = performance.now(), frameNo = 0;
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) {
    root.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  }
  function frameInterval(now) {
    if (SOFTWARE_GL) return 1000 / 8;
    let fps = now - lastInput > 45e3 || !document.hasFocus() ? 15 : 1000 / FRAME_MS;
    if (frameMs > 18) fps = Math.min(fps, 15);
    return 1000 / fps;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { lastT = 0; return; }
    if (lastT && now - lastT < frameInterval(now) - 2) return;
    if (++frameNo % 12 === 0) renderer.shadowMap.needsUpdate = true;
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 30;
    lastT = now;
    try {
      const t0 = performance.now();
      if (resized) { resized = false; doResize(); }
      step(dt, now / 1000);
      // camera shake (api.shake): a temporary screen-space offset that is removed again right after drawing
      let shX = 0, shY = 0;
      if (shakeAmp > 0.2) {
        const T = now / 1000;
        shX = shakeAmp * (Math.sin(T * 91) * 0.6 + Math.sin(T * 57 + 1.3) * 0.4);
        shY = shakeAmp * (Math.sin(T * 83 + 2.1) * 0.6 + Math.sin(T * 49 + 0.4) * 0.4);
        shakeAmp *= Math.exp(-dt * 6);
        camera.position.addScaledVector(R, shX / zoom).addScaledVector(U, shY / zoom);
        camera.updateMatrixWorld();
      } else shakeAmp = 0;
      try {
        renderer.render(scene, camera);
        placeLabels();
        ui.card.place();
      } finally {
        if (shX || shY) { camera.position.addScaledVector(R, -shX / zoom).addScaledVector(U, -shY / zoom); camera.updateMatrixWorld(); }
      }
      frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
    } catch (err) { logOnce('frame', err); }
  }

  // optional local decoration module: if missing (404) or broken it is skipped silently and no space is reserved
  (async () => {
    try {
      const url = new URL('local/ofis-extras.js', document.baseURI).href;
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return;
      const mod = await import(url);
      if (typeof mod.decorate !== 'function') return;
      const list = Array.isArray(mod.areas) ? mod.areas : [{ id: 'main', w: mod.width, row: 'last' }];
      const areas = list.filter(x => x && x.id).map(x => ({ id: String(x.id), w: clamp(Number(x.w) || 6.5, 3, 16), row: x.row === 'first' ? 'first' : 'last' }));
      if (!areas.length) return;
      extras = { mod, areas };
      world.sig = '';
      if (visible) sync();
    } catch { /* no add-on */ }
  })();

  // read-only state for verification (from the console: document.querySelector('#view-ofis').__ofis)
  root.__ofis = {
    get zoom() { return zoom; }, get size() { return [vw, vh]; }, get autoFit() { return autoFit; },
    get rooms() { return [...world.rooms.values()].map(r => ({ id: r.id, W: +r.W.toFixed(2), X: +r.X.toFixed(2), Z: r.Z, cls: r.cls, slot: r.slot })); },
    get chars() { return chars.size; },
    get selection() { return selRing.visible ? { id: selectedId, at: this.project(selRing.position.x, 0.035, selRing.position.z) } : null; },       // the agent whose card is open and where its ring is on the screen
    project(x, y, z) { PV.set(x, y, z).project(camera); return [(PV.x + 1) / 2 * vw, (1 - PV.y) / 2 * vh]; },
    charScreen(id) { const c = chars.get(id); if (!c) return null; const p = c.root.position; return this.project(p.x, 0.8, p.z); },
    get frameMs() { return +frameMs.toFixed(2); },
    get calls() { return renderer.info.render.calls; },
    get env() { return env.stats; },
    get walking() { return [...chars.values()].filter(c => c.mode === 'walk').map(c => c.id); },
    subs() { return [...chars.values()].filter(c => !c.main).map(c => ({ id: c.id, mode: c.mode, room: c.roomId })); },
    // Verification only, the app never calls these (tools/qa/office3d-walk-qa.mjs, the QA that expects seated figures). settle() ends every walk at once: a figure on its way in is
    // seated at its desk, one on its way out is removed at the entrance, one still waiting at the entrance is released and seated; it returns how many walks it ended.
    // rec.start() begins to record every figure's creation, removal and place on every frame (events { k: 'create' | 'frame' | 'remove', id, t, dt, x, z, mode, after, vis, ... });
    // rec.take() returns what was recorded since and clears it, rec.stop() stops.
    settle() {
      let n = 0;
      for (const c of [...chars.values()]) {
        if (c.mode !== 'walk' || !c.path) continue;
        n++;
        finishWalk(c);
        if (chars.get(c.id) === c) { c.sit = 1; c.heading = c.th; }
      }
      return n;
    },
    rec: { start() { REC.ev.length = 0; REC.on = true; }, take() { return REC.ev.splice(0); }, stop() { REC.on = false; REC.ev.length = 0; } },
    get pace() { return Object.fromEntries([...chars.values()].map(c => [c.id, c.pace])); },
  };

  return {
    show() {
      visible = true;
      ui.setVisible(true);
      instantNext = true;
      resized = true;
      sync();
      lastT = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    hide() {
      visible = false;
      ui.setVisible(false);
      cancelAnimationFrame(raf);
      clearTimeout(clickTimer);
    },
    update() {
      if (visible) sync();
    },
  };
}
