import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, KEYS, DEFAULTS, clean, sanitize, fromQuery, merge, load, save, timeMinutes } from '../public/js/pixel/settings.js';

const memory = (init = {}) => { const m = { ...init }; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test('settings: the defaults are automatic time and season, weather off, northern hemisphere, ten chats on the shelf, no project folder on the boards, the 3D scene', () => {
  assert.deepEqual({ ...DEFAULTS }, { time: 'auto', season: 'auto', weather: 'off', hemisphere: 'north', shelf: 10, project: 'off', scene: '3d' });
  assert.deepEqual(KEYS, ['time', 'season', 'weather', 'hemisphere', 'shelf', 'project', 'scene']);
  const { values, from } = merge({}, {});
  assert.deepEqual(values, { ...DEFAULTS });
  assert.deepEqual(Object.values(from), ['default', 'default', 'default', 'default', 'default', 'default', 'default']);
});
test('settings: the scene is 3d or pixel, from the store or the address; the address wins and is not stored; anything else is ignored', () => {
  assert.equal(clean('scene', '3d'), '3d'); assert.equal(clean('scene', 'pixel'), 'pixel'); assert.equal(clean('scene', ' Pixel '), 'pixel'); assert.equal(clean('scene', '3D'), '3d');
  for (const bad of ['', ' ', '2d', 'three', 'auto', 'on', null, undefined, 3, true, ['pixel'], {}]) assert.equal(clean('scene', bad), null, String(bad));
  assert.deepEqual(fromQuery('?scene=pixel'), { scene: 'pixel' }); assert.deepEqual(fromQuery('?scene=3d&season=winter'), { scene: '3d', season: 'winter' }); assert.deepEqual(fromQuery('?scene=flat'), {});
  assert.equal(merge({}, {}).values.scene, '3d');
  assert.equal(merge({ scene: 'pixel' }, {}).values.scene, 'pixel'); assert.equal(merge({ scene: 'pixel' }, {}).from.scene, 'stored');
  assert.equal(merge({ scene: 'pixel' }, fromQuery('?scene=3d')).values.scene, '3d', 'the address beats the store'); assert.equal(merge({ scene: 'pixel' }, fromQuery('?scene=3d')).from.scene, 'url');
  assert.equal(merge({ scene: 'flat' }, {}).values.scene, '3d', 'a broken stored value is ignored');
  const s = memory();
  merge(load(s), fromQuery('?scene=pixel'));
  assert.deepEqual(load(s), {}, 'loading with ?scene= stores nothing');
  save(s, { scene: 'pixel' });
  assert.deepEqual(JSON.parse(s.m[KEY]), { scene: 'pixel' });
  save(s, { scene: 'flat' });
  assert.deepEqual(load(s), { scene: 'pixel' }, 'an invalid change is dropped');
});
test('settings: values are validated per key', () => {
  assert.equal(clean('time', 'auto'), 'auto'); assert.equal(clean('time', '22:05'), '22:05'); assert.equal(clean('time', '2205'), '22:05'); assert.equal(clean('time', '25:00'), null); assert.equal(clean('time', 'noon'), null);
  assert.equal(clean('season', 'auto'), 'auto'); assert.equal(clean('season', 'Winter'), 'winter'); assert.equal(clean('season', 'monsoon'), null);
  assert.equal(clean('weather', 'off'), 'off'); assert.equal(clean('weather', 'auto'), 'auto'); assert.equal(clean('weather', 'fog'), 'fog'); assert.equal(clean('weather', 'hail'), null);
  assert.equal(clean('hemisphere', 'south'), 'south'); assert.equal(clean('hemisphere', 'west'), null);
  assert.equal(clean('shelf', 10), 10); assert.equal(clean('shelf', '20'), 20); assert.equal(clean('shelf', 3), 3); assert.equal(clean('shelf', '200'), 200);
  for (const bad of [2, 201, 0, -5, 10.5, '10.5', '', 'ten', ' ', NaN, Infinity, null, undefined, true, [10], {}, '1e2', '0x10']) assert.equal(clean('shelf', bad), null, String(bad));
  assert.equal(clean('project', 'on'), 'on'); assert.equal(clean('project', 'off'), 'off'); assert.equal(clean('project', ' ON '), 'on'); assert.equal(clean('project', 'Off'), 'off');
  for (const bad of ['yes', 'true', '1', '', ' ', 'auto', 'onn', null, undefined, true, false, 1, 0, ['on'], {}]) assert.equal(clean('project', bad), null, String(bad));
  assert.equal(clean('proj', 'iso'), null);                                  // the camera has its own key
  assert.deepEqual(sanitize({ season: 'autumn', weather: 'hail', bogus: 1, time: '7:30' }), { season: 'autumn', time: '07:30' });
  assert.deepEqual(sanitize({ shelf: 25, season: 'winter' }), { season: 'winter', shelf: 25 }); assert.deepEqual(sanitize({ shelf: 1000 }), {});
  assert.deepEqual(sanitize('nonsense'), {}); assert.deepEqual(sanitize(null), {});
});
test('settings: URL overrides beat stored settings, stored beat the defaults, and each value says where it came from', () => {
  const stored = { season: 'winter', weather: 'rain', hemisphere: 'south', shelf: 20 };
  const url = fromQuery('?season=spring&time=06:30&bogus=1&weather=hail&shelf=5');
  assert.deepEqual(url, { season: 'spring', time: '06:30', shelf: 5 });
  const { values, from } = merge(stored, url);
  assert.deepEqual(values, { time: '06:30', season: 'spring', weather: 'rain', hemisphere: 'south', shelf: 5, project: 'off', scene: '3d' });
  assert.deepEqual(from, { time: 'url', season: 'url', weather: 'stored', hemisphere: 'stored', shelf: 'url', project: 'default', scene: 'default' });
  assert.equal(merge(stored, fromQuery('?shelf=2')).values.shelf, 20, 'a shelf size out of range in the address is ignored');
  assert.equal(merge({ shelf: 'many' }, {}).values.shelf, 10, 'and so is a broken stored one');
  assert.deepEqual(merge(stored, {}).values.season, 'winter');
  assert.deepEqual(fromQuery(''), {}); assert.deepEqual(fromQuery(undefined), {});
  assert.deepEqual(fromQuery('?weather=auto&hemisphere=south'), { weather: 'auto', hemisphere: 'south' });
});
test('settings: the project folder on a board is off unless it is stored or asked for in the address, and the address wins', () => {
  assert.equal(merge({}, {}).values.project, 'off');
  assert.deepEqual(fromQuery('?project=on'), { project: 'on' }); assert.deepEqual(fromQuery('?project=OFF'), { project: 'off' }); assert.deepEqual(fromQuery('?project=yes'), {});
  assert.deepEqual(merge({ project: 'on' }, {}), { values: { ...DEFAULTS, project: 'on' }, from: { ...Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, 'default'])), project: 'stored' } });
  assert.equal(merge({ project: 'on' }, fromQuery('?project=off')).values.project, 'off', 'the address beats the store');
  assert.equal(merge({ project: 'off' }, fromQuery('?project=on')).values.project, 'on');
  assert.equal(merge({ project: 'maybe' }, {}).values.project, 'off', 'a broken stored value is ignored');
  const s = memory();
  save(s, { project: 'on' });
  assert.deepEqual(JSON.parse(s.m[KEY]), { project: 'on' });
  merge(load(s), fromQuery('?project=off'));
  assert.deepEqual(load(s), { project: 'on' }, 'loading with an address override stores nothing');
  save(s, { project: 'sometimes' });
  assert.deepEqual(load(s), { project: 'on' }, 'an invalid change is dropped');
});
test('settings: saving merges into what is stored, a URL override is not stored by loading, a broken store is ignored', () => {
  const s = memory();
  assert.deepEqual(load(s), {});
  merge(load(s), fromQuery('?season=winter'));                               // loading with an override stores nothing
  assert.deepEqual(load(s), {});
  save(s, { season: 'autumn' });
  save(s, { weather: 'snow', season: 'bogus' });
  assert.deepEqual(load(s), { season: 'autumn', weather: 'snow' });
  assert.deepEqual(JSON.parse(s.m[KEY]), { season: 'autumn', weather: 'snow' });
  save(s, { shelf: 50 });
  assert.deepEqual(JSON.parse(s.m[KEY]), { season: 'autumn', weather: 'snow', shelf: 50 }, 'the shelf size is stored as a number');
  assert.deepEqual(load(memory({ [KEY]: '{not json' })), {});
  assert.deepEqual(load(memory({ [KEY]: '[1,2]' })), {});
  assert.deepEqual(load(null), {});
  assert.doesNotThrow(() => save(null, { season: 'autumn' }));
  assert.doesNotThrow(() => save({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, { season: 'autumn' }));
});
test('settings: a time setting is minutes after midnight, or null for the real clock', () => {
  assert.equal(timeMinutes('auto'), null); assert.equal(timeMinutes('07:30'), 450); assert.equal(timeMinutes('00:00'), 0); assert.equal(timeMinutes('23:55'), 1435);
});
