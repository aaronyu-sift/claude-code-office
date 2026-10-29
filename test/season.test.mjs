import test from 'node:test';
import assert from 'node:assert/strict';
import { SEASONS, seasonOf, seasonOfDate, parseSeason, parseHemisphere, dateKey, parseDateKey, addDays, lightMonth, spriteFor } from '../public/js/pixel/season.js';

test('season: the northern seasons by month (meteorological: March, June, September, December)', () => {
  const want = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  want.forEach((s, i) => assert.equal(seasonOf(i + 1, 'north'), s, `month ${i + 1}`));
  assert.equal(seasonOf(5), 'spring');                                         // north is the default
});
test('season: the southern hemisphere is six months apart', () => {
  const want = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
  want.forEach((s, i) => assert.equal(seasonOf(i + 1, 'south'), s, `month ${i + 1}`));
  for (let m = 1; m <= 12; m++) assert.notEqual(seasonOf(m, 'north'), seasonOf(m, 'south'), `month ${m} has the same season in both hemispheres`);
});
test('season: fake dates, both hemispheres, around the boundaries', () => {
  const cases = [['2026-02-28', 'winter', 'summer'], ['2026-03-01', 'spring', 'autumn'], ['2026-05-31', 'spring', 'autumn'], ['2026-06-01', 'summer', 'winter'],
    ['2026-08-31', 'summer', 'winter'], ['2026-09-01', 'autumn', 'spring'], ['2026-11-30', 'autumn', 'spring'], ['2026-12-01', 'winter', 'summer'], ['2026-10-28', 'autumn', 'spring'],
    ['2027-01-01', 'winter', 'summer'], ['2028-02-29', 'winter', 'summer']];
  for (const [key, north, south] of cases) {
    const d = parseDateKey(key);
    assert.equal(seasonOfDate(d, 'north'), north, key + ' north');
    assert.equal(seasonOfDate(d, 'south'), south, key + ' south');
  }
});
test('season: all four seasons occur in a year, in both hemispheres', () => {
  for (const h of ['north', 'south']) assert.deepEqual([...new Set(Array.from({ length: 12 }, (_, i) => seasonOf(i + 1, h)))].sort(), [...SEASONS].sort());
});
test('season: parsing, date keys and day arithmetic', () => {
  assert.equal(parseSeason(' Winter '), 'winter'); assert.equal(parseSeason('monsoon'), null); assert.equal(parseSeason(null), null);
  assert.equal(parseHemisphere('SOUTH'), 'south'); assert.equal(parseHemisphere('east'), null);
  assert.equal(dateKey(new Date(2026, 9, 28, 23, 59)), '2026-10-28');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28'); assert.equal(addDays('2028-03-01', -1), '2028-02-29'); assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(parseDateKey('2026-13-01'), null); assert.equal(parseDateKey('2026-02-30'), null); assert.equal(parseDateKey('yesterday'), null);
  assert.equal(dateKey(parseDateKey('2028-02-29')), '2028-02-29');
});
test('season: the sunrise table is shifted by six months in the southern hemisphere', () => {
  assert.equal(lightMonth(1, 'north'), 1); assert.equal(lightMonth(1, 'south'), 7); assert.equal(lightMonth(7, 'south'), 1); assert.equal(lightMonth(12, 'south'), 6);
  for (let m = 1; m <= 12; m++) assert.equal(lightMonth(lightMonth(m, 'south'), 'south'), m);
});
test('season: the sprite a season draws is the variant when the atlas has it, else the plain sprite; slots may be empty', () => {
  const have = new Set(['tree_a', 'tree_a@autumn', 'tree_a@winter', 'rock', 'rock@winter', 'floor_path']);
  const has = id => have.has(id);
  assert.equal(spriteFor('tree_a', 'summer', has), 'tree_a');
  assert.equal(spriteFor('tree_a', 'autumn', has), 'tree_a@autumn');
  assert.equal(spriteFor('tree_a', 'spring', has), 'tree_a');                 // no spring variant in this atlas: the plain sprite
  assert.equal(spriteFor('rock', 'autumn', has), 'rock'); assert.equal(spriteFor('rock', 'winter', has), 'rock@winter');
  assert.equal(spriteFor('seasonal_a', 'winter', has), 'snowman'); assert.equal(spriteFor('seasonal_a', 'summer', has), 'birdbath');
  assert.equal(spriteFor('seasonal_b', 'autumn', has), 'leafpile'); assert.equal(spriteFor('seasonal_b', 'winter', has), null);
});
