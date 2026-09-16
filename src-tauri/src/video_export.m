#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <CoreImage/CoreImage.h>
#import <math.h>

typedef struct { double start; double end; } KiriVideoSegment;
typedef struct { unsigned kind; double start, end, x, y, width, height; } KiriVideoEffect;
typedef struct {
    unsigned kind;
    double start, end, x, y, width, height, amount;
    const unsigned char *pixels;
    unsigned pixelWidth, pixelHeight;
} KiriVideoAnnotation;

static CIImage *KiriPlacedAnnotation(CIImage *image, KiriVideoAnnotation annotation, CGRect extent) {
    CGRect rect = CGRectMake(extent.origin.x + annotation.x * extent.size.width,
        extent.origin.y + (1 - annotation.y - annotation.height) * extent.size.height,
        annotation.width * extent.size.width, annotation.height * extent.size.height);
    image = [image imageByApplyingTransform:CGAffineTransformMakeScale(rect.size.width / annotation.pixelWidth, rect.size.height / annotation.pixelHeight)];
    return [image imageByApplyingTransform:CGAffineTransformMakeTranslation(rect.origin.x, rect.origin.y)];
}

// Called only on a background worker; the source is immutable and output is staging.
bool kiri_export_video(const char *source, const char *output, const KiriVideoSegment *segments,
                       size_t count, const KiriVideoEffect *effects, size_t effectCount, const KiriVideoAnnotation *annotations, size_t annotationCount, unsigned maxEdge, char *error, size_t capacity) {
    @autoreleasepool {
        @try {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:
                [[NSFileManager defaultManager] stringWithFileSystemRepresentation:source length:strlen(source)]] options:nil];
            double duration = CMTimeGetSeconds(asset.duration);
            AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
            if (!track || !isfinite(duration) || duration <= 0 || !segments || count == 0 || count > 128) {
                snprintf(error, capacity, "Invalid video or segments."); return false;
            }
            AVMutableComposition *edited = [AVMutableComposition composition];
            AVMutableCompositionTrack *video = [edited addMutableTrackWithMediaType:AVMediaTypeVideo preferredTrackID:kCMPersistentTrackID_Invalid];
            video.preferredTransform = track.preferredTransform;
            NSArray<AVAssetTrack *> *audioTracks = [asset tracksWithMediaType:AVMediaTypeAudio];
            NSMutableArray<AVMutableCompositionTrack *> *audioOutputs = [NSMutableArray array];
            for (AVAssetTrack *audio in audioTracks) {
                (void)audio;
                [audioOutputs addObject:[edited addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid]];
            }
            CMTime cursor = kCMTimeZero;
            double previousEnd = 0;
            for (size_t index = 0; index < count; index++) {
                double start = segments[index].start, end = segments[index].end;
                if (!isfinite(start) || !isfinite(end) || start < previousEnd || end <= start || start >= duration || end > duration + 0.05) {
                    snprintf(error, capacity, "Invalid or overlapping video segments."); return false;
                }
                end = MIN(end, duration);
                previousEnd = end;
                CMTimeRange range = CMTimeRangeFromTimeToTime(CMTimeMakeWithSeconds(start, 600000), CMTimeMakeWithSeconds(end, 600000));
                NSError *insertError = nil;
                if (![video insertTimeRange:range ofTrack:track atTime:cursor error:&insertError]) {
                    snprintf(error, capacity, "%s", (insertError.localizedDescription ?: @"Could not insert video segment.").UTF8String); return false;
                }
                for (NSUInteger audioIndex = 0; audioIndex < audioTracks.count; audioIndex++) {
                    AVAssetTrack *audio = audioTracks[audioIndex];
                    // Audio may begin later or end sooner than video. Preserve that offset.
                    CMTimeRange intersection = CMTimeRangeGetIntersection(range, audio.timeRange);
                    if (CMTIMERANGE_IS_VALID(intersection) && CMTimeCompare(intersection.duration, kCMTimeZero) > 0) {
                        CMTime position = CMTimeAdd(cursor, CMTimeSubtract(intersection.start, range.start));
                        if (![audioOutputs[audioIndex] insertTimeRange:intersection ofTrack:audio atTime:position error:&insertError]) {
                            snprintf(error, capacity, "%s", (insertError.localizedDescription ?: @"Could not insert audio segment.").UTF8String); return false;
                        }
                    }
                }
                cursor = CMTimeAdd(cursor, range.duration);
            }
            AVAssetExportSession *session = [[AVAssetExportSession alloc]
                initWithAsset:edited presetName:AVAssetExportPresetHighestQuality];
            if (!session) { snprintf(error, capacity, "Could not create the MP4 exporter."); return false; }
            CGRect bounds = CGRectApplyAffineTransform((CGRect){CGPointZero, track.naturalSize}, track.preferredTransform);
            double width = fabs(bounds.size.width), height = fabs(bounds.size.height);
            if (width < 2 || height < 2) { snprintf(error, capacity, "Invalid video dimensions."); return false; }
            double scale = maxEdge && MAX(width, height) > maxEdge ? maxEdge / MAX(width, height) : 1.0;
            CGSize target = scale < 1 ? CGSizeMake(MAX(2, floor(width * scale / 2) * 2), MAX(2, floor(height * scale / 2) * 2)) : CGSizeMake(width, height);
            // Both custom filters and ordinary resizing keep the source cadence.
            CMTime frameDuration = track.minFrameDuration;
            double frameSeconds = CMTimeGetSeconds(frameDuration);
            if (!CMTIME_IS_NUMERIC(frameDuration) || !isfinite(frameSeconds) || frameSeconds <= 0) {
                float fps = track.nominalFrameRate;
                frameDuration = CMTimeMakeWithSeconds(1.0 / (isfinite(fps) && fps > 0 ? fps : 30), 600000);
            }
            NSMutableArray<CIImage *> *annotationImages = [NSMutableArray arrayWithCapacity:annotationCount];
            for (size_t index = 0; index < annotationCount; index++) {
                KiriVideoAnnotation annotation = annotations[index];
                NSData *data = [NSData dataWithBytes:annotation.pixels length:(size_t)annotation.pixelWidth * annotation.pixelHeight * 4];
                CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
                CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
                CGImageRef cgImage = CGImageCreate(annotation.pixelWidth, annotation.pixelHeight, 8, 32,
                    annotation.pixelWidth * 4, colorSpace, kCGImageAlphaLast | kCGBitmapByteOrderDefault,
                    provider, NULL, false, kCGRenderingIntentDefault);
                CIImage *image = cgImage ? [CIImage imageWithCGImage:cgImage] : nil;
                if (cgImage) CGImageRelease(cgImage);
                CGColorSpaceRelease(colorSpace);
                CGDataProviderRelease(provider);
                if (!image) { snprintf(error, capacity, "Could not prepare video annotation image."); return false; }
                [annotationImages addObject:image];
            }
            if (effectCount > 0 || annotationCount > 0) {
                AVVideoComposition *filtered = [AVVideoComposition videoCompositionWithAsset:edited applyingCIFiltersWithHandler:^(AVAsynchronousCIImageFilteringRequest *request) {
                    double outputTime = CMTimeGetSeconds(request.compositionTime);
                    double sourceTime = segments[count - 1].end;
                    double offset = 0;
                    for (size_t index = 0; index < count; index++) {
                        double length = segments[index].end - segments[index].start;
                        if (outputTime < offset + length) { sourceTime = segments[index].start + outputTime - offset; break; }
                        offset += length;
                    }
                    CIImage *image = request.sourceImage;
                    CGRect extent = image.extent;
                    // CI coordinates are bottom-left; UI rectangles are normalized top-left.
                    for (size_t index = 0; index < annotationCount; index++) {
                        KiriVideoAnnotation annotation = annotations[index];
                        if (annotation.kind == 0 || sourceTime < annotation.start || sourceTime >= annotation.end) continue;
                        CIImage *mask = KiriPlacedAnnotation(annotationImages[index], annotation, extent);
                        CIImage *transparent = [[CIImage imageWithColor:[CIColor colorWithRed:0 green:0 blue:0 alpha:0]] imageByCroppingToRect:extent];
                        mask = [mask imageByCompositingOverImage:transparent];
                        double amount = MAX(1, annotation.amount * extent.size.width);
                        NSString *filter = annotation.kind == 1 ? @"CIPixellate" : @"CIGaussianBlur";
                        NSString *parameter = annotation.kind == 1 ? kCIInputScaleKey : kCIInputRadiusKey;
                        CIImage *processed = [[[image imageByClampingToExtent] imageByApplyingFilter:filter
                            withInputParameters:@{parameter: @(amount)}] imageByCroppingToRect:extent];
                        image = [processed imageByApplyingFilter:@"CIBlendWithAlphaMask" withInputParameters:@{
                            kCIInputBackgroundImageKey: image, kCIInputMaskImageKey: mask}];
                    }
                    for (size_t index = 0; index < annotationCount; index++) {
                        KiriVideoAnnotation annotation = annotations[index];
                        if (annotation.kind != 0 || sourceTime < annotation.start || sourceTime >= annotation.end) continue;
                        CIImage *overlay = KiriPlacedAnnotation(annotationImages[index], annotation, extent);
                        image = [overlay imageByCompositingOverImage:image];
                    }
                    for (size_t index = 0; index < effectCount; index++) {
                        KiriVideoEffect effect = effects[index];
                        if (effect.kind != 1 || sourceTime < effect.start || sourceTime >= effect.end) continue;
                        CGRect mask = CGRectMake(extent.origin.x + effect.x * extent.size.width,
                            extent.origin.y + (1 - effect.y - effect.height) * extent.size.height,
                            effect.width * extent.size.width, effect.height * extent.size.height);
                        CIImage *cover = [[CIImage imageWithColor:[CIColor colorWithRed:0 green:0 blue:0 alpha:1]] imageByCroppingToRect:CGRectIntegral(mask)];
                        image = [cover imageByCompositingOverImage:image];
                    }
                    for (size_t index = 0; index < effectCount; index++) {
                        KiriVideoEffect effect = effects[index];
                        if (effect.kind != 0 || sourceTime < effect.start || sourceTime >= effect.end) continue;
                        CGRect crop = CGRectMake(extent.origin.x + effect.x * extent.size.width,
                            extent.origin.y + (1 - effect.y - effect.height) * extent.size.height,
                            effect.width * extent.size.width, effect.height * extent.size.height);
                        image = [image imageByCroppingToRect:crop];
                        image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation(-crop.origin.x, -crop.origin.y)];
                        image = [image imageByApplyingTransform:CGAffineTransformMakeScale(extent.size.width / crop.size.width, extent.size.height / crop.size.height)];
                        image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation(extent.origin.x, extent.origin.y)];
                    }
                    image = [image imageByCroppingToRect:extent];
                    if (target.width != extent.size.width || target.height != extent.size.height) {
                        image = [image imageByApplyingTransform:CGAffineTransformMakeScale(target.width / extent.size.width, target.height / extent.size.height)];
                    }
                    [request finishWithImage:image context:nil];
                }];
                AVMutableVideoComposition *composition = [filtered mutableCopy];
                composition.frameDuration = frameDuration;
                composition.renderSize = target;
                session.videoComposition = composition;
            } else if (scale < 1) {
                AVMutableVideoComposition *composition = [AVMutableVideoComposition videoComposition];
                composition.renderSize = target;
                composition.frameDuration = frameDuration;
                AVMutableVideoCompositionInstruction *instruction = [AVMutableVideoCompositionInstruction videoCompositionInstruction];
                instruction.timeRange = CMTimeRangeMake(kCMTimeZero, cursor);
                AVMutableVideoCompositionLayerInstruction *layer = [AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:video];
                CGAffineTransform transform = CGAffineTransformConcat(track.preferredTransform,
                    CGAffineTransformMakeTranslation(-bounds.origin.x, -bounds.origin.y));
                transform = CGAffineTransformConcat(transform, CGAffineTransformMakeScale(target.width / width, target.height / height));
                [layer setTransform:transform atTime:kCMTimeZero];
                instruction.layerInstructions = @[layer];
                composition.instructions = @[instruction];
                session.videoComposition = composition;
            }
            session.timeRange = CMTimeRangeMake(kCMTimeZero, cursor);
            session.outputURL = [NSURL fileURLWithPath:[[NSFileManager defaultManager]
                stringWithFileSystemRepresentation:output length:strlen(output)]];
            session.outputFileType = AVFileTypeMPEG4;
            session.shouldOptimizeForNetworkUse = YES;
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            [session exportAsynchronouslyWithCompletionHandler:^{ dispatch_semaphore_signal(done); }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 3600LL * NSEC_PER_SEC))) {
                [session cancelExport];
                // Wait for cancellation to release its output before Rust removes staging.
                dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
                snprintf(error, capacity, "MP4 export timed out."); return false;
            }
            if (session.status != AVAssetExportSessionStatusCompleted) {
                snprintf(error, capacity, "%s", (session.error.localizedDescription ?: @"MP4 export failed.").UTF8String);
                return false;
            }
#pragma clang diagnostic pop
            return true;
        } @catch (NSException *exception) {
            snprintf(error, capacity, "%s", (exception.reason ?: @"MP4 export failed.").UTF8String);
            return false;
        }
    }
}
