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

**Dithering does not survive 20 cells.** The official Claude FM art draws its
wave as a halftone of dots, and copying that for `surfing` produced a
chequerboard — a 4×4 Bayer threshold spread across a 20-wide grid is a visible
pattern, not a gradient. That canvas is roughly ten times wider, which is what
lets its dots blur into one. Everything that reads here is solid shapes with a
broken edge: the rain, the leaf, the wreath.

For water, what worked was solid fill with the boundary displaced by two
scrolling sines of unrelated period. The edge then *travels*. Displacing it with
per-frame random noise instead makes it boil, which reads as television static.
*(2026-08-09)*

**The rain, the wave and the fire are the same generator.** Solid fill, with the
boundary carrying all the texture, displaced by two or three sines whose periods
share no common factor. Only the output changes: rain drives where a drop lands,
water drives surface height, fire drives the height of each flame tongue.

Two constraints make it work. Periods that *are* related let the pattern repeat
within a few cells and the eye names it as machine-drawn immediately. And every
time term must complete a whole number of cycles across the frame count, or the
loop has a visible seam at the wrap. Checkable after the fact: count the cells
that change from the last frame back to the first and compare it with the
ordinary steps. `this is fine` wraps at 67 against 47–85, so there is no seam.
*(2026-08-10)*

**A flame has two ways to stop being a flame, and they are opposite.** Both were
hit while generating the fire for `this is fine`, in that order.

Modelled as a height field with everything under it filled, fire reads as a slab
of gold. On black at 20 cells the gaps between tongues are as much of the fire as
the tongues; fill them and there is no flame left, only a bright region. Two
attempts died this way and the second also swallowed the creature's legs, leaving
a torso hovering over the floor.

The fix — steepening the falloff so black reappeared between tongues — overshot
into the opposite failure. At a falloff of 4.3 rows per column a tongue 4.2 tall
loses everything one column out, so only its centre column survives: a one-cell
vertical stick. **43% of the generated flame components were sticks three or more
cells tall and one cell wide.** Nova redrew them as tapering triangles by hand and
that fell to 2%.

The rule is a minimum footprint, the same family as the 3×3 heart and the d=5
circle: **a flame is at least three cells wide at its base**, which bounds the
falloff at `2 × height / 3`. Four of the five floor tongues broke it; the two
tall ones at the walls did not, which is why the sticks were all along the floor.
Gaps come from *fewer tongues spaced further apart*, never from sharpening each
one. *(Nova, 2026-08-10)*

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

**Three metrics can all miss what one look finds.** Asked why `dance djmix`
satisfied and `dance bounce dj` and `dance sway dj` did not, three measurements
were computed and none of them explained it:

| | djmix | bounce dj | sway dj |
|---|---|---|---|
| changed cells per frame | 73.2 | 67.8 | 68.0 |
| share of motion on the figure | 64% | **70%** | 47% |
| colours involved per frame | 7.0 | 5.4 | 4.8 |

By the second measure `bounce dj` is the *better* animation. The actual answer —
djmix has a mixing desk and the other two have nothing under them — was visible
in the contact sheet the whole time. Measure after looking, not instead of.
*(2026-08-09)*

**A measurement can be of the wrong thing and still return a number.** Nova said
the generated fire sometimes came out as a single vertical line. Checking that by
histogramming the width of each horizontal run of flame cells gave 67% one-cell
runs in the generated version against 61% in her corrected one — no signal, and
it would have been easy to read as "the change was cosmetic".

The metric was wrong. Every flame tapers, so the top row of a perfectly good
triangle is one cell wide and lands in the same bucket as a stick. Measuring
connected components instead — height, and width at the base — separated them at
once: 43% against 2%.

This is the companion to the entry above. There, three metrics were computed and
none addressed the question. Here one metric was computed, addressed a question,
and it was not the question that had been asked. *(2026-08-10)*

---

## Fix the frame, not the class

When something specific is reported, fix the specific thing. Turning it into a
general rule is the failure mode, because a rule optimises a proxy and the proxy
is not what made the animation work.

Twice in one day, both times the observation was right and the generalisation was
the error:

**"The entrance is staggered and the exit isn't."** True, and mirroring it would
have been wrong: `expression wink`'s OK sign has to leave whole, because the
intermediate states of a word are other words. See *Props that mean something*.

**"Three drops landed in a row above his head."** True of one frame. Made into
"no two drops on the same row anywhere", it forced one drop per column, which
removed the strung-out fall lines that make rain read as rain and halved the
density. The result was snow. The fix that worked was narrow: no two drops on a
row *inside the band enclosed between the leaf and him*, and never three
anywhere. Ordinary pairs out in the open are what rain looks like.

The tell in both cases is the same. A local artefact was explained by a global
symmetry — entrances mirror exits, drops never align — and the symmetry sounded
principled enough that it was not checked against what it would cost. Ask what
the rule forbids that you currently rely on. *(2026-08-09)*

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

### A bigger grid is more detail, not a smaller picture

Upstream moved to a 60×60 stage. Looking at it running on real hardware, the
first reaction was that it wasted space — and the measurement agrees, but not
for the reason it first looks like.

Their art stage is 55×37 of a 60×60 grid, which on a 480×480 panel is 440×296,
and their Clawd occupies 24×16 cells inside it: **192×128 screen pixels.** Ours
is about 336×312. So the same character is drawn at less than half the size,
with the panel's whole vertical margin left dark.

The trap is to read the extra cells as margin. They are not. The panel does not
change size, so going from 20 to 60 takes a cell from 24 px to 8 px and puts
**nine times as many of them in the same physical area.** A 20×20 drawing
upscales into it exactly — each cell becomes a 3×3 block, nothing moves, nothing
is lost — and everything added after that is detail that had nowhere to go
before. Upstream spent that budget on making the character smaller. It can just
as well be spent on making the scene richer.

Two costs, both real. A frame is `side²` bytes, so 3,600 against 400 — a
25-frame animation is 90 KB of flash instead of 10. And a 60×60 animation cannot
carry the corner badge at all: 80 screen pixels across 60 cells is 1.3 px/cell,
well under the 4 px/cell where the section above found the limit of legibility.
Whatever is drawn at 60 is a splash-only animation. *(2026-08-12)*

**Corollary, same day: the biggest grid that fits is usually the wrong one.**
Importing the official art, 14 of the 17 crops fit a 40×40 grid, and putting
them there beat 60×60 on both axes at once — the character goes from 192×128
screen pixels to 288×192, and a frame costs 1,600 bytes instead of 3,600.
Bigger *and* cheaper, because the grid is a resolution, not a canvas size: the
panel is 480 px either way, so fewer cells means each one is larger. Pick the
smallest grid the art fits in, not the largest the pipeline allows.

**And a margin is content.** Placing those imports, "bottom-anchored" was read
as the bottom of the grid, which stood him on the last pixel row of a panel with
rounded corners. Upstream anchors to the bottom of its *stage*, which sits 12
rows of 60 above the grid's bottom edge — 96 px of deliberate floor. Scaling
that margin with the grid (`side/5`) reproduces upstream's placement exactly for
all 17 at 60, and lands the same 96 px at 40. The empty rows under his feet were
not spare room to reclaim; they were the reason he looked like he was standing
somewhere. *(2026-08-12)*

### Which rules here scale with the grid, and which do not

Three kinds, and reading one as another is how "never three drops on a row"
turned rain into graph paper at 60 cells.

**A fraction of the width.** "Never three anywhere" was written on a 20-wide
grid, where three drops span 15% of the row and read as a drawn line. At 60 they
span 5% and read as nothing. Worse, held as a literal three it caps the whole
animation at 2 per row × 60 rows = **3.3% of the grid — below the 3.5% density
of the drawing it was measured from.** The rule forbids its own source. Carried
across as the fraction it was, 2 in 20 becomes 6 in 60 and it means what it
meant.

**A size on the panel.** "A 3×3 heart is not legible" is about screen pixels,
not cells: at 24 px/cell that heart is 72 px across and at 8 px/cell it is 24.
These scale with the grid, the same way `side/5` carries the floor margin.

**A shape's own minimum.** "A flame is at least three cells wide at its base" is
neither of the above. A taper needs three cells to be a taper in any grid; below
that it is a stick, which is what 43% of the generated tongues were. These do
not scale, and scaling them is how the sticks come back.

The test is to ask what the number counts. Things across a width: scales. A
size that lands on glass: scales. Cells inside one shape: does not.
*(2026-08-18)*

**Even spacing is the machine tell, on whichever axis you leave it.** The first
rain built on the note above put a drop every 8 cells down each column — fall
lines, as prescribed, and forty columns of them side by side is graph paper.
"Strung-out" was doing work in that sentence that a lattice does not do: the
drops trail one behind another at *unequal* distances. Spacing them by golden-
ratio steps from a per-column start fixes it, and it is the same fix the columns
themselves already had. Whatever irregularity you gave one axis, the other axis
needs its own. *(2026-08-18)*

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

**Raised again to 36 on 2026-08-11**, which is the ceiling rather than a
preference — `build_editor_samples.js` packs one cell into one base-36
character, so index 35 is the last that survives a round trip. `hanabi` had used
all sixteen and all sixteen were doing work, which is the signal to move a cap:
not that one is full, but that it is full and nothing in it is spare.

The distribution at the time, across 28 animations: median 9 entries, one at 16,
four at 3. So the cap was binding on exactly one animation. Raising it costs
`PALETTE_SIZE × 2` bytes per animation — about 900 bytes across the catalogue,
against 400 bytes for a single frame — and buys nothing for the other 27.
Cheap and narrow is still the right trade when the one it unblocks is the one
being drawn.

What does *not* change is that colour is rarely the binding constraint here.
Cells are. A dark colour still vanishes on black and dithering still does not
survive 20 cells, however many entries the palette has. *(Nova, 2026-08-11)*

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

**Nothing floats.** Nova's son, who had not seen any of the drafts, said he could
not tell the laptop in `work mode` was a laptop: it hung in mid air with nothing
under it. She drew a desk and it read immediately.

It is the same fault that makes `dance bounce dj` and `dance sway dj` unsatisfying
while `dance djmix` works. djmix has a mixing desk — a horizontal structure
spanning the frame, low in it. The other two are a creature with headphones
bobbing in a void. The prop is not decoration, it is the floor, and it is also
the only part of these animations that survives the 4 px badge.

Both times the fault was found by someone looking at the whole picture rather
than at the thing being worked on. *(Nova's son, and 2026-08-09)*

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
ms, palettes 3–16 entries (median 9; the cap moved to 36 on 2026-08-11 but
nothing has spent it yet), creature-only footprint 15×13 to 19×17 inside the
20×20 grid.

**A full-size creature leaves no room for scenery.** `surfing` as first drawn
occupies 61% of the grid. At his own height every row has 5–9 free cells and they
are split into slivers either side of him, so water drawn beside him could only
ever be a bar — three attempts confirmed it before the measurement was taken.
Rows 0–4 have 14–18 free, so the wave had to arrive over the top instead.

`dance djmix` fits an entire mixing desk because its creature is 15×9 with eight
rows below it, against 15×13 with three. If an animation needs a set, the
creature has to be drawn small *first*; scenery cannot be added to a full-size
one afterwards. *(2026-08-09)*

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

The second of these came within one step of biting twice in two days, so it is
now checkable rather than remembered:

```bash
node tools/check_groups.js
```

It compares what is in `splash_animations.h` against every name the firmware asks
for by literal string — the rate groups, the `splash_mini_create()` calls in the
other `.cpp` files, and the `SPLASH_*_ANIM` defines — and exits non-zero if any of
them resolve to nothing. It also lists animations that are in the build and picked
by nothing, which is legitimate (`dance bob` and `work type` are deliberate) but
should be a decision rather than an accident.

What it cannot check is the first trap: a duplicate name is not an error to the
converter, it is the override mechanism. *(2026-08-10)*
