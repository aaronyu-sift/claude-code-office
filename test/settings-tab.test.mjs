// The Settings tab's own rules (public/js/settings-tab-model.js) and what it shares with the popover (public/index.html) and the languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPTIONS, sourceParam, cameraSource, boardState, CAMERA_KEY } from '../public/js/settings-tab-model.js';
import { clean } from '../public/js/pixel/settings.js';
import { LANGUAGES, FALLBACK } from '../public/js/lang/index.js';

const here = p => new URL(p, import.meta.url);
const html = readFileSync(here('../public/index.html'), 'utf8');
const EN = LANGUAGES.find(l => l.code === FALLBACK).messages;

test('options: every choice of the tab is a value the store accepts, every label is a language key, and the popover offers the same choices', () => {
  for (const key of ['scene', 'season', 'hemisphere', 'weather']) for (const [v, k] of OPTIONS[key]) {
    assert.equal(clean(key, v), v, `${key}=${v} is a valid setting`);
    assert.ok(k in EN, `${k} is a language key`);
  }
  assert.deepEqual(OPTIONS.camera.map(c => c[0]), ['iso', 'front']);
  const popover = id => { const m = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html); return m ? [...m[1].matchAll(/<option value="([^"]+)"/g)].map(x => x[1]) : null; };
  assert.deepEqual(popover('set-season'), OPTIONS.season.map(o => o[0]), 'season');
  assert.deepEqual(popover('set-hemisphere'), OPTIONS.hemisphere.map(o => o[0]), 'hemisphere');
  assert.deepEqual(popover('set-weather'), OPTIONS.weather.map(o => o[0]), 'weather');
  for (const [, k] of OPTIONS.camera) assert.ok(k in EN);
});

test('source of a value, in the address\'s own words: ?season=winter, ?hour=21 for the time, nothing when the address does not name it', () => {
  assert.equal(sourceParam('season', '?scene=3d&season=winter'), '?season=winter');
  assert.equal(sourceParam('time', '?time=21:30'), '?time=21:30');
  assert.equal(sourceParam('time', '?hour=21'), '?hour=21');
  assert.equal(sourceParam('time', '?hour=21&time=06:15'), '?time=06:15', '?time= wins');
  assert.equal(sourceParam('time', '?hour=21&time=bogus'), '?hour=21', 'a ?time= that is not a time does not hide a good ?hour=');
  assert.equal(sourceParam('scene', '?scene=pixel'), '?scene=pixel');
  assert.equal(sourceParam('shelf', '?shelf=2'), '', 'a value that is not valid is not the address\'s');
  assert.equal(sourceParam('project', ''), ''); assert.equal(sourceParam('project', undefined), '');
});

test('the camera: ?proj= wins, then its own stored key, else the default; a storage that throws is the default', () => {
  const store = v => ({ getItem: k => (k === CAMERA_KEY ? v : null) });
  assert.equal(cameraSource('', store(null)), 'default');
  assert.equal(cameraSource('', store('front')), 'stored');
  assert.equal(cameraSource('', store('sideways')), 'default');
  assert.equal(cameraSource('?proj=iso', store('front')), 'url');
  assert.equal(cameraSource('?proj=diagonal', store('front')), 'stored', 'a bad address value is ignored');
  assert.equal(cameraSource('', null), 'default');
  assert.equal(cameraSource('', { getItem: () => { throw new Error('denied'); } }), 'default');
  assert.equal(CAMERA_KEY, 'ajan-ofisi.proj', 'the key of pixel/index.js');
  assert.match(readFileSync(here('../public/js/pixel/index.js'), 'utf8'), /const PROJ_KEY = 'ajan-ofisi\.proj'/);
});

test('the message board: connected, not enabled or unsupported; a server that says nothing, or something else, shows nothing', () => {
  assert.equal(boardState({ chat: { state: 'off' } }), 'off');
  assert.equal(boardState({ chat: { state: 'on' } }), 'on');
  assert.equal(boardState({ chat: { state: 'connected' } }), 'on');
  assert.equal(boardState({ chat: { state: ' Unsupported ' } }), 'unsupported');
  for (const bad of [null, undefined, {}, { chat: null }, { chat: {} }, { chat: { state: 3 } }, { chat: { state: 'maybe' } }, { chat: 'off' }, 'off', [], { chat: { state: '' } }]) assert.equal(boardState(bad), null, JSON.stringify(bad));
});

test('words: every language key that the tab uses exists, in every language', () => {
  const src = readFileSync(here('../public/js/settings-tab.js'), 'utf8');
  const used = new Set([...src.matchAll(/msg\('([\w.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')));       // 'st.g.' + id and the like are listed below
  for (const id of ['scene', 'sky', 'office', 'system']) used.add('st.g.' + id);
  for (const s of ['on', 'off', 'unsupported']) used.add('st.board.' + s);
  for (const k of ['default', 'stored', 'url']) used.add('st.src.' + k);
  assert.ok(used.size > 25, `${used.size} keys`);
  for (const l of LANGUAGES) assert.deepEqual([...used].filter(k => !(k in l.messages)), [], `${l.code} lacks keys the tab uses`);
  const indexKeys = [...html.matchAll(/data-i18n(?:-title|-aria|-tail)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(indexKeys.includes('tab.settings') && indexKeys.includes('set.project'));
});

test('markup: the popover has a project switch in its own row, after the shelf; the settings view is a panel of the tablist', () => {
  assert.match(html, /<div class="set-row" data-row="project">[\s\S]*?<input type="checkbox" role="switch" id="set-project">/);
  assert.ok(html.indexOf('data-row="shelf"') < html.indexOf('data-row="project"'));
  assert.match(html, /<section id="view-settings" class="view view-settings" role="tabpanel" aria-labelledby="tab-settings" hidden><\/section>/);
});
