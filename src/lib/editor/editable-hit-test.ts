export interface EditableHitRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EditableCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type EditablePointerIntent = 'select' | 'canvas-tap' | 'manipulate' | 'ignore';

export const EDITABLE_CANVAS_COVERAGE_THRESHOLD = 0.9;
export const EDITABLE_POINTER_MOVE_THRESHOLD = 6;

export function findEditableAtPoint(
  rects: EditableHitRect[],
  x: number,
  y: number,
): string | null {
  const hits = rects.filter((rect) =>
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );

  if (hits.length === 0) return null;

  hits.sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    if (areaA !== areaB) return areaA - areaB;
    return rects.indexOf(b) - rects.indexOf(a);
  });

  return hits[0].id;
}

export function isEditableCanvasCover(
  rect: EditableCanvasRect,
  canvas: EditableCanvasRect,
  threshold = EDITABLE_CANVAS_COVERAGE_THRESHOLD,
): boolean {
  if (canvas.width <= 0 || canvas.height <= 0) return false;

  const intersectionWidth = Math.max(
    0,
    Math.min(rect.left + rect.width, canvas.left + canvas.width) -
      Math.max(rect.left, canvas.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(rect.top + rect.height, canvas.top + canvas.height) -
      Math.max(rect.top, canvas.top),
  );

  return (intersectionWidth * intersectionHeight) / (canvas.width * canvas.height) >= threshold;
}

export function resolveEditablePointerIntent({
  hitFieldId,
  hitIsCanvasCover,
  selectedFieldId,
  moved,
}: {
  hitFieldId: string | null;
  hitIsCanvasCover: boolean;
  selectedFieldId: string | null;
  moved: boolean;
}): EditablePointerIntent {
  if (moved) {
    return hitFieldId && selectedFieldId === hitFieldId ? 'manipulate' : 'ignore';
  }
  if (!hitFieldId) return 'canvas-tap';
  if (hitIsCanvasCover) {
    return selectedFieldId === hitFieldId ? 'manipulate' : 'canvas-tap';
  }
  return 'select';
}
