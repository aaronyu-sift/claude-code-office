import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SEASONS, SEASON_PALETTES, PALETTES, PALETTE_OF, PROPS, makePalette, hexToLinear } from '../public/js/ofis-rig.js';
import { SEASONS as PIXEL_SEASONS } from '../public/js/pixel/season.js';
import { readGlb } from '../tools/models/strip-glb.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const materials = key => (readGlb(readFileSync(join(PUBLIC, PROPS[key]))).json.materials || []).map(m => m.name);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const lum = hex => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

test('3D seasons: the same four seasons as the pixel scene, summer is the scene\'s usual look', () => {
  assert.deepEqual(SEASONS, PIXEL_SEASONS);
  assert.equal(SEASON_PALETTES.tree.summer, PALETTES.tree, 'the trees of summer are the palette the scene always had');
  assert.deepEqual(Object.keys(SEASON_PALETTES.tree).sort(), [...SEASONS].sort());
  assert.deepEqual(Object.keys(SEASON_PALETTES.ground).sort(), [...SEASONS].sort());
  assert.deepEqual(SEASON_PALETTES.ground.summer, { grassA: '#8cc76c', grassB: '#a6d47d', grassWood: '#70ad59', lip: '#6aa851', leaf: '#4f9a4c', leaf2: '#63b058', hillA: '#72ae59', hillB: '#7fb862' }, 'the grass of summer is the grass the scene always had');
});

test('3D seasons: every season colours the same materials as the usual palette, and every colour is a hex the baking understands', () => {
  const names = Object.keys(PALETTES.tree.byName).sort(), ground = Object.keys(SEASON_PALETTES.ground.summer).sort();
  for (const season of SEASONS) {
    assert.deepEqual(Object.keys(SEASON_PALETTES.tree[season].byName).sort(), names, `${season}: a tree material is missing or new`);
    for (const hex of Object.values(SEASON_PALETTES.tree[season].byName)) assert.doesNotThrow(() => hexToLinear(hex), `${season}: ${hex}`);
    assert.deepEqual(Object.keys(SEASON_PALETTES.ground[season]).sort(), ground, `${season}: a ground colour is missing or new`);
    for (const hex of Object.values(SEASON_PALETTES.ground[season])) assert.match(hex, /^#[0-9a-f]{6}$/, `${season}: ${hex}`);
  }
});

test('3D seasons: the materials a season names exist in the tree models, and no tree material is left to the pack\'s own colour', () => {
  const trees = Object.keys(PALETTE_OF).filter(k => PALETTE_OF[k] === 'tree');
  assert.ok(trees.length >= 6);
  for (const season of SEASONS) {
    const named = Object.keys(SEASON_PALETTES.tree[season].byName);
    for (const name of named) assert.ok(trees.some(k => materials(k).includes(name)), `${season} names "${name}", which no tree model has`);
    for (const k of trees) for (const m of materials(k)) assert.ok(named.includes(m), `${season}: ${k} has material "${m}" that the season does not colour`);
  }
});

test('3D seasons: the four seasons look different: the leaves, the grass and the lip of the island', () => {
  const by = (get) => SEASONS.map(s => get(s));
  for (const [what, get, min] of [['round-tree leaves', s => SEASON_PALETTES.tree[s].byName.leafsGreen, 60], ['grass', s => SEASON_PALETTES.ground[s].grassA, 15], ['grass lip', s => SEASON_PALETTES.ground[s].lip, 15]]) {
    const v = by(get);
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) assert.ok(dist(v[i], v[j]) >= min, `${what}: ${SEASONS[i]} and ${SEASONS[j]} are too alike (${dist(v[i], v[j]).toFixed(1)} apart, at least ${min})`);
  }
  // each one reads as its season: autumn leaves are orange, winter ground is the lightest and bluish, spring has the brightest green grass of the warm seasons
  const [ar, ag, ab] = rgb(SEASON_PALETTES.tree.autumn.byName.leafsGreen);
  assert.ok(ar > ag && ag > ab, 'autumn leaves: red above green above blue');
  const winter = SEASON_PALETTES.ground.winter.grassA;
  for (const s of ['spring', 'summer', 'autumn']) assert.ok(lum(winter) > lum(SEASON_PALETTES.ground[s].grassA) + 30, `winter ground is lighter than ${s} grass`);
  const [wr, , wb] = rgb(winter);
  assert.ok(wb >= wr, 'winter ground is cool: blue at least red');
  assert.ok(lum(SEASON_PALETTES.tree.winter.byName.leafsGreen) > lum(SEASON_PALETTES.tree.summer.byName.leafsGreen) + 50, 'winter leaves are frosted');
});

test('3D seasons: a palette per season bakes its own way (the bake cache is keyed by the palette)', () => {
  const ids = SEASONS.map(s => makePalette(SEASON_PALETTES.tree[s]).id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(makePalette(SEASON_PALETTES.tree.summer).id, makePalette(PALETTES.tree).id);
  const wood = ['spring', 'summer', 'autumn', 'winter'].map(s => makePalette(SEASON_PALETTES.tree[s])('leafsGreen', [0, 0, 0]));
  assert.equal(new Set(wood.map(c => c.join())).size, 4, 'the same leaf material comes out in four colours');
});
