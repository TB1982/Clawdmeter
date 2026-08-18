#!/usr/bin/env node
/**
 * Move an animation onto the smallest grid its drawing fits in.
 *
 *   node tools/recrop_anim.js --name "sunny"                 # what it would do
 *   node tools/recrop_anim.js --name "sunny" --write         # do it
 *   node tools/recrop_anim.js --all                          # survey everything
 *
 * From docs/animation-craft.md: "the grid is a resolution, not a canvas size:
 * the panel is 480 px either way, so fewer cells means each one is larger. Pick
 * the smallest grid the art fits in, not the largest the pipeline allows."
 *
 * A crop, never a rescale. Every cell keeps its value and its neighbours; only
 * the empty border changes. 60 to 40 is a factor of 1.5 and a fractional
 * rescale is a redraw, so a drawing that does not fit is refused rather than
 * squeezed.
 *
 * The floor margin is kept at side/5, which is where the imported official art
 * stands and what makes a creature read as standing somewhere rather than
 * balanced on the last pixel row of a panel with rounded corners.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { GRID_SIZES } = require('./lib/format');

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const NAME  = opt('--name', null);
const GRID  = argv.includes('--grid') ? parseInt(opt('--grid', ''), 10) : null;
const WRITE = argv.includes('--write');
const ALL   = argv.includes('--all');

if (!NAME && !ALL) {
  console.error('node tools/recrop_anim.js --name "<animation>" [--grid N] [--write]');
  console.error('node tools/recrop_anim.js --all');
  process.exit(2);
}

const DIRS = ['drawn_anims', 'official_anims', 'custom_anims'];

function* animations() {
  for (const d of DIRS) {
    const dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.startsWith('_'))) {
      const p = path.join(dir, f);
      let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (j && j.name && j.frames && j.frames[0] && j.frames[0].grid) yield { j, p };
    }
  }
}

function bbox(j) {
  const side = j.frames[0].grid.length;
  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  for (const f of j.frames) f.grid.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }));
  return { side, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function recrop(j, want) {
  const b = bbox(j);
  const ox = Math.floor((want - b.w) / 2) - b.x0;
  const oy = (want - Math.round(want / 5) - b.h) - b.y0;
  j.frames = j.frames.map(f => {
    const g = Array.from({ length: want }, () => new Array(want).fill(0));
    for (let y = 0; y < b.side; y++)
      for (let x = 0; x < b.side; x++) {
        const ny = y + oy, nx = x + ox;
        if (ny >= 0 && ny < want && nx >= 0 && nx < want) g[ny][nx] = f.grid[y][x];
      }
    return { hold: f.hold, grid: g };
  });
  return j;
}

if (ALL) {
  console.log('animation'.padEnd(20) + 'grid'.padEnd(7) + 'drawing'.padEnd(10) + 'smallest that fits');
  for (const { j } of animations()) {
    const b = bbox(j);
    const fits = GRID_SIZES.find(g => g >= b.w && g >= b.h);
    const note = !fits ? 'none' : fits === b.side ? '—' : `${fits} (${(b.side / fits).toFixed(2)}x bigger on the panel)`;
    console.log(String(j.name).padEnd(20) + `${b.side}`.padEnd(7) + `${b.w}x${b.h}`.padEnd(10) + note);
  }
  process.exit(0);
}

const found = [...animations()].find(a => a.j.name === NAME);
if (!found) { console.error(`No animation named "${NAME}".`); process.exit(1); }
const b = bbox(found.j);
const want = GRID || GRID_SIZES.find(g => g >= b.w && g >= b.h);
if (!want) { console.error(`${b.w}x${b.h} fits none of ${GRID_SIZES.join('/')}.`); process.exit(1); }
if (want < b.w || want < b.h) {
  console.error(`the drawing is ${b.w}x${b.h} and will not fit a ${want}-cell grid. ` +
                `Cropping cannot make it smaller — that is a redraw.`);
  process.exit(1);
}

console.log(`${NAME}: ${b.side}x${b.side}, drawing ${b.w}x${b.h}`);
if (want === b.side) { console.log(`  already on the smallest grid it fits`); process.exit(0); }
console.log(`  -> ${want}x${want}   each cell ${(b.side / want).toFixed(2)}x larger on the panel, ` +
            `frame ${(want * want / (b.side * b.side) * 100).toFixed(0)}% of the bytes`);

if (!WRITE) { console.log('  (pass --write to apply)'); process.exit(0); }
recrop(found.j, want);
fs.writeFileSync(found.p, JSON.stringify(found.j, null, 0));
console.log(`  wrote ${path.relative(process.cwd(), found.p)}`);
