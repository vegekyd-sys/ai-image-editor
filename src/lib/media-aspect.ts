type MediaMetaLike = {
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  status?: string | null;
};

function finitePositive(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatAspectRatio(width: unknown, height: unknown): string | undefined {
  const w = finitePositive(width);
  const h = finitePositive(height);
  if (!w || !h) return undefined;
  const divisor = gcd(w, h);
  return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`;
}

export function formatOrientation(width: unknown, height: unknown): 'portrait' | 'landscape' | 'square' | undefined {
  const w = finitePositive(width);
  const h = finitePositive(height);
  if (!w || !h) return undefined;
  if (w === h) return 'square';
  return w < h ? 'portrait' : 'landscape';
}

export function formatDurationSeconds(duration: unknown): string | undefined {
  const d = finitePositive(duration);
  if (!d) return undefined;
  const rounded = Number(d.toFixed(d >= 10 ? 2 : 1));
  return `${rounded}s`;
}

export function formatVideoMediaSpec(meta: MediaMetaLike | undefined): string {
  const parts: string[] = [];
  const status = typeof meta?.status === 'string' ? meta.status : undefined;
  const duration = formatDurationSeconds(meta?.duration);
  const width = finitePositive(meta?.width);
  const height = finitePositive(meta?.height);
  const aspect = formatAspectRatio(width, height);
  const orientation = formatOrientation(width, height);

  if (status && status !== 'completed') parts.push(status);
  if (duration) parts.push(duration);
  if (width && height) parts.push(`${Math.round(width)}x${Math.round(height)}`);
  if (aspect && orientation) parts.push(`${aspect} ${orientation}`);

  return parts.join(', ');
}

