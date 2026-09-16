# 0034 — Local video trimming and microphone checks

Status: Accepted

## Context

A recording often needs its setup and ending removed before it can be used.
Users also need to detect a silent or wrong default microphone before recording.

## Decision

Add a lightweight Trim & Export panel to the existing MP4 viewer. Start/end
controls support numeric entry and selected-range playback. Saving creates a
new video in the managed library, leaving the original unchanged. Editing does
not auto-open after a capture or change clipboard-first screenshot completion.

Use platform-native exports with high-quality source dimensions or 1080/720
long-edge caps. Presets never upscale and do not promise an exact file size.
Do not add cloud upload, external media executables or a multi-track editor.

Show an explicit five-second microphone test when MP4 microphone capture is
enabled. Display the system-default device and audio level; do not store audio,
change the selected recording device, or start listening from saved settings.

## Consequences

Exports require temporary storage for a stable source snapshot and a rendered
copy. Only one video export runs at a time. A library change during export
rejects import instead of placing the copy in another library. Microphone
checks follow native permission policy and stop when the capture ends.
