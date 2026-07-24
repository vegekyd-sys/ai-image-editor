import { describe, expect, it } from 'vitest';
import { resolveContentType, type RendererContext } from '@/lib/editor/renderer-registry';
import type { Snapshot } from '@/types';

const ctx: RendererContext = {
  viewIndex: 0,
  draftParentIndex: null,
  isAtDraftSlot: false,
  timelineVersion: 2,
  animations: [],
  selectedVideoId: null,
};

const snap = (extra: Partial<Snapshot>): Snapshot => ({
  id: 'snap-1',
  image: '',
  tips: [],
  messageId: 'msg-1',
  ...extra,
});

describe('renderer registry', () => {
  it('renders persisted Remotion compositions even when they have no editable fields', () => {
    expect(resolveContentType(snap({
      design: {
        code: 'function Composition() { return null; }',
        width: 1920,
        height: 1080,
        animation: { fps: 30, durationInSeconds: 60 },
      },
      designPath: 'code/snap-1.json',
    }), ctx)).toBe('design');
  });
});
