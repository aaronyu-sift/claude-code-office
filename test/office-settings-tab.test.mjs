// The store behind the Settings tab and the popover: the keys `project` and `scene`, another tab's change, where a value comes from, the rows of the tab and the hub that
// both controls talk to (public/js/office-settings.js). The tab's own logic (tabs.js, settings-tab.js) is in tabs.test.mjs and settings-tab.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeSettings, createSettingsHub, officeQuery, urlAfterChange, tabRowsOf, sceneChoice, sourceOf, shelfChoices, fixedNow, minutesOf, TAB_ROWS, OFFICE3D_ROWS } from '../public/js/office-settings.js';
import { KEY, save } from '../public/js/pixel/settings.js';

const memory = (init = {}) => { const m = { ...init }; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test('project: off by default, kept when chosen, the address wins and is not stored; the 3D scene reads it from here, live (this replaced board-setting.js)', () => {
  assert.equal(createOfficeSettings({ storage: memory(), watch: null }).get('project'), 'off');
  assert.equal(createOfficeSettings({ storage: memory({ [KEY]: JSON.stringify({ project: 'on' }) }), watch: null }).get('project'), 'on');
  const s = memory({ [KEY]: JSON.stringify({ project: 'on' }) });
  assert.equal(createOfficeSettings({ storage: s, overrides: officeQuery('?project=off'), watch: null }).get('project'), 'off');
  const url = memory();
  const a = createOfficeSettings({ storage: url, overrides: officeQuery('?project=on&season=winter'), watch: null });
  assert.equal(a.get('project'), 'on'); assert.equal(a.from().project, 'url'); assert.equal(url.m[KEY], undefined, 'an address override is not stored');
  assert.equal(createOfficeSettings({ storage: memory({ [KEY]: JSON.stringify({ project: 'bogus' }) }), watch: null }).get('project'), 'off');
  assert.equal(createOfficeSettings({ storage: memory(), overrides: officeQuery('?project=maybe'), watch: null }).get('project'), 'off');
  const live = createOfficeSettings({ storage: memory(), watch: null }), seen = [];
  const stop = live.on('project', v => seen.push(v));
  assert.equal(live.set('project', 'on'), true); assert.equal(live.set('project', true), false, 'only on and off');
  live.set('project', 'on'); live.set('project', 'nonsense');
  assert.deepEqual(seen, ['on'], 'one notice for one change');
  stop(); live.set('project', 'off');
  assert.deepEqual(seen, ['on']); assert.equal(live.get('project'), 'off');
});

test('another tab: a change of the stored settings is taken over and told to the listeners; an address override still in force keeps winning', () => {
  const store = memory(), watch = new EventTarget();
  const fire = key => watch.dispatchEvent(Object.assign(new Event('storage'), { key }));
  const s = createOfficeSettings({ storage: store, overrides: officeQuery('?season=summer'), watch }), seen = [];
  s.on('*', (v, k) => seen.push(k + '=' + v));
  save(store, { project: 'on', season: 'winter', weather: 'rain' });
  fire('something-else');
  assert.deepEqual(seen, [], 'not our key');
  fire(KEY);
  assert.deepEqual(seen.sort(), ['project=on', 'weather=rain']);
  assert.equal(s.get('season'), 'summer', 'the address still wins over the other tab\'s store');
  assert.equal(s.from().project, 'stored'); assert.equal(s.from().season, 'url');
  fire(null);
  assert.equal(seen.length, 2, 'nothing changed, nobody told');
  s.set('season', 'autumn');                                                  // the visitor changed it here: the address follows, so the override is let go
  save(store, { weather: 'fog' });
  fire(KEY);
  assert.equal(s.get('season'), 'autumn'); assert.equal(s.get('weather'), 'fog');
  save(store, { project: 'off' }); fire(KEY);
  assert.equal(s.get('project'), 'off');
  assert.doesNotThrow(() => createOfficeSettings({ storage: null, watch }));
  assert.doesNotThrow(() => createOfficeSettings({ storage: memory(), watch: null }));
});

test('scene: the address, else the stored choice, else 3d; a choice made in the controls is stored, and loading with ?scene= stores nothing', () => {
  assert.equal(sceneChoice({ storage: memory(), search: '' }), '3d');
  assert.equal(sceneChoice({ storage: memory({ [KEY]: JSON.stringify({ scene: 'pixel' }) }), search: '' }), 'pixel');
  assert.equal(sceneChoice({ storage: memory({ [KEY]: JSON.stringify({ scene: 'pixel' }) }), search: '?scene=3d' }), '3d', 'the address wins');
  assert.equal(sceneChoice({ storage: memory(), search: '?scene=pixel&season=winter' }), 'pixel');
  assert.equal(sceneChoice({ storage: memory({ [KEY]: JSON.stringify({ scene: 'pixel' }) }), search: '?scene=flat' }), 'pixel', 'a scene that does not exist is ignored');
  assert.equal(sceneChoice({ storage: null, search: '?scene=pixel' }), 'pixel');
  const store = memory();
  sceneChoice({ storage: store, search: '?scene=pixel' });
  assert.equal(store.m[KEY], undefined);
  const s = createOfficeSettings({ storage: store, overrides: officeQuery('?scene=pixel'), watch: null });
  assert.equal(s.get('scene'), 'pixel'); assert.equal(s.from().scene, 'url');
  assert.equal(s.set('scene', '3d'), true); assert.equal(s.set('scene', 'flat'), false);
  assert.deepEqual(JSON.parse(store.m[KEY]), { scene: '3d' });
  assert.equal(sceneChoice({ storage: store, search: '' }), '3d');
  assert.equal(urlAfterChange('?scene=pixel', 'scene', '3d'), '?scene=3d', 'an address that names the scene follows the control');
  assert.equal(urlAfterChange('?season=winter', 'scene', 'pixel'), null);
});

test('source of a value: the address when it names the setting, else stored when a choice was kept, else default', () => {
  const from = { time: 'default', season: 'stored', weather: 'user', hemisphere: 'url', shelf: 'default', project: 'default', scene: 'default' };
  assert.equal(sourceOf('time', from, ''), 'default');
  assert.equal(sourceOf('season', from, ''), 'stored');
  assert.equal(sourceOf('weather', from, ''), 'stored', 'a choice made here is kept');
  assert.equal(sourceOf('hemisphere', from, '?hemisphere=south'), 'url');
  assert.equal(sourceOf('weather', from, '?weather=rain'), 'url', 'the address that follows a control still decides at the next load');
  assert.equal(sourceOf('time', from, '?hour=21'), 'url', '?hour= is the address naming the time');
  assert.equal(sourceOf('shelf', from, '?shelf=2'), 'default', 'a value the address names badly is not the address\'s');
  assert.equal(sourceOf('project', {}, ''), 'default'); assert.equal(sourceOf('project', null, undefined), 'default');
});

test('tab rows: the scene first, then the popover\'s rows that the scene in force supports (the camera only where the scene has one)', () => {
  assert.deepEqual(TAB_ROWS, ['scene', 'camera', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project']);
  assert.deepEqual(tabRowsOf({}), TAB_ROWS); assert.deepEqual(tabRowsOf(null), TAB_ROWS, 'before any scene exists every row is listed');
  assert.deepEqual(tabRowsOf({ settingRows: OFFICE3D_ROWS }), ['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project']);
  assert.deepEqual(tabRowsOf({ settingRows: [] }), ['scene']);
});

test('shelf sizes and the fixed time: the choices on offer, the size of the address added while it is current, now to the five minutes before', () => {
  assert.deepEqual(shelfChoices(10), [5, 10, 20, 50]); assert.deepEqual(shelfChoices(7), [5, 7, 10, 20, 50]); assert.deepEqual(shelfChoices(200), [5, 10, 20, 50, 200]);
  assert.deepEqual(shelfChoices(NaN), [5, 10, 20, 50]); assert.deepEqual(shelfChoices(undefined), [5, 10, 20, 50]);
  assert.equal(fixedNow(new Date(2026, 9, 29, 17, 53)), '17:50'); assert.equal(fixedNow(new Date(2026, 9, 29, 0, 4)), '00:00'); assert.equal(fixedNow(new Date(2026, 9, 29, 23, 59)), '23:55');
  assert.equal(minutesOf('22:00'), 1320); assert.equal(minutesOf('auto'), 720, 'noon: a place to stand'); assert.equal(minutesOf(undefined), 720);
});

test('settings hub: a change applies to the scene in force, keeps the address in step and tells every control once; a change heard from the store is passed on', () => {
  let office = null;
  const calls = [], told = [];
  const make = () => {
    const store = createOfficeSettings({ storage: memory(), watch: null });
    return { settingRows: OFFICE3D_ROWS, get settings() { return store.get(); }, get settingsFrom() { return store.from(); }, setSetting: (k, v) => store.set(k, v), store };
  };
  const hub = createSettingsHub({ getOffice: () => office, afterChange: (k, v) => calls.push(k + '=' + v) });
  assert.equal(hub.office(), null); assert.equal(hub.settings(), null); assert.deepEqual(hub.from(), {}); assert.equal(hub.set('season', 'winter'), false, 'no scene yet');
  assert.deepEqual(hub.rows(), TAB_ROWS);
  office = make();
  const stop = hub.on((k, v) => told.push(k + '=' + v)), second = [];
  hub.on((k, v) => second.push(k + '=' + v));
  assert.equal(hub.set('season', 'winter'), true);
  assert.equal(hub.set('season', 'monsoon'), false, 'a value the scene refuses is neither kept in step nor told');
  assert.deepEqual(calls, ['season=winter']); assert.deepEqual(told, ['season=winter']); assert.deepEqual(second, ['season=winter']);
  assert.equal(hub.settings().season, 'winter'); assert.equal(hub.from().season, 'user');
  assert.deepEqual(hub.rows(), ['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project']);
  office.store.on('*', (v, k) => hub.heard(k, v));                             // the store reports every change, also the ones that came through the hub
  hub.set('project', 'on');
  assert.deepEqual(told, ['season=winter', 'project=on'], 'once, not twice');
  office.store.set('weather', 'rain');                                          // a change that did not come through the hub (another tab)
  assert.deepEqual(told, ['season=winter', 'project=on', 'weather=rain'], 'passed on');
  stop();
  hub.set('weather', 'fog');
  assert.equal(told.length, 3); assert.equal(second.length, 4, 'a listener that stopped hears nothing, the other still does');
  hub.on(() => { throw new Error('a listener must not break the others'); });
  const before = second.length, log = console.error;
  console.error = () => {};
  try { assert.doesNotThrow(() => hub.set('hemisphere', 'south')); } finally { console.error = log; }
  assert.equal(second.length, before + 1);
});
