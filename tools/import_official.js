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

const GRID = 60;
const STAGE_W = 55, STAGE_H = 37;
const ANCHOR_X = (GRID - STAGE_W) >> 1;   // 2   — matches STAGE_ANCHOR_X
const ANCHOR_Y = (GRID - STAGE_H) >> 1;   // 11  — matches STAGE_ANCHOR_Y

if (!GRID_SIZES.includes(GRID)) {
  console.error(`tools/lib/format.js does not list ${GRID} in GRID_SIZES; add it first.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const has = k => args.includes(k);

const OUT_DIR = path.resolve(opt('--out', path.join(__dirname, 'official_anims')));
const REF = opt('--ref', 'origin/main');
const SRC = opt('--in', null);

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

// Where compose_stage() actually puts the art. The horizontal edge snaps are
// upstream's: art touching its stage edge was drawn to hang off the screen edge
// (lurking peeks in from the left), so it goes to the true edge, not the
// anchored one. Not applied vertically.
function originX(a) {
  if (a.ox === 0) return 0;
  if (a.ox + a.w === STAGE_W) return GRID - a.w;
  return ANCHOR_X + a.ox;
}

function convert(a) {
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

  const ax = originX(a), ay = ANCHOR_Y + a.oy;
  const frames = [];
  for (let f = 0; f < a.frameCount; f++) {
    const grid = Array.from({length: GRID}, () => new Array(GRID).fill(0));
    for (let r = 0; r < a.h; r++) {
      const y = ay + r;
      if (y < 0 || y >= GRID) continue;
      for (let c = 0; c < a.w; c++) {
        const x = ax + c;
        if (x < 0 || x >= GRID) continue;
        grid[y][x] = cells[(f * a.h + r) * a.w + c];
      }
    }
    frames.push({ hold: holds[f], grid });
  }

  return {
    name: a.name,
    category: 'Official',
    description:
      `Imported from upstream ${a.cat} art by tools/import_official.js. ` +
      `Crop ${a.w}x${a.h} at stage (${a.ox},${a.oy}), placed at grid (${ax},${ay}). ` +
      `Upstream loops frames ${a.loopStart}..${a.loopEnd} and holds that region ~6s; ` +
      `our engine loops the whole file, so the intro and outro replay every pass.`,
    palette,
    frames,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────
if (has('--list')) {
  console.log(`${anims.length} animations in ${SRC || REF}:\n`);
  for (const a of anims) {
    const bytes = a.frameCount * GRID * GRID;
    console.log(`  ${a.name.padEnd(16)} ${a.cat.padEnd(8)} ${String(a.frameCount).padStart(3)} frames  ` +
                `crop ${(a.w + 'x' + a.h).padEnd(7)} pal ${String(a.paletteCount).padStart(2)}  ` +
                `${(bytes / 1024).toFixed(0).padStart(4)} KB at 60x60`);
  }
  const total = anims.reduce((s, a) => s + a.frameCount * GRID * GRID, 0);
  console.log(`\n  all of them: ${(total / 1024).toFixed(0)} KB of flash at 60x60 ` +
              `(they cost ${(anims.reduce((s, a) => s + a.frameCount * a.w * a.h, 0) / 1024).toFixed(0)} KB as crops upstream)`);
  process.exit(0);
}

const wanted = has('--all') ? anims
             : anims.filter(a => a.name === opt('--name', null));

if (!wanted.length) {
  const want = opt('--name', null);
  console.error(want ? `No animation named "${want}". Try --list.`
                     : 'Pass --name "<animation>", --all, or --list.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let bytes = 0;
for (const a of wanted) {
  const out = convert(a);
  const file = path.join(OUT_DIR, a.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const b = out.frames.length * GRID * GRID;
  bytes += b;
  console.log(`${path.relative(process.cwd(), file)}  ${out.frames.length} frames, ` +
              `${out.palette.length} colours, ${(b / 1024).toFixed(0)} KB of flash if shipped`);
}
console.log(`\n${wanted.length} written to ${path.relative(process.cwd(), OUT_DIR)}/ ` +
            `(${(bytes / 1024).toFixed(0)} KB total).`);
console.log('These are templates: open one in the editor, draw into the empty grid,');
console.log('and export to tools/drawn_anims/ — this directory is not compiled in.');
