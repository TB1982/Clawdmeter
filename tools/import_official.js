#!/usr/bin/env node
/**
 * Import upstream's official Clawd animations as editable 60x60 templates.
 *
 *   node tools/import_official.js --list
 *   node tools/import_official.js --name "sailing scene"
 *   node tools/import_official.js --all
 *
 * Upstream (post-#153) stores each animation as a bounding-box crop plus an
 * (ox, oy) origin on a shared 55x37 art stage, which is itself centred inside a
 * 60x60 grid. This flattens that back out: the crop is composited onto the full
 * 60x60 grid at the position the device draws it, so what lands in the JSON is
 * exactly what the panel shows, with the rest of the grid empty and available.
 *
 * The empty part is the point. Their stage is 440x296 of a 480x480 panel and
 * their Clawd is 192x128 inside that, so most of the screen is unused. Opening
 * one of these in the editor at 60x60 gives 8px per cell across the whole
 * square — the same physical area our 20x20 animations cover, at 9x the cells.
 *
 * Two things do not survive, because our format has no field for them, and
 * both are recorded in "description" rather than dropped silently:
 *   - loop_start / loop_end. Upstream plays intro -> loop (held ~6s) -> outro;
 *     ours loops the whole file. An imported animation therefore plays its
 *     intro and outro on every pass.
 *   - the crop origin. It is baked into the grid here, so re-exporting will not
 *     reproduce upstream's ox/oy. That only matters if you send art back to
 *     them, which needs a converter to their struct anyway.
 *
 * Licence: the character and this art are Anthropic's, the same posture as the
 * claudepix material already in tools/ — see tools/README.md. Non-commercial
 * community use, licensed by nobody to anybody.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PALETTE_SIZE, GRID_SIZES } = require('./lib/format.js');

const STAGE_W = 55, STAGE_H = 37;

// Where the shared idle Clawd stands on upstream's stage. Frame 0 of 15 of the
// 17 animations is byte-identical here — 248 inked cells at x 15..38, y 21..36 —
// which is what "ox: 15" means on every core animation. Measured, not assumed.
const CLAWD_X = 15, CLAWD_W = 24;

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const has = k => args.includes(k);

const OUT_DIR = path.resolve(opt('--out', path.join(__dirname, 'official_anims')));
const REF = opt('--ref', 'origin/main');
const SRC = opt('--in', null);

// --grid auto|40|60. `auto` is the recommended setting and the default.
//
// 60 reproduces upstream exactly: their 55x37 stage centred in a 60x60 grid,
// 8 px per cell on a 480 px panel. 40 is better where the crop fits, for two
// reasons that point the same way — a cell becomes 12 px instead of 8, so the
// character is 288x192 rather than 192x128 and much closer to the scale the
// rest of this catalogue is drawn at; and a frame costs 1,600 bytes instead of
// 3,600. Only three crops are too wide for it: cloud (41), racing car and
// trumpet (50 each).
const GRID_MODE = opt('--grid', 'auto');
if (!['auto', '40', '60'].includes(GRID_MODE)) {
  console.error(`--grid must be auto, 40 or 60 (got "${GRID_MODE}")`);
  process.exit(1);
}
for (const side of [40, 60]) {
  if (!GRID_SIZES.includes(side)) {
    console.error(`tools/lib/format.js does not list ${side} in GRID_SIZES; add it first.`);
    process.exit(1);
  }
}

const fitsIn40 = a => a.w <= 40 && a.h <= 40;
const gridFor = a => GRID_MODE === '60' ? 60
                   : GRID_MODE === '40' ? 40
                   : (fitsIn40(a) ? 40 : 60);

// Placement of the crop on a grid of `side`.
//
// Vertical: every one of the 17 satisfies oy + h == 37, so they are all
// anchored to the bottom of the *stage* — which is not the bottom of the grid.
// Upstream's stage occupies rows 11..47 of 60, leaving 12 rows of margin below
// it, and that margin is there because the panel's corners are rounded and its
// bottom edge is not a place to stand. Anchoring to the grid instead put him on
// the very bottom pixel row; the simulator caught it immediately.
//
// So the margin scales with the grid: side/5 (12 at 60, 8 at 40). At side 60
// this reproduces upstream exactly — 60 - 12 - h == 48 - h == 11 + oy, since
// oy == 37 - h.
//
// Horizontal at 60 keeps upstream's stage anchoring, including its two edge
// snaps: art touching a stage edge was drawn to hang off the *screen* edge
// (lurking peeks in from the left), so it goes to the true edge.
//
// Horizontal at 40 cannot keep the stage, because the stage is wider than the
// grid. It keeps the thing the stage was for instead — Clawd landing in the
// same place in every animation, so the catalogue doesn't jitter him about.
// He occupies CLAWD_W cells from stage x CLAWD_X; centring that in the grid
// puts him at (side - CLAWD_W) / 2, so every crop shifts by that minus CLAWD_X.
// Crops too wide to honour it are clamped, which costs a couple of cells on
// two animations rather than pushing them off the grid.
function originX(a, side) {
  if (side === 60) {
    const anchor = (side - STAGE_W) >> 1;          // 2, matches STAGE_ANCHOR_X
    if (a.ox === 0) return 0;
    if (a.ox + a.w === STAGE_W) return side - a.w;
    return anchor + a.ox;
  }
  const shift = ((side - CLAWD_W) >> 1) - CLAWD_X; // -7 at side 40
  return Math.max(0, Math.min(side - a.w, a.ox + shift));
}
const originY = (a, side) => side - Math.round(side / 5) - a.h;

// ── Read upstream's generated header ────────────────────────────────────────
function readHeader() {
  if (SRC) return fs.readFileSync(path.resolve(SRC), 'utf8');
  try {
    return execFileSync('git', ['show', `${REF}:firmware/src/splash_animations.h`],
                        { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (e) {
    console.error(`Could not read splash_animations.h from ${REF}.`);
    console.error('Fetch upstream first (git fetch origin main), or pass --in <path>.');
    process.exit(1);
  }
}

const src = readHeader();

if (!/splash_anim_def_t/.test(src) || !/\box\b|crop origin/.test(src)) {
  console.error('That header does not look like the post-#153 upstream format');
  console.error('(no crop origin on the struct). Nothing was written.');
  process.exit(1);
}

// ── Parse ───────────────────────────────────────────────────────────────────
const ROW = /\{"([^"]+)",\s*"([^"]+)",\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*splash_(\w+)_palette/g;
const anims = [...src.matchAll(ROW)].map(m => ({
  name: m[1], cat: m[2],
  w: +m[3], h: +m[4], ox: +m[5], oy: +m[6],
  frameCount: +m[7], loopStart: +m[8], loopEnd: +m[9], paletteCount: +m[10],
  ident: m[11],
}));

if (!anims.length) { console.error('No animations found in the header.'); process.exit(1); }

function nums(ident, kind, radix) {
  const m = src.match(new RegExp(`splash_${ident}_${kind}\\[\\d+\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) throw new Error(`missing ${kind} array for ${ident}`);
  return m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => parseInt(s, radix));
}

// RGB565 -> #RRGGBB. The low bits are replicated rather than zero-filled, so
// full-scale stays full-scale (0x1F -> 0xFF, not 0xF8) and white is white.
function hex565(v) {
  const r5 = (v >> 11) & 0x1F, g6 = (v >> 5) & 0x3F, b5 = v & 0x1F;
  const r = (r5 << 3) | (r5 >> 2), g = (g6 << 2) | (g6 >> 4), b = (b5 << 3) | (b5 >> 2);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function convert(a) {
  const side = gridFor(a);
  if (a.w > side || a.h > side)
    throw new Error(`${a.name}: crop is ${a.w}x${a.h}, does not fit a ${side}x${side} grid`);

  const pal = nums(a.ident, 'palette', 16);
  const holds = nums(a.ident, 'holds', 10);
  const cells = nums(a.ident, 'frames', 10);

  const expect = a.frameCount * a.w * a.h;
  if (cells.length !== expect)
    throw new Error(`${a.name}: frames array is ${cells.length}, expected ${expect}`);

  // Index 0 is the background everywhere in both formats.
  const palette = ['transparent'];
  for (let i = 1; i < a.paletteCount; i++) palette.push(hex565(pal[i]));
  if (palette.length > PALETTE_SIZE)
    throw new Error(`${a.name}: ${palette.length} palette entries, cap is ${PALETTE_SIZE}`);

  const ax = originX(a, side), ay = originY(a, side);
  const frames = [];
  for (let f = 0; f < a.frameCount; f++) {
    const grid = Array.from({length: side}, () => new Array(side).fill(0));
    for (let r = 0; r < a.h; r++) {
      const y = ay + r;
      if (y < 0 || y >= side) continue;
      for (let c = 0; c < a.w; c++) {
        const x = ax + c;
        if (x < 0 || x >= side) continue;
        grid[y][x] = cells[(f * a.h + r) * a.w + c];
      }
    }
    frames.push({ hold: holds[f], grid });
  }

  const clamped = side === 40 && ax !== a.ox + (((side - CLAWD_W) >> 1) - CLAWD_X);
  return {
    name: a.name,
    category: 'Official',
    description:
      `Imported from upstream ${a.cat} art by tools/import_official.js. ` +
      `Crop ${a.w}x${a.h} from stage (${a.ox},${a.oy}), placed at (${ax},${ay}) ` +
      `on a ${side}x${side} grid${clamped ? ' (x clamped to fit)' : ''}. ` +
      `Upstream loops frames ${a.loopStart}..${a.loopEnd} and holds that region ~6s; ` +
      `our engine loops the whole file, so the intro and outro replay every pass.`,
    palette,
    frames,
  };
}

const kb = a => (a.frameCount * gridFor(a) * gridFor(a)) / 1024;

// ── Run ─────────────────────────────────────────────────────────────────────
if (has('--list')) {
  console.log(`${anims.length} animations in ${SRC || REF}   (--grid ${GRID_MODE})\n`);
  console.log('  ' + 'name'.padEnd(16) + 'cat'.padEnd(9) + 'frames  crop     pal  grid   flash');
  for (const a of anims) {
    const side = gridFor(a);
    const fits = a.w <= side && a.h <= side;
    console.log(`  ${a.name.padEnd(16)}${a.cat.padEnd(9)}${String(a.frameCount).padStart(4)}    ` +
                `${(a.w + 'x' + a.h).padEnd(8)} ${String(a.paletteCount).padStart(2)}   ` +
                `${(side + 'x' + side).padEnd(6)} ${fits ? (kb(a).toFixed(0) + ' KB').padStart(7)
                                                        : '  TOO BIG'}`);
  }
  const ok = anims.filter(a => a.w <= gridFor(a) && a.h <= gridFor(a));
  const skipped = anims.length - ok.length;
  console.log(`\n  ${ok.length} importable at --grid ${GRID_MODE}: ` +
              `${ok.reduce((s, a) => s + kb(a), 0).toFixed(0)} KB of flash` +
              (skipped ? `, ${skipped} too wide for a 40x40 grid` : ''));
  console.log(`  (upstream stores them as crops, which costs it ` +
              `${(anims.reduce((s, a) => s + a.frameCount * a.w * a.h, 0) / 1024).toFixed(0)} KB)`);
  process.exit(0);
}

// --skip drops names from --all: several of the seventeen are not wanted (e.g.
// "jumping", which upstream itself leaves out of every rate group and which is
// a near-duplicate of "jumping happy").
const skip = new Set((opt('--skip', '') || '').split(',').map(s => s.trim()).filter(Boolean));
const named = opt('--name', null);
let wanted = has('--all') ? anims.filter(a => !skip.has(a.name))
                          : anims.filter(a => a.name === named);

if (!wanted.length) {
  console.error(named ? `No animation named "${named}". Try --list.`
                      : 'Pass --name "<animation>", --all, or --list.');
  process.exit(1);
}

const tooBig = wanted.filter(a => a.w > gridFor(a) || a.h > gridFor(a));
if (tooBig.length) {
  console.error(`These do not fit a ${GRID_MODE}x${GRID_MODE} grid: ` +
                tooBig.map(a => `${a.name} (${a.w}x${a.h})`).join(', '));
  console.error('Use --grid auto to put the oversized ones on 60x60. Nothing was written.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let bytes = 0;
for (const a of wanted) {
  const out = convert(a);
  const file = path.join(OUT_DIR, a.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const side = out.frames[0].grid.length;
  const b = out.frames.length * side * side;
  bytes += b;
  console.log(`${(side + 'x' + side).padEnd(6)} ${String(out.frames.length).padStart(3)}f ` +
              `${String(out.palette.length).padStart(2)}c ${(b / 1024).toFixed(0).padStart(4)} KB  ` +
              path.relative(process.cwd(), file));
}
console.log(`\n${wanted.length} written to ${path.relative(process.cwd(), OUT_DIR)}/ ` +
            `— ${(bytes / 1024).toFixed(0)} KB of flash if all are shipped.`);
if (skip.size) console.log(`skipped: ${[...skip].join(', ')}`);
