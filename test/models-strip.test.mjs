import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readGlb, writeGlb, strip, summarize, readAccessor } from '../tools/models/strip-glb.mjs';
import { MANIFEST, OUTFITS } from '../public/js/ofis-rig.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// A small glTF: a triangle (position, normal, tangent, a second uv set, indices), a one-bone skin with its inverse bind matrix, and an animation
// whose accessors sit between them, so removing the animation moves the accessors that stay.
function sample() {
  const parts = [];
  const f32 = a => Buffer.from(new Float32Array(a).buffer);
  const add = (buf) => { parts.push(buf); return parts.length - 1; };
  add(f32([0, 0, 0, 1, 0, 0, 0, 1, 0]));                       // 0 position
  add(f32([0, 0, 1, 0, 0, 1, 0, 0, 1]));                       // 1 normal
  add(f32([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]));              // 2 tangent
  add(f32([0, 0, 1, 0, 0, 1]));                                // 3 texcoord_1
  add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));         // 4 indices
  add(f32([0, 0.5, 1]));                                       // 5 animation times
  add(f32([0, 0, 0, 1, 1, 1, 2, 2, 2]));                       // 6 animation values
  add(f32([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));  // 7 inverse bind matrix
  let off = 0;
  const bufferViews = parts.map(p => { const v = { buffer: 0, byteOffset: off, byteLength: p.length }; off += (p.length + 3) & ~3; return v; });
  const bin = Buffer.concat(parts.map(p => Buffer.concat([p, Buffer.alloc(((p.length + 3) & ~3) - p.length)])));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'tri', mesh: 0, skin: 0 }, { name: 'bone' }],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_1: 3 }, indices: 4 }] }],
    skins: [{ joints: [1], inverseBindMatrices: 7 }],
    animations: [{ name: 'wave', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: 5, output: 6 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' }, { bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 4, componentType: 5123, count: 3, type: 'SCALAR' }, { bufferView: 5, componentType: 5126, count: 3, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 7, componentType: 5126, count: 1, type: 'MAT4' },
    ],
    bufferViews, buffers: [{ byteLength: bin.length }],
  };
  return writeGlb({ json, bin });
}

test('strip: drops the clips, the unread attributes and what only they used; what stays reads the same', () => {
  const src = sample(), out = strip(src);
  const a = readGlb(src), b = readGlb(out);
  assert.equal(b.json.animations, undefined);
  assert.deepEqual(Object.keys(b.json.meshes[0].primitives[0].attributes).sort(), ['NORMAL', 'POSITION']);
  assert.equal(b.json.accessors.length, 4, 'position, normal, indices and the inverse bind matrix are left');
  const p = b.json.meshes[0].primitives[0];
  assert.deepEqual(readAccessor(b.json, b.bin, p.attributes.POSITION).data, readAccessor(a.json, a.bin, 0).data);
  assert.deepEqual(readAccessor(b.json, b.bin, p.attributes.NORMAL).data, readAccessor(a.json, a.bin, 1).data);
  assert.deepEqual(readAccessor(b.json, b.bin, p.indices).data, [0, 1, 2]);
  assert.deepEqual(readAccessor(b.json, b.bin, b.json.skins[0].inverseBindMatrices).data, readAccessor(a.json, a.bin, 7).data, 'the skin still points at its matrix');
  assert.ok(out.length < src.length);
  assert.equal(b.json.buffers[0].byteLength, b.bin.length);
  assert.deepEqual(summarize(out).bad, []);
  assert.equal(out.readUInt32LE(8), out.length, 'the header carries the real length');
  assert.ok(out.equals(strip(out)), 'stripping a stripped file changes nothing');
});

test('strip: --keep-animations only drops what nothing reads, and a file that is not a GLB is refused', () => {
  const out = strip(sample(), { keepAnimations: true });
  const b = readGlb(out);
  assert.equal(b.json.animations.length, 1);
  const s = b.json.animations[0].samplers[0];
  assert.deepEqual(readAccessor(b.json, b.bin, s.input).data, [0, 0.5, 1]);
  assert.deepEqual(readAccessor(b.json, b.bin, s.output).data, [0, 0, 0, 1, 1, 1, 2, 2, 2]);
  assert.throws(() => readGlb(Buffer.from('not a glb at all, just text')), /not a GLB/);
  assert.throws(() => readGlb(sample().subarray(0, 40)), /length/);
});

test('shipped characters are the stripped ones: no clips, smaller than the pack ships them, and stripping them again changes nothing', () => {
  let total = 0;
  for (const o of OUTFITS) {
    const buf = readFileSync(join(PUBLIC, MANIFEST[o.key]));
    total += buf.length;
    const s = summarize(buf);
    assert.equal(s.animations, 0, o.file);
    assert.deepEqual(s.bad, [], o.file);
    assert.ok(buf.length < 100e3, `${o.file} is ${buf.length} bytes: the pack's own file is about 250 KB`);
    assert.ok(buf.equals(strip(buf)), `${o.file} is not the output of the strip tool`);
  }
  assert.ok(total < 1.0e6, `the characters ship ${total} bytes`);
});
