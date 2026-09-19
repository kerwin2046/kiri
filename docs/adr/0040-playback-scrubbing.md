# 0040 — Consistent playback scrubbing

Status: Accepted

## Decision

Playback and volume sliders retain native range-input keyboard and accessibility
semantics, with Kiri-owned rails, fill, handles and focus states across platforms.
The seek target stays 28 px high while the visible rail is compact. Hover shows
the target time; dragging pauses playback and release restores its previous state.
Playback updates the progress position each animation frame, and reduced-motion
preferences disable decorative transitions. Controls remain outside the picture.

## Verification

Exercise click-to-seek, keyboard adjustments, paused and playing scrubs, and a
400 px wide window. Seeking must not change the export speed or edited document.
