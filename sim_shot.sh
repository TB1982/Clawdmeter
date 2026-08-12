#!/usr/bin/env bash
# Screenshot the firmware without hardware.
#
# Runs the native simulator headless, drives it with SIM_SCRIPT, and converts
# the BMP it writes to PNG so the result can be looked at directly.
#
#   ./sim_shot.sh out.png                       the boot splash
#   ./sim_shot.sh out.png "1000:tap"            tap once, then shoot -> usage
#   ./sim_shot.sh out.png "600:key:p,800:key:p" two PWR presses -> 3rd animation
#
# The second argument is a SIM_SCRIPT (see boards/sim/sim_platform.cpp). The
# shot and quit steps are appended automatically; --at <ms> moves the shot
# (default 2500), which is also how you choose *which frame* of an animation
# you get.
#
# This replaces the hardware loop for anything that isn't panel-specific:
# before it, every UI iteration meant flashing a board, running screenshot.sh
# over serial, and — for any screen past the splash — either asking a human to
# press a button or temporarily editing main.cpp's boot screen. Panel-specific
# behaviour (column offsets, rotation, even-aligned flushes) lives in the
# hardware boards and still has to be checked on real hardware.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIO="$(command -v pio || echo "$HOME/.platformio/penv/bin/pio")"

OUT="${1:-sim-shot.png}"
SCRIPT="${2:-}"
AT=2500
if [ "${3:-}" = "--at" ]; then AT="${4:?--at needs a value in ms}"; fi

case "$OUT" in
  /*) ;;
  *) OUT="$PWD/$OUT" ;;
esac
BMP="${OUT%.png}.bmp"

"$PIO" run -d "$HERE/firmware" -e sim >/dev/null 2>&1 || {
  echo "build failed; running it again with output:" >&2
  "$PIO" run -d "$HERE/firmware" -e sim
  exit 1
}

# The shot fires at $AT and the quit two frames later, so the screenshot is
# written before the loop tears down. Steps need not be sorted, so the caller's
# script is simply prefixed.
FULL="${SCRIPT:+$SCRIPT,}${AT}:shot:${BMP},$((AT + 200)):quit"

cd "$HERE/firmware"
SDL_VIDEODRIVER=dummy SIM_SCRIPT="$FULL" .pio/build/sim/program 2>&1 \
  | grep -E '^(splash:|screenshot:|\[sim\])' || true

if   command -v sips  >/dev/null 2>&1; then sips -s format png "$BMP" --out "$OUT" >/dev/null
elif command -v magick >/dev/null 2>&1; then magick "$BMP" "$OUT"
elif command -v convert >/dev/null 2>&1; then convert "$BMP" "$OUT"
else
  echo "No sips/ImageMagick; leaving the BMP at $BMP" >&2
  exit 0
fi
rm -f "$BMP"
echo "wrote $OUT"
