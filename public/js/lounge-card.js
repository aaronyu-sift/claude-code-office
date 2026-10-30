// The card of the lounge: the glass card of the agents (app.css `.of-card`, placed by pixel/cardplace.js, moved in and out by motion.js) with the last twenty posts of the
// message board, who is in the lounge, and a line that says where the data comes from. It floats next to the wall, follows it through pan and zoom, closes with its cross,
// Escape or a click on the empty scene, and is reached from the keyboard through the sign over the pavilion (ofis-lounge.js).
//
//   const card = createLoungeCard({ root, msg, anchor, bounds, onOpen, onClose })
//   card.open(view, returnFocusTo) / card.close() / card.update(view) / card.place() / card.isOpen / card.el / card.read()
//
// anchor() -> { x, y, w, h } the wall on the screen, in the coordinates of `root`, or null when it is not in the view; bounds() -> { x0, y0, x1, y1 } what the card may use.
// The view is the one of lounge-model.js `buildView` (`view.card` has what the card shows). Nothing in the card is built from a text that did not go through cleanText.
import { placeCard } from './pixel/cardplace.js';
import { enter, leave, comesFrom } from './motion.js';
import { esc, icon } from './util.js';

const TONE = { ok: '#4ade80', quiet: '#8fb0ff', off: '#a9b3d6', warn: '#fab219' };

export function createLoungeCard({ root, msg = k => k, anchor, bounds, onOpen = () => {}, onClose = () => {} }) {
  const el = Object.assign(document.createElement('aside'), { className: 'of-card of-lounge-card', hidden: true, tabIndex: -1 });
  el.setAttribute('role', 'dialog');
  root.append(el);
  let open = false, lastKey = '', placeAt = { x: NaN, y: NaN, side: '' }, opener = null, view = null;

  const rowHtml = r => {
    const who = esc(r.who), text = r.text ? `<div class="lg-text">${esc(r.text)}</div>` : '';
    return `<li class="lg-post"><div class="lg-top"><span class="lg-chip" style="--c:${esc(r.chipColour)}">${esc(r.chip || '·')}</span><span class="lg-who">${who}</span><span class="lg-age">${esc(r.age)}</span></div>${text}</li>`;
  };
  function body(v) {
    const c = v.card, tone = TONE[c.sign.tone] || TONE.ok;
    const people = c.people.length ? `<div class="oc-sub">${esc(msg('lounge.in'))}</div><div class="lg-people">${v.people.map(p => `<span class="lg-person" title="${esc(p.sessionName ? msg('lounge.person', { name: p.name, chat: p.sessionName }) : p.name)}"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>`).join('')}</div>` : (v.state === 'ok' ? `<div class="oc-note">${esc(msg('lounge.nobody'))}</div>` : '');
    const channels = c.channels.length ? `<div class="oc-sub">${esc(msg('lounge.channels'))}</div><div class="lg-people">${c.channels.map(h => `<span class="lg-chip" style="--c:${esc(h.colour)}">${esc(h.name)} <b>${h.n}</b></span>`).join('')}</div>` : '';
    const posts = c.rows.length
      ? `<div class="oc-sub">${esc(msg('lounge.last'))}</div><ol class="lg-posts">${c.rows.map(rowHtml).join('')}</ol>`
      : (c.hidden ? '' : `<div class="oc-note">${esc(c.sign.text)}</div>`);
    return `<div class="oc-head"><span class="oc-chip">${esc(c.title)}</span><button type="button" class="oc-x" aria-label="${esc(msg('dw.close'))}" title="${esc(msg('dw.close'))}">${icon('close')}</button></div>` +
      `<h3 class="oc-title">${esc(c.title)}</h3>` +
      (c.hidden ? '' : `<div class="oc-world"><i class="oc-sw" style="background:${tone}"></i><span>${esc(c.sign.text)}</span></div>`) +
      (c.sign.hint && !c.hidden ? `<div class="oc-note">${esc(c.sign.hint)}</div>` : '') +
      (c.namesOnly ? `<div class="oc-note">${esc(msg('lounge.names'))}</div>` : '') +
      people + channels + posts +
      `<div class="oc-note lg-src">${esc(c.source)}</div>`;
  }
  const keyOf = v => JSON.stringify([v.card.rows.map(r => [r.seq, r.age, r.text.length, r.who]), v.card.people, v.card.sign.text, v.card.sign.hint, v.card.source, v.card.namesOnly, v.card.hidden, v.card.channels.map(c => c.n)]);

  function render(v, force = false) {
    const key = keyOf(v);
    if (!force && key === lastKey) return;
    lastKey = key;
    const sc = el.querySelector('.oc-scroll'), keep = sc ? sc.scrollTop : 0;
    const hadFocus = el.contains(document.activeElement) && document.activeElement !== el, focusClass = hadFocus ? String(document.activeElement.className || '').split(/\s+/)[0] : '';
    el.innerHTML = `<div class="oc-scroll">${body(v)}</div>`;
    el.setAttribute('aria-label', v.card.title);
    const next = el.querySelector('.oc-scroll');
    if (next) next.scrollTop = keep;
    el.querySelector('.oc-x').addEventListener('click', () => close());
    if (focusClass) { const same = el.querySelector('.' + focusClass); if (same) same.focus({ preventScroll: true }); }
  }

  function place() {
    if (!open || el.hidden) return;
    const an = anchor(), b = bounds();
    const inView = an && b && an.x + an.w > b.x0 && an.x < b.x1 && an.y + an.h > b.y0 && an.y < b.y1;
    el.classList.toggle('away', !inView);                                // the wall is panned out of the view: the card waits for it
    if (!inView) return;
    const p = placeCard({ anchor: an, card: { w: el.offsetWidth, h: el.offsetHeight }, bounds: b, prefer: 'right' });
    if (p.x !== placeAt.x || p.y !== placeAt.y || p.side !== placeAt.side) {
      placeAt = { x: p.x, y: p.y, side: p.side };
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.dataset.side = p.side;
    }
    el.style.setProperty('--tail', p.tail ? p.tail.at + 'px' : '0px');
    el.dataset.tail = p.tail ? p.tail.side : 'none';
  }

  function openCard(v, from = null) {
    const fresh = el.hidden || el.dataset.motion === 'out';
    view = v;
    open = true;
    if (from) opener = from;
    onOpen();
    el.hidden = false;
    if (fresh) placeAt = { x: NaN, y: NaN, side: '' };
    render(v, true);
    place();
    if (fresh) enter(el, { from: comesFrom(el.dataset.side) });          // it comes out of the wall: nothing on the map moves
    el.focus({ preventScroll: true });
    return true;
  }
  function close() {
    if (!open) return false;
    open = false; lastKey = '';
    const side = el.dataset.side, hadFocus = el.contains(document.activeElement), back = opener;
    opener = null;
    leave(el, { to: comesFrom(side) }).then(() => { if (!open) el.innerHTML = ''; });
    if (hadFocus && back && back.isConnected) back.focus({ preventScroll: true });
    onClose();
    return true;
  }
  function update(v) { view = v; if (open) { render(v); place(); } }

  const onKey = e => {
    if (e.key !== 'Escape' || !open) return;
    close();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  return {
    open: openCard, close, update, place,
    get isOpen() { return open; },
    get el() { return el; },
    // QA: what the card shows (read-only)
    read() {
      if (!open || el.hidden) return { open: false };
      const r = el.getBoundingClientRect(), sc = el.querySelector('.oc-scroll');
      return {
        open: true, away: el.classList.contains('away'), side: el.dataset.side || '', rect: { x: r.left, y: r.top, w: r.width, h: r.height }, title: (el.querySelector('.oc-title') || {}).textContent || '',
        posts: [...el.querySelectorAll('.lg-post')].map(li => ({ chip: (li.querySelector('.lg-chip') || {}).textContent || '', who: (li.querySelector('.lg-who') || {}).textContent || '', age: (li.querySelector('.lg-age') || {}).textContent || '', text: (li.querySelector('.lg-text') || {}).textContent || '' })),
        people: [...el.querySelectorAll('.lg-person')].map(x => x.textContent), source: (el.querySelector('.lg-src') || {}).textContent || '', note: [...el.querySelectorAll('.oc-note')].map(x => x.textContent),
        scroll: sc ? { top: sc.scrollTop, height: sc.scrollHeight, client: sc.clientHeight, overflowY: getComputedStyle(sc).overflowY } : null,
        focusInside: el.contains(document.activeElement), hasClose: !!el.querySelector('.oc-x'),
      };
    },
    destroy() { close(); el.remove(); document.removeEventListener('keydown', onKey, true); },
  };
}
