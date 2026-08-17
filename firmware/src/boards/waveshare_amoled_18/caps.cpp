#include "../../hal/board_caps.h"
#include "board.h"

static const BoardCaps caps = {
    .name = BOARD_NAME,
    .width = LCD_WIDTH,
    .height = LCD_HEIGHT,
    .button_count = 1,
    .has_rotation = false,
    .home_quadrant = 0,   // no rotation on this board; the field is inert
    .has_battery = true,
    .has_imu = true,
};

const BoardCaps& board_caps(void) { return caps; }
