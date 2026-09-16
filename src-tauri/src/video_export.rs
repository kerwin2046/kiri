//! Native, non-destructive MP4 trimming and size presets. Run on a worker thread.
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoExportPreset {
    Original,
    Share,
    Small,
}

impl VideoExportPreset {
    fn max_edge(self) -> u32 {
        match self {
            Self::Original => 0,
            Self::Share => 1080,
            Self::Small => 720,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct VideoSegment {
    pub start: f64,
    pub end: f64,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoEffectKind {
    Zoom,
    Mask,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct VideoEffect {
    pub kind: VideoEffectKind,
    pub start: f64,
    pub end: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoAnnotationKind {
    Overlay,
    Pixelate,
    Blur,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAnnotation {
    pub start: f64,
    pub end: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: VideoAnnotationKind,
    pub image_base64: String,
    pub amount: f64,
}

pub(super) struct PreparedVideoAnnotation {
    pub start: f64,
    pub end: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: VideoAnnotationKind,
    pub image: image::RgbaImage,
    pub amount: f64,
}

fn prepare_annotations(annotations: &[VideoAnnotation]) -> Result<Vec<PreparedVideoAnnotation>> {
    use base64::Engine;
    use image::ImageDecoder;
    if annotations.len() > 128 {
        bail!("Too many video annotations");
    }
    let encoded_bytes = annotations
        .iter()
        .try_fold(0usize, |sum, annotation| {
            sum.checked_add(annotation.image_base64.len())
        })
        .context("Video annotation payload is too large")?;
    if encoded_bytes > 64 * 1024 * 1024 {
        bail!("Video annotation payload is too large");
    }
    let mut remaining = 128u64 * 1024 * 1024;
    annotations
        .iter()
        .map(|annotation| {
            let VideoAnnotation {
                start,
                end,
                x,
                y,
                width,
                height,
                amount,
                ..
            } = *annotation;
            if [start, end, x, y, width, height, amount]
                .iter()
                .any(|value| !value.is_finite())
                || start < 0.0
                || end <= start
                || x < 0.0
                || y < 0.0
                || width <= 0.0
                || height <= 0.0
                || x + width > 1.000001
                || y + height > 1.000001
                || amount < 0.0
                || amount > 1.0
                || (annotation.kind != VideoAnnotationKind::Overlay && amount <= 0.0)
            {
                bail!("Invalid video annotation timing, rectangle or amount");
            }
            let encoded = annotation
                .image_base64
                .strip_prefix("data:image/png;base64,")
                .unwrap_or(&annotation.image_base64);
            let png = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .context("Invalid video annotation base64")?;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(4096);
            limits.max_image_height = Some(4096);
            limits.max_alloc = Some(remaining);
            let decoder =
                image::codecs::png::PngDecoder::with_limits(std::io::Cursor::new(png), limits)
                    .context("Invalid or oversized video annotation PNG")?;
            let (pixel_width, pixel_height) = decoder.dimensions();
            let size = u64::from(pixel_width) * u64::from(pixel_height) * 4;
            let peak_size = if decoder.color_type() == image::ColorType::Rgba8 {
                size
            } else {
                size.checked_add(decoder.total_bytes())
                    .context("Decoded video annotations are too large")?
            };
            if peak_size > remaining {
                bail!("Decoded video annotations are too large");
            }
            let image = image::DynamicImage::from_decoder(decoder)?.into_rgba8();
            remaining -= size;
            Ok(PreparedVideoAnnotation {
                start,
                end,
                x,
                y,
                width,
                height,
                amount,
                kind: annotation.kind,
                image,
            })
        })
        .collect()
}

fn validate_annotation_duration(
    annotations: &[PreparedVideoAnnotation],
    duration: f64,
) -> Result<()> {
    if !duration.is_finite()
        || duration <= 0.0
        || annotations
            .iter()
            .any(|annotation| annotation.start >= duration || annotation.end > duration + 0.05)
    {
        bail!("Video annotation is outside the source duration");
    }
    Ok(())
}

fn validate_effects(effects: &[VideoEffect], duration: Option<f64>) -> Result<()> {
    if effects.len() > 128 {
        bail!("Too many video effects");
    }
    for (index, effect) in effects.iter().enumerate() {
        let VideoEffect {
            start,
            end,
            x,
            y,
            width,
            height,
            ..
        } = *effect;
        if [start, end, x, y, width, height]
            .iter()
            .any(|value| !value.is_finite())
            || start < 0.0
            || end <= start
            || x < 0.0
            || y < 0.0
            || width < 0.02
            || height < 0.02
            || x + width > 1.000001
            || y + height > 1.000001
            || duration.is_some_and(|duration| end > duration + 0.05 || start >= duration)
        {
            bail!("Invalid video effect range or rectangle");
        }
        if effect.kind == VideoEffectKind::Zoom {
            if (width - height).abs() > 0.000001 {
                bail!("Zoom must preserve the video aspect ratio");
            }
            if effects[..index].iter().any(|other| {
                other.kind == VideoEffectKind::Zoom && start < other.end && end > other.start
            }) {
                bail!("Zoom effects must not overlap");
            }
        }
    }
    Ok(())
}

fn validate_segments(
    segments: &[VideoSegment],
    duration: Option<f64>,
) -> Result<Vec<VideoSegment>> {
    if segments.is_empty() || segments.len() > 128 {
        bail!("Video export requires between 1 and 128 segments");
    }
    if duration.is_some_and(|value| !value.is_finite() || value <= 0.0) {
        bail!("Invalid video duration");
    }
    let mut previous_end = 0.0;
    let mut validated = Vec::with_capacity(segments.len());
    for &VideoSegment { start, end } in segments {
        if !start.is_finite() || !end.is_finite() || start < previous_end || end <= start {
            bail!("Invalid or overlapping video segments");
        }
        let end = if let Some(duration) = duration {
            if start >= duration || end > duration + 0.05 {
                bail!("Video segment is outside the source duration");
            }
            end.min(duration)
        } else {
            end
        };
        validated.push(VideoSegment { start, end });
        previous_end = end;
    }
    Ok(validated)
}

/// The caller must remove the returned staging file after importing it.
/// A failed export removes all staging files and never modifies the source.
#[cfg(test)]
pub fn export_video(
    source: &Path,
    segments: &[VideoSegment],
    effects: &[VideoEffect],
    preset: VideoExportPreset,
) -> Result<(PathBuf, i64, i64, f64)> {
    export_video_with_annotations(source, segments, effects, &[], preset)
}

pub fn export_video_with_annotations(
    source: &Path,
    segments: &[VideoSegment],
    effects: &[VideoEffect],
    annotations: &[VideoAnnotation],
    preset: VideoExportPreset,
) -> Result<(PathBuf, i64, i64, f64)> {
    validate_segments(segments, None)?;
    validate_effects(effects, None)?;
    let annotations = prepare_annotations(annotations)?;
    let staging = tempfile::Builder::new()
        .prefix("kiri-video-export-")
        .tempdir()?;
    let output = staging.path().join("export.mp4");
    let (width, height, duration) =
        platform_export(source, &output, segments, effects, &annotations, preset)?;
    if width <= 0
        || height <= 0
        || !duration.is_finite()
        || duration <= 0.0
        || std::fs::metadata(&output)?.len() == 0
    {
        bail!("The native exporter produced an invalid video");
    }
    // Keep only the completed file; directory cleanup also handles native partial files.
    let destination =
        std::env::temp_dir().join(format!("kiri-export-{}.mp4", uuid::Uuid::new_v4()));
    std::fs::rename(&output, &destination).context("could not retain the exported video")?;
    Ok((destination, width, height, duration))
}

#[cfg(target_os = "macos")]
fn platform_export(
    source: &Path,
    output: &Path,
    segments: &[VideoSegment],
    effects: &[VideoEffect],
    annotations: &[PreparedVideoAnnotation],
    preset: VideoExportPreset,
) -> Result<(i64, i64, f64)> {
    use std::{
        ffi::{c_char, CStr, CString},
        os::unix::ffi::OsStrExt,
    };
    #[repr(C)]
    struct NativeAnnotation {
        kind: VideoAnnotationKind,
        start: f64,
        end: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        amount: f64,
        pixels: *const u8,
        pixel_width: u32,
        pixel_height: u32,
    }
    let native_annotations: Vec<_> = annotations
        .iter()
        .map(|annotation| NativeAnnotation {
            kind: annotation.kind,
            start: annotation.start,
            end: annotation.end,
            x: annotation.x,
            y: annotation.y,
            width: annotation.width,
            height: annotation.height,
            amount: annotation.amount,
            pixels: annotation.image.as_raw().as_ptr(),
            pixel_width: annotation.image.width(),
            pixel_height: annotation.image.height(),
        })
        .collect();
    unsafe extern "C" {
        fn kiri_export_video(
            source: *const c_char,
            output: *const c_char,
            segments: *const VideoSegment,
            count: usize,
            effects: *const VideoEffect,
            effect_count: usize,
            annotations: *const NativeAnnotation,
            annotation_count: usize,
            max_edge: u32,
            error: *mut c_char,
            capacity: usize,
        ) -> bool;
    }
    let (_, _, duration) = crate::macos_media::probe_media(source)?;
    let duration = duration.context("video duration is unavailable")?;
    let segments = validate_segments(segments, Some(duration))?;
    validate_effects(effects, Some(duration))?;
    validate_annotation_duration(annotations, duration)?;
    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(output.as_os_str().as_bytes())?;
    let mut error = [0 as c_char; 1024];
    let success = unsafe {
        kiri_export_video(
            source.as_ptr(),
            destination.as_ptr(),
            segments.as_ptr(),
            segments.len(),
            effects.as_ptr(),
            effects.len(),
            native_annotations.as_ptr(),
            native_annotations.len(),
            preset.max_edge(),
            error.as_mut_ptr(),
            error.len(),
        )
    };
    if !success {
        bail!(
            "{}",
            unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy()
        );
    }
    let (width, height, duration) = crate::macos_media::probe_media(output)?;
    Ok((
        width,
        height,
        duration.context("exported duration is unavailable")?,
    ))
}

#[cfg(windows)]
#[path = "video_export_windows.rs"]
mod windows_export;
#[cfg(windows)]
use windows_export::platform_export;

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_export(
    _: &Path,
    _: &Path,
    _: &[VideoSegment],
    _: &[VideoEffect],
    _: &[PreparedVideoAnnotation],
    _: VideoExportPreset,
) -> Result<(i64, i64, f64)> {
    bail!("Native video export is supported on macOS and Windows")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_out_of_bounds_ranges() {
        for (start, end, duration) in [
            (f64::NAN, 1.0, 2.0),
            (0.0, f64::INFINITY, 2.0),
            (-1.0, 1.0, 2.0),
            (1.0, 1.0, 2.0),
            (0.0, 3.0, 2.0),
            (2.0, 2.01, 2.0),
        ] {
            assert!(validate_segments(&[VideoSegment { start, end }], Some(duration)).is_err());
        }
        assert_eq!(
            validate_segments(
                &[VideoSegment {
                    start: 0.2,
                    end: 2.01
                }],
                Some(2.0)
            )
            .unwrap()[0]
                .end,
            2.0
        );
    }

    #[test]
    fn rejects_overlaps_unordered_and_excess_segments() {
        let range = VideoSegment {
            start: 0.0,
            end: 1.0,
        };
        assert!(validate_segments(&[], Some(3.0)).is_err());
        assert!(validate_segments(&[range; 129], Some(3.0)).is_err());
        assert!(validate_segments(&[range, range], Some(3.0)).is_err());
        assert!(validate_segments(
            &[
                VideoSegment {
                    start: 2.0,
                    end: 3.0
                },
                range
            ],
            Some(3.0)
        )
        .is_err());
        assert_eq!(
            validate_segments(
                &[
                    range,
                    VideoSegment {
                        start: 1.0,
                        end: 2.0
                    }
                ],
                Some(3.0)
            )
            .unwrap()
            .len(),
            2
        );
    }

    #[test]
    fn validates_effect_rectangles_timing_and_zoom_overlap() {
        let effect = VideoEffect {
            kind: VideoEffectKind::Zoom,
            start: 0.0,
            end: 1.0,
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 0.5,
        };
        assert!(validate_effects(&[effect], Some(2.0)).is_ok());
        assert!(validate_effects(&[effect, effect], Some(2.0)).is_err());
        assert!(validate_effects(
            &[VideoEffect {
                width: 0.8,
                ..effect
            }],
            Some(2.0)
        )
        .is_err());
        assert!(validate_effects(&[VideoEffect { x: 0.8, ..effect }], Some(2.0)).is_err());
        assert!(validate_effects(&[VideoEffect { end: 3.0, ..effect }], Some(2.0)).is_err());
        assert!(validate_effects(
            &[VideoEffect {
                x: f64::NAN,
                ..effect
            }],
            Some(2.0)
        )
        .is_err());
    }

    fn annotation_png(image: image::RgbaImage) -> String {
        use base64::Engine;
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(png.into_inner())
    }

    #[test]
    fn annotation_payload_limits_and_geometry_are_validated() {
        let annotation = VideoAnnotation {
            start: 0.0,
            end: 1.0,
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 0.5,
            kind: VideoAnnotationKind::Overlay,
            amount: 0.0,
            image_base64: annotation_png(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([255, 0, 0, 255]),
            )),
        };
        assert_eq!(
            prepare_annotations(&[annotation.clone()]).unwrap()[0]
                .image
                .dimensions(),
            (2, 2)
        );
        assert!(prepare_annotations(&vec![annotation.clone(); 129]).is_err());
        assert!(prepare_annotations(&[VideoAnnotation {
            width: f64::NAN,
            ..annotation.clone()
        }])
        .is_err());
        assert!(prepare_annotations(&[VideoAnnotation {
            image_base64: "not-png".into(),
            ..annotation.clone()
        }])
        .is_err());
        assert!(prepare_annotations(&[VideoAnnotation {
            kind: VideoAnnotationKind::Blur,
            ..annotation.clone()
        }])
        .is_err());
        let oversized = annotation_png(image::RgbaImage::new(4097, 1));
        assert!(prepare_annotations(&[VideoAnnotation {
            image_base64: oversized,
            ..annotation
        }])
        .is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_annotations_follow_live_frames_and_independent_time_ranges() {
        use crate::macos_media::MacosSegmentEncoder;
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("moving-stripes.mp4");
        let mut encoder = MacosSegmentEncoder::new(&source, 64, 48, 30, 1_000_000, false).unwrap();
        for index in 0..90 {
            let mut frame = vec![0u8; 64 * 48 * 4];
            for y in 0..48 {
                for x in 0..64 {
                    let channel = if index < 30 {
                        2
                    } else if index < 60 {
                        1
                    } else {
                        0
                    };
                    // Keep high-frequency stripes inside the mosaic region only. The
                    // transparency/orientation probes use the flat right half: otherwise
                    // repeated H.264 chroma subsampling creates red in bright green stripes,
                    // confounding an alpha-compositing assertion with codec reconstruction.
                    frame[(y * 64 + x) * 4 + channel] = if x >= 32 {
                        180
                    } else if x % 4 < 2 {
                        255
                    } else {
                        90
                    };
                    frame[(y * 64 + x) * 4 + 3] = 255;
                }
            }
            assert!(encoder.append_video(&frame, index).unwrap());
        }
        encoder.finish().unwrap();
        let coverage = annotation_png(image::RgbaImage::from_pixel(
            32,
            48,
            image::Rgba([255, 255, 255, 255]),
        ));
        // Asymmetric overlay additionally proves PNG rows retain top-left orientation.
        let mut overlay = image::RgbaImage::new(32, 24);
        for y in 0..12 {
            for x in 0..32 {
                overlay.put_pixel(x, y, image::Rgba([255, 255, 0, 255]));
            }
        }
        let overlay = annotation_png(overlay);
        for kind in [VideoAnnotationKind::Pixelate, VideoAnnotationKind::Blur] {
            let annotations = [
                VideoAnnotation {
                    start: 0.5,
                    end: 2.5,
                    x: 0.0,
                    y: 0.0,
                    width: 0.5,
                    height: 1.0,
                    kind,
                    amount: 0.25,
                    image_base64: coverage.clone(),
                },
                VideoAnnotation {
                    start: 1.0,
                    end: 2.0,
                    x: 0.5,
                    y: 0.0,
                    width: 0.5,
                    height: 0.5,
                    kind: VideoAnnotationKind::Overlay,
                    amount: 0.0,
                    image_base64: overlay.clone(),
                },
            ];
            let (output, _, _, _) = export_video_with_annotations(
                &source,
                &[VideoSegment {
                    start: 0.0,
                    end: 3.0,
                }],
                &[],
                &annotations,
                VideoExportPreset::Original,
            )
            .unwrap();
            let before = frame_at(&output, 0.2);
            assert!(before.get_pixel(8, 24)[0].abs_diff(before.get_pixel(10, 24)[0]) > 80);
            let first = frame_at(&output, 0.7);
            assert!(first.get_pixel(8, 24)[0] > 70 && first.get_pixel(8, 24)[1] < 45);
            assert!(
                first.get_pixel(8, 24)[0].abs_diff(first.get_pixel(10, 24)[0]) < 35,
                "{kind:?} must alter the live source texture"
            );
            let second = frame_at(&output, 1.2);
            assert!(
                second.get_pixel(8, 24)[1] > 70 && second.get_pixel(8, 24)[0] < 45,
                "{kind:?} must use each current source frame"
            );
            let yellow = second.get_pixel(48, 4);
            assert!(
                yellow[0] > 180 && yellow[1] > 180 && yellow[2] < 45,
                "timed overlay missing: {yellow:?}"
            );
            let transparent = second.get_pixel(48, 20);
            // Keep the comparison on the same CI/encoding/color path so this checks
            // alpha independently of legacy untagged-source color interpretation.
            let mut transparent_annotations = annotations.clone();
            transparent_annotations[1].image_base64 = annotation_png(image::RgbaImage::new(32, 24));
            let (control_output, _, _, _) = export_video_with_annotations(
                &source,
                &[VideoSegment {
                    start: 0.0,
                    end: 3.0,
                }],
                &[],
                &transparent_annotations,
                VideoExportPreset::Original,
            )
            .unwrap();
            let control = frame_at(&control_output, 1.2);
            std::fs::remove_file(control_output).unwrap();
            let control = control.get_pixel(48, 20);
            eprintln!(
                "{kind:?} transparent={transparent:?}, control={control:?}, opaque={yellow:?}"
            );
            assert!(
                transparent[0] < 45 && transparent[1] > 130 && transparent[2] < 45,
                "{kind:?} transparent lower overlay half must retain green source: actual={transparent:?}, control={control:?}, opaque={yellow:?}"
            );
            assert!(
                transparent.0.iter().zip(control.0).all(|(actual, expected)| actual.abs_diff(expected) <= 20),
                "{kind:?} transparent region must match source across all channels: actual={transparent:?}, control={control:?}, opaque={yellow:?}"
            );
            let after = frame_at(&output, 2.7);
            assert!(after.get_pixel(8, 24)[2].abs_diff(after.get_pixel(10, 24)[2]) > 80);
            assert!(
                after.get_pixel(48, 4)[0] < 45,
                "overlay must end independently"
            );
            std::fs::remove_file(output).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_sdr_color_metadata_preserves_small_and_hd_recordings_through_ci() {
        use crate::macos_media::MacosSegmentEncoder;
        for (width, height) in [(64usize, 48usize), (1280, 720)] {
            let directory = tempfile::tempdir().unwrap();
            let source = directory.path().join("color-tagged.mp4");
            let mut encoder = MacosSegmentEncoder::new(
                &source,
                width as u32,
                height as u32,
                30,
                2_000_000,
                false,
            )
            .unwrap();
            let mut frame = vec![0u8; width * height * 4];
            for y in 0..height {
                for x in 0..width {
                    let channel = (x * 3 / width).min(2);
                    frame[(y * width + x) * 4 + channel] = 180;
                    frame[(y * width + x) * 4 + 3] = 255;
                }
            }
            for index in 0..6 {
                assert!(encoder.append_video(&frame, index).unwrap());
            }
            encoder.finish().unwrap();
            let source_bytes = std::fs::read(&source).unwrap();
            let color = source_bytes
                .windows(4)
                .position(|value| value == b"nclx" || value == b"nclc")
                .expect("recording must carry an explicit color description");
            assert_eq!(
                &source_bytes[color + 4..color + 10],
                &[0, 1, 0, 1, 0, 1],
                "recording must tag BT.709 primaries, transfer and YCbCr matrix"
            );
            let annotation = VideoAnnotation {
                start: 0.0,
                end: 0.2,
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
                kind: VideoAnnotationKind::Overlay,
                amount: 0.0,
                image_base64: annotation_png(image::RgbaImage::new(1, 1)),
            };
            let (output, _, _, _) = export_video_with_annotations(
                &source,
                &[VideoSegment {
                    start: 0.0,
                    end: 0.2,
                }],
                &[],
                &[annotation],
                VideoExportPreset::Original,
            )
            .unwrap();
            let source_png =
                crate::macos_media::video_first_frame_png(&source, width as u32).unwrap();
            let output_png =
                crate::macos_media::video_first_frame_png(&output, width as u32).unwrap();
            let before = image::load_from_memory(&source_png).unwrap().to_rgb8();
            let after = image::load_from_memory(&output_png).unwrap().to_rgb8();
            for part in 0..3 {
                let x = ((part * 2 + 1) * width / 6) as u32;
                let y = (height / 2) as u32;
                let expected = before.get_pixel(x, y);
                let actual = after.get_pixel(x, y);
                assert!(expected.0.iter().zip(actual.0).all(|(expected, actual)| expected.abs_diff(actual) <= 8), "{width}x{height} channel {part}: source={expected:?}, transparent export={actual:?}");
            }
            std::fs::remove_file(output).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    fn frame_at(source: &Path, time: f64) -> image::RgbImage {
        let (sample, _, _, _) = export_video(
            source,
            &[VideoSegment {
                start: time,
                end: time + 0.1,
            }],
            &[],
            VideoExportPreset::Original,
        )
        .unwrap();
        let bytes = crate::macos_media::video_first_frame_png(&sample, 64).unwrap();
        std::fs::remove_file(sample).unwrap();
        image::load_from_memory(&bytes).unwrap().to_rgb8()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_removes_middle_and_maps_timed_mask_and_zoom_to_kept_source() {
        use crate::macos_media::MacosSegmentEncoder;
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("colored.mp4");
        let mut encoder = MacosSegmentEncoder::new(&source, 64, 48, 30, 500_000, true).unwrap();
        for index in 0..90 {
            let mut frame = vec![0u8; 64 * 48 * 4];
            for y in 0..48 {
                for x in 0..64 {
                    let color = if index < 30 {
                        [0, 0, 255, 255]
                    } else if index < 60 {
                        [0, 255, 0, 255]
                    } else if x < 32 {
                        [255, 0, 0, 255]
                    } else {
                        [0, 0, 255, 255]
                    };
                    frame[(y * 64 + x) * 4..(y * 64 + x + 1) * 4].copy_from_slice(&color);
                }
            }
            assert!(encoder.append_video(&frame, index).unwrap());
        }
        encoder.append_audio(&vec![0; 3 * 48_000 * 4]).unwrap();
        encoder.finish().unwrap();
        let before = std::fs::read(&source).unwrap();
        let segments = [
            VideoSegment {
                start: 0.0,
                end: 1.0,
            },
            VideoSegment {
                start: 2.0,
                end: 3.0,
            },
        ];
        let effects = [
            VideoEffect {
                kind: VideoEffectKind::Zoom,
                start: 2.0,
                end: 2.5,
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 0.5,
            },
            VideoEffect {
                kind: VideoEffectKind::Mask,
                start: 2.0,
                end: 2.5,
                x: 0.0,
                y: 0.0,
                width: 0.25,
                height: 0.5,
            },
        ];
        let (output, width, height, duration) =
            export_video(&source, &segments, &effects, VideoExportPreset::Original).unwrap();
        assert_eq!((width, height), (64, 48));
        assert!((duration - 2.0).abs() < 0.05, "{duration}");
        let first = frame_at(&output, 0.2);
        assert!(first.get_pixel(16, 24)[0] > 180);
        let active = frame_at(&output, 1.2);
        assert!(
            active.get_pixel(16, 24).0.iter().all(|value| *value < 35),
            "mask must follow source coordinates through zoom: {:?}",
            active.get_pixel(16, 24)
        );
        assert!(
            active.get_pixel(48, 24)[2] > 180,
            "zoom should show blue left source half, not red right half: {:?}",
            active.get_pixel(48, 24)
        );
        let after = frame_at(&output, 1.7);
        assert!(after.get_pixel(16, 24)[2] > 180);
        assert!(after.get_pixel(48, 24)[0] > 180);
        assert_eq!(before, std::fs::read(&source).unwrap());
        assert_audio_track(&output);
        std::fs::remove_file(output).unwrap();
    }

    #[cfg(target_os = "macos")]
    fn assert_audio_track(output: &Path) {
        use std::ffi::{c_char, CString};
        unsafe extern "C" {
            fn kiri_macos_has_audio_track(
                path: *const c_char,
                has_audio: *mut bool,
                error: *mut c_char,
                capacity: usize,
            ) -> bool;
        }
        let cpath = CString::new(output.to_str().unwrap()).unwrap();
        let mut has_audio = false;
        let mut error = [0 as c_char; 1024];
        assert!(unsafe {
            kiri_macos_has_audio_track(
                cpath.as_ptr(),
                &mut has_audio,
                error.as_mut_ptr(),
                error.len(),
            )
        });
        assert!(has_audio);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_trim_preserves_source_and_audio_without_upscaling() {
        use crate::macos_media::MacosSegmentEncoder;
        use std::ffi::{c_char, CString};
        unsafe extern "C" {
            fn kiri_macos_has_audio_track(
                path: *const c_char,
                has_audio: *mut bool,
                error: *mut c_char,
                capacity: usize,
            ) -> bool;
        }
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.mp4");
        let mut encoder = MacosSegmentEncoder::new(&source, 64, 48, 30, 500_000, true).unwrap();
        let frame = vec![127; 64 * 48 * 4];
        for index in 0..30 {
            assert!(encoder.append_video(&frame, index).unwrap());
        }
        encoder.append_audio(&vec![0; 48_000 * 4]).unwrap();
        encoder.finish().unwrap();
        let before = std::fs::read(&source).unwrap();
        for preset in [
            VideoExportPreset::Original,
            VideoExportPreset::Share,
            VideoExportPreset::Small,
        ] {
            let (output, width, height, duration) = export_video(
                &source,
                &[VideoSegment {
                    start: 0.2,
                    end: 0.8,
                }],
                &[],
                preset,
            )
            .unwrap();
            assert_eq!((width, height), (64, 48));
            assert!((duration - 0.6).abs() < 0.05, "duration: {duration}");
            let cpath = CString::new(output.to_str().unwrap()).unwrap();
            let mut has_audio = false;
            let mut error = [0 as c_char; 1024];
            assert!(unsafe {
                kiri_macos_has_audio_track(
                    cpath.as_ptr(),
                    &mut has_audio,
                    error.as_mut_ptr(),
                    error.len(),
                )
            });
            assert!(has_audio);
            std::fs::remove_file(output).unwrap();
        }
        assert_eq!(before, std::fs::read(source).unwrap());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn native_effects_respect_rotated_track_display_coordinates() {
        use crate::macos_media::MacosSegmentEncoder;
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("rotated.mp4");
        let mut encoder = MacosSegmentEncoder::new(&source, 64, 48, 30, 500_000, false).unwrap();
        for index in 0..6 {
            assert!(encoder
                .append_video(&vec![127; 64 * 48 * 4], index)
                .unwrap());
        }
        encoder.finish().unwrap();
        // Set the standard ISO BMFF track-header display matrix on this isolated fixture.
        // AVAssetWriter emits version-zero tkhd: matrix starts 48 bytes into the atom.
        let mut bytes = std::fs::read(&source).unwrap();
        let header = bytes.windows(4).position(|value| value == b"tkhd").unwrap() - 4;
        assert_eq!(bytes[header + 8], 0);
        assert_eq!(
            u32::from_be_bytes(bytes[header + 84..header + 88].try_into().unwrap()),
            64 << 16
        );
        let matrix: [i32; 9] = [0, 65536, 0, -65536, 0, 0, 48 * 65536, 0, 1 << 30];
        for (index, value) in matrix.iter().enumerate() {
            bytes[header + 48 + index * 4..header + 52 + index * 4]
                .copy_from_slice(&value.to_be_bytes());
        }
        std::fs::write(&source, bytes).unwrap();
        let (output, width, height, _) = export_video(
            &source,
            &[VideoSegment {
                start: 0.0,
                end: 0.2,
            }],
            &[VideoEffect {
                kind: VideoEffectKind::Mask,
                start: 0.0,
                end: 0.2,
                x: 0.0,
                y: 0.0,
                width: 0.25,
                height: 0.25,
            }],
            VideoExportPreset::Original,
        )
        .unwrap();
        assert_eq!((width, height), (48, 64));
        let bytes = crate::macos_media::video_first_frame_png(&output, 64).unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert_eq!(image.dimensions(), (48, 64));
        assert!(image.get_pixel(4, 4).0.iter().all(|value| *value < 35));
        assert!(image.get_pixel(32, 48).0.iter().all(|value| *value > 60));
        std::fs::remove_file(output).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_presets_limit_the_long_edge() {
        use crate::macos_media::MacosSegmentEncoder;
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("wide.mp4");
        let mut encoder =
            MacosSegmentEncoder::new(&source, 1280, 720, 30, 2_000_000, false).unwrap();
        let frame = vec![127; 1280 * 720 * 4];
        for index in 0..6 {
            assert!(encoder.append_video(&frame, index).unwrap());
        }
        encoder.finish().unwrap();
        for (preset, expected) in [
            (VideoExportPreset::Original, (1280, 720)),
            (VideoExportPreset::Share, (1080, 606)),
            (VideoExportPreset::Small, (720, 404)),
        ] {
            let (output, width, height, duration) = export_video(
                &source,
                &[VideoSegment {
                    start: 0.0,
                    end: 0.2,
                }],
                &[],
                preset,
            )
            .unwrap();
            assert_eq!((width, height), expected);
            assert!((duration - 0.2).abs() < 0.05);
            std::fs::remove_file(output).unwrap();
        }
        // The Core Image effect path also resizes; test its coordinate system separately.
        let (output, width, height, _) = export_video(
            &source,
            &[VideoSegment {
                start: 0.0,
                end: 0.2,
            }],
            &[VideoEffect {
                kind: VideoEffectKind::Mask,
                start: 0.0,
                end: 0.2,
                x: 0.0,
                y: 0.0,
                width: 0.25,
                height: 0.5,
            }],
            VideoExportPreset::Small,
        )
        .unwrap();
        assert_eq!((width, height), (720, 404));
        let bytes = crate::macos_media::video_first_frame_png(&output, 64).unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert!(image.get_pixel(4, 4).0.iter().all(|value| *value < 35));
        assert!(image.get_pixel(48, 24).0.iter().all(|value| *value > 60));
        std::fs::remove_file(output).unwrap();
    }
}
