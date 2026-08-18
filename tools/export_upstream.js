#!/usr/bin/env node
/**
 * Export an animation from this fork's format into upstream's.
 *
 *   node tools/export_upstream.js --name "hanabi"
 *   node tools/export_upstream.js --name "hanabi" --preview
 *   node tools/export_upstream.js --all --out /tmp/nova_anims.h
 *
 * This is tools/import_official.js pointed the other way. That one flattens
 * upstream's bounding-box crop onto our full square grid so the editor can open
 * it; this one crops our square grid back down to a bounding box and writes
 * their struct.
 *
 * Why it exists: upstream's tools/ holds three files — a GIF converter, an icon
 * converter, and a README. There is no editor and no JSON format, so a fork of
 * upstream cannot play *any* hand-drawn animation, ours or its own. Everything
 * needed to change that already lives here; what was missing was the last step,
 * and this is it. The output is a header a stranger drops into their build. No
 * change to their code is required — their splash.cpp already reads this struct.
 *
 * ── The two formats ─────────────────────────────────────────────────────────
 *
 *   ours      a square grid (20/40/60) that IS the screen; one byte per cell
 *             into a <=36-entry palette; the whole file loops.
 *   upstream  a w x h crop placed at (ox, oy) on a 55x37 art stage which is
 *             itself anchored inside a 60x60 grid; <=16-entry palette;
 *             intro -> loop -> outro via loop_start/loop_end.
 *
 * Nothing here is resampled. A cell becomes an n x n block of the same cell,
 * which is the property tools/lib/format.js relies on to call growing an
 * animation free: nothing moves, and it is identical on the panel until it is
 * refined by hand. Non-integer scaling would be a redraw, so it is refused
 * rather than approximated.
 *
 * ── Where it lands, and why that is a choice ────────────────────────────────
 *
 * Their compositor places art at (STAGE_ANCHOR + ox, STAGE_ANCHOR + oy) with
 * STAGE_ANCHOR_Y = (60-37)/2 = 11, and every animation they ship bottoms out on
 * row 48 — that shared ground line is what makes their transitions seamless,
 * because each one hands over on the same idle pose.
 *
 * Our animations have no such pose. They are standalone scenes, so aligning
 * them to a ground line they never had buys nothing, and the stage's 37-row
 * ceiling costs real size. Hence two targets:
 *
 *   --fit full   (default)  60 wide x 49 tall, the largest area oy >= 0 can
 *                           reach. Bigger; ignores the ground line.
 *   --fit stage             55 x 37, ground-line aligned, exactly where their
 *                           own art lives. Use this for a creature animation
 *                           that shares a rate group with theirs.
 *
 * 49 and not 60: oy is unsigned, so the highest row reachable is 11, and the
 * grid ends at 59. Content taller than 49 cannot be expressed at all — not a
 * limitation worth working around, since their compositor would clip it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PALETTE_SIZE, GRID_SIZES, HOLD_MIN_MS } = require('./lib/format');
const { originOf, THIRD_PARTY } = require('./lib/origin');

// Their struct's fixed palette array. Index 0 is the background, so 15 drawn
// colours is the real budget. Ours is PALETTE_SIZE (36) on the same convention,
// which is why an export can overflow and an import never can.
const UPSTREAM_PALETTE_SIZE = 16;

// Their stage, and the anchor it sits at inside the 60x60 grid. Mirrors
// STAGE_ANCHOR_X/Y in upstream's splash.cpp — if they move, this is the copy
// that has to follow, and the numbers are here rather than inline so there is
// one place to change.
const GRID = 60;
const STAGE_W = 55, STAGE_H = 37;
const ANCHOR_X = Math.floor((GRID - STAGE_W) / 2);   // 2
const ANCHOR_Y = Math.floor((GRID - STAGE_H) / 2);   // 11

const IN_DIRS = ['custom_anims', 'drawn_anims', 'official_anims'];

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const has = (flag) => argv.includes(flag);

const WANT_NAME = opt('--name', null);
const WANT_ALL  = has('--all');
const OUT       = opt('--out', null);
const FIT       = opt('--fit', 'full');
const SCALE_ARG = opt('--scale', 'auto');
const PREVIEW   = has('--preview');
const INCLUDE_OFFICIAL = has('--include-official');
const FILES     = argv.filter(a => a.endsWith('.json'));

if (!WANT_NAME && !WANT_ALL && !FILES.length) {
  console.error(fs.readFileSync(__filename, 'utf8')
      .split('\n').slice(1, 12).map(l => l.replace(/^ \*ns?/, '')).join('\n'));
  console.error('\nnode tools/export_upstream.js --name "<animation>" [--preview]');
  console.error('node tools/export_upstream.js --all --out FILE');
  console.error('  --fit full|stage   default full');
  console.error('  --scale auto|N     default auto (largest integer that fits)');
  console.error('  --include-official export Anthropic art too (upstream already has it)');
  process.exit(2);
}
if (FIT !== 'full' && FIT !== 'stage') {
  console.error(`--fit must be "full" or "stage", got "${FIT}"`);
  process.exit(2);
}

const FIT_W = FIT === 'stage' ? STAGE_W : GRID;
const FIT_H = FIT === 'stage' ? STAGE_H : GRID - ANCHOR_Y;   // 37 or 49

// ── loading ─────────────────────────────────────────────────────────────────

function loadAll() {
  const out = new Map();   // name -> {json, src}
  for (const d of IN_DIRS) {
    const dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      if (f.startsWith('_')) continue;          // _index.json, _template_*
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch { continue; }
      if (!j || !j.name || !Array.isArray(j.frames) || !j.frames[0]?.grid) continue;
      out.set(j.name, { json: j, src: `${d}/${f}` });   // later dirs win, as in convert_to_c.js
    }
  }
  return out;
}

function loadFile(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { json: j, src: path.relative(process.cwd(), p) };
}

// ── conversion ──────────────────────────────────────────────────────────────

function hexToRgb565(hex) {
  if (!hex || hex === 'transparent') return 0x0000;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

const ident = (name) => 'splash_' + name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

// A refusal carries the number that caused it, because "does not fit" without
// the measurement sends you back to the drawing to guess which way to move.
class Refuse extends Error {}

function convert(entry) {
  const j = entry.json;

  // What may leave the repo. A generated header is handed to a stranger to
  // compile, which is a distribution in the way build_editor_samples.js --public
  // already reasons about; the same rule decides it, from the same module.
  const origin = originOf(j.name);
  if (THIRD_PARTY.has(origin))
    throw new Refuse(
      `origin is ${origin}. claudepix states no licence and its author has been ` +
      `unreachable since 2026-08-15, so this is not ours to hand on. ` +
      `It stays loadable in the editor; it does not get exported.`);
  if (origin === 'official' && !INCLUDE_OFFICIAL)
    throw new Refuse(
      `Anthropic's own art — upstream already ships it natively, with loop regions ` +
      `and stage placement this conversion cannot reproduce. --include-official ` +
      `exports it anyway.`);

  const side = j.frames[0].grid.length;
  if (!GRID_SIZES.includes(side))
    throw new Refuse(`grid is ${side}x${side}; the pipeline accepts ${GRID_SIZES.join('/')}`);
  for (const f of j.frames) {
    if (f.grid.length !== side || f.grid.some(r => r.length !== side))
      throw new Refuse('frames disagree about the grid size');
  }

  // Union bounding box across every frame — their w/h/ox/oy are per animation,
  // not per frame, so a box that fits frame 1 and clips frame 9 is not a box.
  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  for (const f of j.frames) {
    f.grid.forEach((row, y) => row.forEach((c, x) => {
      if (!c) return;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }));
  }
  if (x1 < 0) throw new Refuse('every frame is empty');
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // Palette: only what this animation actually draws, renumbered from 1.
  // Index 0 stays the background in both formats, so it needs no entry.
  const used = new Set();
  for (const f of j.frames) for (const row of f.grid) for (const c of row) if (c) used.add(c);
  const ours = [...used].sort((a, b) => a - b);
  if (ours.some(i => i >= PALETTE_SIZE))
    throw new Refuse(`a cell indexes palette entry ${Math.max(...ours)}, past our own cap of ${PALETTE_SIZE - 1}`);
  if (ours.length + 1 > UPSTREAM_PALETTE_SIZE) {
    throw new Refuse(
      `${ours.length} drawn colours; upstream's palette holds ${UPSTREAM_PALETTE_SIZE} including the background, ` +
      `so ${UPSTREAM_PALETTE_SIZE - 1} is the budget. Reducing it is a redraw, not a conversion — ` +
      `merge the closest pair in the editor first.`);
  }
  const remap = new Map(ours.map((oldIdx, i) => [oldIdx, i + 1]));
  const palette = [0x0000, ...ours.map(i => hexToRgb565(j.palette?.[i]))];
  while (palette.length < UPSTREAM_PALETTE_SIZE) palette.push(0x0000);

  // Scale: integer only. Anything else resamples, and a resampled pixel drawing
  // is a different drawing.
  let k;
  if (SCALE_ARG === 'auto') {
    k = Math.min(Math.floor(FIT_W / bw), Math.floor(FIT_H / bh));
  } else {
    k = parseInt(SCALE_ARG, 10);
    if (!Number.isInteger(k) || k < 1) throw new Refuse(`--scale must be "auto" or a whole number >= 1`);
  }
  if (k < 1) {
    throw new Refuse(
      `content is ${bw}x${bh} cells and the ${FIT} target is ${FIT_W}x${FIT_H}. ` +
      (FIT === 'stage' ? 'Try --fit full (60x49).' : 'It cannot be placed; oy is unsigned so row 11 is the highest reachable.'));
  }
  const w = bw * k, h = bh * k;
  if (w > FIT_W || h > FIT_H)
    throw new Refuse(`--scale ${k} gives ${w}x${h}, past the ${FIT} target of ${FIT_W}x${FIT_H}`);

  // Placement. Centre on the grid, then express that as an offset from their
  // anchor. oy is unsigned, so anything that would sit above row 11 is pinned
  // to row 11 rather than silently wrapping.
  const wantAx = Math.floor((GRID - w) / 2);
  const wantAy = Math.floor((GRID - h) / 2);
  const ox = Math.max(0, wantAx - ANCHOR_X);
  const oy = Math.max(0, wantAy - ANCHOR_Y);
  const ax = (ox === 0) ? 0 : ANCHOR_X + ox;   // their horizontal edge-snap
  const ay = ANCHOR_Y + oy;
  if (ay + h > GRID)
    throw new Refuse(`placed at row ${ay} it would end at ${ay + h}, past the ${GRID}-row grid`);

  // Frames: crop, then expand each cell into a k x k block.
  const frames = [];
  for (const f of j.frames) {
    const buf = new Uint8Array(w * h);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const v = f.grid[y0 + y][x0 + x];
        if (!v) continue;
        const m = remap.get(v);
        for (let dy = 0; dy < k; dy++) {
          const row = (y * k + dy) * w + x * k;
          for (let dx = 0; dx < k; dx++) buf[row + dx] = m;
        }
      }
    }
    frames.push(buf);
  }

  // Holds. Ours are already whole ms at or above HOLD_MIN_MS (tools/lib/format
  // enforces it); their field is uint16_t, so the only new ceiling is 65535.
  const holds = j.frames.map(f => {
    const v = f.hold;
    if (!Number.isInteger(v) || v < HOLD_MIN_MS)
      throw new Refuse(`a frame holds ${v} ms; the floor is ${HOLD_MIN_MS} and it must be whole`);
    if (v > 0xFFFF) throw new Refuse(`a frame holds ${v} ms, past the uint16_t ceiling of 65535`);
    return v;
  });

  return {
    name: j.name, src: entry.src, side, bw, bh, k, w, h, ox, oy, ax, ay,
    palette, paletteCount: ours.length + 1, frames, holds,
    // Their playback is intro -> loop -> outro; ours is one loop of the whole
    // file. The honest translation is a loop region that covers everything,
    // which is also the default their own comment documents.
    loopStart: 0, loopEnd: j.frames.length - 1,
    bytes: frames.length * w * h + holds.length * 2 + UPSTREAM_PALETTE_SIZE * 2,
  };
}

// ── emitting ────────────────────────────────────────────────────────────────

function emitArrays(a) {
  const id = ident(a.name);
  const L = [];
  L.push(`static const uint16_t ${id}_palette[${UPSTREAM_PALETTE_SIZE}] = {` +
         a.palette.map(v => '0x' + v.toString(16).toUpperCase().padStart(4, '0')).join(',') + '};');
  L.push(`static const uint8_t ${id}_frames[${a.frames.length * a.w * a.h}] = {`);
  for (const f of a.frames) {
    const rows = [];
    for (let y = 0; y < a.h; y++) rows.push(Array.from(f.slice(y * a.w, (y + 1) * a.w)).join(','));
    L.push('    ' + rows.join(',') + ',');
  }
  L.push('};');
  L.push(`static const uint16_t ${id}_holds[${a.holds.length}] = {${a.holds.join(',')}};`);
  return L.join('\n');
}

function emitDef(a) {
  const id = ident(a.name);
  return `    {"${a.name}", "persona", ${a.w}, ${a.h}, ${a.ox}, ${a.oy}, ` +
         `${a.frames.length}, ${a.loopStart}, ${a.loopEnd}, ${a.paletteCount}, ` +
         `${id}_palette, ${id}_frames, ${id}_holds},`;
}

function emitHeader(list) {
  const L = [];
  L.push('// ============================================================');
  L.push('// Animations exported from a Clawdmeter fork that keeps the square');
  L.push('// grid format (20/40/60 cells, <=36 colours) and ships an editor:');
  L.push('//     https://github.com/TB1982/Clawdmeter');
  L.push('// Generated by tools/export_upstream.js — do not edit by hand.');
  L.push('//');
  L.push('// Put this file next to splash_animations.h and make three edits to');
  L.push('// that header — the include has to sit above splash_anims[], since the');
  L.push('// arrays it defines are what the entries point at:');
  L.push('//');
  L.push('//     #include "' + (OUT ? path.basename(OUT) : 'this_file.h') + '"');
  L.push('//     #define SPLASH_ANIM_COUNT (17 + SPLASH_EXTRA_ANIM_COUNT)');
  L.push('//     static const splash_anim_def_t splash_anims[SPLASH_ANIM_COUNT] = {');
  L.push('//         ... the entries already there ...');
  L.push('//         SPLASH_EXTRA_ANIM_DEFS');
  L.push('//     };');
  L.push('//');
  L.push('// Then add the names to a rate group in GROUP_NAMES (splash.cpp). An');
  L.push('// animation that is in the build but in no group is never picked.');
  L.push('//');
  L.push('// The entries are a macro rather than loose lines because this file is');
  L.push('// #included: loose initialisers at file scope do not compile, and the');
  L.push('// error names a brace rather than the mistake.');
  L.push('// ============================================================');
  L.push('#pragma once');
  L.push('#include <stdint.h>');
  L.push('');
  for (const a of list) {
    L.push(`// ${a.name} — ${a.side}x${a.side} source, ${a.bw}x${a.bh} of it drawn,`);
    L.push(`// scaled ${a.k}x to ${a.w}x${a.h} and placed at grid rows ${a.ay}..${a.ay + a.h - 1}.`);
    L.push(emitArrays(a));
    L.push('');
  }
  L.push(`#define SPLASH_EXTRA_ANIM_COUNT ${list.length}`);
  L.push('#define SPLASH_EXTRA_ANIM_DEFS \\');
  L.push(list.map(a => emitDef(a).replace(/,$/, ',')).join(' \\\n'));
  L.push('');
  L.push('// The names, so a rate group can be edited without opening this file:');
  L.push('//   ' + list.map(a => `"${a.name}"`).join(', '));
  return L.join('\n') + '\n';
}

function preview(a) {
  const L = [`\n${a.name} — placed at rows ${a.ay}..${a.ay + a.h - 1}, cols ${a.ax}..${a.ax + a.w - 1} of ${GRID}`];
  const f = a.frames[0];
  const step = Math.max(1, Math.ceil(a.h / 40));   // keep a tall one readable
  for (let y = 0; y < a.h; y += step) {
    let s = '';
    for (let x = 0; x < a.w; x += step) s += f[y * a.w + x] ? f[y * a.w + x].toString(36) : '.';
    L.push('  ' + s);
  }
  if (step > 1) L.push(`  (sampled every ${step} cells to fit the terminal)`);
  return L.join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────

let entries = [];
if (FILES.length) entries = FILES.map(loadFile);
else {
  const all = loadAll();
  if (WANT_ALL) entries = [...all.values()];
  else {
    const e = all.get(WANT_NAME);
    if (!e) {
      console.error(`No animation named "${WANT_NAME}". Available:`);
      for (const n of [...all.keys()].sort()) console.error('  ' + n);
      process.exit(1);
    }
    entries = [e];
  }
}

const done = [], refused = [];
for (const e of entries) {
  try { done.push(convert(e)); }
  catch (err) {
    if (!(err instanceof Refuse)) throw err;
    refused.push({ name: e.json?.name || e.src, why: err.message });
  }
}

if (done.length) {
  const header = emitHeader(done);
  if (OUT) { fs.writeFileSync(OUT, header); }
  else if (!PREVIEW) { process.stdout.write(header); }
}

// Everything below goes to stderr so `--out -` style piping stays clean.
const say = (s) => process.stderr.write(s + '\n');
say('');
say(`fit ${FIT} (${FIT_W}x${FIT_H})   scale ${SCALE_ARG}`);
say('');
say('animation'.padEnd(20) + 'source'.padEnd(10) + 'drawn'.padEnd(9) + 'scale'.padEnd(7) + 'placed'.padEnd(10) + 'rows'.padEnd(9) + 'flash');
for (const a of done) {
  say(String(a.name).padEnd(20) +
      `${a.side}x${a.side}`.padEnd(10) +
      `${a.bw}x${a.bh}`.padEnd(9) +
      `${a.k}x`.padEnd(7) +
      `${a.w}x${a.h}`.padEnd(10) +
      `${a.ay}..${a.ay + a.h - 1}`.padEnd(9) +
      `${(a.bytes / 1024).toFixed(1)} KB`);
}
if (refused.length) {
  say('');
  say('refused:');
  for (const r of refused) say(`  ${r.name}: ${r.why}`);
}
if (done.length) {
  const kb = done.reduce((s, a) => s + a.bytes, 0) / 1024;
  say('');
  say(`${done.length} exported, ${kb.toFixed(1)} KB of flash` + (OUT ? ` → ${OUT}` : ''));
}
if (PREVIEW) for (const a of done) say(preview(a));
process.exit(refused.length && !done.length ? 1 : 0);
