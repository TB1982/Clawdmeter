# Asset tools

Pipeline for getting 20×20 pixel animations — scraped or your own — onto the device.

This file is the machinery. [`docs/animation-craft.md`](../docs/animation-craft.md)
is the craft: which shapes survive at this size, what the preview can and cannot
show you, and the mistakes already made and paid for. Dated, so a claim there can
be read as history rather than as an instruction that may have gone stale.

[`docs/animation-contract.md`](../docs/animation-contract.md) is the third one,
and it is written for readers outside this repository — anything that produces
animations for the device without being able to see `firmware/` or `tools/`.
Grid sizes and where their truth lives, the C6 build-time refusal, what each
size does in the corner badge and the waiting panel, and which fields reach the
device unused. If a downstream consumer is about to copy a constant out of here,
that is the file to point them at instead.

## 1. Scrape

```bash
node convert_official_clawd.js
node convert_official_clawd.js --verify /tmp/verify   # + per-animation PNGs
```

Converts the official Anthropic Clawd animations archived in
`research/clawd-official/` (GIFs decoded via ImageMagick, the Laptop and
Soccer Lottie exports read directly) into a single
`firmware/src/splash_animations.h`:

- frames as bounding-box crops on the shared 55×37 art stage, one byte per
  cell into a per-animation ≤16-color RGB565 palette (index 0 = background)
- per-frame hold in ms, with consecutive duplicate frames collapsed
- a detected loop region per animation (gait cycles, scene middles) that the
  engine can hold or release for walk-to-target and timed scenes
- the eyes — transparent holes in the source GIFs — inked as `#141413`
- contrast recolors (trumpet notes → ivory, magnifier fedora → gray) and the
  sailing-loop cross-match that defines the sailing scene's loop window

See `research/clawd-official/CLAUDE.md` for asset provenance and the format
details, and `--in` / `--out` to override paths. Rebuild firmware after
running.

## 2. Draw or fix animations (optional)

`anim_editor.html` is a 20×20 / 40×40 animation editor. Open it straight off
disk — one file, no dependencies, no server, nothing fetched.

It carries what the firmware cares about rather than what a general pixel editor
offers: the grid sizes the pipeline accepts and the 36-colour cap enforced,
per-frame hold times, onion skin,
playback at the real holds, and both device previews on black (24px/cell splash,
4px/cell corner badge). A colour that looks fine on white can vanish on the
panel and a shape that reads at 24px can turn to mush at 4px, so previewing at
both scales is the point.

`tools/custom_anims/` is a third source dir on this branch, holding animations
composed by `make_custom_anims.js` by posing existing claudepix frames rather
than drawing new ones.

Every animation is embedded as a loadable sample, so an existing one can
be opened and fixed rather than rebuilt. Grids and holds round-trip exactly; the
palette does not. Hex is uppercased, and the claudepix body colour `#CD7F6A`
comes back as `#D97757` — the editor is shown the colour the device displays,
not the one in the source file, and `convert_to_c.js` applies the same remap on
the way to C, so nothing changes on the device. It only matters if you hand an
export back to claudepix as if it were their original file.

Export lands in `tools/drawn_anims/`, which the converter reads — see that
directory's README for how a file there replaces a scraped one.

Re-run `node build_editor_samples.js` after changing any animation. It rewrites
only the region between the `BEGIN-SAMPLES` / `END-SAMPLES` markers; the rest of
the editor is hand-written. The data is inlined rather than fetched because the
editor runs from `file://`, where fetching a sibling file is blocked.

### On the onion skin

It draws the previous frame underneath the current one, so it only shows where
the current frame is empty. Anywhere the two overlap, the current frame hides
it — which means a prop held against the body (a mug, a pair of headphones)
has its previous position covered by exactly the thing you're positioning it
against.

Dots, an outline and a blurred haze were all tried on top and all rejected for
the same reason: the frame is 20 cells wide, there is no spare visual room, and
anything added over the drawing has to be looked past to read the drawing.
Being fainter doesn't fix it.

The tools that solve this solve it with **layers**, not with a better overlay —
put the prop on its own layer and its previous position isn't covered by the
body, because the body isn't on that layer. Aseprite and Krita also tint past
and future frames different colours so a ghost never reads as current art. The
other half of the answer is older than any of them: animators judge motion by
**flipping** between two frames rather than by studying a static ghost, which
is what the arrow keys do here when nothing is selected.

This editor has no layers. It writes one 20x20 grid of palette indices per
frame because that is what the firmware reads, and adding layers means an
editor-side model that flattens on export — worth doing if animating props
becomes common, not worth faking with an overlay.

## 2b. Look at it

```bash
node preview_anim.js "work think"     # by name, or by path to a .json
node preview_anim.js --all            # the whole catalogue
node preview_anim.js "idle blink" --rhythm    # per-frame change table
```

Writes a contact sheet per animation to `tools/preview/` (gitignored) with both
device scales in one image: the splash scale on top, 4 px/cell along the bottom.
Colours are shown the way the device shows them — the claudepix body tint
remapped, everything quantised to RGB565, on black.

Both scales, because they fail differently and neither failure is visible from
the other. The editor shows the same pair for the same reason; this is that check
without opening a browser, which is what makes it usable from a script or by an
agent that would otherwise have to ask a human to go and look.

It also counts what changes between frames. A frame byte-identical to the one
before it is indistinguishable by eye from a deliberate pause, and the sheet will
never show you the difference — but merging it into its predecessor's hold plays
identically, because the render loop is *hold expires → advance → render* with
nothing keyed to the frame index. **26 of the catalogue's 327 frames are
redundant that way**, 10.4 KB of flash holding pictures the device already has.
Whether to spend that is a judgement; not knowing isn't.

## 2c. Have Claude draw one

`.claude/skills/clawdmeter-animation/` is a skill carrying this pipeline as
instructions: the format contract, what the black panel does to colour choices,
the measured shape of the existing catalogue, and the two silent traps (a
duplicate `name` replaces another animation; a name absent from `GROUP_NAMES`
never appears on the device). It requires the preview step above rather than
suggesting it.

It is checked in rather than kept in `~/.claude/`, so it travels with the repo
and can be corrected like any other file here when the pipeline changes.

## 2d. Import the official art

```bash
node import_official.js --list                      # what's there, sized and priced
node import_official.js --all --skip "jumping"      # what actually shipped
node import_official.js --name "sailing scene"      # just one
```

Upstream replaced the claudepix animations with official Anthropic art on a
**60×60 grid**, storing each as a bounding-box crop plus an origin on a shared
55×37 stage. This flattens that back into a whole grid — the crop placed where
the device draws it — so the result opens in the editor and renders in our
engine unchanged. `splash_anim_def_t` has carried a per-animation `grid` field
since the stride moved off the array type, so no firmware change was needed.

### Which grid: `--grid auto` (the default)

40×40 where the crop fits, 60×60 for the three too wide for it (`cloud` at 41,
`racing car` and `trumpet` at 50). **40 wins on both axes at once**, which is
the counterintuitive part: the panel is 480 px either way, so fewer cells means
each is bigger. Their Clawd goes from 192×128 screen pixels to **288×192**, and
a frame costs 1,600 bytes instead of 3,600. All 17 at 60 would be 1,684 KB; the
16 that shipped, mostly at 40, are **959 KB**.

The grid is a resolution, not a canvas. Pick the smallest one the art fits in.

### Placement

- **Vertical**: `side - side/5 - h`. Every one of the 17 has `oy + h == 37`, so
  they are anchored to the bottom of the *stage* — which is 12 rows of 60 above
  the bottom of the grid. That margin is deliberate (the panel's corners are
  rounded), and scaling it with the grid reproduces upstream's placement exactly
  for all 17 at 60 while landing the same 96 px of floor at 40. Anchoring to the
  grid instead stands him on the last pixel row; the simulator caught that in
  one screenshot.
- **Horizontal at 60**: upstream's stage anchoring, including its edge snaps —
  art touching a stage edge was drawn to hang off the *screen* edge (`lurking`
  peeks in from the left), so it goes to the true edge.
- **Horizontal at 40**: the stage is wider than the grid, so it keeps what the
  stage was *for* — Clawd landing in the same place every time. He occupies 24
  cells from stage x15, so every crop shifts by `((side - 24) / 2) - 15`, which
  is −7. Two crops (`laptop`, `sailing scene`) are too wide to honour it exactly
  and are clamped by 2 cells rather than pushed off-grid; the JSON's
  `description` says so.

### Two things that do not survive

- **C6 boards stop building** once the catalogue mixes grid sizes. PSRAM-less
  boards render one pixel per cell and let LVGL upscale, so the scale factor is
  a property of the grid side; mixing trips the `static_assert` in `splash.cpp`.
  It fails at compile time with the reason — intended, not a bug.
- **Loop regions are lost.** Upstream plays intro → loop (held ~6 s) → outro and
  never hard-cuts; ours loops the whole file, so an import replays its intro and
  outro every pass. The frame numbers go into the JSON's `description` rather
  than being dropped silently.

`tools/official_anims/` is a tracked source directory like the other three. It
was briefly gitignored on the reasoning that the art is Anthropic's and is one
command from upstream — which was wrong, because the moment any of it ships the
generated `firmware/src/splash_animations.h` carries the same pixels and *that*
is committed. Ignoring the JSON redistributed nothing less and cost a fresh
clone the ability to rebuild the firmware it already contained.

The imports are embedded in the editor too, which is the point of importing them
— open one, draw into the space around it, export to `drawn_anims/`. That took
`anim_editor.html` from 320 KB to **1,276 KB**, because a 40×40 frame packs to
1,600 characters and a 60×60 one to 3,600. It is a single local file with no
network, so a megabyte of string literal costs tens of milliseconds at load;
worth knowing before wondering why the file grew fourfold.

## 2e. Take one off the board

```bash
node export_gif.js                        # Nova's own drawings, 480×480 GIFs
node export_gif.js hanabi "rainy days"    # by name
node export_gif.js --all --frames         # every animation, plus PNG sequences
```

Writes to `tools/export/` (gitignored — regenerate, don't commit). GIF by
default; `--frames` adds a numbered PNG sequence, `--still N` writes one PNG and
no GIF.

GIF is not a lossy fallback here, it is the same data model wearing a different
header. Our animations are *a palette of at most 36 colours plus one index per
cell*; a GIF is *a colour table of at most 256 colours plus one index per pixel*.
So the export is a remap — no quantisation, no dithering, no colour drift — and
the frame holds become the GIF's own per-frame delays, so it plays at the speed
the device plays it. Every hold in the catalogue is a multiple of 10 ms and GIF
delays are in hundredths of a second, so even the timing is exact rather than
rounded.

The encoder is hand-written, same as `lib/png.js`, to keep the tool chain free of
`npm install`. Because a GIF that opens in a lenient viewer can still be
malformed, correctness is checked by decoding the file back with an independent
reader and comparing every pixel, delay, disposal byte and palette entry against
the source JSON — the whole catalogue round-trips exactly.

`--canvas WxH` letterboxes onto something that isn't square, and `--anchor
top|middle|bottom` says where the art sits on it. That combination exists for
watch faces. A worked example, the one it was written for — a Xiaomi Smart Band
10 Pro, 1.74″ AMOLED at 336×480:

```bash
node export_gif.js waiting --canvas 336x480 --cell 16 --anchor bottom --still 6
```

20 cells at 16 px is 320 px of art on a 336 px-wide screen, so it fills the
width with an 8 px margin and leaves the top third black — which is where a
watch face puts the time. Note that the plain Smart Band 10 is a different and
much narrower panel (212×520); the sizes are not interchangeable.

For a tool that wants a sprite to position rather than a full-screen image, drop
`--canvas` and the frames come out at the art's own size (`--cell 16 --frames`
→ 320×320 PNGs).

**`--bg` defaults to black and that is not a neutral default.** Everything here
was drawn against an unlit AMOLED, so light colours are used freely and "empty"
means black, not white. On a white background the pale props in `waiting` and
`space` disappear outright. `--transparent` carries the same hazard the moment
the viewer's background is light, which is why it is opt-in.

The default selection is Nova's own drawings rather than everything, because
those are the ones that are hers to hand to someone outside this project. The
rest of the catalogue is Anthropic's art or claudepix's, and exporting that to
give away is a different question from running it on our own board. The list is
hand-maintained at the top of the script: authorship isn't a property of a
directory, since `drawn_anims/` holds both her originals and her edits to
scrapes.

## 2f. Send one the other way

```bash
node export_upstream.js --name "hanabi" --preview     # look before you commit to it
node export_upstream.js --all --out nova_anims.h      # everything of ours that may travel
node check_export_upstream.js                         # prove it lost nothing
```

`import_official.js` pointed the other way: our square grid cropped back down to
a bounding box, written as upstream's `splash_anim_def_t`. The output is a header
a stranger drops into a fork of **upstream** and compiles. Their code does not
change — their `splash.cpp` already reads that struct.

It exists because upstream's `tools/` holds three files: a GIF converter, an icon
converter, and a README. There is no editor and no JSON format, so a fork of
upstream cannot play *any* hand-drawn animation — not ours, not its own. Every
piece needed to change that already lived here except the last step.

### Nothing is resampled

A cell becomes an n×n block of the same cell, which is the property
`lib/format.js` relies on when it calls growing an animation free. Non-integer
scaling would be a redraw, so `--scale` takes whole numbers and refuses the rest.

`--scale auto` picks the largest whole factor that fits. Our 20×20 drawings go in
at 2×, which lands them at 40×40 of their 60-cell grid.

### Where it lands

Their compositor draws at `STAGE_ANCHOR + (ox, oy)` with `STAGE_ANCHOR_Y = 11`,
and every animation they ship bottoms out on row 48 — that shared ground line is
what makes their transitions seamless, since each hands over on the same idle
pose.

Ours have no such pose; they are standalone scenes, so a ground line they never
had buys nothing and the stage's 37-row ceiling costs real size. Hence
`--fit full` (60×49, the default) and `--fit stage` (55×37, ground-line aligned —
use it for a creature animation sharing a rate group with theirs).

49 and not 60 because `oy` is unsigned: row 11 is the highest reachable.

### What it refuses, and why refusing is the feature

**Third-party art.** claudepix-origin animations are held back by the same rule
and the same module (`lib/origin.js`) that keeps them off the published editor —
see the License note below. A generated header handed to a stranger to compile is
a distribution in the way a repo someone chooses to clone is not.

**Anthropic's own art**, unless `--include-official`. Upstream ships it natively,
with loop regions and stage placement this conversion cannot reproduce; exporting
it back would be a worse copy of what they already have.

**More than 15 drawn colours.** Their palette holds 16 including the background.
Reducing a palette is a redraw, not a conversion, so it says which animation and
by how much and stops. Nothing here has ever needed it — `hanabi` uses exactly 15.

### Checking it

`check_export_upstream.js` parses the emitted header back — not the exporter's
internals — undoes the crop, scale and palette remap, and compares every cell
against the source JSON. Currently 14 animations, 170,400 cells.

It cannot check the contract with upstream: field order in `splash_anim_def_t`,
what index 0 means, where `ox`/`oy` are measured from. Those live in their
`splash.cpp`, so that check is a build against a real upstream tree:

```bash
T=$(mktemp -d); git -C . archive origin/main | tar -x -C "$T"
node tools/export_upstream.js --name "hanabi" --out "$T/firmware/src/nova_anims.h"
# make the three edits the generated header documents, then:
pio run -d "$T/firmware" -e waveshare_amoled_216
```

Done on 2026-08-18 against upstream `bbfec07`: builds, and the animation renders
in their sim through their engine. Worth redoing whenever they touch the struct —
the first version of the exporter emitted table entries as loose initialisers at
file scope, text that looks like C and that no compiler accepts, and only this
found it.

## 3. Convert to C

```bash
node png_to_lvgl.js input.png symbol_name [W_MACRO] [H_MACRO] [--tint=RRGGBB | --no-tint]
```

Reads `tools/claudepix_data/*.json`, `tools/custom_anims/*.json` and
`tools/drawn_anims/*.json` and emits a single
`firmware/src/splash_animations.h` with:
- `splash_<ident>_frames[N * side * side]` — per-frame cell codes (0 = empty,
  1 = body, 2 = eye), flat and back to back. The stride used to live in the array
  type as `[N][400]`, which forced every animation in a build to one size; it is
  a field on `splash_anim_def_t` now, read through `splash_frame(anim, i)`.
- `splash_<ident>_holds[N]` — per-frame hold time in ms
- `splash_anims[]` — master table with name, category, frame count, pointers
- `SPLASH_ANIM_COUNT`

The firmware (`splash.cpp`) consumes this header to render and animate.

## 4. Sync everything

Converting is one of four things that have to happen together, so there is one
command for all of them:

```bash
node sync_animations.js
```

| step | |
|---|---|
| `convert_to_c.js` | animations → `firmware/src/splash_animations.h` |
| `build_editor_samples.js` | animations → the samples embedded in `anim_editor.html` |
| `gen_catalogue.js` | firmware → [`docs/animation-catalogue.md`](../docs/animation-catalogue.md) |
| `check_groups.js` | every name the firmware asks for resolves to something |
| `check_editor.js` | the editor's script parses and its grid maths hold |

It stops at the first failure and exits non-zero, so it can be chained in front
of a build.

Doing three of the four is the easy mistake, and each omission fails quietly in
its own way. Skip the samples and the device and the web editor disagree about
which animations exist. Skip the catalogue and the docs describe a device that
no longer exists. Skip the check and an animation can be compiled into the build
and picked by nothing — which looks identical to a working one when you cycle to
it by hand with the `next` serial command.

`docs/animation-catalogue.md` is generated from the firmware sources rather than
maintained by hand, for the same reason: a list of what ships and in what order
is wrong the first time someone reorders a group and forgets, and a list that is
wrong is worse than none, because it gets believed.

## Re-running

The scraper is idempotent — re-run any time the source library updates. The
converter overwrites the header. Run `sync_animations.js` after either, then
rebuild the firmware.

## License note

**As of 2026-08-12 the firmware carries no claudepix material.** All of it —
the scrapes, Nova's corrections to them, and the three animations that pose
claudepix frames under her props — is listed in `EXCLUDE` in `convert_to_c.js`
and is not compiled in. What ships is the ten animations Nova drew and sixteen
of Anthropic's own, imported by `import_official.js` — two sources, no third.

The reason is provenance, not quality: [claudepix](https://claudepix.vercel.app)
by [@amaanbuilds](https://x.com/amaanbuilds) **states no license at all**, which
made it the murkiest thing this project depended on. Upstream reached the same
place from the other direction, replacing its claudepix catalogue with official
Anthropic art in #153.

The source files stay in `claudepix_data/`, `custom_anims/` and `drawn_anims/`.
They are still loadable in the editor, `make_custom_anims.js` still needs them
as bases, and any of them can be put back by deleting a line from `EXCLUDE`. So
this section still applies to the repository, just not to the device:

**As of 2026-08-15 the published editor carries none of it either.**
`build_editor_samples.js --public` writes `docs/anim_editor.html` with only the
animations drawn here and Anthropic's imports — 27 of the 45 — and that is the
copy GitHub Pages serves. `tools/anim_editor.html` keeps all 45 for local use.

The distinction being drawn is between a file in a repository someone chooses to
clone and a page served to whoever opens a link: the second is a distribution in
a way the first is not, and it is the one that gets pointed at from elsewhere.
Serving Pages from `docs/` rather than the repository root is the other half of
that — with Pages on at the root, `tools/claudepix_data/*.json` was being served
from the project's own domain as a side effect nobody chose.

@amaanbuilds' account is unreachable as of 2026-08-15, so there is nobody to ask
for permission. **Unreachable is not permission.** Leaving the material out is
what you do when you cannot ask; it is reversible the day that changes, and the
per-animation origin labels in the editor are there so the question stays
answerable rather than becoming folklore.

Two parties hold rights in that material and this project holds neither. The
character Clawd belongs to Anthropic, the pixel animations are claudepix's, and
the hand-edited versions in `drawn_anims/` are derivative of both. The official
art that replaces it on the device is Anthropic's outright.

This is a non-commercial community project. It is **licensed by neither party
and licenses nothing to anyone** — publishing a derivative work under an open
license would be asserting a right this project doesn't have, so it doesn't.
Confirm your own use is appropriate before redistributing, and don't ship any
of it in a paid product.
