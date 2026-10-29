// glTF models for the 3D office (Kenney Furniture Kit, Nature Kit and Mini Characters, all CC0; see THIRD_PARTY.md). Everything a pack
// ships is turned into the scene's own look:
//  - furniture, trees and rocks are BAKED into vertex-coloured geometry, so the room batch and the instanced trees stay one draw call each
//    whatever the pack's materials were; every colour goes through a palette map (ofis-rig.js), the files stay untouched,
//  - people keep their skeleton and are posed by the scene's own animation code (the bones play the old joints); their colours are baked
//    into a vertex colour per person, with the outfit's top in the agent's colour, so no texture is made per agent.
// A file that is blocked, slow or broken is not an error: the piece is left out of `packs.models`, one console warning names it, and the
// scene draws its procedural shape instead (ofis.js and ofis-env.js ask `packs.models[key]` and fall back on undefined).
import * as THREE from 'three';
import { parseLook, manifestFor, judge, createWarner, warnText, rawSRGB, OUTFITS, ATLAS } from './ofis-rig.js';

export const look = parseLook(location.search);

const LOAD_TIMEOUT_MS = 10000;
const warn = createWarner(t => console.warn(t));
let skClone = null;

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer after ' + ms / 1000 + ' s: ' + what)), ms))]);
const factsOf = scene => {
  const f = { meshes: 0, skinned: 0, bones: [] };
  scene.traverse(o => {
    if (o.isBone) f.bones.push(o.name);
    else if (o.isSkinnedMesh) f.skinned++;
    else if (o.isMesh && o.geometry.attributes.position && o.geometry.attributes.normal) f.meshes++;
  });
  return f;
};

// -> { models: { key: { scene, url, rawSRGB } }, failed: Map(key -> reason) }; never rejects
async function loadPacks(manifest) {
  const keys = Object.keys(manifest), models = {}, failed = new Map();
  if (!keys.length) return { models, failed };
  const fail = (key, why) => { failed.set(key, why); warn(key, warnText(key, manifest[key], why)); };
  let loader;
  try {
    const [{ GLTFLoader }, su] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js')]);
    loader = new GLTFLoader();
    skClone = su.clone;
  } catch (e) {
    keys.forEach(k => fail(k, 'the glTF loader did not load (' + (e && e.message || e) + ')'));
    return { models, failed };
  }
  await Promise.all(keys.map(async key => {
    const url = manifest[key];
    try {
      const g = await withTimeout(loader.loadAsync(url), LOAD_TIMEOUT_MS, url);
      const why = judge(key, factsOf(g.scene));
      if (why) fail(key, why); else models[key] = { scene: g.scene, url, rawSRGB: rawSRGB(url) };
    } catch (e) { fail(key, String((e && e.message) || e).slice(0, 160)); }
  }));
  return { models, failed };
}
export const packs = await loadPacks(manifestFor(look));
// a piece that loaded but could not be used (set-up failed): the same single warning as for a file that did not load
export const warnPiece = (key, why) => warn(key, warnText(key, packs.models[key] ? packs.models[key].url : key, why));

// ------------------------------------------------------------ textures sampled per vertex (the people's colour atlas)

const samplers = new WeakMap();
function texSampler(tex) {
  let s = samplers.get(tex);
  if (s) return s;
  const img = tex.image, cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, cv.width, cv.height).data;
  s = (u, v) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * cv.height)));   // glTF uv: origin top-left
    const i = (y * cv.width + x) * 4;
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
  };
  s.w = cv.width; s.h = cv.height;
  samplers.set(tex, s);
  return s;
}

// ------------------------------------------------------------ baked static geometry

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3(), _lin = new THREE.Color(), _m4 = new THREE.Matrix4();
const bakeCache = new Map();

/**
 * Merge every mesh of a model into one BufferGeometry { position, normal, color } with the model standing on y = 0, centred on x/z
 * (its own bounding box). `key` tells two palettes of one model apart. Returns { geo, size: Vector3 } or null when the model has no mesh.
 */
export function bake(src, palette, key = '') {
  const ck = src.url + '|' + key + '|' + (palette ? palette.id : '');
  let hit = bakeCache.get(ck);
  if (hit) return hit;
  src.scene.updateMatrixWorld(true);
  const P = [], N = [], C = [], I = [];
  let base = 0;
  src.scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry.attributes.position || !o.geometry.attributes.normal) return;
    const geo = o.geometry, mats = Array.isArray(o.material) ? o.material : [o.material];
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    _m4.copy(o.matrixWorld);
    _nm.getNormalMatrix(_m4);
    // one colour per material (its own colour through the palette), sampled from its texture instead when it has one
    const mc = mats.map(m => {
      const c = src.rawSRGB ? _lin.setRGB(m.color.r, m.color.g, m.color.b, THREE.SRGBColorSpace) : m.color;
      return palette ? palette(m.name, [c.r, c.g, c.b]) : [c.r, c.g, c.b];
    });
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : pos.count, materialIndex: 0 }];
    const vm = new Int16Array(pos.count).fill(-1);     // the material of the first group that uses a vertex
    const idx = geo.index ? geo.index.array : null;
    for (const g of groups) for (let k = g.start; k < g.start + g.count; k++) { const vi = idx ? idx[k] : k; if (vm[vi] < 0) vm[vi] = g.materialIndex || 0; }
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(_m4); P.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize(); N.push(_n.x, _n.y, _n.z);
      const mi = Math.max(0, vm[k]) % mats.length;
      let c = mc[mi];
      const map = mats[mi].map;
      if (map && uv) { const s = texSampler(map)(uv.getX(k), uv.getY(k)); _lin.setRGB(s[0], s[1], s[2], THREE.SRGBColorSpace); c = palette ? palette(mats[mi].name, [_lin.r, _lin.g, _lin.b]) : [_lin.r, _lin.g, _lin.b]; }
      C.push(c[0], c[1], c[2]);
    }
    if (idx) for (let k = 0; k < idx.length; k++) I.push(base + idx[k]);
    else for (let k = 0; k < pos.count; k++) I.push(base + k);
    base += pos.count;
  });
  if (!base) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  hit = { geo, size: geo.boundingBox.getSize(new THREE.Vector3()) };
  bakeCache.set(ck, hit);
  return hit;
}

// y levels (in the baked model's own units) of the shelf boards: clusters of upward-facing triangles with a large area
export function boardTops(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index.array;
  const acc = new Map();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if ((nor.getY(a) + nor.getY(b) + nor.getY(c)) / 3 < 0.98) continue;
    A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b); C.fromBufferAttribute(pos, c);
    const area = B.sub(A).cross(C.sub(A)).length() / 2;
    const key = Math.round(((pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3) * 50);
    acc.set(key, (acc.get(key) || 0) + area);
  }
  const arr = [...acc].sort((p, q) => p[0] - q[0]);
  if (!arr.length) return [];
  const mx = Math.max(...arr.map(x => x[1]));
  return arr.filter(x => x[1] >= mx * 0.3).map(x => x[0] / 50);
}

// ------------------------------------------------------------ people (skinned, posed by the scene's code)

let personMat = null;
const lumaOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const preps = new Map();
// Once per outfit: for every skinned mesh the colour each vertex takes from the pack's colour atlas (linear), and for the vertices of the
// outfit's top (torso and arm bones, in the cells the table names) the factor that keeps the atlas's own light-to-dark gradient.
function prepOutfit(key, src) {
  let p = preps.get(key);
  if (p) return p;
  const cells = new Set(OUTFITS.find(o => o.key === key).tint.map(c => c.join(',')));
  p = [];
  src.scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry, uv = geo.attributes.uv, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, n = uv.count;
    const names = o.skeleton.bones.map(b => b.name), map = o.material.map, sample = texSampler(map);
    const base = new Float32Array(n * 3), k = new Float32Array(n).fill(-1), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i), v = uv.getY(i), s = sample(u, v);
      c.setRGB(s[0], s[1], s[2], THREE.SRGBColorSpace);
      base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
      const cx = Math.min(ATLAS.cols - 1, Math.floor(u * ATLAS.cols)), cy = Math.min(ATLAS.rows - 1, Math.floor(v * ATLAS.rows));
      if (!cells.has(cx + ',' + cy)) continue;
      let best = 0;
      for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, best)) best = j;
      if (!/^(torso|arm-)/.test(names[si.getComponent(i, best)])) continue;      // pants and shoes may share the cell
      const light = sample(cx / ATLAS.cols + 1 / sample.w, cy / ATLAS.rows + 1 / sample.h);
      c.setRGB(light[0], light[1], light[2], THREE.SRGBColorSpace);
      const lt = lumaOf([c.r, c.g, c.b]) || 1;
      k[i] = Math.max(0.4, Math.min(1.3, lumaOf([base[i * 3], base[i * 3 + 1], base[i * 3 + 2]]) / lt));
    }
    p.push({ name: o.name, base, k });
  });
  preps.set(key, p);
  return p;
}

/** A fresh posable copy of an outfit: { root (Group), bones { root, torso, head, armL, armR, legL, legR } }; `shirt` (a hex colour) goes on the outfit's top */
export function personInstance(key, shirt) {
  const src = packs.models[key];
  const prep = prepOutfit(key, src);
  const obj = skClone(src.scene), bones = {};
  const tint = shirt ? new THREE.Color(shirt) : null;
  if (!personMat) personMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  obj.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isSkinnedMesh) return;
    const p = prep.find(x => x.name === o.name), n = p.k.length, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = tint && p.k[i] >= 0;
      col[i * 3] = t ? tint.r * p.k[i] : p.base[i * 3]; col[i * 3 + 1] = t ? tint.g * p.k[i] : p.base[i * 3 + 1]; col[i * 3 + 2] = t ? tint.b * p.k[i] : p.base[i * 3 + 2];
    }
    // own geometry object (sharing the pack's attribute buffers) so that each person carries its own colours
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(o.geometry.attributes)) g.setAttribute(name, a);
    g.setIndex(o.geometry.index);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.geometry = g;
    o.userData.own = true;
    o.material = personMat;
    o.castShadow = true; o.frustumCulled = false;
  });
  return { root: obj, bones: { root: bones.root, torso: bones.torso, head: bones.head, armL: bones['arm-left'], armR: bones['arm-right'], legL: bones['leg-left'], legR: bones['leg-right'] } };
}
