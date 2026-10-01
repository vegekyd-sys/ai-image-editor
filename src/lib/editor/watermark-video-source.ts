import { CanvasSource, CustomVideoEncoder, EncodedPacket, QUALITY_HIGH, registerEncoder, type VideoCodec, type VideoSample } from 'mediabunny';

const ownedConfigs = new WeakMap<VideoEncoderConfig, AbortSignal>();

// Opt in only watermark exports, not other Mediabunny/Remotion encoders.
class WatermarkVideoEncoder extends CustomVideoEncoder {
  private encoder?: VideoEncoder;
  private error?: Error;
  private frames = 0;
  private signal?: AbortSignal;
  private abort = () => this.close();

  static supports(codec: VideoCodec, config: VideoEncoderConfig) {
    return codec === 'avc' && ownedConfigs.has(config);
  }

  init() {
    this.signal = ownedConfigs.get(this.config);
    this.signal?.throwIfAborted();
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => this.onPacket(EncodedPacket.fromEncodedChunk(chunk), metadata),
      error: error => {this.error = error;},
    });
    this.encoder.configure({ ...this.config, latencyMode: 'quality' });
    this.signal?.addEventListener('abort', this.abort, { once: true });
  }

  async encode(sample: VideoSample, options: VideoEncoderEncodeOptions) {
    this.signal?.throwIfAborted();
    if (this.error) throw this.error;
    const frame = sample.toVideoFrame();
    try {this.encoder!.encode(frame, options);} finally {frame.close();}
    // Some WebKit encoders retain four queued frames until flush. Drain a bounded
    // batch before Mediabunny's four-frame backpressure can wait indefinitely.
    if (++this.frames % 3 === 0) await this.flush();
  }

  async flush() {
    this.signal?.throwIfAborted();
    if (this.error) throw this.error;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.encoder!.flush(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {this.close();reject(new Error('Video encoder stalled'));}, 15_000);
        }),
      ]);
      this.signal?.throwIfAborted();
      if (this.error) throw this.error;
    } finally {clearTimeout(timeout);}
  }

  close() {
    this.signal?.removeEventListener('abort', this.abort);
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
  }
}

registerEncoder(WatermarkVideoEncoder);

export function createWatermarkVideoSource(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return new CanvasSource(canvas, {
    codec: 'avc', bitrate: QUALITY_HIGH, hardwareAcceleration: 'no-preference',
    onEncoderConfig: config => {ownedConfigs.set(config, signal);},
  });
}
