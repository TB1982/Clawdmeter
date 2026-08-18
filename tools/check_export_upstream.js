#!/usr/bin/env node
/**
 * Checks that tools/export_upstream.js loses nothing.
 *
 *   node tools/check_export_upstream.js
 *
 * It reads the header the exporter actually writes — not its internals — parses
 * the C arrays back out, undoes the crop, the scale and the palette remap, and
 * compares every cell against the source JSON. A conversion that claims to be
 * lossless is a claim about cells, so cells are what this counts.
 *
 * Parsing the emitted text rather than calling convert() directly is deliberate:
 * the artifact is what a stranger compiles, and an emitter bug that never
 * reaches the file would pass an internals test and ship anyway. The first
 * version of the exporter emitted its table entries as loose initialisers at
 * file scope — valid-looking text that no compiler accepts — and only building
 * it inside a real upstream checkout found that. This catches the other half:
 * output that compiles and is wrong.
 *
 * What it does not check is the contract with upstream — field order in
 * splash_anim_def_t, what index 0 means, where ox/oy are measured from. Nothing
 * on this side can: those live in their splash.cpp. That check is a build
 * against a real upstream tree, and it is written down in tools/README.md
 * rather than run here, because it needs PlatformIO and 40 seconds.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { originOf, THIRD_PARTY } = require('./lib/origin');

const TOOLS = __dirname;
const EXPORTER = path.join(TOOLS, 'export_upstream.js');

// ── read every animation the exporter would accept ──────────────────────────

const sources = new Map();
for (const d of ['custom_anims', 'drawn_anims', 'official_anims']) {
  const dir = path.join(TOOLS, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.startsWith('_'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j?.name && j.frames?.[0]?.grid) sources.set(j.name, j);
    } catch { /* not an animation */ }
  }
}
const eligible = [...sources.keys()]
    .filter(n => !THIRD_PARTY.has(originOf(n)) && originOf(n) !== 'official')
    .sort();

// ── parse the emitted header ────────────────────────────────────────────────

const ident = (name) => 'splash_' + name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

function nums(text, decl) {
  const i = text.indexOf(decl);
  if (i < 0) return null;
  const a = text.indexOf('{', i), b = text.indexOf('};', a);
  return text.slice(a + 1, b).split(',').map(s => s.trim()).filter(Boolean)
             .map(s => s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10));
}

function parseDef(text, name) {
  // The table lives inside the SPLASH_EXTRA_ANIM_DEFS macro, one entry per line.
  const line = text.split('\n').find(l => l.trim().startsWith(`{"${name}"`));
  if (!line) return null;
  const m = line.match(/^\s*\{"[^"]*",\s*"[^"]*",\s*([^}]*?),\s*\w+_palette/);
  const f = m[1].split(',').map(s => parseInt(s.trim(), 10));
  return { w: f[0], h: f[1], ox: f[2], oy: f[3], frameCount: f[4],
           loopStart: f[5], loopEnd: f[6], paletteCount: f[7] };
}

// ── the check ───────────────────────────────────────────────────────────────

const tmp = path.join(os.tmpdir(), `clawd-export-check-${process.pid}.h`);
let failures = 0, checkedCells = 0;
const skipped = [];

// scale 1 keeps the comparison direct: at scale 1 a source cell is one exported
// cell, so a mismatch is a mismatch and not an argument about which block it
// landed in. Scale > 1 gets its own check below, on one animation.
// stderr is captured rather than discarded: the exporter refuses some
// animations on purpose and says why there, and a check that cannot tell a
// refusal from a disappearance has to call both a failure or neither.
// spawnSync and not execFileSync: the latter returns stdout, and the summary
// this needs is on stderr so that --out - stays pipeable.
const run = spawnSync('node', [EXPORTER, '--all', '--scale', '1', '--out', tmp], { encoding: 'utf8' });
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }
const runOut = run.stderr;
const header = fs.readFileSync(tmp, 'utf8');

// Everything the exporter reported under "refused:", as name -> reason.
const refused = new Map();
{
  const lines = runOut.split('\n');
  let inList = false;
  for (const line of lines) {
    if (line.trim() === 'refused:') { inList = true; continue; }
    if (!inList) continue;
    const m = line.match(/^\s{2}([^:]+): (.+)$/);
    if (m) refused.set(m[1], m[2]); else if (line.trim() === '') inList = false;
  }
}

for (const name of eligible) {
  const src = sources.get(name);
  const def = parseDef(header, name);
  if (!def) {
    // Missing is fine only if the exporter said why. An animation that stops
    // exporting because something broke says nothing at all.
    if (refused.has(name)) { skipped.push(name); continue; }
    console.log(`  FAIL ${name}: absent from the header and not refused`); failures++; continue;
  }

  const id = ident(name);
  const palette = nums(header, `${id}_palette[`);
  const frames  = nums(header, `${id}_frames[`);
  const holds   = nums(header, `${id}_holds[`);

  if (def.frameCount !== src.frames.length) {
    console.log(`  FAIL ${name}: ${def.frameCount} frames exported, ${src.frames.length} in the source`);
    failures++; continue;
  }
  if (holds.join() !== src.frames.map(f => f.hold).join()) {
    console.log(`  FAIL ${name}: holds differ`); failures++; continue;
  }
  if (def.loopStart !== 0 || def.loopEnd !== src.frames.length - 1) {
    console.log(`  FAIL ${name}: loop region is ${def.loopStart}..${def.loopEnd}, not the whole file`);
    failures++; continue;
  }

  // Undo the crop: everything outside it has to have been empty, and everything
  // inside has to match through the palette remap. Colours are compared as
  // RGB565, which is what both formats store — comparing indices would only
  // prove the remap is self-consistent.
  const side = src.frames[0].grid.length;
  const hex565 = (hex) => {
    if (!hex || hex === 'transparent') return 0x0000;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return ((parseInt(h.substr(0, 2), 16) >> 3) << 11)
         | ((parseInt(h.substr(2, 2), 16) >> 2) << 5)
         |  (parseInt(h.substr(4, 2), 16) >> 3);
  };

  let x0 = side, y0 = side;
  for (const f of src.frames) f.grid.forEach((row, y) => row.forEach((c, x) => {
    if (c) { if (x < x0) x0 = x; if (y < y0) y0 = y; }
  }));

  let bad = null;
  for (let fi = 0; fi < src.frames.length && !bad; fi++) {
    const g = src.frames[fi].grid;
    for (let y = 0; y < side && !bad; y++) {
      for (let x = 0; x < side; x++) {
        const cx = x - x0, cy = y - y0;
        const inside = cx >= 0 && cy >= 0 && cx < def.w && cy < def.h;
        const want = hex565(src.palette?.[g[y][x]]);
        const got  = inside ? palette[frames[fi * def.w * def.h + cy * def.w + cx]] : 0x0000;
        checkedCells++;
        if (want !== got) { bad = `frame ${fi} cell (${x},${y}): source 0x${want.toString(16)} vs export 0x${got.toString(16)}`; break; }
      }
    }
  }
  if (bad) { console.log(`  FAIL ${name}: ${bad}`); failures++; }
}

// Scale > 1 has one job: turn each cell into a k x k block of itself. Checked on
// one animation rather than all, because the loop that does it is shared and a
// second animation would exercise the same lines with different data.
{
  const name = eligible.find(n => sources.get(n).frames[0].grid.length === 20);
  execFileSync('node', [EXPORTER, '--name', name, '--scale', '2', '--out', tmp],
               { stdio: ['ignore', 'ignore', 'ignore'] });
  const h2 = fs.readFileSync(tmp, 'utf8');
  const def = parseDef(h2, name);
  const frames = nums(h2, `${ident(name)}_frames[`);
  let bad = null;
  for (let fi = 0; fi < def.frameCount && !bad; fi++) {
    for (let y = 0; y < def.h && !bad; y += 2) {
      for (let x = 0; x < def.w; x += 2) {
        const at = (dy, dx) => frames[fi * def.w * def.h + (y + dy) * def.w + (x + dx)];
        if (at(0, 0) !== at(0, 1) || at(0, 0) !== at(1, 0) || at(0, 0) !== at(1, 1)) {
          bad = `frame ${fi} block at (${x},${y}) is not uniform`; break;
        }
      }
    }
  }
  if (bad) { console.log(`  FAIL ${name} at --scale 2: ${bad}`); failures++; }
  else console.log(`  ok   --scale 2 expands every cell into a uniform 2x2 block (${name})`);
}

// Refusals are the other half of correct: an exporter that silently degrades
// third-party art would pass every cell check above.
{
  const third = [...sources.keys()].filter(n => THIRD_PARTY.has(originOf(n)));
  if (!third.length) { console.log('  FAIL no third-party animation to test refusal with'); failures++; }
  else {
    execFileSync('node', [EXPORTER, '--all', '--out', tmp], { stdio: ['ignore', 'ignore', 'ignore'] });
    const all = fs.readFileSync(tmp, 'utf8');
    const leaked = third.filter(n => all.includes(`{"${n}"`));
    if (leaked.length) { console.log(`  FAIL third-party art in the export: ${leaked.join(', ')}`); failures++; }
    else console.log(`  ok   ${third.length} third-party animations refused, none in the output`);
  }
}

fs.unlinkSync(tmp);

console.log(`  ok   ${eligible.length - skipped.length} animations round-trip, ` +
            `${checkedCells.toLocaleString()} cells compared`);
for (const n of skipped) console.log(`  ok   ${n} refused with a reason: ${refused.get(n)}`);
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
