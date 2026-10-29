// The language list: a modal dialog with one button per language, each written in its own language, under a heading that is repeated in every
// language so a visitor finds their own. It opens in two cases:
//   - on the first visit, when the system language is not supported: nothing closes it except choosing a language (`dismissable: false`);
//   - from the language button in the header: Esc, a click outside or the Close button dismiss it (`dismissable: true`).
// No imports: the caller passes the languages, the current one and the label for Close, so this file does not depend on the dictionaries.

export function openLanguagePicker({ languages, current = null, dismissable = true, closeLabel = 'Close', onPick, opener = null }) {
  if (document.getElementById('lang-dlg')) return null;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  const title = el('h2', { id: 'lang-dlg-title' }, ...languages.map(l => el('span', { lang: l.code, textContent: l.chooseTitle })));
  const list = el('ul', { className: 'lang-list' }, ...languages.map(l => el('li', {}, el('button', {
    type: 'button', lang: l.code, textContent: l.name, className: 'lang-opt',
    onclick: () => { picked = true; onPick(l.code); dlg.close(); },
  }))));
  list.querySelectorAll('button').forEach((b, i) => { if (languages[i].code === current) b.setAttribute('aria-current', 'true'); });
  const close = dismissable ? el('button', { type: 'button', className: 'lang-close', textContent: closeLabel, onclick: () => dlg.close() }) : null;
  const dlg = el('dialog', { id: 'lang-dlg', className: 'lang-dlg' }, el('div', { className: 'lang-box' }, title, list, ...(close ? [close] : [])));
  dlg.setAttribute('aria-labelledby', 'lang-dlg-title');
  let picked = false;

  if (dismissable) dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });      // the backdrop: the box is the dialog's only child
  else dlg.addEventListener('cancel', e => e.preventDefault());                                       // Esc does nothing until a language is chosen
  dlg.addEventListener('close', () => {
    if (!dismissable && !picked) { dlg.showModal(); return; }                                         // some browsers close on a second Esc: open it again
    dlg.remove();
    if (opener && opener.isConnected) opener.focus();
  });

  document.body.append(dlg);
  dlg.showModal();
  (list.querySelector('[aria-current]') || list.querySelector('button')).focus();
  return dlg;
}
