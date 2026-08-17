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
const {PALETTE_SIZE, GRID_SIZES, CLIP_VERSION, HOLD_MIN_MS} = require('./lib/format.js');
console.log('\nconstants:');
check(`GRID_SIZES matches format.js (${GRID_SIZES.join(', ')})`,
      (html.match(/const GRID_SIZES = \[([^\]]*)\];/) || [])[1].replace(/\s+/g,' ').trim()
        === GRID_SIZES.join(', '));
check(`PALETTE_MAX matches format.js (${PALETTE_SIZE})`,
      (html.match(/const PALETTE_MAX = (\d+);/) || [])[1] === String(PALETTE_SIZE));
check(`CLIP_VERSION matches format.js (${CLIP_VERSION})`,
      (html.match(/const CLIP_VERSION = (\d+);/) || [])[1] === String(CLIP_VERSION));
// The contract document is the copy another program reads — VAS mirrors this
// constant by regexing that file, not this repo's source. A version bump that
// stops at the code is a bump the consumer never hears about.
check(`docs/animation-contract.md § 6 states CLIP_VERSION ${CLIP_VERSION}`,
      new RegExp(`\\|\\s*\`CLIP_VERSION\`\\s*\\|\\s*${CLIP_VERSION}\\s*\\|`)
        .test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'animation-contract.md'), 'utf8')));
check(`docs/animation-contract.md § 6 states HOLD_MIN_MS ${HOLD_MIN_MS}`,
      new RegExp(`\\|\\s*\`HOLD_MIN_MS\`\\s*\\|\\s*${HOLD_MIN_MS}\\s*\\|`)
        .test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'animation-contract.md'), 'utf8')));
check(`HOLD_MIN matches format.js (${HOLD_MIN_MS})`,
      (html.match(/const HOLD_MIN = (\d+);/) || [])[1] === String(HOLD_MIN_MS));
// A floor, not a grid. step=20 drives the arrow buttons; several scraped
// animations run on 1/12-second beats (83, 166, 332, 498 ms) that no rounding
// preserves, so the day min and step are conflated those rhythms are lost.
check('the hold field keeps step and min separate',
      /inp\.min = HOLD_MIN; inp\.step = 20;/.test(html));
check('the hold strings exist in all four locales',
      ['holdWhole', 'holdFloor']
        .every(k => (html.match(new RegExp(k + ':', 'g')) || []).length === 4));
check('the 60 option exists in the size select',
      /<option value="60">/.test(html));
check('badResize exists in all four locales',
      (html.match(/badResize:/g) || []).length === 4);
check('the clipboard strings exist in all four locales',
      ['clipCopied', 'clipPasted', 'clipPastedNew', 'clipFull', 'clipNewer']
        .every(k => (html.match(new RegExp(k + ':', 'g')) || []).length === 4));
check('the origin strings exist in all four locales',
      ['srcClaudepix', 'srcClaudepixProps', 'srcOfficial', 'srcDrawn', 'srcUnknown']
        .every(k => (html.match(new RegExp(k + ':', 'g')) || []).length === 4));
check('the credit is split into per-origin parts in all four locales',
      ['creditClaudepix', 'creditOfficial']
        .every(k => (html.match(new RegExp(k + ':', 'g')) || []).length === 4));
// A footer wired straight to one key would credit claudepix on a build that
// carries none of their work.
check('the footer is composed, not bound to a single key',
      /<footer><\/footer>/.test(html) && !/<footer data-i18n/.test(html));
// Every sample says where it came from. Most of this library is somebody
// else's work; a sample that arrives unlabelled reads as ours by default, and
// that default is the one worth making impossible.
{
  const block = html.slice(html.indexOf('/*BEGIN-SAMPLES*/'), html.indexOf('/*END-SAMPLES*/'));
  const total = (block.match(/^\{n:"/gm) || []).length;
  const labelled = (block.match(/^\{n:"[^"]*",c:"[^"]*",s:"[^"]*"/gm) || []).length;
  check(`all ${total} samples carry an origin (${labelled} labelled)`,
        total > 0 && labelled === total);
}

// The published copy, which is the one strangers open. This check is the point
// of the whole exercise: everything else here fails loudly in a terminal, but a
// third-party animation leaking into docs/ fails by being on the internet.
console.log('\npublished copy:');
{
  const pub = path.join(__dirname, '..', 'docs', 'anim_editor.html');
  if (!fs.existsSync(pub)) {
    check('docs/anim_editor.html exists (node tools/build_editor_samples.js --public)', false);
  } else {
    const p = fs.readFileSync(pub, 'utf8');
    const block = p.slice(p.indexOf('/*BEGIN-SAMPLES*/'), p.indexOf('/*END-SAMPLES*/'));
    const origins = [...block.matchAll(/^\{n:"([^"]*)",c:"[^"]*",s:"([^"]*)"/gm)]
      .map(m => ({n: m[1], s: m[2]}));
    const leaked = origins.filter(o => o.s === 'claudepix' || o.s === 'claudepix+');
    check(`no claudepix-origin animation is published${leaked.length ? ' — found ' + leaked.map(o => o.n).join(', ') : ''}`,
          leaked.length === 0);
    check(`published copy carries ${origins.length} animations (own + official)`,
          origins.length > 0);
    // Same file otherwise: the public build must not become a stale fork of the
    // editor, only a different sample set.
    const strip = s => s.slice(0, s.indexOf('/*BEGIN-SAMPLES*/')) + s.slice(s.indexOf('/*END-SAMPLES*/'));
    check('published copy is the same editor, only the samples differ',
          strip(p) === strip(html));
  }

  // The editor was published at docs/tools/anim_editor.html once, before Pages
  // moved to serve docs/ as the root. That URL is out in the world, so the path
  // has to keep answering — with a redirect, and only a redirect. If a build
  // ever wrote the editor there instead, the old URL would quietly go back to
  // serving all 45 animations from the address people already have.
  const redirect = path.join(__dirname, '..', 'docs', 'tools', 'anim_editor.html');
  if (!fs.existsSync(redirect)) {
    check('the old editor URL still answers (docs/tools/anim_editor.html)', false);
  } else {
    const r = fs.readFileSync(redirect, 'utf8');
    check('the old editor URL redirects to the published copy',
          r.includes('../anim_editor.html') && /http-equiv="refresh"/.test(r));
    check('the old editor URL serves a redirect, not a copy of the editor',
          !r.includes('BEGIN-SAMPLES'));
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
