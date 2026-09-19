# 0042 — Readable video tools and explicit track order

Status: accepted

## Context

Tool names alone did not explain what an effect did. Timing bars could move
horizontally but their labels could not be dragged, and native composition was
fixed by tool kind. This made the editor hard to understand and gave no way to
put a sticker or annotation in front of a privacy mask.

## Decision

Effect choices describe a concrete purpose before exposing parameters. The
main list contains zooming a detail, hiding private information and highlighting
an area. Crop/background and fade remain available under finishing touches.
The inspector offers a clear return to the tool list; precise source times are
secondary to direct manipulation on the timeline.

Each track has a left grip for vertical order, a middle for horizontal movement
and wider end handles for timing. Pointer drags and keyboard adjustments use the
same bounded model. A completed gesture creates one undo entry; Escape restores
the starting state. Dragging at a scroll edge scrolls only the track list.

There are two ordered stacks. Overlays contain annotations, stickers, privacy
masks and spotlight. Upper rows cover lower rows. Whole-picture adjustments
contain zoom, crop/background and fade; they operate on the completed overlay
composition and can be reordered within their group. The groups make these
different scopes explicit instead of implying that a camera operation is a
movable sticker.

Preview and both native encoders honor the same layer ranks. Live annotation
marks are composited in that stack too; the shared annotation canvas retains a
transparent interaction layer for handles, text editing and hit testing. Old
export payloads without ranks retain their previous composition.

This supersedes the fixed composition sequence in ADR 0041 while retaining its
single canvas, single playback control and top-right export placement.

## Verification

Pointer acceptance checks cover vertical ordering, horizontal movement, both
trim handles, undo/redo, internal scrolling and stable preview bounds. Native
decoded-frame tests verify that an annotation above a mask is visible and the
same annotation below it is covered. Windows also verifies the CPU composition
order with pixel assertions in CI.
