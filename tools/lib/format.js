// The animation format's two hard numbers, in one place.
//
// They were in four places. PALETTE_SIZE went from 10 to 16 on 2026-08-08 in
// convert_to_c.js and anim_editor.html, and grid_image_to_anim.js and
// makebead_to_anim.js were left at 10 — so for three days those two tools
// rejected any drawing that used more than nine colours, with a message that
// read like a rule rather than a bug. That is what a duplicated constant does:
// it does not fail, it disagrees.
//
// anim_editor.html cannot require() this. It is one file that has to open from
// file:// with no server, which is the property the whole editor is built
// around. It keeps its own PALETTE_MAX and GRID_SIZES, and
// build_editor_samples.js checks them against these on every run, so the copy
// that cannot be removed is at least the copy that cannot drift.
'use strict';

// Entries per palette, index 0 included (it is "transparent" by convention).
//
// 36 is the ceiling, not a preference. The editor's embedded samples pack one
// cell into one base-36 character in build_editor_samples.js, so the largest
// index that survives a round trip is 35 ('z'); 36 would encode as "10" and
// every sample after it would decode as garbage. Going higher means changing
// that packing first, after which the real limit is 255, since cells are
// uint8_t in splash_animations.h.
//
// Cost is negligible either way: PALETTE_SIZE * 2 bytes per animation against
// 400 bytes per frame. Raised from 16 on 2026-08-11, because "hanabi" used all
// sixteen and Nova was composing against the cap rather than against the panel.
const PALETTE_SIZE = 36;

// Grid sides the pipeline accepts, smallest first. Square only: splash.cpp
// centres a square canvas on the panel by design.
const GRID_SIZES = [20, 40];

module.exports = {PALETTE_SIZE, GRID_SIZES};
