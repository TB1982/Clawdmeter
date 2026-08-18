#!/usr/bin/env node
/**
 * Embeds every animation in the catalog into tools/anim_editor.html, so an
 * existing one can be opened and fixed rather than rebuilt from scratch.
 *
 * The data goes inline rather than being fetched. The editor is opened straight
 * off disk (file://), where fetch/XHR of a sibling file is blocked — inlining
 * is what keeps it a single file that works with no server.
 *
 * Only the region between the BEGIN/END markers is rewritten; the rest of the
 * editor is hand-written and must survive this.
 *
 *   node tools/build_editor_samples.js
 *
 * Re-run it after adding or changing any animation.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIRS = ['claudepix_data', 'custom_anims', 'drawn_anims', 'official_anims']
  .map(d => path.join(__dirname, d));
const EDITOR = path.join(__dirname, 'anim_editor.html');
const BEGIN = '/*BEGIN-SAMPLES*/', END = '/*END-SAMPLES*/';

// The same remap convert_to_c.js applies on the way to C. Loading the raw
// source colour instead would preview a body colour the panel never shows.
const TINT = { '#CD7F6A': '#D97757' };

// Keyed by name, later directories winning — the same override rule
// convert_to_c.js applies. Without it the editor would offer two entries with
// the same name and no way to tell which one is the one actually on the device.
const byName = new Map();

// Where each animation came from, which is NOT the same question as which
// directory won.
//
// A claudepix animation that was edited here has a copy in drawn_anims/, and
// drawn_anims/ wins — so labelling by winning directory would file it under
// "drawn for this project". For `idle look around` that copy is byte-identical
// to the scrape. Calling it ours because of where the file sits is exactly the
// laundering this label exists to prevent, so origin is decided by whether the
// NAME appears in a third-party source dir, wherever the winning file lives.
//
// custom_anims/ counts as claudepix too: make_custom_anims.js does not draw
// characters, it poses an existing claudepix animation and lays props over it.
// The props are ours; what they are riding is not.
//
// See tools/README.md § License note. The point of putting this in the editor
// is that the editor is one file that gets downloaded and carried away from the
// repo, and the README does not travel with it.
const { originOf } = require('./lib/origin.js');

for (const dir of SRC_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const a = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!a.frames || !a.palette) continue;

    byName.set(a.name, {
      n: a.name,
      c: a.category || 'Idle',
      s: originOf(a.name),
      p: a.palette.map(h => h === 'transparent' ? 'transparent'
                                                : (TINT[h.toUpperCase()] || h.toUpperCase())),
      // One string per frame: 400 chars, '.' for empty. Indices are base-36
      // (0-9 then a-z), so one character per cell stays lossless up to a
      // 36-entry palette and costs roughly a third of a nested JSON array.
      // Plain digits when the palette is small, so files written before the
      // cap moved from 10 to 16 decode identically.
      f: a.frames.map(fr => ({
        h: fr.hold,
        g: fr.grid.map(row => row.map(v => v === 0 ? '.' : v.toString(36)).join('')).join(''),
      })),
    });
  }
}

// --public builds the copy that goes on the web, and it leaves out every
// animation whose origin is claudepix — including the three where the props are
// ours and only the creature underneath is theirs.
//
// Not because the repo hides them: the source files stay where tools/README.md
// § License note says they stay, and this script still embeds all of them into
// tools/anim_editor.html for local use. The difference is what gets *served*.
// Publishing a page is a distribution in a way that a file in a repo someone
// chooses to clone is not, and the thing we point strangers at should carry only
// what we mean to hand them.
//
// claudepix states no license and its author's account is unreachable as of
// 2026-08-15, so there is nobody to ask. Unreachable is not permission — the
// exclusion is what you do when you cannot ask, and it is reversible the day
// that changes.
const PUBLIC = process.argv.includes('--public');
const { THIRD_PARTY } = require('./lib/origin.js');

const anims = [...byName.values()].filter(a => !(PUBLIC && THIRD_PARTY.has(a.s)));
anims.sort((x, y) => x.c.localeCompare(y.c) || x.n.localeCompare(y.n));

const html = fs.readFileSync(EDITOR, 'utf8');
const i = html.indexOf(BEGIN), j = html.indexOf(END);
if (i < 0 || j < 0) {
  console.error(`Markers not found in ${EDITOR}; nothing was written.`);
  process.exit(1);
}

// The editor cannot require() lib/format.js — it has to open from file:// as a
// single document with no server, which is the property the whole thing is
// built around. So it keeps its own copies and this is where they are checked.
// The last time a copy drifted, two importers spent three days rejecting valid
// drawings with a message that read like a rule.
const {PALETTE_SIZE, GRID_SIZES, CLIP_VERSION, HOLD_MIN_MS} = require('./lib/format.js');
const declared = {
  PALETTE_MAX:  (html.match(/const PALETTE_MAX = (\d+);/) || [])[1],
  GRID_SIZES:   (html.match(/const GRID_SIZES = \[([^\]]*)\];/) || [])[1],
  CLIP_VERSION: (html.match(/const CLIP_VERSION = (\d+);/) || [])[1],
  HOLD_MIN:     (html.match(/const HOLD_MIN = (\d+);/) || [])[1],
};
const want = {
  PALETTE_MAX:  String(PALETTE_SIZE),
  GRID_SIZES:   GRID_SIZES.join(', '),
  CLIP_VERSION: String(CLIP_VERSION),
  HOLD_MIN:     String(HOLD_MIN_MS),
};
for (const k of Object.keys(want)) {
  if (declared[k] === undefined) {
    console.error(`Could not find ${k} in ${path.basename(EDITOR)}; nothing was written.`);
    process.exit(1);
  }
  if (declared[k].replace(/\s+/g, ' ').trim() !== want[k]) {
    console.error(`${path.basename(EDITOR)} has ${k} = ${declared[k]}, tools/lib/format.js says ${want[k]}.`);
    console.error('Update the editor to match, then re-run. Nothing was written.');
    process.exit(1);
  }
}

// One base-36 character per cell below, so an index past 35 would encode as two
// characters and every sample after it would decode as garbage.
if (PALETTE_SIZE > 36) {
  console.error(`PALETTE_SIZE is ${PALETTE_SIZE}; the base-36 packing here tops out at 36.`);
  console.error('Change the packing (and the reader in anim_editor.html) first. Nothing was written.');
  process.exit(1);
}

const payload = '[\n' + anims.map(a =>
  `{n:${JSON.stringify(a.n)},c:${JSON.stringify(a.c)},s:${JSON.stringify(a.s)},p:${JSON.stringify(a.p)},f:[` +
  a.f.map(f => `{h:${f.h},g:${JSON.stringify(f.g)}}`).join(',') + ']}'
).join(',\n') + '\n]';

const out = html.slice(0, i + BEGIN.length) + payload + html.slice(j);

// The public copy is written beside the docs rather than over the working one:
// GitHub Pages serves a folder, so publishing from docs/ is also what stops the
// rest of the repo — tools/claudepix_data/ included — from being served off the
// project's own domain as a side effect of Pages being on at all.
const DEST = PUBLIC ? path.join(__dirname, '..', 'docs', 'anim_editor.html') : EDITOR;
fs.mkdirSync(path.dirname(DEST), {recursive: true});
fs.writeFileSync(DEST, out);

const frames = anims.reduce((s, a) => s + a.f.length, 0);
const where = path.relative(path.join(__dirname, '..'), DEST);
console.log(`Embedded ${anims.length} animations (${frames} frames) into ${where}`);
console.log(`  ${(out.length / 1024).toFixed(0)} KB total`);
if (PUBLIC) {
  const held = [...byName.values()].filter(a => THIRD_PARTY.has(a.s)).length;
  console.log(`  public build — ${held} claudepix-origin animations left out`);
}
