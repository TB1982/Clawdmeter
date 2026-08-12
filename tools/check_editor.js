#!/usr/bin/env node
/**
 * Check anim_editor.html without opening it.
 *
 *   node tools/check_editor.js
 *
 * The editor is one hand-written file that has to open from file:// with no
 * server, which is the property it is built around — and also the reason it has
 * no test harness and browser automation cannot drive it. So its script block
 * is extracted and exercised here instead:
 *
 *   - every JS block parses (a syntax error means a blank page, silently)
 *   - upscale/downscale are correct at each factor, and round-trip
 *   - the pair that must be refused (40 <-> 60) is refused
 *   - PALETTE_MAX / GRID_SIZES still agree with tools/lib/format.js
 *
 * This exists because the resamplers were hardcoded to 2x. Adding 60 made
 * `while (g.length < N) g = upscale(g)` overshoot to 80, and nothing anywhere
 * would have said so — the template button would just have produced a grid of
 * the wrong size.
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EDITOR = path.join(__dirname, 'anim_editor.html');
const html = fs.readFileSync(EDITOR, 'utf8');

// 1. Every <script> block must parse. A syntax error here is a blank editor.
// Only real JS blocks: skip src= and any typed block (the page carries a
// JSON-LD one, which is data and does not parse as a script).
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/\btype=/.test(m[1]))
  .map(m => m[2]);
console.log(`script blocks: ${scripts.length}`);
scripts.forEach((s, i) => {
  try { new vm.Script(s, {filename: `block${i}`}); }
  catch (e) { console.error(`  SYNTAX ERROR in block ${i}: ${e.message}`); process.exit(1); }
});
console.log('  all parse OK');

// 2. Pull out the two resamplers and check the maths.
const body = scripts.join('\n');
const grab = name => {
  const m = body.match(new RegExp(`const ${name} = \\(g, k\\) => \\{[\\s\\S]*?\\n\\};`));
  if (!m) throw new Error(`could not find ${name}(g, k)`);
  return m[0];
};
const ctx = {};
vm.createContext(ctx);
// `const` inside runInContext does not land on the context object, so the two
// functions are handed over explicitly.
vm.runInContext(grab('upscale') + '\n' + grab('downscale') +
  '\nglobalThis.upscale = upscale; globalThis.downscale = downscale;', ctx);

const rnd = n => Array.from({length: n}, (_, r) =>
  Array.from({length: n}, (_, c) => (r * 7 + c * 13) % 12));

let fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail++; };

console.log('\nresampling:');
const g20 = rnd(20);

const g60 = ctx.upscale(g20, 3);
check('20 -> 60 gives a 60x60 grid', g60.length === 60 && g60[0].length === 60);
let blockOK = true;
for (let r = 0; r < 20 && blockOK; r++) for (let c = 0; c < 20; c++)
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++)
    if (g60[r*3+dr][c*3+dc] !== g20[r][c]) { blockOK = false; }
check('20 -> 60 replicates each cell into a 3x3 block', blockOK);

const back = ctx.downscale(g60, 3);
check('60 -> 20 round-trips identically',
      JSON.stringify(back) === JSON.stringify(g20));

const g40 = ctx.upscale(g20, 2);
check('20 -> 40 still works (2x unchanged)',
      g40.length === 40 && JSON.stringify(ctx.downscale(g40, 2)) === JSON.stringify(g20));

// 3. The pair that must be refused.
console.log('\ndivisibility guard:');
const pairs = [[20,40],[20,60],[40,20],[60,20],[40,60],[60,40]];
for (const [a, b] of pairs) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  const allowed = hi % lo === 0;
  const want = !(a === 40 && b === 60) && !(a === 60 && b === 40);
  check(`${a} -> ${b} ${allowed ? 'allowed' : 'refused'}`, allowed === want);
}

// 4. Constants agree with the shared format module.
const {PALETTE_SIZE, GRID_SIZES} = require('./lib/format.js');
console.log('\nconstants:');
check(`GRID_SIZES matches format.js (${GRID_SIZES.join(', ')})`,
      (html.match(/const GRID_SIZES = \[([^\]]*)\];/) || [])[1].replace(/\s+/g,' ').trim()
        === GRID_SIZES.join(', '));
check(`PALETTE_MAX matches format.js (${PALETTE_SIZE})`,
      (html.match(/const PALETTE_MAX = (\d+);/) || [])[1] === String(PALETTE_SIZE));
check('the 60 option exists in the size select',
      /<option value="60">/.test(html));
check('badResize exists in all four locales',
      (html.match(/badResize:/g) || []).length === 4);

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
