const maxBytes = 8 * 1024 * 1024;

export async function stageOpeningImage(source, { boardOrigin, upload, fetcher = fetch }) {
  const url = new URL(source);
  const isMakaronImage = url.origin === 'https://cdn.makaron.app' &&
    url.pathname.startsWith('/storage/v1/object/public/images/');
  const isBoardImage = url.origin === boardOrigin &&
    /^\/voice\/board-shared\/[a-f0-9]{32}\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || !(isMakaronImage || isBoardImage)) return null;

  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) ||
      Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const parts = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) return null;
    parts.push(chunk);
  }
  return bytes ? upload(new Blob(parts, { type })) : null;
}
