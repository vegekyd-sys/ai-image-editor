import { describe, expect, it } from 'vitest';
import { evalRemotionJSX, pickRemotionComponentName } from '@/lib/evalRemotionJSX';
import { TIMELINE_RUNTIME_CODE } from '@/lib/timeline/runtime-code';
import { getTimelineDoc, isTimelineDesign, timelineToDesign } from '@/lib/timeline/design';
import { applyOps, createTimelineDoc } from '@/lib/timeline/reducer';

describe('timeline runtime code', () => {
  it('compiles in the browser Remotion runtime and picks Composition', () => {
    expect(pickRemotionComponentName(TIMELINE_RUNTIME_CODE)).toBe('Composition');
    expect(evalRemotionJSX(TIMELINE_RUNTIME_CODE)).toBeTypeOf('function');
    expect(evalRemotionJSX(TIMELINE_RUNTIME_CODE, { videoRuntime: 'preview' })).toBeTypeOf('function');
  });

  it('round-trips a doc through the design payload', () => {
    const doc = applyOps(createTimelineDoc(), [{ op: 'insert', clip: { id: 'a', trackId: 'main', kind: 'image', src: 'https://x/a.jpg', start: 0, duration: 2.5 } }]).doc;
    const design = timelineToDesign(doc);
    expect(isTimelineDesign(design)).toBe(true);
    expect(design.animation).toEqual({ fps: 30, durationInSeconds: 2.5 });
    expect(getTimelineDoc(JSON.parse(JSON.stringify(design)))?.clips.a.duration).toBe(2.5);
    expect(isTimelineDesign({ code: 'function Design(){}', props: { timeline: {} } })).toBe(false);
  });
});
