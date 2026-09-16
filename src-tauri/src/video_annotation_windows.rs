//! Bounded-memory, timestamp-preserving native annotation prepass.
use super::super::{
    PreparedVideoAnnotation, VideoAnnotationKind, VideoEffect, VideoEffectKind, VideoMaskStyle,
};
use anyhow::{bail, Context, Result};
use image::{imageops, RgbaImage};
use std::path::Path;
use windows::{
    core::HSTRING, Media::MediaProperties::MediaEncodingProfile, Win32::Media::MediaFoundation::*,
};

pub(super) fn render(
    source: &Path,
    destination: &Path,
    duration: i64,
    annotations: &[PreparedVideoAnnotation],
    effects: &[VideoEffect],
    profile: &MediaEncodingProfile,
) -> Result<()> {
    // Reader owns the Media Foundation startup guard until writer resources drop.
    let reader = crate::gif::WindowsVideoReader::open(source)?;
    let (width, height) = reader.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 33_554_432 {
        bail!("Video annotation export supports frames up to 32 megapixels");
    }
    let video = profile.Video()?;
    if (width, height) != (video.Width()?, video.Height()?) {
        bail!("Decoded video dimensions do not match the annotation canvas");
    }
    let numerator = video.FrameRate()?.Numerator()?.max(1);
    let denominator = video.FrameRate()?.Denominator()?.max(1);
    let writer =
        unsafe { MFCreateSinkWriterFromURL(&HSTRING::from(destination.as_os_str()), None, None) }?;
    let output_type = unsafe { MFCreateMediaType() }?;
    let input_type = unsafe { MFCreateMediaType() }?;
    unsafe {
        for media_type in [&output_type, &input_type] {
            media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media_type.SetUINT64(
                &MF_MT_FRAME_SIZE,
                (u64::from(width) << 32) | u64::from(height),
            )?;
            media_type.SetUINT64(
                &MF_MT_FRAME_RATE,
                (u64::from(numerator) << 32) | u64::from(denominator),
            )?;
            media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1_u64 << 32) | 1)?;
            media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        }
        output_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        output_type.SetUINT32(&MF_MT_AVG_BITRATE, video.Bitrate()?.max(2_000_000))?;
        input_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        let stream = writer.AddStream(&output_type)?;
        writer.SetInputMediaType(stream, &input_type, None)?;
        writer.BeginWriting()?;
        let mut pending = reader
            .read_frame()?
            .context("Video has no decodable frames")?;
        let mut first = true;
        loop {
            let following = reader.read_frame()?;
            let start = if first { 0 } else { pending.0.max(0) };
            first = false;
            let end = following
                .as_ref()
                .map(|frame| frame.0)
                .unwrap_or(duration)
                .min(duration);
            if end > start {
                // Include annotation boundaries inside long VFR frames so a timed mask
                // starts exactly when requested rather than waiting for the next frame.
                let mut boundaries = vec![start, end];
                for annotation in annotations {
                    for time in [super::ticks(annotation.start), super::ticks(annotation.end)] {
                        if time > start && time < end {
                            boundaries.push(time);
                        }
                    }
                }
                for effect in effects {
                    let ramp = effect.transition.min((effect.end - effect.start) / 2.0);
                    for boundary in [
                        effect.start,
                        effect.start + ramp,
                        effect.end - ramp,
                        effect.end,
                    ] {
                        let time = super::ticks(boundary);
                        if time > start && time < end {
                            boundaries.push(time);
                        }
                    }
                }
                boundaries.sort_unstable();
                boundaries.dedup();
                for interval in boundaries.windows(2) {
                    let mut timestamp = interval[0];
                    while timestamp < interval[1] {
                        // Long VFR frames need intermediate camera positions during
                        // ramps. Stream these samples instead of allocating a timeline.
                        let next = if zoom_is_animating(effects, timestamp) {
                            let cadence = (10_000_000_i64 * i64::from(denominator)
                                / i64::from(numerator))
                            .max(83_333);
                            (timestamp + cadence).min(interval[1])
                        } else {
                            interval[1]
                        };
                        let mut frame = pending.1.clone();
                        paint(&mut frame, timestamp, annotations)?;
                        paint_effects(&mut frame, timestamp, effects)?;
                        write_frame(&writer, stream, &frame, timestamp, next - timestamp)?;
                        timestamp = next;
                    }
                }
            }
            let Some(next) = following else {
                break;
            };
            if next.0 >= duration {
                break;
            }
            if next.0 < pending.0 {
                bail!("Video decoder returned non-monotonic frame timestamps");
            }
            pending = next;
        }
        writer
            .Finalize()
            .context("Could not finalize annotated Windows video")?;
    }
    Ok(())
}

fn write_frame(
    writer: &IMFSinkWriter,
    stream: u32,
    frame: &RgbaImage,
    timestamp: i64,
    duration: i64,
) -> Result<()> {
    let length = u32::try_from(frame.as_raw().len()).context("Video frame is too large")?;
    let buffer = unsafe { MFCreateMemoryBuffer(length) }?;
    let mut pointer = std::ptr::null_mut();
    unsafe {
        buffer.Lock(&mut pointer, None, None)?;
    }
    // RGB32 sink input is bottom-up BGRA, matching Kiri's capture encoder.
    let target = unsafe { std::slice::from_raw_parts_mut(pointer, length as usize) };
    let stride = frame.width() as usize * 4;
    for (y, row) in frame.as_raw().chunks_exact(stride).enumerate() {
        let offset = (frame.height() as usize - y - 1) * stride;
        for (rgba, bgra) in row
            .chunks_exact(4)
            .zip(target[offset..offset + stride].chunks_exact_mut(4))
        {
            bgra.copy_from_slice(&[rgba[2], rgba[1], rgba[0], 255]);
        }
    }
    unsafe {
        buffer.Unlock()?;
        buffer.SetCurrentLength(length)?;
        let sample = MFCreateSample()?;
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(timestamp)?;
        sample.SetSampleDuration(duration)?;
        writer.WriteSample(stream, &sample)?;
    }
    Ok(())
}

fn paint(frame: &mut RgbaImage, time: i64, annotations: &[PreparedVideoAnnotation]) -> Result<()> {
    for annotation in annotations
        .iter()
        .filter(|a| a.kind != VideoAnnotationKind::Overlay)
        .chain(
            annotations
                .iter()
                .filter(|a| a.kind == VideoAnnotationKind::Overlay),
        )
    {
        if time < super::ticks(annotation.start) || time >= super::ticks(annotation.end) {
            continue;
        }
        let left = (annotation.x * frame.width() as f64).floor() as u32;
        let top = (annotation.y * frame.height() as f64).floor() as u32;
        let right = (((annotation.x + annotation.width) * frame.width() as f64).ceil() as u32)
            .min(frame.width());
        let bottom = (((annotation.y + annotation.height) * frame.height() as f64).ceil() as u32)
            .min(frame.height());
        if right <= left || bottom <= top {
            continue;
        }
        let (width, height) = (right - left, bottom - top);
        let mask = imageops::resize(
            &annotation.image,
            width,
            height,
            imageops::FilterType::Triangle,
        );
        if annotation.kind == VideoAnnotationKind::Overlay {
            imageops::overlay(frame, &mask, i64::from(left), i64::from(top));
            continue;
        }
        let strength = (annotation.amount * frame.width() as f64).max(1.0) as f32;
        let region = imageops::crop_imm(frame, left, top, width, height).to_image();
        let filtered = if annotation.kind == VideoAnnotationKind::Pixelate {
            let block = strength.ceil() as u32;
            let tiny = imageops::resize(
                &region,
                width.div_ceil(block).max(1),
                height.div_ceil(block).max(1),
                imageops::FilterType::Triangle,
            );
            imageops::resize(&tiny, width, height, imageops::FilterType::Nearest)
        } else {
            // Downsample large blurs to keep CPU work bounded while preserving radius.
            let scale = (strength / 16.0).max(1.0);
            let small = imageops::resize(
                &region,
                ((width as f32 / scale).ceil() as u32).max(1),
                ((height as f32 / scale).ceil() as u32).max(1),
                imageops::FilterType::Triangle,
            );
            let blurred = imageops::blur(&small, strength / scale);
            imageops::resize(&blurred, width, height, imageops::FilterType::Triangle)
        };
        for y in 0..height {
            for x in 0..width {
                let alpha = u32::from(mask.get_pixel(x, y)[3]);
                if alpha == 0 {
                    continue;
                }
                let source = filtered.get_pixel(x, y);
                let destination = frame.get_pixel_mut(left + x, top + y);
                for channel in 0..3 {
                    destination[channel] = ((u32::from(source[channel]) * alpha
                        + u32::from(destination[channel]) * (255 - alpha)
                        + 127)
                        / 255) as u8;
                }
            }
        }
    }
    Ok(())
}

fn zoom_is_animating(effects: &[VideoEffect], timestamp: i64) -> bool {
    let time = timestamp as f64 / 10_000_000.0;
    effects.iter().any(|effect| {
        if effect.kind != VideoEffectKind::Zoom || effect.transition <= 0.0 {
            return false;
        }
        let ramp = effect.transition.min((effect.end - effect.start) / 2.0);
        timestamp >= super::ticks(effect.start)
            && timestamp < super::ticks(effect.end)
            && (time < effect.start + ramp || time >= effect.end - ramp)
    })
}

fn zoom_viewport(effect: &VideoEffect, time: f64) -> (f64, f64, f64, f64) {
    let ramp = effect.transition.min((effect.end - effect.start) / 2.0);
    let progress = if ramp > 0.0 {
        ((time - effect.start) / ramp)
            .clamp(0.0, 1.0)
            .min(((effect.end - time) / ramp).clamp(0.0, 1.0))
    } else {
        1.0
    };
    let eased = progress * progress * (3.0 - 2.0 * progress);
    (
        effect.x * eased,
        effect.y * eased,
        1.0 + (effect.width - 1.0) * eased,
        1.0 + (effect.height - 1.0) * eased,
    )
}

fn paint_effects(frame: &mut RgbaImage, timestamp: i64, effects: &[VideoEffect]) -> Result<()> {
    let time = timestamp as f64 / 10_000_000.0;
    for effect in effects.iter().filter(|effect| {
        effect.kind == VideoEffectKind::Mask
            && timestamp >= super::ticks(effect.start)
            && timestamp < super::ticks(effect.end)
    }) {
        let left = (effect.x * frame.width() as f64).floor() as u32;
        let top = (effect.y * frame.height() as f64).floor() as u32;
        let right =
            (((effect.x + effect.width) * frame.width() as f64).ceil() as u32).min(frame.width());
        let bottom = (((effect.y + effect.height) * frame.height() as f64).ceil() as u32)
            .min(frame.height());
        if right <= left || bottom <= top {
            continue;
        }
        let (width, height) = (right - left, bottom - top);
        let region = imageops::crop_imm(frame, left, top, width, height).to_image();
        let filtered = match effect.mask_style {
            VideoMaskStyle::Solid => RgbaImage::from_pixel(
                width,
                height,
                image::Rgba([
                    (effect.color >> 16) as u8,
                    (effect.color >> 8) as u8,
                    effect.color as u8,
                    255,
                ]),
            ),
            VideoMaskStyle::Pixelate => {
                let block = (frame.width() as f64 * (0.005 + 0.045 * effect.strength))
                    .max(2.0)
                    .ceil() as u32;
                let small = imageops::resize(
                    &region,
                    width.div_ceil(block).max(1),
                    height.div_ceil(block).max(1),
                    imageops::FilterType::Triangle,
                );
                imageops::resize(&small, width, height, imageops::FilterType::Nearest)
            }
            VideoMaskStyle::Blur => {
                let radius =
                    (frame.width() as f64 * (0.003 + 0.027 * effect.strength)).max(1.0) as f32;
                let scale = (radius / 16.0).max(1.0);
                let small = imageops::resize(
                    &region,
                    ((width as f32 / scale).ceil() as u32).max(1),
                    ((height as f32 / scale).ceil() as u32).max(1),
                    imageops::FilterType::Triangle,
                );
                let blurred = imageops::blur(&small, radius / scale);
                imageops::resize(&blurred, width, height, imageops::FilterType::Triangle)
            }
        };
        imageops::replace(frame, &filtered, i64::from(left), i64::from(top));
    }
    if let Some(effect) = effects.iter().find(|effect| {
        effect.kind == VideoEffectKind::Zoom
            && timestamp >= super::ticks(effect.start)
            && timestamp < super::ticks(effect.end)
    }) {
        let (left, top, width, height) = zoom_viewport(effect, time);
        if width < 1.0 || height < 1.0 {
            // Fractional sampling avoids one-pixel jumps while the camera eases.
            let zoomed = RgbaImage::from_fn(frame.width(), frame.height(), |x, y| {
                let u =
                    (left + (x as f64 + 0.5) / frame.width() as f64 * width).clamp(0.0, 1.0) as f32;
                let v = (top + (y as f64 + 0.5) / frame.height() as f64 * height).clamp(0.0, 1.0)
                    as f32;
                imageops::sample_bilinear(frame, u, v)
                    .expect("validated nonempty video frame and viewport")
            });
            *frame = zoomed;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_enters_holds_and_returns_to_full_frame_symmetrically() {
        let effect = VideoEffect {
            kind: VideoEffectKind::Zoom,
            start: 1.0,
            end: 4.0,
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
            transition: 1.0,
            ..Default::default()
        };
        assert_eq!(zoom_viewport(&effect, 1.0), (0.0, 0.0, 1.0, 1.0));
        assert_eq!(zoom_viewport(&effect, 1.5), (0.125, 0.125, 0.75, 0.75));
        assert_eq!(zoom_viewport(&effect, 2.5), (0.25, 0.25, 0.5, 0.5));
        assert_eq!(zoom_viewport(&effect, 3.5), zoom_viewport(&effect, 1.5));
        assert_eq!(zoom_viewport(&effect, 4.0), (0.0, 0.0, 1.0, 1.0));
    }
}
