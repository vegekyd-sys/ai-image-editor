'use client';

import { useLocale } from '@/lib/i18n';

/**
 * Extra box styling while files are dragged over the page: the input box glows
 * brighter and lifts slightly as the file gets closer, and locks into a strong
 * accent state once the pointer is over it.
 */
export function dropProximityStyle(dragging: boolean, proximity: number, over: boolean): React.CSSProperties {
  if (!dragging && !over) return {};
  const p = over ? 1 : proximity;
  return {
    // Drives the box's own energy-flow highlight (globals.css [data-drop]).
    ['--drop-p' as string]: p.toFixed(2),
    borderColor: `rgba(217,70,239,${(0.3 + 0.55 * p).toFixed(3)})`,
    boxShadow: `0 16px 40px rgba(0,0,0,0.48), 0 0 0 ${(1 + 2 * p).toFixed(1)}px rgba(217,70,239,${(0.12 + 0.3 * p).toFixed(3)}), 0 0 ${Math.round(24 + 56 * p)}px rgba(217,70,239,${(0.2 + 0.4 * p).toFixed(3)}), inset 0 0.5px 0 rgba(255,255,255,0.15)`,
    transform: `scale(${(1 + 0.018 * p).toFixed(4)})`,
    transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.22s ease, background 0.2s ease',
  };
}

export function dropState(dragging: boolean, over: boolean): 'over' | 'near' | undefined {
  return over ? 'over' : dragging ? 'near' : undefined;
}

/** Label layered over the input box during a file drag. */
export function DropOverlay({ dragging, proximity, over, radius = 18 }: { dragging: boolean; proximity: number; over: boolean; radius?: number }) {
  const { t } = useLocale();
  const visible = over || (dragging && proximity > 0.35);
  const opacity = over ? 1 : visible ? Math.min(1, (proximity - 0.35) / 0.5) : 0;
  return (
    <div
      aria-hidden={!visible}
      data-testid="drop-overlay"
      data-state={over ? 'over' : visible ? 'near' : 'idle'}
      style={{
        position: 'absolute', inset: 4, zIndex: 6, borderRadius: radius - 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        pointerEvents: 'none',
        opacity,
        border: `1.5px dashed rgba(240,171,252,${over ? 0.75 : 0.4})`,
        background: over ? 'rgba(24,10,30,0.78)' : 'rgba(14,10,20,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        color: over ? '#fdf4ff' : 'rgba(240,171,252,0.9)',
        fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.02em',
        transition: 'opacity 0.18s ease, background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
      }}
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: over ? 'translateY(-1px)' : 'none', transition: 'transform 0.2s ease' }}>
        <path d="M12 16V4" /><polyline points="6 10 12 4 18 10" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <span>{over ? t('upload.releaseToUpload') : t('upload.dropHere')}</span>
    </div>
  );
}
