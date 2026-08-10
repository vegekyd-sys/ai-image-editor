import type { VideoMeta, VideoSourceRange } from '@/types';

export interface ExternalVideoRangeInput {
  source_url: string;
  start?: number;
  end?: number;
  /** Legacy aliases accepted at the input boundary. */
  start_sec?: number;
  end_sec?: number;
  description?: string;
}

export interface NormalizedExternalVideoRange extends VideoSourceRange {
  description?: string;
  duration: number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeExternalVideoRange(input: unknown): NormalizedExternalVideoRange {
  if (!input || typeof input !== 'object') throw new Error('Source range must be an object.');
  const value = input as Record<string, unknown>;
  const sourceUrl = optionalString(value.source_url);
  if (!sourceUrl) throw new Error('source_url is required.');
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('source_url must be a valid HTTP(S) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('source_url must use http or https.');
  }

  const startSec = finiteNumber(value.start ?? value.start_sec);
  const endSec = finiteNumber(value.end ?? value.end_sec);
  if (startSec === undefined || startSec < 0) throw new Error('start must be a finite number >= 0.');
  if (endSec === undefined || endSec <= startSec) throw new Error('end must be greater than start.');

  return {
    source_url: sourceUrl,
    start_sec: startSec,
    end_sec: endSec,
    duration: endSec - startSec,
    ...(optionalString(value.description) ? { description: optionalString(value.description) } : {}),
  };
}

export function sourceRangeDuration(range: VideoSourceRange | undefined): number | undefined {
  if (!range) return undefined;
  const duration = range.end_sec - range.start_sec;
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export function sourceRangeFromVideoMeta(value: unknown): VideoSourceRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const sourceRange = (value as Partial<VideoMeta>).sourceRange;
  if (!sourceRange) return undefined;
  try {
    const normalized = normalizeExternalVideoRange(sourceRange);
    const { duration: _duration, description: _description, ...range } = normalized;
    return range;
  } catch {
    return undefined;
  }
}

export function sourceRangeIdentity(range: VideoSourceRange): string {
  return `${range.source_url.split('#')[0]}#t=${range.start_sec.toFixed(3)},${range.end_sec.toFixed(3)}`;
}

export function formatSourceRangeHint(range: VideoSourceRange | undefined): string {
  if (!range) return '';
  return ` [source range: source_url=${range.source_url}; start_sec=${range.start_sec}; end_sec=${range.end_sec}]`;
}
