// The header's tablist (public/js/tabs.js) and the markup it works on (public/index.html).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextIndex, revealDelta, createTablist } from '../public/js/tabs.js';

test('tablist keys: Right and Left go round, Home and End go to the ends, nothing else is for the tablist', () => {
  assert.equal(nextIndex(5, 0, 'ArrowRight'), 1); assert.equal(nextIndex(5, 4, 'ArrowRight'), 0, 'wraps to the first');
  assert.equal(nextIndex(5, 2, 'ArrowLeft'), 1); assert.equal(nextIndex(5, 0, 'ArrowLeft'), 4, 'wraps to the last');
  assert.equal(nextIndex(5, 3, 'Home'), 0); assert.equal(nextIndex(5, 1, 'End'), 4);
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab', 'a', '5', 'PageDown', undefined]) assert.equal(nextIndex(5, 2, key), null, String(key));
  assert.equal(nextIndex(0, 0, 'ArrowRight'), null, 'no tabs'); assert.equal(nextIndex(1, 0, 'ArrowRight'), 0, 'one tab: stay');
  assert.equal(nextIndex(5, -1, 'ArrowRight'), 1, 'focus not on a tab: counted from the first'); assert.equal(nextIndex(5, undefined, 'End'), 4);
});

// a pretend nav: buttons with a dataset, attributes, a focus() and closest(); the handlers the tablist registers are kept to fire by hand
function pretend(names) {
  const handlers = {};
  const focused = [];
  const buttons = names.map(name => {
    const b = { dataset: { view: name }, attrs: {}, tabIndex: 0, setAttribute(k, v) { this.attrs[k] = v; }, focus() { focused.push(name); }, closest(sel) { return sel === '[role="tab"]' ? this : null; } };
    return b;
  });
  const nav = { addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => buttons, contains: b => buttons.includes(b) };
  return { nav, buttons, handlers, focused };
}

test('tablist: the selected tab is aria-selected and the one stop of the Tab key, the others are reached with the arrows', () => {
  const { nav, buttons } = pretend(['pano', 'ofis', 'akis', 'maliyet', 'settings']);
  const tl = createTablist(nav);
  tl.select('settings');
  assert.deepEqual(buttons.map(b => b.attrs['aria-selected']), ['false', 'false', 'false', 'false', 'true']);
  assert.deepEqual(buttons.map(b => b.tabIndex), [-1, -1, -1, -1, 0]);
  tl.select('ofis');
  assert.deepEqual(buttons.map(b => b.attrs['aria-selected']), ['false', 'true', 'false', 'false', 'false']);
  assert.deepEqual(buttons.map(b => b.tabIndex), [-1, 0, -1, -1, -1]);
  tl.select('nowhere');
  assert.ok(buttons.every(b => b.attrs['aria-selected'] === 'false' && b.tabIndex === -1), 'a name that is no tab selects none');
});

test('tablist: a click chooses a tab; an arrow key moves the focus and chooses the next tab; a key with a modifier is left alone', () => {
  const { nav, buttons, handlers, focused } = pretend(['pano', 'ofis', 'akis', 'maliyet', 'settings']);
  const chosen = [];
  createTablist(nav, { onSelect: n => chosen.push(n) });
  handlers.click({ target: buttons[2] });
  assert.deepEqual(chosen, ['akis']);
  const key = (k, target, extra = {}) => { const e = { key: k, target, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; handlers.keydown(e); return e; };
  let e = key('ArrowRight', buttons[4]);
  assert.deepEqual(focused, ['pano']); assert.equal(chosen.at(-1), 'pano'); assert.ok(e.prevented, 'the page does not scroll');
  key('ArrowLeft', buttons[0]);
  assert.equal(focused.at(-1), 'settings'); assert.equal(chosen.at(-1), 'settings');
  key('Home', buttons[3]); assert.equal(chosen.at(-1), 'pano');
  key('End', buttons[1]); assert.equal(chosen.at(-1), 'settings');
  const n = chosen.length;
  e = key('Enter', buttons[1]); assert.equal(chosen.length, n); assert.ok(!e.prevented, 'Enter and Space are the button\'s own click');
  e = key('ArrowRight', buttons[1], { altKey: true }); assert.equal(chosen.length, n); assert.ok(!e.prevented);
  e = key('ArrowRight', buttons[1], { shiftKey: true }); assert.equal(chosen.length, n);
  e = key('ArrowRight', buttons[1], { ctrlKey: true }); assert.equal(chosen.length, n);
});

test('markup: the nav is a tablist of five tabs, each names its panel, each panel names its tab; the tab for the settings is last', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const nav = /<nav class="seg" role="tablist"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav, 'the nav');
  const tabs = [...nav[1].matchAll(/<button role="tab" id="(tab-\w+)" aria-controls="(view-\w+)" data-view="(\w+)"/g)].map(m => ({ id: m[1], controls: m[2], view: m[3] }));
  assert.deepEqual(tabs.map(t => t.view), ['pano', 'ofis', 'akis', 'maliyet', 'settings']);
  assert.equal([...nav[1].matchAll(/<button role="tab"/g)].length, 5, 'every tab has an id, a panel and a view');
  for (const t of tabs) {
    assert.equal(t.id, 'tab-' + t.view); assert.equal(t.controls, 'view-' + t.view);
    assert.match(html, new RegExp(`<section id="${t.controls}"[^>]*role="tabpanel"[^>]*aria-labelledby="${t.id}"`), `${t.controls} is a panel labelled by ${t.id}`);
  }
  assert.match(html, /title="Settings \(5\)"/, 'the shortcut is on the tab');
});

test('the strip scrolls the chosen tab into view: nothing when it is inside, left or right by exactly what is cut off', () => {
  const strip = { left: 29, right: 291 };
  assert.equal(revealDelta(strip, { left: 100, right: 160 }), 0, 'inside');
  assert.equal(revealDelta(strip, { left: 29, right: 291 }), 0, 'exactly as wide as the strip');
  assert.equal(revealDelta(strip, { left: 270, right: 332 }), 41, 'the last tab is cut off on the right: scroll right by the 41 px that are lost');
  assert.equal(revealDelta(strip, { left: 10, right: 80 }), -19, 'cut off on the left: scroll left');
  assert.equal(revealDelta(null, { left: 0, right: 5 }), 0); assert.equal(revealDelta(strip, null), 0);
});

test('tablist: choosing a tab that is cut off scrolls the strip by the delta; a pretend nav without layout does nothing', () => {
  const { nav, buttons } = pretend(['pano', 'ofis', 'akis', 'maliyet', 'settings']);
  const tl = createTablist(nav);
  assert.doesNotThrow(() => tl.select('ofis'));
  nav.scrollLeft = 0;
  nav.getBoundingClientRect = () => ({ left: 29, right: 291 });
  buttons[4].getBoundingClientRect = () => ({ left: 270, right: 332 });
  tl.select('settings');
  assert.equal(nav.scrollLeft, 41);
  buttons[1].getBoundingClientRect = () => ({ left: 60, right: 110 });
  tl.select('ofis');
  assert.equal(nav.scrollLeft, 41, 'a tab that is inside leaves the strip alone');
});
