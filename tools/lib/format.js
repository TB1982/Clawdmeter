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
//
// Every side here is a whole multiple of 20, which is what makes growing an
// animation free: each cell becomes an n x n block, nothing moves, and it looks
// identical on the panel until it is refined. 32 or 48 would need interpolation
// — that is a redraw, not a resize.
//
// 60 was added on 2026-08-12, after upstream moved to a 60x60 stage. Two
// reasons, and the second is the real one:
//   - it makes their art importable (tools/import_official.js), and
//   - at 480px it is 8px per cell against 24, so the same screen area holds 9x
//     the cells. That is detail, not a smaller picture — the mistake the stage
//     invites is treating the extra cells as margin.
// Note 40 and 60 do not divide each other; resampling between them has to go
// via 20, and 40 -> 20 throws detail away.
//
// Cost: a frame is side*side bytes, so 60x60 is 3600 against 400. A 25-frame
// animation goes from 10 KB to 90 KB of flash. Fine for a few, not for all.
const GRID_SIZES = [20, 40, 60];

// Version of the frame-fragment clipboard payload — the `clawdclip` field of the
// single-line JSON that ⌘C puts on the system clipboard. See
// docs/animation-contract.md § 7 for the payload itself.
//
// It is a version and not just a magic string because the receiver is a separate
// program on a separate release cycle (VAS, which mirrors this file's constants
// and checks them against the contract document in its own test suite). Two
// editors that ship independently will at some point disagree about the format;
// the number is what lets the older one say so instead of misreading the newer
// one's cells.
//
// Bump it only for a change that an older reader would get *wrong*. Adding a
// field an older reader ignores is not that — it stays 1.
const CLIP_VERSION = 1;

module.exports = {PALETTE_SIZE, GRID_SIZES, CLIP_VERSION};
