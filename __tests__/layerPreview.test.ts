import { expect, it } from 'vitest';
import { isLayerSnapshot } from '@/lib/editor/layer-preview';
import type { Snapshot } from '@/types';

it('reveals Agent-edited layer projects whose original manifest and sizing tags were omitted', () => {
  const snapshot: Snapshot = {
    id: 'edited', image: '/poster.jpg', tips: [], messageId: '',
    design: {
      width: 1000, height: 1500, code: 'function Design(){ return null; }',
      editables: [{ id: 'layer_2', propKey: 'layer_2', type: 'image', label: 'Layer' }],
      props: { layer_2: 'https://example.com/project/layerize/job/layer_2.png' },
    },
  };
  expect(isLayerSnapshot(snapshot)).toBe(true);
  expect(isLayerSnapshot({ ...snapshot, design: { ...snapshot.design!, props: { layer_2: '/replacement.png' } } })).toBe(false);
  expect(isLayerSnapshot({ ...snapshot, design: { ...snapshot.design!, animation: { fps: 30, durationInSeconds: 2 } } })).toBe(false);
  expect(isLayerSnapshot({ ...snapshot, design: { ...snapshot.design!, editables: [{ id: 'photo', propKey: 'layer_2', type: 'image', label: 'Photo' }] } })).toBe(false);
});
