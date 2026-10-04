'use client';

interface TransparencyBackdropProps {
  rect?: { l: number; t: number; w: number; h: number };
  compact?: boolean;
}

/** Neutral editor-only checkerboard. It is a sibling underneath the image, so
 * it cannot be serialized into the source image or any export. */
export default function TransparencyBackdrop({ rect, compact = false }: TransparencyBackdropProps) {
  const tile = compact ? 16 : 22;
  const half = tile / 2;

  return (
    <div
      data-testid="transparency-backdrop"
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        ...(rect
          ? { left: rect.l, top: rect.t, width: rect.w, height: rect.h }
          : { inset: 0 }),
        backgroundColor: '#f4f4f5',
        backgroundImage: [
          'linear-gradient(45deg, #d4d4d8 25%, transparent 25%)',
          'linear-gradient(-45deg, #d4d4d8 25%, transparent 25%)',
          'linear-gradient(45deg, transparent 75%, #d4d4d8 75%)',
          'linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)',
        ].join(', '),
        backgroundSize: `${tile}px ${tile}px`,
        backgroundPosition: `0 0, 0 ${half}px, ${half}px -${half}px, -${half}px 0`,
        boxShadow: 'inset 0 0 0 1px rgba(24,24,27,0.12)',
      }}
    />
  );
}
