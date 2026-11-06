'use client';

import { useLocale } from '@/lib/i18n';

export interface UploadProgressItem {
  /** Overall 0–1 progress of this file (local compress + upload). */
  progress: number;
  status: 'active' | 'done' | 'error';
}

/** Local preparation (compress/transcode) is weighted as the first 30%. */
export const PREPARE_WEIGHT = 0.3;

/** Product accent (matches the create button / caret). */
export const UPLOAD_ACCENT = '#d946ef';

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
 * Upload progress folded into the input box's own chrome instead of a separate
 * row: a compact ring + "4/6" next to the primary action, and a hairline along
 * the box's bottom edge (see UploadProgressEdge).
 */
export function UploadProgressChip({
  items,
  hint = false,
  testId,
  showCount = true,
}: {
  items: UploadProgressItem[];
  /** The user tried to send before uploads finished. */
  hint?: boolean;
  testId?: string;
  /** False where every thumbnail already shows its own progress (desktop):
   * the chip then only appears for the send-before-ready hint. */
  showCount?: boolean;
}) {
  const { t } = useLocale();
  if (items.length === 0 || (!showCount && !hint)) return null;
  const { done, failed, percent, active } = overallProgress(items);
  if (!active && failed === 0) return null;
  const isError = !active && failed > 0;
  const total = items.length;
  const label = isError
    ? t('upload.failedSummary', failed)
    : hint
      ? t('upload.waitForAttachments', done, total)
      : `${t('upload.progress', done, total)} · ${percent}%`;
  const ringColor = isError ? 'rgba(248,113,113,0.95)' : UPLOAD_ACCENT;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px 3px 6px', borderRadius: 999,
        background: isError ? 'rgba(248,113,113,0.1)' : hint ? 'rgba(217,70,239,0.14)' : 'rgba(255,255,255,0.05)',
        boxShadow: hint && !isError ? 'inset 0 0 0 0.5px rgba(217,70,239,0.45)' : 'inset 0 0 0 0.5px rgba(255,255,255,0.08)',
        fontSize: '0.7rem', fontWeight: 500, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        color: isError ? 'rgba(248,113,113,0.95)' : hint ? 'rgba(240,171,252,0.95)' : 'rgba(255,255,255,0.62)',
        transition: 'background 0.2s, color 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx={8} cy={8} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
        {isError ? (
          <>
            <circle cx={8} cy={8} r={r} fill="none" stroke={ringColor} strokeWidth={2} />
            <line x1={8} y1={5} x2={8} y2={8.6} stroke={ringColor} strokeWidth={1.6} strokeLinecap="round" />
            <circle cx={8} cy={10.8} r={0.9} fill={ringColor} />
          </>
        ) : (
          <circle
            cx={8} cy={8} r={r} fill="none" stroke={ringColor} strokeWidth={2} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, percent / 100))}
            transform="rotate(-90 8 8)" style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
          />
        )}
      </svg>
      <span>
        {isError ? t('upload.failedShort', failed) : `${done}/${total}`}
        {hint && !isError ? ` · ${t('upload.sendWhenDone')}` : ''}
      </span>
    </div>
  );
}

/** Hairline progress along the bottom edge of the input box. Parent must be position:relative. */
export function UploadProgressEdge({ items, inset = 18 }: { items: UploadProgressItem[]; inset?: number }) {
  if (items.length === 0) return null;
  const { failed, percent, active } = overallProgress(items);
  const visible = active;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', left: inset, right: inset, bottom: 0, height: 2,
        pointerEvents: 'none', opacity: visible ? 1 : 0, transition: 'opacity 400ms ease',
      }}
    >
      <div
        style={{
          height: '100%', width: `${visible ? Math.max(2, percent) : 100}%`, borderRadius: 2,
          background: failed > 0
            ? 'linear-gradient(90deg, rgba(217,70,239,0.0), rgba(217,70,239,0.75) 70%, rgba(248,113,113,0.8))'
            : 'linear-gradient(90deg, rgba(217,70,239,0.0), rgba(217,70,239,0.85) 60%, #f0abfc)',
          boxShadow: '0 0 8px rgba(217,70,239,0.55)',
          transition: 'width 300ms ease-out',
        }}
      />
    </div>
  );
}
