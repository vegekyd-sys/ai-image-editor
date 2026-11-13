import { describe, it, expect } from 'vitest';
import type { DesignPayload } from '@/types';
import { applyElementEdit, rebaseElementEdit, parseSelectedElement, type ElementEditReceipt } from '@/lib/editor/element-edit';
import { seekDesignEditHistory } from '@/lib/editor/design-edit-history';
const source: DesignPayload = { code: 'original composition', width: 600, height: 900,
  editables: [{ id: 'baby', propKey: 'babyImage', type: 'image', label: '宝宝' }, { id: 'title', propKey: 'caption', type: 'text', label: '标题' }],
  props: { babyImage: 'original.png', caption: 'Original', _pos_baby: { x: 31, y: -17 }, _scale_baby: { w: .72, h: .81 }, _pos_title: { x: 5, y: 8 }, _layerState: { order: ['title', 'baby'], deleted: [] } } };
const edit = (operation: ElementEditReceipt['operation'], fieldId = 'baby'): ElementEditReceipt => ({ version: 1, id: 'edit-1', sourceSnapshotId: 'source', fieldId, operation });
describe('selected element edit contract', () => {
  it('swaps only the selected source, preserving composition, order and all GUI transforms', () => {
    const result = applyElementEdit(source, edit({ kind: 'replace', source: 'original.png', url: 'edited.png' }));
    expect(result.code).toBe(source.code);
    expect(result.props).toMatchObject({ ...source.props, babyImage: 'edited.png' });
    expect(seekDesignEditHistory(result.props!, 0)).toMatchObject(source.props!);
  });
  it('rebases generated content on movements, scales and text saved while the model was running', () => {
    const receipt = edit({ kind: 'replace', source: 'original.png', url: 'edited.png' });
    const pending = { ...applyElementEdit(source, receipt), elementEdit: receipt };
    const latest = { ...source, props: { ...source.props, caption: 'Typed during generation', _pos_baby: { x: 200, y: 90 }, _scale_baby: { w: .4, h: .5 } } };
    const result = rebaseElementEdit(pending, latest);
    expect(result.props).toMatchObject({ ...latest.props, babyImage: 'edited.png' });
    expect(result.elementEdit).toEqual(receipt);
  });
  it('refuses to overwrite a source replaced or deleted while generation was running', () => {
    const receipt = edit({ kind: 'replace', source: 'original.png', url: 'edited.png' });
    expect(() => applyElementEdit({ ...source, props: { ...source.props, babyImage: 'another.png' } }, receipt)).toThrow('changed');
    expect(() => applyElementEdit({ ...source, props: { ...source.props, _layerState: { order: ['title'], deleted: ['baby'] } } }, receipt)).toThrow('no longer available');
  });
  it('moves and scales from the current offsets and supports the shared history', () => {
    const result = applyElementEdit(source, edit({ kind: 'transform', dx: 20, dy: -10, scaleX: 2 }));
    expect(result.props?._pos_baby).toEqual({ x: 51, y: -27 });
    expect(result.props?._scale_baby).toEqual({ w: 1.44, h: 1.62 });
    expect(seekDesignEditHistory(result.props!, 0)).toMatchObject(source.props!);
    expect(result.props?.babyImage).toBe('original.png');
  });
  it('edits ordinary text without touching raster props or transforms', () => {
    const result = applyElementEdit(source, edit({ kind: 'text', text: 'Hello' }, 'title'));
    expect(result.props).toMatchObject({ ...source.props, caption: 'Hello' });
    expect(() => applyElementEdit(source, edit({ kind: 'text', text: 'Hello' }))).toThrow('not editable text');
  });
  it('accepts identity only from the client', () => {
    expect(parseSelectedElement({ snapshotId: 'source-id', fieldId: 'baby', source: 'untrusted', propKey: 'bad' })).toEqual({ snapshotId: 'source-id', fieldId: 'baby' });
    expect(parseSelectedElement({ snapshotId: '../elsewhere', fieldId: 'baby' })).toBeUndefined();
  });
});
it('preserves every operation in a compound CUI command when rebasing', () => {
  const receipt = { ...edit({ kind: 'replace', source: 'original.png', url: 'edited.png' }), operations: [
    { kind: 'transform' as const, dx: 25 }, { kind: 'replace' as const, source: 'original.png', url: 'edited.png' },
  ] };
  const result = applyElementEdit(source, receipt);
  expect(result.props?._pos_baby).toEqual({ x: 56, y: -17 });
  expect(result.props?.babyImage).toBe('edited.png');
  expect(seekDesignEditHistory(result.props!, 0)).toMatchObject(source.props!);
});
