#include "../../hal/board_caps.h"
#include "board.h"

static const BoardCaps caps = {
    .name = BOARD_NAME,
    .width = LCD_WIDTH,
    .height = LCD_HEIGHT,
    .button_count = 2,
    .has_rotation = true,
    // Measured with the `rot` serial command, board upright with its
    // three buttons along the top edge: quadrant 3, not 0.
    .home_quadrant = 3,
    .has_battery = true,
    .has_imu = true,
};

const BoardCaps& board_caps(void) { return caps; }
