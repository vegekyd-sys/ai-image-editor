import { closestEditableRuntimeElement, readEditableRuntimeId } from './scene-registry';

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
type Alpha = { width: number; height: number; data: Uint8ClampedArray };
const cache = new Map<string, { alpha?: Alpha; loading?: Promise<void>; failed?: boolean }>();
const MAX_CACHE = 48;
const multiply = (p: Affine, q: Affine): Affine => ({ a: p.a * q.a + p.c * q.b, b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d, d: p.b * q.c + p.d * q.d, e: 0, f: 0 });

export function editableMediaImage(element: HTMLElement): HTMLImageElement | null {
  const id = readEditableRuntimeId(element);
  const images = element.matches('img') ? [element] : Array.from(element.querySelectorAll('img'));
  return images.find(image => { const node = closestEditableRuntimeElement(image); return node && readEditableRuntimeId(node) === id; }) as HTMLImageElement | undefined || null;
}

function decodeAlpha(image: HTMLImageElement): Alpha {
  const ratio = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Pixel sampling unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

export function warmEditableAlpha(image: HTMLImageElement): void {
  const src = image.currentSrc || image.src;
  if (!src || cache.has(src) || !image.complete || !image.naturalWidth) return;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  const entry: { alpha?: Alpha; loading?: Promise<void>; failed?: boolean } = {};
  cache.set(src, entry);
  try { entry.alpha = decodeAlpha(image); return; } catch { /* Retry with an anonymous CORS image, never credentials. */ }
  entry.loading = new Promise<void>(resolve => {
    const readable = new Image(); readable.crossOrigin = 'anonymous';
    readable.onload = () => { try { entry.alpha = decodeAlpha(readable); } catch { entry.failed = true; } resolve(); };
    readable.onerror = () => { entry.failed = true; resolve(); };
    readable.src = src;
  });
}

/** Affine viewport transform, including CSS rotate/scale and scaled Player ancestors. */
export function editableViewportMatrix(element: HTMLElement): { matrix: Affine; width: number; height: number } | null {
  let linear: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node), transform = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
    if (!transform.is2D) return null;
    if (/^[xy]\s/.test(style.rotate)) return null;
    const parts = style.scale === 'none' ? [1, 1] : style.scale.split(/\s+/).map(v => v.endsWith('%') ? parseFloat(v) / 100 : Number(v));
    const angle = style.rotate === 'none' ? 0 : parseFloat(style.rotate.split(/\s+/).at(-1) || '0');
    const radians = angle * (style.rotate.endsWith('rad') ? 1 : style.rotate.endsWith('turn') ? Math.PI * 2 : Math.PI / 180);
    const cos = Math.cos(radians), sin = Math.sin(radians), sx = parts[0] ?? 1, sy = parts[1] ?? sx;
    const independent = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: 0, f: 0 };
    linear = multiply(multiply(independent, transform), linear);
  }
  const rect = element.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight;
  if (!width || !height) return null;
  const xs = [0, linear.a * width, linear.c * height, linear.a * width + linear.c * height];
  const ys = [0, linear.b * width, linear.d * height, linear.b * width + linear.d * height];
  return { matrix: { ...linear, e: rect.left - Math.min(...xs), f: rect.top - Math.min(...ys) }, width, height };
}

export function imagePaintRect(box: { width: number; height: number }, natural: { width: number; height: number }, fit: string, position = '50% 50%') {
  let width = box.width, height = box.height;
  if (fit !== 'fill') {
    let scale = fit === 'cover' ? Math.max(box.width / natural.width, box.height / natural.height) : Math.min(box.width / natural.width, box.height / natural.height);
    if (fit === 'none') scale = 1;
    if (fit === 'scale-down') scale = Math.min(1, scale);
    width = natural.width * scale; height = natural.height * scale;
  }
  const parts = position.split(/\s+/), offset = (value: string, space: number) => {
    if (value === 'center') return space / 2;
    if (value === 'left' || value === 'top') return 0;
    if (value === 'right' || value === 'bottom') return space;
    return value.endsWith('%') ? space * parseFloat(value) / 100 : parseFloat(value) || 0;
  };
  return { left: offset(parts[0] || '50%', box.width - width), top: offset(parts[1] || '50%', box.height - height), width, height };
}

export function sampleEditableImage(image: HTMLImageElement, x: number, y: number): boolean | null {
  warmEditableAlpha(image);
  const alpha = cache.get(image.currentSrc || image.src)?.alpha;
  const geometry = editableViewportMatrix(image);
  if (!alpha || !geometry) return null;
  const { matrix: m, width, height } = geometry, det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < .000001) return null;
  const dx = x - m.e, dy = y - m.f, lx = (m.d * dx - m.c * dy) / det, ly = (-m.b * dx + m.a * dy) / det;
  if (lx < 0 || ly < 0 || lx >= width || ly >= height) return false;
  const style = getComputedStyle(image), paint = imagePaintRect({ width, height }, { width: image.naturalWidth, height: image.naturalHeight }, style.objectFit, style.objectPosition);
  const u = (lx - paint.left) / paint.width, v = (ly - paint.top) / paint.height;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  const px = Math.min(alpha.width - 1, Math.floor(u * alpha.width)), py = Math.min(alpha.height - 1, Math.floor(v * alpha.height));
  return alpha.data[(py * alpha.width + px) * 4 + 3] > 8;
}

export function pickPaintedEditable(rects: Array<{ id: string; domEl: HTMLElement }>, x: number, y: number): string | null {
  const hits = rects.filter(({ domEl }) => { const r = domEl.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  const paintOrder = new Map<string, number>();
  document.elementsFromPoint(x, y).forEach((element, index) => {
    const node = closestEditableRuntimeElement(element), id = node && readEditableRuntimeId(node);
    if (id && !paintOrder.has(id)) paintOrder.set(id, index);
  });
  hits.sort((a, b) => (paintOrder.get(a.id) ?? 10000 - rects.indexOf(a)) - (paintOrder.get(b.id) ?? 10000 - rects.indexOf(b)));
  for (const hit of hits) {
    const image = editableMediaImage(hit.domEl);
    // Keep un-readable external images selectable rather than inventing alpha.
    if (!image || sampleEditableImage(image, x, y) !== false) return hit.id;
  }
  return hits[0]?.id ?? null;
}
