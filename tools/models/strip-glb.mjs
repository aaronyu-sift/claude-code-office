// Makes a GLB smaller without touching what the scene draws: removes the animation clips (the Office poses the bones itself, see
// public/js/ofis-assets.js), the vertex attributes that its Lambert material never reads (TANGENT and the second uv set) and every
// accessor and buffer view that nothing uses any more, then writes the binary chunk again. Idempotent: a stripped file comes out unchanged.
//
//   node tools/models/strip-glb.mjs public/models/kenney-mini/character-male-a.glb ...     (in place)
//   node tools/models/strip-glb.mjs --dry <files>                                            (prints the sizes only)
//   node tools/models/strip-glb.mjs --keep-animations <files>                                (only drops what is unused)
//
// The Kenney Mini Characters ship 32 clips each (idle, walk, die, wheelchair moves, ...); the clips are about 35 KB of the first file's binary
// chunk and most of its 105 KB of JSON. Other chunks and all names (nodes, bones, materials) stay as they are.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const pad4 = n => (n + 3) & ~3;

// -> { json, bin (Buffer, may be empty) } ; throws on anything that is not a single-buffer GLB 2.0
export function readGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB file');
  if (buf.readUInt32LE(4) !== 2) throw new Error('GLB version ' + buf.readUInt32LE(4) + ' is not supported');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('GLB length field does not match the file size');
  let json = null, bin = Buffer.alloc(0);
  for (let o = 12; o < buf.length;) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), data = buf.subarray(o + 8, o + 8 + len);
    if (data.length !== len) throw new Error('GLB chunk runs past the end of the file');
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK) bin = Buffer.from(data);
    o += 8 + pad4(len);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

// The values of one accessor as { data: flat array, size: components per element } (floats, and unsigned bytes, shorts and ints as they are)
const COMPONENT = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
export function readAccessor(json, bin, index) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView], size = SIZE[a.type], [get, bytes] = COMPONENT[a.componentType];
  const stride = v.byteStride || size * bytes, base = (v.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.length), data = new Array(a.count * size);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < size; c++) data[k * size + c] = dv[get](base + k * stride + c * bytes, true);
  return { data, size };
}

export function writeGlb({ json, bin }) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const bn = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)]);
  const total = 12 + 8 + js.length + (bn.length ? 8 + bn.length : 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const ch = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([head, ch(JSON_CHUNK, js), ...(bn.length ? [ch(BIN_CHUNK, bn)] : [])]);
}

// The numbers a check needs: how many animations are left and what the binary chunk holds
export function summarize(buf) {
  const { json, bin } = readGlb(buf);
  const acc = json.accessors || [], views = json.bufferViews || [];
  const bad = [];
  acc.forEach((a, i) => { const v = views[a.bufferView]; if (a.bufferView !== undefined && !v) bad.push('accessor ' + i + ' has no buffer view'); });
  views.forEach((v, i) => { if (v.byteOffset + v.byteLength > bin.length) bad.push('buffer view ' + i + ' runs past the binary chunk'); });
  return { animations: (json.animations || []).length, accessors: acc.length, bufferViews: views.length, binBytes: bin.length, jsonBytes: JSON.stringify(json).length, bad };
}

export function strip(buf, { keepAnimations = false, dropAttributes = ['TANGENT', 'TEXCOORD_1'] } = {}) {
  const { json, bin } = readGlb(buf);
  if (!keepAnimations) delete json.animations;
  for (const m of json.meshes || []) for (const p of m.primitives) {
    for (const a of dropAttributes) delete p.attributes[a];
    for (const t of p.targets || []) for (const a of dropAttributes) delete t[a];
  }
  // accessors something still reads
  const acc = json.accessors || [], views = json.bufferViews || [];
  const useAcc = new Set();
  const mark = i => { if (i !== undefined) useAcc.add(i); };
  for (const m of json.meshes || []) for (const p of m.primitives) {
    Object.values(p.attributes).forEach(mark); mark(p.indices);
    for (const t of p.targets || []) Object.values(t).forEach(mark);
  }
  for (const s of json.skins || []) mark(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) { mark(s.input); mark(s.output); }
  const accMap = new Map(), keptAcc = [];
  acc.forEach((a, i) => { if (useAcc.has(i)) { accMap.set(i, keptAcc.length); keptAcc.push(a); } });
  // buffer views those accessors, images and sparse parts live in
  const useView = new Set();
  for (const a of keptAcc) {
    if (a.bufferView !== undefined) useView.add(a.bufferView);
    if (a.sparse) { useView.add(a.sparse.indices.bufferView); useView.add(a.sparse.values.bufferView); }
  }
  for (const im of json.images || []) if (im.bufferView !== undefined) useView.add(im.bufferView);
  const viewMap = new Map(), keptViews = [], chunks = [];
  let off = 0;
  views.forEach((v, i) => {
    if (!useView.has(i)) return;
    const data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    viewMap.set(i, keptViews.length);
    keptViews.push({ ...v, byteOffset: off });
    chunks.push(data, Buffer.alloc(pad4(data.length) - data.length));
    off += pad4(data.length);
  });
  for (const a of keptAcc) {
    if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
    if (a.sparse) { a.sparse.indices.bufferView = viewMap.get(a.sparse.indices.bufferView); a.sparse.values.bufferView = viewMap.get(a.sparse.values.bufferView); }
  }
  for (const im of json.images || []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView);
  const remap = o => { for (const k of Object.keys(o)) o[k] = accMap.get(o[k]); };
  for (const m of json.meshes || []) for (const p of m.primitives) {
    remap(p.attributes); if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    for (const t of p.targets || []) remap(t);
  }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) { s.input = accMap.get(s.input); s.output = accMap.get(s.output); }
  json.accessors = keptAcc; json.bufferViews = keptViews;
  if (!keptAcc.length) delete json.accessors;
  if (!keptViews.length) delete json.bufferViews;
  const newBin = Buffer.concat(chunks);
  if (json.buffers && json.buffers[0]) json.buffers[0].byteLength = newBin.length;
  return writeGlb({ json, bin: newBin });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), dry = args.includes('--dry'), keepAnimations = args.includes('--keep-animations');
  const files = args.filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('usage: node tools/models/strip-glb.mjs [--dry] [--keep-animations] <file.glb> ...'); process.exit(2); }
  let before = 0, after = 0;
  for (const f of files) {
    const src = readFileSync(f), out = strip(src, { keepAnimations }), s = summarize(out);
    if (s.bad.length) throw new Error(f + ': ' + s.bad.join('; '));
    before += src.length; after += out.length;
    console.log(`${f}: ${src.length} -> ${out.length} bytes, ${s.animations} animations, ${s.accessors} accessors`);
    if (!dry) writeFileSync(f, out);
  }
  console.log(`total ${before} -> ${after} bytes (${Math.round(100 * (1 - after / before))} percent smaller)${dry ? ' (dry run, nothing written)' : ''}`);
}
