// Which language the page shows. Pure functions (no DOM, no storage), so every rule is tested without a browser.
//
// The order: 1. the language the visitor chose (saved), 2. the system language, 3. otherwise the page asks (the language list opens).
// "System language" is the first language the browser lists (navigator.languages[0]), the one the visitor ranks highest. When that one is not
// supported the page asks, even if a language further down the list is supported: a second place in a ranking is not a choice.

const norm = tag => String(tag || '').trim().replace(/_/g, '-').toLowerCase();
const primary = tag => norm(tag).split('-')[0];

// The supported code that fits a language tag: the whole tag first ('pt-br'), then the same language without a region ('pt'), then another
// region of the same language ('pt-br' for a visitor on 'pt-pt'). null when the language is not supported at all.
export function matchLanguage(tag, codes) {
  const t = norm(tag);
  if (!t) return null;
  const byNorm = new Map(codes.map(c => [norm(c), c]));
  if (byNorm.has(t)) return byNorm.get(t);
  const p = primary(t);
  if (byNorm.has(p)) return byNorm.get(p);
  return codes.find(c => primary(c) === p) || null;
}

// -> { code, source }; source is 'saved' | 'system' | 'ask'. With 'ask' the code is the fallback language to show behind the language list.
export function resolveLanguage({ saved, preferred = [], codes, fallback }) {
  const s = saved && codes.find(c => norm(c) === norm(saved));                 // a stale or unknown saved value is ignored
  if (s) return { code: s, source: 'saved' };
  const first = preferred.map(norm).find(Boolean);
  const m = first && matchLanguage(first, codes);
  if (m) return { code: m, source: 'system' };
  return { code: fallback, source: 'ask' };
}
