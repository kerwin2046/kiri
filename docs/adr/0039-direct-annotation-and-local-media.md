# 0039 — Direct annotation, stickers and local media import

Status: Accepted

## Decision

Entering video editing shows annotation tools immediately, using the shared
screenshot canvas and appearance preferences. The initial color is Cherry red
only when no choice has been saved. Tool options have reserved space; the
property panel has a fixed area. Adding tracks does not resize the preview or
change the timeline's scroll position.

Privacy style samples show the current selected region, including annotations
and stickers, instead of decorative samples. Local static PNG/JPEG/WebP stickers
are movable, preserve aspect ratio during resizing, retain transparency and
participate in timed tracks, undo/redo and native export. They render above
annotations and below privacy effects. Animated stickers are outside this scope.

The library accepts native file selection and file drops for PNG/JPEG/WebP images
and MP4/MOV videos. Imports copy into the managed library without altering the
source. Images normalize orientation and format; video timing is read through
platform media APIs. File/count/decode limits bound work. Library changes during
import fail rather than importing into an unintended destination. Partial batch
failures report counts and retain successful copies.

Imported assets use their existing editors. Combining multiple external video
sources in one edit is outside this decision. Import never adds network uploads.
