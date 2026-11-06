/**
 * Content types for media files stored in Supabase Storage, keyed by extension.
 *
 * This list mirrors MEDIA_EXT in services/media-r2-cache/src/worker.mjs: the
 * cdn.makaron.app R2 cache only stores objects whose origin content-type is
 * video/audio/image, so uploading media as application/octet-stream makes every
 * read fall through to Supabase egress (2026-11-07: .wav outputs from run_code).
 */
const MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** Lowercase extension without the dot; accepts ".wav", "wav", paths and URLs. */
function extensionOf(pathOrExt: string): string {
  const clean = (pathOrExt.split(/[?#]/)[0] || pathOrExt).trim().toLowerCase();
  if (/^\.?[a-z0-9]+$/.test(clean)) return clean.replace(/^\./, '');
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

/** Media content type for a path, URL or extension, or null when it is not media. */
export function mediaContentTypeFor(pathOrExt: string): string | null {
  return MEDIA_CONTENT_TYPES[extensionOf(pathOrExt)] ?? null;
}

/** Media content type, falling back to application/octet-stream. */
export function mediaContentTypeOrBinary(pathOrExt: string): string {
  return mediaContentTypeFor(pathOrExt) ?? 'application/octet-stream';
}
