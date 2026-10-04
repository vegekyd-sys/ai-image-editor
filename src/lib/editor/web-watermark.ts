let signature: HTMLCanvasElement | undefined;
const markedImages = new WeakMap<Blob, Blob>();
const markedVideos = new WeakMap<Blob, Blob>();

export function preloadWatermarkVideo() {
  void import('mediabunny').catch(() => { /* Save reports a loading failure if the user proceeds. */ });
}

function watermarkSignature() {
  if (signature) return signature;
  const source = document.createElement('canvas');
  source.width = 600;source.height = 144;
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.scale(2, 2);
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of [[35, 18, 35, 54], [17, 36, 53, 36], [22, 23, 48, 49], [22, 49, 48, 23]]) {
    ctx.moveTo(x1, y1);ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '600 37px Arial, sans-serif';
  ctx.fillText('makaron', 68, 48);

  // Anchor the actual ink, not the transparent padding around the wordmark.
  const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
  let left = source.width, top = source.height, right = 0, bottom = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    if (pixels[(y * source.width + x) * 4 + 3] > 4) {
      left = Math.min(left, x);top = Math.min(top, y);right = Math.max(right, x);bottom = Math.max(bottom, y);
    }
  }
  signature = document.createElement('canvas');
  signature.width = right - left + 1;signature.height = bottom - top + 1;
  const cropped = signature.getContext('2d');
  if (!cropped) {signature = undefined;throw new Error('Canvas unavailable');}
  cropped.drawImage(source, left, top, signature.width, signature.height, 0, 0, signature.width, signature.height);
  return signature;
}

export function watermarkGeometry(width: number, height: number) {
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const markWidth = Math.min(width * 0.28, height * 0.45, 360);
  const mark = watermarkSignature();
  const markHeight = markWidth * mark.height / mark.width;
  return { width: markWidth, height: markHeight, left: width - markWidth - margin, top: height - markHeight - margin };
}

// The same transparent signature is used in the save preview and in the downloaded file.
export function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const g = watermarkGeometry(width, height);
  ctx.save();
  ctx.drawImage(watermarkSignature(), g.left, g.top, g.width, g.height);
  ctx.restore();
}

export function watermarkDataUrl() {
  return watermarkSignature().toDataURL('image/png');
}

export async function watermarkImage(blob: Blob): Promise<Blob> {
  const cached = markedImages.get(blob);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height);
    const marked = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Image export failed')), 'image/png',
    ));
    markedImages.set(blob, marked);
    return marked;
  } finally { URL.revokeObjectURL(url); }
}

export async function watermarkVideo(blob: Blob, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const cached = markedVideos.get(blob);
  if (cached) {onProgress?.(1);return cached;}
  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, VideoSampleSink, EncodedPacketSink, EncodedAudioPacketSource } = await import('mediabunny');
  const { createWatermarkVideoSource } = await import('./watermark-video-source');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const controller = new AbortController();
  const cancel = () => {controller.abort(signal?.reason);};
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    // Preserve AAC priming packets by shifting every track from the earliest source timestamp.
    const start = Math.min(0, await input.getFirstTimestamp());
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('Video export unsupported');
    const videos = await input.getVideoTracks(), audios = await input.getAudioTracks();
    if (videos.length !== 1 || (await input.getTracks()).length !== videos.length + audios.length) throw new Error('Video export unsupported');
    const canvas = document.createElement('canvas');
    canvas.width = track.displayWidth;canvas.height = track.displayHeight;
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!ctx) throw new Error('Canvas unavailable');
    const video = createWatermarkVideoSource(canvas, controller.signal);
    output.addVideoTrack(video);
    const audio = [];
    for (const track of audios) {
      if (!track.codec || !output.format.getSupportedAudioCodecs().includes(track.codec)) throw new Error('Audio export unsupported');
      const decoderConfig = await track.getDecoderConfig();
      if (!decoderConfig) throw new Error('Audio export unsupported');
      const source = new EncodedAudioPacketSource(track.codec);
      output.addAudioTrack(source);
      audio.push({ track, source, decoderConfig });
    }
    const duration = await track.computeDuration();
    await output.start();
    onProgress?.(0);
    let lastUpdate = 0;
    for await (const sample of new VideoSampleSink(track).samples(start)) {
      try {
        controller.signal.throwIfAborted();
        sample.draw(ctx, 0, 0);
        drawWatermark(ctx, canvas.width, canvas.height);
        await video.add(Math.max(0, sample.timestamp - start), sample.duration);
        const now = performance.now();
        if (now - lastUpdate >= 100) {lastUpdate = now;onProgress?.(Math.min(0.95, (sample.timestamp + sample.duration) / duration * 0.95));}
      } finally {sample.close();}
    }
    video.close();
    for (const { track, source, decoderConfig } of audio) {
      for await (const packet of new EncodedPacketSink(track).packets()) {
        controller.signal.throwIfAborted();
        await source.add(packet.clone({ timestamp: packet.timestamp - start }), { decoderConfig });
      }
      source.close();
    }
    controller.signal.throwIfAborted();
    await output.finalize();
    if (!target.buffer) throw new Error('Video export failed');
    signal?.throwIfAborted();
    const marked = new Blob([target.buffer], { type: 'video/mp4' });
    markedVideos.set(blob, marked);
    onProgress?.(1);
    return marked;
  } finally {
    signal?.removeEventListener('abort', cancel);
    controller.abort();
    if (output.state !== 'finalized') await output.cancel();
    input.dispose();
  }
}
