# 0038 — Output timeline, clip order and local speed

Status: Accepted

## Context

The source-time timeline left deleted gaps visible, used a different clock from
export duration, and treated dragging a clip body as seeking. Adding effect
tracks consumed preview space. A lightweight editor needs direct manipulation
and a consistent representation of the resulting video.

## Decision

The main timeline represents output time. Retained clips appear consecutively in
array order. Dragging a clip body reorders it; edge handles trim its source range.
A selected clip has its own speed from 0.25× to 4×, defaulting to 1×. Splitting
preserves speed. All changes participate in the existing undo/redo history.

Source ranges, annotations and effects retain source-time coordinates. The UI
projects their intersections with retained clips onto output time, and inversely
maps edits. Deleted footage occupies no output space. Reordering does not rewrite
annotation geometry or source timing. The renderer accepts ordered output clips
with nonoverlapping source intervals and calculates duration as the sum of source
durations divided by speed.

The timeline has a bounded, adjustable height. Tracks scroll inside it; playback,
selected-clip controls and export remain available. Additional tracks must not
expand the window or continuously shrink the video preview.

## Native media and compatibility

Missing speed fields decode as 1×. macOS uses native composition time scaling
and spectral audio pitch processing. Windows uses a bounded native frame/audio
pass; rate conversion keeps audio synchronized, with pitch behavior disclosed in
the interface and matched by preview. Neither platform launches or downloads an
external encoder. Playback-only viewer speed remains separate from clip speed.

## Verification

Model tests cover output/source mapping, reordering, splitting and trimming at
mixed speeds. Native fixtures verify output duration, audio and source-timed
effects after mixed-speed reorder. Interaction acceptance exercises actual clip
drags, undo/redo, many tracks, constrained window sizes, preview and export.
