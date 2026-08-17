#include "../../hal/imu_hal.h"
#include "sim_platform.h"

// The r key cycles quarter turns. Real boards get this from an accelerometer
// with a 300 ms debounce; here it is a keypress, because a keypress is already
// a deliberate act and there is nothing to settle.
void    imu_hal_init(void) {}
void    imu_hal_tick(void) {}
uint8_t imu_hal_rotation_quadrant(void) { return (uint8_t)sim_rotation_quadrant(); }
