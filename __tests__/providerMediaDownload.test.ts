// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ get: network.get }));
import { readProviderImage } from '@/lib/provider-image-preflight';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('download timeout')), ms);
    return controller.signal;
  });
  network.get.mockImplementation((_url, options, callback) => {
    const request = new EventEmitter();
    options.signal.addEventListener('abort', () => request.emit('error', options.signal.reason));
    setTimeout(() => {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200, headers: {},
        destroy(this: EventEmitter, error?: Error) { if (error) this.emit('error', error); },
      });
      callback(response);
      setTimeout(() => { response.emit('data', Buffer.from('video')); response.emit('end'); }, 16_000);
    }, 0);
    return request;
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); network.get.mockReset(); });

it('reads a legitimate video body that takes longer than the image deadline', async () => {
  const result = readProviderImage('https://cdn.makaron.app/source.mp4', 100, { mediaType: 'video' });
  await vi.advanceTimersByTimeAsync(16_001);
  expect((await result).toString()).toBe('video');
});

it('keeps the shorter deadline for ordinary images', async () => {
  const assertion = expect(readProviderImage('https://cdn.makaron.app/source.jpg', 100)).rejects.toThrow('download timeout');
  await vi.advanceTimersByTimeAsync(15_001);
  await assertion;
});

it('keeps the video size limit even with the longer deadline', async () => {
  const assertion = expect(readProviderImage('https://cdn.makaron.app/source.mp4', 3, { mediaType: 'video' })).rejects.toThrow('too large');
  await vi.advanceTimersByTimeAsync(16_001);
  await assertion;
});
