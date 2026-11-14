import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasPreviewBridge from '@/components/CanvasPreviewBridge';
import { preloadDecodedImage } from '@/lib/image/presentation';

const gates = new Map<string, Promise<void>>();
const resolvers = new Map<string, () => void>();
function pending(src: string) { gates.set(src, new Promise(resolve => resolvers.set(src, resolve))); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function () { return gates.get(this.getAttribute('src') || this.src) || Promise.resolve(); });
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img');
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
    return image;
  });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); gates.clear(); resolvers.clear(); });
async function paint() { await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(40); }); }

describe('decoded image presentation', () => {
  it('deduplicates concurrent preloads and does not mark an image ready before decoding', async () => {
    pending('/new-one.jpg');
    const a = preloadDecodedImage('/new-one.jpg'), b = preloadDecodedImage('/new-one.jpg');
    expect(a).toBe(b);
    let ready = false; void a.then(() => { ready = true; });
    await Promise.resolve(); expect(ready).toBe(false);
    resolvers.get('/new-one.jpg')!();
    await expect(a).resolves.toEqual({ width: 400, height: 300 });
  });

  it('retains the old picture through slow decoding and discards an interrupted snapshot', async () => {
    await preloadDecodedImage('/old-one.jpg');
    const view = render(<CanvasPreviewBridge source="/old-one.jpg" contentReady navigating={false} longContent={false} />);
    pending('/slow-one.jpg'); pending('/latest-one.jpg');
    view.rerender(<CanvasPreviewBridge source="/slow-one.jpg" contentReady={false} navigating={false} longContent={false} />);
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/old-one.jpg');
    view.rerender(<CanvasPreviewBridge source="/latest-one.jpg" contentReady={false} navigating={false} longContent={false} />);
    resolvers.get('/slow-one.jpg')!(); await paint();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/old-one.jpg');
    expect(view.container.querySelector('img[src="/slow-one.jpg"]')).toBeNull();
    resolvers.get('/latest-one.jpg')!(); await paint();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/old-one.jpg');
    view.rerender(<CanvasPreviewBridge source="/latest-one.jpg" contentReady navigating={false} longContent={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(125); });
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/latest-one.jpg');
  });
});
