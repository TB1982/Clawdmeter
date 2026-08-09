#!/usr/bin/env node
/**
 * Renders any animation JSON to a contact-sheet PNG so it can be judged without
 * hardware — and, more to the point, without a human being asked to look.
 *
 * Two scales in one image, because they fail differently:
 *   top    — splash scale, big enough to read the drawing
 *   bottom — 4 px/cell, the corner badge on the usage screen
 * A shape that reads at 24 px/cell can turn to mush at 4, and that is not
 * visible at any single scale. `anim_editor.html` shows both for the same
 * reason; this is the same check from the command line.
 *
 * Colours are shown the way the device shows them: the claudepix body tint is
 * remapped to brand terracotta and every colour is quantised to RGB565, so two
 * hexes that collapse to the same 16-bit value look identical here too.
 *
 * Usage:
 *   node preview_anim.js <file.json|name> [...]   one sheet per animation
 *   node preview_anim.js --all                    the whole catalogue
 *   node preview_anim.js "work think" --cell 12   bigger splash block
 *
 * Options: --out DIR (default tools/preview/), --cell N (default 8), --cols N
 *          (default 8), --badge N (default 4)
 */

const fs = require('fs');
const path = require('path');
const { writeRgbPng } = require('./lib/png');

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const flag = k => args.includes(k);

// Same order and meaning as convert_to_c.js: later directories override earlier
// ones by animation name, so previewing "work think" must show the drawn
// version that actually ships, not the scraped one it replaced.
const IN_DIRS = ['claudepix_data', 'custom_anims', 'drawn_anims', 'drawn_anims_40']
  .map(d => path.resolve(__dirname, d));

const OUT_DIR = path.resolve(opt('--out', path.join(__dirname, 'preview')));
const CELL = parseInt(opt('--cell', '8'), 10);
const COLS = parseInt(opt('--cols', '8'), 10);
const BADGE = parseInt(opt('--badge', '4'), 10);
const GUTTER = [0x3a, 0x3a, 0x3a];

// Kept in step with convert_to_c.js by hand — it is the authority, this is a
// viewer. If they ever disagree, the converter is right.
const TINT_OVERRIDE = { '#cd7f6a': '#d97757' };

function toRgb(hex) {
  if (!hex || hex === 'transparent') return [0, 0, 0];   // the panel is black
  const ov = TINT_OVERRIDE[hex.toLowerCase()];
  if (ov) hex = ov;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  // Round-trip through RGB565 so the preview can't show a distinction the
  // panel can't.
  return [(r >> 3) << 3, (g >> 2) << 2, (b >> 3) << 3];
}

function collect() {
  const byName = new Map();
  for (const dir of IN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.startsWith('_'))) {
      const file = path.join(dir, f);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.name) byName.set(data.name, { file, data });
    }
  }
  return byName;
}

function load(arg) {
  if (arg.endsWith('.json')) {
    const file = path.resolve(arg);
    if (!fs.existsSync(file)) { console.error(`no such file: ${arg}`); process.exit(1); }
    return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  const hit = collect().get(arg);
  if (!hit) {
    console.error(`no animation named "${arg}". Known names:`);
    for (const n of [...collect().keys()].sort()) console.error(`  ${n}`);
    process.exit(1);
  }
  return hit;
}

// Deliberately thin. convert_to_c.js does the real validation and fails the
// build; this only has to avoid rendering garbage as if it were art.
function check(data, where) {
  const die = m => { console.error(`${where}: ${m}`); process.exit(1); };
  if (!Array.isArray(data.palette) || !data.palette.length) die('missing "palette"');
  if (!Array.isArray(data.frames) || !data.frames.length) die('no frames');
  const side = data.frames[0]?.grid?.length;
  if (!side) die('frame 0: missing "grid"');
  data.frames.forEach((f, i) => {
    if (!Array.isArray(f.grid) || f.grid.length !== side)
      die(`frame ${i}: grid has ${f.grid?.length} rows, frame 0 has ${side}`);
    f.grid.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== side)
        die(`frame ${i} row ${r}: ${row?.length} cells, expected ${side}`);
      row.forEach((v, c) => {
        if (!Number.isInteger(v) || v < 0 || v >= data.palette.length)
          die(`frame ${i} cell ${r},${c}: ${v} is not an index into a ${data.palette.length}-entry palette`);
      });
    });
  });
  return side;
}

function blockSize(frames, side, cell, cols, pad) {
  const tile = side * cell;
  const rows = Math.ceil(frames / cols);
  return {
    tile, rows,
    w: pad + cols * (tile + pad),
    h: pad + rows * (tile + pad),
  };
}

function paintBlock(img, W, frames, pal, side, cell, cols, pad, oy) {
  const tile = side * cell;
  frames.forEach((f, i) => {
    const tx = pad + (i % cols) * (tile + pad);
    const ty = oy + pad + Math.floor(i / cols) * (tile + pad);
    for (let gy = 0; gy < side; gy++) {
      for (let gx = 0; gx < side; gx++) {
        const [r, g, b] = pal[f.grid[gy][gx]] || [0, 0, 0];
        for (let dy = 0; dy < cell; dy++) {
          const y = ty + gy * cell + dy;
          let o = (y * W + tx + gx * cell) * 3;
          for (let dx = 0; dx < cell; dx++) {
            img[o] = r; img[o + 1] = g; img[o + 2] = b; o += 3;
          }
        }
      }
    }
  });
}

function render(file, data) {
  const where = path.relative(process.cwd(), file);
  const side = check(data, where);
  const pal = data.palette.map(toRgb);
  const pad = 6;

  // Badge row runs wider: at 4 px/cell a 20x20 frame is 80 px, so the whole
  // loop fits on one or two rows and reads as a filmstrip.
  const badgeCols = Math.min(data.frames.length, Math.max(COLS, 16));
  const a = blockSize(data.frames.length, side, CELL, COLS, pad);
  const b = blockSize(data.frames.length, side, BADGE, badgeCols, pad);

  const W = Math.max(a.w, b.w);
  const H = a.h + b.h;
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    img[i * 3] = GUTTER[0]; img[i * 3 + 1] = GUTTER[1]; img[i * 3 + 2] = GUTTER[2];
  }

  paintBlock(img, W, data.frames, pal, side, CELL, COLS, pad, 0);
  paintBlock(img, W, data.frames, pal, side, BADGE, badgeCols, pad, a.h);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${data.name.replace(/[^a-z0-9]+/gi, '_')}.png`);
  writeRgbPng(out, W, H, img);

  const total = data.frames.reduce((s, f) => s + f.hold, 0);
  const holds = data.frames.map(f => f.hold);
  console.log(`${data.name}  [${where}]`);
  console.log(`  ${side}x${side}, ${data.frames.length} frames, ${data.palette.length} palette entries`);
  console.log(`  loop ${(total / 1000).toFixed(2)}s   holds ${Math.min(...holds)}-${Math.max(...holds)} ms`);
  console.log(`  ${path.relative(process.cwd(), out)}  (${W}x${H}, top ${CELL}px/cell, bottom ${BADGE}px/cell)`);
  return out;
}

const targets = args.filter(a => !a.startsWith('--'))
  .filter((a, i, arr) => {
    // Drop values consumed by options: anything directly after a --flag.
    const prev = args[args.indexOf(a) - 1];
    return !['--out', '--cell', '--cols', '--badge'].includes(prev);
  });

if (flag('--all')) {
  const all = collect();
  console.log(`Previewing ${all.size} animations → ${path.relative(process.cwd(), OUT_DIR)}/\n`);
  for (const { file, data } of all.values()) render(file, data);
} else if (targets.length) {
  for (const t of targets) { const { file, data } = load(t); render(file, data); }
} else {
  console.error('usage: node preview_anim.js <file.json|name> [...] | --all');
  console.error('       --out DIR  --cell N  --cols N  --badge N');
  process.exit(1);
}
