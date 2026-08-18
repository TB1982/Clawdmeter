#pragma once
#include <lvgl.h>

// A strip of falling, spinning coins, drawn straight into an LVGL canvas
// rather than played back from a baked animation.
//
// The animation format is square-only by design — splash.cpp centres a square
// canvas on the panel — so a wide, short banner cannot be one. Computing it
// here instead costs no flash at all (the 40x40 baked version was 25 KB) and
// lets the band be any shape the screen has room for.
//
// The geometry is the same as tools/make_coin_spin.js: a disc turned away from
// you narrows as cos(angle) and collapses to a line edge-on. Depth is three
// tiers — nearer coins bigger, brighter, drawn last, and crossing the strip
// more often, because parallax is what sells depth.

typedef struct coin_band coin_band_t;

// px_h is the strip height; the width is taken from the parent's width.
coin_band_t* coin_band_create(lv_obj_t *parent, int w, int h);
lv_obj_t*    coin_band_canvas(coin_band_t *b);
// Redraw for the current moment. Cheap enough to call every UI tick; returns
// immediately if nothing has moved since the last frame.
void         coin_band_tick(coin_band_t *b);
