// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { readFile } from '@/lib/workspace';
it('uses a unique no-store request for every canonical Editable merge', async () => {
  const sign = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example.com/design.json?token=private-test' }, error: null });
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"revision":1}')).mockResolvedValueOnce(new Response('{"revision":2}'));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const client = { storage: { from: () => ({ createSignedUrl: sign }) } } as any;
    const first = await readFile('code/source.json', client, 'owner', { fresh: true });
    const second = await readFile('code/source.json', client, 'owner', { fresh: true });
    expect(JSON.parse(first!.content).revision).toBe(1);
    expect(JSON.parse(second!.content).revision).toBe(2);
    expect(fetchMock.mock.calls[0][0].href).not.toBe(fetchMock.mock.calls[1][0].href);
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    expect(sign).toHaveBeenCalledWith('owner/workspace/code/source.json', 60);
  } finally { vi.unstubAllGlobals(); }
});
