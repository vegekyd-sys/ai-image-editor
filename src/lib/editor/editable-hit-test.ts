export interface EditableHitRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

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
