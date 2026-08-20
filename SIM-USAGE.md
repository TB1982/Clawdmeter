# Desktop simulator (`-e sim`) — usage

The native desktop simulator runs the full firmware loop in an SDL2 window
standing in for the 480×480 AMOLED — `main.cpp`, `ui.cpp`, `splash.cpp`, idle
fade, pair gesture, JSON parsing, and usage-rate/chime logic all run
unmodified. Only `ble.cpp`/`chime.cpp` are swapped for stubs. Sources live in
`firmware/src/boards/sim/` (HAL against SDL2 + Arduino shims in `shim/`), with
scenario data in `firmware/sim/`.

## Build & run

```bash
sudo apt install libsdl2-dev        # one-time (macOS: brew install sdl2)
pio run -d firmware -e sim
cd firmware && .pio/build/sim/program
```

Launch from the `firmware/` directory — the default scenario path
(`sim/scenario.jsonl`) is resolved relative to it.

## Controls

| Key | Action |
|---|---|
| mouse / left-drag | touch (tap toggles splash ↔ usage) |
| `space` | play/pause scenario playback |
| `←` / `→` | step one scenario state (pauses playback) |
| `1`–`9` | jump to scenario state N (pauses playback) |
| `d` | toggle BLE connected/disconnected |
| `b` (hold) | PRIMARY button (BOOT — HID Space PTT on hardware) |
| `n` (hold) | SECONDARY button (HID Shift+Tab on hardware) |
| `p` | PWR button (short press; hold ~3s + release = pair gesture) |
| `c` | toggle charging |
| `-` / `=` | battery down / up 5% |
| `r` | turn a quarter turn (0–3) — selects the weather / stocks views |
| `s` | save screenshot BMP to the current directory |
| `esc` / window close | quit |

Full, authoritative map: `firmware/src/boards/sim/board.h`.

## Scenarios

`firmware/sim/scenario.jsonl` plays in a loop — one JSON object per line, the
daemon payload plus two optional keys:

- `"name"` — shown in the window title
- `"hold_ms"` — time on this state (default 3000)

Lines starting with `#` are comments. Lines containing an `"ss"` array are
**session payloads** (issue #135 wire format) and go out on the session
characteristic path; everything else is a quota payload.

Session row format:

```
[sid, label, state, ctx%, elapsed_s, model, tool, ntools, nagents, tdone, ttotal, tok]
```

States: 0 starting · 1 idle · 2 thinking · 3 responding · 4 running-tool ·
5 compacting · 6 needs-permission · 7 asking-you · 8 needs-input · 9 error.
`tok` is context tokens in 1k units (190 = 190k); `-1`/absent = unknown.

Override the scenario file with `SIM_SCENARIO=<path>`. If the file is missing,
a small built-in state list is used.

## Headless screenshots (CI-friendly)

```bash
SDL_VIDEODRIVER=dummy SIM_AUTOSHOT_MS=6000 .pio/build/sim/program
```

Saves `sim-autoshot.bmp` (override with `SIM_AUTOSHOT_PATH`) after the given
delay and exits.

### `SIM_SCRIPT` — drive it without a human at the window

An autoshot alone only ever captures the boot screen. `SIM_SCRIPT` presses the
keys and taps the screen for you, so no screen needs a temporary edit to
`main.cpp` to be reachable — which is the edit that gets committed by accident.

Comma-separated `ms:action[:arg]`, fired once the clock passes each `ms` (the
order you write them in does not matter):

| step | |
|---|---|
| `600:tap` / `600:tap:240,300` | tap the centre, or a point |
| `1200:key:p` | press and release any key from the map above |
| `1400:hold:p:1800` | hold a key (PWR long-press → the pair gesture) |
| `2000:shot:out.bmp` | screenshot |
| `2400:quit` | exit |

### `./sim_shot.sh` — all of it in one line

```bash
./sim_shot.sh usage.png "1000:tap"                        # tap through to the usage screen
./sim_shot.sh anim.png "600:key:p,800:key:p" --at 4000    # 3rd animation, 4 s in
./sim_shot.sh weather.png "600:key:r"                     # a quarter turn
```

Builds, runs headless, appends the shot and quit steps, converts BMP → PNG.
`--at <ms>` moves the shot, which is also how you pick *which frame* of an
animation you capture.

### Capturing a screen that moves

A still cannot show the weather screen, because most of what is new about it is
the creature. `export_gif.js` is no help either — it renders an animation on its
own, and this is a composed screen: title, moon, battery, temperature, creature.
So the frames come off the simulator and are assembled afterwards.

Space the shots at the animation's own hold and take exactly one loop's worth,
and the GIF closes seamlessly with no editing. `rainy` is 20 frames at 85 ms, so
twenty shots 85 ms apart *is* the loop:

```bash
# 2 = the scenario entry with wx 63, r = a quarter turn to the weather screen
SIM_SCRIPT="800:key:2,1200:key:r,2000:shot:s00.bmp,2085:shot:s01.bmp,…,3615:shot:s19.bmp,3915:quit" \
  SDL_VIDEODRIVER=dummy .pio/build/sim/program

ffmpeg -framerate 12.5 -i s%02d.bmp -filter_complex \
  "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
  -loop 0 weather.gif
```

A whole screen is around 54 distinct colours — RGB565 through LVGL, not
photography — so a GIF palette holds all of them and the result is
pixel-identical to what the panel would draw. Worth checking rather than
assuming: `cmp` the first GIF frame against the first BMP.

Two things that will bite:

**`SIM_SCRIPT` is parsed through a 1024-byte buffer.** Twenty shots with
absolute paths overrun it, and what falls off the end is silently dropped —
including `quit`, so the run appears to hang instead of failing. Use short
relative names (the program's own directory is the working directory) and read
the `[sim] SIM_SCRIPT: N steps` line it prints to confirm N is what you wrote.

**GIF delays are whole centiseconds**, so an 85 ms hold becomes 80 and the loop
plays about 6% fast. Invisible on rain; worth knowing before matching a GIF
against a stopwatch.

## Caveat

The sim mirrors the S3 2.16 geometry but renders with desktop LVGL and fake
data. It's ideal for iterating UI layouts, but panel-level behavior — column
offsets, rotation, flush rounding — lives in the hardware board folders, so
always do a final check on real hardware before merging panel-related changes.
