#include "../../hal/board_caps.h"
#include "board.h"

static const BoardCaps caps = {
    .name = BOARD_NAME,
    .width = LCD_WIDTH,
    .height = LCD_HEIGHT,
    .button_count = 2,      // B and N keys stand in for BOOT + GPIO18
        // True so the orientation-driven view selector is reachable here. It does
    // NOT mean the window rotates — see sim_rotation_quadrant().
    .has_rotation = true,
    .has_battery = true,    // fake battery, adjustable with -/=
    .has_imu = true,     // faked by the r key
};

const BoardCaps& board_caps(void) { return caps; }
