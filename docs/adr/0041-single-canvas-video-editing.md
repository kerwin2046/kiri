# 0041 — Single-canvas video editing

Status: Accepted

## Decision

The editor has one central picture and one Play/Pause control (Space). Selecting
an effect does not switch to an original-frame mode. Zoom/frame regions are
repositioned by dragging the actual image; other overlays use source-to-output
coordinates for their handles. Live annotation drafts pass through the compositor,
including while zoomed. Appearance controls occupy the fixed inspector, leaving
one compact tool row above the picture. Adding tracks does not resize the picture.

Export lives at the top right. Its popover contains quality, exact dimensions,
Save a Copy and progress/result feedback. Escape dismisses this popover before
closing the viewer. No export footer or separate effect-preview actions remain.

The ruler and playhead scrub explicitly through pointer events, including in
WKWebView. One clip can be scrubbed directly; multiple clips can be dragged to
reorder, with an insertion marker. Edges trim. The track area has a bounded height,
its own scrollbar, and a draggable divider; double-click restores its default size.

Spotlight dims pixels outside a source rectangle. Crop/background fits a chosen
crop into the existing output canvas without stretching; full image, square,
landscape and portrait crops share adjustable padding and an RGB background.
Fade uses a smoothstep entry and exit with an RGB fade color. Effects retain
source-time intervals through clip rearrangement and speed changes. One zoom,
one crop and one fade can apply at a time; they may combine with each other.

Composition order is annotation/sticker, privacy mask, spotlight, zoom, crop with
background, then fade. Canvas, Core Image (explicit sRGB working space) and the
Windows frame compositor share these operations. No executable or service is
added. Crop retains the selected output canvas dimensions; it does not create a
new aspect-ratio export format.

## Verification

Check pointer and keyboard scrubbing, reorder/trim and undo, zoomed annotation
placement, stable bounds while adding tracks, narrow windows, top-level export
and nested quality menus. Check native decoded pixels for live source changes,
spotlight exclusion, crop/background geometry and fade opacity. Windows uses
remote CI for native renderer, packaging and desktop acceptance.
