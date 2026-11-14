import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EditableHoverTint from '@/components/EditableHoverTint';
let frames: Map<number, FrameRequestCallback>, id: number;
const finish = () => act(() => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(performance.now() + 200)); });
beforeEach(() => {
  frames = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('restores authored filters exactly after a smooth leave and on unmount', () => {
  const element = document.createElement('div'); element.style.setProperty('filter', 'brightness(0.8)', 'important'); document.body.append(element);
  const view = render(<EditableHoverTint element={element} fieldId="front" visible />); finish();
  expect(element.style.filter).toContain('brightness(0.8)'); expect(element.style.filter).toContain('mkr-hover-');
  const values = view.container.querySelector('feColorMatrix')!.getAttribute('values')!.split(' ').map(Number);
  expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]); // Alpha stays unchanged.
  view.rerender(<EditableHoverTint element={element} fieldId="front" visible={false} />); finish();
  expect(element.style.filter).toBe('brightness(0.8)'); expect(element.style.getPropertyPriority('filter')).toBe('important');
  view.rerender(<EditableHoverTint element={element} fieldId="front" visible />); finish(); view.unmount();
  expect(element.style.filter).toBe('brightness(0.8)');
});
it('cleans up the old snapshot without overwriting a concurrent authored filter change', () => {
  const old = document.createElement('div'), next = document.createElement('div'); document.body.append(old, next);
  const view = render(<EditableHoverTint element={old} fieldId="first" visible />); finish();
  view.rerender(<EditableHoverTint element={next} fieldId="second" visible />); finish();
  expect(old.style.filter).toBe(''); expect(next.style.filter).toContain('mkr-hover-');
  next.style.filter = 'contrast(1.2)'; view.unmount(); expect(next.style.filter).toBe('contrast(1.2)');
});
