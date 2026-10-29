// The ways to open a chat from the Office, as pure functions (no DOM, no clock), so every link and command can be tested.
//   vscode    the Claude Code extension's own link: opens the chat in a VS Code tab
//   desktop   the Claude desktop app's resume link (found in the installed app; not every release has it)
//   terminal  the Claude Code command line: a terminal opens in the chat's folder with `/resume <id>` typed in (typed, not sent)
// And two copies: the shell command and the session id. The visitor's last choice of the three links is kept, so the main button remembers it.

export const CHOICES = ['vscode', 'desktop', 'terminal'];
export const CHOICE_KEY = 'ajan-ofisi.open';
export const DEFAULT_CHOICE = 'vscode';

const SAFE_ID = /^[\w-]+$/;                     // a session id is a UUID: nothing else is ever put into a link or a command
export const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The id of the chat to open for an agent: a subagent has no chat of its own, its parent has.
export function sessionOf(a) {
  if (!a) return '';
  const id = a.kind === 'sub' ? a.parent : a.id;
  return SAFE_ID.test(id || '') ? id : '';
}

// link for a kind, or null when it cannot be made ('terminal' needs the chat's folder)
export function openUrl(kind, { id, cwd = '' }) {
  if (!SAFE_ID.test(id || '')) return null;
  if (kind === 'vscode') return `vscode://anthropic.claude-code/open?session=${encodeURIComponent(id)}`;
  if (kind === 'desktop') return `claude://resume?session=${encodeURIComponent(id)}`;
  if (kind === 'terminal') return cwd && cwd.startsWith('/') ? `claude-cli://open?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent('/resume ' + id)}` : null;
  return null;
}

// the same chat on the command line, for a terminal of the visitor's own choosing
export function cliCommand({ id, cwd = '' }) {
  if (!SAFE_ID.test(id || '')) return '';
  return `${cwd ? `cd ${shq(cwd)} && ` : ''}claude --resume ${id}`;
}

export const validChoice = v => (CHOICES.includes(v) ? v : null);
export function loadChoice(storage) {
  try { return validChoice(storage && storage.getItem(CHOICE_KEY)) || DEFAULT_CHOICE; } catch { return DEFAULT_CHOICE; }
}
export function saveChoice(storage, kind) {
  if (!validChoice(kind)) return false;
  try { if (storage) storage.setItem(CHOICE_KEY, kind); } catch { /* storage disabled */ }
  return true;
}
// the choice in force for a chat: the remembered one, or VS Code when that cannot be made (the terminal link needs a folder)
export const effectiveChoice = (choice, target) => (openUrl(choice, target) ? choice : DEFAULT_CHOICE);
