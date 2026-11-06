'use client';

import { useLocale } from '@/lib/i18n';

export interface UploadProgressItem {
  /** Overall 0–1 progress of this file (local compress + upload). */
  progress: number;
  status: 'active' | 'done' | 'error';
}

/** Local preparation (compress/transcode) is weighted as the first 30%. */
export const PREPARE_WEIGHT = 0.3;

export function overallProgress(items: UploadProgressItem[]): { done: number; failed: number; percent: number; active: boolean } {
  let done = 0;
  let failed = 0;
  let sum = 0;
  for (const item of items) {
    if (item.status === 'done') { done += 1; sum += 1; }
    else if (item.status === 'error') failed += 1;
    else sum += Math.max(0, Math.min(1, item.progress));
  }
  const counted = items.length - failed;
  return {
    done,
    failed,
    percent: counted > 0 ? Math.round((sum / counted) * 100) : 0,
    active: done + failed < items.length,
  };
}

/**
 * One combined progress row inside the input box: "上传中 3/7 · 42%" plus a
 * thin bar. Replaces the separate processing / uploading counters.
 */
export function UploadProgress({
  items,
  hint = false,
  testId,
  className,
  style,
}: {
  items: UploadProgressItem[];
  /** Highlight because the user tried to send before uploads finished. */
  hint?: boolean;
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useLocale();
  if (items.length === 0) return null;
  const { done, failed, percent, active } = overallProgress(items);
  if (!active && failed === 0) return null;
  const isError = !active && failed > 0;
  const label = isError
    ? t('upload.failedSummary', failed)
    : hint
      ? t('upload.waitForAttachments', done, items.length)
      : t('upload.progress', done, items.length);
  const color = isError ? 'rgba(248,113,113,0.95)' : hint ? 'rgba(232,121,249,0.95)' : 'rgba(255,255,255,0.6)';
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.2 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {!isError && <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.45)' }}>{percent}%</span>}
        {!isError && failed > 0 && (
          <span style={{ flexShrink: 0, color: 'rgba(248,113,113,0.95)' }}>{t('upload.failedShort', failed)}</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isError ? undefined : percent}
        style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: `${isError ? 100 : Math.max(3, percent)}%`,
            borderRadius: 2,
            background: isError ? 'rgba(248,113,113,0.6)' : 'linear-gradient(90deg, #d946ef, #f0abfc)',
            transition: 'width 300ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
