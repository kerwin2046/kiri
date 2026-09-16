# 0037 — Styled video effects and consistent export controls

Status: Accepted

## Decision

Privacy tracks support blur, pixelation, and opaque solid colors. Intensity is adjustable for blur and pixelation; solid masks offer black, white, and custom RGB colors. New masks default to blur. All eight resize handles are available, with zoom preserving the source aspect ratio.

Zoom tracks offer continuous 1.5–4× magnification and adjustable smooth entry and exit. The transition is bounded by half the track duration. Preview and native export interpolate the same source viewport with smoothstep easing; a zero transition retains a hard cut. Masks cover annotations before zoom is applied.

The effect inspector exposes an individual preview action and a duration diagram. Export quality uses a shared keyboard-accessible custom listbox with purposes and actual output dimensions, rather than the platform select menu. Annotation choices reuse this control. Escape closes a listbox without closing the editor.

## Compatibility and verification

Existing effect payloads retain black solid masks and hard-cut zooms. macOS uses Core Image and AVFoundation; Windows uses a bounded Media Foundation frame pass for styled or animated effects, preserving audio. No media executable or network service is added.

Model tests cover resizing, bounds, timing and validation. Native fixtures cover changing source content, timed styles, color, transition edges and audio; Windows runs these in hosted CI. Browser acceptance uses an isolated fixture harness, separate from the application and user library.
