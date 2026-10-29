import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeSettings, officeQuery, urlAfterChange, rowsOf, ROWS, OFFICE3D_ROWS } from '../public/js/office-settings.js';
import { KEY, load, save, merge } from '../public/js/pixel/settings.js';

const memory = (init = {}) => { const m = { ...init }; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test('office settings: defaults, then what is stored, then the address, and each value says where it came from', () => {
  const store = memory();
  save(store, { season: 'winter', weather: 'rain' });
  const s = createOfficeSettings({ storage: store, overrides: officeQuery('?season=spring&time=06:30') });
  assert.deepEqual(s.get(), { time: '06:30', season: 'spring', weather: 'rain', hemisphere: 'north', shelf: 10, project: 'off' });
  assert.deepEqual(s.from(), { time: 'url', season: 'url', weather: 'stored', hemisphere: 'default', shelf: 'default', project: 'default' });
  assert.equal(s.get('weather'), 'rain');
  assert.equal(createOfficeSettings({ storage: memory() }).get('time'), 'auto');
});

test('office settings: a choice is validated, remembered under the pixel scene\'s key, and read back by the pixel scene', () => {
  const store = memory();
  const s = createOfficeSettings({ storage: store });
  assert.equal(s.set('weather', 'rain'), true);
  assert.equal(s.set('time', '21:30'), true);
  assert.equal(s.set('weather', 'hail'), false, 'not a weather');
  assert.equal(s.set('proj', 'iso'), false, 'not a scene setting');
  assert.equal(s.set('shelf', 1000), false);
  assert.equal(s.get('weather'), 'rain');
  assert.deepEqual(JSON.parse(store.m[KEY]), { weather: 'rain', time: '21:30' });
  assert.deepEqual(merge(load(store), {}).values, { time: '21:30', season: 'auto', weather: 'rain', hemisphere: 'north', shelf: 10, project: 'off' }, 'the pixel scene would start with the same choices');
  // and the other way round: a choice made in the pixel scene is the starting point here
  save(store, { season: 'autumn' });
  assert.equal(createOfficeSettings({ storage: store }).get('season'), 'autumn');
  assert.equal(s.from().weather, 'user');
});

test('office settings: an address override wins over what is stored, is not stored itself, and stays until the visitor changes that setting', () => {
  const store = memory();
  save(store, { season: 'winter' });
  const s = createOfficeSettings({ storage: store, overrides: officeQuery('?season=summer') });
  assert.equal(s.get('season'), 'summer');
  assert.equal(JSON.parse(store.m[KEY]).season, 'winter', 'loading with an override stores nothing');
  s.set('season', 'autumn');
  assert.equal(s.get('season'), 'autumn');
  assert.equal(JSON.parse(store.m[KEY]).season, 'autumn');
  assert.equal(s.from().season, 'user');
});

test('office settings: on(key) tells a listener when a value really changes; "*" hears every key; the returned function stops it', () => {
  const s = createOfficeSettings({ storage: memory() });
  const seen = [], all = [];
  const off = s.on('weather', (v, k) => seen.push([k, v]));
  s.on('*', (v, k) => all.push(k + '=' + v));
  s.set('weather', 'rain'); s.set('weather', 'rain'); s.set('season', 'winter'); s.set('weather', 'bogus');
  assert.deepEqual(seen, [['weather', 'rain']], 'once for the change, not for the same value again, not for a bad one');
  assert.deepEqual(all, ['weather=rain', 'season=winter']);
  off();
  s.set('weather', 'fog');
  assert.deepEqual(seen, [['weather', 'rain']]);
  assert.equal(s.get('weather'), 'fog');
});

test('office settings: without storage, or with a storage that throws, the choices still work for this visit', () => {
  const a = createOfficeSettings({ storage: null });
  assert.equal(a.set('season', 'winter'), true); assert.equal(a.get('season'), 'winter');
  const b = createOfficeSettings({ storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } } });
  assert.equal(b.get('shelf'), 10);
  assert.doesNotThrow(() => b.set('weather', 'snow')); assert.equal(b.get('weather'), 'snow');
});

test('office settings: get() is a copy, a caller cannot change the settings through it', () => {
  const s = createOfficeSettings({ storage: memory() });
  const g = s.get(); g.weather = 'rain'; s.from().time = 'user';
  assert.equal(s.get('weather'), 'off'); assert.equal(s.from().time, 'default');
});

test('office query: ?time ?season ?weather ?hemisphere ?shelf, and ?hour= is the older name of ?time=', () => {
  assert.deepEqual(officeQuery('?time=21:30&season=winter&weather=snow&hemisphere=south&shelf=7'), { time: '21:30', season: 'winter', weather: 'snow', hemisphere: 'south', shelf: 7 });
  assert.deepEqual(officeQuery('?hour=21'), { time: '21:00' });
  assert.deepEqual(officeQuery('?hour=7.5'), { time: '07:30' });
  assert.deepEqual(officeQuery('?hour=25'), { time: '01:00' }, 'the hour wraps round the day, as it did');
  assert.deepEqual(officeQuery('?hour=-1'), { time: '23:00' });
  assert.deepEqual(officeQuery('?hour=21&time=06:15'), { time: '06:15' }, '?time= wins');
  assert.deepEqual(officeQuery('?hour=&scene=3d'), {}); assert.deepEqual(officeQuery('?hour=noon'), {});
  assert.deepEqual(officeQuery('?hour=21&time=bogus'), { time: '21:00' }, 'a ?time= that is not a time does not hide a good ?hour=');
  assert.deepEqual(officeQuery(''), {}); assert.deepEqual(officeQuery(undefined), {});
});

test('address after a change: a parameter that the address names follows the control, ?hour= becomes ?time=, others are left alone', () => {
  assert.equal(urlAfterChange('?scene=3d&season=winter', 'season', 'spring'), '?scene=3d&season=spring');
  assert.equal(urlAfterChange('?scene=3d', 'season', 'spring'), null, 'not named: the address stays');
  assert.equal(urlAfterChange('?scene=3d&hour=21', 'time', '22:30'), '?scene=3d&time=22%3A30');
  assert.equal(urlAfterChange('?hour=21&time=06:00', 'time', '07:00'), '?hour=21&time=07%3A00');
  assert.equal(urlAfterChange('?proj=iso', 'proj', 'front'), '?proj=front');
  assert.equal(urlAfterChange('', 'weather', 'rain'), null);
});

test('popover rows: a scene lists the rows it supports; a scene that lists none (the pixel scene) shows them all; the 3D scene has no camera row', () => {
  assert.deepEqual(ROWS, ['camera', 'time', 'season', 'hemisphere', 'weather', 'shelf']);
  assert.deepEqual(rowsOf({}), ROWS); assert.deepEqual(rowsOf(null), ROWS); assert.deepEqual(rowsOf(undefined), ROWS);
  assert.deepEqual(rowsOf({ settingRows: OFFICE3D_ROWS }), ['time', 'season', 'hemisphere', 'weather', 'shelf'], 'in the popover\'s order, whatever order the scene wrote');
  assert.ok(!rowsOf({ settingRows: OFFICE3D_ROWS }).includes('camera'));
  assert.deepEqual(rowsOf({ settingRows: ['weather', 'bogus'] }), ['weather'], 'a name the popover does not have is ignored');
  assert.deepEqual(rowsOf({ settingRows: [] }), [], 'a scene can support none');
});
