// The tabs in the header as a proper tablist (WAI-ARIA tabs pattern): the selected tab is the one stop of the Tab key (roving tabindex), the arrow keys move between
// tabs (Left and Right, wrapping round; Home and End go to the first and the last), the choice is announced by aria-selected, and each tab names the panel it controls.
// A tab is activated as soon as it gets focus by an arrow key (the views switch at once), and by a click, Enter or Space as any button.
//
//   nextIndex(count, current, key)           the index an arrow key leads to, or null for a key that is not for the tablist
//   revealDelta(strip, tab)                  how far the strip must scroll sideways (negative: left) so that the tab is inside it; 0 when it is, rects are { left, right }
//   createTablist(nav, { onSelect })          select(name) marks a tab, focus(name) and the keyboard are handled here; `onSelect(name)` is told when a tab is chosen by the visitor
//
// The tabs are the `[role="tab"]` buttons of `nav`, named by their `data-view`; the panel of a tab is the element its `aria-controls` points to.

export function nextIndex(count, current, key) {
  if (!(count > 0)) return null;
  const at = Number.isInteger(current) && current >= 0 && current < count ? current : 0;
  if (key === 'ArrowRight') return (at + 1) % count;
  if (key === 'ArrowLeft') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

// the strip scrolls sideways when the tabs are wider than the bar (a very narrow window, a long language), with no scrollbar to show it: the chosen tab is always scrolled into view
export function revealDelta(strip, tab) {
  if (!strip || !tab) return 0;
  if (tab.left < strip.left) return tab.left - strip.left;
  if (tab.right > strip.right) return tab.right - strip.right;
  return 0;
}

export function createTablist(nav, { onSelect = () => {} } = {}) {
  const tabs = () => [...nav.querySelectorAll('[role="tab"]')];
  let current = null;                                   // the selected tab
  // by hand, not scrollIntoView: that could also move the page
  function reveal() {
    if (!current || typeof current.getBoundingClientRect !== 'function' || typeof nav.getBoundingClientRect !== 'function') return;
    const d = revealDelta(nav.getBoundingClientRect(), current.getBoundingClientRect());
    if (d) nav.scrollLeft += d;
  }
  function select(name) {
    for (const b of tabs()) {
      const on = b.dataset.view === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;                           // only the selected tab is a stop of the Tab key; the arrows reach the others
      if (on) current = b;
    }
    reveal();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(reveal).observe(nav);        // a window that gets narrower (a phone turned round) keeps the chosen tab in view
  nav.addEventListener('click', e => {
    const b = e.target.closest('[role="tab"]');
    if (b && nav.contains(b)) onSelect(b.dataset.view);
  });
  nav.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const list = tabs(), i = nextIndex(list.length, list.indexOf(e.target.closest('[role="tab"]')), e.key);
    if (i == null) return;
    e.preventDefault();
    list[i].focus();
    onSelect(list[i].dataset.view);
  });
  return { select, tabs };
}
