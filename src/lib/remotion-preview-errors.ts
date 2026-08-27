export type RemotionPreviewErrorKind = 'network' | 'decode' | 'font' | 'runtime';
export type RemotionPreviewErrorPhase = 'font-load' | 'image-fetch' | 'player-init' | 'player-runtime';

const NETWORK_PATTERNS = [
  /network error/i,
  /failed to fetch/i,
  /load failed/i,
  /network request failed/i,
  /fetch failed/i,
  /timed? ?out/i,
];

const DECODE_PATTERNS = [
  /cannot be decoded/i,
  /could not be decoded/i,
  /failed to decode/i,
  /encodingerror/i,
  /decoder.*(?:failed|unsupported)/i,
];

const FONT_PATTERNS = [
  /remotion font/i,
  /fontface/i,
  /font.*failed to load/i,
];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function classifyRemotionPreviewError(error: unknown): RemotionPreviewErrorKind {
  const message = errorText(error);
  if (DECODE_PATTERNS.some(pattern => pattern.test(message))) return 'decode';
  if (FONT_PATTERNS.some(pattern => pattern.test(message))) return 'font';
  if (NETWORK_PATTERNS.some(pattern => pattern.test(message))) return 'network';
  return 'runtime';
}

export function isRecoverableRemotionPreviewError(error: unknown): boolean {
  return classifyRemotionPreviewError(error) !== 'runtime';
}

function safeResourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 1000);
  } catch {
    return undefined;
  }
}

export function reportRemotionPreviewError(input: {
  projectId?: string;
  snapshotId?: string;
  phase: RemotionPreviewErrorPhase;
  error: unknown;
  recovered: boolean;
  resourceUrl?: string;
}): void {
  if (typeof window === 'undefined') return;
  const message = errorText(input.error).slice(0, 1000);
  void fetch('/api/remotion/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body: JSON.stringify({
      projectId: input.projectId,
      snapshotId: input.snapshotId,
      phase: input.phase,
      kind: classifyRemotionPreviewError(message),
      message,
      recovered: input.recovered,
      resourceUrl: safeResourceUrl(input.resourceUrl),
      path: window.location.pathname,
    }),
  }).catch(() => {
    // Reporting must never replace the original preview recovery path.
  });
}
