#include "sim_platform.h"
#include "board.h"
#include <SDL.h>
#include <Arduino.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

static bool quit = false;

static bool     pwr_down = false;
static uint32_t pwr_down_ms = 0;
static bool     pwr_long_fired = false;
static bool     edge_pressed = false, edge_long = false, edge_released = false;

static int  battery = 87;
static bool charging = false;

static bool take(bool* f) { bool v = *f; *f = false; return v; }
bool sim_take_pwr_pressed(void)  { return take(&edge_pressed); }
bool sim_take_pwr_long(void)     { return take(&edge_long); }
bool sim_take_pwr_released(void) { return take(&edge_released); }
static int rotation = 0;   // 0..3 quarter turns, cycled with the r key

int  sim_battery_pct(void) { return battery; }
// Quarter turns, same 0..3 the QMI8658 boards report. The sim fakes the
// sensor, not the panel: the SDL window does not physically turn, so what this
// exercises is everything downstream of the reading — the view selector in
// main.cpp — which is the part with logic in it. Rotating the pixels is the
// hardware board's own job and is tested there.
int  sim_rotation_quadrant(void) { return rotation; }
bool sim_charging(void)    { return charging; }
bool sim_should_quit(void) { return quit; }

// Matches the AXP2101 long-press threshold main.cpp's pair gesture expects.
#define PWR_LONG_MS 1500

static void key_down(SDL_Keycode k) {
    switch (k) {
    case SDLK_ESCAPE: quit = true; break;
    case SDLK_SPACE:  sim_playback_toggle(); break;
    case SDLK_LEFT:   sim_playback_step(-1); break;
    case SDLK_RIGHT:  sim_playback_step(+1); break;
    case SDLK_d:      sim_playback_toggle_link(); break;
    case SDLK_s:      sim_display_screenshot(NULL); break;
    case SDLK_c:      charging = !charging; break;
    case SDLK_r:      rotation = (rotation + 1) % 4; break;
    case SDLK_MINUS:  battery = battery < 5 ? 0 : battery - 5; break;
    case SDLK_EQUALS: battery = battery > 95 ? 100 : battery + 5; break;
    case SDLK_p:
        pwr_down = true;
        pwr_down_ms = millis();
        pwr_long_fired = false;
        break;
    default:
        if (k >= SDLK_1 && k <= SDLK_9) sim_playback_jump(k - SDLK_1);
        break;
    }
}

static void key_up(SDL_Keycode k) {
    if (k == SDLK_p && pwr_down) {
        pwr_down = false;
        if (!pwr_long_fired) edge_pressed = true;
        edge_released = true;
    }
}

// ─── Scripted input (SIM_SCRIPT) ─────────────────────────────────────────────
// The autoshot hook below can capture one frame of whatever the firmware boots
// into, which is always the splash. Every other screen — usage, its waiting
// panel, bluetooth — is reached by tapping, and every animation past the first
// is reached by the PWR button, so neither was observable without a human at
// the window. That is the same gap the hardware `screenshot` command left, and
// the reason UI iterations used to go through a temporary edit to main.cpp.
//
// SIM_SCRIPT is a comma-separated list of `ms:action[:arg]`, fired in order
// once the clock passes each `ms` (they need not be sorted):
//
//   600:tap              tap the centre of the panel
//   600:tap:240,300      tap x,y
//   1200:key:p           press and release a key (any from the key map)
//   1400:hold:p:1800     hold a key for N ms (PWR long-press / pair gesture)
//   2000:shot:out.bmp    screenshot to a path
//   2400:quit            exit
//
// A tap is held TAP_HOLD_MS so LVGL sees a press and a release on separate
// frames; overlapping taps just extend the hold.
// 32 was enough while a script meant "get to a screen and take one picture".
// Capturing a screen that moves needs one shot per frame of its loop, and a
// screen with two moving parts loops on their common multiple: the stocks
// screen is a 2400 ms coin band beside a 720 ms coin, so it repeats every
// 7200 ms and takes 48 shots at 150 ms to cover once. This costs 9 KB of
// static memory in a desktop binary; the firmware never compiles this file.
#define SIM_SCRIPT_MAX 64
#define TAP_HOLD_MS    120

typedef struct {
    uint32_t at_ms;
    char     action[8];
    char     arg[128];
    bool     fired;
} ScriptStep;

static ScriptStep script[SIM_SCRIPT_MAX];
static int        script_len = -1;      // -1 = not parsed yet

static uint16_t tap_x = 0, tap_y = 0;
static uint32_t tap_until_ms = 0;

static uint32_t hold_key_until_ms = 0;
static SDL_Keycode hold_key = SDLK_UNKNOWN;

static void script_parse(void) {
    script_len = 0;
    const char* env = getenv("SIM_SCRIPT");
    if (!env || !*env) return;

    char buf[2048];
    // snprintf truncates instead of failing, and what falls off the end of a
    // long script is its tail — the last shots and `quit`. Losing `quit` reads
    // as the simulator hanging rather than as a script that was too long, so
    // the one thing this must not do is stay quiet about it. Twenty shots with
    // absolute paths is enough to overrun this.
    if (snprintf(buf, sizeof(buf), "%s", env) >= (int)sizeof(buf))
        fprintf(stderr, "[sim] SIM_SCRIPT is longer than %zu bytes and was cut "
                        "short — use shorter shot paths\n", sizeof(buf));
    for (char* tok = strtok(buf, ","); tok && script_len < SIM_SCRIPT_MAX;
         tok = strtok(NULL, ",")) {
        while (*tok == ' ') tok++;
        ScriptStep s = {0};
        char* colon = strchr(tok, ':');
        if (!colon) { fprintf(stderr, "[sim] SIM_SCRIPT: no ':' in \"%s\"\n", tok); continue; }
        *colon = '\0';
        s.at_ms = (uint32_t)atol(tok);
        char* rest = colon + 1;
        char* colon2 = strchr(rest, ':');
        if (colon2) { *colon2 = '\0'; snprintf(s.arg, sizeof(s.arg), "%s", colon2 + 1); }
        snprintf(s.action, sizeof(s.action), "%s", rest);
        script[script_len++] = s;
    }
    fprintf(stderr, "[sim] SIM_SCRIPT: %d step%s\n", script_len,
            script_len == 1 ? "" : "s");
}

static void script_fire(const ScriptStep* s) {
    if (strcmp(s->action, "tap") == 0) {
        int x = LCD_WIDTH / 2, y = LCD_HEIGHT / 2;
        if (s->arg[0]) sscanf(s->arg, "%d,%d", &x, &y);
        tap_x = (uint16_t)x;
        tap_y = (uint16_t)y;
        tap_until_ms = millis() + TAP_HOLD_MS;
    } else if (strcmp(s->action, "key") == 0) {
        SDL_Keycode k = SDL_GetKeyFromName(s->arg);
        if (k == SDLK_UNKNOWN) { fprintf(stderr, "[sim] SIM_SCRIPT: unknown key \"%s\"\n", s->arg); return; }
        key_down(k);
        key_up(k);
    } else if (strcmp(s->action, "hold") == 0) {
        char name[64] = {0};
        long ms = 0;
        sscanf(s->arg, "%63[^:]:%ld", name, &ms);
        SDL_Keycode k = SDL_GetKeyFromName(name);
        if (k == SDLK_UNKNOWN) { fprintf(stderr, "[sim] SIM_SCRIPT: unknown key \"%s\"\n", name); return; }
        key_down(k);
        hold_key = k;
        hold_key_until_ms = millis() + (uint32_t)ms;
    } else if (strcmp(s->action, "shot") == 0) {
        sim_display_screenshot(s->arg[0] ? s->arg : NULL);
    } else if (strcmp(s->action, "quit") == 0) {
        quit = true;
    } else {
        fprintf(stderr, "[sim] SIM_SCRIPT: unknown action \"%s\"\n", s->action);
    }
}

bool sim_touch_override(uint16_t* x, uint16_t* y, bool* pressed) {
    if (!tap_until_ms) return false;
    if (millis() >= tap_until_ms) { tap_until_ms = 0; *pressed = false; *x = tap_x; *y = tap_y; return true; }
    *x = tap_x;
    *y = tap_y;
    *pressed = true;
    return true;
}

void sim_pump(void) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
        if (e.type == SDL_QUIT) quit = true;
        if (e.type == SDL_KEYDOWN && !e.key.repeat) key_down(e.key.keysym.sym);
        if (e.type == SDL_KEYUP) key_up(e.key.keysym.sym);
    }
    if (hold_key_until_ms && millis() >= hold_key_until_ms) {
        key_up(hold_key);
        hold_key_until_ms = 0;
        hold_key = SDLK_UNKNOWN;
    }
    if (pwr_down && !pwr_long_fired && millis() - pwr_down_ms >= PWR_LONG_MS) {
        pwr_long_fired = true;
        edge_long = true;
    }

    if (script_len < 0) script_parse();
    for (int i = 0; i < script_len; i++) {
        if (!script[i].fired && millis() >= script[i].at_ms) {
            script[i].fired = true;
            script_fire(&script[i]);
        }
    }

    // Headless CI hook: SIM_AUTOSHOT_MS=<ms> → screenshot + exit.
    static long autoshot_ms = -2;
    if (autoshot_ms == -2) {
        const char* v = getenv("SIM_AUTOSHOT_MS");
        autoshot_ms = v ? atol(v) : -1;
    }
    if (autoshot_ms >= 0 && millis() >= (uint32_t)autoshot_ms) {
        const char* p = getenv("SIM_AUTOSHOT_PATH");
        sim_display_screenshot(p ? p : "sim-autoshot.bmp");
        quit = true;
        autoshot_ms = -1;
    }
}
