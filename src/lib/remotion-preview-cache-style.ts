import type { CSSProperties } from 'react';

export interface PreviewCacheBox {
  left: number;
  top: number;
  width: string;
  height: string;
  position: 'absolute' | 'fixed';
}

/** offsetLeft/Top include normal-flow placement and margins, but exclude the
 * transform. Reapply the authored transform once to the overlay, with no
 * second margin or flex/grid participation. Preserve objectPosition, clipping,
 * opacity, filters, borders and transformOrigin from the original style. */
export function previewCacheStyle(style: CSSProperties | undefined, box: PreviewCacheBox | null, visible: boolean): CSSProperties {
  return {
    ...style,
    position: box?.position ?? 'absolute',
    inset: 'auto',
    left: box?.left ?? 0,
    top: box?.top ?? 0,
    right: 'auto',
    bottom: 'auto',
    width: box?.width ?? style?.width,
    height: box?.height ?? style?.height,
    margin: 0,
    display: visible && box ? (style?.display ?? 'block') : 'none',
    pointerEvents: 'none',
  };
}
