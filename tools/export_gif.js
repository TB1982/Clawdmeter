#!/usr/bin/env node
/**
 * Exports an animation to formats something other than this firmware can open:
 * an animated GIF, a PNG frame sequence, or a single still PNG.
 *
 * Written so an animation can leave the board — shown to someone who doesn't
 * have one, used as a phone wallpaper, or fed to a watch-face tool that wants a
 * picture rather than a C array.
 *
 * GIF is not a compromise here, it is the same data model. Our animations are
 * "a palette of at most 36 colours plus one index per cell"; a GIF is "a colour
 * table of at most 256 colours plus one index per pixel". So the export is a
 * remap, not a conversion: no quantisation, no dithering, no colour drift.
 * Frame holds land in the GIF's own per-frame delay, so the timing on screen is
 * the timing on the device.
 *
 *   node tools/export_gif.js                       Nova's own drawings
 *   node tools/export_gif.js hanabi "rainy days"   named animations
 *   node tools/export_gif.js --all                 everything in the catalogue
 *
 * Options:
 *   --out DIR        where to write            (default tools/export/)
 *   --cell N         pixels per cell           (default: whatever makes 480 px,
 *                    i.e. exactly the size the 480x480 panel draws it at)
 *   --bg RRGGBB      background                (default 000000)
 *   --transparent    leave the background clear instead of painting --bg
 *   --canvas WxH     letterbox onto this canvas, e.g. a watch face
 *   --anchor T       top | middle | bottom on that canvas   (default bottom)
 *   --frames         also write frame-0001.png, frame-0002.png, ...
 *   --still N        write one PNG of frame N and no GIF
 *   --rgba           write 32-bit PNGs instead of 24-bit (see writeImage below)
 *
 * On --bg: the default is black on purpose and is not a neutral choice. Every
 * animation here was drawn against an unlit AMOLED, so light colours are used
 * freely and "empty" means black rather than white. Exported onto white, the
 * pale props in `waiting` and `space` disappear entirely. --transparent has the
 * same hazard the moment the viewer has a light background, which is why it is
 * opt-in rather than the default.
 */

const fs = require('fs');
const path = require('path');
const { writeRgbPng, writeRgbaPng } = require('./lib/png');

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const flag = k => args.includes(k);

// Same order and later-wins rule as convert_to_c.js, so what is exported is the
// version that actually ships rather than a scrape it replaced.
const IN_DIRS = ['claudepix_data', 'custom_anims', 'drawn_anims', 'official_anims']
  .map(d => path.resolve(__dirname, d));

// Nova's own drawings — the default selection, and the only ones that are hers
// to hand to someone outside this project. The rest of the catalogue is
// Anthropic's official art (official_anims/) or claudepix's (claudepix_data/,
// custom_anims/), and exporting those to give away is a different question from
// running them on our own board.
//
// Listed by hand because authorship is not a property of a directory: drawn_anims/
// holds both Nova's originals and her edits to scraped animations. If a name here
// ever stops being hers, or a new drawing of hers is added, this is the line to
// change — nothing derives it.
const MINE = [
  'swim summer', 'rainy days', 'hanabi', 'waiting', 'space',
  'work out', 'work mode', 'surfing', 'this is fine', 'opening',
];

// Kept in step with convert_to_c.js by hand — that file is the authority, this
// is an exporter. Same posture as preview_anim.js.
const TINT_OVERRIDE = { '#cd7f6a': '#d97757' };

function toRgb(hex) {
  if (!hex || hex === 'transparent') return [0, 0, 0];
  const ov = TINT_OVERRIDE[hex.toLowerCase()];
  if (ov) hex = ov;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  // Round-tripped through RGB565 like preview_anim.js does, so a GIF sent to
  // someone shows the colours the panel shows, not the ones the JSON names.
  return [
    ((parseInt(h.substr(0, 2), 16) >> 3) << 3),
    ((parseInt(h.substr(2, 2), 16) >> 2) << 2),
    ((parseInt(h.substr(4, 2), 16) >> 3) << 3),
  ];
}

function collect() {
  const byName = new Map();
  for (const dir of IN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (data.name && data.frames && data.palette) byName.set(data.name, data);
    }
  }
  return byName;
}

// ── GIF89a ─────────────────────────────────────────────────────────────────
//
// Hand-rolled to keep the tool chain dependency-free, the same reason lib/png.js
// writes PNGs by hand. The format is small and the encoder below is the whole of
// it; the only non-obvious part is LZW, and that is 30 lines.

function lzwEncode(minCodeSize, px) {
  const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
  const bytes = [];
  let cur = 0, curBits = 0, codeSize = minCodeSize + 1;

  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { bytes.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };

  let dict = new Map(), next = EOI + 1;
  emit(CLEAR);

  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i];
    // prefix is a code below 4096 and k a colour index below 256, so this packs
    // the pair into one number without a string key.
    const key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }

    emit(prefix);
    if (next === 4096) {
      // Table full: tell the decoder to reset in step with us.
      emit(CLEAR);
      dict = new Map(); next = EOI + 1; codeSize = minCodeSize + 1;
    } else {
      // Widen *before* assigning, so encoder and decoder agree on when the code
      // width changes. Getting this order wrong yields a file that opens fine in
      // a lenient viewer and is garbage in a strict one.
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (curBits > 0) bytes.push(cur & 0xff);
  return bytes;
}

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return out;
}

function writeGif(file, W, H, table, transIndex, frames) {
  // GIF's colour table has to be a power of two, and at least 4 entries — a
  // 2-entry table would mean a 1-bit minimum code size, which the format
  // forbids.
  let exp = 2;
  while ((1 << exp) < table.length) exp++;
  const tableLen = 1 << exp;

  const buf = [];
  const push = (...b) => buf.push(...b);
  const u16 = v => push(v & 0xff, (v >> 8) & 0xff);

  push(...Buffer.from('GIF89a'));
  u16(W); u16(H);
  push(0x80 | ((exp - 1) << 4) | (exp - 1), 0, 0);     // GCT present, no sort
  for (let i = 0; i < tableLen; i++) push(...(table[i] || [0, 0, 0]));

  // NETSCAPE2.0 — the only way to say "loop forever".
  push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);

  for (const f of frames) {
    // GIF delays are in hundredths of a second. Every hold in the catalogue is a
    // multiple of 10 ms, so this is exact today; the floor of 2 is because many
    // viewers silently rewrite a delay of 0 or 1 to 10, which would make a fast
    // frame the slowest one on screen.
    const delay = Math.max(2, Math.round(f.hold / 10));
    // Disposal 2 (restore to background) rather than 1 (leave in place): every
    // frame here is a full canvas, and leaving the previous one underneath would
    // let it show through wherever this one is transparent.
    push(0x21, 0xf9, 0x04, (2 << 2) | (transIndex >= 0 ? 1 : 0));
    u16(delay);
    push(transIndex >= 0 ? transIndex : 0, 0x00);

    push(0x2c); u16(0); u16(0); u16(W); u16(H); push(0x00);
    const min = Math.max(2, exp);
    push(min, ...subBlocks(lzwEncode(min, f.px)));
  }

  push(0x3b);
  fs.writeFileSync(file, Buffer.from(buf));
  return buf.length;
}

// ── rendering ──────────────────────────────────────────────────────────────

// One index per pixel on the output canvas. Index 0 is the background in both
// modes; only whether it is painted or left clear differs, which is why the
// caller only has to swap the colour table entry.
function rasterise(grid, side, cell, CW, CH, anchor) {
  const art = side * cell;
  const x0 = (CW - art) >> 1;
  const y0 = anchor === 'top' ? 0
           : anchor === 'middle' ? (CH - art) >> 1
           : CH - art;
  const px = new Uint8Array(CW * CH);            // zero-filled = background
  for (let cy = 0; cy < side; cy++) {
    for (let cx = 0; cx < side; cx++) {
      const v = grid[cy][cx];
      if (v === 0) continue;
      for (let dy = 0; dy < cell; dy++) {
        const y = y0 + cy * cell + dy;
        if (y < 0 || y >= CH) continue;
        let o = y * CW + x0 + cx * cell;
        for (let dx = 0; dx < cell; dx++, o++) {
          const x = x0 + cx * cell + dx;
          if (x >= 0 && x < CW) px[o] = v;
        }
      }
    }
  }
  return px;
}

// PNGs come out 24-bit by default and 32-bit under --rgba. The flag exists
// because Xiaomi's watchface packer accepts only 32-bit PNGs and says nothing
// when given a 24-bit one — it packs a file the watch cannot decode. Alpha is
// 255 everywhere unless --transparent, in which case index 0 becomes clear.
function writeImage(file, px, CW, CH, table, rgba, transIndex) {
  const n = rgba ? 4 : 3;
  const img = Buffer.alloc(CW * CH * n);
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    const c = table[v] || [0, 0, 0];
    img[i * n] = c[0]; img[i * n + 1] = c[1]; img[i * n + 2] = c[2];
    if (rgba) img[i * n + 3] = (transIndex >= 0 && v === transIndex) ? 0 : 255;
  }
  (rgba ? writeRgbaPng : writeRgbPng)(file, CW, CH, img);
}

// ── main ───────────────────────────────────────────────────────────────────

const OUT_DIR = path.resolve(opt('--out', path.join(__dirname, 'export')));
const ANCHOR = opt('--anchor', 'bottom');
const STILL = args.includes('--still') ? parseInt(opt('--still', '0'), 10) : -1;
const TRANSPARENT = flag('--transparent');
const RGBA = flag('--rgba');
const BG = toRgb('#' + opt('--bg', '000000').replace('#', ''));

const names = args.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && ['--out', '--cell', '--bg', '--canvas', '--anchor', '--still'].includes(args[i - 1])));

const all = collect();
const wanted = flag('--all') ? [...all.keys()] : names.length ? names : MINE;

if (!['top', 'middle', 'bottom'].includes(ANCHOR)) {
  console.error(`--anchor must be top, middle or bottom (got "${ANCHOR}")`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let wroteAny = false;

for (const name of wanted) {
  const a = all.get(name);
  if (!a) {
    console.error(`no animation named "${name}". Known names:`);
    for (const n of [...all.keys()].sort()) console.error(`  ${n}`);
    process.exit(1);
  }

  const side = a.frames[0].grid.length;
  const cell = parseInt(opt('--cell', String(Math.max(1, Math.round(480 / side)))), 10);
  const art = side * cell;
  const canvas = opt('--canvas', null);
  const [CW, CH] = canvas
    ? canvas.split('x').map(v => parseInt(v, 10))
    : [art, art];
  if (!CW || !CH) { console.error(`--canvas wants WxH, e.g. 336x480 (got "${canvas}")`); process.exit(1); }

  const table = a.palette.map(toRgb);
  table[0] = BG;                                  // index 0 is always the background
  const transIndex = TRANSPARENT ? 0 : -1;

  const slug = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const frames = a.frames.map(f => ({
    hold: f.hold,
    px: rasterise(f.grid, side, cell, CW, CH, ANCHOR),
  }));

  if (STILL >= 0) {
    if (STILL >= frames.length) {
      console.error(`"${name}" has ${frames.length} frames; --still ${STILL} is past the end`);
      process.exit(1);
    }
    const file = path.join(OUT_DIR, `${slug}.png`);
    writeImage(file, frames[STILL].px, CW, CH, table, RGBA, transIndex);
    console.log(`${name.padEnd(14)} ${CW}x${CH}  frame ${STILL}  ${path.relative(process.cwd(), file)}`);
    wroteAny = true;
    continue;
  }

  const file = path.join(OUT_DIR, `${slug}.gif`);
  const size = writeGif(file, CW, CH, table, transIndex, frames);
  const ms = a.frames.reduce((s, f) => s + f.hold, 0);
  console.log(`${name.padEnd(14)} ${CW}x${CH}  ${frames.length}f  ${(ms / 1000).toFixed(1)}s  ` +
              `${(size / 1024).toFixed(0)} KB  ${path.relative(process.cwd(), file)}`);
  wroteAny = true;

  if (flag('--frames')) {
    const dir = path.join(OUT_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    frames.forEach((f, i) => writeImage(
      path.join(dir, `frame-${String(i + 1).padStart(4, '0')}.png`),
      f.px, CW, CH, table, RGBA, transIndex));
    console.log(`${''.padEnd(14)} + ${frames.length} PNGs in ${path.relative(process.cwd(), dir)}/`);
  }
}

if (!wroteAny) { console.error('nothing to export'); process.exit(1); }
