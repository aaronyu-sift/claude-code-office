// UI language. The languages live in ./lang/ (one file each, listed in ./lang/index.js); this file picks one and translates.
//
// The language is picked once on page load (rules and tests: lang/resolve.js):
//   localStorage['cco.lang'] (the visitor's choice)  →  the system language (the first language the browser lists)  →  the language list.
// When the system language is not supported, the page shows English behind a modal list of the supported languages, each in its own
// language (lang-picker.js); the choice is saved. The language button in the header opens the same list at any time.
// Switching saves the choice and reloads the page, so module-level constants (CATS, STATUS…) are built in the right language too.
//
// A message value can take three forms:
//   'Text {name}'            → placeholders are filled from params
//   { one, other }            → plural; the form is picked by params.n (Intl.PluralRules of the language's locale)
//   p => `...`                → function of the params object (for sentences whose word order differs by language)
// A missing key falls back to English, then to the key itself.
//
// Static text in index.html is bound with attributes:
//   data-i18n="k"        textContent      data-i18n-title="k"  title
//   data-i18n-aria="k"   aria-label       data-i18n-tail="k"   the element's last text node (child elements untouched)

import { LANGUAGES, FALLBACK } from './lang/index.js';
import { resolveLanguage } from './lang/resolve.js';
import { numberFormat } from './lang/format.js';
import { openLanguagePicker } from './lang-picker.js';

const STORE_KEY = 'cco.lang';
export const LANGS = LANGUAGES.map(l => l.code);

function readSaved() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }          // storage disabled
}
function readPreferred() {
  try { return navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language]; } catch { return []; }
}

const found = resolveLanguage({ saved: readSaved(), preferred: readPreferred(), codes: LANGS, fallback: FALLBACK });
const EN = LANGUAGES.find(l => l.code === FALLBACK);
const L = LANGUAGES.find(l => l.code === found.code);

export const lang = L.code;
export const locale = L.locale;

// Save a language and use it: a reload when it differs from the one on screen.
export function setLang(next) {
  if (!LANGS.includes(next)) return;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* storage disabled: the choice can't survive the reload */ }
  if (next !== lang) location.reload();
}

// ---------------------------------------------------------------- messages

const dict = L.messages;
const plural = new Intl.PluralRules(L.locale);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function t(key, p) {
  let v = has(dict, key) ? dict[key] : EN.messages[key];
  if (v == null) return key;
  if (typeof v === 'function') return v(p || {});
  if (typeof v === 'object') v = v[plural.select(Number(p && p.n) || 0)] || v.other;
  return p ? v.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? String(p[k]) : m)) : v;
}

// ---------------------------------------------------------------- formatting

const nums = numberFormat(L.locale);
export const fmtNum = nums.num;
export const fmtPct = nums.pct;
export const dec = nums.dec;
// Date → 'long' | 'short' | 'since' format
export function fmtDate(kind, date, extra) {
  return t('date.' + kind, { d: date.getDate(), m: date.getMonth(), w: date.getDay(), ...extra });
}

// ---------------------------------------------------------------- server text
// The server also sends a language-neutral `code` with most labels it synthesizes (see util.js actText/evText).
// A small map covers the few remaining fixed strings, which the server writes in Turkish; transcript content (commands, file names, prompts)
// is left as is. A language without its own `server` map uses English's.
export function serverText(s) {
  if (!s || L.serverNative) return s || '';
  const map = L.server || EN.server;
  if (has(map, s)) return map[s];
  const m = /^(\d+) alt ajan bekleniyor$/.exec(s);
  return m ? t('act.waitSubs', { n: Number(m[1]) }) : s;
}

// ---------------------------------------------------------------- static page

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-tail]').forEach(el => {
    const n = [...el.childNodes].reverse().find(x => x.nodeType === 3 && x.nodeValue.trim());
    if (n) n.nodeValue = t(el.dataset.i18nTail);
  });
}

function mountLangButton() {
  const b = document.getElementById('lang');
  if (!b || b.dataset.ready) return;
  b.dataset.ready = '1';
  b.textContent = lang.split('-')[0].toUpperCase();
  b.title = t('lang.tip', { cur: L.name });
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-haspopup', 'dialog');
  b.addEventListener('click', () => openLanguagePicker({ languages: LANGUAGES, current: lang, dismissable: true, closeLabel: t('lang.close'), onPick: setLang, opener: b }));
}

try {
  document.documentElement.lang = lang;
  applyDom();
  mountLangButton();
  if (found.source === 'ask') openLanguagePicker({ languages: LANGUAGES, current: null, dismissable: false, onPick: setLang });
} catch { /* no DOM (e.g. in tests): skip silently */ }
