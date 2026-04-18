import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyEditableTransforms } from '@/lib/evalRemotionJSX';

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

describe('applyEditableTransforms', () => {
  describe('position (_pos_*)', () => {
    it('applies translate to element with matching _pos_ prop', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {
        _pos_title: { x: 100, y: 50 },
      });
      expect(getEditable(container, 'title').style.translate).toBe('100px 50px');
    });

    it('clears translate when _pos_ prop is removed', () => {
      const container = createContainer('title');
      // First apply
      applyEditableTransforms(container, { _pos_title: { x: 100, y: 50 } });
      expect(getEditable(container, 'title').style.translate).toBe('100px 50px');
      // Then remove
      applyEditableTransforms(container, {});
      expect(getEditable(container, 'title').style.translate).toBe('');
    });

    it('handles negative coordinates', () => {
      const container = createContainer('subtitle');
      applyEditableTransforms(container, {
        _pos_subtitle: { x: -30, y: -15 },
      });
      expect(getEditable(container, 'subtitle').style.translate).toBe('-30px -15px');
    });
  });

  describe('scale (_scale_*)', () => {
    it('applies scale to element with matching _scale_ prop', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {
        _scale_title: { w: 1.5, h: 1.5 },
      });
      expect(getEditable(container, 'title').style.scale).toBe('1.5 1.5');
    });

    it('clears scale when _scale_ prop is removed', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, { _scale_title: { w: 2, h: 2 } });
      expect(getEditable(container, 'title').style.scale).toBe('2 2');
      applyEditableTransforms(container, {});
      expect(getEditable(container, 'title').style.scale).toBe('');
    });

    it('handles non-uniform scale', () => {
      const container = createContainer('img');
      applyEditableTransforms(container, {
        _scale_img: { w: 2, h: 0.5 },
      });
      expect(getEditable(container, 'img').style.scale).toBe('2 0.5');
    });
  });

  describe('combined position + scale', () => {
    it('applies both translate and scale to the same element', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {
        _pos_title: { x: 50, y: 25 },
        _scale_title: { w: 1.8, h: 1.8 },
      });
      const el = getEditable(container, 'title');
      expect(el.style.translate).toBe('50px 25px');
      expect(el.style.scale).toBe('1.8 1.8');
    });

    it('applies transforms independently to multiple elements', () => {
      const container = createContainer('title', 'subtitle', 'logo');
      applyEditableTransforms(container, {
        _pos_title: { x: 10, y: 20 },
        _scale_title: { w: 1.2, h: 1.2 },
        _pos_subtitle: { x: 0, y: 100 },
        // logo has no transforms
      });
      const title = getEditable(container, 'title');
      const subtitle = getEditable(container, 'subtitle');
      const logo = getEditable(container, 'logo');

      expect(title.style.translate).toBe('10px 20px');
      expect(title.style.scale).toBe('1.2 1.2');
      expect(subtitle.style.translate).toBe('0px 100px');
      expect(subtitle.style.scale).toBe('');
      expect(logo.style.translate).toBe('');
      expect(logo.style.scale).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles empty container (no [data-editable] elements)', () => {
      const container = document.createElement('div');
      // Should not throw
      applyEditableTransforms(container, { _pos_title: { x: 10, y: 20 } });
    });

    it('handles empty props', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {});
      expect(getEditable(container, 'title').style.translate).toBe('');
      expect(getEditable(container, 'title').style.scale).toBe('');
    });

    it('ignores non-transform props', () => {
      const container = createContainer('title');
      applyEditableTransforms(container, {
        text: 'Hello',
        color: '#fff',
        _pos_title: { x: 5, y: 5 },
      });
      expect(getEditable(container, 'title').style.translate).toBe('5px 5px');
    });

    it('handles nested [data-editable] elements', () => {
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
      expect((outer as HTMLElement).style.translate).toBe('10px 10px');
      expect((inner as HTMLElement).style.translate).toBe('20px 20px');
    });
  });

  describe('preview = export guarantee', () => {
    it('same props produce same transforms regardless of call count', () => {
      const container = createContainer('title');
      const props = {
        _pos_title: { x: 42, y: 99 },
        _scale_title: { w: 2.5, h: 2.5 },
      };

      // Call multiple times (simulates re-renders)
      applyEditableTransforms(container, props);
      applyEditableTransforms(container, props);
      applyEditableTransforms(container, props);

      const el = getEditable(container, 'title');
      expect(el.style.translate).toBe('42px 99px');
      expect(el.style.scale).toBe('2.5 2.5');
    });

    it('two separate containers with same props produce identical results', () => {
      const container1 = createContainer('title', 'subtitle');
      const container2 = createContainer('title', 'subtitle');
      const props = {
        _pos_title: { x: 10, y: 20 },
        _scale_title: { w: 1.5, h: 1.5 },
        _pos_subtitle: { x: 30, y: 40 },
      };

      applyEditableTransforms(container1, props);
      applyEditableTransforms(container2, props);

      // Preview container and export container must match
      ['title', 'subtitle'].forEach((id) => {
        const el1 = getEditable(container1, id);
        const el2 = getEditable(container2, id);
        expect(el1.style.translate).toBe(el2.style.translate);
        expect(el1.style.scale).toBe(el2.style.scale);
      });
    });
  });
});
