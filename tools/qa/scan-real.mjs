// Measures the closed-session scan on a real Claude config directory (read-only: it lists, stats and reads transcript tails, nothing is written).
//   node tools/qa/scan-real.mjs [--claude-dir ~/.claude]
// Prints a cold run (a new scanner: every file it lists is read once, within the time budget per pass) and a warm run (the same scanner again: nothing
// changed, so nothing is read). The bytes are counted twice: by the scanner (min(size, tail) per file) and by wrapping fs.readSync in this process.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2), at = args.indexOf('--claude-dir');
const claudeDir = at >= 0 ? args[at + 1] : undefined;

let sysBytes = 0, sysCalls = 0;
const readSync = fs.readSync;
fs.readSync = function (...a) { const n = readSync.apply(this, a); sysBytes += n; sysCalls++; return n; };

const { closedScanner } = require('../../server.js');
const scanner = closedScanner({ claudeDir });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kb = n => (n / 1024).toFixed(0) + ' KB';
const row = (label, s) => `${label}: ${s.ms.toFixed(1)} ms, ${s.dirs} project folders (${s.listed} listed), ${s.statted} files stat'ed, ${s.read} read, ${kb(s.bytes)} read, ${s.pending} left for the next pass`;

console.log(`claude dir: ${claudeDir || '~/.claude'} (read-only)`);
const passes = [];
let list = scanner.scan(new Set());
passes.push(scanner.stats);
for (let i = 0; i < 60 && scanner.stats.pending > 0; i++) { await sleep(1000); list = scanner.scan(new Set()); passes.push(scanner.stats); }   // the server goes on a second later, too
const cold = scanner.stats.totals, coldSys = sysBytes;
passes.forEach((s, i) => console.log(row(`  cold pass ${i + 1}`, s)));
console.log(`COLD total: ${cold.passes} pass(es), ${cold.ms.toFixed(1)} ms in the scanner, ${cold.read} transcripts read, ${kb(cold.bytes)} by the scanner, ${kb(coldSys)} by fs.readSync (${sysCalls} calls), ${list.length} closed sessions listed (window ${scanner.stats.window} days)`);

sysBytes = 0; sysCalls = 0;
const before = list.map(s => s.id + ':' + s.closedAt).join();
const again = scanner.scan(new Set());
const w = scanner.stats;
console.log(row('WARM pass', w));
console.log(`WARM reads: ${w.read} transcripts, ${w.bytes} bytes by the scanner, ${sysBytes} bytes by fs.readSync (${sysCalls} calls); same list as before: ${again.map(s => s.id + ':' + s.closedAt).join() === before}`);
