# What is on the device

**Generated — do not hand-edit.** Rebuild it with:

```bash
node tools/sync_animations.js
```

Read from `firmware/src/splash_animations.h` and `firmware/src/splash.cpp`, so
it cannot disagree with the build. For *why* an animation looks the way it does,
see [`animation-craft.md`](animation-craft.md); for how the pipeline works, see
[`../tools/README.md`](../tools/README.md).

26 animations are compiled in. The splash shows one for **20,000 ms** and then advances to the next entry in the group the current
usage rate selects, wrapping at the end. The order below *is* the playback order:
slot 0 is what you meet at boot, and the last slot is what loops back into it.

## Group 0 — idle

6 of 9 slots · one full round is 120 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | lurking | 24 | 4,330 ms | 4.62 |
| 2 | swim summer | 16 | 6,320 ms | 3.16 |
| 3 | rainy days | 18 | 2,700 ms | 7.41 |
| 4 | hanabi | 30 | 10,000 ms | 2 ✓ |
| 5 | waiting | 25 | 5,000 ms | 4 ✓ |
| 6 | space | 8 | 4,000 ms | 5 ✓ |

## Group 1 — normal

5 of 9 slots · one full round is 100 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | work out | 8 | 2,400 ms | 8.33 |
| 2 | walking | 8 | 1,080 ms | 18.52 |
| 3 | waving | 7 | 830 ms | 24.10 |
| 4 | crab walking | 9 | 1,000 ms | 20 ✓ |
| 5 | pointing | 26 | 2,830 ms | 7.07 |

## Group 2 — active

6 of 9 slots · one full round is 120 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | work mode | 152 | 20,000 ms | 1 ✓ |
| 2 | laptop | 23 | 2,490 ms | 8.03 |
| 3 | dancing | 20 | 3,330 ms | 6.01 ✓ |
| 4 | basketball | 38 | 3,910 ms | 5.12 |
| 5 | soccer | 50 | 5,063 ms | 3.95 |
| 6 | skateboard | 50 | 5,660 ms | 3.53 |

## Group 3 — heavy

7 of 9 slots · one full round is 140 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | surfing | 8 | 2,400 ms | 8.33 |
| 2 | racing car | 40 | 4,010 ms | 4.99 |
| 3 | this is fine | 10 | 2,000 ms | 10 ✓ |
| 4 | cloud | 44 | 4,410 ms | 4.54 |
| 5 | sailing scene | 36 | 5,660 ms | 3.53 |
| 6 | trumpet | 34 | 4,010 ms | 4.99 |
| 7 | jumping happy | 14 | 1,760 ms | 11.36 |

A ✓ means the loop divides the slot exactly, so it is never cut part-way. 7 of 24 do: hanabi, waiting, space, crab walking, work mode, dancing, this is fine.

## Not picked by a rate group

| animation | role |
|---|---|
| opening | `SPLASH_OPENING_ANIM` |
| hanabi | `SPLASH_CELEBRATE_ANIM` |
| magnifier | named directly by `ui.cpp` |

A name in this table cannot be excluded from the build without breaking the
thing that asks for it — unlike a group entry, which only stops being picked.

## In the build, picked by nothing

None — everything compiled in is reachable.

## Drawn, but kept out of the firmware

`EXCLUDE` in `tools/convert_to_c.js`. They remain loadable as editor samples,
so a retired animation can still be opened and reworked:

- idle breathe
- idle blink
- dance sway
- dance sway dj
- dance bounce dj
- expression sleep
- idle look around
- dance bounce
- expression surprise
- work think
- expression wink
- work coding
- dance djmix
- idle hearts
- idle blossom
- fm listening
- dance bob
- work type
