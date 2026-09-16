# 0035 — Video timeline and timed effects

Status: Accepted

## Context

Start/end number fields alone do not support cleaning up a demonstration with
unwanted pauses or mistakes in its middle. A useful local editor needs direct
visual selection and source-aware effects while preserving the original.

## Decision

Extend ADR 0034 with a thumbnail source timeline, a seekable playhead, draggable
clip boundaries, split/delete and bounded undo/redo. Retained source intervals
remain chronological; removed intervals stay visibly dimmed for orientation.
Preview skips removed intervals; native export concatenates the retained parts
with their audio. Empty edits cannot be exported.

Timed effects use source timestamps and normalized top-left rectangles. Zooms
are 1.5–4×, preserve aspect ratio and cannot overlap. Opaque black masks may
overlap. Masks apply before zoom, so hidden pixels cannot be revealed by changing
framing. Geometry editing displays the full source; preview displays the composed
result. These are fixed regions, not automatic object tracking or motion effects.

Keep one decoder and twelve bounded thumbnails. No screen data, thumbnail, edit
or recording is uploaded. Native source validation caps clips/effects at 128.
The existing original/share/small export presets remain available. Windows
rejects effects on rotated inputs rather than risking a misplaced privacy mask.

## Consequences

The source-time timeline makes deleted gaps and effect timing explicit, while
rendered output closes gaps. Editing state belongs to the current viewer session;
exports are independent files rather than reopening a saved video project.
