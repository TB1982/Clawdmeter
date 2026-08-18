#include "coin_band.h"
#include "theme.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>

// Both resolve in the simulator too — boards/sim/shim/ provides them, which is
// why every other shared file includes them unconditionally rather than
// guarding on ARDUINO.
#include <Arduino.h>
#include <esp_heap_caps.h>

// ---- Look ----------------------------------------------------------------
// The same gold as tools/make_coin_spin.js, which took it from `expression
// wink`. Kept as literal RGB565 rather than converted at runtime so the three
// depth tiers cannot drift apart the way three hand-typed hex strings would.
#define GOLD565(r, g, b) (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))

struct Shade { uint16_t rim, face, inner; };
// depth 0 furthest .. 2 nearest. Radii and brightness both grow with depth;
// either alone leaves the strip reading as a flat pattern.
static const Shade SHADES[3] = {
    { GOLD565(107,  88,  32), GOLD565(107,  96,  64), GOLD565(107,  91,  58) },  // 0.42
    { GOLD565(173, 143,  52), GOLD565(173, 157, 104), GOLD565(173, 147,  94) },  // 0.68
    { GOLD565(255, 210,  77), GOLD565(255, 230, 153), GOLD565(255, 217, 138) },  // 1.00
};
static const float DEPTH_R[3] = { 0.34f, 0.48f, 0.64f };   // of half the strip height
static const float RIM_FRAC = 0.58f, INNER_FRAC = 0.30f;

// Fixed lanes, not random: an animation that differs every run cannot be
// reviewed, and the same reasoning as the offline generator applies on-device.
// x is a fraction of the width, y0 a phase offset, spins whole turns per loop.
struct Lane { float x, y0; uint8_t spins, depth; };
static const Lane LANES[] = {
    {0.03f, 0.00f, 2, 1}, {0.10f, 0.55f, 3, 0}, {0.17f, 0.28f, 2, 2},
    {0.24f, 0.81f, 3, 1}, {0.31f, 0.13f, 2, 0}, {0.38f, 0.47f, 3, 2},
    {0.45f, 0.92f, 2, 1}, {0.52f, 0.35f, 3, 0}, {0.59f, 0.70f, 2, 2},
    {0.66f, 0.05f, 3, 1}, {0.73f, 0.60f, 2, 0}, {0.80f, 0.22f, 3, 2},
    {0.87f, 0.88f, 2, 1}, {0.94f, 0.41f, 3, 0}, {0.99f, 0.66f, 2, 2},
};
static const int LANE_COUNT = sizeof(LANES) / sizeof(LANES[0]);

#define LOOP_MS   2400          // one pass of the slowest (furthest) coin
#define FRAME_MS  50            // 20 fps; faster buys nothing at this size

struct coin_band {
    lv_obj_t *canvas;
    uint16_t *buf;
    int w, h;
    uint32_t last_ms;
};

static void draw_coin(coin_band_t *b, float cx, float cy, float turn, int depth) {
    const float r = DEPTH_R[depth] * (b->h * 0.5f);
    const float halfW = fmaxf(0.6f, r * fabsf(cosf(turn * 2.0f * (float)M_PI)));
    const Shade &s = SHADES[depth];

    int x0 = (int)floorf(cx - halfW), x1 = (int)ceilf(cx + halfW);
    int y0 = (int)floorf(cy - r),     y1 = (int)ceilf(cy + r);
    if (x0 < 0) x0 = 0;  if (x1 > b->w - 1) x1 = b->w - 1;
    if (y0 < 0) y0 = 0;  if (y1 > b->h - 1) y1 = b->h - 1;

    for (int y = y0; y <= y1; y++) {
        const float dy = (y - cy) / r;
        for (int x = x0; x <= x1; x++) {
            const float dx = (x - cx) / halfW;
            const float d = sqrtf(dx * dx + dy * dy);
            if (d > 1.0f) continue;
            // Nearer coins are drawn last and simply overwrite, so an overlap
            // reads as one passing in front of another.
            b->buf[y * b->w + x] = (d > RIM_FRAC)   ? s.rim
                                 : (d > INNER_FRAC) ? s.face
                                                    : s.inner;
        }
    }
}

coin_band_t* coin_band_create(lv_obj_t *parent, int w, int h) {
    if (w <= 0 || h <= 0) return NULL;
    coin_band_t *b = (coin_band_t*)calloc(1, sizeof(coin_band_t));
    if (!b) return NULL;
    b->w = w; b->h = h;

    const size_t bytes = (size_t)w * h * 2;
#ifdef BOARD_HAS_PSRAM
    const uint32_t caps = MALLOC_CAP_SPIRAM;
#else
    const uint32_t caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
#endif
    b->buf = (uint16_t*)heap_caps_malloc(bytes, caps);
    if (!b->buf) { free(b); return NULL; }
    memset(b->buf, 0, bytes);

    b->canvas = lv_canvas_create(parent);
    lv_canvas_set_buffer(b->canvas, b->buf, w, h, LV_COLOR_FORMAT_RGB565);
    b->last_ms = 0;
    return b;
}

lv_obj_t* coin_band_canvas(coin_band_t *b) { return b ? b->canvas : NULL; }

void coin_band_tick(coin_band_t *b) {
    if (!b || !b->buf) return;
    const uint32_t now = millis();
    if (b->last_ms && now - b->last_ms < FRAME_MS) return;
    b->last_ms = now;

    // Black rather than transparent: the strip sits on a black panel, and a
    // cleared RGB565 canvas is black anyway, so this costs one memset and
    // avoids needing an alpha channel for a band that is always over black.
    memset(b->buf, 0, (size_t)b->w * b->h * 2);

    const float t = (float)(now % LOOP_MS) / (float)LOOP_MS;
    for (int pass = 0; pass < 3; pass++) {            // furthest tier first
        for (int i = 0; i < LANE_COUNT; i++) {
            const Lane &l = LANES[i];
            if (l.depth != pass) continue;
            const float r = DEPTH_R[l.depth] * (b->h * 0.5f);
            const float span = b->h + 2.0f * r;
            // Nearer coins cross the strip more times per loop.
            const float passes = (float)(l.depth + 1);
            float phase = l.y0 + t * passes;
            phase -= floorf(phase);
            draw_coin(b, l.x * (b->w - 1), phase * span - r, t * l.spins, l.depth);
        }
    }
    lv_obj_invalidate(b->canvas);
}
