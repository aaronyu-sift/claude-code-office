// The card of the Office view: what a click on an agent in the scene, or on a row of the shelf, shows. It floats next to what was clicked, as the
// cards of the Atlas page do (a glass panel, a hairline border, mono chips): no sliding drawer and no dimming of the scene. It follows the agent when
// the view is panned or zoomed, updates while the chat runs, and closes with its cross, Esc or a click on the empty scene.
// The main button opens the chat where the visitor last chose to (VS Code first); the arrow beside it lists the other ways (openers.js).
import { t as msg } from '../i18n.js';
import { esc, fmtShort, fmtClock, catColor, CATS, icon } from '../util.js';
import { createOpenMenu } from './open-menu.js';
import { placeCard } from './cardplace.js';
import { enter, leave, comesFrom, SPRING } from '../motion.js';
import { progressBarEl } from '../progress-bar.js';

const SUB_MAX = 6;
// the clock texts inside a card are kept by the page's ticker; a re-render for them alone would only close the menu and move the scroll
const unticked = html => html.replace(/(<[^>]*data-since="[^"]*"[^>]*>)[^<]*/g, '$1');
// the progress of the chat's task list, when the tracker has written one for it (progress.js): the bar made as an element, put in as a string
const progressRow = (a, t) => { const bar = a.progress && progressBarEl(a.progress, { now: t }); return bar ? bar.outerHTML : ''; };

// options: root (the Office view, the card's offset parent), ctx (store, statusPill, activityHtml, closedAgent, copyText, openDetails, tip),
// storage, anchorOf(id, rowEl) -> { x, y, w, h, kind: 'scene' | 'shelf', prefer } in root coordinates or null when the anchor is not on screen,
// boundsOf(kind) -> { x0, y0, x1, y1 } in root coordinates, onSelect(id | null) (the scene marks the chosen agent)
export function createAgentCard({ root, ctx, storage = null, anchorOf, boundsOf, onSelect = () => {} }) {
  const { store } = ctx;
  const el = Object.assign(document.createElement('aside'), { className: 'of-card', hidden: true, tabIndex: -1 });
  el.setAttribute('role', 'dialog');
  root.append(el);
  let cur = null;                                     // { id, row }
  let lastHtml = '', placeAt = { x: NaN, y: NaN, side: '' };
  const menu = createOpenMenu({ ctx, storage, rerender: () => { lastHtml = ''; if (cur) render(); } });

  const resolve = id => {
    const a = store.agents.get(id);
    if (a) return { a, closed: false };
    const c = store.closedById && store.closedById.get(id);
    return c ? { a: ctx.closedAgent(c), closed: true } : null;
  };

  function body(a, closed, t) {
    const sub = a.kind === 'sub', parent = sub ? store.agents.get(a.parent) : null;
    const subs = a.kind === 'main' && !closed ? store.subsOf(a.id) : [];
    const project = sub ? (parent ? parent.project : a.project) : a.project;
    const title = sub ? '↳ ' + (a.atype || msg('agent.sub')) : (a.name || a.title || project);
    const task = sub ? (a.desc || '') : (a.title && a.title !== a.name ? a.title : '');
    const cwd = a.cwd || (parent && parent.cwd) || '';
    const tools = Object.entries(a.tools || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
    const cats = Object.entries(a.cats || {}).sort((x, y) => y[1] - x[1]);
    const facts = [];
    if (a.model) facts.push([msg('card.model'), esc(a.model + (a.effort ? ' · ' + a.effort : ''))]);
    if (closed) facts.push([msg('card.closedAt'), esc(msg('card.ago', { clock: fmtClock(a.since), ago: fmtShort(Math.max(0, t - a.since)) }))]);
    else if (a.started) facts.push([msg('card.started'), esc(msg('card.ago', { clock: fmtClock(a.started), ago: fmtShort(t - a.started) }))]);
    if (cwd) facts.push([msg('card.folder'), `<span class="oc-path" title="${esc(cwd)}">${esc(cwd)}</span>`]);
    const quote = (label, text, cls) => (text ? `<div class="oc-sec"><div class="oc-sub">${esc(label)}</div><div class="oc-quote ${cls}">${esc(text)}</div></div>` : '');
    return `<div class="oc-head"><span class="oc-chip">${ctx.statusPill(a, t)}</span>` +
        `<button type="button" class="oc-x" aria-label="${esc(msg('dw.close'))}" title="${esc(msg('dw.close'))}">${icon('close')}</button></div>` +
      `<h3 class="oc-title">${esc(title)}</h3>` +
      `<div class="oc-world"><i class="oc-sw" style="background:${esc(a.color)}"></i><span>${esc(project)}${task ? ' · ' + esc(task) : ''}</span></div>` +
      progressRow(a, t) +
      (closed ? `<div class="oc-note">${esc(msg('dw.closedNote'))}</div>` : `<div class="oc-act">${ctx.activityHtml(a, t)}</div>`) +
      (facts.length ? `<dl class="oc-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '') +
      quote(msg(sub ? 'dw.task' : 'dw.lastPrompt'), a.lastPrompt, 'p') +
      quote(msg('dw.lastReply'), a.lastText || (closed ? a.summary : ''), 'r') +
      (cats.length ? `<div class="oc-sec"><div class="oc-sub">${esc(msg('dw.tools'))}</div>` +
        `<div class="oc-mix">${cats.map(([c, n]) => `<i style="flex:${n};background:${catColor(c)}" title="${esc((CATS[c] || CATS.other).name)} · ${n}"></i>`).join('')}</div>` +
        (tools.length ? `<div class="oc-tools">${tools.map(([n, k]) => `<span>${esc(n)} <b>${k}</b></span>`).join('')}</div>` : '') + '</div>' : '') +
      (subs.length ? `<div class="oc-sec"><div class="oc-sub">${esc(msg('dw.subsH'))} <span>${esc(msg('dw.subsSub', { w: a.subsWorking || 0, n: subs.length }))}</span></div><div class="oc-subs">` +
        subs.slice(0, SUB_MAX).map(s => `<button type="button" class="oc-subchip ${esc(s.status)}" data-sub="${esc(s.id)}" title="${esc(s.desc || s.atype || '')}"><i></i>${esc(s.desc || s.atype || msg('agent.sub'))}</button>`).join('') +
        (subs.length > SUB_MAX ? `<span class="oc-more-n">+${subs.length - SUB_MAX}</span>` : '') + '</div></div>' : '');
  }

  function actions(a, closed) {
    return `<div class="oc-actions">${menu.html(a, closed)}<button type="button" class="oc-more" title="${esc(msg('card.moreTip'))}">${esc(msg('card.more'))}</button></div>`;
  }

  function render(force = false) {
    const r = cur && resolve(cur.id);
    if (!r) return false;
    const t = store.now();
    const next = `<div class="oc-scroll">${body(r.a, r.closed, t)}</div>${actions(r.a, r.closed)}`;
    if (!force && unticked(next) === lastHtml) return true;
    const keep = el.querySelector('.oc-scroll') ? el.querySelector('.oc-scroll').scrollTop : 0, hadFocus = el.contains(document.activeElement) && document.activeElement !== el;
    const focusKey = hadFocus ? (document.activeElement.className || '') : '';
    lastHtml = unticked(next);
    el.innerHTML = next;
    el.setAttribute('aria-label', r.a.name || r.a.title || r.a.project || '');
    el.dataset.id = cur.id; el.dataset.state = r.closed ? 'closed' : r.a.status;
    const sc = el.querySelector('.oc-scroll');
    if (sc) sc.scrollTop = keep;
    if (focusKey) { const same = el.querySelector('.' + String(focusKey).split(/\s+/)[0]); if (same) same.focus({ preventScroll: true }); }
    wire();
    return true;
  }

  function wire() {
    el.querySelector('.oc-x').addEventListener('click', () => close());
    el.querySelector('.oc-more').addEventListener('click', () => { const id = cur && cur.id; if (id) { ctx.tip.hide(); ctx.openDetails(id); close(); } });
    el.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => open(b.dataset.sub)));
    menu.wire(el);
  }

  function place() {
    if (!cur || el.hidden) return;
    const an = anchorOf(cur.id, cur.row), b = an && boundsOf(an.kind);
    const inView = an && b && an.x + an.w > b.x0 && an.x < b.x1 && an.y + an.h > b.y0 && an.y < b.y1;
    el.classList.toggle('away', !inView);                                // the agent is panned out of the view: the card waits for it
    if (!inView) return;
    const p = placeCard({ anchor: an, card: { w: el.offsetWidth, h: el.offsetHeight }, bounds: b, prefer: an.prefer || 'right' });
    if (p.x !== placeAt.x || p.y !== placeAt.y || p.side !== placeAt.side) {
      placeAt = { x: p.x, y: p.y, side: p.side };
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.dataset.side = p.side;
    }
    el.style.setProperty('--tail', p.tail ? p.tail.at + 'px' : '0px');
    el.dataset.tail = p.tail ? p.tail.side : 'none';
  }

  // moving to another agent: the card glides there (a transition on its position, only for this move; a pan or zoom moves it at once)
  let glideTimer = 0;
  function glide() {
    el.classList.add('glide');
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => el.classList.remove('glide'), SPRING.glide.ms + 60);
  }
  function open(id, row = null) {
    if (!resolve(id)) return false;
    const same = cur && cur.id === id;
    const fresh = el.hidden || el.dataset.motion === 'out';              // not on screen, or on its way out: it comes in (motion rules: docs/motion.md)
    cur = { id, row: row || (cur && same ? cur.row : null) || null };
    if (!same) { menu.reset(); placeAt = { x: NaN, y: NaN, side: '' }; }
    el.hidden = false;
    if (!fresh && !same) glide();
    render(true);
    place();
    if (fresh) enter(el, { from: comesFrom(el.dataset.side) });         // it comes out of its agent: nothing on the map moves
    onSelect(id);
    if (!same) el.focus({ preventScroll: true });
    return true;
  }
  function close() {
    if (!cur) return false;
    const row = cur.row, hadFocus = el.contains(document.activeElement);
    const side = el.dataset.side;
    cur = null; menu.reset(); lastHtml = '';
    leave(el, { to: comesFrom(side) }).then(() => { if (!cur) el.innerHTML = ''; });
    onSelect(null);
    if (hadFocus && row && row.isConnected) row.focus({ preventScroll: true });
    return true;
  }
  // the chat is still there? (it may have closed, or its row left the shelf)
  function refresh() {
    if (!cur) return;
    if (!resolve(cur.id)) { close(); return; }
    if (menu.isOpen) return;                                             // not under a menu that is open
    if (render()) place();
  }

  const onKey = e => {
    if (e.key !== 'Escape' || !cur) return;
    if (!menu.escape()) close();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  return {
    open, close, refresh, place,
    get id() { return cur ? cur.id : null; },
    get el() { return el; },
    // QA: what the card shows (read-only)
    read() {
      if (!cur || el.hidden) return { open: false };
      const r = el.getBoundingClientRect(), main = el.querySelector('.oc-go');
      return {
        open: true, id: cur.id, away: el.classList.contains('away'), side: el.dataset.side || '', tail: el.dataset.tail || '', state: el.dataset.state || '', menuOpen: menu.isOpen,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height }, title: (el.querySelector('.oc-title') || {}).textContent || '', world: (el.querySelector('.oc-world') || {}).textContent || '',
        mainHref: main ? main.getAttribute('href') : null, mainKind: main ? main.dataset.kind : null, mainText: main ? main.textContent.trim() : '',
        items: [...el.querySelectorAll('.oc-menu .oc-item')].map(i => ({ kind: i.dataset.kind || (i.dataset.copy ? 'copy-' + i.dataset.copy : ''), href: i.getAttribute('href'), text: i.textContent.trim(), off: i.classList.contains('off'), copyText: i.dataset.text || null })),
        pill: (el.querySelector('.pill') || {}).textContent || '', pillClass: (el.querySelector('.pill') || {}).className || '', since: (el.querySelector('.pill .t') || {}).textContent || '',
        toolsList: [...el.querySelectorAll('.oc-tools span')].map(x => x.textContent.trim().replace(/\s+/g, ' ')), mix: el.querySelectorAll('.oc-mix i').length,
        facts: [...el.querySelectorAll('.oc-facts dt')].map(d => d.textContent), quotes: [...el.querySelectorAll('.oc-quote')].map(q => q.textContent),
        subs: [...el.querySelectorAll('[data-sub]')].map(b => b.dataset.sub), hint: !!el.querySelector('.oc-hint'),
        scroll: (() => { const s = el.querySelector('.oc-scroll'); return s ? { top: s.scrollTop, height: s.scrollHeight, client: s.clientHeight } : null; })(),
      };
    },
    destroy() { close(); el.remove(); document.removeEventListener('keydown', onKey, true); },
  };
}
