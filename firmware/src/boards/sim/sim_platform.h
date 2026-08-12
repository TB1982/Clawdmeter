#pragma once
#include <stdint.h>

// Glue between the SDL event pump and the individual HAL stubs. Everything
// is single-threaded — sim_pump() runs once per loop() iteration, called
// from sim_main.cpp before loop().

void sim_pump(void);
bool sim_should_quit(void);

// Implemented in display.cpp (owns the SDL window).
void sim_display_set_title(const char* title);
void sim_display_screenshot(const char* path);  // NULL → auto-numbered sim-shot-N.bmp

// PWR button edges + fake battery, consumed by power.cpp.
bool sim_take_pwr_pressed(void);
bool sim_take_pwr_long(void);
bool sim_take_pwr_released(void);
int  sim_battery_pct(void);
bool sim_charging(void);

// Scripted input (SIM_SCRIPT), consumed by touch.cpp. While a scripted tap is
// held this returns true and overrides the mouse; otherwise touch.cpp reads
// SDL_GetMouseState as usual. Needed because SDL_PushEvent does not update the
// internal mouse-button state that SDL_GetMouseState reports, so a synthetic
// tap cannot go through the event queue.
bool sim_touch_override(uint16_t* x, uint16_t* y, bool* pressed);

// Scenario playback controls, implemented in ble_sim.cpp.
void sim_playback_toggle(void);
void sim_playback_step(int dir);
void sim_playback_jump(int idx);      // 0-based
void sim_playback_toggle_link(void);  // BLE connected <-> disconnected
