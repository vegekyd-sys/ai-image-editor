import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fetchDownload, isPublicDownloadUrl } from '../src/lib/parallel-download';

function origin({ hidden = false, ignored = false, broken = false, changed = false } = {}) {
  const bytes = Uint8Array.from({ length: 41 }, (_, i) => i);
  let active = 0, peak = 0; const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init = {}) => {
    const signal = init.signal; const headers = { Range: new Headers(init.headers).get('Range') }; 
    signal?.throwIfAborted(); requests.push(headers.Range || 'full');
    if (!headers.Range || ignored) return new Response(bytes);
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 2)); active--; signal?.throwIfAborted();
    const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/)!; const start = +a, end = +b;
    return new Response(bytes.slice(start, broken && start > 0 ? end : end + 1), {
      status: 206, headers: hidden ? {} : { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: changed && start > 0 ? '"new"' : '"one"' },
    });
  };
  return { bytes, fetcher, requests, peak: () => peak };
}
const options = { threshold: 1, chunkSize: 5 };
test('parallel chunks preserve bytes and stay within four requests', async () => {
  const o = origin(); const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher });
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), o.bytes); assert.equal(o.peak(), 4);
});
for (const kind of ['hidden', 'ignored']) test(`${kind} range metadata falls back to full download`, async () => {
  const o = origin({ [kind]: true }); const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher });
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), o.bytes); assert.ok(kind === 'ignored' || o.requests.includes('full'));
});
for (const kind of ['broken', 'changed']) test(`${kind} chunk cannot produce a successful file`, async () => {
  const o = origin({ [kind]: true }); const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher });
  await assert.rejects(r.arrayBuffer());
});
test('aborted caller stops transfer', async () => {
  const o = origin(); const controller = new AbortController();
  const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher, signal: controller.signal });
  controller.abort(); await assert.rejects(r.arrayBuffer(), { name: 'AbortError' });
});
test('small or unknown sizes use a single full request', async () => {
  const o = origin(); await (await fetchDownload('https://media.test/a', 41, { fetcher: o.fetcher })).arrayBuffer();
  assert.deepEqual(o.requests, ['full']);
});
test('consumer cancellation stops scheduling further batches', async () => {
  const o = origin(); const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher });
  const reader = r.body!.getReader(); await reader.read(); await reader.cancel();
  assert.equal(o.requests.length, 5);
});
test('slow consumer does not prefetch the entire file', async () => {
  const o = origin(); const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher: o.fetcher });
  const reader = r.body!.getReader(); await reader.read();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(o.requests.length, 5); await reader.cancel();
});
test('wrong total size and weak ETag fall back before emitting bytes', async () => {
  for (const headers of [{ 'Content-Range': 'bytes 0-0/42', ETag: '"one"' }, { 'Content-Range': 'bytes 0-0/41', ETag: 'W/"one"' }]) {
    const o = origin(); const fetcher: typeof fetch = async (url, init = {}) => new Headers(init.headers).has('Range') ? new Response(new Uint8Array(1), { status: 206, headers }) : o.fetcher(url, init);
    const r = await fetchDownload('https://media.test/a', 41, { ...options, fetcher });
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), o.bytes); assert.deepEqual(o.requests, ['full']);
  }
});

test('unknown size is discovered from a validated Range response', async () => {
  const o = origin(); const r = await fetchDownload('https://media.test/a', undefined, { ...options, fetcher: o.fetcher });
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), o.bytes); assert.equal(o.peak(), 4);
});
test('only owned public storage URLs qualify for parallel download', () => {
  assert.equal(isPublicDownloadUrl('https://cdn.makaron.app/storage/v1/object/public/images/a.mp4'), true);
  for (const url of ['https://example.com/a.mp4', 'https://cdn.makaron.app/storage/v1/object/sign/images/a?token=x', 'https://cdn.makaron.app/storage/v1/object/public/images/a?token=x', 'blob:abc']) assert.equal(isPublicDownloadUrl(url), false);
});
