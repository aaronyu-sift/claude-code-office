import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, clean, fromQuery, merge, load, save } from '../public/js/pixel/settings.js';
import { createOfficeSettings, officeQuery, urlAfterChange } from '../public/js/office-settings.js';

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
