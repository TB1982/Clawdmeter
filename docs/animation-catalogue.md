# What is on the device

**Generated — do not hand-edit.** Rebuild it with:

```bash
node tools/sync_animations.js
```

Read from `firmware/src/splash_animations.h` and `firmware/src/splash.cpp`, so
it cannot disagree with the build. For *why* an animation looks the way it does,
see [`animation-craft.md`](animation-craft.md); for how the pipeline works, see
[`../tools/README.md`](../tools/README.md).

10 animations are compiled in. The splash shows one for **20,000 ms** and then advances to the next entry in the group the current
usage rate selects, wrapping at the end. The order below *is* the playback order:
slot 0 is what you meet at boot, and the last slot is what loops back into it.

## Group 0 — idle

4 of 9 slots · one full round is 80 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | swim summer | 16 | 6,320 ms | 3.16 |
| 2 | hanabi | 30 | 10,000 ms | 2 ✓ |
| 3 | rainy days | 18 | 2,700 ms | 7.41 |
| 4 | space | 8 | 4,000 ms | 5 ✓ |

## Group 1 — normal

1 of 9 slots · one full round is 20 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | work out | 8 | 2,400 ms | 8.33 |

## Group 2 — active

1 of 9 slots · one full round is 20 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | work mode | 152 | 20,000 ms | 1 ✓ |

## Group 3 — heavy

2 of 9 slots · one full round is 40 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | surfing | 8 | 2,400 ms | 8.33 |
| 2 | this is fine | 10 | 2,000 ms | 10 ✓ |

A ✓ means the loop divides the slot exactly, so it is never cut part-way. 4 of 8 do: hanabi, space, work mode, this is fine.

## Not picked by a rate group

| animation | role |
|---|---|
| opening | `SPLASH_OPENING_ANIM` |
| hanabi | `SPLASH_CELEBRATE_ANIM` |
| waiting | named directly by `ui.cpp` |

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
