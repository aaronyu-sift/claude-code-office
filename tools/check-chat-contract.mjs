#!/usr/bin/env node
// Checks an agent chat database against the contract the Office reads (CONTRACT in chat-source.js, docs/chat-source.md).
//
//   node tools/check-chat-contract.mjs <chat.db> [--json]
//
// Prints "OK ..." and exits 0 when the Office can read the database, or lists what is missing and exits 1. Exit 2: no argument, or no such file.
// It opens the file read-only (the same way the Office does) and keeps nothing open; run it on a copy of a new version of the chat before
// the version goes live, or on the live file any time.
import { checkDatabase, CONTRACT } from '../chat-source.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find(a => !a.startsWith('--'));
if (!file || args.includes('--help')) {
  console.error('usage: node tools/check-chat-contract.mjs <chat.db> [--json]');
  console.error('contract: ' + Object.entries(CONTRACT).map(([t, c]) => `${t}(${c.join(' ')})`).join(' '));
  process.exit(2);
}
const r = checkDatabase(file);
if (json) {
  console.log(JSON.stringify(r));
} else if (r.state === 'ok') {
  console.log(`OK  schema ${r.schema == null ? 'unknown' : r.schema}  ${file}`);
  console.log('    contract: ' + Object.entries(CONTRACT).map(([t, c]) => `${t}(${c.join(' ')})`).join(' '));
} else if (r.state === 'off') {
  console.log(`NOT FOUND  ${r.reason}`);
} else {
  console.log(`UNSUPPORTED  ${file}${r.schema == null ? '' : '  (schema ' + r.schema + ')'}`);
  for (const p of (r.problems.length ? r.problems : [r.reason])) console.log('  - ' + p);
  console.log('    the Office needs: ' + Object.entries(CONTRACT).map(([t, c]) => `${t}(${c.join(' ')})`).join(' '));
}
process.exit(r.state === 'ok' ? 0 : r.state === 'off' ? 2 : 1);
