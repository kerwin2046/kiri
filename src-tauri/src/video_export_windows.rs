//! Windows native timeline renderer. Coordinates are normalized to the source frame.
use super::{
    validate_effects, validate_segments, VideoEffect, VideoEffectKind, VideoExportPreset,
    VideoSegment,
};
use anyhow::{bail, Context, Result};
use std::{collections::HashMap, path::Path};
use windows::{
    core::HSTRING,
    Foundation::{Rect, Size, TimeSpan},
    Media::{
        Editing::{
            MediaClip, MediaComposition, MediaOverlay, MediaOverlayLayer, MediaTrimmingPreference,
        },
        Effects::VideoTransformEffectDefinition,
        MediaProperties::MediaEncodingProfile,
        Transcoding::{MediaTranscoder, TranscodeFailureReason},
    },
    Storage::{FileProperties::VideoOrientation, StorageFile},
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

// WinRT rejects forward slashes even though Rust file APIs accept them.
// Keep UTF-16 intact so paths containing non-ASCII names remain readable.
fn storage_file(path: &Path) -> Result<StorageFile> {
    use std::os::windows::ffi::OsStrExt;
    let absolute = std::path::absolute(path)?;
    let wide: Vec<u16> = absolute
        .as_os_str()
        .encode_wide()
        .map(|unit| {
            if unit == b'/' as u16 {
                b'\\' as u16
            } else {
                unit
            }
        })
        .collect();
    StorageFile::GetFileFromPathAsync(&HSTRING::from_wide(&wide))?
        .join()
        .context("could not open native video media file")
}

fn ticks(seconds: f64) -> i64 {
    (seconds * 10_000_000.0).round() as i64
}

pub(super) fn platform_export(
    source: &Path,
    output: &Path,
    segments: &[VideoSegment],
    effects: &[VideoEffect],
    preset: VideoExportPreset,
) -> Result<(i64, i64, f64)> {
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.context("could not initialize Windows media")?;
    let _apartment = Apartment;
    let input = storage_file(source)?;
    let properties = input.Properties()?.GetVideoPropertiesAsync()?.join()?;
    let source_clip = MediaClip::CreateFromFileAsync(&input)?.join()?;
    // Use the editor's exact timebase rather than rounded shell metadata duration.
    let duration = source_clip.OriginalDuration()?.Duration as f64 / 10_000_000.0;
    let segments = validate_segments(segments, Some(duration))?;
    validate_effects(effects, Some(duration))?;
    // Reject ambiguous rotated coordinates instead of silently exposing a masked region.
    // Kiri's own capture encoder writes upright frames without rotation metadata.
    if !effects.is_empty() && properties.Orientation()? != VideoOrientation::Normal {
        bail!("Windows cannot apply video effects to rotated source videos; export an upright copy first");
    }
    let profile = MediaEncodingProfile::CreateFromFileAsync(&input)?.join()?;
    let video = profile.Video()?;
    let (width, height) = (video.Width()?, video.Height()?);
    if width < 2 || height < 2 {
        bail!("Invalid video dimensions");
    }
    let max_edge = preset.max_edge();
    if max_edge > 0 && width.max(height) > max_edge {
        let scale = max_edge as f64 / width.max(height) as f64;
        video.SetWidth(((width as f64 * scale / 2.0).floor() as u32 * 2).max(2))?;
        video.SetHeight(((height as f64 * scale / 2.0).floor() as u32 * 2).max(2))?;
        video
            .SetBitrate(((video.Bitrate()? as f64 * scale * scale).round() as u32).max(500_000))?;
    }
    let (output_width, output_height) = (video.Width()?, video.Height()?);
    let composition = MediaComposition::new()?;
    let masks = MediaOverlayLayer::new()?;
    let images = tempfile::Builder::new()
        .prefix("kiri-video-masks-")
        .tempdir()?;
    let mut mask_files: HashMap<(u32, u32), StorageFile> = HashMap::new();
    let mut output_time = 0_i64;
    let mut overlay_count = 0_usize;
    let mut zoom_count = 0_usize;
    for segment in segments {
        // Each zoom interval becomes a native clip with a constant crop. Mask timing
        // remains independent and uses composition time after deleted footage is removed.
        let mut boundaries = vec![ticks(segment.start), ticks(segment.end)];
        for effect in effects
            .iter()
            .filter(|effect| effect.kind == VideoEffectKind::Zoom)
        {
            for boundary in [ticks(effect.start), ticks(effect.end)] {
                if boundary > ticks(segment.start) && boundary < ticks(segment.end) {
                    boundaries.push(boundary);
                }
            }
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        for range in boundaries.windows(2) {
            let (start, end) = (range[0], range[1]);
            let mut clip = source_clip.Clone()?;
            let original_duration = clip.OriginalDuration()?.Duration;
            if end > original_duration || end <= start {
                bail!("Invalid native video clip duration");
            }
            clip.SetTrimTimeFromStart(TimeSpan { Duration: start })?;
            clip.SetTrimTimeFromEnd(TimeSpan {
                Duration: original_duration - end,
            })?;
            let zoom = effects.iter().find(|effect| {
                effect.kind == VideoEffectKind::Zoom
                    && ticks(effect.start) <= start
                    && ticks(effect.end) > start
            });
            let viewport = zoom
                .map(|effect| (effect.x, effect.y, effect.width, effect.height))
                .unwrap_or((0.0, 0.0, 1.0, 1.0));
            if let Some(zoom) = zoom {
                let transform = VideoTransformEffectDefinition::new()?;
                transform.SetCropRectangle(Rect {
                    X: (zoom.x * width as f64) as f32,
                    Y: (zoom.y * height as f64) as f32,
                    Width: (zoom.width * width as f64) as f32,
                    Height: (zoom.height * height as f64) as f32,
                })?;
                transform.SetOutputSize(Size {
                    Width: output_width as f32,
                    Height: output_height as f32,
                })?;
                // Run the transform in the transcoder, then compose its encoded
                // result. Attaching this transform directly to a composition clip
                // fails at runtime on Windows with MF_E_INVALID_STREAM_STATE.
                zoom_count += 1;
                let path = images.path().join(format!("zoom-{zoom_count}.mp4"));
                std::fs::File::create(&path)?;
                let destination = storage_file(&path)?;
                let transcoder = MediaTranscoder::new()?;
                transcoder.SetTrimStartTime(TimeSpan { Duration: start })?;
                transcoder.SetTrimStopTime(TimeSpan { Duration: end })?;
                transcoder.AddVideoEffectWithSettings(
                    &transform.ActivatableClassId()?,
                    true,
                    &transform.Properties()?,
                )?;
                let prepared = transcoder
                    .PrepareFileTranscodeAsync(&input, &destination, &profile)?
                    .join()
                    .context("preparing Windows zoom segment")?;
                if !prepared.CanTranscode()? {
                    bail!(
                        "Windows cannot prepare zoom segment: {:?}",
                        prepared.FailureReason()?
                    );
                }
                prepared
                    .TranscodeAsync()?
                    .join()
                    .context("encoding Windows zoom segment")?;
                clip = MediaClip::CreateFromFileAsync(&destination)?
                    .join()
                    .context("opening encoded Windows zoom segment")?;
                let rendered_duration = clip.OriginalDuration()?.Duration;
                if rendered_duration < end - start - 500_000 {
                    bail!("Windows zoom segment was shorter than requested");
                }
                if rendered_duration > end - start {
                    clip.SetTrimTimeFromEnd(TimeSpan {
                        Duration: rendered_duration - (end - start),
                    })?;
                }
            }
            composition.Clips()?.Append(&clip)?;
            for mask in effects
                .iter()
                .filter(|effect| effect.kind == VideoEffectKind::Mask)
            {
                let mask_start = start.max(ticks(mask.start));
                let mask_end = end.min(ticks(mask.end));
                if mask_end <= mask_start {
                    continue;
                }
                let Some(rect) = mask_rectangle(mask, viewport, output_width, output_height) else {
                    continue;
                };
                overlay_count += 1;
                if overlay_count > 4096 {
                    bail!("Too many overlapping video effects; simplify the timeline");
                }
                let dimensions = (rect.Width as u32, rect.Height as u32);
                let mask_file = if let Some(file) = mask_files.get(&dimensions) {
                    file.clone()
                } else {
                    // Match image and destination aspect ratios, preventing image-fit
                    // letterboxing from leaving any part of the privacy rectangle visible.
                    let path = images
                        .path()
                        .join(format!("{}x{}.png", dimensions.0, dimensions.1));
                    image::RgbaImage::from_pixel(
                        dimensions.0,
                        dimensions.1,
                        image::Rgba([0, 0, 0, 255]),
                    )
                    .save(&path)?;
                    let file = storage_file(&path)?;
                    mask_files.insert(dimensions, file.clone());
                    file
                };
                let mask_clip = MediaClip::CreateFromImageFileAsync(
                    &mask_file,
                    TimeSpan {
                        Duration: mask_end - mask_start,
                    },
                )?
                .join()?;
                let overlay = MediaOverlay::CreateWithPositionAndOpacity(&mask_clip, rect, 1.0)?;
                overlay.SetAudioEnabled(false)?;
                // Delay is absolute from the composition start, even within one layer.
                overlay.SetDelay(TimeSpan {
                    Duration: output_time + mask_start - start,
                })?;
                masks.Overlays()?.Append(&overlay)?;
            }
            output_time += end - start;
        }
    }
    if overlay_count > 0 {
        composition.OverlayLayers()?.Append(&masks)?;
    }
    std::fs::File::create(output)?;
    let destination = storage_file(output)?;
    let result = composition
        .RenderToFileWithProfileAsync(&destination, MediaTrimmingPreference::Precise, &profile)?
        .join()
        .context("rendering Windows edited composition")?;
    if result != TranscodeFailureReason::None {
        bail!("Windows cannot export this video: {result:?}");
    }
    let actual = destination
        .Properties()?
        .GetVideoPropertiesAsync()?
        .join()?;
    Ok((
        i64::from(actual.Width()?),
        i64::from(actual.Height()?),
        actual.Duration()?.Duration as f64 / 10_000_000.0,
    ))
}

fn mask_rectangle(
    mask: &VideoEffect,
    viewport: (f64, f64, f64, f64),
    width: u32,
    height: u32,
) -> Option<Rect> {
    let (x, y, w, h) = viewport;
    let left = ((mask.x.max(x) - x) / w).clamp(0.0, 1.0);
    let top = ((mask.y.max(y) - y) / h).clamp(0.0, 1.0);
    let right = (((mask.x + mask.width).min(x + w) - x) / w).clamp(0.0, 1.0);
    let bottom = (((mask.y + mask.height).min(y + h) - y) / h).clamp(0.0, 1.0);
    if right <= left || bottom <= top {
        return None;
    }
    // Outward rounding guarantees at least the requested source area is covered.
    let left = (left * width as f64).floor();
    let top = (top * height as f64).floor();
    let right = (right * width as f64).ceil();
    let bottom = (bottom * height as f64).ceil();
    Some(Rect {
        X: left as f32,
        Y: top as f32,
        Width: (right - left) as f32,
        Height: (bottom - top) as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real Windows media round-trip, using only disposable synthetic fixtures.
    /// Runs on the Windows CI runner; a missing encoder or compositor is a failure.
    #[test]
    fn windows_native_video_export_smoke() -> Result<()> {
        use windows::{
            Graphics::Imaging::{
                BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform,
                ColorManagementMode, ExifOrientationMode,
            },
            Media::{Editing::VideoFramePrecision, MediaProperties::VideoEncodingQuality},
        };
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { RoUninitialize() };
            }
        }
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }?;
        let _apartment = Apartment;
        let (directory, _cleanup) = if let Some(root) = std::env::var_os("KIRI_VIDEO_QA_DIR") {
            std::fs::create_dir_all(&root)?;
            let temporary = tempfile::Builder::new()
                .prefix("windows-native-video-")
                .tempdir_in(root)?;
            (temporary.keep(), None)
        } else {
            let temporary = tempfile::Builder::new()
                .prefix("kiri-native-video-test-")
                .tempdir()?;
            (temporary.path().to_path_buf(), Some(temporary))
        };
        // Exercise mixed separators and a Unicode name independently of encoding.
        let path_probe = directory.join("路径-check.txt");
        std::fs::write(&path_probe, "local test")?;
        let mixed_path = path_probe.to_string_lossy().replace('\\', "/");
        storage_file(Path::new(&mixed_path)).context("mixed-separator path regression")?;
        let fixture = MediaComposition::new()?;
        for (index, color) in [[240, 20, 20, 255], [20, 20, 240, 255]]
            .into_iter()
            .enumerate()
        {
            let mut bitmap = image::RgbaImage::from_pixel(320, 180, image::Rgba(color));
            if index == 1 {
                // The marker is only at the inspected output position if zoom applied.
                for y in 54..72 {
                    for x in 96..128 {
                        bitmap.put_pixel(x, y, image::Rgba([20, 240, 20, 255]));
                    }
                }
            }
            let path = directory.join(format!("fixture-{index}.png"));
            bitmap.save(&path)?;
            let image = storage_file(&path)?;
            let clip = MediaClip::CreateFromImageFileAsync(
                &image,
                TimeSpan {
                    Duration: ticks(2.0),
                },
            )?
            .join()?;
            fixture.Clips()?.Append(&clip)?;
        }
        let source_path = directory.join("source.mp4");
        std::fs::File::create(&source_path)?;
        let source = storage_file(&source_path)?;
        let profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p)?;
        let video = profile.Video()?;
        video.SetWidth(320)?;
        video.SetHeight(180)?;
        video.SetBitrate(2_000_000)?;
        video.FrameRate()?.SetNumerator(30)?;
        video.FrameRate()?.SetDenominator(1)?;
        let status = fixture
            .RenderToFileWithProfileAsync(&source, MediaTrimmingPreference::Precise, &profile)?
            .join()?;
        assert_eq!(
            status,
            TranscodeFailureReason::None,
            "synthetic source encoding failed"
        );

        let output = directory.join("edited.mp4");
        let (width, height, duration) = platform_export(
            &source_path,
            &output,
            &[
                VideoSegment {
                    start: 0.5,
                    end: 1.5,
                },
                VideoSegment {
                    start: 2.5,
                    end: 3.5,
                },
            ],
            &[
                VideoEffect {
                    kind: VideoEffectKind::Zoom,
                    start: 2.5,
                    end: 3.5,
                    x: 0.25,
                    y: 0.25,
                    width: 0.5,
                    height: 0.5,
                },
                VideoEffect {
                    kind: VideoEffectKind::Mask,
                    start: 2.75,
                    end: 3.25,
                    x: 0.3,
                    y: 0.3,
                    width: 0.1,
                    height: 0.1,
                },
            ],
            VideoExportPreset::Original,
        )?;
        assert_eq!((width, height), (320, 180));
        assert!(
            (duration - 2.0).abs() < 0.1,
            "unexpected edited duration: {duration}"
        );
        assert!(std::fs::metadata(&output)?.len() > 1000);
        let exported = storage_file(&output)?;
        let decoded = MediaComposition::new()?;
        decoded
            .Clips()?
            .Append(&MediaClip::CreateFromFileAsync(&exported)?.join()?)?;
        let pixel = |time: f64, x: usize, y: usize| -> Result<[u8; 3]> {
            let stream = decoded
                .GetThumbnailAsync(
                    TimeSpan {
                        Duration: ticks(time),
                    },
                    320,
                    180,
                    VideoFramePrecision::NearestFrame,
                )?
                .join()?;
            let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
            assert_eq!((decoder.PixelWidth()?, decoder.PixelHeight()?), (320, 180));
            let data = decoder
                .GetPixelDataTransformedAsync(
                    BitmapPixelFormat::Rgba8,
                    BitmapAlphaMode::Ignore,
                    &BitmapTransform::new()?,
                    ExifOrientationMode::IgnoreExifOrientation,
                    ColorManagementMode::DoNotColorManage,
                )?
                .join()?
                .DetachPixelData()?;
            image::RgbaImage::from_raw(320, 180, data.to_vec())
                .context("decoded frame has an unexpected byte count")?
                .save(directory.join(format!("frame-{time:.2}.png")))?;
            let offset = (y * 320 + x) * 4;
            Ok([data[offset], data[offset + 1], data[offset + 2]])
        };
        let red = pixel(0.5, 64, 36)?;
        assert!(
            red[0] > 180 && red[1] < 60 && red[2] < 60,
            "first retained segment changed: {red:?}"
        );
        for time in [1.1, 1.9] {
            let green = pixel(time, 64, 36)?;
            assert!(
                green[0] < 60 && green[1] > 180 && green[2] < 60,
                "zoom or mask timing wrong at {time}: {green:?}"
            );
        }
        let black = pixel(1.5, 64, 36)?;
        assert!(
            black.iter().all(|value| *value < 35),
            "privacy mask missing: {black:?}"
        );
        let blue = pixel(1.5, 256, 144)?;
        assert!(
            blue[0] < 60 && blue[1] < 60 && blue[2] > 180,
            "mask unexpectedly covers surrounding content: {blue:?}"
        );
        Ok(())
    }

    fn mask(x: f64, y: f64, width: f64, height: f64) -> VideoEffect {
        VideoEffect {
            kind: VideoEffectKind::Mask,
            start: 0.0,
            end: 1.0,
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn privacy_mask_is_clipped_and_mapped_into_zoom_viewport() {
        let rect = mask_rectangle(
            &mask(0.125, 0.25, 0.375, 0.5),
            (0.25, 0.25, 0.5, 0.5),
            1000,
            500,
        )
        .unwrap();
        assert_eq!(
            (rect.X, rect.Y, rect.Width, rect.Height),
            (0.0, 0.0, 500.0, 500.0)
        );
        assert!(mask_rectangle(
            &mask(0.0, 0.0, 0.125, 0.125),
            (0.25, 0.25, 0.5, 0.5),
            1000,
            500
        )
        .is_none());
    }

    #[test]
    fn privacy_mask_rounding_never_reveals_requested_pixels() {
        let rect = mask_rectangle(
            &mask(0.1234, 0.2345, 0.02, 0.03),
            (0.0, 0.0, 1.0, 1.0),
            100,
            100,
        )
        .unwrap();
        assert!(f64::from(rect.X) <= 12.34);
        assert!(f64::from(rect.Y) <= 23.45);
        assert!(f64::from(rect.X + rect.Width) >= 14.34);
        assert!(f64::from(rect.Y + rect.Height) >= 26.45);
    }
}
