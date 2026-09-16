# 0036 — Video annotation tracks and playback controls

Status: Accepted

## Context

Floating editor actions collide with native video hover controls and disappear
against light recordings. Timed privacy effects also need independent tracks,
with the same editable tools users already have for screenshots.

## Decision

Place editor actions and playback controls in opaque rows outside the picture.
Use a local speed picker with presets and a custom 0.1–8× value; remember the
preference without changing exported timing.

Reuse screenshot pen, rectangle, line, arrow, text and continuous pixel/blur
mosaic tools. Each mark has an independent source-time interval, exposed as a
draggable timeline row. Edits, geometry and timing share the clip/effect undo
history. Commit pending text before navigation, leaving annotation mode or export.

Export cropped raster overlays and mosaic alpha masks through platform media
APIs. Mosaic samples every source frame; annotations and opaque masks precede
zoom. Keep originals unchanged, preserve audio and create a separate library copy.
Editing remains local to the current viewer session.

## Consequences

Toolbars remain discoverable on both light and dark recordings. Independent
tracks can overlap without forcing marks to share timing. Rasterized text uses
the same local fonts as the editor; bounded payloads protect native memory use.
Windows CI must verify timed annotations, dynamic mosaic and retained audio in
actual encoded output; cross-compilation alone does not establish correctness.
