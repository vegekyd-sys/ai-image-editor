import { describe, expect, it } from 'vitest';
import { getVideoTrimPropKeys } from '@/lib/editor/video-trim';

describe('video trim prop keys', () => {
  it('uses explicit trim keys when a video editable declares them', () => {
    expect(getVideoTrimPropKeys({
      id: 'heroVideo',
      type: 'video',
      label: 'Hero',
      propKey: 'heroSrc',
      trimBeforePropKey: 'heroStart',
      trimAfterPropKey: 'heroEnd',
    })).toEqual({
      startKey: 'heroStart',
      endKey: 'heroEnd',
      isLegacy: false,
    });
  });

  it('provides legacy keys for existing video editables without trim metadata', () => {
    expect(getVideoTrimPropKeys({
      id: 'video2',
      type: 'video',
      label: 'Middle video',
      propKey: 'video2Url',
    })).toEqual({
      startKey: '_trimBefore_video2',
      endKey: '_trimAfter_video2',
      isLegacy: true,
    });
  });
});

