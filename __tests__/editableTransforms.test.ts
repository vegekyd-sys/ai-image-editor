import { describe, it, expect } from 'vitest';
import { applyEditableTransforms, buildEditableTransform } from '@/lib/evalRemotionJSX';

// ── Helper: build a DOM tree with [data-editable] elements ───────────────

function createContainer(...editableIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  editableIds.forEach((id) => {
    const el = document.createElement('div');
    el.setAttribute('data-editable', id);
    el.textContent = `editable-${id}`;
    container.appendChild(el);
  });
  return container;
}

function getEditable(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-editable="${id}"]`) as HTMLElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildEditableTransform', () => {
  it('returns empty string when no pos/scale', () => {
    expect(buildEditableTransform()).toBe('');
    expect(buildEditableTransform(null, null)).toBe('');
  });

  it('returns translate only', () => {
    expect(buildEditableTransform({ x: 10, y: 20 })).toBe('translate(10px, 20px)');
  });

  it('returns scale only', () => {
    expect(buildEditableTransform(null, { w: 1.5, h: 1.5 })).toBe('scale(1.5, 1.5)');
  });

  it('returns translate + scale combined', () => {
    expect(buildEditableTransform({ x: 10, y: 20 }, { w: 2, h: 2 }))
      .toBe('translate(10px, 20px) scale(2, 2)');
  });

  it('skips scale(1,1)', () => {
    expect(buildEditableTransform({ x: 5, y: 5 }, { w: 1, h: 1 }))
      .toBe('translate(5px, 5px)');
  });

  it('handles negative coordinates', () => {
    expect(buildEditableTransform({ x: -30, y: -15 })).toBe('translate(-30px, -15px)');
  });

  it('rounds scale to 4 decimals', () => {
    expect(buildEditableTransform(null, { w: 1.123456, h: 1.123456 }))
      .toBe('scale(1.1235, 1.1235)');
  });
});

describe('applyEditableTransforms', () => {
  describe('uses style.transform (not translate/scale)', () => {
    it('sets transform with translate for position', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, { _pos_title: { x: 100, y: 50 } });
      const el = getEditable(container, 'title');
      expect(el.style.transform).toBe('translate(100px, 50px)');
      // Must NOT use independent CSS properties (renderMediaOnWeb ignores them)
      expect(el.style.translate || '').toBe('');
      expect(el.style.scale || '').toBe('');
    });

    it('sets transform with scale', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, { _scale_title: { w: 1.5, h: 1.5 } });
      expect(getEditable(container, 'title').style.transform).toBe('scale(1.5, 1.5)');
    });

    it('sets transform with both translate and scale', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {
        _pos_title: { x: 50, y: 25 },
        _scale_title: { w: 1.8, h: 1.8 },
      });
      expect(getEditable(container, 'title').style.transform)
        .toBe('translate(50px, 25px) scale(1.8, 1.8)');
    });

    it('clears transform when props removed', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, { _pos_title: { x: 10, y: 20 } });
      expect(getEditable(container, 'title').style.transform).toBe('translate(10px, 20px)');
      applyEditableTransforms(container, {});
      expect(getEditable(container, 'title').style.transform).toBe('');
    });
  });

  describe('multiple elements', () => {
    it('applies transforms independently', () => {
      const container = createContainer('title', 'subtitle', 'logo');
      applyEditableTransforms(container, {
        _pos_title: { x: 10, y: 20 },
        _scale_title: { w: 1.2, h: 1.2 },
        _pos_subtitle: { x: 0, y: 100 },
      });
      expect(getEditable(container, 'title').style.transform).toBe('translate(10px, 20px) scale(1.2, 1.2)');
      expect(getEditable(container, 'subtitle').style.transform).toBe('translate(0px, 100px)');
      expect(getEditable(container, 'logo').style.transform).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles empty container', () => {
      const container = document.createElement('div');
      applyEditableTransforms(container, { _pos_title: { x: 10, y: 20 } });
    });

    it('handles empty props', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {});
      expect(getEditable(container, 'title').style.transform).toBe('');
    });

    it('handles nested editables', () => {
      const container = document.createElement('div');
      const outer = document.createElement('div');
      outer.setAttribute('data-editable', 'outer');
      const inner = document.createElement('div');
      inner.setAttribute('data-editable', 'inner');
      outer.appendChild(inner);
      container.appendChild(outer);

      applyEditableTransforms(container, {
        _pos_outer: { x: 10, y: 10 },
        _pos_inner: { x: 20, y: 20 },
      });
      expect(outer.style.transform).toBe('translate(10px, 10px)');
      expect(inner.style.transform).toBe('translate(20px, 20px)');
    });
  });

  describe('preview = export guarantee', () => {
    it('same props produce identical transforms (idempotent)', () => {
      const container = createContainer('title');
      const props = { _pos_title: { x: 42, y: 99 }, _scale_title: { w: 2.5, h: 2.5 } };
      applyEditableTransforms(container, props);
      applyEditableTransforms(container, props);
      applyEditableTransforms(container, props);
      expect(getEditable(container, 'title').style.transform)
        .toBe('translate(42px, 99px) scale(2.5, 2.5)');
    });

    it('two separate containers produce identical results', () => {
      const c1 = createContainer('title', 'subtitle');
      const c2 = createContainer('title', 'subtitle');
      const props = { _pos_title: { x: 10, y: 20 }, _scale_title: { w: 1.5, h: 1.5 }, _pos_subtitle: { x: 30, y: 40 } };
      applyEditableTransforms(c1, props);
      applyEditableTransforms(c2, props);
      ['title', 'subtitle'].forEach((id) => {
        expect(getEditable(c1, id).style.transform).toBe(getEditable(c2, id).style.transform);
      });
    });

    it('only uses style.transform — never style.translate or style.scale', () => {
      const container = createContainer('a', 'b');
      applyEditableTransforms(container, {
        _pos_a: { x: 1, y: 2 }, _scale_a: { w: 3, h: 3 },
        _pos_b: { x: 4, y: 5 },
      });
      ['a', 'b'].forEach((id) => {
        const el = getEditable(container, id);
        expect(el.style.translate || '').toBe('');
        expect(el.style.scale || '').toBe('');
        expect(el.style.transform).not.toBe('');
      });
    });
  });
});
