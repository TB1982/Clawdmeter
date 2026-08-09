# Animation craft notes

What we have learned about making a 20×20 animation read, as opposed to how the
pipeline works (`tools/README.md`) or how to carry out the task
(`.claude/skills/clawdmeter-animation/SKILL.md`).

Entries carry the animation they came from and the date they were found. A claim
with a date is history and stays true; a claim without one quietly rots into a
wrong instruction. If something here stops being true, add the correction and its
date rather than editing the original away.

---

## Shapes

**A single cell is dust, not a bud.** Tried as the opening stage of a flower in
`idle blossom` and dropped: at 24 px/cell it reads as a speck of dirt, at 4 px it
is invisible. *(2026-08-09)*

**A horizontal three-cell shape is a dash.** Same animation, tried as the closing
stage. Pink-yellow-pink reads as a minus sign. *(2026-08-09)*

**A vertical three-cell shape survives**, because it keeps a stem-and-head
silhouette. It reads as a *closed bud* rather than a stick — but only when open
flowers are visible beside it. On a contact sheet in isolation it still looked
like a stick; on the panel, in context, it did not. *(2026-08-09)*

**A 3×3 heart is not a heart.** Its two top humps read as antennae. The heart in
`idle hearts` is 5×3 and beats by changing brightness rather than by changing
size. Generalise: at this scale, animate a shape's *colour* before its
*dimensions*. *(before 2026-08-08)*

**A shape may be cut.** This is the most expensive thing on this page, because
not knowing it cost four rebuilds of `idle blossom`.

Requiring a flower's whole 3×3 footprint to be clear of the creature is a
*self-imposed* constraint, and it makes the grid look far more crowded than it
is — it produces conclusions like "there is no room beside his shoulders" and
"no radius fits a ring around him", both of which are false. A flower against his
head simply loses the petal that would fall on him. One at the edge loses
whatever falls off the grid. A lone petal can sit in the two-column margin beside
his arm with its centre nowhere on screen at all.

Cut flowers read as flowers *behind* him showing an edge, which is exactly what a
ring around him looks like from the front. *(Nova, 2026-08-09)*

---

## What the tools can and cannot tell you

**A contact sheet shows shape, colour and density. It does not show motion.**
Four drafts of `idle blossom` were judged from contact sheets and all four were
wrong in ways a single viewing caught immediately — converging when they should
have radiated, popping when they should have travelled. If the change is about
movement, the sheet is the wrong instrument. *(2026-08-09)*

**Arithmetic finds what the eye cannot.** `idle look around` was rendered, looked
at, and reported as "I can't tell what's moving". Five of its seventeen frames
are byte-identical to the frame before them — a third of the animation redrawing
a picture the device already has. This is invisible *by construction*: a repeated
frame looks exactly like a deliberate pause. `preview_anim.js --rhythm` finds it
in one pass. *(2026-08-09)*

Across the catalogue at the time: 26 of 327 frames, 10.4 KB of flash.

**The device shows what neither shows: context.** The vertical bud above is the
example — weak in isolation on a sheet, fine on the panel with open flowers
around it. Do not trim a shape that looks weak alone until it has been seen among
the others. *(2026-08-09)*

**A human watching it is an instrument you do not have.** Every substantive
correction to `dance bounce` and `idle blossom` came from someone watching the
loop, not from a still. Ship it to the device and ask. *(2026-08-09)*

---

## Props that mean something

A prop carrying *mood* — a heart, a flower, a dust puff — can come and go however
it likes. A prop carrying *meaning* — a word, a number, a symbol — cannot, and
the difference is not a matter of taste.

`expression wink` lights its OK sign one letter at a time, the O a frame before
the K, but removes both at once. That asymmetry looks like an oversight and is
not. **Assembling toward a meaning is free; disassembling away from one is not**,
because the intermediate states of a word are other words. Going in you read
nothing, then O, then OK — the first two are unfinished. Coming out staggered you
would read OK, then a lone O, which is not an unfinished OK, it is a different
thing on the screen.

So: stagger the entrance of a semantic prop if you like, and take it off whole.
The same holds for anything read rather than felt — a percentage, an arrow, a
digit. *(Nova, 2026-08-09)*

Corollary for the rule above about animating colour before dimensions: with
lettering, brightness is the only dimension you have. The OK runs
`#FFD98A → #FFD24D → #FFBF00 → #FFD98A → #FFE699` and never changes shape.

---

## The two scales

The same animation is drawn twice: large on the splash, and 4 px/cell as the
corner badge on the usage screen. They fail differently, which is why
`preview_anim.js` renders both and the editor previews both.

**At badge scale, what survives is density and colour spread, not shape.** The
whole animation is 80×80 screen pixels there and a single 5-cell flower is about
twelve of them — nobody reads five petals at that size. What is legible is
whether there is a lot of something, and whether it is made of more than one
colour.

This is what decided `idle blossom`. The hand-drawn wreath carries 40 flower
cells at its peak in five colours; the mathematically exact ellipse built beside
it carried 27 in the same five. On the splash that difference reads as "fuller".
On the badge it is closer to the difference between something and nothing — the
wreath is the first version of that animation to read as anything at all at
4 px/cell. *(2026-08-09)*

Corollary: when choosing between two versions, check the badge before deciding.
A change that looks like a matter of taste at 24 px/cell can be the whole image
at 4.

---

## Timing

**Uneven holds are right for breathing and wrong for travelling.** `idle blossom`
inherited the breathing's 80–700 ms holds while flowers advanced one position per
frame, so a rising flower stepped, stalled for most of a second, then stepped
again. Resampling onto an even tick fixed it. *(2026-08-09)*

**Resampling keeps the original exactly.** Split each hold into equal pieces that
sum back to the same number: the poses and the times they appear survive to the
millisecond, and anything travelling gets more, evenly spaced, steps. Assert the
total afterwards. *(2026-08-09)*

**A lifecycle must divide the loop.** Counting a prop's age modulo the frame
count instead of modulo its own life left every flower alive for 5 frames out of
16 and the screen nearly bare. If the life does not divide the loop, the seam
jumps. Make the generator refuse. *(2026-08-09)*

**Watch the parity of offsets.** Props that step every second frame, given
offsets that are all even, all move on the same beat — and nothing at all changes
on the other one. That produced 13 dead frames out of 32 in one draft and 11 in
another. Interleave odd and even. *(2026-08-09)*

**Uniform holds are the mark of an unfinished animation.** `swim summer` runs
eight frames at 70 ms for a glint sweeping across sunglasses, then eight at
700–780 ms of drifting: half a second of sparkle, six seconds of doing nothing.
*(before 2026-08-08)*

---

## Colour

**The panel is black, so a dark prop is not there.** No outline, no shadow, no
border will save it. Props must be light. *(before 2026-08-08)*

**Colour by direction, not by frame.** Colouring a radial burst per frame makes
one ring change hue as it expands; colouring per angle keeps each bloom one
colour the whole way out, and the burst reads as several different flowers
leaving together. Mirroring left and right reads as chosen rather than scattered.
*(2026-08-09)*

**A prop drawn in the body colour disappears into the body.** An orange snore
bubble in `expression sleep`, body-coloured thought marks in `work think` — both
were real defects that had to be fixed. *(before 2026-08-08)*

The palette cap is 16 (raised from 10 on 2026-08-08). Most animations use 3–8.
Everything is quantised to RGB565 on the device, so two hexes can collapse to the
same value; `preview_anim.js` shows them quantised for that reason.

---

## Composition

**Simultaneity is what makes a ring a ring.** A fountain is one point emitting in
sequence; a ring is many points appearing at once and moving out together. Four
drafts tried to build a ring out of staggered rays and all of them read as
welling up from one spot. It is not about the circle. *(Nova, 2026-08-09)*

**Equal arc, not equal angle.** Spacing the same number of flowers evenly by
angle crowds the small rings — adjacent blooms land two cells apart, share a
petal, and the inner ring comes out as a solid band. Let the count grow with
circumference. *(2026-08-09)*

**The grid is not symmetric about the creature.** He is centred on column 10, but
the columns run 0–19, so column 0's mirror is column 20 and does not exist.
Exact mirror symmetry therefore has to drop cells at the far left, or accept a
few asymmetric ones. *(2026-08-09)*

**Regularity is not the goal.** A mathematically exact ellipse was built as a
comparison for `idle blossom` — zero asymmetric cells in all six frames against
`0,0,1,7,5,1` for the hand-drawn one — and it lost: it peaked at 27 flower cells
against 40 and never reached below his shoulders. Regular and thin beats nothing.
The hand-drawn version ships. *(2026-08-09)*

---

## This sprite's geometry, measured

Body occupies rows 5–18 and columns 3–17 as he breathes. What is free on
*every* frame:

| rows | free columns |
|---|---|
| 0–4 | all |
| 5–7 | 0–4 and 16–19 |
| 8–12 | 0–2 and 18–19 |
| 13–18 | 0–4 and 16–19 |

His axis is column 10 — his hands sit at 3 and 17, not 3 and 16.

Catalogue ranges as of 2026-08-09: 4–31 frames (typically 12–24), holds 60–2400
ms, palettes 3–16 entries, creature-only footprint 15×13 to 19×17 inside the
20×20 grid.

---

## Traps that fail silently

Both of these compile, ship, and look like nothing is wrong:

- **A duplicate `name` replaces another animation.** That is the mechanism by
  which `drawn_anims/` corrects a scraped original — and it means choosing an
  existing name by accident quietly deletes the animation you collided with.
- **A name absent from `GROUP_NAMES` in `splash.cpp` is never picked.** The
  animation exists in the build and never appears on the device.

`GROUP_MAX` is 9 and group 0 was full as of 2026-08-09, so adding there is a
displacement decision rather than an append.
