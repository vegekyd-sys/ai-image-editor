import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ register: vi.fn(), packet: vi.fn(chunk => chunk) }));
vi.mock('mediabunny', () => ({
  CustomVideoEncoder: class {}, QUALITY_HIGH: 1,
  EncodedPacket: { fromEncodedChunk: mocks.packet }, registerEncoder: mocks.register,
  CanvasSource: class {
    constructor(public canvas: HTMLCanvasElement, public options: { onEncoderConfig: (config: VideoEncoderConfig) => void }) {}
  },
}));
import { createWatermarkVideoSource } from '@/lib/editor/watermark-video-source';

describe('bounded watermark WebCodecs encoder', () => {
  let callbacks: VideoEncoderInit;
  const native = { state: 'configured', configure: vi.fn(), encode: vi.fn(), flush: vi.fn(), close: vi.fn() };
  const config: VideoEncoderConfig = { codec: 'avc1.64001f', width: 768, height: 768, bitrate: 1818000 };
  type Coder = {
    config: VideoEncoderConfig; onPacket: ReturnType<typeof vi.fn>;
    init: () => void; encode: (sample: { toVideoFrame: () => { close: () => void } }, options: VideoEncoderEncodeOptions) => Promise<void>;
    flush: () => Promise<void>; close: () => void;
  };
  const Encoder = mocks.register.mock.calls[0][0] as { new(): Coder; supports: (codec: string, config: VideoEncoderConfig) => boolean };
  function create(controller = new AbortController()) {
    const source = createWatermarkVideoSource(document.createElement('canvas'), controller.signal);
    (source as unknown as { options: { onEncoderConfig: (config: VideoEncoderConfig) => void } }).options.onEncoderConfig(config);
    const coder = new Encoder();coder.config = config;coder.onPacket = vi.fn();coder.init();
    return { coder, controller };
  }
  beforeEach(() => {
    vi.clearAllMocks();native.state = 'configured';native.flush.mockResolvedValue(undefined);
    native.close.mockImplementation(() => {native.state = 'closed';});
    vi.stubGlobal('VideoEncoder', class {
      constructor(init: VideoEncoderInit) {callbacks = init;return native;}
    });
  });
  afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();});

  it('opts in only configs from watermark sources and keeps quality mode', () => {
    create();
    expect(Encoder.supports('avc', config)).toBe(true);
    expect(Encoder.supports('avc', { ...config })).toBe(false);
    expect(Encoder.supports('hevc', config)).toBe(false);
    expect(native.configure).toHaveBeenCalledWith({ ...config, latencyMode: 'quality' });
  });

  it('flushes every three frames before the four-frame backpressure and releases all frames', async () => {
    const { coder } = create();const close = vi.fn();
    for (let i = 0; i < 7; i++) await coder.encode({ toVideoFrame: () => ({ close }) }, { keyFrame: i === 0 });
    expect(native.encode).toHaveBeenCalledTimes(7);expect(close).toHaveBeenCalledTimes(7);
    expect(native.flush).toHaveBeenCalledTimes(2);
    await coder.flush();expect(native.flush).toHaveBeenCalledTimes(3);coder.close();
  });

  it('preserves the output packet metadata', () => {
    const { coder } = create();
    const chunk = {} as EncodedVideoChunk, meta = { decoderConfig: config };
    callbacks.output(chunk, meta);expect(coder.onPacket).toHaveBeenCalledWith(chunk, meta);coder.close();
  });

  it('closes the encoder and rejects pending flush on cancellation', async () => {
    let reject!: (reason: Error) => void;
    native.flush.mockImplementation(() => new Promise((_, fail) => {reject = fail;}));
    const { coder, controller } = create();const pending = coder.flush();
    native.close.mockImplementation(() => {native.state = 'closed';reject(new DOMException('Closed', 'AbortError'));});
    const assertion = expect(pending).rejects.toThrow('Closed');controller.abort();await assertion;
    expect(native.close).toHaveBeenCalledOnce();
    await expect(coder.encode({ toVideoFrame: vi.fn() }, {})).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a stalled flush instead of waiting forever', async () => {
    vi.useFakeTimers();native.flush.mockImplementation(() => new Promise(() => {}));
    const { coder } = create();const pending = coder.flush();
    const assertion = expect(pending).rejects.toThrow('Video encoder stalled');
    await vi.advanceTimersByTimeAsync(15_000);await assertion;expect(native.close).toHaveBeenCalledOnce();
  });

  it('propagates asynchronous encoder errors and closes frames when encode throws', async () => {
    const { coder } = create();callbacks.error(new DOMException('Unsupported codec'));
    await expect(coder.flush()).rejects.toThrow('Unsupported codec');coder.close();
    const next = create().coder, close = vi.fn();native.encode.mockImplementationOnce(() => {throw new Error('Encode failed');});
    await expect(next.encode({ toVideoFrame: () => ({ close }) }, {})).rejects.toThrow('Encode failed');
    expect(close).toHaveBeenCalledOnce();next.close();
  });
});
