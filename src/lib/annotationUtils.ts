import type { AnnotationEntry, BrushData, RectData, TextData } from '@/types';

/** Replay all annotation entries onto a canvas 2D context */
export function replayAnnotations(
  ctx: CanvasRenderingContext2D,
  entries: AnnotationEntry[],
): void {
  for (const entry of entries) {
    ctx.strokeStyle = entry.color;
    ctx.fillStyle = entry.color;
    ctx.lineWidth = entry.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (entry.type) {
      case 'brush': {
        const { points } = entry.data as BrushData;
        if (points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          // Quadratic curve for smoother lines
          const prev = points[i - 1];
          const curr = points[i];
          const mx = (prev.x + curr.x) / 2;
          const my = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.stroke();
        break;
      }
      case 'rect': {
        const { x, y, w, h } = entry.data as RectData;
        ctx.lineWidth = entry.lineWidth * 1.5;
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'text': {
        const { x, y, text, fontSize, textColor, bgColor } = entry.data as TextData;
        ctx.font = `bold ${fontSize}px sans-serif`;
        const metrics = ctx.measureText(text);
        const textW = metrics.width;
        const pad = fontSize * 0.3;
        // Background
        if (bgColor) {
          ctx.fillStyle = bgColor;
          const r = fontSize * 0.25;
          const bx = x - pad, by = y - fontSize - pad * 0.5, bw = textW + pad * 2, bh = fontSize + pad * 1.5;
          ctx.beginPath();
          ctx.moveTo(bx + r, by); ctx.lineTo(bx + bw - r, by); ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
          ctx.lineTo(bx + bw, by + bh - r); ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
          ctx.lineTo(bx + r, by + bh); ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
          ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
          ctx.closePath();
          ctx.fill();
        }
        // Text
        ctx.fillStyle = textColor || entry.color;
        ctx.fillText(text, x, y);
        break;
      }
    }
  }
}

/** Merge annotation entries onto a base image, return combined base64 JPEG */
export function mergeAnnotation(
  baseImageSrc: string,
  entries: AnnotationEntry[],
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      replayAnnotations(ctx, entries);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(baseImageSrc); // fallback to original
    img.crossOrigin = 'anonymous';
    img.src = baseImageSrc;
  });
}
