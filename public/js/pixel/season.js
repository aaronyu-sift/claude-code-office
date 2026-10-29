// Seasons of the pixel scene: pure functions, no DOM and no clock of their own (the caller passes a date), so every rule can be tested
// with fake dates. The art is baked (tools/sprites/seasons.mjs): a seasonal sprite is `<id>@spring|autumn|winter` in the manifest and
// summer is the plain sprite, so choosing a season is choosing which ids the scene draws.
import { SEASONAL_SLOTS } from './ids.js';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const HEMISPHERES = ['north', 'south'];

// Meteorological seasons: spring March to May, summer June to August, autumn September to November, winter December to February.
// In the southern hemisphere the same months are six months apart. `month` is 1..12.
export function seasonOf(month, hemisphere = 'north') {
  const m = (((month | 0) - 1 + (hemisphere === 'south' ? 6 : 0)) % 12 + 12) % 12;      // 0 = January (northern reckoning)
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}
export const seasonOfDate = (date, hemisphere = 'north') => seasonOf(date.getMonth() + 1, hemisphere);
export const parseSeason = text => { const t = String(text || '').trim().toLowerCase(); return SEASONS.includes(t) ? t : null; };
export const parseHemisphere = text => { const t = String(text || '').trim().toLowerCase(); return HEMISPHERES.includes(t) ? t : null; };

// "2026-10-28" in the local calendar: the seed of the automatic weather and the day the season is taken from
export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDateKey = key => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '')), d = m && new Date(+m[1], +m[2] - 1, +m[3], 12);
  return d && dateKey(d) === key ? d : null;                                              // "2026-02-30" is not a day
};
export const addDays = (key, n) => { const d = parseDateKey(key); d.setDate(d.getDate() + n); return dateKey(d); };

// The sunrise table (time.js) is for the northern hemisphere: in the southern one January has the days of July.
export const lightMonth = (month, hemisphere = 'north') => (hemisphere === 'south' ? ((month + 5) % 12) + 1 : month);

// The sprite the scene draws for a layout id in a season: the seasonal variant when the atlas has one, else the plain sprite; a slot of the
// garden (seasonal_a, seasonal_b) holds whatever the season puts there, or nothing (null). `has(id)` says whether the manifest knows an id.
export function spriteFor(id, season, has) {
  const slot = SEASONAL_SLOTS[id];
  if (slot) return slot.by[season] || null;
  return season !== 'summer' && has(`${id}@${season}`) ? `${id}@${season}` : id;
}
