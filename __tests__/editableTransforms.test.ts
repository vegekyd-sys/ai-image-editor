import { describe, it, expect } from 'vitest';
import { applyEditableTransforms } from '@/lib/evalRemotionJSX';

function createContainer(...editableIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  editableIds.forEach((id) => {
    const el = document.createElement('div');
    el.setAttribute('data-editable', id);
    container.appendChild(el);
  });
  return container;
}

function getEditable(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-editable="${id}"]`) as HTMLElement;
}

describe('applyEditableTransforms — uses style.translate + style.scale (not style.transform)', () => {
  it('applies translate for position', () => {
    const c = createContainer('title');
    applyEditableTransforms(c, { _pos_title: { x: 100, y: 50 } });
    expect(getEditable(c, 'title').style.translate).toBe('100px 50px');
  });

  it('applies scale', () => {
    const c = createContainer('title');
    applyEditableTransforms(c, { _scale_title: { w: 1.5, h: 1.5 } });
    expect(getEditable(c, 'title').style.scale).toBe('1.5 1.5');
  });

  it('clears when props removed', () => {
    const c = createContainer('title');
    applyEditableTransforms(c, { _pos_title: { x: 10, y: 20 } });
    expect(getEditable(c, 'title').style.translate).toBe('10px 20px');
    applyEditableTransforms(c, {});
    expect(getEditable(c, 'title').style.translate).toBe('');
  });

  it('applies both translate and scale independently', () => {
    const c = createContainer('title');
    applyEditableTransforms(c, { _pos_title: { x: 50, y: 25 }, _scale_title: { w: 1.8, h: 1.8 } });
    const el = getEditable(c, 'title');
    expect(el.style.translate).toBe('50px 25px');
    expect(el.style.scale).toBe('1.8 1.8');
  });

  it('handles multiple elements', () => {
    const c = createContainer('title', 'sub');
    applyEditableTransforms(c, { _pos_title: { x: 10, y: 20 }, _pos_sub: { x: 30, y: 40 } });
    expect(getEditable(c, 'title').style.translate).toBe('10px 20px');
    expect(getEditable(c, 'sub').style.translate).toBe('30px 40px');
  });

  it('does NOT set style.transform (preserves Agent animations)', () => {
    const c = createContainer('title');
    applyEditableTransforms(c, { _pos_title: { x: 10, y: 20 }, _scale_title: { w: 2, h: 2 } });
    expect(getEditable(c, 'title').style.transform).toBe('');
  });

  it('idempotent', () => {
    const c = createContainer('title');
    const props = { _pos_title: { x: 42, y: 99 }, _scale_title: { w: 2.5, h: 2.5 } };
    applyEditableTransforms(c, props);
    applyEditableTransforms(c, props);
    expect(getEditable(c, 'title').style.translate).toBe('42px 99px');
    expect(getEditable(c, 'title').style.scale).toBe('2.5 2.5');
  });

  it('two containers produce identical results', () => {
    const c1 = createContainer('a', 'b');
    const c2 = createContainer('a', 'b');
    const props = { _pos_a: { x: 10, y: 20 }, _scale_b: { w: 1.5, h: 1.5 } };
    applyEditableTransforms(c1, props);
    applyEditableTransforms(c2, props);
    expect(getEditable(c1, 'a').style.translate).toBe(getEditable(c2, 'a').style.translate);
    expect(getEditable(c1, 'b').style.scale).toBe(getEditable(c2, 'b').style.scale);
  });
});
