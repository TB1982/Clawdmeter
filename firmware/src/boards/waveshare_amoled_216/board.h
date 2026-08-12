#pragma once

// Waveshare ESP32-S3-Touch-AMOLED-2.16 — original square AMOLED kit.
// 480x480 CO5300 + CST9220 touch + AXP2101 PMU + QMI8658 IMU.
// IMU-driven CPU rotation is enabled.

#define BOARD_NAME           "Waveshare AMOLED 2.16"

// ---- Display geometry (matches BoardCaps; duplicated here as compile-time
// constants because the buffer-size math runs at file scope) ----
#define LCD_WIDTH            480
#define LCD_HEIGHT           480

// ---- QSPI display pins (CO5300) ----
#define LCD_CS               12
#define LCD_SCLK             38
#define LCD_SDIO0            4
#define LCD_SDIO1            5
#define LCD_SDIO2            6
#define LCD_SDIO3            7
// Was 2 from the original port until 2026-08-12, which is the TF slot's clock
// line, not the panel's reset — proven by mounting a card on GPIO 1/2/3/41
// while the display carried on unaffected: SPI cannot enumerate a card unless
// the clock actually reaches it. So the old value drove nothing, and the panel
// has always come up on its own power-on reset. Harmless until a card is
// inserted; wrong the moment one is.
#define LCD_RESET            39

// ---- I2C bus (touch + PMU + IMU) ----
#define IIC_SDA              15
#define IIC_SCL              14

// ---- Touch (CST9220 via TouchDrvCST92xx library) ----
#define TP_INT               11
#define TP_RST               40    // was 2 — see LCD_RESET above; not shared
#define CST9220_ADDR         0x5A

// ---- PMU ----
#define AXP2101_ADDR         0x34

// ---- Buttons ----
#define BTN_BACK_GPIO        0     // BOOT — primary, Space (PTT)
#define BTN_FWD_GPIO         18    // secondary, Shift+Tab (mode toggle)

// ---- Audio (ES8311 mono codec + onboard speaker, I2S) ----
// Used to chime on session-usage reset. Pins + codec verified against
// Waveshare's factory 07_ES8311 example for this exact board. The ES8311 shares
// the I2C bus above (addr 0x18); the external power amp is gated by SND_PA_PIN
// (drive HIGH to enable). MCLK/WS/PA sit on strapping-capable pins (42/45/46)
// but are only driven after boot, exactly as Waveshare's own firmware does.
#define SND_I2S_MCLK         42
#define SND_I2S_BCLK         9
#define SND_I2S_WS           45     // LRCK
#define SND_I2S_DOUT         8      // ESP → ES8311 (speaker)
#define SND_I2S_DIN          10     // ES8311 → ESP (mic; unused, set for STD mode)
#define SND_PA_PIN           46     // power-amp enable, HIGH = on
#define SND_SAMPLE_RATE      44100
#define SND_ES8311_ADDR      0x18

// ---- microSD / TF slot (present, wired, unused by this firmware) ----
// SPI, and verified on hardware 2026-08-12: a 4 GB card enumerated as SDHC and
// its root directory listed, on these pins, with the display and touch running
// normally throughout. That measurement is what established LCD_RESET/TP_RST
// above were pointing at SD_SCK — SPI cannot enumerate a card unless the clock
// actually reaches it.
//
// Nothing drives these yet. The reason to care: the splash renderer reads frame
// data through a plain `const uint8_t *` (splash_frame() in
// splash_animations.h), so it does not care whether that points into flash or
// into PSRAM. Animations could be loaded from a card into the 8 MB PSRAM at
// runtime without the renderer changing at all — what is missing is a file
// format, a loader, and a runtime animation table in place of the generated
// `static const splash_anims[]`. Not needed yet: after the claudepix cull the
// 2.16 build has ~1.4 MB of flash spare.
#define SD_MOSI              1
#define SD_SCK               2
#define SD_MISO              3
#define SD_CS                41

// ---- Capability flags (compile-time; redundant with BoardCaps but lets
// the linker dead-strip whole functions on boards that don't need them) ----
#define BOARD_HAS_SECONDARY_BUTTON 1
#define BOARD_HAS_ROTATION         1
#define BOARD_HAS_IMU              1
#define BOARD_HAS_BATTERY          1
#define BOARD_HAS_IO_EXPANDER      0
#define BOARD_HAS_SOUND            1
