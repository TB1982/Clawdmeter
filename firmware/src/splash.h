#pragma once
#include <stdint.h>
#include <lvgl.h>

// Initialize splash module. Creates the canvas widget inside `parent` and
// allocates the 480x480 pixel buffer (PSRAM).
void splash_init(lv_obj_t *parent);

// Advance animation frame if hold time elapsed. Call from main loop.
void splash_tick(void);

// Cycle to the next animation in the catalog.
void splash_next(void);

// Show/hide the splash container.
void splash_show(void);
void splash_hide(void);

// Pick the next animation matching the current usage-rate group.
// Called automatically by splash_show(); also exposed so other modules can
// trigger a re-pick when the rate group changes mid-display.
void splash_pick_for_current_rate(void);

// Override the rate-driven pick with a celebration for SPLASH_CELEBRATE_MS,
// then hand back to the rate logic. Applies to the full-screen splash AND to
// every rate-following mini creature, so the corner badge joins in.
//
// Fired when the 5-hour window refills. Without it that moment reads backwards:
// a reset clears the rate ring, which drops the group to idle, so the instant
// your quota returns he goes to sleep.
void splash_celebrate(void);

// True while a celebration is running.
bool splash_celebrating(void);

// True when splash is currently rendering (used to gate re-picks).
bool splash_is_active(void);

// Root container (so ui.cpp can attach a click event).
lv_obj_t* splash_get_root(void);

// Mini animated creature for embedding elsewhere (the waiting-for-data panel on
// the usage screen, the corner badge on it). Each instance owns its canvas,
// buffer and frame clock, so several can run at once.
//
// `anim_name` picks an animation by name (e.g. "idle look around", which is
// what the waiting panel asks for — the only literal name outside splash.cpp);
// pass NULL to follow the live usage-rate group instead, re-picking on the same
// cadence as the full-screen splash. Renders at ~px×px inside `parent`.
// Returns NULL if the animation isn't found or allocation fails.
//
// Position the instance via splash_mini_canvas(); drive it with
// splash_mini_tick(). Both are NULL-safe.
typedef struct splash_mini splash_mini_t;

splash_mini_t* splash_mini_create(lv_obj_t *parent, const char *anim_name, int px);
lv_obj_t*      splash_mini_canvas(splash_mini_t *m);
void           splash_mini_tick(splash_mini_t *m);
// Show one frame and hold it. Do not also call splash_mini_tick() on the same
// instance — an indicator that animates is an indicator that lies.
void           splash_mini_set_frame(splash_mini_t *m, uint16_t frame);
// Point an existing instance at a different animation, keeping its canvas and
// buffer. Returns false and changes nothing if the name is not in the build, so
// the caller can use it as an existence test. NULL name is not accepted: a mini
// created to follow the usage rate keeps doing that, and one created by name
// stays by name — switching a mini between the two mid-life would mean two
// different sets of fields being live and is not a thing anything needs.
//
// This is the same swap a rate-following mini already does to itself when the
// group changes; mini_render() re-derives the cell size, so the new animation
// may be a different grid than the buffer was first filled for.
bool           splash_mini_set_anim(splash_mini_t *m, const char *anim_name);
