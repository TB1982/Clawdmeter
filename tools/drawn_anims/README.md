# Hand-edited animations

Drop-in directory. Anything you export from `tools/anim_editor.html` goes here,
and `convert_to_c.js` picks it up on the next run — no index to maintain, no
list to edit.

What's already here are corrections to the claudepix originals, not variants of
them, which is why they carry the same names and override rather than sit
alongside:

| | |
|---|---|
| `expression sleep` | the snore bubble was drawn in the body colour — an orange snore |
| `work think` | same defect one animation over: the thought marks were body-coloured too |
| `dance bounce dj` | his head sat on row 0, so the headphone band arced outside the grid and was cropped away entirely, leaving two ear cups with nothing joining them |
| `work coding`, `expression wink`, `expression surprise` | redrawn for legibility at 4px/cell |

`idle hearts`, `idle blossom`, `work out` and `swim summer` are new rather than
corrections. `work out` has him doing alternating dumbbell curls, two frames per
rep, holding the top of each one twice as long as the lift. `swim summer` —
sunglasses, a rubber ring, water — carries the catalogue's only two-speed loop:
eight frames at 70 ms for a glint sweeping across the lenses, then eight at
700-780 ms of drifting. Half a second of sparkle, six seconds of doing nothing.

> **Correction, 2026-08-12.** This file used to say `swim summer` was "`dance
> bob` redrawn past recognition". It is not derived from `dance bob` at all —
> Nova drew it from scratch and reused that name when saving. The claim
> travelled into `splash.cpp`'s group comments too, and both are fixed. Kept
> here rather than deleted because a provenance note that was wrong once is
> worth being able to see was wrong.

**As of 2026-08-12 no claudepix animation ships.** The corrections listed above
are excluded from the firmware along with the originals they correct — see
`EXCLUDE` in `tools/convert_to_c.js` for the list and the reasoning. The files
stay here and in `claudepix_data/`, so every one of them is still loadable in
the editor and any of them can be brought back by deleting a line from that
list. What reaches the device is now Nova's own drawings, with Anthropic's
official art to follow.

The corrections remain derivative of [claudepix](https://claudepix.vercel.app)
by [@amaanbuilds](https://x.com/amaanbuilds) and of Anthropic's character — see
the license note in `tools/README.md`.

```bash
open tools/anim_editor.html      # draw, then "下載 .json" / Download .json
mv ~/Downloads/my_anim.json tools/drawn_anims/
node tools/convert_to_c.js       # → firmware/src/splash_animations.h
node tools/build_editor_samples.js   # optional: make it loadable in the editor
```

## Replacing an existing animation

Give the file the **same `name`** as the one you want to replace and it wins:
later directories override earlier ones by name, so a file here replaces the
scraped one it shares a name with instead of being emitted alongside it.

That's not a nicety. Two animations with the same name produce the same C
identifiers, and the firmware fails to compile on a redefinition — which reads
like a toolchain fault rather than "you have two copies of the same animation".

## Getting it on screen

Adding a file is not enough. `splash.cpp` picks animations from `GROUP_NAMES`,
matched by literal name, and anything not listed in a group is never chosen. If
you added a new name rather than replacing an existing one, add it to a group
too.

## Format

```json
{
  "name": "idle wave",
  "category": "Idle",
  "palette": ["transparent", "#D97757", "#0F0F0F"],
  "frames": [{ "hold": 400, "grid": [[0,0,...20 values...], ...20 rows... ] }]
}
```

Grid side and palette cap both come from `tools/lib/format.js`, which is the
one place they are defined — don't copy the numbers here, they have drifted
before. At the time of writing that is 20×20 or 40×40, and at most 36 palette
entries. (No 40×40 animation has been checked on the two C6 boards: those
render one pixel per cell and let LVGL upscale, so the scale factor is a
property of the grid side and mixing sizes trips a `static_assert` in
`splash.cpp`.) Cell values index the palette — every one must be less than the
number of entries you declared — and holds are in ms.
`convert_to_c.js` validates all of it and fails loudly — the firmware reads
these arrays with fixed strides and no bounds checks, so a 19-row grid doesn't
produce a wrong picture, it produces a device reading past the end of an array.

Files beginning with `_` are ignored by the converter, so an index or a note
can live in here without being mistaken for an animation.

If you'd rather start from the creature than from an empty grid, the editor's
"Load Clawd template" button gives you his base pose as a single frame.
