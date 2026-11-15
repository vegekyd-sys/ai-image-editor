import { describe, expect, it } from 'vitest';
import { applyGuestEditableDraft, updateGuestEditableDraft } from '@/lib/editor/guest-editable-draft';
import { recordDesignEdit, seekDesignEditHistory, readDesignEditHistory } from '@/lib/editor/design-edit-history';
import type { DesignPayload, Snapshot } from '@/types';

const design: DesignPayload = { code: 'function Scene(props) { return null; }', width: 800, height: 600,
  props: { title: 'Source', image: '/source.png', clip: '/clip.mp4' }, editables: [
    { id: 'title', propKey: 'title', type: 'text', label: 'Title' },
    { id: 'image', propKey: 'image', type: 'image', label: 'Image' },
    { id: 'clip', propKey: 'clip', type: 'video', label: 'Video' },
  ] };
const snapshot = (id: string, value = design): Snapshot => ({ id, design: value, image: '/poster.png', tips: [], messageId: '' });

describe('guest Editable drafts', () => {
  it('isolates multiple snapshots and preserves all existing prop types and history', () => {
    const source = JSON.stringify(design);
    let props = recordDesignEdit(design.props!, 'title', 'Guest title', { kind: 'text' });
    for (const [key, value] of Object.entries({ _pos_image: { x: 20, y: -10 }, _scale_image: { w: 1.2, h: 1.2 },
      _trimBefore_clip: 30, _trimAfter_clip: 150, _layerState: { order: ['image', 'title', 'clip'], deleted: ['image'] } })) props = recordDesignEdit(props, key, value);
    const draft = updateGuestEditableDraft('public', null, 'a', { ...design, props });
    const both = updateGuestEditableDraft('public', draft, 'b', { ...design, props: { title: 'Second' } });
    const restored = applyGuestEditableDraft([snapshot('a'), snapshot('b'), snapshot('untouched')], JSON.parse(JSON.stringify(both)));
    expect(restored[0].design?.props).toEqual(props);
    expect(restored[1].design?.props?.title).toBe('Second');
    expect(restored[2].design).toBe(design);
    expect(readDesignEditHistory(restored[0].design!.props!).entries).toHaveLength(6);
    expect(seekDesignEditHistory(props, 0).title).toBe('Source');
    expect(JSON.stringify(design)).toBe(source);
  });
  it('does not carry another project draft into a new project', () => {
    const first = updateGuestEditableDraft('first', null, 'a', design);
    const second = updateGuestEditableDraft('second', first, 'b', design);
    expect(Object.keys(second.designs)).toEqual(['b']);
  });
  it('waits for source hydration and refuses a changed source composition', () => {
    const draft = updateGuestEditableDraft('public', null, 'a', { ...design, props: { title: 'Guest' } });
    const noDesign = { ...snapshot('a'), design: undefined };
    expect(applyGuestEditableDraft([noDesign], draft)[0]).toBe(noDesign);
    const changed = snapshot('a', { ...design, code: 'function Different() {}' });
    expect(applyGuestEditableDraft([changed], draft)[0]).toBe(changed);
  });
});
