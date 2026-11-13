// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAgentImageTransport } from '@/lib/agent-image-transport';

const url = 'https://cdn.makaron.app/storage/v1/object/public/images/test.png';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Agent original image transport', () => {
  it('inlines byte-identical pixels and preserves Media Index; deduplicates within a turn only', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    const fetchMock = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const input = [{ source: url, mediaIndex: 3 }, { source: url, mediaIndex: 7 }];
    const result = await prepareAgentImageTransport(input);
    expect(result).toEqual(input.map(item => ({ ...item, source: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, transportPrepared: true })));
    expect(input[0].source).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await prepareAgentImageTransport(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps external, deceptive, inline and non-storage sources without server fetches', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const images = ['http://127.0.0.1/private', 'https://cdn.makaron.app.attacker.test/storage/v1/object/x', 'https://cdn.makaron.app/other.png', 'https://cdn.makaron.app@attacker.test/storage/v1/object/x', 'data:image/png;base64,AQID'].map(source => ({ source }));
    expect(await prepareAgentImageTransport(images)).toEqual(images);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([503, 404])('preserves provider URL fallback for HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    expect(await prepareAgentImageTransport([{ source: url }])).toEqual([{ source: url, transportPrepared: true }]);
  });

  it('bounds the actual stream even when Content-Length is missing', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel,
    }), { headers: { 'content-type': 'image/png' } })));
    expect(await prepareAgentImageTransport([{ source: url }])).toEqual([{ source: url, transportPrepared: true }]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('never follows redirects and falls back on download rejection', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { throw new Error('redirect or timeout'); });
    vi.stubGlobal('fetch', fetchMock);
    expect(await prepareAgentImageTransport([{ source: url }])).toEqual([{ source: url, transportPrepared: true }]);
    await prepareAgentImageTransport([{ source: url, transportPrepared: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
});
