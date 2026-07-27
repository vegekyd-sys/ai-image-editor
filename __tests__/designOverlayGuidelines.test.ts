import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/components/DesignOverlay.tsx'), 'utf8');
const canvasSource = readFileSync(join(process.cwd(), 'src/components/ImageCanvas.tsx'), 'utf8');
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

  it('measures Moveable in the scaled Remotion canvas coordinate space', () => {
    expect(source).toContain('rootContainer={containerEl ?? undefined}');
    expect(source).not.toContain('rootContainer={overlayRef.current ?? undefined}');
    expect(source).toContain('useAccuratePosition={true}');
  });

  it('never promotes a collapsed Remotion duplicate after an editable is moved', () => {
    expect(source).toContain('if (!isEditableRectMeasurable(elRect)) return;');
    expect(source).not.toContain('if (!storedPos) return;');
    expect(source).toContain('r.id === selectedFieldId && r.domEl.isConnected');
  });

  it('keeps fallback drag from stealing desktop Moveable drag events', () => {
    expect(source).toContain('if (targetEl.closest(\'.moveable-area\')) return false;');
    expect(source).toContain("if (pointerType !== 'touch') return false;");
    expect(source).not.toContain("addEventListener('mousedown'");
    expect(source).not.toContain("addEventListener('mousemove'");
    expect(source).not.toContain("addEventListener('mouseup'");
  });

  it('keeps corner resize controls usable for small editable images on touch screens', () => {
    const coarseRuleStart = css.indexOf('@media (pointer: coarse)');
    const coarseHandleRule = css.slice(coarseRuleStart, coarseRuleStart + 900);

    expect(coarseHandleRule).toContain('.moveable-nw.moveable-scalable');
    expect(coarseHandleRule).toContain('.moveable-ne.moveable-scalable');
    expect(coarseHandleRule).toContain('.moveable-sw.moveable-scalable');
    expect(coarseHandleRule).toContain('.moveable-se.moveable-scalable');
    expect(css).toContain('min-width: 44px !important;');
    expect(css).toContain('min-height: 44px !important;');
    expect(css).toContain('margin-top: -22px !important;');
    expect(css).toContain('margin-left: -22px !important;');
    expect(css).toContain('touch-action: none !important;');
  });

  it('coalesces touch drag layout work to one update per animation frame', () => {
    expect(source).toContain('let pendingDragPoint: { x: number; y: number } | null = null;');
    expect(source).toContain('dragRaf = requestAnimationFrame(flushDrag);');
    expect(source).toContain('flushDrag();');
    expect(source).toContain('cancelAnimationFrame(dragRaf);');
  });

  it('uses one pointer arbiter for editable selection and canvas playback', () => {
    expect(source).toContain("interactionEl.addEventListener('pointerdown', handlePointerDown, { capture: true });");
    expect(source).toContain("interactionEl.addEventListener('pointerup', handlePointerUp, { capture: true });");
    expect(source).toContain("eventTarget.closest?.('button, [data-remotion-seek], .moveable-control')");
    expect(source).not.toContain("eventTarget.closest?.('button, [data-remotion-seek], .moveable-control, .moveable-area')");
    expect(source).toContain('const editActivation = resolveEditableEditActivation({');
    expect(source.indexOf('const editActivation = resolveEditableEditActivation({')).toBeGreaterThan(
      source.indexOf('const handlePointerUp = (e: PointerEvent) => {'),
    );
    expect(source).toContain("'data-editable-canvas-cover'");
    expect(source).toContain("if (intent === 'canvas-tap') onCanvasTapRef.current?.();");
    expect(canvasSource).toContain('posterImage={currentDesign?.animation && !selectedEditableId ? displayImage : undefined}');
    expect(canvasSource).toContain('remotionLoading && displayImage && !selectedEditableId');
    expect(canvasSource).toContain('onCanvasTap={handleDesignCanvasTap}');
    expect(canvasSource).not.toContain('wasPlayingBeforeBufferRef');
    expect(canvasSource).toContain('if (id && remotionRef.current)');
    expect(canvasSource).not.toContain('`_sel_${id}`');
  });
});
