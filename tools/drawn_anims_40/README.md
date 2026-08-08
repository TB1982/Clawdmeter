# drawn_anims_40 — 40x40 animations, deliberately not in the default build

`convert_to_c.js` scans `claudepix_data/`, `custom_anims/` and `drawn_anims/`
by default. This directory is **not** in that list, on purpose.

A 40x40 animation raises the generated `SPLASH_GRID_MAX` to 40, and on the
PSRAM-less C6 boards that trips the `static_assert` in `splash.cpp`: those
builds render one pixel per cell and let LVGL upscale the whole image, so the
scale factor is a property of the grid side. Mixing sizes there needs
per-animation `lv_image_set_scale`, on the one render path that neither the
`screenshot` command nor a host test can reach — `LV_USE_SNAPSHOT` is off
without PSRAM, so only real C6 hardware can check it.

Keeping the art here means it is version-controlled and not lost, while every
board environment still builds.

## Building it in

```bash
node tools/convert_to_c.js --in claudepix_data,custom_anims,drawn_anims,drawn_anims_40
```

Verified 2026-08-08: the four PSRAM boards (2.16, 1.8, 2.06, 1.54) compile and
link with `hanabi big` included; both C6 environments stop at the
`static_assert`, which is the guard doing its job.

## Before this can ship

1. Wire up per-animation `lv_image_set_scale` on the PSRAM-less render path in
   `splash.cpp`, and verify it on real C6 hardware. Only then delete the
   `static_assert`.
2. Add the animation's name to a rate group in `splash.cpp` (`GROUP_NAMES`).
   `"hanabi big"` is in no group today, so it would never be picked even in a
   build that contains it — the catalog is matched by literal name.
Editing these is no longer a gap: `anim_editor.html` carries a size control and
opens, edits and exports 40x40. Growing a 20x20 animation into one is lossless
(each cell becomes a 2x2 block), so an existing animation can be loaded, grown
and then refined.
