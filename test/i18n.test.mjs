import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGES, FALLBACK } from '../public/js/lang/index.js';
import { matchLanguage, resolveLanguage } from '../public/js/lang/resolve.js';
import { numberFormat } from '../public/js/lang/format.js';

const CODES = LANGUAGES.map(l => l.code);
const EN = LANGUAGES.find(l => l.code === FALLBACK);

// ---------------------------------------------------------------- the languages themselves

test('languages: every language has the fields the page needs; codes and names are unique; English is the reference', () => {
  assert.ok(EN, 'the fallback language is registered');
  for (const l of LANGUAGES) {
    assert.match(l.code, /^[a-z]{2,3}(-[A-Z][A-Za-z]{1,3})?$/, `${l.code}: a language tag`);
    for (const f of ['name', 'locale', 'chooseTitle']) assert.ok(typeof l[f] === 'string' && l[f].trim(), `${l.code} has no ${f}`);
    assert.equal(Intl.NumberFormat.supportedLocalesOf([l.locale]).length, 1, `${l.code}: locale ${l.locale} is unknown to Intl`);
    assert.ok(l.messages && typeof l.messages === 'object', `${l.code} has no messages`);
  }
  assert.equal(new Set(CODES).size, CODES.length, 'duplicate language code');
  assert.equal(new Set(LANGUAGES.map(l => l.name)).size, LANGUAGES.length, 'duplicate language name');
  assert.equal(new Set(LANGUAGES.map(l => l.chooseTitle)).size, LANGUAGES.length, 'two languages share a title');
});

test('languages: each language is named in its own language (Intl.DisplayNames in that language agrees)', () => {
  for (const l of LANGUAGES) {
    const base = l.code.split('-')[0];
    const own = new Intl.DisplayNames([l.locale], { type: 'language' }).of(base);
    assert.ok(l.name.toLocaleLowerCase(l.locale).startsWith(own.toLocaleLowerCase(l.locale)), `${l.code}: "${l.name}" is not how "${own}" is written in that language`);
  }
});

test('languages: no language lacks a key that English has, none has a key English lacks, and every value has a usable shape', () => {
  const en = Object.keys(EN.messages);
  for (const l of LANGUAGES) {
    const keys = Object.keys(l.messages);
    assert.deepEqual(en.filter(k => !keys.includes(k)), [], `${l.code} lacks these keys (they would show in English)`);
    assert.deepEqual(keys.filter(k => !en.includes(k)), [], `${l.code} has keys English does not have`);
    for (const [k, v] of Object.entries(l.messages)) {
      const ok = typeof v === 'string' || typeof v === 'function' || (v && typeof v === 'object' && typeof v.other === 'string');
      assert.ok(ok, `${l.code}: ${k} is not a string, a function or { one, other }`);
    }
  }
});

test('languages: every key that index.html binds exists in English', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-title|-aria|-tail)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 40, `${keys.length} bound keys`);
  assert.deepEqual([...new Set(keys)].filter(k => !(k in EN.messages)), []);
});

test('languages: the server labels map covers what the server writes, and only the Turkish file may be server-native', () => {
  assert.ok(EN.server && Object.keys(EN.server).length >= 10);
  for (const l of LANGUAGES) assert.ok(l.serverNative ? l.code === 'tr' : true, `${l.code} says its server labels are native, but the server writes Turkish`);
});

// ---------------------------------------------------------------- which language is shown

test('resolve: the system language is the first language the browser lists, whatever its region or spelling', () => {
  for (const tag of ['tr', 'tr-TR', 'TR', 'tr_TR', ' tr-tr ']) assert.deepEqual(resolveLanguage({ preferred: [tag], codes: CODES, fallback: FALLBACK }), { code: 'tr', source: 'system' }, tag);
  for (const tag of ['en', 'en-US', 'en-GB', 'EN-au']) assert.deepEqual(resolveLanguage({ preferred: [tag], codes: CODES, fallback: FALLBACK }), { code: 'en', source: 'system' }, tag);
});

test('resolve: a language that is not supported asks, and shows the fallback behind the list; so does a browser that lists nothing', () => {
  for (const preferred of [['de-DE'], ['ja'], ['zh-Hant-TW'], [], [''], undefined]) {
    assert.deepEqual(resolveLanguage({ preferred, codes: CODES, fallback: FALLBACK }), { code: FALLBACK, source: 'ask' }, JSON.stringify(preferred));
  }
});

test('resolve: only the first listed language counts: a supported language further down does not stop the question', () => {
  assert.equal(resolveLanguage({ preferred: ['de-DE', 'en-US'], codes: CODES, fallback: FALLBACK }).source, 'ask');
  assert.equal(resolveLanguage({ preferred: ['tr-TR', 'de'], codes: CODES, fallback: FALLBACK }).code, 'tr');
  assert.equal(resolveLanguage({ preferred: ['en-US', 'tr'], codes: CODES, fallback: FALLBACK }).code, 'en');
});

test('resolve: the visitor\'s saved choice beats the system language; a stale or unknown saved value is ignored', () => {
  assert.deepEqual(resolveLanguage({ saved: 'en', preferred: ['tr-TR'], codes: CODES, fallback: FALLBACK }), { code: 'en', source: 'saved' });
  assert.deepEqual(resolveLanguage({ saved: 'tr', preferred: ['de'], codes: CODES, fallback: FALLBACK }), { code: 'tr', source: 'saved' });
  assert.deepEqual(resolveLanguage({ saved: 'xx', preferred: ['tr'], codes: CODES, fallback: FALLBACK }), { code: 'tr', source: 'system' });
  assert.deepEqual(resolveLanguage({ saved: 'xx', preferred: ['de'], codes: CODES, fallback: FALLBACK }), { code: FALLBACK, source: 'ask' });
  assert.deepEqual(resolveLanguage({ saved: null, preferred: ['en'], codes: CODES, fallback: FALLBACK }), { code: 'en', source: 'system' });
});

test('match: a tag finds the whole code, then the same language, then another region of it; nothing else', () => {
  const codes = ['en', 'pt-BR', 'zh-Hans'];
  assert.equal(matchLanguage('pt-BR', codes), 'pt-BR');
  assert.equal(matchLanguage('pt-br', codes), 'pt-BR');
  assert.equal(matchLanguage('pt', codes), 'pt-BR');
  assert.equal(matchLanguage('pt-PT', codes), 'pt-BR');
  assert.equal(matchLanguage('en-GB', codes), 'en');
  assert.equal(matchLanguage('zh-Hant', codes), 'zh-Hans');
  for (const bad of ['de', 'p', '', null, undefined]) assert.equal(matchLanguage(bad, codes), null, String(bad));
});

test('resolve: a language added to the list is found without any other change', () => {
  const codes = [...CODES, 'de'];
  assert.deepEqual(resolveLanguage({ preferred: ['de-AT'], codes, fallback: FALLBACK }), { code: 'de', source: 'system' });
});

// ---------------------------------------------------------------- numbers

test('format: the decimal separator and the place of the percent sign come from the locale', () => {
  const en = numberFormat('en-US'), tr = numberFormat('tr-TR'), de = numberFormat('de-DE');
  assert.equal(en.pct(12), '12%'); assert.equal(en.dec('1.2'), '1.2'); assert.equal(en.num(1234.5), '1,234.5');
  assert.equal(tr.pct(12), '%12'); assert.equal(tr.dec('1.2'), '1,2'); assert.equal(tr.num(1234.5), '1.234,5');
  assert.equal(de.pct(12).replace(/\s/g, ' '), '12 %'); assert.equal(de.dec('1.2'), '1,2');
  assert.equal(en.pct(12.5), '12.5%', 'the number is not rounded or reformatted');
  assert.equal(tr.dec('12'), '12');
});
