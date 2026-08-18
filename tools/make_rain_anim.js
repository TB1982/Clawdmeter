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

const GRID = 60;

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
const SPEED = 3;           // cells per frame; 3 x 20 frames = the 60-cell grid
const P1 = 7, P2 = 11;     // coprime, per the craft note
const PHI = 0.6180339887;  // for spreading drops inside a column
const MAX_PER_ROW = Math.round(GRID / 20 * 2);   // Nova's "never three", as a fraction of the row

// The three Nova mixed for "rainy days", in her proportions.
const TIER_HEX = ['#5B93B0', '#99E6FF', '#E0F7FF'];   // far, mid, near

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const BASE    = opt('--base', null);
const NAME    = opt('--name', null);
const OUT     = opt('--out', null);
const PREVIEW = opt('--preview', null);
const FRAMES_ARG = argv.includes('--frames') ? parseInt(opt('--frames', ''), 10) : null;

if (!BASE) {
  console.error('node tools/make_rain_anim.js --base "<animation>" [--name "<new name>"]');
  console.error('  --frames N     output frames (default: derived from the base)');
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
const side = base.frames[0].grid.length;
if (side !== GRID) {
  console.error(`"${BASE}" is ${side}x${side}. Rain is drawn on the ${GRID}-cell stage, ` +
                `which is where the other weather creatures live — a ${side}-cell drawing ` +
                `would render at a different size beside them.`);
  process.exit(1);
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
const closes = (T) => (SPEED * T) % GRID === 0;

let FRAMES, FRAME_MS;
if (FRAMES_ARG) {
  FRAMES = FRAMES_ARG;
  if (!closes(FRAMES)) { console.error(`--frames ${FRAMES} leaves a drop mid-fall at the loop point`); process.exit(1); }
  if (baseLoopMs % FRAMES !== 0) { console.error(`--frames ${FRAMES} does not divide the base's ${baseLoopMs} ms`); process.exit(1); }
  FRAME_MS = baseLoopMs / FRAMES;
} else {
  // Nearest workable cadence to TARGET_MS. Rain at 500 ms a frame is a slide
  // show; at 20 it is a blur and costs frames nothing can see.
  const TARGET_MS = 85;
  const cands = [];
  for (let T = 1; T <= 400; T++) {
    if (!closes(T)) continue;
    if (baseLoopMs % T !== 0) continue;
    const ms = baseLoopMs / T;
    if (ms < HOLD_MIN_MS) continue;
    cands.push({ T, ms });
  }
  if (!cands.length) {
    console.error(`No frame count both closes the rain loop and divides the base's ` +
                  `${baseLoopMs} ms. The holds would have to change; their sum needs a ` +
                  `divisor that is a multiple of ${GRID / Math.min(...speeds)}.`);
    process.exit(1);
  }
  cands.sort((a, b) => Math.abs(a.ms - TARGET_MS) - Math.abs(b.ms - TARGET_MS));
  ({ T: FRAMES, ms: FRAME_MS } = cands[0]);
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
  if (h < -0.8) continue;                        // this column stays dry
  // How many drops are falling in this column, 3 to 6. More than it sounds like
  // it should be: the shelter rule removes every drop that would land under the
  // creature or his leaf, and the never-three pass removes more, so what is
  // placed and what is seen differ by about half. The summary prints both.
  const n = 3 + Math.round(((h + 0.8) / 2.8) * 3);
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
  for (let k = 0; k < n; k++) { f = (f + PHI) % 1; offsets.push(Math.floor(f * GRID)); }
  COLUMNS.push({ x, offsets, tier: 0 });
}

// Brightness by rank rather than by threshold, on a fourth and fifth period.
//
// Thresholds on the same wave that chose the column gave 16 near against 11
// far — inverted, and inverted is the visible half of the mistake. The ratio is
// the point: "rainy days" has 126 dim cells to 81 mid to 42 bright, so the
// front layer is the rare one. Ranking guarantees that whatever the sines do;
// ranking on *different* periods keeps the bright ones from bunching, which a
// threshold on the same wave cannot avoid.
{
  const order = COLUMNS
    .map(c => ({ c, t: Math.sin(2 * Math.PI * c.x / 17) + Math.sin(2 * Math.PI * c.x / 19) }))
    .sort((a, b) => b.t - a.t);
  const near = Math.round(order.length / 6);
  const mid  = Math.round(order.length / 3);
  order.forEach((o, i) => { o.c.tier = i < near ? 2 : i < near + mid ? 1 : 0; });
}

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
  const placed = [];
  for (const c of COLUMNS) {
    for (const o of c.offsets) {
      const y = (o + i * SPEED) % GRID;
      if (y >= roof[c.x]) continue;              // sheltered
      if (grid[y][c.x]) continue;
      placed.push({ x: c.x, y, tier: c.tier });
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
  for (const row of byRow.values()) {
    if (row.length <= MAX_PER_ROW) continue;
    row.sort((a, b) => b.tier - a.tier || a.x - b.x);
    row.length = MAX_PER_ROW;
  }
  for (const row of byRow.values())
    for (const d of row) grid[d.y][d.x] = TIER[d.tier];

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
