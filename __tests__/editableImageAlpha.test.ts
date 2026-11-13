import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPaintedEditableHit, pendingEditableAlphaAtPoint, pickPaintedEditable } from '@/lib/editor/editable-image-alpha';

let sourceId = 0;
const pixels = new WeakMap<HTMLImageElement, number[]>();
const unreadable = new WeakSet<HTMLImageElement>();

function image(id: string, alpha: number[]) {
  const node = document.createElement('img');
  node.dataset.editable = id;
  node.src = `https://example.test/alpha-${sourceId++}.png`;
  Object.defineProperties(node, {
    naturalWidth: { value: 2 }, naturalHeight: { value: 1 }, complete: { value: true },
    offsetWidth: { value: 100 }, offsetHeight: { value: 50 },
  });
  node.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, toJSON() {} });
  pixels.set(node, alpha);
  document.body.append(node);
  return node;
}

beforeEach(() => {
  vi.stubGlobal('DOMMatrix', class { a = 1; b = 0; c = 0; d = 1; is2D = true; });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'none', scale: 'none', rotate: 'none', objectFit: 'fill', objectPosition: '50% 50%' } as CSSStyleDeclaration);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    let drawn: HTMLImageElement;
    return {
      drawImage(node: HTMLImageElement) { drawn = node; },
      getImageData() {
        if (unreadable.has(drawn)) throw new Error('Tainted canvas');
        return { data: new Uint8ClampedArray((pixels.get(drawn) ?? []).flatMap(a => [0, 0, 0, a])) };
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('painted editable hit testing', () => {
  it('passes through clear front pixels and preserves painted stacking order', () => {
    const front = image('brother', [0, 255]), back = image('baby', [255, 255]);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [front, back] });
    const rects = [{ id: 'brother', domEl: front }, { id: 'baby', domEl: back }];
    expect(pickPaintedEditable(rects, 25, 25)).toBe('baby');
    expect(pickPaintedEditable(rects, 75, 25)).toBe('brother');
  });

  it('does not restore a rectangular hit when every layer is transparent', () => {
    const node = image('clear', [0, 0]);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [node] });
    expect(pickPaintedEditable([{ id: 'clear', domEl: node }], 25, 25)).toBeNull();
  });

  it('allows an explicitly selected rear layer to move under an occluder', () => {
    const front = image('girl', [255, 255]), back = image('rocket', [255, 0]);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [front, back] });
    expect(pickPaintedEditable([{ id: 'girl', domEl: front }, { id: 'rocket', domEl: back }], 25, 25)).toBe('girl');
    expect(isPaintedEditableHit(back, 25, 25)).toBe(true);
    expect(isPaintedEditableHit(back, 75, 25)).toBe(false);
  });

  it('waits for a recoverable CORS mask before resolving a touch hit', async () => {
    const front = image('brother', [0, 255]), back = image('baby', [255, 255]);
    unreadable.add(front);
    let recovered: HTMLImageElement;
    vi.stubGlobal('Image', function () { recovered = image('cors-copy', [0, 255]); return recovered; });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [front, back] });
    const rects = [{ id: 'brother', domEl: front }, { id: 'baby', domEl: back }];
    const pending = pendingEditableAlphaAtPoint(rects, 25, 25);
    expect(pending).not.toBeNull();
    expect(isPaintedEditableHit(front, 25, 25)).toBe(false);
    recovered!.onload!(new Event('load'));
    await pending;
    expect(pickPaintedEditable(rects, 25, 25)).toBe('baby');
  });
});
