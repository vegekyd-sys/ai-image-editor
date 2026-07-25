import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/components/DesignOverlay.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('DesignOverlay moveable guideline regression guards', () => {
  it('keeps Moveable snap guidelines enabled for editable drag alignment', () => {
    expect(source).toContain('snappable={true}');
    expect(source).toContain('snapThreshold={8}');
    expect(source).toContain('snapGap={true}');
    expect(source).toContain('isDisplaySnapDigit={true}');
    expect(source).toContain('snapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}');
    expect(source).toContain('elementSnapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}');
    expect(source).toContain('horizontalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientHeight / 2)] : []}');
    expect(source).toContain('verticalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientWidth / 2)] : []}');
    expect(source).toContain('elementGuidelines={rects.filter(r => r.id !== selectedFieldId).map(r => r.domEl)}');
  });

  it('keeps fallback drag from stealing desktop Moveable drag events', () => {
    expect(source).toContain('if (targetEl.closest(\'.moveable-area\')) return false;');
    expect(source).toContain("if (pointerType !== 'touch') return false;");
    expect(source).not.toContain("addEventListener('mousedown'");
    expect(source).not.toContain("addEventListener('mousemove'");
    expect(source).not.toContain("addEventListener('mouseup'");
  });

  it('keeps corner resize controls usable for small editable images on touch screens', () => {
    expect(css).toContain('min-width: 44px !important;');
    expect(css).toContain('min-height: 44px !important;');
    expect(css).toContain('touch-action: none !important;');
  });

  it('coalesces touch drag layout work to one update per animation frame', () => {
    expect(source).toContain('let pendingDragPoint: { x: number; y: number } | null = null;');
    expect(source).toContain('dragRaf = requestAnimationFrame(flushDrag);');
    expect(source).toContain('flushDrag();');
    expect(source).toContain('cancelAnimationFrame(dragRaf);');
  });
});
