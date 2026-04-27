import type { PhotoMetadata } from '@/types';
import { isHeicFile } from '@/lib/image/heic';
import { buildPhotoMetadata, extractPhotoMetadataCore } from '@/lib/image/metadataShared';

/** Extract EXIF metadata (location + time) from a photo file. */
export async function extractPhotoMetadata(file: File): Promise<PhotoMetadata | undefined> {
  const local = await extractPhotoMetadataLocally(file);

  // If we have GPS coords but no location name, just reverse-geocode (no file upload)
  if (local?.raw?.lat !== undefined && local?.raw?.lng !== undefined && !local.location) {
    const location = await reverseGeocodeClient(local.raw.lat, local.raw.lng);
    if (location) return { ...local, location };
    return local;
  }

  const needsServerFallback = isHeicFile(file) || !local?.takenAt;
  if (!needsServerFallback) return local;

  const server = await extractPhotoMetadataOnServer(file);
  return mergePhotoMetadata(local, server);
}

async function reverseGeocodeClient(lat: number, lng: number): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`,
      { headers: { 'User-Agent': 'Makaron-App/1.0' } },
    );
    if (!res.ok) return undefined;
    const geo = await res.json();
    const addr = geo?.address;
    if (!addr || typeof addr !== 'object') return undefined;
    const city = addr.city || addr.town || addr.village || addr.county;
    const country = addr.country;
    return [city, country].filter(Boolean).join(', ') || undefined;
  } catch {
    return undefined;
  }
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
