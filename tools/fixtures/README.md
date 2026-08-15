# Fixtures for other people's tests

Nothing in this repo reads these files. They exist so that a program on the
other side of a format boundary can test against a payload **this** program
actually produced.

## Why they are captures and not examples

A hand-written "this is what it should look like" proves nothing about the
producer, and a fixture the consumer wrote itself proves only that the consumer
agrees with the consumer. When two programs on separate release cycles have to
read the same bytes, the test that means something is the one where the sample
came from the other side.

So every file here was **captured, not composed**: the editor was driven through
the real gesture, and the bytes were read back off the system clipboard with
`pbpaste`.

## `clip-fragment-v1.json`

The frame-fragment clipboard payload — `docs/animation-contract.md` § 7.

| | |
|---|---|
| captured | 2026-08-15 |
| from | `tools/anim_editor.html`, sample `jumping blossom` (40×40) |
| frame | 3 |
| selection | 6×6 at row 2, column 18 — clicked the toolbar's 複製 |
| read with | `pbpaste` |

It was chosen to exercise the parts of the format that are easy to get wrong:

- **transparent cells** (index 0) — the shape inside the rectangle is not a
  rectangle, and index 0 is what carries that
- **three colours, re-indexed** — the source document had these at palette
  indices 5, 1 and 4; the payload renumbers them to 1, 2 and 3, because an index
  is meaningless outside the document it came from
- **an origin away from the top-left**, so a reader that ignores `r`/`c` and
  pastes at 0,0 fails visibly rather than subtly
- **a fragment overlapping two things at once** — a flower and the creature's
  body — so a reader that assumes one object per fragment fails too

A reader that handles this file correctly should end up with a 6×6 block whose
cells are the same colours, in the same places, as the source.

### Re-capturing

Only if the format changes. Serve `tools/` over HTTP (the editor also opens from
`file://`, but a capture is easier to script over a port), load the sample, make
the selection, click 複製, and `pbpaste` into this file. Then say so in the table
above — a fixture whose provenance is unrecorded is a fixture nobody can check.
