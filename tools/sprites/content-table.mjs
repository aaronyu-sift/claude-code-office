// Prints plan section 5 minimums against the committed manifest: node tools/sprites/content-table.mjs  (exit 1 if a row is not met)
import { readFileSync } from 'node:fs';
import { countRows } from './content-minimums.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../public/pixel/manifest.json', import.meta.url), 'utf8'));
const rows = countRows(manifest);
const w = Math.max(...rows.map(r => r.row.length));
console.log(`${'row'.padEnd(w)}  minimum  actual  met`);
for (const r of rows) console.log(`${r.row.padEnd(w)}  ${String(r.min).padStart(7)}  ${String(r.actual).padStart(6)}  ${r.met ? 'yes' : 'NO'}`);
const total = Object.keys(manifest.sprites).length;
console.log(`all rows met: ${rows.every(r => r.met)}; manifest sprites: ${total}`);
process.exit(rows.every(r => r.met) ? 0 : 1);
