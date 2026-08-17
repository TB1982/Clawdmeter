#pragma once
#include <stdint.h>

// Runtime board description consumed by board-agnostic code (UI, main loop).
// Each board provides a single BoardCaps instance via board_caps().
//
// Compile-time-only facts (pin numbers, library choice) belong in
// boards/<name>/board.h and never leak into shared code. Anything the UI or
// main loop needs at runtime — display size, optional-feature presence —
// goes here so shared code stays free of #ifdef BOARD_*.
struct BoardCaps {
    const char* name;        // human-readable, e.g. "Waveshare AMOLED 2.16"

    int16_t width;           // active display width in pixels
    int16_t height;          // active display height in pixels

    uint8_t button_count;    // 1 = primary (BOOT) only; 2 = primary + secondary
    bool    has_rotation;    // IMU-driven CPU rotation in the flush callback

    // The quadrant imu_hal_rotation_quadrant() reports when the board is
    // sitting the way its owner considers upright. NOT always 0: quadrant 0 is
    // whatever the accelerometer's axes happen to call level, and how the panel
    // is mounted in its shell decides how that lines up with the way the thing
    // stands on a desk.
    //
    // Only orientation *gestures* need this — "turned a quarter turn from home"
    // is meaningless without knowing where home is. Display rotation does not:
    // it keeps content upright from the raw quadrant and does not care which
    // one is home.
    //
    // Measured, not assumed. The `rot` serial command prints the current
    // quadrant; hold the board the way it lives and read it off. On the 2.16
    // (three buttons along the top edge) the answer is 3, which is how this
    // field came to exist — the gesture shipped assuming 0 and every reading
    // came out exactly inverted.
    //
    // Meaningless on boards with has_rotation == false; they report 0 forever.
    uint8_t home_quadrant;
    bool    has_battery;     // AXP2101 battery measurement is meaningful
    bool    has_imu;         // QMI8658 (or compatible) is populated
};

const BoardCaps& board_caps(void);
