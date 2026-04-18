import { describe, it, expect } from 'vitest';

/**
 * Test the CSS independent property approach used for editable transforms.
 * In production: Proxy injects style.translate/scale at createElement time,
 * DesignOverlay.applyStoredOffsets does the same via DOM post-processing.
 * Both use the same pattern tested here.
 */

function createContainer(...editableIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  editableIds.forEach((id) => {
    const el = document.createElement('div');
    el.setAttribute('data-editable', id);
    container.appendChild(el);
  });
  return container;
}

function applyTransforms(container: HTMLElement, props: Record<string, unknown>): void {
  container.querySelectorAll('[data-editable]').forEach((node) => {
    const id = node.getAttribute('data-editable');
    if (!id) return;
    const el = node as HTMLElement;
    const pos = props[`_pos_${id}`] as { x: number; y: number } | undefined;
    const sc = props[`_scale_${id}`] as { w: number; h: number } | undefined;
    el.style.translate = pos ? `${pos.x}px ${pos.y}px` : '';
    el.style.scale = sc ? `${(+sc.w.toFixed(4))} ${(+sc.h.toFixed(4))}` : '';
  });
}

function getEditable(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-editable="${id}"]`) as HTMLElement;
}

describe('editable transforms — style.translate + style.scale (CSS independent properties)', () => {
  it('applies translate for position', () => {
    const c = createContainer('title');
    applyTransforms(c, { _pos_title: { x: 100, y: 50 } });
    expect(getEditable(c, 'title').style.translate).toBe('100px 50px');
  });

  it('applies scale', () => {
    const c = createContainer('title');
    applyTransforms(c, { _scale_title: { w: 1.5, h: 1.5 } });
    expect(getEditable(c, 'title').style.scale).toBe('1.5 1.5');
  });

  it('clears when props removed', () => {
    const c = createContainer('title');
    applyTransforms(c, { _pos_title: { x: 10, y: 20 } });
    applyTransforms(c, {});
    expect(getEditable(c, 'title').style.translate).toBe('');
  });

  it('applies both independently', () => {
    const c = createContainer('title');
    applyTransforms(c, { _pos_title: { x: 50, y: 25 }, _scale_title: { w: 1.8, h: 1.8 } });
    expect(getEditable(c, 'title').style.translate).toBe('50px 25px');
    expect(getEditable(c, 'title').style.scale).toBe('1.8 1.8');
  });

  it('handles multiple elements', () => {
    const c = createContainer('a', 'b');
    applyTransforms(c, { _pos_a: { x: 10, y: 20 }, _pos_b: { x: 30, y: 40 } });
    expect(getEditable(c, 'a').style.translate).toBe('10px 20px');
    expect(getEditable(c, 'b').style.translate).toBe('30px 40px');
  });

  it('does NOT set style.transform', () => {
    const c = createContainer('title');
    applyTransforms(c, { _pos_title: { x: 10, y: 20 }, _scale_title: { w: 2, h: 2 } });
    expect(getEditable(c, 'title').style.transform).toBe('');
  });

  it('idempotent', () => {
    const c = createContainer('title');
    const props = { _pos_title: { x: 42, y: 99 }, _scale_title: { w: 2.5, h: 2.5 } };
    applyTransforms(c, props);
    applyTransforms(c, props);
    expect(getEditable(c, 'title').style.translate).toBe('42px 99px');
    expect(getEditable(c, 'title').style.scale).toBe('2.5 2.5');
  });

  it('two containers produce identical results', () => {
    const c1 = createContainer('a');
    const c2 = createContainer('a');
    const props = { _pos_a: { x: 10, y: 20 }, _scale_a: { w: 1.5, h: 1.5 } };
    applyTransforms(c1, props);
    applyTransforms(c2, props);
    expect(getEditable(c1, 'a').style.translate).toBe(getEditable(c2, 'a').style.translate);
    expect(getEditable(c1, 'a').style.scale).toBe(getEditable(c2, 'a').style.scale);
  });
});
