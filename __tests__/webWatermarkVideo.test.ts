import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decode: vi.fn(), sampleDraw: vi.fn(), sampleClose: vi.fn(), videoAdd: vi.fn(), videoClose: vi.fn(), audioAdd: vi.fn(), audioClose: vi.fn(),
  dispose: vi.fn(), cancel: vi.fn(), finalize: vi.fn(), create: vi.fn(), clone: vi.fn(), audioCodec: 'aac', tracks: 2,
}));
vi.mock('@/lib/editor/watermark-video-source', () => ({ createWatermarkVideoSource: mocks.create }));
vi.mock('mediabunny', () => {
  const video = { displayWidth: 768, displayHeight: 768, canDecode: mocks.decode, computeDuration: async () => 1 };
  const audio = { get codec() {return mocks.audioCodec;}, getDecoderConfig: async () => ({ codec: 'mp4a.40.2', sampleRate: 32000, numberOfChannels: 2 }) };
  return {
    ALL_FORMATS: [], BlobSource: class {}, BufferTarget: class {buffer: ArrayBuffer | null = null;},
    Input: class {
      getFirstTimestamp = async () => -0.032;getPrimaryVideoTrack = async () => video;
      getVideoTracks = async () => [video];getAudioTracks = async () => [audio];getTracks = async () => Array(mocks.tracks);
      dispose = mocks.dispose;
    },
    Mp4OutputFormat: class {getSupportedAudioCodecs = () => ['aac'];},
    Output: class {
      state = 'pending';format;target;
      constructor(options: { format: unknown; target: { buffer: ArrayBuffer | null } }) {this.format = options.format;this.target = options.target;}
      addVideoTrack() {} addAudioTrack() {} start = async () => {this.state = 'started';};
      finalize = async () => {await mocks.finalize();this.state = 'finalized';this.target.buffer = new ArrayBuffer(10);};
      cancel = async () => {this.state = 'canceled';await mocks.cancel();};
    },
    VideoSampleSink: class {
      async *samples() {yield { timestamp: 0, duration: 1 / 24, draw: mocks.sampleDraw, close: mocks.sampleClose };}
    },
    EncodedPacketSink: class {async *packets() {yield { timestamp: -0.032, clone: mocks.clone };}},
    EncodedAudioPacketSource: class {add = mocks.audioAdd;close = mocks.audioClose;},
  };
});
import { watermarkVideo } from '@/lib/editor/web-watermark';

describe('web watermark video pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();mocks.audioCodec = 'aac';mocks.tracks = 2;mocks.decode.mockResolvedValue(true);
    mocks.create.mockReturnValue({ add: mocks.videoAdd, close: mocks.videoClose });
    mocks.videoAdd.mockResolvedValue(undefined);mocks.finalize.mockResolvedValue(undefined);
    mocks.clone.mockImplementation(options => ({ bytes: 'original-aac', ...options }));
    const ctx = { scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(600 * 144 * 4).fill(255) }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });
  afterEach(() => {vi.restoreAllMocks();});

  it('burns in frames, copies AAC priming packets and only reports completion after finalization', async () => {
    const progress = vi.fn(), original = new Blob(['video']);
    const result = await watermarkVideo(original, progress);
    expect(result.type).toBe('video/mp4');expect(result.size).toBe(10);
    expect(mocks.sampleDraw).toHaveBeenCalled();expect(mocks.sampleClose).toHaveBeenCalledOnce();
    expect(mocks.videoAdd).toHaveBeenCalledWith(0.032, 1 / 24);
    expect(mocks.audioAdd).toHaveBeenCalledWith({ bytes: 'original-aac', timestamp: 0 }, expect.objectContaining({ decoderConfig: expect.objectContaining({ codec: 'mp4a.40.2' }) }));
    expect(mocks.videoClose).toHaveBeenCalledOnce();expect(mocks.audioClose).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();expect(progress).toHaveBeenLastCalledWith(1);
    expect(await watermarkVideo(original)).toBe(result);expect(mocks.finalize).toHaveBeenCalledOnce();
  });

  it('cancels and disposes a failed encode without caching a clean fallback', async () => {
    const original = new Blob(['video']);mocks.videoAdd.mockRejectedValueOnce(new Error('Encoder stalled'));
    await expect(watermarkVideo(original)).rejects.toThrow('Encoder stalled');
    expect(mocks.sampleClose).toHaveBeenCalledOnce();expect(mocks.cancel).toHaveBeenCalledOnce();expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.audioAdd).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();
    await watermarkVideo(original);expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it.each(['opus', 'unknown'])('rejects incompatible audio rather than producing a silent export (%s)', async codec => {
    mocks.audioCodec = codec;
    await expect(watermarkVideo(new Blob(['video']))).rejects.toThrow('Audio export unsupported');
    expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('rejects extra tracks and undecodable video', async () => {
    mocks.tracks = 3;await expect(watermarkVideo(new Blob(['video']))).rejects.toThrow('Video export unsupported');
    mocks.tracks = 2;mocks.decode.mockResolvedValue(false);
    await expect(watermarkVideo(new Blob(['video']))).rejects.toThrow('Video export unsupported');
  });

  it('honors cancellation before work begins and during encoding', async () => {
    const controller = new AbortController();controller.abort();
    await expect(watermarkVideo(new Blob(['video']), undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.create).not.toHaveBeenCalled();
    const active = new AbortController();mocks.videoAdd.mockImplementationOnce(async () => {active.abort();});
    await expect(watermarkVideo(new Blob(['video']), undefined, active.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});
