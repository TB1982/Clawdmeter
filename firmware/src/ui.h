#pragma once
#include "data.h"
#include "ble.h"

enum screen_t {
    SCREEN_SPLASH,
    SCREEN_USAGE,
    // Reached by turning the device, not by a button — see the orientation
    // block in main.cpp. Boards whose BoardCaps.has_rotation is false have no
    // way to select it, which is deliberate: it is a gesture, and a board that
    // cannot sense the gesture should not carry a screen you cannot get to.
    SCREEN_WEATHER,
    SCREEN_COUNT,
};

void ui_init(void);
void ui_update(const UsageData* data);
void ui_tick_anim(void);
void ui_show_screen(screen_t screen);
void ui_toggle_splash(void);
screen_t ui_get_current_screen(void);
void ui_update_ble_status(ble_state_t state, const char* name, const char* mac);
void ui_update_battery(int percent, bool charging);
