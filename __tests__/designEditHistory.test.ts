import { describe, expect, it } from 'vitest';
import { recordDesignEdit, readDesignEditHistory, seekDesignEditHistory, historyUnsetProps } from '@/lib/editor/design-edit-history';
import { mergePersistedEditableProps } from '@/lib/editor/editable-persistence';
import { hasDesignLayers } from '@/lib/editor/design-layer-state';
import { imagePaintRect } from '@/lib/editor/editable-image-alpha';

describe('shared design edit history', () => {
  it('restores move/resize, deletion, order, and text exactly after a save and reopen', () => {
    let props: Record<string, unknown> = { title: 'Original' };
    props = recordDesignEdit(props, '_pos_title', { x: 40, y: -8 }, { at: 10 });
    props = recordDesignEdit(props, '_scale_title', { w: 1.4, h: 1.4 }, { at: 20 });
    props = recordDesignEdit(props, '_layerState', { order: ['hero', 'title'], deleted: ['hero'] }, { kind: 'delete', at: 30 });
    props = recordDesignEdit(props, 'title', 'Changed', { kind: 'text', at: 40 });
    const design = { code: 'function Composition() { return null }', width: 100, height: 300, props };
    const undone = seekDesignEditHistory(JSON.parse(JSON.stringify(props)), 0);
    const saved = mergePersistedEditableProps(design, undone, 1, historyUnsetProps(undone));
    expect(saved.props?.title).toBe('Original');
    expect(saved.props).not.toHaveProperty('_pos_title');
    expect(saved.props).not.toHaveProperty('_scale_title');
    expect(saved.props).not.toHaveProperty('_layerState');
    const redone = seekDesignEditHistory(JSON.parse(JSON.stringify(saved.props)), 4);
    expect(redone).toMatchObject({ title: 'Changed', _pos_title: { x: 40, y: -8 }, _scale_title: { w: 1.4, h: 1.4 } });
    expect(readDesignEditHistory(redone).entries.map(e => e.kind)).toEqual(['move', 'scale', 'delete', 'text']);
  });

  it('coalesces typing, separates gestures, drops redo on branching, and ignores zero movement', () => {
    let props: Record<string, unknown> = { title: '' };
    expect(recordDesignEdit(props, '_pos_title', { x: 0, y: 0 })).toBe(props);
    expect(recordDesignEdit(props, '_scale_title', { w: 1, h: 1 })).toBe(props);
    props = recordDesignEdit(props, 'title', 'A', { kind: 'text', at: 1000 });
    props = recordDesignEdit(props, 'title', 'AB', { kind: 'text', at: 1100 });
    expect(readDesignEditHistory(props).entries).toHaveLength(1);
    props = recordDesignEdit(props, '_pos_title', { x: 1, y: 0 }, { at: 1200 });
    props = recordDesignEdit(props, '_pos_title', { x: 2, y: 0 }, { at: 1300 });
    expect(readDesignEditHistory(props).entries).toHaveLength(3);
    props = seekDesignEditHistory(props, 1);
    props = recordDesignEdit(props, 'title', 'Branch', { kind: 'text', at: 1400 });
    expect(readDesignEditHistory(props)).toMatchObject({ cursor: 2 });
    expect(readDesignEditHistory(props).entries).toHaveLength(2);
  });

  it('keeps generic long designs content-sized after ordinary layer edits', () => {
    const ordinary = { code: 'function Composition(){}', width: 800, height: 2600,
      editables: [{ id: 'title', propKey: 'title', type: 'text' as const, label: 'Title' }],
      props: { _layerState: { order: ['title'], deleted: [], stacking: true } } };
    expect(hasDesignLayers(ordinary)).toBe(false);
    expect(hasDesignLayers({ ...ordinary, props: { ...ordinary.props, _canvasSizing: 'fixed' } })).toBe(true);
  });
});

describe('image hit-test geometry', () => {
  it('respects contain letterboxing, cover crops, and noncentral object positioning', () => {
    expect(imagePaintRect({ width: 200, height: 200 }, { width: 400, height: 200 }, 'contain')).toEqual({ left: 0, top: 50, width: 200, height: 100 });
    expect(imagePaintRect({ width: 200, height: 200 }, { width: 400, height: 200 }, 'cover', '100% 50%')).toEqual({ left: -200, top: 0, width: 400, height: 200 });
  });
});
