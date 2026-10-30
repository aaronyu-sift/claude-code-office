import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, clean, fromQuery, merge, load, save } from '../public/js/pixel/settings.js';
import { readFileSync } from 'node:fs';
import { createOfficeSettings, createSettingsHub, officeQuery, urlAfterChange, sourceOf, rowsOf, tabRowsOf, OFFICE3D_ROWS, PIXEL_ROWS } from '../public/js/office-settings.js';
import { sourceParam } from '../public/js/settings-tab-model.js';

const memory = (init = {}) => { const m = { ...init }; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test('settings: the lounge shows its text unless it is told otherwise; ?lounge= takes text, names and off, and the demo word does not make a setting', () => {
  assert.equal(merge({}, {}).values.lounge, 'text');
  assert.equal(clean('lounge', 'text'), 'text'); assert.equal(clean('lounge', ' NAMES '), 'names'); assert.equal(clean('lounge', 'Off'), 'off');
  assert.equal(clean('lounge', 'demo,names'), 'names', 'the demo source can come with a mode'); assert.equal(clean('lounge', 'names demo'), 'names'); assert.equal(clean('lounge', 'demo+off'), 'off');
  for (const bad of ['demo', 'on', 'yes', '', ' ', 'auto', 'textt', null, undefined, true, 1, ['text'], {}]) assert.equal(clean('lounge', bad), null, String(bad));
  assert.deepEqual(fromQuery('?lounge=names'), { lounge: 'names' }); assert.deepEqual(fromQuery('?lounge=demo'), {}); assert.deepEqual(fromQuery('?lounge=demo,off'), { lounge: 'off' });
  assert.equal(merge({ lounge: 'names' }, {}).values.lounge, 'names'); assert.equal(merge({ lounge: 'names' }, fromQuery('?lounge=off')).values.lounge, 'off', 'the address beats the store');
  assert.equal(merge({ lounge: 'names' }, fromQuery('?lounge=demo')).values.lounge, 'names', '?lounge=demo alone leaves the setting as it is');
  assert.equal(merge({ lounge: 'maybe' }, {}).values.lounge, 'text', 'a broken stored value is ignored');
  const s = memory();
  save(s, { lounge: 'off' });
  assert.deepEqual(JSON.parse(s.m[KEY]), { lounge: 'off' });
  save(s, { lounge: 'demo' });
  assert.deepEqual(load(s), { lounge: 'off' }, 'demo is not a value to keep');
});

test('lounge: ?lounge= reaches the 3D scene, and a change made with the controls keeps ?lounge=demo in the address', () => {
  assert.deepEqual(officeQuery('?lounge=names&time=22:00'), { lounge: 'names', time: '22:00' });
  assert.deepEqual(officeQuery('?lounge=demo'), {});
  const s = createOfficeSettings({ storage: memory(), overrides: officeQuery('?lounge=off') });
  assert.equal(s.get('lounge'), 'off'); assert.equal(s.from().lounge, 'url');
  assert.equal(s.set('lounge', 'names'), true); assert.equal(s.get('lounge'), 'names');
  assert.equal(s.set('lounge', 'demo'), false, 'demo is a source, not a mode');
  assert.equal(urlAfterChange('?scene=3d&lounge=off', 'lounge', 'text'), '?scene=3d&lounge=text');
  assert.equal(urlAfterChange('?lounge=demo', 'lounge', 'names'), '?lounge=demo%2Cnames', 'the demo source stays in the address');
  assert.equal(urlAfterChange('?lounge=demo,off', 'lounge', 'text'), '?lounge=demo%2Ctext');
  assert.equal(urlAfterChange('?scene=3d', 'lounge', 'names'), null, 'not named in the address: the address stays');
});

test('lounge row: the controls change the setting live through the hub (the lounge listens to the store), keep ?lounge=demo in the address and say where the value comes from', () => {
  const store = createOfficeSettings({ storage: memory(), overrides: officeQuery('?lounge=demo'), watch: null }), heard = [], addr = [];
  assert.equal(store.get('lounge'), 'text', '?lounge=demo alone names no mode'); assert.equal(store.from().lounge, 'default');
  store.on('lounge', v => heard.push(v));                                           // what ofis-lounge.js does: it reads settings.get('lounge') on every use and listens for a change
  const hub = createSettingsHub({ getOffice: () => ({ settingRows: OFFICE3D_ROWS, get settings() { return store.get(); }, get settingsFrom() { return store.from(); }, setSetting: (k, v) => store.set(k, v) }), afterChange: (k, v) => addr.push(urlAfterChange('?lounge=demo', k, v)) });
  assert.equal(hub.set('lounge', 'names'), true); assert.equal(hub.set('lounge', 'off'), true); assert.equal(hub.set('lounge', 'off'), true); assert.equal(hub.set('lounge', 'demo'), false, 'demo is a source, not a mode');
  assert.equal(hub.set('lounge', 'loud'), false);
  assert.deepEqual(heard, ['names', 'off'], 'one notice for each real change, none for a value that is the same or not a mode');
  assert.equal(hub.settings().lounge, 'off'); assert.equal(hub.from().lounge, 'user');
  assert.deepEqual(addr.filter(Boolean), ['?lounge=demo%2Cnames', '?lounge=demo%2Coff', '?lounge=demo%2Coff'], 'the demo source stays in the address that a change keeps in step');
  assert.equal(sourceOf('lounge', hub.from(), ''), 'stored'); assert.equal(sourceOf('lounge', hub.from(), '?lounge=demo,off'), 'url'); assert.equal(sourceOf('lounge', hub.from(), '?lounge=demo'), 'stored');
  assert.equal(sourceParam('lounge', '?lounge=demo,off'), '?lounge=demo,off');
  assert.deepEqual(hub.rows().slice(-2), ['project', 'lounge']);
});

test('lounge row: only the scene with a lounge lists it, and the pixel scene says so itself', () => {
  assert.ok(rowsOf({ settingRows: OFFICE3D_ROWS }).includes('lounge')); assert.ok(tabRowsOf({ settingRows: OFFICE3D_ROWS }).includes('lounge'));
  assert.ok(!rowsOf({ settingRows: PIXEL_ROWS }).includes('lounge')); assert.ok(!tabRowsOf({ settingRows: PIXEL_ROWS }).includes('lounge'));
  const here = p => new URL(p, import.meta.url);
  assert.match(readFileSync(here('../public/js/pixel/index.js'), 'utf8'), /^\s*settingRows: PIXEL_ROWS,/m, 'the pixel scene lists its rows, so a scene that lists none does not get a lounge row');
  assert.match(readFileSync(here('../public/js/main.js'), 'utf8'), /settingRows: OFFICE3D_ROWS,/, 'the 3D scene lists its rows');
});
