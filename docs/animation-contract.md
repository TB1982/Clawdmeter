# Animation format contract

For anything outside this repository that produces animations for the device —
today that is VAS Desktop, which embeds `tools/anim_editor.html`.

**Point at this file rather than copying its numbers.** It exists because a
downstream consumer already had to duplicate one constant (the 20-second
rotation slot) with nothing better to say in the comment than "the verdict lives
in firmware". A copied constant does not fail when it drifts; it disagrees, and
disagreement is only noticed by whoever is holding the hardware. Every claim
below carries the file and line it came from, so the doc can be checked against
the code rather than trusted.

Written 2026-08-13, re-checked line by line against the tree on 2026-09-05.
Sections marked **stable** are contract; sections marked **may move** are
current fact and could change with a firmware release.

---

## 1. Grid sizes — where the truth lives

**stable**

```js
// tools/lib/format.js
const GRID_SIZES  = [20, 40, 60];
const PALETTE_SIZE = 36;
```

That file is the only definition. `tools/convert_to_c.js` validates against it
and refuses anything else:

```
grid is 30x30; supported sides are 20, 40, 60
```

Sides are square-only (`splash.cpp` centres a square canvas on the panel) and
every one is a whole multiple of 20, which is what makes growing an animation
free: each cell becomes an n×n block, nothing moves, and it looks identical on
the panel until it is refined. 32 or 48 would need interpolation — that is a
redraw, not a resize. Note 40 and 60 do not divide each other, so resampling
between them has to go via 20, and 40 → 20 discards detail.

`PALETTE_SIZE` is 36 because `tools/build_editor_samples.js` packs one cell into
one base-36 character; index 35 (`'z'`) is the largest that survives the round
trip. Above that the real ceiling is 255, since cells are `uint8_t`.

### Which layer each of these refusals actually lives in

Asked by VAS on 2026-09-07, while mapping which limits are hardware and which
are ours. Worth answering in the file: getting the attribution wrong sends the
next person to argue with the wrong party.

| the rule | what refuses | what the device itself does |
|---|---|---|
| palette ≤ 36 | `build_editor_samples.js:140` — the base-36 packing, and the only thing here actually shaped like 36. Mirrored in `anim_editor.html:408`, validated in `convert_to_c.js:182` | nothing hardcodes it. `convert_to_c.js:315` emits `SPLASH_PALETTE_SIZE` from `format.js` and `splash.cpp` bounds-checks against that define (`:309`, `:376`, `:443`) |
| side ∈ {20, 40, 60} | `convert_to_c.js:192` | no whitelist at all. `render_frame()` reads `a->grid`, derives `cell = canvas_w / grid` and centres the remainder (`splash.cpp:367`) |

**Both are toolchain walls.** Neither number is a device capability, and the
"whole multiple of 20" rule in the paragraph above is about resizing being free
between the listed sizes — not about what the panel can show.

To raise the palette cap: change `format.js`, then the packing and its reader.
That pair is the whole job; the converter and the firmware are already
parameterised, and every palette is padded to the cap regardless of use, so each
added entry costs 2 bytes per animation and nothing else.

A side the converter never saw would render. On a 480 panel, 30 is exactly 16 px
per cell; 25 is 19 px with a 5 px margin left as background rather than a
silently shifted image. **The wall stands at the canvas edge**, and there it
stops being a toolchain wall: `canvas_w` is `SPLASH_GRID * (min(W, H) /
SPLASH_GRID)` — 480, 400, 360 or 240 depending on the board — and past it `cell`
clamps to 1, `side` outgrows the buffer, `off` goes negative, and
`render_frame()` writes outside `canvas_buf` and `row_buf` (`splash.cpp:381`).
There is no runtime guard on the full-screen path; `convert_to_c.js` is the
guard. Mini instances are the exception — every write there is bounds-checked
(`splash.cpp:446`, `:450`), which is why the compact badge crops a 60 instead of
corrupting the heap. It did corrupt it until 2026-08-13 (§ 3).

So: "the converter refuses it" is the honest answer for any side up to the
canvas edge, and "the device breaks, unguarded" for anything past it.

### The copies, and which of them are checked

`anim_editor.html` cannot `require()` anything — it has to open from `file://`
as a single document, which is the property the whole editor is built around. So
it keeps its own `PALETTE_MAX`, `GRID_SIZES`, `CLIP_VERSION` and `HOLD_MIN`, and
two things compare them against `format.js`: `build_editor_samples.js` refuses to
write when they disagree, and `node tools/check_editor.js` checks the same four
constants, the resize rules between grid sizes, and § 6 of *this document*.

**That check only covers this repository's copy.** It reads
`anim_editor.html`; it cannot see a reimplementation.

- **If you run our editor** — embedded, loaded, actually executed — the check
  travels with it. Run `node tools/build_editor_samples.js` in CI and a drift
  fails the build.
- **If you reimplemented it** — which VAS did; the HTML in their tree is a
  read-only snapshot that never executes — **nothing checks your constants.**
  Yours are exactly the copies described at the top of this file: they will not
  fail when they drift, they will disagree, and the disagreement will surface as
  a drawing that the converter rejects or the device renders wrong.

For that case the answer is not a better check, it is not holding a copy at all:
read the values from this document at the moment you need them, and cite it
rather than restating it. VAS's own conclusion, and it is the right one.

**Anything the editor can draw, the converter accepts and the device renders.**
No size is editor-only. But see §2 before assuming that means every board.

---

## 2. Mixing sizes takes the two C6 boards out of the build

**stable** — this is a compile-time refusal, by design, not a runtime fallback.

```cpp
// firmware/src/splash.cpp:27
#ifndef BOARD_HAS_PSRAM
static_assert(SPLASH_GRID_MAX == SPLASH_GRID, ...);
#endif
```

`SPLASH_GRID` is 20 (`firmware/src/splash_geometry.h:15`). `SPLASH_GRID_MAX` is
generated by `convert_to_c.js` as the largest side actually shipped
(`splash_animations.h`, currently 60).

So the moment the catalogue contains any animation that is not 20×20, the two
PSRAM-less environments — `waveshare_amoled_216_c6` and
`waveshare_amoled_18_c6` — **fail to compile**. They do not build today, on
purpose.

The reason is that PSRAM-less boards render one pixel per cell and let LVGL
upscale the whole image, so the scale factor is a property of the grid side.
Mixing sizes means re-scaling on every animation change, on the one render path
that neither the `screenshot` serial command nor a host test can check
(`LV_USE_SNAPSHOT` is off without PSRAM). The assert refuses with that reasoning
attached rather than letting it render wrong.

**What this means for a downstream editor**: a user drawing 40 or 60 is
producing something every board that declares `BOARD_HAS_PSRAM` renders correctly
and every board without it cannot be built with at all. Today that is the four S3
ports plus the desktop simulator on one side and the two C6 ports on the other,
but the membership is not the rule — the flag is. (Upstream added a fifth S3
port, ESP32-S3-Touch-LCD-4, on 2026-08-27; it is 480×480 with 8 MB PSRAM, so it
would join the first group and change nothing here. Not merged into this tree as
of 2026-09-05.)

If any of your users have a C6 board, that is worth saying in the UI at the point
of choosing a size — the failure is a build error on someone else's machine, not
something their drawing will reveal.

Lifting it means wiring per-animation `lv_image_set_scale` and verifying on real
C6 hardware. Until then, treat "20 only" as the C6 contract.

---

## 3. Where an animation is drawn, and what a non-dividing size does there

**may move** — the pixel sizes are layout values and could change with a new
board or a layout revision. The *rule* is stable; the numbers are current fact.

An animation appears in one of two kinds of place:

- **Full-screen splash** — the whole panel. Every size works.
- **A mini instance** — a small canvas somewhere in the UI. Created by
  `splash_mini_create(parent, name, px)` (`firmware/src/splash.cpp:459`).

There are five mini instances today, in three slot geometries. Three of them
share the top-left logo slot, one per screen: the rate-following corner badge
(`ui.cpp:1061`, created with `NULL` so it picks by usage rate), the market coin
(`ui.cpp:629`) and the moon (`ui.cpp:849`). The other two are the idle creature
(`ui.cpp:549`) and the weather creature (`ui.cpp:810`).

A mini snaps its canvas to a multiple of the *reference* grid, not to the
animation's:

```cpp
m->cell = px / SPLASH_GRID;      // SPLASH_GRID == 20
if (m->cell < 1) m->cell = 1;
m->w    = SPLASH_GRID * m->cell; // always a multiple of 20
```

then derives the per-animation cell at render time, with integer division:

```cpp
m->cell = m->w / m->grid;
if (m->cell < 1) m->cell = 1;
```

So a size divides a mini cleanly only when it divides `m->w`. The six
slot-and-layout combinations that exist today:

| slot | requested px | actual `m->w` | 20×20 | 40×40 | 60×60 |
|---|---|---|---|---|---|
| logo slot, large layout | 80 (`logo.h:4`) | 80 | fills | fills | whole, 60 of 80 px |
| logo slot, compact layout | 40 (`logo.h:1210`) | 40 | fills | fills | **cropped — middle 40×40 only** |
| idle creature, large layout | 160 (`ui.cpp:122`) | 160 | fills | fills | whole, 120 of 160 px |
| idle creature, compact layout | 96 (`ui.cpp:201`) | **80** | fills | fills | whole, 60 of 80 px |
| weather creature, large layout | 300 (`ui.cpp:127`) | 300 | fills | whole, 280 of 300 px | fills |
| weather creature, compact layout | 180 (`ui.cpp:203`) | 180 | fills | whole, 160 of 180 px | fills |

"whole" means every cell is drawn, centred, at a smaller size. "cropped" means
cells outside the buffer are discarded — see the second bullet below.

Four things to read off that table, and the first two are different failures:

- **60 renders undersized in the logo and idle slots.** The whole frame is
  drawn, centred on a black field, at 75% of the slot or less. Nothing is
  missing; it is just small.
- **In the compact logo slot it is cropped, and content is lost.** There
  `m->w = 40`, so `40 / 60` truncates to 0 and the clamp lifts the cell to 1 —
  a 60-cell span into a 40 px canvas. The outer 10 cells on every side fall
  outside the buffer and are skipped, leaving **the middle 40×40 of a 60×60
  frame**. Anything drawn near the edges is simply not there. (Before
  2026-08-13 this case overflowed the heap instead; see below.) Only the corner
  badge can reach this: it is the one instance that picks by rate, and group 3
  holds three 60×60 animations. The coin and the moon are both 20×20 and pinned
  by name.
- **The weather slot inverts it.** `weather_anim_px` is a whole multiple of 60
  on purpose (`ui.cpp:124`) because all three weather creatures — `sunny`,
  `cloud`, `rainy` — are 60×60. So in that slot 60 fills and **40** is the size
  that lands short. Which size is awkward is a property of the slot, not of the
  size.
- **96 becomes 80.** `96 / 20` truncates to 4, so the compact idle creature is
  really 80 px. That surprises people; it is the same integer division.

**So: 60 is safe on the splash and in the slot built for it, and lossy in the
compact logo slot.** Nothing is rejected and nothing crashes, so if your UI lets
a user assign an animation to a particular slot, that is a check only you can
make — the device will not tell them, and in one slot it will quietly discard the
edges of their drawing.

The renderer scales by whole-cell block fill, which is why a non-dividing size
has nowhere to go. Sampling per output pixel instead (`src = y * grid / w`)
would draw every size whole in every slot and is identical to block fill
wherever the sizes already divide — it is the fix that would retire this whole
section. It has not been done.

Compact layout is `H < 460` (`ui.cpp:139`), which today means the 1.8 in both
its S3 and C6 forms (368×448) and the 1.54 (240×240). The 2.06 is 410×502, so
despite being the smallest panel by area it takes the large layout.

### Previously: the 40 px badge overflowed the heap

Fixed 2026-08-13, recorded because a downstream reader may be looking at an
older firmware.

The render loop was unbounded. On a compact layout the badge is `m->w = 40`, so
its buffer holds 1,600 `uint16_t`; a 60×60 animation gave `40/60 == 0`, the
clamp lifted it to 1, and the loop indexed up to `59*40 + 59 = 2,419` — **1,640
bytes past the end of the allocation**. It was reachable: the badge is a
rate-following instance, group 3 holds three 60×60 animations (`cloud`,
`racing car`, `trumpet`), and `splash_mini_tick()` renders without checking
visibility, so hiding the badge did not avoid it. Writes are now centred and
bounded (`splash.cpp:437`).

---

## 4. `category` reaches the firmware and nothing reads it

**stable**

`convert_to_c.js` declares the field (`:319`) and writes it (`:375`), so it is
in the shipped binary:

```c
// firmware/src/splash_animations.h:17
typedef struct {
    const char *name;
    const char *category;      // carried, never read
    uint16_t    frame_count;
    uint8_t     grid;
    const uint16_t *palette;
    const uint8_t  *frames;
    const uint16_t *holds;
} splash_anim_def_t;
```

No firmware code reads it. It is metadata that travels with the animation; in
`anim_editor.html` it is the axis the sample picker groups by, and that is its
only current use.

**So a wrong category costs nothing on the device.** Do not gate saving on it.

The editor's dropdown offers `Idle`, `Work`, `Dance`, `Expressions`
(`anim_editor.html:227`). The shipped catalogue, on 2026-09-05, uses six:
`Official` (15), `Idle` (6), `Dance` (3), `Weather` (3), `Work` (2) and
`Stocks` (1) — and contains no `Expressions` at all, which survives only among
the editor's own samples. So the two lists disagree in **both** directions: the
dropdown is missing three categories that ship, and offers one that does not.

That gap is drift, not policy — the dropdown was not updated when the official
art was imported, nor when the weather and stocks screens brought their own.
Deriving the list from the distinct values present, rather than hardcoding four,
is the version that will not drift again.

One distinction worth preserving in a user-facing picker: `Official` records
**provenance** ("this came from Anthropic"), not a kind of motion. A user filing
their own drawing under it is mislabelling its source, so it is reasonable to
show it as a filter but not offer it as a choice.

### `description` is worse: nothing reads it and the editor overwrites it

It is not in `splash_anim_def_t` at all — `convert_to_c.js` never emits it, so
unlike `category` it does not even reach the binary. `build_editor_samples.js`
does not pack it either, so the editor's samples do not carry one.

Nine tools **write** it — `grid_image_to_anim.js`, `make_custom_anims.js`,
`import_official.js`, `makebead_to_anim.js`, `make_moon_phases.js`,
`make_coin_rain.js`, `make_coin_spin.js`, `make_rain_anim.js`, and the editor
itself — and nothing anywhere reads it. It was five when this was written on
2026-08-13; the number only ever goes up, which is the point.

The part that matters for a downstream editor: **ours overwrites it on every
export** with a fixed string (`anim_editor.html:1992`):

```js
description: `Drawn in the Clawdmeter editor: ${frames.length} frames.`,
```

So it is not a place to keep anything. Text a user types there is lost the next
time the file passes through our editor, and it never reaches the device by any
route. If your rewrite offers a description field, either keep it in your own
storage or expect it to be destroyed on the next round trip.

This has already cost something once. A note explaining why one animation's
flower ring is deliberately uneven was written into this field, where it was
both unread and one export away from deletion; the copy that survives is the
comment beside the name in `splash.cpp`. **Facts that must outlive a file belong
in the firmware source, not in the animation's metadata.**

---

## 5. What names the firmware asks for

**may move**

An animation is only ever shown if some name in the firmware matches its `name`
field exactly. Adding a JSON is not enough — this is the most common way a new
animation silently never appears.

- `GROUP_NAMES[4][9]` in `firmware/src/splash.cpp:83` — the rate groups
- `SPLASH_OPENING_ANIM` (`splash.cpp:195`) — played once per power-up, not
  reachable otherwise
- `SPLASH_CELEBRATE_ANIM` (`splash.cpp:207`) — the reset celebration
- `ui.cpp` names six directly: `magnifier` (the idle creature), `market coin`,
  `moon phases`, and one per weather condition (`sunny`, `cloud`, `rainy`)

`node tools/check_groups.js` verifies every name the firmware asks for exists in
the build, and prints the current lists rather than making you read for them —
so it, not this section, is the answer to "what does the firmware ask for
today". It also reports built animations that nothing ever picks.
`tools/sync_animations.js` runs it as its last step; run it directly after any
rename or any hand-edit of `GROUP_NAMES`.

## 6. Constants a downstream consumer may need

**may move**

| constant | value | where |
|---|---|---|
| `SPLASH_ROTATE_INTERVAL_MS` | 20000 | `splash.cpp:57` |
| `SPLASH_GRID` | 20 | `splash_geometry.h:15` |
| `SPLASH_GRID_MAX` | generated — 60 today | `splash_animations.h:978` |
| `SPLASH_ANIM_COUNT` | generated — 30 today | `splash_animations.h:977` |
| `SPLASH_PALETTE_SIZE` | 36 | generated from `format.js` |
| rate groups × slots | 4 × 9 | `splash.cpp:63` |
| `CLIP_VERSION` | 1 | `tools/lib/format.js:65` (see § 7) |
| `HOLD_MIN_MS` | 20 | `tools/lib/format.js:91` (see below) |

**Frame holds.** A hold is a whole number of milliseconds, at least `HOLD_MIN_MS`.
There is no upper bound below 65,535 — holds compile into a `uint16_t[]`.

Both halves of that are enforced in `convert_to_c.js` rather than left to
convention, because both fail far from their cause:

- A **fractional** hold is a narrowing conversion in the generated
  `uint16_t[]` initialiser. It passes every JSON-level check, then breaks the
  *firmware* build with an error naming neither the animation nor the frame.
- A hold **below the floor** is not honoured at runtime. `splash.cpp` does not
  schedule frames, it polls them — `millis() - frame_started_ms >= hold`, once
  per pass of the main loop, and each pass ends with `delay(5)` plus a
  full-canvas flush. A hold shorter than a pass yields the pass, not the hold.

The floor is **not** a granularity. Any whole value at or above it is exact, and
that matters: across the 796 frames shipped on 2026-09-05, fifteen distinct hold
values are not multiples of 20 — including the 1/12-second beats the GIF-sourced
art runs on (83, 166, 332, 498 ms), which rounding to any coarser step would
destroy. The editor's hold field carries `step="20"` for its arrow buttons only
— a typed 310 stays 310. The shortest hold actually in the tree is 70 ms, three
and a half times the floor.

**Two unrelated 20s, and do not let one stand in for the other.** This floor
comes from the poll loop and a `uint16_t`; an editor's arrow-button step comes
from what feels good under a thumb. Ours are both 20 and they are separate
constants — `check_editor.js` asserts the hold field reads
`inp.min = HOLD_MIN; inp.step = 20;`, so the day either moves, the other does
not follow silently. VAS reached this floor from the step side on 2026-09-05:
right value, wrong reason, and nothing anywhere could have noticed. If your
editor has a step constant that happens to equal 20, that is a coincidence —
mirror this row, not that one.

A frame costs `side * side` bytes of flash: 400 at 20, 1,600 at 40, 3,600 at 60.
A 25-frame animation is 10 KB, 40 KB or 90 KB. Fine for a few, not for all — the
current catalogue is 30 animations, and the 2.16 build measures 2,936,363 bytes
against a 6,553,600-byte app partition, 44.8% (built 2026-09-05).

That percentage was 84.8% here on 2026-08-13 and the budget did not triple: the
env inherited `board = esp32-s3-devkitc-1`'s 8 MB flash layout by declaring
nothing, so it was being measured against a 3.34 MB app0 that did not match the
16 MB part on the desk. Fixed 2026-08-17. **A headroom figure copied out of this
document is a figure about our partition table, not about yours.**

---

## 7. The frame-fragment clipboard payload

A whole animation already crosses program boundaries as JSON — the editor's
"copy to clipboard" writes one, and a consumer pastes it into its own import
box. This section is about the smaller unit: **one rectangle lifted out of one
frame**, so a shape drawn in one editor can be ⌘V'd into another.

The carrier is the system clipboard's `text/plain`, holding one line of JSON:

```json
{"clawdclip":1,"r":8,"c":12,"h":3,"w":4,
 "colors":["transparent","#DE7552","#FFD98A"],
 "cells":[[0,1,1,0],[1,2,2,1],[0,1,1,0]]}
```

| field | meaning |
|---|---|
| `clawdclip` | format version — `CLIP_VERSION` in `tools/lib/format.js` |
| `r`, `c` | origin of the fragment in the source frame: `r` = row, `c` = column |
| `h`, `w` | rows and columns of `cells` |
| `colors` | the colours this fragment uses, re-indexed from 0. `colors[0]` is always `"transparent"` |
| `cells` | `h` rows of `w` integers, each an index into `colors` |

### Why the payload carries colours and not palette indices

An index is meaningless outside the document it came from: index 5 is a pink in
one animation and a blue in the next. Carrying the hex makes the fragment
self-contained, and it is what lets the receiver do an **exact string match**
against its own palette rather than guessing.

That distinction matters more than it looks. A consumer of this format may well
have a rule against inferring palette indices from pixels — VAS does, because
two palette entries that happen to share an RGB value are indistinguishable once
flattened. This payload never asks anyone to infer anything: the sender already
knows which entry each cell is and names it.

### Merging into the receiver's palette

Per colour, in order: exact hex match → reuse that index. No match and the
palette has room → append. **No match and the palette is full → reject the whole
paste**, and say how many colours over it was.

Rejecting is deliberate. Substituting the nearest colour would make every paste
succeed, but it is the same lossy inference at one remove, and it fails silently
— nothing on screen says which cells were changed. The invariant worth keeping
is that **a paste either reproduces the source exactly or does nothing.**

`PALETTE_SIZE` (§ 1) is the cap being tested here, and index 0 is spoken for, so
a fragment can introduce at most 35 colours into an empty palette.

### Index 0 means "do not paint"

`colors[0]` is `"transparent"` by the same convention the animation format uses.
A cell of 0 leaves whatever is underneath it alone, which is what makes a
non-rectangular shape survive the trip: the fragment is always a rectangle, and
the transparent cells are the mask. There is no separate mask field and there
should not be one.

### Pasting across grid sizes

Cells are cells. A 6×6 fragment copied from a 60×60 animation lands as 6×6 in a
20×20 one — physically larger against that canvas, and correctly so. Nothing is
resampled: `GRID_SIZES` (§ 1) are whole multiples of each other only in one
direction, and rescaling a fragment on paste would silently redraw it.

The origin travels with the fragment so that pasting into a *different frame of
the same animation* lands it exactly where it was — one cell off is visible as a
jitter when the frames play. When the origin puts part of the fragment outside a
smaller grid, the recommended behaviour is to let it hang over the edge in
whatever floating/pending state the editor already has for a moved selection,
rather than clamping (which moves it) or cropping on arrival (which discards
content without saying so).

### What a reader must do with an unknown `clawdclip`

Treat the text as ordinary text and let it fall through to whatever normally
handles a paste. A reader should sniff for the `clawdclip` key *before* deciding
the clipboard belongs to it — the top-level key is deliberately different from
the whole-animation document's (`name` / `category` / `palette` / `frames`), so
the two can never be mistaken for each other.

### A payload to test against

`tools/fixtures/clip-fragment-v1.json` is a real capture: the editor was driven
through the copy gesture and the bytes were read back off the system clipboard.
It is there for *your* tests, not ours — nothing in this repo reads it.

Use it rather than writing your own sample. A fixture you compose yourself
proves that you agree with yourself; the useful test is the one where the bytes
came from the other side of the boundary. The capture deliberately includes
transparent cells, colours that were at different indices in the source
document, an origin away from the top-left, and a fragment that straddles two
separate objects.

---

## Keeping this honest

If a number here is wrong, the file and line beside it is where to look, and
fixing this file is part of the change that made it wrong. Nothing here is
generated, so nothing regenerates it.

Two of the numbers do fail loudly, though. `tools/check_editor.js` reads this
file and asserts that § 6's table states the current `CLIP_VERSION` and
`HOLD_MIN_MS`, because those two are the ones a consumer mirrors by regexing
*this document* rather than our source — a bump that stops at the code is a bump
they never hear about. The rest are checked the way everything else here is:
by someone reading the line beside them.

Line numbers were last walked on 2026-09-05, against `splash.cpp`, `ui.cpp`,
`logo.h`, `splash_animations.h`, `convert_to_c.js` and `anim_editor.html`. They
drift with any edit above them; the file and symbol survive, the number is a
convenience.
