// The read of tools/qa/office3d-coplanar-qa.mjs: the faces the camera sees of every static mesh of the built 3D scene, in world space, through the page's read-only getter `o.scene`
// (public/js/ofis.js). Split from the QA so that a dev script can import it.
import { o3 } from './harness3d.mjs';

// the camera of the scene looks along -VIEW (public/js/ofis.js: VIEW): only a face turned towards it can be seen
const VIEW = (() => { const l = Math.hypot(1, 0.9, 1); return [1 / l, 0.9 / l, 1 / l]; })();

// ---- the read, run inside the page. The faces the camera sees of every static mesh, in world space: one row of 13 numbers per triangle
// (mesh, source index, colour, texture, the three corners). Not read: figures (they move), meshes that are hidden, transparent, or do not write depth (glass, rings, beams).
export const PAGE = `(() => {
  const scene = o.scene, VIEW = ${JSON.stringify(VIEW)};
  scene.updateMatrixWorld(true);
  const rows = [], meshes = [], texes = new Map();
  const M = new (scene.matrixWorld.constructor)(), IM = new (scene.matrixWorld.constructor)();
  const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  scene.traverse(obj => {
    if (!obj.isMesh || obj.isSkinnedMesh) return;
    for (let p = obj; p; p = p.parent) if (!p.visible || (p.userData && p.userData.figureOf)) return;
    const geo = obj.geometry, pos = geo.attributes.position;
    if (!pos) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (mat.transparent || mat.depthWrite === false || mat.visible === false) return;
    let ti = 0;
    if (mat.map) { if (!texes.has(mat.map.uuid)) texes.set(mat.map.uuid, texes.size + 1); ti = texes.get(mat.map.uuid); }
    const mi = meshes.length;
    meshes.push({ type: obj.type, own: !!obj.userData.own, inst: obj.isInstancedMesh ? obj.count : 0, verts: pos.count, vc: !!mat.vertexColors, map: !!mat.map, side: mat.side, src: geo.userData.src || null });
    const idx = geo.index ? geo.index.array : null, ntri = (idx ? idx.length : pos.count) / 3, ca = geo.attributes.color, src = geo.userData.src;
    const base = mat.color ? mat.color.getHex() : 0xffffff;
    const nInst = obj.isInstancedMesh ? obj.count : 1;
    for (let k = 0; k < nInst; k++) {
      M.copy(obj.matrixWorld);
      if (obj.isInstancedMesh) { obj.getMatrixAt(k, IM); M.multiply(IM); }
      const e = M.elements;
      for (let t = 0; t < ntri; t++) {
        const ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
        [ia, ib, ic].forEach((v, q) => {
          const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
          P[q * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[q * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[q * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        });
        const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) continue;
        let f = (nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2]) / len;
        if (mat.side === 1) f = -f;                                // BackSide: the face is the other way round
        else if (mat.side === 2) f = Math.abs(f);
        if (f <= 0.02) continue;
        let col = base;
        if (ca) { const r = (ca.getX(ia) + ca.getX(ib) + ca.getX(ic)) / 3, g = (ca.getY(ia) + ca.getY(ib) + ca.getY(ic)) / 3, b = (ca.getZ(ia) + ca.getZ(ib) + ca.getZ(ic)) / 3; col = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255); }
        let si = -1;
        if (src) { let lo = 0, hi = src.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (src[mid][0] <= ia) lo = mid; else hi = mid - 1; } si = lo; }
        // a BackSide triangle is handed over turned round (b and c swapped), so that its normal is the side the camera sees
        if (mat.side === 1 || (mat.side === 2 && (nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2]) < 0)) rows.push(mi, si, col, ti, P[0], P[1], P[2], P[6], P[7], P[8], P[3], P[4], P[5]);
        else rows.push(mi, si, col, ti, P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], P[8]);
      }
    }
  });
  const f = new Float32Array(rows), u8 = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { b64: btoa(s), n: rows.length / 13, meshes: meshes.map(m => ({ ...m, src: null })), src: Object.fromEntries(meshes.map((m, i) => [i, m.src]).filter(([, s]) => s)) };
})()`;

// the triangles of one scene, plus how to name them
export async function readScene(page) {
  await page.evaluate(o3('o.draw()'));
  const J = await page.evaluate(o3(PAGE));
  const buf = Buffer.from(J.b64, 'base64'), f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const tris = [];
  for (let i = 0; i < J.n; i++) {
    const q = i * 13;
    tris.push({ mesh: f[q], si: f[q + 1], col: f[q + 2], tex: f[q + 3], a: [f[q + 4], f[q + 5], f[q + 6]], b: [f[q + 7], f[q + 8], f[q + 9]], c: [f[q + 10], f[q + 11], f[q + 12]] });
  }
  return { tris, meshes: J.meshes, src: J.src };
}

