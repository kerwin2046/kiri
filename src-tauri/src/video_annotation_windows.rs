//! Bounded-memory, timestamp-preserving native annotation prepass.
use super::super::{PreparedVideoAnnotation, VideoAnnotationKind};
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
                boundaries.sort_unstable();
                boundaries.dedup();
                for interval in boundaries.windows(2) {
                    let mut frame = pending.1.clone();
                    paint(&mut frame, interval[0], annotations)?;
                    write_frame(
                        &writer,
                        stream,
                        &frame,
                        interval[0],
                        interval[1] - interval[0],
                    )?;
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
