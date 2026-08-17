#!/usr/bin/env node
/**
 * Generates tools/drawn_anims/moon_phases.json — one 20x20 frame per lunar
 * phase, in the order the firmware indexes them.
 *
 *   node tools/make_moon_phases.js [--preview out.png]
 *
 * Generated rather than drawn, because a phase is geometry. The boundary
 * between lit and unlit is the projection of a circle seen edge-on, so it is
 * an ellipse that narrows to a straight line at the quarters — a shape that is
 * hard to place by eye at 20 cells across and trivial to compute. Everything
 * else in tools/drawn_anims/ is Nova's drawing; this one is arithmetic, and
 * committing it as a generator rather than as opaque pixels is the honest way
 * to say so.
 *
 * WHICH SIDE IS LIT — the thing that is easy to get backwards. In the northern
 * hemisphere a waxing moon is lit on its RIGHT and a waning moon on its LEFT.
 * (South of the equator both are mirrored; nothing here is hemisphere-aware,
 * and the device has no idea where it is. If Clawdmeter ever ships south, this
 * is the file that has to learn about latitude.)
 *
 * The unlit part is drawn as a dark disc rather than left transparent, so the
 * moon is always a whole circle and a thin crescent still reads as a moon
 * instead of as a stray mark. New moon is therefore a dark disc, which is also
 * how it looks in the sky: present, not absent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const N = 20;                 // grid side; must be one of GRID_SIZES
const R = 8.6;                // disc radius in cells — see the legibility note below
const CX = (N - 1) / 2;
const CY = (N - 1) / 2;

// Sampled at the centre of each phase bucket the firmware uses, so the drawing
// shows the middle of what it stands for rather than its edge.
const PHASES = [
  { p: 0.000, name: 'new moon' },
  { p: 0.125, name: 'waxing crescent' },
  { p: 0.250, name: 'first quarter' },
  { p: 0.375, name: 'waxing gibbous' },
  { p: 0.500, name: 'full moon' },
  { p: 0.625, name: 'waning gibbous' },
  { p: 0.750, name: 'last quarter' },
  { p: 0.875, name: 'waning crescent' },
];

// Index 0 is transparent by convention. 1 = sunlit, 2 = earthshine side.
// The lit colour is a warm off-white rather than pure white: the panel is
// AMOLED and pure white next to the terracotta creature reads as a hole.
const PALETTE = ['transparent', '#F2E8C8', '#3A3A46'];

// Supersampled 4x4 per cell. A circle quantised to 20 cells has a visibly
// blocky rim if each cell is decided by its centre alone; taking the majority
// of 16 samples keeps the disc round and, more importantly, keeps the
// terminator from jumping a whole cell between adjacent rows.
const SUB = 4;

// Where to put the terminator.
//
//   true    xt = cos(2*pi*p) * halfWidth — the actual projected ellipse
//   spread  xt spaced evenly between the two limbs
//
// They differ only for the crescents and gibbous phases (0.707 vs 0.5 of the
// radius), but that difference is the whole ballgame at icon size: the dark
// part of a true gibbous is a 2.5-cell sliver hugging the rim, where the disc
// is at its narrowest, so it reads as a jagged edge rather than as a phase.
// Three of the eight frames then look like the same full moon.
//
// Evenly spaced is what small phase icons conventionally do. It overstates how
// much of a crescent is lit and understates a gibbous; it is a diagram, not an
// ephemeris, and its one job is to say which of eight things this is.
const SPREAD = !process.argv.includes('--true-geometry');

function frameFor(p) {
  const theta = 2 * Math.PI * p;
  const waxing = p <= 0.5;
  const grid = Array.from({ length: N }, () => Array(N).fill(0));

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      let inside = 0, lit = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x = gx + (sx + 0.5) / SUB - 0.5 - CX;
          const y = gy + (sy + 0.5) / SUB - 0.5 - CY;
          if (x * x + y * y > R * R) continue;
          inside++;
          // Half-width of the disc on this row: the terminator is that
          // half-width scaled by cos(theta), which is +R at new moon (the
          // whole disc dark), 0 at the quarters (a straight edge) and -R at
          // full (the whole disc lit).
          const halfW = Math.sqrt(Math.max(0, R * R - y * y));
          const c = SPREAD ? (1 - 4 * (waxing ? p : 1 - p)) : Math.cos(theta);
          const xt = (waxing ? 1 : -1) * c * halfW;
          if (waxing ? x >= xt : x <= xt) lit++;
        }
      }
      if (!inside) continue;
      const total = SUB * SUB;
      if (inside * 2 < total) continue;              // mostly outside the disc
      grid[gy][gx] = (lit * 2 >= inside) ? 1 : 2;    // majority of the disc part
    }
  }
  return grid;
}

const frames = PHASES.map(ph => ({
  // Held long and never played: the firmware pins one frame by phase rather
  // than animating. The value only matters because the format requires one and
  // convert_to_c.js refuses anything under HOLD_MIN_MS.
  hold: 1000,
  grid: frameFor(ph.p),
}));

const doc = {
  name: 'moon phases',
  category: 'Weather',
  description:
    'Generated by tools/make_moon_phases.js — one frame per lunar phase, in ' +
    'firmware index order (0 new … 7 waning crescent). Northern-hemisphere ' +
    'orientation: waxing lit on the right, waning on the left. Not an ' +
    'animation: the weather screen pins a single frame from the Open-Meteo ' +
    'moon_phase fraction. Deliberately absent from every rate group in ' +
    'splash.cpp, so nothing ever plays it as a splash.',
  palette: PALETTE,
  frames,
};

const OUT = path.join(__dirname, 'drawn_anims', 'moon_phases.json');
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${frames.length} frames, ${N}x${N}`);

// Text contact sheet, always. The whole risk with a generated shape is that it
// is geometrically right and visually wrong, and the cheapest way to see that
// is to look at it before anything downstream runs.
const CH = { 0: ' ', 1: '#', 2: '.' };
for (let i = 0; i < frames.length; i++) {
  const litCells = frames[i].grid.flat().filter(v => v === 1).length;
  const discCells = frames[i].grid.flat().filter(v => v !== 0).length;
  console.log(`\n[${i}] ${PHASES[i].name}  (p=${PHASES[i].p}, lit ${Math.round(litCells / discCells * 100)}% of the disc)`);
  for (const row of frames[i].grid) console.log('   ' + row.map(v => CH[v]).join(''));
}
