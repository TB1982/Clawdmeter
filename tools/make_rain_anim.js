#!/usr/bin/env node
/**
 * Rain, falling around a drawing that already exists.
 *
 *   node tools/make_rain_anim.js --base "leaf" --name "rainy" --preview /tmp
 *   node tools/make_rain_anim.js --base "leaf" --name "rainy" --out tools/drawn_anims
 *
 * Nova draws the creature and whatever he is holding; this puts weather around
 * him. Same division as make_custom_anims.js — the prop is hers, the motion is
 * computed — except here the computed part is the background rather than the
 * prop, so it has to be told where *not* to go.
 *
 * ── Rain stops where it lands ───────────────────────────────────────────────
 *
 * For each column, per frame, the topmost drawn cell is found and no drop is
 * placed at or below it. That is one rule doing three jobs: rain does not fall
 * through Clawd, it does not appear under whatever he is holding, and the
 * sheltered patch moves with him when he bobs. Drawing rain in front of his
 * face would be the alternative and it reads as noise, not weather.
 *
 * The column scan is per frame and not once for the whole animation, because a
 * held-up leaf shifts a cell or two as he moves; a fixed silhouette would leak
 * drops under the edge on exactly the frames where the shelter matters.
 *
 * ── Two speeds, because one speed is a texture ──────────────────────────────
 *
 * Near drops are brighter, longer and fall twice as fast as far ones. Parallax
 * is what sells depth — the coin band learned this the same way. A single
 * speed reads as a moving pattern rather than as something happening in front
 * of something else.
 *
 * ── The loop has to close, in two ways at once ──────────────────────────────
 *
 * Output frames are a uniform FRAME_MS so the rain can move at a rain-like
 * rate; the base's own hold times are resampled onto that timeline rather than
 * overwritten, so a four-frame creature keeps its own pacing underneath. Frame
 * count is chosen so the base's loop and the drops' fall both come out whole:
 * the base repeats an integer number of times, and every drop falls an integer
 * number of grid heights. Miss either and the last frame does not meet the
 * first, which on a screen that loops forever is a visible hitch every pass.
 *
 * ── Fixed layout, no randomness ─────────────────────────────────────────────
 *
 * The drop table is written down. A generator that produces something different
 * every run cannot be reviewed, and "run it again until it looks right" is not
 * a dependency a checked-in file should have. Columns are deliberately uneven —
 * evenly spaced rain reads as a machine.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PALETTE_SIZE, GRID_SIZES, HOLD_MIN_MS } = require('./lib/format');

let GRID = 60;   // reset below if the base is cropped to a smaller one

// ── The drop model, from docs/animation-craft.md ────────────────────────────
//
// Two things in that file decide this, both learned making "rainy days" and
// both the opposite of what seems reasonable:
//
//   "no two drops on the same row anywhere ... forced one drop per column,
//    which removed the strung-out fall lines that make rain read as rain and
//    halved the density. The result was snow."
//
// So a column carries a *line* of drops, not one drop. The first version of
// this generator had one drop per column and produced exactly the described
// failure — scattered flecks, correct in every frame and wrong as weather.
// The rule that works is narrow: never three on a row anywhere.
//
//   "rain, water and fire are the same generator ... displaced by two or three
//    sines whose periods share no common factor"
//
// Column spacing and phase come from sines of period 7 and 11 over the column
// index. Coprime, so the pattern does not name itself as machine-drawn inside
// the 60 cells there are to see it in.
//
// Depth is brightness and count, not speed. Measured off "rainy days":
// 126 dim cells, 81 mid, 42 bright — roughly 3:2:1, dimmest most numerous,
// and every drop moving at one speed. Parallax was tried here first and it is
// not what she drew.

// SPEED * FRAMES must come out to exactly GRID: then a drop falls the whole
// height in one loop and there is no vertical repeat at all inside what you can
// see. Any shorter wrap tiles the column, and a tiled column is a pattern.
// Cells per frame. Derived, not fixed: it has to satisfy SPEED * FRAMES = a
// whole number of grid heights, and which speeds can do that depends on the
// grid. 3 works at 60 and cannot at 40, where 3 and 40 are coprime and the
// smallest frame count that closes is 40 — which does not divide this base's
// 1700 ms. Fixing the speed made the tool reject a drawing for the shape of the
// grid it was cropped to, which is not a fact about the drawing.
let SPEED = 3;
// A drop is DROP x DROP cells, not one.
//
// This is the number that was wrong, and it was wrong in the direction that
// looks safe. Measured off "rainy days": its drops are 1 cell against a subject
// 19 cells tall, so 1:19. At 60 cells the subject is 32 tall, and a 1-cell drop
// is 1:32 — half the relative size, which is why the rain read as static rather
// than as drops. 32/19 rounds to 2.
//
// The screen numbers say the same thing louder. "rainy days" plays full-panel
// at 24 px a cell, so a drop is 24 px. Here a cell is 5 px in the weather
// screen's box, so a 1-cell drop is 5 px: a fifth of the original, well past
// the size where an eye can follow one of them instead of seeing the average.
//
// Density then follows rather than being chosen. 3.3% of 3600 is 119 cells,
// and at 4 cells a drop that is about 30 drops — which is close to the
// original's 13 in the same picture made three times wider.
const DROP = 2;
const P1 = 7, P2 = 11;     // coprime, per the craft note
const PHI = 0.6180339887;  // for spreading drops inside a column
const MAX_PER_ROW = Math.round(GRID / 20 * 2 / DROP);        // Nova's "never three", as a fraction of the row
const MAX_PER_ROW_BEHIND = Math.round(GRID / 20 * 1 / DROP); // and her tighter one for the sheltered band

// Nova's far and near from "rainy days", with the middle placed halfway
// between them rather than taken from her file.
//
// Her three are 134, 210 and 241 in luminance: a gap of 76 to the middle and
// only 31 above it. At 24 px a cell that separates; at the 5 px this renders
// at, the top two are one colour and the rain reads as two layers. The middle
// is the average of the outer two, which puts the three at 134 / 188 / 241 —
// even steps, and derived from her colours rather than invented beside them.
const mix = (a, b) => '#' + [0, 2, 4].map(i =>
  Math.round((parseInt(a.slice(1 + i, 3 + i), 16) + parseInt(b.slice(1 + i, 3 + i), 16)) / 2)
    .toString(16).padStart(2, '0')).join('');
const FAR_HEX = '#5B93B0', NEAR_HEX = '#E0F7FF';
const TIER_HEX = [FAR_HEX, mix(FAR_HEX, NEAR_HEX), NEAR_HEX];   // far, mid, near

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const BASE    = opt('--base', null);
const NAME    = opt('--name', null);
const OUT     = opt('--out', null);
const PREVIEW = opt('--preview', null);
const FRAMES_ARG = argv.includes('--frames') ? parseInt(opt('--frames', ''), 10) : null;
const GRID_ARG = argv.includes('--grid') ? parseInt(opt('--grid', ''), 10) : null;

if (!BASE) {
  console.error('node tools/make_rain_anim.js --base "<animation>" [--name "<new name>"]');
  console.error('  --frames N     output frames (default: derived from the base)');
  console.error('  --grid N       crop onto a smaller square first (20/40/60)');
  console.error('  --out DIR      write the JSON (default: print a summary only)');
  console.error('  --preview DIR  write a contact-sheet PNG');
  process.exit(2);
}

// ── load the base ───────────────────────────────────────────────────────────

function findBase(name) {
  for (const d of ['drawn_anims', 'official_anims', 'custom_anims']) {
    const dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.startsWith('_'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j.name === name) return j;
      } catch { /* not an animation */ }
    }
  }
  return null;
}

const base = findBase(BASE);
if (!base) { console.error(`No animation named "${BASE}".`); process.exit(1); }
let side = base.frames[0].grid.length;
if (!GRID_SIZES.includes(side)) {
  console.error(`"${BASE}" is ${side}x${side}; the pipeline takes ${GRID_SIZES.join('/')}.`);
  process.exit(1);
}

// ── crop to the smallest grid the drawing fits in ───────────────────────────
//
// From the craft notes: "the biggest grid that fits is usually the wrong one
// ... the grid is a resolution, not a canvas size: the panel is 480 px either
// way, so fewer cells means each one is larger. Pick the smallest grid the art
// fits in, not the largest the pipeline allows."
//
// It matters more for rain than for a creature, because the empty part of the
// canvas is what the rain has to fill. "rainy days" is a subject filling 71% of
// its 20x20 and thirteen drops in what is left. The same drawing loose on a
// 60x60 fills 27%, so the same rain has two and a half times the sky to cover
// and reads as thin however many drops are in it. Cropping fixes the ratio the
// density is measured against, which no amount of tuning the density can.
//
// A crop and not a rescale: every cell keeps its value and its neighbours. 60
// to 40 is a factor of 1.5, and a fractional rescale is a redraw.
if (GRID_ARG || true) {
  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  for (const f of base.frames) f.grid.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const want = GRID_ARG || GRID_SIZES.find(g => g >= w && g >= h) || side;
  if (!GRID_SIZES.includes(want)) {
    console.error(`--grid ${want} is not one of ${GRID_SIZES.join('/')}.`);
    process.exit(1);
  }
  if (want < w || want < h) {
    console.error(`the drawing is ${w}x${h} cells and will not fit a ${want}-cell grid.`);
    process.exit(1);
  }
  if (want !== side) {
    // Centre horizontally; keep the floor margin proportional, which is the
    // craft note's side/5 — the empty rows under his feet are why he reads as
    // standing somewhere rather than on the bottom pixel of a rounded panel.
    const ox = Math.floor((want - w) / 2) - x0;
    const oy = (want - Math.round(want / 5) - h) - y0;
    base.frames = base.frames.map(f => {
      const g = Array.from({ length: want }, () => new Array(want).fill(0));
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const ny = y + oy, nx = x + ox;
          if (ny >= 0 && ny < want && nx >= 0 && nx < want) g[ny][nx] = f.grid[y][x];
        }
      return { hold: f.hold, grid: g };
    });
    console.log(`  cropped    ${side}x${side} -> ${want}x${want}  ` +
                `(drawing is ${w}x${h}; nothing rescaled)`);
    side = want;
  }
  GRID = side;
}

// ── palette: keep the base's, append only what is missing ───────────────────

const palette = base.palette.slice();
const indexOf = (hex) => {
  const i = palette.findIndex(c => c && c.toLowerCase() === hex.toLowerCase());
  if (i >= 0) return i;
  if (palette.length >= PALETTE_SIZE) {
    console.error(`"${BASE}" already uses all ${PALETTE_SIZE} palette slots, so ${hex} ` +
                  `cannot be added. Merge two colours in the editor first.`);
    process.exit(1);
  }
  palette.push(hex);
  return palette.length - 1;
};
const TIER = TIER_HEX.map(indexOf);

// ── the output's clock ──────────────────────────────────────────────────────
//
// Two constraints have to hold at once, and neither is negotiable:
//
//   the base must loop a whole number of times   -> FRAMES * FRAME_MS is a
//                                                   multiple of its duration
//   every drop must fall a whole number of grids -> speed * FRAMES is a
//                                                   multiple of GRID
//
// So FRAME_MS is derived rather than fixed: it is the base's own loop divided
// by a frame count that satisfies the second. A hardcoded cadence would work
// for one drawing's hold times and reject the next, which is the wrong thing
// for a tool that exists to be pointed at whatever Nova draws.

const baseHolds = base.frames.map(f => f.hold);
const baseLoopMs = baseHolds.reduce((a, b) => a + b, 0);
// A column's pattern repeats every SPACING cells, so the loop closes when the
// fall distance is a whole number of spacings — not of the grid height. That is
// a weaker condition than it looks like it should be, and it is what lets the
// rain run at a believable speed instead of the 3 cells a frame that a
// grid-height wrap would force.

// Search (speed, frame count) together. Two targets, both taken from
// "rainy days": a frame every ~85 ms, and rain crossing the panel at about
// 160 px a second — one 24 px cell every 150 ms there. Cell size on the panel
// is what makes the second comparable across grids, so it is computed in
// pixels rather than cells.
const PANEL_PX = 300;                         // the weather screen's creature box
const TARGET_MS = 85, TARGET_PX_S = 160;
let FRAMES, FRAME_MS;
{
  const cands = [];
  for (let v = 1; v <= 6; v++)
    for (let T = 1; T <= 400; T++) {
      if ((v * T) % GRID !== 0) continue;
      if (baseLoopMs % T !== 0) continue;
      const ms = baseLoopMs / T;
      if (ms < HOLD_MIN_MS) continue;
      if (FRAMES_ARG && T !== FRAMES_ARG) continue;
      const pxs = v * (PANEL_PX / GRID) / (ms / 1000);
      cands.push({ v, T, ms, cost: Math.abs(ms - TARGET_MS) / TARGET_MS
                                 + Math.abs(pxs - TARGET_PX_S) / TARGET_PX_S });
    }
  if (!cands.length) {
    console.error(`No speed and frame count both close the rain loop and divide the ` +
                  `base's ${baseLoopMs} ms. Its holds would have to change.`);
    process.exit(1);
  }
  cands.sort((a, b) => a.cost - b.cost);
  ({ v: SPEED, T: FRAMES, ms: FRAME_MS } = cands[0]);
}

// How many output frames each base frame gets. Proportional with largest
// remainder, not a running clock: walking the timeline lets rounding pile onto
// whichever frame happens to straddle a boundary, and on this drawing that was
// the 200 ms blink — it came out at 255 ms while the frame after it lost 75.
// Rounding each hold independently keeps every frame within half a tick of what
// was drawn, and the remainder pass makes the counts add up to FRAMES exactly.
const share = baseHolds.map(h => ({ want: h / FRAME_MS, n: Math.max(1, Math.round(h / FRAME_MS)) }));
let drift = share.reduce((a, s) => a + s.n, 0) - FRAMES;
while (drift !== 0) {
  const order = share.map((s, i) => ({ i, err: s.n - s.want }))
                     .sort((a, b) => drift > 0 ? b.err - a.err : a.err - b.err);
  const pick = order.find(o => drift < 0 || share[o.i].n > 1);
  if (!pick) break;
  share[pick.i].n += drift > 0 ? -1 : 1;
  drift = share.reduce((a, s) => a + s.n, 0) - FRAMES;
}

const seq = [];
share.forEach((s, k) => { for (let n = 0; n < s.n; n++) seq.push(k); });
const baseFrameAt = (i) => seq[i];

// ── the columns ─────────────────────────────────────────────────────────────
//
// Which columns rain, how densely, and how bright — decided once, from the two
// coprime sines, so the same table comes out of every run.

const COLUMNS = [];
for (let x = 0; x < GRID; x++) {
  const h = Math.sin(2 * Math.PI * x / P1) + Math.sin(2 * Math.PI * x / P2);
  if (x % DROP) continue;                        // blocks sit on a DROP-cell pitch
  // Every column on the pitch rains; the wave decides how hard, not whether.
  //
  // The ratio Nova measured is of *cells* — 126 dim to 81 to 42 — and reading
  // it as columns is what left the bright tier three columns wide in sixty.
  // Three of anything cannot be spread evenly: however the tiers were assigned
  // the near layer came out a third to one side, which is a small-number
  // artefact rather than a distribution with a fix. Spreading the same cells
  // over every available column instead puts a bright one every twelve cells.
  //
  // What is placed and what is seen differ by about half: the shelter removes
  // every drop that would land under the creature, and the row limit removes
  // more.
  const n = 1 + (h > 0.6 ? 1 : 0);
  // Where they are. Golden-ratio steps from a per-column start, which spreads
  // them without ever settling into a spacing.
  //
  // Even spacing was the first attempt and it is what a lattice looks like: a
  // column of drops every 8 cells is a dotted vertical line, and forty of them
  // side by side is graph paper. The craft note's "strung-out fall lines" are
  // drops trailing one behind another at *unequal* distances — regular ones are
  // the same mistake as regular columns, one axis over.
  let f = ((Math.sin(2 * Math.PI * x / 13) + 1) / 2);
  const offsets = [];
  for (let k = 0; k < n; k++) { f = (f + PHI) % 1; offsets.push(Math.floor(f * GRID / DROP) * DROP); }
  COLUMNS.push({ x, offsets, tier: 0 });
}

// Brightness on a fixed six-column cycle, three far to two mid to one near.
//
// Three attempts, each less structured than the last, and the lesson is that
// less structure was the wrong axis to move along.
//
// Thresholds on the wave that chose the columns inverted the ratio. Ranking on
// a second pair of sines put eight of the ten brightest columns in the left
// half — periods 17 and 19 beat at 161 cells, longer than the 60 there are to
// see, so the canvas gets half of one slow swell: a wave whose beat exceeds the
// canvas is not irregular, it is a gradient. Stepping by phi removed the
// gradient but not the lumpiness, because with four near columns in sixty any
// arrangement is coarse — 172 cells left against 112 right, which is a
// three-one split reading as a bias.
//
// A cycle fixes the ratio exactly and guarantees one near column per six
// wherever you look. The shift by k/6 moves where in each six it lands, so the
// cycle itself does not become the pattern. Evenness at the scale of a few
// columns is what the eye is judging; over the whole canvas it was already even
// and still looked wrong.
const TIER_CYCLE = [0, 0, 1, 0, 1, 2];
// Keyed to the column's position, not its index in this list. Indexing by
// list position looked equivalent and is not: which columns rain is decided by
// a wave, so they are not evenly spaced, and the fifth *raining* column can sit
// anywhere. Position keeps a near column every twelve cells whatever rains.
COLUMNS.forEach((c) => {
  const k = Math.floor(c.x / DROP);
  c.tier = TIER_CYCLE[(k + Math.floor(k / 6)) % 6];
});

// ── compose ─────────────────────────────────────────────────────────────────

const frames = [];
for (let i = 0; i < FRAMES; i++) {
  const src = base.frames[baseFrameAt(i)].grid;
  const grid = src.map(row => row.slice());

  // Per column, the first drawn cell from the top. Rain stops above it, so the
  // creature and anything he holds shelter whatever is under them.
  const roof = new Array(GRID).fill(GRID);
  for (let x = 0; x < GRID; x++)
    for (let y = 0; y < GRID; y++)
      if (src[y][x]) { roof[x] = y; break; }

  // Place this column's drops, each carried down by the frame index.
  //
  // The far tier ignores the shelter: it is rain *behind* him, and stopping it
  // at his outline would say the leaf covers the whole depth of the scene
  // rather than the strip he is standing in. That is where the depth comes
  // from — dim drops continuing past his shoulders while bright ones stop.
  // The craft note's rule was always written on the assumption that this band
  // has rain in it; reading it as "the band is dry" removed the back layer.
  //
  // Mid and near stop, and the frame in which one crosses the outline leaves a
  // bead on whatever it hit.
  const placed = [], beads = [];
  for (const c of COLUMNS) {
    for (const o of c.offsets) {
      const y = (o + i * SPEED) % GRID;
      const sheltered = y >= roof[c.x];
      if (sheltered && c.tier !== 0) {
        // It landed this frame if it was above the outline last frame.
        if (y - roof[c.x] < SPEED && roof[c.x] < GRID) beads.push({ x: c.x, y: roof[c.x] });
        continue;
      }
      if (grid[y][c.x]) continue;                // never over the drawing
      placed.push({ x: c.x, y, tier: c.tier, sheltered });
    }
  }

  // "never three anywhere", scaled. The rule in the craft notes is a count, and
  // a count does not carry across grid widths: three drops on a 20-cell row is
  // 15% of it and reads as a deliberate line, while three on a 60-cell row is
  // 5% and reads as nothing at all. Held at three here it also caps the whole
  // animation at 2 per row x 60 rows = 3.3% of the grid, which is below the
  // 3.5% density it was measured from — the rule would forbid the drawing it
  // came from.
  //
  // So it is kept as the fraction of a row it was: 2 in 20, which is 6 in 60.
  const byRow = new Map();
  for (const d of placed) {
    if (!byRow.has(d.y)) byRow.set(d.y, []);
    byRow.get(d.y).push(d);
  }
  // Thin each row, open air and sheltered band counted separately.
  //
  // Separately because they are different densities in Nova's rule — "no two
  // drops on a row inside the band enclosed between the leaf and him" against
  // never three out in the open — and because a shared budget lets the open
  // half of a row spend what the band needed.
  //
  // Thinning keeps drops spread along the row rather than keeping the brightest.
  // Preferring bright was the first attempt and it deleted the back layer
  // wherever a row was busy: the dim tier is the only one that continues behind
  // him, so culling by tier culls exactly the depth the tiers exist for.
  const thin = (list, cap) => {
    if (list.length <= cap) return list;
    list.sort((a, b) => a.x - b.x);
    const step = list.length / cap, keep = [];
    for (let k = 0; k < cap; k++) keep.push(list[Math.floor(k * step)]);
    return keep;
  };
  for (const row of byRow.values()) {
    const open = thin(row.filter(d => !d.sheltered), MAX_PER_ROW);
    const band = thin(row.filter(d => d.sheltered), MAX_PER_ROW_BEHIND);
    for (const d of open.concat(band))
      for (let dy = 0; dy < DROP; dy++)
        for (let dx = 0; dx < DROP; dx++) {
          const y = d.y + dy, x = d.x + dx;
          if (y >= GRID || x >= GRID) continue;
          if (src[y][x]) continue;               // a block still never covers the drawing
          if (!d.sheltered && y >= roof[x]) continue;   // nor reaches past the shelter
          grid[y][x] = TIER[d.tier];
        }
  }

  // Beads last, so one is never overwritten by a drop passing the same cell.
  // Brightest tier on purpose: a bead sits on top of the leaf, in front of it.
  // Drawn DROP x DROP from the outline downwards, so it straddles the edge and
  // sits a cell into the shape. On the outline row alone every bead landed
  // exactly on the leaf's silhouette, which reads as the rim being wet rather
  // than as anything resting on the surface — as if the drop had clipped the
  // edge and carried on past.
  for (const b of beads)
    for (let dy = 0; dy < DROP; dy++)
      for (let dx = 0; dx < DROP; dx++) {
        const by = b.y + dy, bx = b.x + dx;
        if (by >= GRID || bx >= GRID) continue;
        if (!src[by][bx]) continue;          // only where there is something to sit on
        grid[by][bx] = TIER[2];
      }

  frames.push({ hold: FRAME_MS, grid });
}

// Prove the loop closes rather than trusting the arithmetic that was meant to
// make it. The craft notes give the test as well as the rule — "count the cells
// that change from the last frame back to the first and compare it with the
// ordinary steps" — so that is what this does. A seam shows once every loop
// forever, and it survives a glance at a contact sheet because every individual
// frame is correct.
{
  const changed = (a, b) => {
    let n = 0;
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++)
        if (a[y][x] !== b[y][x]) n++;
    return n;
  };
  const steps = [];
  for (let i = 1; i < FRAMES; i++) steps.push(changed(frames[i - 1].grid, frames[i].grid));
  const wrap = changed(frames[FRAMES - 1].grid, frames[0].grid);
  const lo = Math.min(...steps), hi = Math.max(...steps);
  if (wrap < lo || wrap > hi) {
    console.error(`the loop has a seam: the wrap changes ${wrap} cells against ` +
                  `${lo}-${hi} for an ordinary step. SPEED * FRAMES is ` +
                  `${SPEED * FRAMES} and has to be exactly the ${GRID}-cell grid.`);
    process.exit(1);
  }
  var SEAM = `${wrap} cells at the wrap, ${lo}-${hi} per ordinary step`;
}

const out = {
  name: NAME || `${BASE} rain`,
  category: 'Weather',
  description: `${base.name} with computed rain (tools/make_rain_anim.js). ` +
               `Rain stops at the topmost drawn cell of each column, so the creature ` +
               `and whatever he holds shelter what is beneath them.`,
  palette,
  frames,
};

console.log(`${out.name}`);
console.log(`  base       ${base.name}  ${base.frames.length} frames, ${baseLoopMs} ms`);
console.log(`  output     ${FRAMES} frames x ${FRAME_MS} ms = ${FRAMES * FRAME_MS} ms (1 base loop)`);
console.log(`  holds      ${baseHolds.map((h, k) => `${h}->${share[k].n * FRAME_MS}`).join('  ')} ms`);
const cells = frames.map(f => {
  let n = 0;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
    if (TIER.includes(f.grid[y][x]) && !base.frames[0].grid[y][x]) n++;
  return n;
});
console.log(`  columns    ${COLUMNS.length} of ${GRID} rain  ` +
            `(${COLUMNS.filter(c => c.tier === 0).length} far, ` +
            `${COLUMNS.filter(c => c.tier === 1).length} mid, ` +
            `${COLUMNS.filter(c => c.tier === 2).length} near)`);
console.log(`  drops      ${Math.min(...cells)}-${Math.max(...cells)} on screen per frame ` +
            `(${(cells.reduce((a,b)=>a+b,0) / cells.length / (GRID*GRID) * 100).toFixed(1)}% of the grid; ` +
            `"rainy days" is 3.5%)`);
{
  // Beads are the easiest part of this to break without noticing: they are a
  // handful of cells, they land on the drawing rather than beside it, and a
  // wrong roof or an off-by-one in the crossing test simply produces none.
  let n = 0, on = 0;
  const drawn = (x, y) => base.frames.some(f => f.grid[y][x]);
  for (const f of frames)
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++)
        if (f.grid[y][x] === TIER[2] && drawn(x, y)) { n++; }
  for (const f of frames) {
    let any = false;
    for (let y = 0; y < GRID && !any; y++)
      for (let x = 0; x < GRID; x++)
        if (f.grid[y][x] === TIER[2] && drawn(x, y)) { any = true; break; }
    if (any) on++;
  }
  console.log(`  beads      ${n} landing on the drawing, in ${on} of ${FRAMES} frames`);
}
console.log(`  seam       ${SEAM}`);
console.log(`  palette    ${base.palette.length} -> ${palette.length}`);
console.log(`  flash      ${(FRAMES * GRID * GRID / 1024).toFixed(1)} KB`);

if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, out.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 0));
  console.log(`  wrote      ${path.relative(process.cwd(), f)}`);
}

if (PREVIEW) {
  const tmp = path.join(require('os').tmpdir(), `rain-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(out));
  const { execFileSync } = require('child_process');
  execFileSync('node', [path.join(__dirname, 'preview_anim.js'), tmp, '--out', PREVIEW],
               { stdio: 'inherit' });
  fs.unlinkSync(tmp);
}
