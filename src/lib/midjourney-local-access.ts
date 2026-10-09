/** No local experiment API is exposed by production or a normal dev session. */
export function isLocalMidjourneyRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.MIDJOURNEY_LOCAL_LAB !== '1') return false;
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return false;
  return !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
}
