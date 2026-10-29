import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  PROPS, OUTFITS, MANIFEST, BONES, ATLAS, PALETTES, PALETTE_OF, SLEEVE, parseLook, manifestFor, judge, createWarner, warnText, chooseOutfit,
  isPerson, rawSRGB, hexToLinear, rgbToHsl, hslToRgb, makePalette, poseBones,
} from '../public/js/ofis-rig.js';
import { readGlb, readAccessor } from '../tools/models/strip-glb.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const glb = url => readGlb(readFileSync(join(PUBLIC, url)));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('look: the packs are the default, ?assets=procedural keeps every piece procedural, ?polish=off keeps the plain look', () => {
  assert.deepEqual(parseLook(''), { assets: 'packs', polish: true });
  assert.deepEqual(parseLook('?scene=3d'), { assets: 'packs', polish: true });
  assert.deepEqual(parseLook('?assets=procedural'), { assets: 'procedural', polish: true });
  assert.deepEqual(parseLook('?assets=packs&polish=off'), { assets: 'packs', polish: false });
  assert.deepEqual(parseLook('?assets=nonsense'), { assets: 'packs', polish: true });
  assert.deepEqual(manifestFor(parseLook('?assets=procedural')), {}, 'no file is asked for');
  assert.equal(manifestFor(parseLook('')), MANIFEST);
});

test('manifest: every file exists, is a GLB, has its pack licence beside it, and is one the scene asks for', () => {
  const dirs = new Set();
  for (const [key, url] of Object.entries(MANIFEST)) {
    assert.ok(existsSync(join(PUBLIC, url)), `${key}: ${url} is missing`);
    const { json } = glb(url);
    assert.ok(json.meshes && json.meshes.length > 0, `${key}: no mesh`);
    dirs.add(dirname(url));
  }
  assert.equal(Object.keys(MANIFEST).length, Object.keys(PROPS).length + OUTFITS.length);
  for (const d of dirs) {
    const lic = join(PUBLIC, d, 'License.txt');
    assert.ok(existsSync(lic), `${d} has no License.txt`);
    assert.match(readFileSync(lic, 'utf8'), /Creative Commons Zero, CC0/, `${d}/License.txt is not the CC0 licence text`);
  }
  // nothing is shipped that no key uses (the packs' other files are not copied)
  const used = new Set(Object.values(MANIFEST).map(u => u.replace(/^models\//, '')));
  for (const d of dirs) for (const f of readdirSync(join(PUBLIC, d))) {
    if (/\.glb$/.test(f)) assert.ok(used.has(d.replace(/^models\//, '') + '/' + f), `${d}/${f} ships but nothing loads it`);
  }
});

test('people: the shipped characters have a rig the scene can drive and no animation clips; each outfit tints cells its torso and sleeves really use', () => {
  for (const o of OUTFITS) {
    const { json, bin } = glb(MANIFEST[o.key]);
    assert.equal((json.animations || []).length, 0, `${o.file} still carries animation clips (tools/models/strip-glb.mjs)`);
    const names = json.nodes.map(n => n.name);
    for (const b of Object.values(BONES)) assert.ok(names.includes(b), `${o.file}: bone ${b} missing`);
    assert.equal(judge(o.key, { meshes: 0, skinned: 2, bones: names }), null);
    const joints = json.skins[0].joints.map(n => json.nodes[n].name);
    const want = new Set(o.tint.map(c => c.join(',')));
    let tinted = 0;
    for (const [c, r] of o.tint) assert.ok(c >= 0 && c < ATLAS.cols && r >= 0 && r < ATLAS.rows, `${o.file}: cell ${c},${r} is outside the atlas`);
    for (const mesh of json.meshes) {
      const at = mesh.primitives[0].attributes;
      const uv = readAccessor(json, bin, at.TEXCOORD_0).data, ji = readAccessor(json, bin, at.JOINTS_0).data, w = readAccessor(json, bin, at.WEIGHTS_0).data;
      for (let i = 0; i < uv.length / 2; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (w[i * 4 + k] > w[i * 4 + best]) best = k;
        if (!/^(torso|arm-)/.test(joints[ji[i * 4 + best]])) continue;
        if (want.has(Math.floor(uv[i * 2] * ATLAS.cols) + ',' + Math.floor(uv[i * 2 + 1] * ATLAS.rows))) tinted++;
      }
    }
    assert.ok(tinted >= 60, `${o.file}: only ${tinted} torso or sleeve vertices sample the tinted cell(s) ${JSON.stringify(o.tint)}`);
  }
});

test('judge: what makes a loaded file unusable, so the scene falls back to its own shape', () => {
  const names = Object.values(BONES);
  assert.equal(judge('desk', { meshes: 3, skinned: 0, bones: [] }), null);
  assert.match(judge('desk', { meshes: 0, skinned: 0, bones: [] }), /no mesh/);
  assert.match(judge('desk', null), /nothing/);
  assert.equal(judge('p3', { meshes: 0, skinned: 2, bones: names }), null);
  assert.match(judge('p3', { meshes: 4, skinned: 0, bones: names }), /no skinned mesh/);
  assert.match(judge('p3', { meshes: 0, skinned: 2, bones: names.filter(b => b !== 'torso') }), /missing bones: torso/);
  assert.ok(isPerson('p0') && isPerson('p10') && !isPerson('desk') && !isPerson('p11'));
});

test('warner: one warning per piece, however often it is asked', () => {
  const lines = [];
  const warn = createWarner(t => lines.push(t));
  assert.equal(warn('desk', warnText('desk', 'models/x.glb', 'HTTP 404')), true);
  assert.equal(warn('desk', 'again'), false);
  assert.equal(warn('chair', warnText('chair', 'models/y.glb', 'bad file')), true);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[office-3d\] model "desk" \(models\/x\.glb\) not used: HTTP 404; the built-in shape takes its place$/);
});

test('outfit choice: by the hash among the outfits that loaded; none loaded means the procedural figure', () => {
  const all = OUTFITS.map(o => o.key);
  assert.equal(chooseOutfit(0, all), 'p0');
  assert.equal(chooseOutfit(13, all), all[13 % all.length]);
  assert.equal(chooseOutfit(7, all), chooseOutfit(7, all), 'the same agent always gets the same outfit');
  assert.equal(chooseOutfit(5, ['p4']), 'p4');
  assert.ok(['p2', 'p9'].includes(chooseOutfit(123456, ['p2', 'p9'])));
  assert.equal(chooseOutfit(5, []), null);
  assert.equal(chooseOutfit(5, ['desk', 'chair']), null, 'props are not people');
  const seen = new Set(Array.from({ length: 200 }, (_, h) => chooseOutfit(h, all)));
  assert.equal(seen.size, all.length, 'every outfit gets used');
});

test('colours: hex to linear, hsl round trip, and the palette map', () => {
  assert.deepEqual(hexToLinear('#ffffff'), [1, 1, 1]);
  assert.deepEqual(hexToLinear('#000'), [0, 0, 0]);
  assert.ok(near(hexToLinear('#808080')[0], 0.2158605, 1e-5), 'sRGB 128 is 0.2159 linear');
  assert.throws(() => hexToLinear('red'));
  for (const c of [[0.2, 0.5, 0.8], [0.9, 0.1, 0.1], [0.3, 0.3, 0.3], [0.05, 0.7, 0.4]]) {
    const back = hslToRgb(...rgbToHsl(...c));
    c.forEach((v, i) => assert.ok(near(v, back[i], 1e-9), `hsl round trip of ${c}`));
  }
  const pass = makePalette();
  assert.deepEqual(pass('wood', [0.4, 0.3, 0.2]), [0.4, 0.3, 0.2], 'the empty palette changes nothing');
  const byName = makePalette({ byName: { wood: '#ffffff' } });
  assert.deepEqual(byName('wood', [0.4, 0.3, 0.2]), [1, 1, 1], 'a named material is replaced');
  assert.deepEqual(byName('metal', [0.4, 0.3, 0.2]), [0.4, 0.3, 0.2], 'any other material is not');
  const grey = makePalette({ sat: 0 })('x', [0.8, 0.2, 0.2]);
  assert.ok(near(grey[0], grey[1]) && near(grey[1], grey[2]), 'saturation 0 is grey');
  const dark = makePalette({ light: 0.5 })('x', [0.8, 0.2, 0.2]);
  assert.ok(dark[0] < 0.8 && dark[0] > 0.2);
  const lifted = makePalette({ lift: 0.2 })('x', [0.2, 0.2, 0.2]);
  assert.ok(lifted[0] > 0.3);
  const out = byName('wood', [0, 0, 0]);
  out[0] = 5;
  assert.deepEqual(byName('wood', [0, 0, 0]), [1, 1, 1], 'the replacement colour cannot be changed through a result');
  assert.notEqual(makePalette({ light: 1.1 }).id, makePalette({ light: 1.2 }).id, 'two palettes bake two ways');
  assert.equal(rawSRGB('models/kenney-furniture/desk.glb'), true);
  assert.equal(rawSRGB('models/kenney-mini/character-male-a.glb'), false);
});

test('palettes: every named material exists in a model the palette is used for, and every model has a palette', () => {
  assert.deepEqual(Object.keys(PALETTE_OF).sort(), Object.keys(PROPS).sort());
  const materials = key => (glb(PROPS[key]).json.materials || []).map(m => m.name);
  for (const [pal, spec] of Object.entries(PALETTES)) {
    const models = Object.keys(PALETTE_OF).filter(k => [].concat(PALETTE_OF[k]).includes(pal));
    assert.ok(models.length > 0, `palette ${pal} is used by no model`);
    for (const name of Object.keys(spec.byName)) {
      assert.ok(models.some(k => materials(k).includes(name)), `palette ${pal} names material "${name}", which none of ${models.join(', ')} has`);
    }
  }
});

test('palettes: no material of a pack model keeps the pack colour by accident (a bush once came out turquoise, a tree had a white quad)', () => {
  for (const key of Object.keys(PROPS).filter(k => PALETTE_OF[k])) {
    const names = [].concat(PALETTE_OF[key]).flatMap(p => Object.keys(PALETTES[p].byName));
    for (const m of (glb(PROPS[key]).json.materials || []).map(m => m.name)) assert.ok(names.includes(m), `model ${key} has material "${m}" that its palette does not colour`);
  }
});

test('rig: the old joint angles drive the pack bones (arms hang from the T pose, legs and spine follow)', () => {
  const j = (o = {}) => ({ armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, upper: { x: 0 }, head: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 }, ...o });
  const rest = poseBones(j());
  assert.ok(near(rest.armL[2], -Math.PI / 2 + SLEEVE) && near(rest.armR[2], Math.PI / 2 - SLEEVE), 'zero angles = arms down, a little out');
  assert.equal(rest.armL[0], 0);
  assert.ok(near(rest.armL[2], -rest.armR[2]), 'the two arms mirror each other');
  const type = poseBones(j({ armL: { x: -1.05, z: -0.16 }, armR: { x: -1.05, z: 0.16 }, upper: { x: 0.12 }, head: { x: 0.1, z: 0 }, legL: { x: -1.5 }, legR: { x: -1.5 } }));
  assert.equal(type.armL[0], -1.05, 'the shoulder swing is the x angle');
  assert.ok(near(type.torso[0], 0.12) && near(type.head[0], 0.1) && type.legL[0] === -1.5 && type.legR[0] === -1.5);
  const wave = poseBones(j({ armR: { x: -0.25, z: -2.45 } }));
  assert.ok(wave.armR[2] < 0 && wave.armR[2] < rest.armR[2] - 2, 'a raised arm swings far past the T pose, toward the head');
  for (const v of Object.values(wave).flat()) assert.ok(Number.isFinite(v));
});
