# What is on the device

**Generated — do not hand-edit.** Rebuild it with:

```bash
node tools/sync_animations.js
```

Read from `firmware/src/splash_animations.h` and `firmware/src/splash.cpp`, so
it cannot disagree with the build. For *why* an animation looks the way it does,
see [`animation-craft.md`](animation-craft.md); for how the pipeline works, see
[`../tools/README.md`](../tools/README.md).

21 animations are compiled in. The splash shows one for **20,000 ms** and then advances to the next entry in the group the current
usage rate selects, wrapping at the end. The order below *is* the playback order:
slot 0 is what you meet at boot, and the last slot is what loops back into it.

## Group 0 — idle

8 of 9 slots · one full round is 160 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | idle hearts | 16 | 4,420 ms | 4.52 |
| 2 | swim summer | 16 | 6,320 ms | 3.16 |
| 3 | hanabi | 22 | 7,300 ms | 2.74 |
| 4 | rainy days | 18 | 2,700 ms | 7.41 |
| 5 | idle blossom | 6 | 1,320 ms | 15.15 |
| 6 | fm listening | 16 | 3,080 ms | 6.49 |
| 7 | expression wink | 10 | 2,340 ms | 8.55 |
| 8 | space | 8 | 4,000 ms | 5 ✓ |

## Group 1 — normal

4 of 9 slots · one full round is 80 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | idle look around | 17 | 6,300 ms | 3.17 |
| 2 | work think | 31 | 9,140 ms | 2.19 |
| 3 | work coding | 24 | 5,380 ms | 3.72 |
| 4 | work out | 8 | 2,400 ms | 8.33 |

## Group 2 — active

3 of 9 slots · one full round is 60 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | work mode | 152 | 20,000 ms | 1 ✓ |
| 2 | expression surprise | 12 | 3,080 ms | 6.49 |
| 3 | dance bounce | 16 | 1,540 ms | 12.99 |

## Group 3 — heavy

3 of 9 slots · one full round is 60 s

| # | animation | frames | one loop | loops per slot |
|---|---|---|---|---|
| 1 | surfing | 8 | 2,400 ms | 8.33 |
| 2 | this is fine | 10 | 2,000 ms | 10 ✓ |
| 3 | dance djmix | 16 | 1,640 ms | 12.20 |

A ✓ means the loop divides the slot exactly, so it is never cut part-way. 3 of 18 do: space, work mode, this is fine.

## Not picked by a rate group

| animation | role |
|---|---|
| opening | `SPLASH_OPENING_ANIM` |
| dance djmix | `SPLASH_CELEBRATE_ANIM` |
| idle look around | named directly by `ui.cpp` |

A name in this table cannot be excluded from the build without breaking the
thing that asks for it — unlike a group entry, which only stops being picked.

## In the build, picked by nothing

- `dance bob` — 4 frames, 1,120 ms
- `work type` — 4 frames, 640 ms

These cost flash and never appear. That is a legitimate choice, but it should
be a choice — `node tools/check_groups.js` prints this list too, so a name that
landed here by accident shows up rather than going quiet.

## Drawn, but kept out of the firmware

`EXCLUDE` in `tools/convert_to_c.js`. They remain loadable as editor samples,
so a retired animation can still be opened and reworked:

- idle breathe
- idle blink
- dance sway
- dance sway dj
- dance bounce dj
- expression sleep
