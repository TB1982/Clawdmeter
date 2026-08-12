#!/usr/bin/env node
/**
 * Converts scraped JSON animation data to firmware/src/splash_animations.h.
 *
 * Per-animation palette (up to PALETTE_SIZE entries) is converted to RGB565.
 * Cells in each frame are palette indices. Splash module looks up colors via
 * palette[cell].
 *
 * Usage: node convert_to_c.js [--in DIR] [--out FILE]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

// Comma-separated, and one directory per source of the art, because provenance
// is the thing that most needs to stay obvious here:
//   claudepix_data/  the scraper owns outright and is free to wipe
//   custom_anims/    make_custom_anims.js builds, and survives a re-scrape
//   drawn_anims/     Nova's own drawings and her edits to the above
//   official_anims/  import_official.js writes, from Anthropic's own art
// Later directories win on a name collision, so drawn_anims/ overrides a
// scrape and official_anims/ would override a drawing of the same name.
const IN_DIRS = opt('--in',
    ['claudepix_data', 'custom_anims', 'drawn_anims', 'official_anims'].join(','))
  .split(',').map(d => path.resolve(__dirname, d.trim()));
const OUT_FILE = path.resolve(opt('--out',
  path.join(__dirname, '..', 'firmware', 'src', 'splash_animations.h')));

// Both now live in tools/lib/format.js, which is the only copy the Node tools
// share. Nothing in the firmware hardcodes the palette size — splash.cpp
// bounds-checks against SPLASH_PALETTE_SIZE, which is emitted from here, and
// cells are uint8_t. Files with fewer entries stay valid; the rest of the array
// is zero-filled.
//
// GRID_SIZES is square-only because splash.cpp centres a square canvas on the
// panel by design, so a non-square animation would have to letterbox or
// distort and would stop being portable across the six boards. 40 earns its
// place by being exactly 2x: a 20x20 animation upscales into it with each cell
// becoming a 2x2 block, so it looks identical on screen and can then be
// refined.
const {PALETTE_SIZE, GRID_SIZES} = require('./lib/format.js');

// Animations that stay in the source directories — so they keep working as
// editor samples and as bases for make_custom_anims.js — but are not emitted
// into the firmware at all.
//
// Removing a name from GROUP_NAMES in splash.cpp only stops it being *picked*;
// its frames are still compiled in and still cost 400 bytes each. This list is
// the other half: it costs the flash back.
//
// Excluding by name rather than by file, because a name can exist in more than
// one source directory and dropping only the override would leave the scraped
// original in the build.
const EXCLUDE = new Set([
  // Nova's call, 2026-08-09: not wanted on the device. Kept as editor samples.
  'idle breathe',
  'idle blink',
  // Retired 2026-08-09 when "work mode" took its slot in the active group.
  'dance sway',
  // And its DJ variant later the same day, when "surfing" took the lead slot in
  // the heavy group. It was the weakest of that group's three by measurement:
  // the slowest loop in the busiest band, with 53% of its motion being sparkles
  // in empty space rather than anything happening to him.
  'dance sway dj',
  // The last of the three DJ animations to go, retired 2026-08-10 when "this is
  // fine" took its slot. Nova had wanted it gone for a while and the reason
  // turned out to be the same one that sank its sway variant: it floats. What
  // she kept liking about "dance djmix" was that he stands at a desk, and the
  // two bounce/sway variants have him in mid-air with nothing under him.
  'dance bounce dj',
  // Freed once ui.cpp's idle screen stopped naming it: that screen draws one
  // animation directly rather than picking from a rate group, so anything it
  // names has to stay in the build no matter what the groups say.
  'expression sleep',

  // ─── 2026-08-12: every remaining claudepix animation ────────────────────
  // Nova's call, after upstream replaced its claudepix catalogue with official
  // Anthropic art. The reason is provenance rather than quality: claudepix
  // states no licence at all, which makes it the murkiest thing this project
  // depends on. With these gone the device carries two sources and no third —
  // what Nova drew, and Anthropic's own art.
  //
  // The source JSON stays in tools/claudepix_data/ and tools/custom_anims/, so
  // all of it remains loadable in the editor and any of it can be brought back
  // by deleting a line here.
  //
  // Percentages are cells differing from the claudepix original, measured
  // frame by frame. They are an upper bound — a whole-figure shift of one cell
  // scores high without being a redraw — but they do say which of these were
  // barely touched and which Nova had substantially rebuilt.
  'idle look around',      // 0%: the untouched scrape, never opened in the editor
  'dance bounce',          // 5.9%
  'expression surprise',   // 14.4%, redrawn for legibility at 4 px/cell
  'work think',            // 15.4%, fixed the body-coloured thought marks
  'expression wink',       // 20.8%, redrawn for legibility
  'work coding',           // 35.0%, redrawn for legibility
  'dance djmix',           // 45.6% — the most rebuilt of them, and it was
                           // SPLASH_CELEBRATE_ANIM. "hanabi" takes that over.

  // Composed by make_custom_anims.js: Nova drew the props, but each one poses
  // claudepix frames underneath — the hearts and the blossom ride "idle
  // breathe", the headphones ride "dance bounce". The prop is hers; the
  // animation it rides on is not.
  'idle hearts',
  'idle blossom',
  'fm listening',

  // Already picked by nothing since 2026-08-09 — four frames each, and the two
  // the claudepix site itself never lists. They were costing flash to sit in
  // the build unreachable.
  'dance bob',
  'work type',
]);

function safeIdent(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Brand override: claudepix renders the creature body in a lighter, pinker
// terracotta (#CD7F6A) than Anthropic's brand terracotta. Remap it to the
// brand color (THEME_ACCENT, #D97757) so the splash matches the brand.
const TINT_OVERRIDE = {
  '#cd7f6a': '#d97757',
};

function hexToRgb565(hex) {
  if (!hex || hex === 'transparent') return 0x0000;  // dark bg
  const ov = TINT_OVERRIDE[hex.toLowerCase()];
  if (ov) hex = ov;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function paletteToRgb565(palette) {
  const out = new Array(PALETTE_SIZE).fill(0x0000);
  for (let i = 0; i < palette.length && i < PALETTE_SIZE; i++) {
    out[i] = hexToRgb565(palette[i]);
  }
  return out;
}

// The contract every source has to meet. Worth failing loudly on: the firmware
// reads these arrays with fixed strides and no bounds checks, so a 19-row grid
// or an out-of-range cell doesn't produce a wrong picture, it produces a device
// reading past the end of an array.
function validate(data, where) {
  const die = msg => { console.error(`${where}: ${msg}`); process.exit(1); };

  if (!data.name) die('missing "name"');
  if (!Array.isArray(data.palette) || data.palette.length === 0) die('missing "palette"');
  if (data.palette.length > PALETTE_SIZE)
    die(`palette has ${data.palette.length} entries, max is ${PALETTE_SIZE}`);
  if (!Array.isArray(data.frames) || data.frames.length === 0) die('no frames');

  // The grid side is read from frame 0 rather than declared, because that is
  // the one place it can't disagree with the data. Every later frame must match
  // it: a set of frames at mixed sizes would be indexed at one stride.
  if (!Array.isArray(data.frames[0]?.grid)) die('frame 0: missing "grid"');
  const side = data.frames[0].grid.length;
  if (!GRID_SIZES.includes(side))
    die(`grid is ${side}x${side}; supported sides are ${GRID_SIZES.join(', ')}`);

  data.frames.forEach((f, i) => {
    if (typeof f.hold !== 'number' || f.hold <= 0) die(`frame ${i}: "hold" must be a positive number of ms`);
    if (!Array.isArray(f.grid) || f.grid.length !== side)
      die(`frame ${i}: grid must have ${side} rows to match frame 0, has ${f.grid?.length}`);
    f.grid.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== side)
        die(`frame ${i} row ${r}: must have ${side} cells, has ${row?.length}`);
      row.forEach((v, c) => {
        if (!Number.isInteger(v) || v < 0 || v >= data.palette.length)
          die(`frame ${i} cell ${r},${c}: ${v} is not a valid index into a ${data.palette.length}-entry palette`);
      });
    });
  });
  return side;
}

function main() {
  // Collect (dir, meta) pairs across every source directory. A missing
  // custom_anims/ is fine — only the first directory is required, since without
  // it there's nothing to build at all.
  const index = [];
  IN_DIRS.forEach((dir, i) => {
    if (!fs.existsSync(dir)) {
      if (i === 0) {
        console.error(`No animation source at ${dir}. Run scrape_claudepix.js first.`);
        process.exit(1);
      }
      return;
    }

    // A generator that owns its directory writes an _index.json declaring what
    // it produced. A directory without one is a drop-in: every .json in it is
    // an animation, discovered by globbing. That's what lets an external
    // editor export straight into a source dir without also having to
    // maintain an index it knows nothing about.
    const indexPath = path.join(dir, '_index.json');
    let metas;
    if (fs.existsSync(indexPath)) {
      metas = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } else {
      metas = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json') && !f.startsWith('_'))
        .sort()
        .map(f => {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { filename: f, name: data.name, category: data.category };
        });
    }

    if (i === 0 && metas.length === 0) {
      console.error(`No animations found in ${dir}. Run scrape_claudepix.js first.`);
      process.exit(1);
    }
    for (const meta of metas) index.push({ dir, meta });
    if (metas.length) console.log(`  ${path.basename(dir)}: ${metas.length}`);
  });

  // Later directories override earlier ones by animation name. That's what
  // "I edited the existing animation" means: a hand-drawn file in drawn_anims/
  // replaces the generated or scraped one it shares a name with, rather than
  // being emitted alongside it.
  //
  // Without this the duplicate isn't a soft problem — two animations with the
  // same name produce the same C identifiers and the firmware fails to compile
  // on a redefinition, which reads as a toolchain fault rather than "you have
  // two copies of the same animation".
  const byName = new Map();
  for (const entry of index) {
    const name = entry.meta.name;
    if (byName.has(name)) {
      const prev = byName.get(name);
      console.log(`  ${name}: ${path.basename(entry.dir)} overrides `
                + `${path.basename(prev.dir)}`);
    }
    byName.set(name, entry);
  }
  index.length = 0;
  index.push(...byName.values());

  const dropped = index.filter(e => EXCLUDE.has(e.meta.name)).map(e => e.meta.name);
  if (dropped.length) {
    for (const name of dropped) console.log(`  ${name}: excluded from the firmware`);
    const missing = [...EXCLUDE].filter(n => !dropped.includes(n));
    if (missing.length) {
      console.error(`EXCLUDE names that match no animation: ${missing.join(', ')}`);
      console.error('A typo here silently excludes nothing. Fix or remove the entry.');
      process.exit(1);
    }
  }
  index.splice(0, index.length, ...index.filter(e => !EXCLUDE.has(e.meta.name)));
  console.log(`Converting ${index.length} animations`);

  let out = '';
  out += '// ============================================================\n';
  out += '// Splash animations — generated by tools/convert_to_c.js.\n';
  out += '// Source: https://claudepix.vercel.app (20x20 pixel-art creature\n';
  out += '// animation library). Frames extracted by tools/scrape_claudepix.js\n';
  out += '// from per-animation HTML files served by the source site.\n';
  out += '// Also includes hand-composed animations from tools/custom_anims/,\n';
  out += '// built by tools/make_custom_anims.js by posing the same characters.\n';
  out += '// Do not edit by hand — re-run the scraper + converter to refresh.\n';
  out += '// ============================================================\n';
  out += `// Each animation carries a ${PALETTE_SIZE}-entry RGB565 palette.\n`;
  out += `// Cell values 0..${PALETTE_SIZE - 1} index into palette.\n`;
  out += '#pragma once\n#include <stdint.h>\n\n';

  out += `#define SPLASH_PALETTE_SIZE ${PALETTE_SIZE}\n\n`;

  out += 'typedef struct {\n';
  out += '    const char *name;\n';
  out += '    const char *category;\n';
  out += '    uint16_t frame_count;\n';
  out += '    uint8_t  grid;              // cells per side; a frame is grid*grid bytes\n';
  out += '    const uint16_t *palette;\n';
  out += '    const uint8_t *frames;      // frame_count frames, row-major, back to back\n';
  out += '    const uint16_t *holds;\n';
  out += '} splash_anim_def_t;\n\n';
  // The stride used to live in the array type (`frames[N][400]`), which forced
  // every animation in a build to the same size. It's a field now, so the
  // renderers read it per animation. Anything indexing frames must go through
  // this: the old `a->frames[i]` was a typed row step and is now a byte step.
  out += 'static inline const uint8_t *splash_frame(const splash_anim_def_t *a, uint16_t i) {\n';
  out += '    return &a->frames[(uint32_t)i * a->grid * a->grid];\n';
  out += '}\n\n';

  const entries = [];

  for (const { dir, meta } of index) {
    const stem = meta.filename.replace(/\.(html?|json)$/i, '');
    const ident = safeIdent(stem);
    const dataPath = path.join(dir, `${stem}.json`);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const side = validate(data, dataPath);

    const pal565 = paletteToRgb565(data.palette);
    out += `static const uint16_t splash_${ident}_palette[${PALETTE_SIZE}] = {`;
    out += pal565.map(c => `0x${c.toString(16).toUpperCase().padStart(4, '0')}`).join(',');
    out += '};\n';

    // Flat, one source line per frame. The bytes and their order are exactly
    // what the old [N][400] form emitted — only the array type changed.
    out += `static const uint8_t splash_${ident}_frames[${data.frames.length} * ${side} * ${side}] = {\n`;
    for (const f of data.frames) {
      const flat = [];
      for (let r = 0; r < side; r++)
        for (let c = 0; c < side; c++)
          flat.push(f.grid[r][c]);
      out += '    ' + flat.join(',') + ',\n';
    }
    out += '};\n';

    out += `static const uint16_t splash_${ident}_holds[${data.frames.length}] = {`;
    out += data.frames.map(f => f.hold).join(',');
    out += '};\n\n';

    entries.push({ ident, name: data.name, category: data.category,
                   count: data.frames.length, grid: side });
  }

  out += `#define SPLASH_ANIM_COUNT ${entries.length}\n`;
  // Widest grid actually shipped in this build. Renderers size their scratch
  // buffers from it, so a build with nothing but 20x20 animations allocates
  // exactly what it always did.
  out += `#define SPLASH_GRID_MAX ${Math.max(...entries.map(e => e.grid))}\n`;
  out += 'static const splash_anim_def_t splash_anims[SPLASH_ANIM_COUNT] = {\n';
  for (const e of entries) {
    out += `    {"${e.name}", "${e.category}", ${e.count}, ${e.grid}, splash_${e.ident}_palette, splash_${e.ident}_frames, splash_${e.ident}_holds},\n`;
  }
  out += '};\n';

  fs.writeFileSync(OUT_FILE, out);
  console.log(`Wrote ${OUT_FILE} (${entries.length} animations, ${(out.length / 1024).toFixed(1)} KB)`);
}

main();
