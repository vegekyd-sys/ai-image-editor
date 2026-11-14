import type { PhotoMetadata } from '@/types';
import { isHeicFile } from '@/lib/image/heic';
import { buildPhotoMetadata, extractPhotoMetadataCore } from '@/lib/image/metadataShared';

/** Extract EXIF metadata (location + time) from a photo file.
 *  Returns takenAt + GPS coords immediately (non-blocking).
 *  Location name requires a separate reverseGeocode call — see enrichMetadataLocation. */
export async function extractPhotoMetadata(
  file: File,
  options?: { allowServerFallback?: boolean },
): Promise<PhotoMetadata | undefined> {
  const local = await extractPhotoMetadataLocally(file);

  // PNG artwork/screenshots commonly have no EXIF. Re-uploading the whole
  // image cannot recover a missing capture date and can block project entry.
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  const needsServerFallback = !isPng && (isHeicFile(file) || !local?.takenAt);
  if (!needsServerFallback || options?.allowServerFallback === false) return local;

  const server = await extractPhotoMetadataOnServer(file);
  return mergePhotoMetadata(local, server);
}

/** Async: fetch human-readable location name from lat/lng via server-side reverse geocode.
 *  Returns enriched metadata with location field, or original if geocode fails. */
export async function enrichMetadataLocation(metadata: PhotoMetadata): Promise<PhotoMetadata> {
  if (metadata.location) return metadata;
  const lat = metadata.raw?.lat;
  const lng = metadata.raw?.lng;
  if (lat === undefined || lng === undefined) return metadata;

  try {
    const res = await fetch('/api/reverse-geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    if (!res.ok) return metadata;
    const data = await res.json();
    if (data?.location) {
      return { ...metadata, location: data.location };
    }
  } catch { /* geocode failed, return as-is */ }
  return metadata;
}

async function extractPhotoMetadataLocally(file: File): Promise<PhotoMetadata | undefined> {
  try {
    const exifr = (await import('exifr')).default;
    const exif = await exifr.parse(await file.arrayBuffer(), { gps: true, reviveValues: false });
    return buildPhotoMetadata(extractPhotoMetadataCore(exif));
  } catch {
    return undefined;
  }
}

async function extractPhotoMetadataOnServer(file: File): Promise<PhotoMetadata | undefined> {
  // Keep below the hosting request-body limit; the original is already
  // uploaded through Storage and a second large multipart upload returns 413.
  if (file.size > 4 * 1024 * 1024) return undefined;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/photo-metadata', { method: 'POST', body: formData, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.metadata ?? undefined;
  } catch {
    return undefined;
  }
}

function mergePhotoMetadata(
  local?: PhotoMetadata,
  server?: PhotoMetadata,
): PhotoMetadata | undefined {
  if (!local) return server;
  if (!server) return local;
  return {
    takenAt: server.takenAt ?? local.takenAt,
    location: server.location ?? local.location,
    raw: {
      lat: server.raw?.lat ?? local.raw?.lat,
      lng: server.raw?.lng ?? local.raw?.lng,
      datetime: server.raw?.datetime ?? local.raw?.datetime,
    },
  };
}
