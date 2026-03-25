import type { PhotoMetadata } from '@/types';

type ExifLike = Record<string, unknown>;

export interface PhotoMetadataCore {
  lat?: number;
  lng?: number;
  datetimeRaw?: string;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dmsToDecimal(value: unknown, ref?: unknown): number | undefined {
  if (!Array.isArray(value) || value.length < 3) return asNumber(value);
  const [deg, min, sec] = value;
  const d = Number(deg);
  const m = Number(min);
  const s = Number(sec);
  if (![d, m, s].every(Number.isFinite)) return undefined;
  const sign = ref === 'S' || ref === 'W' ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}

function extractLat(exif: ExifLike): number | undefined {
  return asNumber(exif.latitude)
    ?? asNumber(exif.lat)
    ?? dmsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
}

function extractLng(exif: ExifLike): number | undefined {
  return asNumber(exif.longitude)
    ?? asNumber(exif.lng)
    ?? dmsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
}

function normalizeDateTimeValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = `${value.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${value.getUTCDate()}`.padStart(2, '0');
    const hh = `${value.getUTCHours()}`.padStart(2, '0');
    const mm = `${value.getUTCMinutes()}`.padStart(2, '0');
    const ss = `${value.getUTCSeconds()}`.padStart(2, '0');
    return `${y}:${m}:${d} ${hh}:${mm}:${ss}`;
  }
  return undefined;
}

export function extractPhotoMetadataCore(exif: unknown): PhotoMetadataCore | undefined {
  if (!exif || typeof exif !== 'object') return undefined;
  const record = exif as ExifLike;
  const lat = extractLat(record);
  const lng = extractLng(record);
  const datetimeRaw = normalizeDateTimeValue(
    record.DateTimeOriginal
      ?? record.CreateDate
      ?? record.ModifyDate
      ?? record.DateTimeDigitized,
  );

  if (lat === undefined && lng === undefined && !datetimeRaw) return undefined;
  return { lat, lng, datetimeRaw };
}

export function formatTakenAt(datetimeRaw?: string, lat?: number, lng?: number): string | undefined {
  if (!datetimeRaw) return undefined;

  const exifMatch = datetimeRaw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
  if (exifMatch) {
    const utcOffset = lng !== undefined ? Math.round(lng / 15) : undefined;
    const tzStr = utcOffset !== undefined
      ? ` (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset})`
      : '';
    return `${exifMatch[1]}年${parseInt(exifMatch[2], 10)}月${parseInt(exifMatch[3], 10)}日 ${exifMatch[4]}:${exifMatch[5]}${tzStr}`;
  }

  const parsed = new Date(datetimeRaw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const utcOffset = lng !== undefined ? Math.round(lng / 15) : undefined;
  const tzStr = utcOffset !== undefined
    ? ` (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset})`
    : '';
  return `${parsed.getUTCFullYear()}年${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日 ${`${parsed.getUTCHours()}`.padStart(2, '0')}:${`${parsed.getUTCMinutes()}`.padStart(2, '0')}${tzStr}`;
}

export function buildPhotoMetadata(
  core?: PhotoMetadataCore,
  location?: string,
): PhotoMetadata | undefined {
  if (!core) return location ? { location } : undefined;
  const takenAt = formatTakenAt(core.datetimeRaw, core.lat, core.lng);
  if (!takenAt && !location) return undefined;
  return {
    takenAt,
    location,
    raw: {
      lat: core.lat,
      lng: core.lng,
      datetime: core.datetimeRaw,
    },
  };
}
