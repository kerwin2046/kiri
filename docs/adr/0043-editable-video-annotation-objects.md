# 0043 — Editable annotation objects in the video picture

Status: accepted

## Context

The previous annotation inspector followed the last drawing tool, even after a
user selected a different track. Selecting a mosaic could show text controls,
and most style changes affected only the next mark. Brush strokes and text had
selection outlines but no resizing handles. Switching to a sticker or effect
also disconnected annotation hit testing. These behaviors made ordinary edits
unpredictable despite the tools being present.

## Decision

Drawing a video annotation selects the resulting object. Its actual kind and
stored values drive the inspector; selecting an object never overwrites its
appearance with drawing defaults. Color, width, font, text background, mosaic
style and intensity can change an existing mark. Sliders show live results and
commit one history entry per completed gesture. Defaults for future marks remain
shared with screenshots and retain the native preference bounds.

All annotation objects expose resize handles; lines and arrows expose endpoints.
Text scales uniformly so dragging does not distort glyphs. Freehand marks retain
their editable points. Mosaic also offers rectangle and ellipse coverage with
independent horizontal and vertical resizing. The optional shape field defaults
to brush when absent, preserving old annotation documents. Region shapes use two
corners and are validated at both persistence boundaries. Preview and export use
the same coverage path, including transparent ellipse corners.

Text offers an explicit Edit text / Finish text action and a content-based track
label. The Text tool can reopen existing text. Enter finishes, Shift + Enter adds
a line, and Escape cancels only the current video text edit. Typing retains native
text undo; document undo remains available in the timeline. Color and background
changes stay live while the editor is open.
The inline editor receives focus after the native pointer default action, so a
click followed immediately by typing works in WebKit as well as Chromium.

The central picture selects overlays by their visible stacking order. A stable
surface owns drags that cross tool modes, while the shared annotation canvas and
existing effect handles retain their local geometry interactions.
Selected zoom and crop tools own picture drags until the user leaves that tool,
so annotations underneath cannot intercept a reframing gesture. Timing remains
on independent tracks, with exact times in a secondary disclosure. Drawing,
selection and inspector changes do not resize the timeline or preview.
Entering the editor expands a small playback window to fit the picture, inspector
and timeline within the current monitor's work area. Existing larger, maximized
and fullscreen windows retain their size.

## Verification

Geometry and persistence tests cover all annotation kinds, legacy/new mosaic
round trips, region hit testing, brush thickness resizing, text scaling, and undo.
Hands-on acceptance covers creation, selection, style edits, movement, resizing,
text re-entry/cancellation, track timing, stacking and export coverage. Native
packaged-app checks and Windows CI remain separate evidence from browser checks.
