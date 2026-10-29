// The floating interface that both scenes of the Office view share (the pixel scene, pixel/index.js, and the three.js scene, ofis.js with ofis-ui.js): the card that opens
// next to a clicked agent (pixel/card.js), the shelf card of the chats without a room with the zoom buttons under it (pixel/shelf-view.js), and the geometry that ties them to a
// scene: where the agent is on the screen, what the bar and the shelf card cover, where "fit" may frame the offices. A scene supplies only what it alone knows (below); the
// rest, the placement, the motion (docs/motion.md) and the closing rules, is the same code for both.
import { t as msg } from './i18n.js';
import { fmtShort } from './util.js';
import { createAgentCard } from './pixel/card.js';
import { createShelfView } from './pixel/shelf-view.js';
import { shelfEntries } from './pixel/shelf.js';

export const MIN_TARGET = 24;                // smallest click target around an agent, in CSS px

// options: root (the Office view: the card and the shelf column are laid out in its coordinates), area (the scene's own box inside it: pointer, wheel and size belong to it),
// ctx, storage, shelfMax (how many chats the shelf shows at first, the setting `shelf`),
// figureBox(id) -> { cx, cy, w, h } where the agent is, in CSS px from the top left of `area` (cx, cy its centre), or null when it is not in the scene,
// setSelected(id | null) (the scene marks the agent whose card is open), onShelfFirst() (the shelf card shows up for the first time: the scene frames its offices once again),
// figure (optional: how a row of the shelf draws its figure, see shelf-view.js; without it the rows draw the pixel atlas, `shelf.setAtlas`)
export function createOfficeUi({ root, area, ctx, storage = null, shelfMax, figureBox, setSelected = () => {}, onShelfFirst = () => {}, figure = null }) {
  const { store } = ctx;
  const rel = r => { const b = root.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }; };

  // Chats without a room: asleep ones (they leave their room) and closed ones (the server's list). shelf.js decides who and in which order, shelf-view.js draws the card
  // beside the scene; a click on a row opens the same card as a click on a figure, next to the row.
  const shelf = createShelfView({ root, area, msg, fmtShort, now: () => store.now(), open: (id, row) => { ctx.tip.hide(); card.open(id, row); }, storage, figure });
  shelf.setMax(shelfMax);

  // A click on an agent, on a room's floor (its main agent) or on a row of the shelf opens a card next to it: no drawer, no dimming. The card is placed in the coordinates
  // of `root`; the agent's place comes from the scene (it follows pan and zoom), a shelf row's from the page.
  function anchorOf(id, row) {
    const shelfRow = el => ({ ...rel(el.getBoundingClientRect()), kind: 'shelf', prefer: 'left' });
    if (row && row.isConnected) return shelfRow(row);
    const f = figureBox(id);
    if (f) {
      const a = rel(area.getBoundingClientRect()), w = Math.max(f.w, MIN_TARGET), h = Math.max(f.h, MIN_TARGET);
      return { x: a.x + f.cx - w / 2, y: a.y + f.cy - h / 2, w, h, kind: 'scene', prefer: 'right' };
    }
    const own = root.querySelector(`.sh-list li[data-id="${CSS.escape(id)}"] button`);
    return own ? shelfRow(own) : null;
  }
  const boundsOf = kind => {
    const b = root.getBoundingClientRect(), a = rel(area.getBoundingClientRect()), c = covered();
    return kind === 'shelf' ? { x0: 0, y0: a.y + c.top, x1: b.width, y1: b.height } : { x0: a.x, y0: a.y + c.top, x1: a.x + a.w - c.right, y1: a.y + a.h };
  };
  const card = createAgentCard({ root, ctx, storage, anchorOf, boundsOf, onSelect: setSelected });

  // What floats over the scene (CSS px, from the top and from the right of the area): the page's bar and the shelf card. The scene spans the whole area behind them; "fit"
  // frames the offices in what is left, and the agent card is placed there too.
  // where an element rests, not where an animation has it right now: its box without transforms (the shelf card arrives with a small travel and scale, and the first fit runs
  // the moment it appears)
  const restLeft = el => { const p = el.offsetParent; return p ? p.getBoundingClientRect().left + p.clientLeft + el.offsetLeft : el.getBoundingClientRect().left; };
  function covered() {
    const a = area.getBoundingClientRect(), top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h'));
    const shelfEl = root.querySelector('.of-shelf');
    const right = shelfEl && !shelfEl.hidden && root.dataset.shelf === 'open' ? Math.max(0, a.right - restLeft(shelfEl) + 8) : 0;
    return { top: Number.isFinite(top) ? Math.max(0, Math.min(top - a.top + 4, a.height * 0.4)) : 0, right: right > a.width * 0.45 ? 0 : right };
  }

  // the shelf card shows up for the first time: the scene frames the offices in the free part; folding or unfolding it never moves the map
  let shelfMode = root.dataset.shelf || 'none';
  new MutationObserver(() => {
    const m = root.dataset.shelf || 'none', first = shelfMode === 'none' && m === 'open';
    shelfMode = m;
    if (first) onShelfFirst();
  }).observe(root, { attributes: true, attributeFilter: ['data-shelf'] });

  return {
    card, shelf, covered,
    openAgent(id) { ctx.tip.hide(); card.open(id); },
    // the data changed: the rows of the shelf, and whether the chat of the open card is still there
    sync() { if (store.ready) shelf.update(shelfEntries({ agents: [...store.agents.values()], closed: store.closed || [] })); card.refresh(); },
    setVisible(on) { shelf.setVisible(on); if (!on) { ctx.tip.hide(); card.close(); } },
  };
}
