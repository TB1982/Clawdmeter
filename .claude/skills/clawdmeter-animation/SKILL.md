---
name: clawdmeter-animation
description: >-
  Author a splash animation for the Clawdmeter device — a 20x20 grid of palette
  indices with per-frame hold times, written to tools/drawn_anims/ and compiled
  into firmware/src/splash_animations.h. Use this whenever someone asks for a new
  Clawdmeter splash animation, a new creature pose or scene for the device, an
  edit to an existing one, or "make Clawde do X on the monitor". This is the
  device pipeline: the output is JSON that ships in firmware, not a web page. If
  the request is for an animation to watch in a browser, that is the separate
  clawd-animation skill — do not use this one.
---

# Clawdmeter splash animations

You are authoring for a physical panel, not a screen. Everything below follows
from that.

**Read [`docs/animation-craft.md`](../../../docs/animation-craft.md) before
drawing anything.** This file is the procedure; that one is what we have learned
about making an animation *read* — which shapes survive 20×20, what the tools can
and cannot tell you, and the mistakes that have already been made and paid for.
It is dated, so you can see what was found when.

The target is a **20x20 grid of palette indices**, a handful of frames, each with
a hold time in milliseconds. It goes to `tools/drawn_anims/`, gets compiled by
`tools/convert_to_c.js` into `firmware/src/splash_animations.h`, and is rendered
by `firmware/src/splash.cpp` on six different boards.

## The contract

`convert_to_c.js` validates this and **exits non-zero** on any violation. It is
strict on purpose: the firmware reads these arrays with fixed strides and no
bounds checks, so a 19-row grid does not produce a wrong picture, it produces a
device reading past the end of an array.

```json
{
  "name": "idle wave",
  "category": "Idle",
  "description": "optional, for humans",
  "palette": ["transparent", "#D97757", "#0F0F0F"],
  "frames": [
    { "hold": 400, "grid": [[0,0, ...20 values...], ...20 rows... ] }
  ]
}
```

- **`name`** — required, lowercase words with spaces. It is the identity used
  everywhere else. See *Naming* below before you pick one.
- **`palette`** — 1 to 36 entries (the cap lives in `tools/lib/format.js`).
  Index 0 is `"transparent"` by convention and
  becomes black, which is the panel's own colour. Hex strings otherwise.
- **`grid`** — every frame must be the same side, and the side must be 20.
  (`convert_to_c.js` also accepts 40, but no 40x40 animation has been verified
  on the two ESP32-C6 boards — they have no PSRAM and take a different render
  path. Author 20x20 unless the user explicitly asks for 40 and accepts that.)
- **Cell values** must satisfy `0 <= v < palette.length`. Not `< 36` — an index
  into a declared entry. Declaring three colours and using index 3 fails.
- **`hold`** — a positive number of milliseconds, per frame.

Colour note: `#CD7F6A` is silently remapped to `#D97757` on the way to C, so the
creature matches Anthropic's brand terracotta. Write `#D97757` and skip the
detour. All colours are quantised to RGB565 on the device.

## The panel is black

This inverts the instinct you would bring from any light-background pixel art.

- **A dark prop is invisible.** There is no outline, no drop shadow, no border to
  save it. Props must be light against black or they do not exist.
- **Small shapes lose their silhouette.** A 3x3 heart was tried and failed: its
  two top humps read as antennae. The heart in `idle hearts` is **5x3** and beats
  by changing brightness rather than by changing size. Read that as the general
  rule — at this scale, animate a shape's *colour* before you animate its
  *dimensions*.
- **Everything must survive 4 px/cell.** The same animation is drawn as a corner
  badge on the usage screen. A shape that reads at 24 px/cell can turn to mush at
  4, and you cannot see that at any single scale. This is why the verification
  step below is not optional.

## The creature

Measured from the shipped catalogue, not invented:

| | |
|---|---|
| body | `#D97757`, flat, single colour, no gradient or shading |
| eyes | `#0F0F0F`, 1x1 cells |
| mouth | **there is none** — every animation expresses through eyes, posture, and props |
| creature-only footprint | 15x13 to 19x17 inside the 20x20 grid, props included |
| full-scene footprint | up to 20x20 when a scene bleeds to the edges (`hanabi`, the DJ set) |

The absent mouth is a constraint worth keeping rather than working around. At
20x20 a mouth is one cell, and one cell cannot carry an expression. Eye
direction, a bounce, a tilt, and a prop can. Existing vocabulary: eyes shifted
left/right to look at something, eyes hidden for a blink, the whole body raised
one row for a bounce, props entering from off-grid.

## Timing

Catalogue reality, again measured: **4 to 31 frames**, typically 12 to 24. Holds
run from **60 ms to 2400 ms**, and mixing them inside one animation is normal
and good.

`swim summer` is the clearest example: eight frames at 70 ms for a glint sweeping
across a pair of sunglasses, then eight at 700-780 ms of drifting. Half a second
of sparkle, six seconds of doing nothing. Uniform hold times are the mark of an
animation nobody has finished.

Loops are seamless — the last frame hands back to the first with no reset.

## Composition

Give the animation a shape rather than a cycle of poses:

```
setup  →  something happens  →  reaction  →  settle (back to setup)
```

Budget it in frames, not percentages. A prop that enters should enter from
off-grid so the loop point stays clean. Where a beat lands, hold it long; where
motion should feel elastic, shorten the holds into it and lengthen them out of
it.

Keep the scope to one creature, one situation. This grid does not hold two
characters or a scene change.

## Iterating on an existing animation

**This used to be the normal case and is no longer.** Of the 24 files in
`tools/drawn_anims/`, 14 replace a claudepix animation and 10 are new — but on
2026-08-12 every claudepix animation, and every correction to one, was excluded
from the firmware (`EXCLUDE` in `tools/convert_to_c.js`). The device now
carries the 10 originals, with Anthropic's official art to fill the rest.

So fixing a scraped animation is now archaeology, not the job. The techniques
below still apply — they are about reading an animation before changing it,
which is as true of your own work as of somebody else's — but the default task
is drawing an original or importing official art, not correcting claudepix.

**Measure before you redraw.** The contact sheet is necessary and not sufficient.
There is a whole class of defect it cannot show, because a frame identical to the
one before it looks exactly like a deliberate pause:

```bash
node tools/preview_anim.js "idle look around" --rhythm
```

`idle look around` reads as seventeen frames of a creature glancing about. Five
of those frames change nothing at all — a third of the animation is the device
redrawing a picture it already has. That is invisible to the eye and obvious to
arithmetic, and no amount of staring at the sheet would have found it.

Merging a redundant frame into its predecessor's hold plays identically, because
`splash.cpp`'s loop is *hold expires → advance → render* with nothing keyed to
the frame index. Holds are `uint16_t`, so keep merged sums under 65535.

### Defect classes seen in this catalogue

Each of these was a real fix, and each recurs:

| Defect | How it showed up |
|---|---|
| Prop in body colour | an orange snore bubble in `expression sleep`; body-coloured thought marks in `work think`. On black, terracotta-on-terracotta has no edge. |
| Shape cropped off-grid | `dance bounce dj` put his head on row 0, so the headphone band arced above the grid and vanished, leaving two ear cups joined by nothing. |
| Illegible at 4 px/cell | `work coding`, `expression wink` and `expression surprise` were all redrawn for the corner badge, not for the splash. |
| No rhythm | uniform holds, or redundant frames standing in for a pause that `hold` already expresses. |

### Doing it

1. Render and read the current version, with `--rhythm`. Name the defect before
   changing anything — "this reads as busy but eleven of sixteen frames move
   fewer than ten cells" is a diagnosis; "it feels off" is not.
2. Copy the current file if it lives in `tools/claudepix_data/`. **Never edit
   that directory** — the scraper owns it and wipes it on the next run. A fix to
   a scraped animation is a new file in `tools/drawn_anims/` carrying **the same
   `name`**, which is exactly what makes it an override rather than a duplicate.
3. Change only what you diagnosed. Frame counts, holds and staging are somebody's
   arrangement; keeping the parts you are not fixing is not timidity, it is how
   the change stays reviewable.
4. Render **both** and read both:
   ```bash
   git show HEAD:tools/drawn_anims/thing.json > /tmp/thing-before.json
   node tools/preview_anim.js /tmp/thing-before.json --out /tmp/before
   node tools/preview_anim.js "thing"
   ```
5. Say what changed and what it cost — frames removed, bytes saved, what you
   left alone.

## Workflow

1. **Read the existing catalogue first.** `ls tools/drawn_anims/` and open the
   nearest animation to what is being asked for. Match its conventions; do not
   invent a second way of doing the same thing. If the request is a fix rather
   than a new animation, see *Iterating* above — that is the more common case.
2. **Check the name** (see *Naming*).
3. Write the JSON to `tools/drawn_anims/<name_with_underscores>.json`. That
   directory is drop-in — there is no index to update.
4. **Render and look at it** (see *Verification*). Iterate here, not later.
5. **Register it** (see *Getting it on screen*).
6. `node tools/sync_animations.js` — one command for the four things that have
   to happen together:

   | | |
   |---|---|
   | `convert_to_c.js` | animations → `firmware/src/splash_animations.h` |
   | `build_editor_samples.js` | animations → the samples embedded in `tools/anim_editor.html` |
   | `gen_catalogue.js` | firmware → `docs/animation-catalogue.md` |
   | `check_groups.js` | every name the firmware asks for resolves to something |

   It stops at the first failure. Doing three of the four is the easy mistake:
   skip the samples and the device and the web editor disagree about what
   exists; skip the check and an animation ships compiled-in and unreachable.
7. Build and flash.

Never hand-edit `firmware/src/splash_animations.h` or
`docs/animation-catalogue.md`. Both are generated and both say so.

## Verification — not optional

```bash
node tools/preview_anim.js "my anim"
```

This writes a contact sheet to `tools/preview/` with **both device scales in one
image**: the splash scale on top, 4 px/cell along the bottom. Colours are shown
as the device shows them, quantised to RGB565 on black.

**Then actually read the PNG.** Open it with the Read tool and look at it. You
cannot judge a 20x20 animation from the JSON, and you do not get to ask the user
to look at it for you — that is what this tool exists to prevent. Specifically
check:

- Does the shape read at the bottom scale, not just the top one?
- Is any prop dark enough to disappear into the background?
- Does the motion have a rhythm, or is every frame the same distance apart?
- Does the last frame hand back to the first cleanly?

`node tools/preview_anim.js --all` renders the whole catalogue, which is the
fastest way to see whether a new animation sits alongside the others or sticks
out.

## Naming

Names are matched literally, in two places, and both bite silently.

**A duplicate name replaces the other animation.** Later source directories
override earlier ones by name — that is the mechanism by which a hand-drawn file
in `tools/drawn_anims/` fixes a scraped one. It also means picking an existing
name by accident quietly removes the animation you collided with. Check first:

```bash
grep -h '"name"' tools/claudepix_data/*.json tools/custom_anims/*.json tools/drawn_anims/*.json | sort -u
```

Note this is intentional when editing: to fix an existing animation, reuse its
exact name. See *Iterating on an existing animation* — that is what most work
here turns out to be.

Filenames are lowercased and non-alphanumerics collapse to `_` to form the C
identifier, so keep filenames close to the name — `idle wave` →
`idle_wave.json`. Files beginning with `_` are ignored by the converter.

## Getting it on screen

**Adding the file is not enough.** `splash.cpp` picks animations from
`GROUP_NAMES`, matched by literal name, and anything not listed in a group is
never chosen by anything. It will compile, ship, and never appear. Cycling to it
with the `next` serial command renders it perfectly either way, which is what
makes this one hard to catch by looking — `node tools/check_groups.js` is the
thing that catches it, and `sync_animations.js` runs it for you.

[`docs/animation-catalogue.md`](../../../docs/animation-catalogue.md) is the
current state, generated from the firmware: what is in each group, in playback
order, with what is compiled in but picked by nothing.

The groups are keyed to usage rate:

| Group | Meaning |
|---|---|
| 0 | idle / sleepy — the state the device sits in most of the day, so it carries the widest rotation |
| 1 | normal pace |
| 2 | active |
| 3 | heavy |

Slot order inside a group is playback order, and slot 0 is what you meet at boot.

`GROUP_MAX` is **9**. How full each group is right now is in the catalogue above
rather than written here, because a count written into a skill file is wrong the
first time someone adds an animation and does not update it. If the group you
want is full, adding to it means either displacing an entry or raising
`GROUP_MAX` — say which you are doing and why, rather than quietly dropping
something the user arranged.

If you are replacing an existing animation by reusing its name, it is already
registered and this step is done.

## The one animation that isn't picked by rate

`opening` plays once, on the first splash after power-up, and then hands over to
the rate groups. It is the only animation with a beginning and an end rather than
a loop, and the only one not chosen for what it says about the current usage
rate.

If you are asked for a boot animation, that is the slot — there is one, and the
mechanism lives in `splash.cpp` around `SPLASH_OPENING_ANIM`. Do **not** add it
to `GROUP_NAMES`: nothing should rotate onto it, `splash_next()` skips it on
purpose, and the flag that starts it is only true once per boot.

Two consequences worth knowing before editing it:

- **It never appears as a corner badge**, so the 4 px/cell rule does not apply to
  it. Lettering that is illegible in the badge row of a contact sheet is fine
  here and should not be "fixed".
- **It is not cut short by the rotate timer.** Its own hold times are the whole
  budget, so length is a free choice in a way it is not anywhere else.

## Attribution

This repository holds no rights in what it renders. The creature is Anthropic's
character.

The animation catalogue **was** adapted from
[claudepix](https://claudepix.vercel.app) by
[@amaanbuilds](https://x.com/amaanbuilds), which states no license. As of
2026-08-12 none of that material is compiled into the firmware — it stays in
`tools/claudepix_data/`, `tools/custom_anims/` and `tools/drawn_anims/` as
editor samples and as bases for `make_custom_anims.js`, but the device carries
Nova's own drawings and Anthropic's official art. See the license note in
`tools/README.md`.

Practically: an animation that poses the existing creature is derivative and
inherits that posture, whether the pose came from claudepix or from the
official art. Do not add a license header, and do not describe output here as
original work.
