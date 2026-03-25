import type { PhotoMetadata } from '@/types';
import { isHeicFile } from '@/lib/image/heic';
import { buildPhotoMetadata, extractPhotoMetadataCore } from '@/lib/image/metadataShared';

/** Extract EXIF metadata (location + time) from a photo file. */
export async function extractPhotoMetadata(file: File): Promise<PhotoMetadata | undefined> {
  const local = await extractPhotoMetadataLocally(file);
  const needsServerFallback = isHeicFile(file)
    || !local?.takenAt
    || (!!local?.raw && local.location === undefined && local.raw.lat !== undefined && local.raw.lng !== undefined);

  if (!needsServerFallback) return local;

  const server = await extractPhotoMetadataOnServer(file);
  return mergePhotoMetadata(local, server);
}

async function extractPhotoMetadataLocally(file: File): Promise<PhotoMetadata | undefined> {
  try {
    const exifr = (await import('exifr')).default;
    // ArrayBuffer parsing is more reliable for HEIC/HEIF blobs in the browser.
    const exif = await exifr.parse(await file.arrayBuffer(), { gps: true, reviveValues: false });
    return buildPhotoMetadata(extractPhotoMetadataCore(exif));
  } catch {
    return undefined;
  }
}

async function extractPhotoMetadataOnServer(file: File): Promise<PhotoMetadata | undefined> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/photo-metadata', { method: 'POST', body: formData });
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
