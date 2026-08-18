#include "splash.h"
#include "splash_animations.h"
#include "splash_geometry.h"
#include "theme.h"
#include "usage_rate.h"
#include "hal/board_caps.h"
#include "hal/display_hal.h"
#include <Arduino.h>
#include <string.h>
#include <stdlib.h>
#include <esp_heap_caps.h>

// The canvas is square and centered, so on portrait or letterboxed panels it
// leaves vertical margin rather than cropping. On PSRAM-less boards the buffer
// is rendered tiny (cell == 1) and LVGL scales it up to fill the panel; the
// geometry decision lives in splash_compute_geometry() (splash_geometry.h).
//
// The grid side is per-animation (splash_anim_def_t::grid), so `cell` is not a
// constant: the canvas edge is fixed by the panel and the cells divide it, so a
// 40x40 animation draws at half the cell size of a 20x20 one and covers exactly
// the same area. SPLASH_GRID is the reference side the panel geometry is
// derived from; SPLASH_GRID_MAX (generated) is the widest actually shipped.
static int  cell      = 24;        // px per cell of the CURRENT animation
static int  canvas_w  = SPLASH_GRID * 24;
static int  canvas_h  = SPLASH_GRID * 24;

#ifndef BOARD_HAS_PSRAM
static_assert(SPLASH_GRID_MAX == SPLASH_GRID,
    "PSRAM-less boards render one pixel per cell and let LVGL upscale the whole "
    "image, so the scale factor is a property of the grid side. Mixing sizes "
    "would mean re-scaling on every animation change — on the one render path "
    "that neither the screenshot command nor a host test can check, because "
    "LV_USE_SNAPSHOT is off without PSRAM. Either keep this build to "
    "SPLASH_GRID-sized animations, or wire up per-animation lv_image_set_scale "
    "and verify it on real C6 hardware before deleting this line.");
#endif

// Background fallback when palette is missing
#define COL_EMPTY    0x0000  // true black (matches THEME_BG)

LV_FONT_DECLARE(font_styrene_28);

static lv_obj_t *splash_container = NULL;
static lv_obj_t *canvas = NULL;
static lv_obj_t *label_status = NULL;     // shown only when no animations loaded
static uint16_t *canvas_buf = NULL;        // 480x480 RGB565 (PSRAM)

static uint16_t cur_anim = 0;
static uint16_t cur_frame = 0;
static uint32_t frame_started_ms = 0;
static uint32_t last_pick_ms = 0;
static bool active = false;
static bool cur_is_celebration = false;   // what the last pick resolved to

// While splash is showing, auto-cycle to the next animation in the current
// rate-driven group every this many ms.
#define SPLASH_ROTATE_INTERVAL_MS 20000

// Usage-rate animation groups: 4 groups × up to 9 animations each.
// Filled at init by matching literal names from splash_anims[].
// Idle is the state the device sits in most of the day, so it carries the
// widest rotation — a bored creature is the one you actually look at.
#define GROUP_COUNT 4
#define GROUP_MAX   9
static int8_t  group_lists[GROUP_COUNT][GROUP_MAX];
static uint8_t group_size[GROUP_COUNT] = {0};
static uint8_t group_rotation[GROUP_COUNT] = {0};

// 2026-08-12, in two steps on the same day: every claudepix animation left
// these lists and the build (see EXCLUDE in tools/convert_to_c.js), and then
// sixteen of Anthropic's official animations were imported to refill them
// (tools/import_official.js). Two sources on the device now and no third —
// what Nova drew, and Anthropic's own art.
//
// Each list interleaves the two rather than grouping them, so a round is never
// four of theirs in a row followed by one of hers. The mixing is by subject,
// not by provenance: whatever the band is about, both sources say it.
//
// Note the sizes differ per animation — 20x20 for Nova's, 40x40 for most of the
// official art, 60x60 for the three too wide to fit 40. splash.cpp handles that
// (cell size is derived from splash_anim_def_t::grid), but it is why the two C6
// envs no longer build: see the static_assert at the top of this file.
static const char* GROUP_NAMES[GROUP_COUNT][GROUP_MAX] = {
    // Group 0 — idle / sleepy. Order is playback order: pick_rate_anim() walks
    // the list one entry every SPLASH_ROTATE_INTERVAL_MS, so slot 0 is what you
    // meet at boot and the last slot is what loops back into it. The summer
    // pair is deliberate and survived the cull intact: "hanabi" follows "swim
    // summer" so the rubber ring runs straight into the fireworks.
    // Reordered 2026-08-12. "waiting" joins from the usage screen's waiting
    // panel, where it was drawn for and where almost nobody ever saw it — that
    // panel needs the link up and the data stale for 90 s. "magnifier" takes
    // its place there instead, which is the right way round: the slot you see
    // least should hold the animation you mind least.
    //
    // Both rain scenes are in this list. Keeping them apart was tried and
    // abandoned — they are both idle by temperament, and the only group that
    // would take one is the wrong group for it. They are separated *within* the
    // round instead, so the rotation never runs rain into rain.
    //
    // Nova's ordering, and the shape is an alternation rather than a curve:
    //
    //   lurking      he peeks in from off-screen to see whether you are there
    //   swim summer  bright
    //   rainy days   quiet
    //   hanabi       bright
    //   waiting      quiet
    //   space        he leaves, which lands back on the peek
    //
    // This costs the old "swim summer -> hanabi" adjacency, which had been
    // deliberate (the two summer scenes back to back). The alternation is the
    // better reason: every loud slot is followed by a quiet one, so nothing in
    // the round has to compete with what precedes it, and the two rain scenes
    // end up two apart instead of one.
    //
    // On "lurking" leading: upstream puts "magnifier" first with the note that
    // "lurking-first would boot to a near-empty screen", and the measurement
    // agrees — 15% of its 4,330 ms loop is a completely blank frame, and at his
    // fullest he inks 141 of 1,600 cells. It matters less here, because
    // SPLASH_OPENING_ANIM plays once at power-up and covers the actual boot
    // moment, so slot 0 is what follows the greeting rather than what greets.
    { "lurking", "swim summer", "rainy days", "hanabi", "waiting", "space",
      NULL },
    // Group 1 — normal pace: moving about, but not at anything in particular.
    // Both gaits go here. Note they animate in place — upstream translates them
    // across the screen with a gait-locked walk system we don't have, so here
    // they march on the spot.
    { "work out", "walking", "waving", "crab walking", "pointing", NULL },
    // Group 2 — active (typing along with you). "work mode" is the one
    // animation built to fill a whole slot in a single pass, so its walk-in
    // plays once instead of three times and is never cut part-way; it keeps
    // slot 0. The official four are all him doing a thing with his hands or
    // feet rather than travelling.
    { "work mode", "laptop", "dancing", "basketball", "soccer", "skateboard",
      NULL },
    // Group 3 — heavy. "surfing" leads it from 2026-08-09: at the busiest rate
    // you are not driving, the wave is carrying you, which is a more honest
    // thing for this band to say than a third animation of him dancing.
    // "this is fine" joined on 2026-08-10. The official three that join them
    // are the same thought — a car, a cloud and a boat are all things carrying
    // him somewhere — and the closing slot holds the one unguarded celebration
    // in the whole catalogue.
    //
    // That slot became "jumping blossom" on 2026-08-13: upstream's "jumping
    // happy" with Nova's ring of flowers bursting off him at the apex. It
    // replaces the plain jump rather than joining it, so the round still ends
    // once. The plain one is excluded from the build in convert_to_c.js; keeping
    // both would put the same jump in the round twice, the second time with
    // something missing.
    //
    // It also brings her flowers back. They were retired with the rest of the
    // claudepix cull, not for being hers but for what they sat on — "idle
    // blossom" overlaid them on a scraped animation. On official art they are
    // clean, and the device is still two sources and no third.
    //
    // The ring is uneven on purpose. Its radii run 8.5 to 13.5 and its angular
    // gaps 23 to 59 degrees, and both were regularised once — onto a true circle
    // at frame 3 and an ellipse at frame 4, which took the radius spread from
    // 1.44 to 0.30. It was reverted the same day at Nova's call, and she was
    // right: petals leaving at whatever angle and speed they were pushed is what
    // reads as a burst, and even spacing reads as an arrangement. The measurement
    // improved and the animation got worse. Do not "fix" it again.
    { "surfing", "racing car", "this is fine", "cloud", "sailing scene",
      "trumpet", "jumping blossom", NULL },
};

static bool groups_resolved = false;

static void resolve_group_lists(void) {
    groups_resolved = true;
    for (int g = 0; g < GROUP_COUNT; g++) {
        group_size[g] = 0;
        for (int s = 0; s < GROUP_MAX; s++) {
            group_lists[g][s] = -1;
            const char* want = GROUP_NAMES[g][s];
            if (!want) continue;
            for (int i = 0; i < SPLASH_ANIM_COUNT; i++) {
                if (strcmp(splash_anims[i].name, want) == 0) {
                    group_lists[g][group_size[g]++] = (int8_t)i;
                    break;
                }
            }
        }
    }
}

// ---- Opening: played once, the first time the splash is shown after boot. ----
//
// Deliberately not a rate group member and deliberately not reachable from
// splash_next(), so "only at boot" means what it says: nothing picks it, nothing
// cycles onto it, and the flag below is only ever true once per power-up.
//
// It plays straight through rather than looping. Everything else in the
// catalogue loops forever and is chosen for what it says about the current usage
// rate; this one has a beginning and an end and says hello.
#define SPLASH_OPENING_ANIM "opening"
static bool opening_pending = true;   // static init: true exactly once per boot
static bool cur_is_opening = false;

// ---- Celebration: a short override that outranks the rate groups. ----
//
// "dance djmix" held this until 2026-08-12, when it left the build with the
// rest of the claudepix material. "hanabi" is a better fit than the thing it
// replaces, not a fallback: fireworks are already what a celebration looks
// like, it is Nova's own, and its 10,000 ms loop divides the 20,000 ms
// rotation slot exactly, so a celebration never cuts it off mid-burst.
#define SPLASH_CELEBRATE_MS   30000
#define SPLASH_CELEBRATE_ANIM "hanabi"

static uint32_t celebrate_until_ms = 0;

bool splash_celebrating(void) {
    // Signed compare so the window closes correctly across a millis() wrap.
    return celebrate_until_ms != 0 && (int32_t)(millis() - celebrate_until_ms) < 0;
}

static const splash_anim_def_t* find_anim(const char *name) {
    for (int i = 0; i < SPLASH_ANIM_COUNT; i++) {
        if (strcmp(splash_anims[i].name, name) == 0) return &splash_anims[i];
    }
    return NULL;
}

void splash_celebrate(void) {
    if (!find_anim(SPLASH_CELEBRATE_ANIM)) return;   // nothing to celebrate with
    celebrate_until_ms = millis() + SPLASH_CELEBRATE_MS;
    if (celebrate_until_ms == 0) celebrate_until_ms = 1;   // 0 means "not celebrating"
    Serial.printf("splash: celebrating for %d ms\n", SPLASH_CELEBRATE_MS);
    if (active) splash_pick_for_current_rate();
}

// Pick the next animation from the group matching the current usage rate — or
// the celebration animation, which outranks the groups while it runs. The
// rotation cursor is deliberately NOT advanced for a celebration: it's an
// interruption, and the group should resume where it left off afterwards.
//
// `rot` is the caller's per-group slot cursor (each consumer keeps its own, so
// the corner badge and the full-screen splash don't shuffle each other along).
// Resolves the group lists on first use — the idle screen builds its creature
// before splash_init() runs.
static const splash_anim_def_t* pick_rate_anim(uint8_t rot[GROUP_COUNT]) {
    if (!groups_resolved) resolve_group_lists();
    if (splash_celebrating()) return find_anim(SPLASH_CELEBRATE_ANIM);
    int g = usage_rate_group();
    if (g < 0 || g >= GROUP_COUNT) g = 0;
    if (group_size[g] == 0) return NULL;

    uint8_t slot = rot[g]++ % group_size[g];
    int8_t idx = group_lists[g][slot];
    return idx < 0 ? NULL : &splash_anims[idx];
}

static uint16_t *row_buf = NULL;   // scratch row, sized to canvas_w (PSRAM path)

// ─── Two render paths ────────────────────────────────────────────────────────
// PSRAM boards (S3) draw the pixel art into an LVGL canvas at native size and
// let LVGL flush it — they have the RAM and cores to spare, no transform needed.
//
// PSRAM-less boards (C6) can't hold a 480×480 canvas. The prior approach (tiny
// 20×20 canvas + LVGL image-scale) made LVGL software-transform the whole
// upscaled frame on every redraw — measured ~0.76 µs/output-px, i.e. 100–220 ms
// per frame on the single-core C6, and partial invalidation of a transformed
// image both fails to clip the transform and smears. Instead we upscale the
// 20×20 cells ourselves with trivial nearest-neighbour replication and push only
// the *changed* cells straight to the panel via the display HAL, bypassing LVGL.
// That removes the transform cost (leaving just the QSPI flush) and the
// dirty-rect is exact, so no smearing.
#ifndef BOARD_HAS_PSRAM
#  define SPLASH_DIRECT_DRAW 1
#else
#  define SPLASH_DIRECT_DRAW 0
#endif

#if SPLASH_DIRECT_DRAW
static uint16_t*       strip_buf = NULL;   // one grid-row band: (GRID*scr_cell)×scr_cell
static int             scr_cell  = 24;     // on-screen px per grid cell
static int             scr_offx  = 0;      // centering offsets (square art on panel)
static int             scr_offy  = 0;
static uint8_t         prev_cells[SPLASH_GRID_MAX * SPLASH_GRID_MAX];
static const uint16_t* prev_palette = NULL;
static int             prev_grid    = 0;      // stride prev_cells was written at
static bool            prev_valid   = false;
static bool            force_full   = false;  // repaint everything on the next render

static int panel_w = 0, panel_h = 0;   // fixed at init, from board_caps()

// Cells divide the panel, so a bigger grid means smaller cells over the same
// square area — the art keeps its size and gains resolution. Re-derived
// whenever the animation's grid changes rather than once at init.
static void set_scr_cell(int grid) {
    const int mind = (panel_w < panel_h) ? panel_w : panel_h;
    scr_cell = mind / grid;
    if (scr_cell < 1) scr_cell = 1;
    const int side = grid * scr_cell;
    scr_offx = (panel_w - side) / 2;
    scr_offy = (panel_h - side) / 2;
}

// Upscale grid cells [gx0..gx1]×[gy0..gy1] and push them to the panel, one
// grid-row band at a time so the scratch buffer stays (GRID*scr_cell × scr_cell).
static void blit_cells(const uint8_t* cells, const uint16_t* palette, int grid,
                       int gx0, int gy0, int gx1, int gy1) {
    if (!strip_buf) return;
    const int spc = scr_cell;
    const int bw  = (gx1 - gx0 + 1) * spc;          // band width, px
    const int px  = scr_offx + gx0 * spc;
    for (int gy = gy0; gy <= gy1; gy++) {
        for (int gx = gx0; gx <= gx1; gx++) {       // expand one source row across
            uint8_t code = cells[gy * grid + gx];
            uint16_t color = (palette && code < SPLASH_PALETTE_SIZE) ? palette[code] : COL_EMPTY;
            uint16_t* p = &strip_buf[(gx - gx0) * spc];
            for (int i = 0; i < spc; i++) p[i] = color;
        }
        for (int dy = 1; dy < spc; dy++)             // replicate that row down
            memcpy(&strip_buf[dy * bw], strip_buf, bw * 2);
        display_hal_draw_bitmap(px, scr_offy + gy * spc, bw, spc, strip_buf);
    }
}

static void render_frame(const splash_anim_def_t *a, uint16_t frame_idx) {
    if (!strip_buf) return;
    if (!active) return;          // never draw to the panel while not shown
    const uint8_t  *cells   = splash_frame(a, frame_idx);
    const uint16_t *palette = a->palette;
    const int       grid    = a->grid;

    // A grid change invalidates the dirty-rect compare outright: prev_cells was
    // written at the old stride, so every comparison would read a cell from the
    // wrong place and the bounding box would be nonsense. Repaint everything.
    bool full = force_full || !prev_valid || palette != prev_palette || grid != prev_grid;
    force_full = false;
    if (grid != prev_grid) set_scr_cell(grid);

    int gx0 = 0, gy0 = 0, gx1 = grid - 1, gy1 = grid - 1;
    if (!full) {                                     // bounding box of changed cells
        gx0 = grid; gy0 = grid; gx1 = -1; gy1 = -1;
        for (int gy = 0; gy < grid; gy++)
            for (int gx = 0; gx < grid; gx++)
                if (cells[gy * grid + gx] != prev_cells[gy * grid + gx]) {
                    if (gx < gx0) gx0 = gx;
                    if (gx > gx1) gx1 = gx;
                    if (gy < gy0) gy0 = gy;
                    if (gy > gy1) gy1 = gy;
                }
        if (gx1 < 0) return;                         // identical frame, nothing to do
    }

    blit_cells(cells, palette, grid, gx0, gy0, gx1, gy1);

    memcpy(prev_cells, cells, (size_t)grid * grid);
    prev_palette = palette;
    prev_grid    = grid;
    prev_valid   = true;
}

#else  // ── PSRAM: LVGL canvas render (unchanged) ──

static void render_frame(const splash_anim_def_t *a, uint16_t frame_idx) {
    if (!row_buf || !canvas_buf) return;
    const uint8_t  *cells   = splash_frame(a, frame_idx);
    const uint16_t *palette = a->palette;
    const int       grid    = a->grid;

    // canvas_w is fixed by the panel; the cells divide it. Every panel in tree
    // gives a canvas edge (480/400/360/240) that both supported sides divide
    // exactly, but a future one might not, so a remainder is centred and the
    // margin left as background rather than silently shifting the art.
    cell = canvas_w / grid;
    if (cell < 1) cell = 1;
    const int side = cell * grid;
    const int off  = (canvas_w - side) / 2;
    if (off) memset(canvas_buf, 0, (size_t)canvas_w * canvas_h * 2);

    for (int gy = 0; gy < grid; gy++) {
        for (int gx = 0; gx < grid; gx++) {
            uint8_t code = cells[gy * grid + gx];
            uint16_t color = (palette && code < SPLASH_PALETTE_SIZE) ? palette[code] : COL_EMPTY;
            uint16_t *p = &row_buf[gx * cell];
            for (int i = 0; i < cell; i++) p[i] = color;
        }
        for (int dy = 0; dy < cell; dy++) {
            memcpy(&canvas_buf[(off + gy * cell + dy) * canvas_w + off], row_buf, side * 2);
        }
    }
    if (canvas) lv_obj_invalidate(canvas);
}
#endif

// ---- Mini creature: a small animated creature for embedding in other screens
//      (the idle "sleeping" indicator, the corner badge on the usage screen).
//      Each instance is self-contained — its own canvas, buffer and frame clock,
//      independent of the full-screen splash above and of every other instance. ----
struct splash_mini {
    lv_obj_t *canvas;
    uint16_t *buf;
    int       cell;                     // on-screen px per grid cell
    int       w;                        // canvas edge, fixed at create
    int       grid;                     // cells per side of m->anim; cell = w / grid
    const splash_anim_def_t *anim;
    uint16_t  frame;
    uint32_t  started_ms;               // when the current frame began
    bool      follow_rate;              // created with anim_name == NULL
    uint32_t  last_pick_ms;             // follow_rate: when we last re-picked
    bool      is_celebration;           // follow_rate: what the last pick resolved to
    uint8_t   rotation[GROUP_COUNT];    // follow_rate: own per-group slot cursor
};

static void mini_render(splash_mini_t *m) {
    if (!m->buf || !m->anim) return;
    const uint8_t *cells = splash_frame(m->anim, m->frame);
    const uint16_t *pal = m->anim->palette;
    // The badge keeps its size and gains resolution: w is fixed, so a 40x40
    // animation halves the cell. Re-derived here because a follow_rate mini
    // re-picks its animation as the usage rate moves, and the new one may be
    // a different size than the one the buffer was allocated for.
    if (m->grid != m->anim->grid) {
        m->grid = m->anim->grid;
        m->cell = m->w / m->grid;
        if (m->cell < 1) m->cell = 1;
        memset(m->buf, 0, (size_t)m->w * m->w * 2);
    }
    const int grid = m->grid;

    // The buffer edge is a multiple of SPLASH_GRID (see splash_mini_create), and
    // the animation's own side need not divide it: 60 into an 80px badge gives
    // cell 1 and covers 60 of 80. So the drawn span is centred rather than left
    // at the origin, and every write is bounded.
    //
    // The bound is not cosmetic. On a compact layout the corner badge is
    // LOGO_SMALL_WIDTH = 40, so m->w is 40 and the buffer holds 1,600 uint16 —
    // but 40/60 truncates to 0, the clamp lifts it to 1, and the old unbounded
    // loop indexed up to 59*40+59 = 2,419. That is 1,640 bytes past the end of
    // the allocation, on the two boards that take this layout (1.8 and 1.54,
    // both with the PSRAM that lets a mixed-grid catalogue build at all), and
    // reachable whenever the rate lands on group 3 and this follow_rate instance
    // picks one of the three 60x60 animations. splash_mini_tick() renders
    // without checking visibility, so hiding the badge does not avoid it.
    const int span = grid * m->cell;
    const int off  = (m->w - span) / 2;      // negative when the art overruns

    for (int gy = 0; gy < grid; gy++) {
        for (int gx = 0; gx < grid; gx++) {
            uint8_t code = cells[gy * grid + gx];
            uint16_t color = (pal && code < SPLASH_PALETTE_SIZE) ? pal[code] : COL_EMPTY;
            for (int dy = 0; dy < m->cell; dy++) {
                const int y = off + gy * m->cell + dy;
                if (y < 0 || y >= m->w) continue;
                uint16_t *row = &m->buf[(size_t)y * m->w];
                for (int dx = 0; dx < m->cell; dx++) {
                    const int x = off + gx * m->cell + dx;
                    if (x < 0 || x >= m->w) continue;
                    row[x] = color;
                }
            }
        }
    }
    if (m->canvas) lv_obj_invalidate(m->canvas);
}

splash_mini_t* splash_mini_create(lv_obj_t *parent, const char *anim_name, int px) {
    if (SPLASH_ANIM_COUNT == 0) return NULL;

    const splash_anim_def_t *named = NULL;
    if (anim_name) {
        for (int i = 0; i < SPLASH_ANIM_COUNT; i++) {
            if (strcmp(splash_anims[i].name, anim_name) == 0) { named = &splash_anims[i]; break; }
        }
        if (!named) return NULL;
    }

    splash_mini_t *m = (splash_mini_t*)calloc(1, sizeof(splash_mini_t));
    if (!m) return NULL;

    m->follow_rate = (anim_name == NULL);
    m->anim = named ? named : pick_rate_anim(m->rotation);
    m->is_celebration = m->follow_rate && splash_celebrating();
    if (!m->anim) { free(m); return NULL; }

    // Snap the canvas edge to the reference grid so the cells of every
    // supported size divide it. mini_render() derives m->cell from m->w.
    m->cell = px / SPLASH_GRID;
    if (m->cell < 1) m->cell = 1;
    m->w = SPLASH_GRID * m->cell;
    m->grid = 0;                        // forces the first mini_render() to derive
#ifdef BOARD_HAS_PSRAM
    const uint32_t caps = MALLOC_CAP_SPIRAM;
#else
    const uint32_t caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
#endif
    m->buf = (uint16_t*)heap_caps_malloc(m->w * m->w * 2, caps);
    if (!m->buf) { free(m); return NULL; }

    m->canvas = lv_canvas_create(parent);
    lv_canvas_set_buffer(m->canvas, m->buf, m->w, m->w, LV_COLOR_FORMAT_RGB565);
    m->frame = 0;
    m->started_ms = millis();
    m->last_pick_ms = m->started_ms;
    mini_render(m);
    return m;
}

lv_obj_t* splash_mini_canvas(splash_mini_t *m) {
    return m ? m->canvas : NULL;
}

// Pin one frame and stop advancing. For a mini that is an indicator rather
// than a creature: the moon on the weather screen is frame N of an eight-frame
// set, chosen by the phase, and it must sit still. splash_mini_tick() is simply
// not called on a pinned instance, so nothing here has to learn a paused state.
bool splash_mini_set_anim(splash_mini_t *m, const char *anim_name) {
    if (!m || !anim_name) return false;
    for (int i = 0; i < SPLASH_ANIM_COUNT; i++) {
        if (strcmp(splash_anims[i].name, anim_name) != 0) continue;
        if (m->anim == &splash_anims[i]) return true;      // already there
        m->anim = &splash_anims[i];
        m->frame = 0;
        m->started_ms = millis();
        mini_render(m);
        return true;
    }
    return false;
}

void splash_mini_set_frame(splash_mini_t *m, uint16_t frame) {
    if (!m || !m->anim || m->anim->frame_count == 0) return;
    uint16_t f = frame % m->anim->frame_count;
    if (f == m->frame && m->buf) return;      // already showing it
    m->frame = f;
    m->started_ms = millis();
    mini_render(m);
}

void splash_mini_tick(splash_mini_t *m) {
    if (!m || !m->buf || !m->anim || m->anim->frame_count == 0) return;

    // Rate-following instances swap on the same cadence as the splash, and join
    // the celebration on the same terms: it plays through without rotation, and
    // entering or leaving it re-picks immediately rather than up to 20s later.
    if (m->follow_rate) {
        bool party = splash_celebrating();
        if (party != m->is_celebration ||
            (!party && millis() - m->last_pick_ms >= SPLASH_ROTATE_INTERVAL_MS)) {
            m->last_pick_ms = millis();
            const splash_anim_def_t *next = pick_rate_anim(m->rotation);
            m->is_celebration = party;
            if (next && next != m->anim) {
                m->anim = next;
                m->frame = 0;
                m->started_ms = m->last_pick_ms;
                mini_render(m);
                return;
            }
        }
    }

    if (millis() - m->started_ms < m->anim->holds[m->frame]) return;
    m->started_ms = millis();
    m->frame = (m->frame + 1) % m->anim->frame_count;
    mini_render(m);
}

static void show_placeholder() {
    // Solid dark background + centered status label. On the direct-draw path
    // there's no canvas; the black container is the background and the LVGL
    // label shows over it.
#if !SPLASH_DIRECT_DRAW
    if (canvas_buf) {
        for (int i = 0; i < canvas_w * canvas_h; i++) canvas_buf[i] = COL_EMPTY;
    }
    if (canvas) lv_obj_invalidate(canvas);
#endif
    if (label_status) lv_obj_clear_flag(label_status, LV_OBJ_FLAG_HIDDEN);
}

void splash_init(lv_obj_t *parent) {
    const BoardCaps& c = board_caps();

    // Shared full-screen black container — the splash background.
    splash_container = lv_obj_create(parent);
    lv_obj_set_size(splash_container, c.width, c.height);
    lv_obj_set_pos(splash_container, 0, 0);
    lv_obj_set_style_bg_color(splash_container, THEME_BG, 0);
    lv_obj_set_style_bg_opa(splash_container, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(splash_container, 0, 0);
    lv_obj_set_style_pad_all(splash_container, 0, 0);
    lv_obj_clear_flag(splash_container, LV_OBJ_FLAG_SCROLLABLE);

#if SPLASH_DIRECT_DRAW
    // Direct-to-panel path (no PSRAM): no LVGL canvas. Compute on-screen cell
    // size + centering, and a scratch band buffer sized for one grid-row strip
    // across the square art (GRID*scr_cell × scr_cell). On the C6 that's
    // 480×24×2 ≈ 23 KB of internal SRAM.
    panel_w = c.width;
    panel_h = c.height;
    set_scr_cell(SPLASH_GRID);
    // Sized for the reference grid, which is the largest cell any animation in
    // this build can ask for — the static_assert above keeps PSRAM-less builds
    // to that one size, so this band is never too small.
    int side = SPLASH_GRID * scr_cell;
    strip_buf = (uint16_t*)heap_caps_malloc((size_t)side * scr_cell * 2,
                                            MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!strip_buf) {
        Serial.println("splash: strip buffer alloc failed");
        return;
    }
#else
    // PSRAM path: render into an LVGL canvas at native size (no transform).
    SplashGeometry geo = splash_compute_geometry(c.width, c.height, true);
    cell                = geo.cell;
    canvas_w            = geo.canvas_dim;
    canvas_h            = geo.canvas_dim;
    const int img_scale = geo.scale;

    canvas_buf = (uint16_t*)heap_caps_malloc(canvas_w * canvas_h * 2, MALLOC_CAP_SPIRAM);
    row_buf    = (uint16_t*)heap_caps_malloc(canvas_w * 2,            MALLOC_CAP_SPIRAM);
    if (!canvas_buf || !row_buf) {
        Serial.println("splash: failed to alloc canvas buffer");
        return;
    }

    canvas = lv_canvas_create(splash_container);
    lv_canvas_set_buffer(canvas, canvas_buf, canvas_w, canvas_h, LV_COLOR_FORMAT_RGB565);
    if (img_scale != SPLASH_SCALE_UNITY) {
        lv_image_set_antialias(canvas, false);
        lv_image_set_pivot(canvas, canvas_w / 2, canvas_h / 2);
        lv_image_set_scale(canvas, img_scale);
    }
    lv_obj_center(canvas);
#endif

    // Placeholder label (visible only when no animations are loaded)
    label_status = lv_label_create(splash_container);
    lv_label_set_text(label_status,
        "no animations loaded\n\n"
        "run tools/scrape_claudepix.js\n"
        "then tools/convert_to_c.js");
    lv_obj_set_style_text_font(label_status, &font_styrene_28, 0);
    lv_obj_set_style_text_color(label_status, lv_color_hex(0xb0aea5), 0);
    lv_obj_set_style_text_align(label_status, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(label_status);

    resolve_group_lists();

    if (SPLASH_ANIM_COUNT == 0) {
        show_placeholder();
    } else {
        lv_obj_add_flag(label_status, LV_OBJ_FLAG_HIDDEN);
#if !SPLASH_DIRECT_DRAW
        // PSRAM path pre-renders frame 0 into the canvas buffer. The direct
        // path draws nothing here — render_frame() bails while inactive, so the
        // splash never paints to the panel before it's actually shown.
        const splash_anim_def_t *a = &splash_anims[0];
        render_frame(a, 0);
#endif
        frame_started_ms = millis();
    }

    lv_obj_add_flag(splash_container, LV_OBJ_FLAG_HIDDEN);
}

void splash_tick(void) {
    if (!active || SPLASH_ANIM_COUNT == 0) return;

#if SPLASH_DIRECT_DRAW
    // Deferred full repaint after a (re)show — runs now that LVGL has drawn the
    // black background this loop iteration.
    if (force_full) {
        const splash_anim_def_t *fa = &splash_anims[cur_anim];
        if (fa->frame_count) render_frame(fa, cur_frame);
    }
#endif

    // The opening runs once and does not loop: at the end of its last frame it
    // hands over to the rate groups and is never selected again. Handled before
    // the rotation logic and returning early, so the 20 s rotate timer cannot
    // cut it short.
    if (cur_is_opening) {
        const splash_anim_def_t *o = &splash_anims[cur_anim];
        if (millis() - frame_started_ms >= o->holds[cur_frame]) {
            if (cur_frame + 1 >= o->frame_count) {
                cur_is_opening = false;
                opening_pending = false;
                splash_pick_for_current_rate();
            } else {
                cur_frame++;
                frame_started_ms = millis();
                render_frame(o, cur_frame);
            }
        }
        return;
    }

    // Auto-rotate within the current group. A celebration plays through
    // uninterrupted — no rotation while it runs — and both its start and its
    // end force an immediate re-pick so the switch isn't held up to 20s.
    bool party = splash_celebrating();
    if (party != cur_is_celebration ||
        (!party && millis() - last_pick_ms >= SPLASH_ROTATE_INTERVAL_MS)) {
        splash_pick_for_current_rate();
    }

    const splash_anim_def_t *a = &splash_anims[cur_anim];
    if (a->frame_count == 0) return;

    uint16_t hold = a->holds[cur_frame];
    if (millis() - frame_started_ms >= hold) {
        cur_frame = (cur_frame + 1) % a->frame_count;
        frame_started_ms = millis();
        render_frame(a, cur_frame);
    }
}

void splash_next(void) {
    if (SPLASH_ANIM_COUNT == 0) return;
    // A press means "show me something else", so it also ends the opening — and
    // the cycle skips over it, or the one animation that is supposed to be
    // boot-only would be two presses away for the rest of the session.
    cur_is_opening = false;
    opening_pending = false;
    const splash_anim_def_t *opening = find_anim(SPLASH_OPENING_ANIM);
    do {
        cur_anim = (cur_anim + 1) % SPLASH_ANIM_COUNT;
    } while (opening && &splash_anims[cur_anim] == opening && SPLASH_ANIM_COUNT > 1);
    cur_frame = 0;
    frame_started_ms = millis();
    last_pick_ms = frame_started_ms;
    const splash_anim_def_t *a = &splash_anims[cur_anim];
    render_frame(a, 0);
    Serial.printf("splash: -> %s\n", a->name);
}

void splash_pick_for_current_rate(void) {
    if (SPLASH_ANIM_COUNT == 0) return;
    const splash_anim_def_t *next = pick_rate_anim(group_rotation);
    if (!next) return;

    cur_is_celebration = splash_celebrating();
    cur_anim = (uint16_t)(next - splash_anims);
    cur_frame = 0;
    frame_started_ms = millis();
    last_pick_ms = frame_started_ms;
    const splash_anim_def_t *a = &splash_anims[cur_anim];
    render_frame(a, 0);
    // Log the group path too, not just splash_next(). An animation that is in
    // splash_anims[] but missing from GROUP_NAMES renders perfectly when you
    // cycle to it by hand and is never once picked on its own, and without this
    // line the two cases look identical from outside the box. The group number
    // is here because the name alone doesn't tell you which list it came from.
    // Reading the output: USB-CDC holds a short line until the next write, so
    // these arrive in pairs 40 s apart rather than singly every 20 s. The picks
    // themselves are on time — don't go hunting for a double-advance bug.
    Serial.printf("splash: [g%d] -> %s\n", usage_rate_group(), a->name);
}

// Start the opening if this is the first show since boot and the animation is
// actually in the build. Returns false if it isn't, so the caller falls back to
// a normal pick rather than showing nothing — excluding or renaming "opening"
// must not leave a blank screen.
static bool splash_start_opening(void) {
    if (!opening_pending) return false;
    const splash_anim_def_t *a = find_anim(SPLASH_OPENING_ANIM);
    if (!a) { opening_pending = false; return false; }

    cur_anim = (uint16_t)(a - splash_anims);
    cur_frame = 0;
    frame_started_ms = millis();
    last_pick_ms = frame_started_ms;
    cur_is_opening = true;
    cur_is_celebration = false;
    render_frame(a, 0);
    Serial.printf("splash: opening (%u frames)\n", a->frame_count);
    return true;
}

bool splash_is_active(void) { return active; }

void splash_show(void) {
    // select animation; direct path defers the draw
    if (!splash_start_opening()) splash_pick_for_current_rate();
    if (splash_container) lv_obj_clear_flag(splash_container, LV_OBJ_FLAG_HIDDEN);
    active = true;
#if SPLASH_DIRECT_DRAW
    // LVGL fills the container black once on unhide; that would erase a creature
    // drawn now. Defer the full repaint to the next splash_tick(), which runs
    // after lv_timer_handler() in the main loop.
    force_full = true;
#endif
}

void splash_hide(void) {
    if (splash_container) lv_obj_add_flag(splash_container, LV_OBJ_FLAG_HIDDEN);
    active = false;
}

lv_obj_t* splash_get_root(void) {
    return splash_container;
}
