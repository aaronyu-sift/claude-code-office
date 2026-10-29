// The Open button of a chat: the main button opens the chat where the visitor last chose to (VS Code first), the arrow lists the other ways
// (Claude desktop, Terminal, copy the command line, copy the session id). Used by the card next to an agent and by the details card at the side,
// so both offer the same thing. The links and commands come from openers.js; this file is the markup and the clicks.
import { t as msg } from '../i18n.js';
import { esc, icon } from '../util.js';
import { openUrl, cliCommand, sessionOf, loadChoice, saveChoice, effectiveChoice } from './openers.js';

const CARET = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M4 6l4 4 4-4"/></svg>';
const KIND_LABEL = { vscode: 'dw.openVscode', desktop: 'card.openDesktop', terminal: 'card.openTerminal' };
const KIND_TIP = { vscode: 'dw.openVscodeTip', desktop: 'card.openDesktopTip', terminal: 'card.openTerminalTip' };

// options: ctx (store, copyText), storage, rerender() (called after a choice or a copy, so the host redraws its markup)
export function createOpenMenu({ ctx, storage = null, rerender = () => {} }) {
  const { store } = ctx;
  let open = false, copied = { what: '', at: 0 }, host = null;

  const set = on => {
    open = on;
    if (!host) return;
    const m = host.querySelector('.oc-menu'), c = host.querySelector('.oc-caret');
    if (m) m.hidden = !on;
    if (c) c.setAttribute('aria-expanded', String(on));
  };
  document.addEventListener('pointerdown', e => { if (open && !(e.target.closest && e.target.closest('.oc-open'))) set(false); }, true);

  // the markup, or '' for a chat that cannot be opened (no id)
  function html(a, closed) {
    const parent = a.kind === 'sub' ? store.agents.get(a.parent) : null;
    const target = { id: sessionOf(a), cwd: a.cwd || (parent && parent.cwd) || '' };
    if (!target.id) return '';
    const kind = effectiveChoice(loadChoice(storage), target), cmd = cliCommand(target);
    const label = k => msg(KIND_LABEL[k]);
    const link = k => {
      const url = openUrl(k, target);
      return url
        ? `<li role="none"><a role="menuitem" class="oc-item" data-kind="${k}" href="${esc(url)}" title="${esc(msg(KIND_TIP[k]))}">${icon('external')}<span>${esc(label(k))}</span></a></li>`
        : `<li role="none"><span role="menuitem" class="oc-item off" aria-disabled="true" title="${esc(msg('card.noCwd'))}">${icon('external')}<span>${esc(label(k))}</span></span></li>`;
    };
    const copy = (what, text, name) => {
      const done = copied.what === what && Date.now() - copied.at < 1600;
      return `<li role="none"><button type="button" role="menuitem" class="oc-item" data-copy="${what}" data-text="${esc(text)}">${icon(done ? 'check' : 'copy')}<span>${esc(msg(done ? 'dw.copied' : name))}</span></button></li>`;
    };
    const verb = a.kind === 'sub' ? msg('card.openParent') : label(kind);
    return `<div class="oc-open">` +
      `<a class="oc-go" data-kind="${kind}" href="${esc(openUrl(kind, target))}" title="${esc(msg(KIND_TIP[kind]))}">${icon('external')}<span>${esc(verb)}</span></a>` +
      `<button type="button" class="oc-caret" aria-haspopup="menu" aria-expanded="${open}" aria-label="${esc(msg('card.openMenu'))}" title="${esc(msg('card.openMenu'))}">${CARET}</button>` +
      `<ul class="oc-menu" role="menu" ${open ? '' : 'hidden'}>${link('vscode')}${link('desktop')}${link('terminal')}<li class="oc-sep" role="separator"></li>` +
      `${cmd ? copy('cmd', cmd, 'card.copyCmd') : ''}${copy('id', target.id, 'dw.copyId')}` +
      (!closed ? `<li class="oc-hint" role="none">${esc(msg('card.liveHint'))}</li>` : '') + `</ul></div>`;
  }

  // the clicks, for the markup that html() put somewhere inside `container`
  function wire(container) {
    host = container.querySelector('.oc-open');
    if (!host) return;
    const caret = host.querySelector('.oc-caret');
    caret.addEventListener('click', () => { set(!open); if (open) { const first = host.querySelector('.oc-menu .oc-item:not(.off)'); if (first) first.focus({ preventScroll: true }); } });
    host.querySelectorAll('a[data-kind]').forEach(a => a.addEventListener('click', () => { saveChoice(storage, a.dataset.kind); set(false); setTimeout(rerender, 0); }));
    host.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const ok = await ctx.copyText(b.dataset.text), span = b.querySelector('span');
      if (!ok) { span.textContent = msg('dw.copyFail'); return; }
      copied = { what: b.dataset.copy, at: Date.now() };
      b.querySelector('svg').outerHTML = icon('check');
      span.textContent = msg('dw.copied');
      container.dataset.copied = b.dataset.text;                          // (read by the QA)
      setTimeout(() => { set(false); rerender(); }, 1200);
    }));
  }

  return {
    html, wire,
    get isOpen() { return open; },
    close() { set(false); },
    // Esc on the host: close the menu first; true when it was open (the key is used up)
    escape() { if (!open) return false; set(false); const c = host && host.querySelector('.oc-caret'); if (c) c.focus({ preventScroll: true }); return true; },
    reset() { open = false; copied = { what: '', at: 0 }; },
  };
}
