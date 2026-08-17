#!/usr/bin/env node
/**
 * Generates tools/drawn_anims/coin_rain.json — falling coins, each spinning as
 * it drops.
 *
 *   node tools/make_coin_rain.js [--frames N] [--grid N] [--coins N]
 *
 * Composed rather than drawn, like the coin and the moon before it: the shape
 * of a turning disc is arithmetic, and so is where a falling thing is on frame
 * n. What is a design decision — the gold, how many coins, how dense it feels —
 * is exposed as constants and flags rather than buried.
 *
 * 40x40 rather than 20x20. At 20 cells a coin small enough to rain is three
 * cells across, and a three-cell disc spinning is a flicker rather than a spin.
 * At 40 a coin is seven cells and the turn actually reads. It costs 1,600 bytes
 * a frame against 400 — affordable now the 2.16 has its whole flash.
 *
 * The loop is seamless: every coin falls exactly the grid height over the full
 * frame count and wraps, and each one's spin completes a whole number of turns,
 * so the last frame hands back to the first with nothing jumping.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, def) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};

const N = arg('--grid', 40);
const FRAMES = arg('--frames', 16);
const COINS = arg('--coins', 14);
const SUB = 3;

// Same gold as market_coin, which took it from `expression wink`, in three
// depths. Nearer coins are bigger, brighter and drawn last; further ones are
// smaller and dimmer. Without that a shower of identical discs reads as a flat
// pattern rather than as something falling past you.
//
// The dim tiers are derived from the base rather than typed out, so changing
// the gold changes all three together instead of leaving two of them behind.
const BASE = ['#FFD24D', '#FFE699', '#FFD98A'];        // rim, face, inner
const dim = (hex, k) => '#' + [1, 3, 5]
  .map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k))
  .map(v => Math.min(255, v).toString(16).padStart(2, '0'))
  .join('').toUpperCase();

// depth 0 = furthest. Radius, brightness, and how many coins sit at that depth.
const DEPTHS = [
  { r: 2.3, k: 0.42 },   // far
  { r: 3.2, k: 0.68 },   // mid
  { r: 4.3, k: 1.00 },   // near
];
const PALETTE = ['transparent', ...DEPTHS.flatMap(d => BASE.map(c => dim(c, d.k)))];
// Index of a depth's rim entry; face and inner follow it.
const base_of = depth => 1 + depth * 3;
const RIM_FRAC = 0.58, INNER_FRAC = 0.30;

// Fixed layout rather than random: a generator that produces a different
// animation every run cannot be reviewed, and "run it again until it looks
// right" is not a thing a committed file should depend on. Columns are spread
// unevenly on purpose — evenly spaced coins read as a machine, not as rain.
// spins: whole turns over the loop, so the coin is back where it started.
// depth: 0 furthest .. 2 nearest — sets size, brightness and draw order.
const LANES = [
  { x: 0.08, y0: 0.00, spins: 2, depth: 0 },
  { x: 0.21, y0: 0.62, spins: 3, depth: 2 },
  { x: 0.33, y0: 0.28, spins: 2, depth: 1 },
  { x: 0.44, y0: 0.81, spins: 3, depth: 0 },
  { x: 0.56, y0: 0.14, spins: 2, depth: 2 },
  { x: 0.67, y0: 0.47, spins: 3, depth: 2 },
  { x: 0.78, y0: 0.92, spins: 2, depth: 2 },
  { x: 0.88, y0: 0.35, spins: 3, depth: 2 },
  { x: 0.97, y0: 0.70, spins: 2, depth: 1 },
  { x: 0.14, y0: 0.41, spins: 3, depth: 2 },
  { x: 0.27, y0: 0.88, spins: 2, depth: 1 },
  { x: 0.39, y0: 0.05, spins: 3, depth: 2 },
  { x: 0.50, y0: 0.55, spins: 2, depth: 1 },
  { x: 0.61, y0: 0.23, spins: 3, depth: 2 },
  { x: 0.72, y0: 0.74, spins: 2, depth: 2 },
  { x: 0.83, y0: 0.11, spins: 3, depth: 2 },
].slice(0, COINS);

function stamp(grid, cx, cy, turn, depth) {
  const R = DEPTHS[depth].r;
  const pal = base_of(depth);
  const w = Math.abs(Math.cos(turn * 2 * Math.PI));
  const halfW = Math.max(0.5, R * w);
  const x0 = Math.max(0, Math.floor(cx - halfW - 1));
  const x1 = Math.min(N - 1, Math.ceil(cx + halfW + 1));
  const y0 = Math.max(0, Math.floor(cy - R - 1));
  const y1 = Math.min(N - 1, Math.ceil(cy + R + 1));

  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      let rim = 0, face = 0, inner = 0, n = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x = (gx + (sx + 0.5) / SUB - 0.5 - cx) / halfW;
          const y = (gy + (sy + 0.5) / SUB - 0.5 - cy) / R;
          const d = Math.sqrt(x * x + y * y);
          if (d > 1) continue;
          n++;
          if (d > RIM_FRAC) rim++;
          else if (d > INNER_FRAC) face++;
          else inner++;
        }
      }
      const total = SUB * SUB;
      if (!n || n * 2 < total) continue;
      // Later coins draw over earlier ones rather than blending; overlapping
      // coins in a shower read fine as one in front of another.
      grid[gy][gx] = pal + ((rim >= face && rim >= inner) ? 0
                          : (face >= inner) ? 1 : 2);
    }
  }
}

function frameFor(f) {
  const t = f / FRAMES;
  const grid = Array.from({ length: N }, () => Array(N).fill(0));
  // Furthest first, so nearer coins overwrite them and the overlap reads as
  // one passing in front of another rather than as a collision.
  for (const lane of [...LANES].sort((a, b) => a.depth - b.depth)) {
    const R = DEPTHS[lane.depth].r;
    const cx = lane.x * (N - 1);
    // Wrap through a span of N + 2R so a coin leaves the bottom completely
    // before its copy enters at the top, instead of being sliced in two.
    // Nearer coins cover that span more times per loop: parallax is what sells
    // depth, more than size or brightness do.
    const span = N + 2 * R;
    const passes = lane.depth + 1;
    const cy = ((lane.y0 + t * passes) % 1) * span - R;
    stamp(grid, cx, cy, t * lane.spins, lane.depth);
  }
  return grid;
}

const frames = Array.from({ length: FRAMES }, (_, i) => ({
  hold: 80,
  grid: frameFor(i),
}));

const doc = {
  name: 'coin rain',
  category: 'Stocks',
  description:
    'Generated by tools/make_coin_rain.js — coins falling and spinning, on a ' +
    'seamless loop (every coin falls a whole grid height and turns a whole ' +
    'number of times over the loop). 40x40 so a raining coin is still big ' +
    'enough for its spin to read. Same gold as `market coin`. Not in any rate ' +
    'group: it plays on a trigger, not at random.',
  palette: PALETTE,
  frames,
};

const OUT = path.join(__dirname, 'drawn_anims', 'coin_rain.json');
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${FRAMES} frames, ${N}x${N}, ${LANES.length} coins`);
console.log(`flash cost: ${(FRAMES * N * N / 1024).toFixed(1)} KB`);
